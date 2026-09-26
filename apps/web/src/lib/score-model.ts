export type Duration =
  | 'w'
  | 'h'
  | 'hd'
  | 'q'
  | 'qd'
  | '8'
  | '8d'
  | '16'
  | '32'
  | 'wr'
  | 'hr'
  | 'hdr'
  | 'qr'
  | 'qdr'
  | '8r'
  | '8dr'
  | '16r'
  | '32r';

export type Accidental = 'sharp' | 'flat' | 'natural';

/** MusicXML notehead shapes we render (drum “x” heads, etc.). */
export type Notehead = 'normal' | 'x' | 'diamond' | 'slash' | 'triangle';

export type ChordTone = {
  pitch: string;
  octave: number;
  accidental?: Accidental;
  notehead?: Notehead;
};

/** Ornamental note attached before a principal note (does not consume measure beats). */
export type GraceTone = {
  id: string;
  pitch: string;
  octave: number;
  /** Visual duration only (MusicXML `<type>`); not counted in bar capacity. */
  duration: Duration;
  accidental?: Accidental;
  notehead?: Notehead;
  /** Acciaccatura when true (`<grace slash="yes"/>`); appoggiatura otherwise. */
  slash?: boolean;
};

/**
 * `actual` notes played in the time of `normal` (triplet = 3:2).
 * `start` / `stop` mark bracket boundaries when the source provided them.
 */
export type Tuplet = {
  actual: number;
  normal: number;
  start?: boolean;
  stop?: boolean;
};

export type Note = {
  id: string;
  pitch: string;
  octave: number;
  /** Written (visual) value; sounding length is scaled by `tuplet` when present. */
  duration: Duration;
  accidental?: Accidental;
  notehead?: Notehead;
  /** Extra simultaneous pitches from MusicXML `<chord/>` tones. */
  chord?: ChordTone[];
  /** Grace notes sounding immediately before this principal note. */
  grace?: GraceTone[];
  tuplet?: Tuplet;
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
  hd: 3,
  q: 1,
  qd: 1.5,
  '8': 0.5,
  '8d': 0.75,
  '16': 0.25,
  '32': 0.125,
  wr: 4,
  hr: 2,
  hdr: 3,
  qr: 1,
  qdr: 1.5,
  '8r': 0.5,
  '8dr': 0.75,
  '16r': 0.25,
  '32r': 0.125,
};

export function isRest(duration: Duration): boolean {
  return duration.endsWith('r');
}

export function durationBeats(duration: Duration): number {
  return DURATION_BEATS[duration];
}

/** Sounding length in quarter-note beats, including tuplet scaling. */
export function noteBeats(note: Pick<Note, 'duration' | 'tuplet'>): number {
  const base = durationBeats(note.duration);
  if (!note.tuplet || note.tuplet.actual <= 0) return base;
  return (base * note.tuplet.normal) / note.tuplet.actual;
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
  return measure.notes.reduce((sum, note) => sum + noteBeats(note), 0);
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
      const next = filled + noteBeats(measures[i].notes[n]);
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

/** Deep-clone a note with fresh ids (including grace tones). */
export function cloneNote(note: Note): Note {
  return {
    ...note,
    id: createId('note'),
    chord: note.chord?.map((tone) => ({ ...tone })),
    grace: note.grace?.map((g) => ({ ...g, id: createId('grace') })),
    tuplet: note.tuplet ? { ...note.tuplet } : undefined,
  };
}

/**
 * Insert a copy of the selected note immediately after it in the same measure.
 * Returns the updated score and the new note's id (or null if not found).
 */
export function copyNote(
  score: Score,
  noteId: string,
): { score: Score; newNoteId: string | null } {
  for (const measure of score.measures) {
    const index = measure.notes.findIndex((n) => n.id === noteId);
    if (index < 0) continue;
    const clone = cloneNote(measure.notes[index]);
    return {
      score: reflowOverflow(addNoteToMeasure(score, measure.id, clone, index + 1)),
      newNoteId: clone.id,
    };
  }
  return { score, newNoteId: null };
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

function cloneMeasure(measure: Measure): Measure {
  return {
    id: createId('measure'),
    width: measure.width,
    notes: measure.notes.map(cloneNote),
  };
}

function scoreHasNotes(score: Score): boolean {
  return score.measures.some((measure) => measure.notes.length > 0);
}

/**
 * Concatenate measures from multiple scanned pages into one score.
 * Metadata (title, clef, key, time) comes from the first score.
 * Later pages with no notes at all are skipped; measures that contain rests are kept.
 */
export function mergeScores(scores: Score[]): Score {
  if (scores.length === 0) {
    return createBlankScore({ measureCount: 0 });
  }

  const first = scores[0];
  const measures: Measure[] = [];

  for (let i = 0; i < scores.length; i += 1) {
    const page = scores[i];
    if (i > 0 && !scoreHasNotes(page)) continue;
    for (const measure of page.measures) {
      measures.push(cloneMeasure(measure));
    }
  }

  return {
    title: first.title,
    clef: first.clef,
    keySignature: first.keySignature,
    timeSignature: { ...first.timeSignature },
    measures,
  };
}
