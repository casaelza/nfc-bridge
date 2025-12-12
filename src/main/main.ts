import { app, BrowserWindow, Tray, Menu, nativeImage, dialog } from "electron";
import express from "express";
import http from "http";
import cors from "cors";
import path from "path";
import { NFC, Reader } from "nfc-pcsc";
// @ts-ignore
import trayOnPath from './tray-on.png?asset';
// @ts-ignore
import trayOffPath from './tray-off.png?asset';

/* =========================
   Konfiguration
========================= */

const PORT = 3333;
const TARGET_READER = "ACR122";

/* =========================
   State
========================= */

let mainWindow: BrowserWindow | null = null;
let tray: Tray | null = null;
let server: http.Server | null = null;
let isQuitting = false;

let readerReady = false;
let activeReader: Reader | null = null;
let lastUID: string | null = null;
let bridgeEnabled = true;
let cardPresent = false;
let hasShownCloseHint = false;

let trayIconOn: nativeImage;
let trayIconOff: nativeImage;

/* wait-requests */
type Waiter = {
  resolve: (uid: string) => void;
  reject: (err: any) => void;
  timer: NodeJS.Timeout;
};
let waiters: Waiter[] = [];
/* =========================
   NFC / PCSC
========================= */

const nfc = new NFC();

nfc.on("reader", (reader: Reader) => {
  const name = reader.reader.name;
  console.log("[NFC] Reader:", name);

  if (!name.includes(TARGET_READER)) {
    reader.close();
    return;
  }

  if (activeReader) {
    reader.close();
    return;
  }

  activeReader = reader;
  reader.autoProcessing = false; // Disable auto processing to handle Type 4 tags manually
  readerReady = true;
  updateTray();

  reader.on("card", card => {
    // If we don't have a UID yet (Type 4 tag initial detection), fetch it using Type 3 method
    if (!card.uid) {
      // @ts-ignore
      reader.handle_Iso_14443_3_Tag();
      return;
    }

    cardPresent = true;
    if (!bridgeEnabled) return;
    lastUID = card.uid;

    waiters.forEach(w => {
      clearTimeout(w.timer);
      w.resolve(card.uid);
    });
    waiters = [];
  });

  reader.on("card.off", () => {
    cardPresent = false;
  });

  reader.on("end", () => {
    readerReady = false;
    activeReader = null;
    cardPresent = false;
    updateTray();

    waiters.forEach(w => {
      clearTimeout(w.timer);
      w.reject(new Error("reader removed"));
    });
    waiters = [];
  });

  reader.on("error", err => {
    console.error("[NFC] Reader error:", err);
  });
});

/* =========================
   HTTP API
========================= */

const api = express();
api.use(cors());
api.use(express.json());

api.get("/api/health", (_req, res) => {
  res.json({
    enabled: bridgeEnabled,
    readerReady,
    reader: activeReader?.reader.name ?? null,
    lastUID,
    cardPresent,
    port: PORT
  });
});

api.post("/api/bridge/toggle", (_req, res) => {
  bridgeEnabled = !bridgeEnabled;
  updateTray();
  res.json({ enabled: bridgeEnabled });
});

api.post("/api/nfc/wait", (_req, res) => {
  if (!readerReady) return res.status(503).json({ error: "reader not ready" });
  if (!bridgeEnabled) return res.status(423).json({ error: "bridge disabled" });

  // NEU: Wenn Karte schon da ist, sofort antworten!
  if (cardPresent && lastUID) {
    return res.json({ uid: lastUID });
  }

  const timer = setTimeout(() => {
    res.status(408).json({ error: "timeout" });
  }, 5000);

  waiters.push({
    resolve: uid => res.json({ uid }),
    reject: () => res.status(500).json({ error: "failed" }),
    timer
  });
});

