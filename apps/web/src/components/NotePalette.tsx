import { isRest, type Duration } from '../lib/score-model';

/** Drag types are readable during dragover (payloads are not), so flag pitched notes here. */
export const PITCHED_NOTE_MIME = 'application/x-note-palette-pitched';

const PALETTE: { label: string; duration: Duration }[] = [
  { label: 'Whole', duration: 'w' },
  { label: 'Half', duration: 'h' },
  { label: 'Quarter', duration: 'q' },
  { label: '8th', duration: '8' },
  { label: '16th', duration: '16' },
  { label: 'Whole rest', duration: 'wr' },
  { label: 'Dotted half rest', duration: 'hdr' },
  { label: 'Half rest', duration: 'hr' },
  { label: 'Quarter rest', duration: 'qr' },
  { label: '8th rest', duration: '8r' },
  { label: '16th rest', duration: '16r' },
];

type Props = {
  disabled?: boolean;
};

export function NotePalette({ disabled }: Props) {
  return (
    <div className="note-palette" data-testid="note-palette" aria-label="Note palette">
      <span className="palette-label">Drag notes</span>
      {PALETTE.map((item) => (
        <button
          key={item.duration}
          type="button"
          className="palette-item"
          draggable={!disabled}
          disabled={disabled}
          title={item.label}
          data-duration={item.duration}
          onDragStart={(e) => {
            e.dataTransfer.setData(
              'application/x-note-palette',
              JSON.stringify({ duration: item.duration }),
            );
            if (!isRest(item.duration)) e.dataTransfer.setData(PITCHED_NOTE_MIME, '1');
            e.dataTransfer.effectAllowed = 'copy';
            document.body.classList.add('palette-dragging');
          }}
          onDragEnd={() => {
            document.body.classList.remove('palette-dragging');
          }}
        >
          {item.label}
        </button>
      ))}
      <span className="palette-hint">Drop onto a note to stack a chord</span>
    </div>
  );
}
