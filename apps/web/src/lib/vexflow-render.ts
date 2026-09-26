import type { Duration, Note, Notehead, Score } from './score-model';
import { durationBeats, isRest } from './score-model';

/** Pure helpers that map Score → VexFlow-friendly render instructions. */

export type RenderGraceNote = {
  keys: string[];
  duration: string;
  accidental?: string;
  slash?: boolean;
};

export type RenderNote = {
  id: string;
  keys: string[];
  duration: string;
  accidental?: string;
  isRest: boolean;
  /** Augmentation dots to the right of the notehead/rest (e.g. dotted half). */
  dots?: number;
  grace?: RenderGraceNote[];
};

/** Inclusive note-index range drawn under one tuplet bracket. */
export type TupletGroup = {
  start: number;
  end: number;
  actual: number;
  normal: number;
};

export type RenderMeasure = {
  id: string;
  notes: RenderNote[];
  hidden: boolean;
  width?: number;
  tuplets: TupletGroup[];
};

export type RenderScore = {
  title: string;
  clef: 'treble' | 'bass';
  keySignature: string;
  timeSignature: string;
  measures: RenderMeasure[];
};

const DURATION_TO_VF: Record<Duration, string> = {
  w: 'w',
  h: 'h',
  hd: 'hd',
  q: 'q',
  qd: 'qd',
  '8': '8',
  '8d': '8d',
  '16': '16',
  '32': '32',
  wr: 'wr',
  hr: 'hr',
  hdr: 'hdr',
  qr: 'qr',
  qdr: 'qdr',
  '8r': '8r',
  '8dr': '8dr',
  '16r': '16r',
  '32r': '32r',
};

const ACCIDENTAL_TO_VF: Record<string, string> = {
  sharp: '#',
  flat: 'b',
  natural: 'n',
};

/** VexFlow per-key notehead codes (appended as pitch/octave/code). */
const NOTEHEAD_TO_VF: Record<Notehead, string | undefined> = {
  normal: undefined,
  x: 'x',
  diamond: 'd',
  slash: 's',
  triangle: 'tu',
};

export function pitchToVexKey(
  pitch: string,
  octave: number,
  accidental?: string,
  notehead?: Notehead,
): string {
  const acc = accidental ? ACCIDENTAL_TO_VF[accidental] ?? '' : '';
  const base = `${pitch.toLowerCase()}${acc}/${octave}`;
  const code = notehead ? NOTEHEAD_TO_VF[notehead] : undefined;
  return code ? `${base}/${code}` : base;
}

export function durationToVex(duration: Duration): string {
  return DURATION_TO_VF[duration];
}

/** Count augmentation dots encoded in our duration codes (`hd` / `hdr` → 1). */
export function durationDots(duration: Duration): number {
  const bare = duration.replace(/r$/, '');
  const match = /d+$/.exec(bare);
  return match ? match[0].length : 0;
}

/**
 * Group consecutive tuplet notes into brackets. Source start/stop markers win;
 * without them a group closes once it spans `actual` notes of its first value.
 */
export function tupletGroups(notes: ReadonlyArray<Pick<Note, 'duration' | 'tuplet'>>): TupletGroup[] {
  const groups: TupletGroup[] = [];
  let open: (TupletGroup & { flagged: boolean; written: number; unit: number }) | null = null;

  const close = (end: number) => {
    if (!open) return;
    groups.push({ start: open.start, end, actual: open.actual, normal: open.normal });
    open = null;
  };

  for (let i = 0; i < notes.length; i += 1) {
    const tuplet = notes[i].tuplet;
    if (
      open &&
      (!tuplet ||
        tuplet.actual !== open.actual ||
        tuplet.normal !== open.normal ||
        tuplet.start)
    ) {
      close(i - 1);
    }
    if (!tuplet) continue;

    const written = durationBeats(notes[i].duration);
    if (!open) {
      open = {
        start: i,
        end: i,
        actual: tuplet.actual,
        normal: tuplet.normal,
        flagged: Boolean(tuplet.start),
        written: 0,
        unit: written,
      };
    }
    open.written += written;
    if (tuplet.stop || (!open.flagged && open.written >= open.actual * open.unit - 1e-9)) {
      close(i);
    }
  }
  close(notes.length - 1);
  return groups;
}

