import { useCallback, useEffect, useState } from 'react';
import {
  isFileSystemAccessSupported,
  listMusicSheets,
  loadPersistedDirectoryHandle,
  openDirectory,
  persistDirectoryHandle,
  readSheetText,
  type SheetFile,
} from '../lib/file-system';
import { createBlankScore } from '../lib/score-model';
import { parseMusicXml } from '../lib/musicxml-parse';
import type { Score } from '../lib/score-model';
import type { OpenMeta } from '../App';

const OMR_URL = import.meta.env.VITE_OMR_URL ?? '';

type Props = {
  onOpenScore: (score: Score, meta: OpenMeta) => void;
  directory: FileSystemDirectoryHandle | null;
  onDirectoryChange: (dir: FileSystemDirectoryHandle | null) => void;
};

export function Library({ onOpenScore, directory, onDirectoryChange }: Props) {
  const [sheets, setSheets] = useState<SheetFile[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [omrBusy, setOmrBusy] = useState(false);
  const supported = isFileSystemAccessSupported();

  const refresh = useCallback(async (dir: FileSystemDirectoryHandle) => {
    const list = await listMusicSheets(dir);
    setSheets(list);
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (directory) {
        await refresh(directory);
        return;
      }
      const persisted = await loadPersistedDirectoryHandle();
      if (!cancelled && persisted) {
        onDirectoryChange(persisted);
        await refresh(persisted);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [directory, onDirectoryChange, refresh]);

  async function handleOpenFolder() {
    setError(null);
    try {
      const dir = await openDirectory();
      await persistDirectoryHandle(dir);
      onDirectoryChange(dir);
      await refresh(dir);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not open folder');
    }
  }

  function handleNewBlank() {
    const score = createBlankScore({ title: 'New Melody', measureCount: 4 });
    onOpenScore(score, { filename: null, fileHandle: null, dir: directory });
  }

  async function handleOpenSheet(sheet: SheetFile) {
    setError(null);
    try {
      const text = await readSheetText(sheet.handle);
      const score = parseMusicXml(text);
      onOpenScore(score, {
        filename: sheet.name,
        fileHandle: sheet.handle,
        dir: directory,
        sourceXml: text,
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to open sheet');
    }
  }

  async function handleImportScan(file: File) {
    setError(null);
    setOmrBusy(true);
    try {
      const body = new FormData();
      body.append('file', file);
      let res: Response;
      try {
        res = await fetch(`${OMR_URL}/omr`, { method: 'POST', body });
      } catch {
        throw new Error(
          'Cannot reach the OMR sidecar. In another terminal run: npm run dev:omr',
        );
      }
      if (!res.ok) {
        const msg = await res.text();
        throw new Error(msg || `OMR failed (${res.status})`);
      }
      const xml = await res.text();
      const score = parseMusicXml(xml);
      if (!score.title || score.title === 'Untitled') {
        score.title = file.name.replace(/\.[^.]+$/, '');
      }
      onOpenScore(score, {
        filename: null,
        fileHandle: null,
        dir: directory,
        sourceXml: xml,
        fromOmr: true,
      });
    } catch (e) {
      setError(
        e instanceof Error
          ? e.message
          : 'OMR request failed. Is the local OMR sidecar running on port 8787?',
      );
    } finally {
      setOmrBusy(false);
    }
  }

  async function handleOpenFixtureFile(file: File) {
    setError(null);
    try {
      const text = await file.text();
      const score = parseMusicXml(text);
      onOpenScore(score, {
        filename: file.name,
        fileHandle: null,
        dir: directory,
        sourceXml: text,
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to open file');
    }
  }

  return (
    <div className="library" data-testid="library">
      <div className="library-hero">
        <p className="brand">Practice Music Sheets</p>
        <h1>Your local melody library</h1>
        <p className="lede">
          Open a folder, import a scan, or start a blank staff — all notation is built as digital
          bars and notes, not an image.
        </p>
        <div className="library-actions">
          <button type="button" className="btn primary" onClick={handleOpenFolder} disabled={!supported}>
            Open folder
          </button>
          <button type="button" className="btn" onClick={handleNewBlank} data-testid="new-blank">
            New blank sheet
          </button>
          <label className="btn file-btn">
            Import scan
            <input
              type="file"
              accept="image/png,image/jpeg,application/pdf,.png,.jpg,.jpeg,.pdf"
              hidden
              disabled={omrBusy}
              data-testid="import-scan"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) void handleImportScan(f);
                e.target.value = '';
              }}
            />
          </label>
          <label className="btn file-btn ghost">
            Open MusicXML file
            <input
              type="file"
              accept=".musicxml,.xml,.mxl,application/xml,text/xml"
              hidden
              data-testid="open-musicxml-file"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) void handleOpenFixtureFile(f);
                e.target.value = '';
              }}
            />
          </label>
        </div>
        {!supported && (
          <p className="warn">Folder access needs Chrome or Edge. You can still open a MusicXML file.</p>
        )}
        {omrBusy && <p className="status">Converting scan with Audiveris…</p>}
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
      </div>

      <section className="sheet-list">
        <h2>{directory ? `Sheets in ${directory.name}` : 'No folder open'}</h2>
        {sheets.length === 0 ? (
          <p className="muted">MusicXML files in the granted folder will appear here.</p>
        ) : (
          <ul>
            {sheets.map((sheet) => (
              <li key={sheet.name}>
                <button type="button" className="sheet-link" onClick={() => void handleOpenSheet(sheet)}>
                  {sheet.name}
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