/* =========================
   Fenster
========================= */

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 420,
    height: 320,
    minWidth: 400,
    minHeight: 300,
    show: false,
    resizable: true,
    autoHideMenuBar: true,
    backgroundColor: "#0f172a"
  });

  mainWindow.loadURL(
    "data:text/html;charset=utf-8," +
    encodeURIComponent(`
<!DOCTYPE html>
<html>
<head>
  <style>
    body { margin:0; padding:20px; background:#020617; color:#e5e7eb; font-family:system-ui; overflow: auto; }
    h2 { margin-top:0; color: #60a5fa; }
    .status-row { display: flex; justify-content: space-between; margin-bottom: 10px; border-bottom: 1px solid #1e293b; padding-bottom: 5px; }
    .label { color: #94a3b8; }
    .value { font-weight: bold; }
    .connected { color: #4ade80; }
    .disconnected { color: #f87171; }
    .btn { background: #3b82f6; color: white; border: none; padding: 8px 16px; border-radius: 4px; cursor: pointer; width: 100%; margin-top: 10px; }
    .btn:hover { background: #2563eb; }
    .btn.stop { background: #ef4444; }
    .btn.stop:hover { background: #dc2626; }
  </style>
</head>
<body>
  <h2>NFC IPH Desktop Bridge</h2>
  
  <div class="status-row">
    <span class="label">Reader:</span>
    <span class="value" id="reader">Scanning...</span>
  </div>
  <div class="status-row">
    <span class="label">Status:</span>
    <span class="value" id="status">...</span>
  </div>
  <div class="status-row">
    <span class="label">API Port:</span>
    <span class="value" id="port">...</span>
  </div>

  <button id="toggleBtn" class="btn" onclick="toggleBridge()">Loading...</button>

  <script>
    const API_URL = "http://127.0.0.1:3333/api";
    
    async function updateStatus() {
      try {
        const res = await fetch(API_URL + "/health");
        const data = await res.json();
        
        document.getElementById("reader").textContent = data.reader || "No Reader";
        document.getElementById("port").textContent = data.port;
        
        const statusEl = document.getElementById("status");
        if (data.cardPresent) {
          statusEl.textContent = "Card Present (" + (data.lastUID || "") + ")";
          statusEl.className = "value connected";
        } else {
          statusEl.textContent = "No Card";
          statusEl.className = "value";
        }

        const btn = document.getElementById("toggleBtn");
        if (data.enabled) {
          btn.textContent = "Disconnect";
          btn.className = "btn stop";
        } else {
          btn.textContent = "Connect";
          btn.className = "btn";
        }
      } catch (e) {
        document.getElementById("reader").textContent = "Backend Offline";
      }
    }

    async function toggleBridge() {
      try {
        await fetch(API_URL + "/bridge/toggle", { method: "POST" });
        updateStatus();
      } catch (e) {
        alert("Failed to toggle bridge");
      }
    }

    setInterval(updateStatus, 1000);
    updateStatus();
  </script>
</body>
</html>
`)
  );

  mainWindow.on("close", e => {
    if (!isQuitting) {
      e.preventDefault();

      if (!hasShownCloseHint) {
        dialog.showMessageBox(mainWindow!, {
          type: "info",
          title: "NFC Bridge läuft weiter",
          message: "Das Programm läuft im Hintergrund weiter.",
          detail: "Sie können es über das Tray-Icon in der Taskleiste vollständig beenden.",
          buttons: ["OK"]
        }).then(() => {
          mainWindow?.hide();
          hasShownCloseHint = true;
        });
      } else {
        mainWindow?.hide();
      }
    }
  });
}

/* =========================
   Tray
========================= */

function createTray() {
  trayIconOn = nativeImage.createFromPath(trayOnPath);
  trayIconOff = nativeImage.createFromPath(trayOffPath);

  tray = new Tray(bridgeEnabled ? trayIconOn : trayIconOff);
  tray.setToolTip("NFC Desktop Bridge");

  tray.on("click", () => {
    if (!mainWindow) return;
    mainWindow.isVisible() ? mainWindow.hide() : mainWindow.show();
  });

  updateTray();
}

function updateTray() {
  if (!tray) return;

  tray.setImage(bridgeEnabled ? trayIconOn : trayIconOff);

  tray.setContextMenu(
    Menu.buildFromTemplate([
      {
        label: bridgeEnabled ? "Disable NFC" : "Enable NFC",
        click: () => {
          bridgeEnabled = !bridgeEnabled;
          updateTray();
        }
      },
      { type: "separator" },
      {
        label: "Open Window",
        click: () => mainWindow?.show()
      },
      { type: "separator" },
      {
        label: "Quit",
        click: () => {
          isQuitting = true;
          server?.close();
          tray?.destroy();
          app.quit();
        }
      }
    ])
  );
}

/* =========================
   App Lifecycle
========================= */

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) app.quit();

app.whenReady().then(() => {
  createWindow();
  createTray();

  server = api.listen(PORT, "127.0.0.1", () => {
    console.log(`[HTTP] Bridge running on http://127.0.0.1:${PORT}`);
  });
});

app.on("window-all-closed", e => {
  e.preventDefault(); // bleibt im Tray
});
