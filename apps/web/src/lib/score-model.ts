export type Duration = 'w' | 'h' | 'q' | '8' | '16' | 'wr' | 'hr' | 'qr' | '8r' | '16r';

export type Accidental = 'sharp' | 'flat' | 'natural';

export type Note = {
  id: string;
  pitch: string;
  octave: number;
  duration: Duration;
  accidental?: Accidental;
};

export type Measure = {
  id: string;
  notes: Note[];
};

export type TimeSignature = {
  beats: number;
  beatType: number;
};

export type Score = {
  title: string;
  clef: 'treble' | 'bass';
  keySignature: string;
  timeSignature: TimeSignature;
  measures: Measure[];
};

const DURATION_BEATS: Record<Duration, number> = {
  w: 4,
  h: 2,
  q: 1,
  '8': 0.5,
  '16': 0.25,
  wr: 4,
  hr: 2,
  qr: 1,
  '8r': 0.5,
  '16r': 0.25,
};

export function isRest(duration: Duration): boolean {
  return duration.endsWith('r');
}

export function durationBeats(duration: Duration): number {
  return DURATION_BEATS[duration];
}

export function createId(prefix = 'id'): string {
  return `${prefix}-${crypto.randomUUID()}`;
}

export function createBlankScore(options?: {
  title?: string;
  clef?: Score['clef'];
  keySignature?: string;
  timeSignature?: TimeSignature;
  measureCount?: number;
}): Score {
  const measureCount = options?.measureCount ?? 4;
  return {
    title: options?.title ?? 'Untitled',
    clef: options?.clef ?? 'treble',
    keySignature: options?.keySignature ?? 'C',
    timeSignature: options?.timeSignature ?? { beats: 4, beatType: 4 },
    measures: Array.from({ length: measureCount }, () => ({
      id: createId('measure'),
      notes: [],
    })),
  };
}

export function measureBeatCapacity(score: Score): number {
  const { beats, beatType } = score.timeSignature;
  return beats * (4 / beatType);
}

export function measureFilledBeats(measure: Measure): number {
  return measure.notes.reduce((sum, note) => sum + durationBeats(note.duration), 0);
}

export function measureOverflows(score: Score, measure: Measure): boolean {
  return measureFilledBeats(measure) > measureBeatCapacity(score) + 1e-9;
}

export function addNoteToMeasure(
  score: Score,
  measureId: string,
  note: Omit<Note, 'id'> & { id?: string },
  index?: number,
): Score {
  return {
    ...score,
    measures: score.measures.map((measure) => {
      if (measure.id !== measureId) return measure;
      const nextNote: Note = { ...note, id: note.id ?? createId('note') };
      const notes = [...measure.notes];
      if (index === undefined || index < 0 || index > notes.length) {
        notes.push(nextNote);
      } else {
        notes.splice(index, 0, nextNote);
      }
      return { ...measure, notes };
    }),
  };
}

export function removeNote(score: Score, noteId: string): Score {
  return {
    ...score,
    measures: score.measures.map((measure) => ({
      ...measure,
      notes: measure.notes.filter((note) => note.id !== noteId),
    })),
  };
}

export function updateScoreMeta(
  score: Score,
  patch: Partial<Pick<Score, 'title' | 'clef' | 'keySignature' | 'timeSignature'>>,
): Score {
  return { ...score, ...patch };
}

export function addEmptyMeasure(score: Score): Score {
  return {
    ...score,
    measures: [...score.measures, { id: createId('measure'), notes: [] }],
  };
}
