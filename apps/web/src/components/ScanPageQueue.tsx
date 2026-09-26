import { useId } from 'react';
import type { ScanPage } from '../lib/scan-page-queue';

type Props = {
  pages: ScanPage[];
  busy: boolean;
  progress: string | null;
  onAddFiles: (files: FileList | File[]) => void;
  onMove: (id: string, direction: -1 | 1) => void;
  onRemove: (id: string) => void;
  onClear: () => void;
  onBuild: () => void;
};

const ACCEPT = 'image/png,image/jpeg,application/pdf,.png,.jpg,.jpeg,.pdf';

export function ScanPageQueue({
  pages,
  busy,
  progress,
  onAddFiles,
  onMove,
  onRemove,
  onClear,
  onBuild,
}: Props) {
  const addInputId = useId();

  return (
    <section className="scan-queue" data-testid="scan-queue">
      <div className="scan-queue-header">
        <h2>Scan pages</h2>
        <p className="muted">
          Add photos in page order, reorder if needed, then build one score.
        </p>
      </div>

      {pages.length > 0 && (
        <ol className="scan-queue-list">
          {pages.map((page, index) => (
            <li key={page.id} className="scan-queue-item">
              {page.previewUrl ? (
                <img
                  className="scan-queue-thumb"
                  src={page.previewUrl}
                  alt=""
                  width={48}
                  height={48}
                />
              ) : (
                <span className="scan-queue-thumb scan-queue-thumb-fallback" aria-hidden>
                  PDF
                </span>
              )}
              <div className="scan-queue-meta">
                <span className="scan-queue-index">Page {index + 1}</span>
                <span className="scan-queue-name" title={page.file.name}>
                  {page.file.name}
                </span>
              </div>
              <div className="scan-queue-item-actions">
                <button
                  type="button"
                  className="btn ghost"
                  disabled={busy || index === 0}
                  aria-label={`Move ${page.file.name} up`}
                  onClick={() => onMove(page.id, -1)}
                >
                  Up
                </button>
                <button
                  type="button"
                  className="btn ghost"
                  disabled={busy || index === pages.length - 1}
                  aria-label={`Move ${page.file.name} down`}
                  onClick={() => onMove(page.id, 1)}
                >
                  Down
                </button>
                <button
                  type="button"
                  className="btn ghost"
                  disabled={busy}
                  aria-label={`Remove ${page.file.name}`}
                  onClick={() => onRemove(page.id)}
                >
                  Remove
                </button>
              </div>
            </li>
          ))}
        </ol>
      )}

      <div className="scan-queue-actions">
        <label className="btn file-btn" htmlFor={addInputId}>
          Add pages
          <input
            id={addInputId}
            type="file"
            accept={ACCEPT}
            multiple
            hidden
            disabled={busy}
            data-testid="scan-queue-add"
            onChange={(e) => {
              if (e.target.files?.length) onAddFiles(e.target.files);
              e.target.value = '';
            }}
          />
        </label>
        <button
          type="button"
          className="btn primary"
          disabled={busy || pages.length === 0}
          data-testid="scan-queue-build"
          onClick={onBuild}
        >
          Build score
        </button>
        <button
          type="button"
          className="btn ghost"
          disabled={busy}
          data-testid="scan-queue-clear"
          onClick={onClear}
        >
          Clear
        </button>
      </div>

      {progress && (
        <p className="status" data-testid="scan-queue-progress">
          {progress}
        </p>
      )}
    </section>
  );
}
