import { XMLParser } from 'fast-xml-parser';
import {
  createId,
  type Accidental,
  type Duration,
  type Measure,
  type Note,
  type Score,
} from './score-model';

export const MAX_MUSICXML_BYTES = 5 * 1024 * 1024;

const KEY_FIFTHS_TO_NAME: Record<number, string> = {
  [-7]: 'Cb',
  [-6]: 'Gb',
  [-5]: 'Db',
  [-4]: 'Ab',
  [-3]: 'Eb',
  [-2]: 'Bb',
  [-1]: 'F',
  0: 'C',
  1: 'G',
  2: 'D',
  3: 'A',
  4: 'E',
  5: 'B',
  6: 'F#',
  7: 'C#',
};

const TYPE_TO_DURATION: Record<string, Duration> = {
  whole: 'w',
  half: 'h',
  quarter: 'q',
  eighth: '8',
  '16th': '16',
};

function asArray<T>(value: T | T[] | undefined | null): T[] {
  if (value == null) return [];
  return Array.isArray(value) ? value : [value];
}

function textOf(value: unknown): string {
  if (value == null) return '';
  if (typeof value === 'string' || typeof value === 'number') return String(value);
  if (typeof value === 'object' && value !== null && '#text' in value) {
    return String((value as { '#text': unknown })['#text'] ?? '');
  }
  return '';
}

export class MusicXmlParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'MusicXmlParseError';
  }
}

/** Prefer the score-partwise document when a payload contains extra XML (e.g. container). */
export function extractScorePartwiseXml(xml: string): string {
  const match = xml.match(/<score-partwise\b[\s\S]*<\/score-partwise>/i);
  return match ? match[0] : xml;
}

function durationFromDivisions(
  noteNode: Record<string, unknown>,
  divisions: number,
  isRest: boolean,
): Duration | null {
  const raw = Number(textOf(noteNode.duration));
  if (!divisions || Number.isNaN(raw) || raw <= 0) return null;
  const quarterUnits = raw / divisions;
  const table: { beats: number; duration: Duration }[] = [
    { beats: 4, duration: 'w' },
    { beats: 2, duration: 'h' },
    { beats: 1, duration: 'q' },
    { beats: 0.5, duration: '8' },
    { beats: 0.25, duration: '16' },
  ];
  let best = table[2];
  let bestDiff = Infinity;
  for (const row of table) {
    const diff = Math.abs(row.beats - quarterUnits);
    if (diff < bestDiff) {
      best = row;
      bestDiff = diff;
    }
  }
  return (isRest ? `${best.duration}r` : best.duration) as Duration;
}

function parseDuration(
  noteNode: Record<string, unknown>,
  isRest: boolean,
  divisions: number,
): Duration {
  const type = textOf(noteNode.type);
  if (type && TYPE_TO_DURATION[type]) {
    const base = TYPE_TO_DURATION[type];
    return (isRest ? `${base}r` : base) as Duration;
  }
  return durationFromDivisions(noteNode, divisions, isRest) ?? ((isRest ? 'qr' : 'q') as Duration);
}

function parseAccidental(noteNode: Record<string, unknown>): Accidental | undefined {
  const accidental = textOf(noteNode.accidental);
  if (accidental === 'sharp' || accidental === 'flat' || accidental === 'natural') {
    return accidental;
  }
  const alter = Number(textOf((noteNode.pitch as Record<string, unknown> | undefined)?.alter));
  if (alter === 1) return 'sharp';
  if (alter === -1) return 'flat';
  return undefined;
}

function parseNote(noteNode: Record<string, unknown>, divisions: number): Note | null {
  // Skip grace / cue notes for v1 melody line.
  if (noteNode.grace != null || noteNode.cue != null) return null;
  const isRest = noteNode.rest != null;
  const duration = parseDuration(noteNode, isRest, divisions);
  if (isRest) {
    return {
      id: createId('note'),
      pitch: 'B',
      octave: 4,
      duration,
    };
  }
  const pitchNode = noteNode.pitch as Record<string, unknown> | undefined;
  if (!pitchNode) return null;
  const step = textOf(pitchNode.step).toUpperCase();
  const octave = Number(textOf(pitchNode.octave));
  if (!step || Number.isNaN(octave)) return null;
  return {
    id: createId('note'),
    pitch: step,
    octave,
    duration,
    accidental: parseAccidental(noteNode),
  };
}

