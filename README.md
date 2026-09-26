# Practice Music Sheets

Local-first app for turning scanned melody sheets into editable digital MusicXML, practicing with hidden bars, and printing.

## Features (v1)

- Open a local folder (Chrome/Edge File System Access API) and list `.musicxml` / `.mxl` files
- Import a scan (PNG/JPEG/PDF) — or a queue of pages — via a hardened local Audiveris OMR sidecar → review MusicXML in the editor
- Blank single-line staff with drag-from-palette notes
- Practice mode: click a bar to hide notes behind a color rectangle
- Print stylesheet for clean paper output
- Save / Save as MusicXML into the granted folder

## Requirements

- [Node.js](https://nodejs.org/) 22+
- Git
- Chrome or Edge for folder access (you can still open a MusicXML file in other browsers)
- [Audiveris](https://github.com/Audiveris/audiveris) only if you want scan → MusicXML conversion (optional for MusicXML / blank sheets)

## Setup (macOS and Windows)

1. Clone this repo and open a terminal in the project root.
2. Install dependencies:

```bash
npm install
```

`npm install` also downloads the Playwright Chromium build used by the e2e tests. If you skip install scripts (or the download fails), install it manually:

```bash
cd apps/web && npx playwright install chromium
```

On Windows, use PowerShell, Command Prompt, or Windows Terminal. On macOS, use Terminal or iTerm.

## Run the web app

From the project root:

```bash
npm run dev
```

Open http://localhost:5173 and grant access to the repo `sheets/` folder (or any folder of MusicXML files).

That is enough for opening MusicXML, blank staff editing, practice mode, and print. No Audiveris needed.

## Optional: scan import (OMR sidecar)

Scan import needs a second process (the OMR sidecar on `127.0.0.1:8787`) plus Audiveris installed locally. Use **two terminals**: one for the web app (`npm run dev`) and one for the sidecar (`npm run dev:omr`).

> Note: `npm run dev:all` starts both with a Unix `&` background job and is not reliable on Windows. Prefer two terminals on both platforms.

### Install Audiveris

Download from [Audiveris releases](https://github.com/Audiveris/audiveris/releases).

**macOS**

- Apple Silicon: `Audiveris-*-macosx-arm64.dmg`
- Intel: `Audiveris-*-macosx-x86_64.dmg`
- Open the DMG and drag `Audiveris.app` into Applications
- On first launch you may need **System Settings → Privacy & Security → Open Anyway**
- Default binary: `/Applications/Audiveris.app/Contents/MacOS/Audiveris`

**Windows**

- Installer: `Audiveris-*-windows-x86_64.msi`, or `winget install Audiveris`
- Typical binary: `C:\Program Files\Audiveris\Audiveris.exe`

### Point the sidecar at Audiveris

The sidecar looks for `AUDIVERIS_BIN`, then `Audiveris` on your `PATH`, then the macOS app path above.

**macOS (Terminal):**

```bash
export AUDIVERIS_BIN="/Applications/Audiveris.app/Contents/MacOS/Audiveris"
npm run dev:omr
```

**Windows (PowerShell):**

```powershell
$env:AUDIVERIS_BIN="C:\Program Files\Audiveris\Audiveris.exe"
npm run dev:omr
```

You can also add the Audiveris install folder to your `PATH` instead of setting `AUDIVERIS_BIN`.

### OCR languages (optional)

Audiveris may log `No installed OCR languages`. That mainly affects titles/lyrics, not note pitches.

- macOS: `brew install tesseract`
- Windows: install [Tesseract](https://github.com/UB-Mannheim/tesseract/wiki) (e.g. installer or Chocolatey) if you want text recognition

### Scan tips

Prefer high-resolution, high-contrast crops of each page. For multi-page sheets, use **Import scan** to queue several PNG/JPEG/PDF files, reorder them if needed, then **Build score**. Pages are converted one at a time (the sidecar only runs one OMR job at a time) and measures are stitched into a single score in page order.

Audiveris sometimes splits one image into multiple movements (`*.mvt1.mxl`, `*.mvt2.mxl`); the sidecar merges those into one MusicXML score before the app receives it.

**Grace notes / drum X-heads:** The sidecar enables Audiveris book switches `smallHeads`, `crossHeads`, and `drumNotation` in batch mode. Without `smallHeads`, Audiveris skips the CUE_BEAMS step and usually omits grace/acciaccatura notes from MusicXML. Even with the switch on, poor scan quality can still miss tiny heads—review the MusicXML panel if a flam or crushed note is absent.

## Security notes

The OMR sidecar is **localhost-only** (`127.0.0.1:8787`) and must not be exposed on a network.

- CORS allowlist: Vite origins only
- Upload allowlist: PNG, JPEG, PDF; max 20MB
- Audiveris invoked with `spawn` argv (no shell string)
- Temp files use random names and are deleted after each request
- Single concurrent OMR job; 120s timeout
- MusicXML parsing rejects DOCTYPE/ENTITY (XXE), oversized payloads, and malformed XML
- Folder writes only go through the browser File System Access permission the user grants

Phase 2 sharing will need a different authenticated design — do not publicly deploy this sidecar.

## Tests

```bash
npm test          # Vitest (web + omr-server)
npm run test:e2e  # Playwright smoke (mocked OMR)
npm run audit     # npm audit --audit-level=high
```

Real Audiveris conversion is a manual check on your machine after installing the binary.

## Project layout

```
apps/web          Vite + React editor
apps/omr-server   Local Audiveris wrapper
sheets/           Sample MusicXML folder
fixtures/         Test MusicXML + tiny PNG
```

## License

This project is licensed under the [MIT License](LICENSE).

[Audiveris](https://github.com/Audiveris/audiveris) is a separate program licensed under the [AGPL-3.0](https://github.com/Audiveris/audiveris/blob/master/LICENSE). It is not bundled with or included in this repository. You install it yourself, and the OMR sidecar runs it as an external process.
