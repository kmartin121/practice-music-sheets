import type { Duration } from '../lib/score-model';

const PALETTE: { label: string; duration: Duration }[] = [
  { label: '𝅝', duration: 'w' },
  { label: '𝅗𝅥', duration: 'h' },
  { label: '♩', duration: 'q' },
  { label: '♪', duration: '8' },
  { label: '𝅘𝅥𝅯', duration: '16' },
  { label: '𝄽', duration: 'wr' },
  { label: '𝄾', duration: 'hr' },
  { label: ' comp', duration: 'qr' },
  { label: ' contrap', duration: '8r' },
  { label: '16r', duration: '16r' },
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
          title={item.duration}
          data-duration={item.duration}
          onDragStart={(e) => {
            e.dataTransfer.setData(
              'application/x-note-palette',
              JSON.stringify({ duration: item.duration }),
            );
            e.dataTransfer.effectAllowed = 'copy';
          }}
        >
          {item.label}
        </button>
      ))}
    </div>
  );
}