export function parseMusicXml(xml: string): Score {
  if (!xml || !xml.trim()) {
    throw new MusicXmlParseError('MusicXML is empty');
  }
  const byteLength = new TextEncoder().encode(xml).length;
  if (byteLength > MAX_MUSICXML_BYTES) {
    throw new MusicXmlParseError(`MusicXML exceeds ${MAX_MUSICXML_BYTES} byte limit`);
  }
  // Block XXE: entity declarations can pull in local/remote files.
  // A plain MusicXML DOCTYPE (common from Audiveris) is fine — strip it before parse.
  if (/<!ENTITY/i.test(xml)) {
    throw new MusicXmlParseError('MusicXML with ENTITY declarations is not allowed');
  }
  const withoutDoctype = xml.replace(/<!DOCTYPE[^>]*(?:\[[\s\S]*?\])?[^>]*>/gi, '');
  const sanitized = extractScorePartwiseXml(withoutDoctype);

  const parser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: '@_',
    // Prevent external entity expansion / DTD fetching.
    processEntities: false,
    htmlEntities: false,
    trimValues: true,
    isArray: (name) => name === 'note' || name === 'measure' || name === 'part' || name === 'clef' || name === 'key' || name === 'time',
  });

  let doc: Record<string, unknown>;
  try {
    doc = parser.parse(sanitized) as Record<string, unknown>;
  } catch {
    throw new MusicXmlParseError('Malformed MusicXML');
  }

  const scorePartwise = doc['score-partwise'] as Record<string, unknown> | undefined;
  if (!scorePartwise) {
    throw new MusicXmlParseError('Expected score-partwise root');
  }

  const title =
    textOf((scorePartwise['movement-title'] as unknown) ?? '') ||
    textOf(
      ((scorePartwise.work as Record<string, unknown> | undefined)?.['work-title'] as unknown) ?? '',
    ) ||
    'Untitled';

  const parts = asArray(scorePartwise.part as Record<string, unknown> | Record<string, unknown>[]);
  if (parts.length === 0) {
    throw new MusicXmlParseError('No parts found in MusicXML');
  }
  const part = parts[0];
  const measureNodes = asArray(part.measure as Record<string, unknown> | Record<string, unknown>[]);

  let clef: Score['clef'] = 'treble';
  let keySignature = 'C';
  let timeSignature = { beats: 4, beatType: 4 };
  let divisions = 4;
  const measures: Measure[] = [];

  for (const measureNode of measureNodes) {
    const attrs = measureNode.attributes as Record<string, unknown> | undefined;
    if (attrs) {
      const div = Number(textOf(attrs.divisions));
      if (!Number.isNaN(div) && div > 0) divisions = div;

      const clefNode = asArray(attrs.clef as Record<string, unknown> | Record<string, unknown>[])[0];
      const sign = textOf(clefNode?.sign).toLowerCase();
      if (sign === 'g') clef = 'treble';
      if (sign === 'f') clef = 'bass';

      const keyNode = asArray(attrs.key as Record<string, unknown> | Record<string, unknown>[])[0];
      const fifths = Number(textOf(keyNode?.fifths));
      if (!Number.isNaN(fifths) && KEY_FIFTHS_TO_NAME[fifths] != null) {
        keySignature = KEY_FIFTHS_TO_NAME[fifths];
      }

      const timeNode = asArray(attrs.time as Record<string, unknown> | Record<string, unknown>[])[0];
      const beats = Number(textOf(timeNode?.beats));
      const beatType = Number(textOf(timeNode?.['beat-type']));
      if (!Number.isNaN(beats) && !Number.isNaN(beatType) && beats > 0 && beatType > 0) {
        timeSignature = { beats, beatType };
      }
    }

    const notes: Note[] = [];
    for (const noteNode of asArray(measureNode.note as Record<string, unknown> | Record<string, unknown>[])) {
      // Skip chord tones beyond the first for single-line v1.
      if (noteNode.chord != null) continue;
      const note = parseNote(noteNode, divisions);
      if (note) notes.push(note);
    }

    measures.push({
      id: createId('measure'),
      notes,
    });
  }

  if (measures.length === 0) {
    throw new MusicXmlParseError('No measures found in MusicXML');
  }

  return {
    title,
    clef,
    keySignature,
    timeSignature,
    measures,
  };
}
