export type Duration = 'w' | 'h' | 'q' | '8' | '16' | 'wr' | 'hr' | 'qr' | '8r' | '16r';

export type Accidental = 'sharp' | 'flat' | 'natural';

/** MusicXML notehead shapes we render (drum “x” heads, etc.). */
export type Notehead = 'normal' | 'x' | 'diamond' | 'slash' | 'triangle';

export type ChordTone = {
  pitch: string;
  octave: number;
  accidental?: Accidental;
  notehead?: Notehead;
};

export type Note = {
  id: string;
  pitch: string;
  octave: number;
  duration: Duration;
  accidental?: Accidental;
  notehead?: Notehead;
  /** Extra simultaneous pitches from MusicXML `<chord/>` tones. */
  chord?: ChordTone[];
};

export type Measure = {
  id: string;
  notes: Note[];
  /** Optional MusicXML/engraving width hint (pixels-ish). */
  width?: number;
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

/**
 * Push notes that exceed each bar's time-signature capacity into following bars
 * (creating new bars as needed). Keeps inserts from cramming past the barline.
 */
export function reflowOverflow(score: Score): Score {
  const capacity = measureBeatCapacity(score);
  const measures: Measure[] = score.measures.map((measure) => ({
    ...measure,
    notes: [...measure.notes],
  }));

  for (let i = 0; i < measures.length; i += 1) {
    let filled = 0;
    let splitAt = measures[i].notes.length;
    for (let n = 0; n < measures[i].notes.length; n += 1) {
      const next = filled + durationBeats(measures[i].notes[n].duration);
      if (next > capacity + 1e-9) {
        splitAt = n;
        break;
      }
      filled = next;
    }
    if (splitAt >= measures[i].notes.length) continue;

    const overflow = measures[i].notes.slice(splitAt);
    measures[i] = { ...measures[i], notes: measures[i].notes.slice(0, splitAt) };
    if (i + 1 < measures.length) {
      measures[i + 1] = {
        ...measures[i + 1],
        notes: [...overflow, ...measures[i + 1].notes],
      };
    } else {
      measures.push({ id: createId('measure'), notes: overflow });
    }
  }

  return { ...score, measures };
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

/** Move a note to another measure / pitch, preserving duration and modifiers. */
export function relocateNote(
  score: Score,
  noteId: string,
  toMeasureId: string,
  pitch: string,
  octave: number,
  index?: number,
): Score {
  let found: Note | undefined;
  let fromMeasureId: string | undefined;
  let fromIndex = -1;
  const stripped: Score = {
    ...score,
    measures: score.measures.map((measure) => {
      const noteIndex = measure.notes.findIndex((n) => n.id === noteId);
      if (noteIndex < 0) return measure;
      found = measure.notes[noteIndex];
      fromMeasureId = measure.id;
      fromIndex = noteIndex;
      return { ...measure, notes: measure.notes.filter((n) => n.id !== noteId) };
    }),
  };
  if (!found) return score;

  let insertAt = index;
  if (
    insertAt !== undefined &&
    fromMeasureId === toMeasureId &&
    fromIndex >= 0 &&
    insertAt > fromIndex
  ) {
    // Account for removal shifting later indices left by one.
    insertAt -= 1;
  }

  return addNoteToMeasure(stripped, toMeasureId, {
    ...found,
    pitch,
    octave,
    id: noteId,
  }, insertAt);
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