/** Map Y offset within a staff (top=0) to nearest pitch for treble/bass. */
export function yToPitch(
  y: number,
  staffTop: number,
  lineSpacing: number,
  clef: 'treble' | 'bass',
): { pitch: string; octave: number } {
  // Treble: top line F5, each step (line/space) is 0.5 lineSpacing down.
  // Bass: top line A3.
  const stepsFromTop = Math.round((y - staffTop) / (lineSpacing / 2));
  const treble = ['F', 'E', 'D', 'C', 'B', 'A', 'G', 'F', 'E', 'D', 'C', 'B', 'A', 'G', 'F'];
  const trebleOct = [5, 5, 5, 5, 4, 4, 4, 4, 4, 4, 4, 3, 3, 3, 3];
  const bass = ['A', 'G', 'F', 'E', 'D', 'C', 'B', 'A', 'G', 'F', 'E', 'D', 'C', 'B', 'A'];
  const bassOct = [3, 3, 3, 3, 3, 3, 2, 2, 2, 2, 2, 2, 2, 1, 1];
  const pitches = clef === 'treble' ? treble : bass;
  const octaves = clef === 'treble' ? trebleOct : bassOct;
  const idx = Math.min(Math.max(stepsFromTop, 0), pitches.length - 1);
  return { pitch: pitches[idx], octave: octaves[idx] };
}

/** Snap a local Y to the nearest staff line/space (for drop guides). */
export function snapStaffY(y: number, staffTop: number, lineSpacing: number): number {
  const step = lineSpacing / 2;
  const maxSteps = 14; // matches yToPitch pitch tables
  const steps = Math.round((y - staffTop) / step);
  const clamped = Math.min(Math.max(steps, 0), maxSteps);
  return staffTop + clamped * step;
}

export function scoreToRenderInstructions(
  score: Score,
  hiddenMeasureIds: ReadonlySet<string> = new Set(),
): RenderScore {
  return {
    title: score.title,
    clef: score.clef,
    keySignature: score.keySignature,
    timeSignature: `${score.timeSignature.beats}/${score.timeSignature.beatType}`,
    measures: score.measures.map((measure) => ({
      id: measure.id,
      hidden: hiddenMeasureIds.has(measure.id),
      width: measure.width,
      tuplets: tupletGroups(measure.notes),
      notes: measure.notes.map((note) => {
        const dots = durationDots(note.duration);
        return {
          id: note.id,
          keys: isRest(note.duration)
            ? [score.clef === 'bass' ? 'd/3' : 'b/4']
            : [
                pitchToVexKey(note.pitch, note.octave, note.accidental, note.notehead),
                ...(note.chord ?? []).map((tone) =>
                  pitchToVexKey(tone.pitch, tone.octave, tone.accidental, tone.notehead),
                ),
              ],
          duration: durationToVex(note.duration),
          accidental: note.accidental ? ACCIDENTAL_TO_VF[note.accidental] : undefined,
          isRest: isRest(note.duration),
          ...(dots > 0 ? { dots } : {}),
          ...(note.grace && note.grace.length > 0
            ? {
                grace: note.grace.map((g) => ({
                  keys: [pitchToVexKey(g.pitch, g.octave, g.accidental, g.notehead)],
                  duration: durationToVex(g.duration),
                  accidental: g.accidental ? ACCIDENTAL_TO_VF[g.accidental] : undefined,
                  ...(g.slash ? { slash: true } : {}),
                })),
              }
            : {}),
        };
      }),
    })),
  };
}
