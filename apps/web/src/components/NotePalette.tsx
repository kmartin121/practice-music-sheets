import { isRest, type Duration } from '../lib/score-model';

/** Drag types are readable during dragover (payloads are not), so flag pitched notes here. */
export const PITCHED_NOTE_MIME = 'application/x-note-palette-pitched';

const PALETTE: { label: string; duration: Duration }[] = [
  { label: 'Whole', duration: 'w' },
  { label: 'Half', duration: 'h' },
  { label: 'Quarter', duration: 'q' },
  { label: '8th', duration: '8' },
  { label: '16th', duration: '16' },
  { label: '32nd', duration: '32' },
  { label: 'Whole rest', duration: 'wr' },
  { label: 'Dotted half rest', duration: 'hdr' },
  { label: 'Half rest', duration: 'hr' },
  { label: 'Quarter rest', duration: 'qr' },
  { label: '8th rest', duration: '8r' },
  { label: '16th rest', duration: '16r' },
  { label: '32nd rest', duration: '32r' },
];

/** Palette entry for a note's value; dotted values without their own entry map to the undotted one. */
function paletteItemFor(duration: Duration): (typeof PALETTE)[number] | undefined {
  const exact = PALETTE.find((item) => item.duration === duration);
  if (exact) return exact;
  const undotted = duration.replace('d', '');
  return PALETTE.find((item) => item.duration === undotted);
}

/** Label of the palette button highlighted for a note of this value, if any. */
export function paletteLabelFor(duration: Duration): string | undefined {
  return paletteItemFor(duration)?.label;
}

type Props = {
  disabled?: boolean;
  /** Value of the selected note, highlighted in the palette. */
  selectedDuration?: Duration | null;
  /** Notes already dropped into the pending triplet; `null` when triplet entry is off. */
  tripletPlaced?: number | null;
  onToggleTriplet?: () => void;
};

export function NotePalette({
  disabled,
  selectedDuration = null,
  tripletPlaced = null,
  onToggleTriplet,
}: Props) {
  const tripletOn = tripletPlaced !== null;
  const highlighted = selectedDuration ? paletteItemFor(selectedDuration)?.duration : undefined;
  return (
    <div className="note-palette" data-testid="note-palette" aria-label="Note palette">
      <span className="palette-label">Drag notes</span>
      {PALETTE.map((item) => (
        <button
          key={item.duration}
          type="button"
          className={`palette-item ${item.duration === highlighted ? 'is-selected' : ''}`}
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
      {onToggleTriplet && (
        <button
          type="button"
          className={`btn palette-toggle ${tripletOn ? 'active' : ''}`}
          disabled={disabled}
          onClick={onToggleTriplet}
          aria-pressed={tripletOn}
          data-testid="triplet-toggle"
          title="Mark the next three dropped notes as a triplet"
        >
          {tripletOn ? `Triplet ${tripletPlaced}/3` : 'Triplet'}
        </button>
      )}
      <span className="palette-hint" data-testid="palette-hint">
        {tripletOn
          ? `Drag ${3 - (tripletPlaced ?? 0)} more note${tripletPlaced === 2 ? '' : 's'} onto the staff to finish the triplet`
          : 'Drop onto a note to stack a chord'}
      </span>
    </div>
  );
}
