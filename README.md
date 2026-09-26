# Practice Music Sheets

Local-first app for turning scanned melody sheets into editable digital MusicXML, practicing with hidden bars, and printing.

## Features (v1)

- Open a local folder (Chrome/Edge File System Access API) and list `.musicxml` / `.mxl` files
- Import a scan (PNG/JPEG/PDF) via a hardened local Audiveris OMR sidecar → review MusicXML in the editor
- Blank single-line staff with drag-from-palette notes
- Practice mode: click a bar to hide notes behind a color rectangle
- Print stylesheet for clean paper output
- Save / Save as MusicXML into the granted folder

## Requirements

- Node.js 22+
- Chrome or Edge for folder access (you can still open a MusicXML file in other browsers)
- [Audiveris](https://github.com/Audiveris/audiveris) installed for scan conversion (optional if you only use MusicXML / blank sheets)

## Setup

```bash
npm install
```

Install Playwright browsers once (for e2e):

```bash
cd apps/web && npx playwright install chromium
```

### Audiveris

Install Audiveris so its binary is on your `PATH`, or set:

```bash
export AUDIVERIS_BIN="/Applications/Audiveris.app/Contents/MacOS/Audiveris"
```

**macOS (Apple Silicon):** download `Audiveris-*-macosx-arm64.dmg` from the [Audiveris releases](https://github.com/Audiveris/audiveris/releases), open the DMG, drag `Audiveris.app` into Applications. On first launch you may need **System Settings → Privacy & Security → Open Anyway**.

`npm run dev:omr` defaults `AUDIVERIS_BIN` to `/Applications/Audiveris.app/Contents/MacOS/Audiveris` when unset.

**OCR languages (optional):** Audiveris may log `No installed OCR languages`. That mainly affects titles/lyrics, not note pitches. Install Tesseract English data if you want text recognition (e.g. `brew install tesseract` on macOS).

**Scan tips:** Prefer a single-page, high-resolution, high-contrast crop. Audiveris sometimes splits one image into multiple movements (`*.mvt1.mxl`, `*.mvt2.mxl`); the sidecar merges those into one MusicXML score.

**Grace notes / drum X-heads:** The sidecar enables Audiveris book switches `smallHeads`, `crossHeads`, and `drumNotation` in batch mode. Without `smallHeads`, Audiveris skips the CUE_BEAMS step and usually omits grace/acciaccatura notes from MusicXML. Even with the switch on, poor scan quality can still miss tiny heads—review the MusicXML panel if a flam or crushed note is absent.

## Run

Terminal 1 — web app:

```bash
npm run dev
```

Terminal 2 — OMR sidecar (loopback only):

```bash
npm run dev:omr
```

Open http://localhost:5173 and grant access to the repo `sheets/` folder (or any folder of MusicXML files).

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
