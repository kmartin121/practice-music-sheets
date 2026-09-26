import { XMLParser } from 'fast-xml-parser';
import {
  createId,
  isRest,
  type Accidental,
  type Duration,
  type Measure,
  type Note,
  type Notehead,
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

/** Map MusicXML note-type names onto our supported duration set (nearest). */
const TYPE_TO_DURATION: Record<string, Duration> = {
  maxima: 'w',
  long: 'w',
  breve: 'w',
  whole: 'w',
  half: 'h',
  quarter: 'q',
  eighth: '8',
  '16th': '16',
  '32nd': '16',
  '64th': '16',
  '128th': '16',
  '256th': '16',
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

/** Count raw `<note` elements in MusicXML source (for OMR diagnostics). */
export function countMusicXmlNoteElements(xml: string): number {
  return (xml.match(/<note[\s>]/gi) || []).length;
}

function nearestDuration(beats: number, isRest: boolean): Duration {
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
    const diff = Math.abs(row.beats - beats);
    if (diff < bestDiff) {
      best = row;
      bestDiff = diff;
    }
  }
  return (isRest ? `${best.duration}r` : best.duration) as Duration;
}

function durationFromDivisions(
  noteNode: Record<string, unknown>,
  divisions: number,
  isRest: boolean,
): Duration | null {
  const raw = Number(textOf(noteNode.duration));
  if (!divisions || Number.isNaN(raw) || raw <= 0) return null;
  return nearestDuration(raw / divisions, isRest);
}

function parseDuration(
  noteNode: Record<string, unknown>,
  isRest: boolean,
  divisions: number,
): Duration {
  const type = textOf(noteNode.type);
  const dots = asArray(noteNode.dot as unknown).length;
  if (type && TYPE_TO_DURATION[type]) {
    const base = TYPE_TO_DURATION[type];
    const baseBeats: Record<string, number> = { w: 4, h: 2, q: 1, '8': 0.5, '16': 0.25 };
    let beats = baseBeats[base] ?? 1;
    // Approximate dotted values into our nearest supported duration.
    for (let i = 0; i < dots; i++) beats *= 1.5;
    return nearestDuration(beats, isRest);
  }
  return durationFromDivisions(noteNode, divisions, isRest) ?? ((isRest ? 'qr' : 'q') as Duration);
}

function parseAccidental(noteNode: Record<string, unknown>): Accidental | undefined {
  const accidental = textOf(noteNode.accidental);
  if (accidental === 'sharp' || accidental === 'flat' || accidental === 'natural') {
    return accidental;
  }
  const pitchNode = noteNode.pitch as Record<string, unknown> | undefined;
  const alter = Number(textOf(pitchNode?.alter));
  if (alter === 1) return 'sharp';
  if (alter === -1) return 'flat';
  return undefined;
}

function parseNotehead(noteNode: Record<string, unknown>): Notehead | undefined {
  const raw = textOf(noteNode.notehead).toLowerCase();
  if (!raw || raw === 'normal') return undefined;
  if (raw === 'x' || raw === 'cross' || raw === 'circle-x') return 'x';
  if (raw === 'diamond') return 'diamond';
  if (raw === 'slash') return 'slash';
  if (raw === 'triangle' || raw === 'inverted triangle') return 'triangle';
  return undefined;
}

function resolvePitch(noteNode: Record<string, unknown>): { step: string; octave: number } | null {
  const pitchNode = noteNode.pitch as Record<string, unknown> | undefined;
  if (pitchNode) {
    const step = textOf(pitchNode.step).toUpperCase();
    const octave = Number(textOf(pitchNode.octave));
    if (step && !Number.isNaN(octave)) return { step, octave };
  }
  const unpitched = noteNode.unpitched as Record<string, unknown> | undefined;
  if (unpitched) {
    const step = textOf(unpitched['display-step']).toUpperCase();
    const octave = Number(textOf(unpitched['display-octave']));
    if (step && !Number.isNaN(octave)) return { step, octave };
  }
  return null;
}

function parseNote(noteNode: Record<string, unknown>, divisions: number): Note | null {
  // Skip grace / cue notes for v1 melody line.
  if (noteNode.grace != null || noteNode.cue != null) return null;
  const isRestNote = noteNode.rest != null;
  const duration = parseDuration(noteNode, isRestNote, divisions);
  if (isRestNote) {
    return {
      id: createId('note'),
      pitch: 'B',
      octave: 4,
      duration,
    };
  }
  const pitch = resolvePitch(noteNode);
  if (!pitch) return null;
  const notehead = parseNotehead(noteNode);
  return {
    id: createId('note'),
    pitch: pitch.step,
    octave: pitch.octave,
    duration,
    accidental: parseAccidental(noteNode),
    ...(notehead ? { notehead } : {}),
  };
}

function countParsableNotes(part: Record<string, unknown>): number {
  let count = 0;
  for (const measureNode of asArray(part.measure as Record<string, unknown> | Record<string, unknown>[])) {
    for (const noteNode of asArray(measureNode.note as Record<string, unknown> | Record<string, unknown>[])) {
      // Chord tones attach to the previous note; still count toward density.
      if (noteNode.grace != null || noteNode.cue != null) continue;
      if (noteNode.rest != null || resolvePitch(noteNode)) count += 1;
    }
  }
  return count;
}

function pickDensestPart(parts: Record<string, unknown>[]): Record<string, unknown> {
  let best = parts[0];
  let bestCount = countParsableNotes(best);
  for (let i = 1; i < parts.length; i++) {
    const count = countParsableNotes(parts[i]);
    if (count > bestCount) {
      best = parts[i];
      bestCount = count;
    }
  }
  return best;
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
    // Complex engraved scores nest deeply (notations, ornaments, etc.).
    maxNestedTags: 500,
    isArray: (name) =>
      name === 'note' ||
      name === 'measure' ||
      name === 'part' ||
      name === 'clef' ||
      name === 'key' ||
      name === 'time' ||
      name === 'dot',
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
  const part = pickDensestPart(parts);
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
      // Fold MusicXML chord tones onto the preceding note so dyads render.
      if (noteNode.chord != null) {
        if (noteNode.grace != null || noteNode.cue != null) continue;
        const pitch = resolvePitch(noteNode);
        if (!pitch || notes.length === 0) continue;
        const prev = notes[notes.length - 1];
        if (isRest(prev.duration)) continue;
        const notehead = parseNotehead(noteNode);
        const tone = {
          pitch: pitch.step,
          octave: pitch.octave,
          accidental: parseAccidental(noteNode),
          ...(notehead ? { notehead } : {}),
        };
        prev.chord = [...(prev.chord ?? []), tone];
        continue;
      }
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
