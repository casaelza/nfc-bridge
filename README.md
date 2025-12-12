# NFC Desktop Bridge

Dies ist eine Electron-Anwendung, die als Brücke zwischen einem lokal angeschlossenen NFC-Lesegerät (PC/SC) und Webanwendungen dient. Sie stellt eine lokale HTTP-Schnittstelle bereit, um NFC-Karten (UIDs) auszulesen.

## Funktionen

*   **Hardware-Support**: Unterstützt gängige PC/SC-Reader wie den ACR122U.
*   **Tag-Kompatibilität**: Liest UID von ISO 14443-3 (Mifare Classic, Ultralight) und ISO 14443-4 (Desfire, Kreditkarten) Tags.
    *   *Hinweis*: Für ISO 14443-4 Tags wird die automatische Verarbeitung deaktiviert, um Fehler bei der Applikationsauswahl (AID) zu vermeiden. Die UID wird direkt ausgelesen.
*   **Hintergrund-Betrieb**: Läuft im System-Tray minimiert weiter.
*   **HTTP-API**: Einfache Integration in Web-Apps (kein Browser-Plugin nötig).

## Installation & Start

Voraussetzungen: Node.js installiert.

1.  Abhängigkeiten installieren:
    ```bash
    npm install
    ```

2.  Entwicklungsmodus starten:
    ```bash
    npm run dev
    ```

3.  Produktions-Build erstellen:
    ```bash
    npm run build
    ```
    Die ausführbare Datei befindet sich anschließend im `dist`-Ordner.

## Verwendung

Nach dem Start läuft die Anwendung auf Port `3333` (Standard).
Ein Fenster zeigt den aktuellen Status (Verbunder Reader, Karte aufliegend, etc.).

**Schließen**: Wenn Sie das Fenster schließen, läuft die Anwendung im Hintergrund weiter (sichtbar im System-Tray / Taskleiste). Um sie vollständig zu beenden, nutzen Sie `Rechtsklick auf Tray-Icon -> Quit`.

## HTTP API Dokumentation

Die Bridge stellt folgende Endpunkte unter `http://127.0.0.1:3333` bereit:

### 1. Status abrufen
`GET /api/health`

Gibt den aktuellen Status der Bridge zurück.

**Beispiel-Response:**
```json
{
  "enabled": true,
  "readerReady": true,
  "reader": "ACS ACR122U 0",
  "lastUID": "04A1B2C3",
  "cardPresent": true,
  "port": 3333
}
```

### 2. Auf NFC-Scan warten
`POST /api/nfc/wait`

Wartet auf das Auflegen einer Karte.
*   **Timeout**: 5 Sekunden.
*   **Verhalten**:
    *   Wenn bereits eine Karte aufliegt, wird die UID *sofort* zurückgegeben.
    *   Wenn keine Karte aufliegt, wartet der Server bis zu 5 Sekunden.
    *   Bei Timeout wird ein 408 Fehler zurückgegeben.

**Beispiel-Response (Erfolg):**
```json
{ "uid": "04E428028D5E80" }
```

**Beispiel-Fehler (Timeout):**
```json
{ "error": "timeout" }
```

### Frontend Integration (Beispiel)

Hier ist ein Beispiel, wie man die Bridge in einer Webanwendung (z.B. React/TypeScript) integriert:

```typescript
async function handleNfcLogin() {
  try {
    // 1. Benutzer informieren
    console.log("Bitte Karte auflegen...");
    
    // 2. Anfrage an Bridge senden (wartet max. 5 Sek.)
    const response = await fetch('http://127.0.0.1:3333/api/nfc/wait', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' }
    });

    if (!response.ok) {
      if (response.status === 408) throw new Error("Zeitüberschreitung - Keine Karte gefunden");
      throw new Error(`Bridge Fehler: ${response.status}`);
    }

    // 3. UID erhalten
    const data = await response.json();
    console.log("Karte erkannt! UID:", data.uid);
    
    return data.uid;

  } catch (error) {
    console.error("Login fehlgeschlagen:", error.message);
    alert("Fehler: " + error.message);
  }
}
```

### 3. Bridge an/ausschalten
`POST /api/bridge/toggle`

Deaktiviert oder aktiviert die Verarbeitung von NFC-Events temporär.

## Fehlerbehebung

*   **Fehler "AID not set"**: Dies wurde behoben, indem ISO 14443-4 Tags manuell ohne AID-Selektion gelesen werden.
*   **Kein Reader gefunden**: Stellen Sie sicher, dass der Treiber für den ACR122U installiert ist und das Gerät angeschlossen ist.