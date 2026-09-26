import type { Duration, Notehead, Score } from './score-model';
import { isRest } from './score-model';

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
  grace?: RenderGraceNote[];
};

export type RenderMeasure = {
  id: string;
  notes: RenderNote[];
  hidden: boolean;
  width?: number;
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
  q: 'q',
  '8': '8',
  '16': '16',
  wr: 'wr',
  hr: 'hr',
  qr: 'qr',
  '8r': '8r',
  '16r': '16r',
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
      notes: measure.notes.map((note) => ({
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
      })),
    })),
  };
}
