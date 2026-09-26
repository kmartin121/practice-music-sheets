import { XMLParser } from 'fast-xml-parser';
import {
  createId,
  isRest,
  noteBeats,
  splitOverfullMeasure,
  type Accidental,
  type Duration,
  type GraceTone,
  type Measure,
  type Note,
  type Notehead,
  type Score,
  type Tuplet,
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
  '32nd': '32',
  '64th': '32',
  '128th': '32',
  '256th': '32',
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
    { beats: 3, duration: 'hd' },
    { beats: 2, duration: 'h' },
    { beats: 1.5, duration: 'qd' },
    { beats: 1, duration: 'q' },
    { beats: 0.75, duration: '8d' },
    { beats: 0.5, duration: '8' },
    { beats: 0.25, duration: '16' },
    { beats: 0.125, duration: '32' },
  ];
  let best = table[4];
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

function parseTuplet(noteNode: Record<string, unknown>): Tuplet | undefined {
  const mod = noteNode['time-modification'] as Record<string, unknown> | undefined;
  if (!mod) return undefined;
  const actual = Number(textOf(mod['actual-notes']));
  const normal = Number(textOf(mod['normal-notes']));
  if (!Number.isFinite(actual) || !Number.isFinite(normal) || actual <= 0 || normal <= 0) {
    return undefined;
  }
  if (actual === normal) return undefined;

  const tuplet: Tuplet = { actual, normal };
  const notations = asArray<Record<string, unknown>>(
    noteNode.notations as Record<string, unknown> | undefined,
  );
  for (const notation of notations) {
    for (const marker of asArray(notation.tuplet as Record<string, unknown> | undefined)) {
      const kind = textOf(marker['@_type']).toLowerCase();
      if (kind === 'start') tuplet.start = true;
      if (kind === 'stop') tuplet.stop = true;
    }
  }
  return tuplet;
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
    const baseBeats: Record<string, number> = {
      w: 4,
      h: 2,
      q: 1,
      '8': 0.5,
      '16': 0.25,
      '32': 0.125,
    };
    let beats = baseBeats[base] ?? 1;
    // Dotted half / quarter / eighth are exact; other dotted values snap to the nearest duration.
    for (let i = 0; i < dots; i++) beats *= 1.5;
    return nearestDuration(beats, isRest);
  }
  // Without <type>, <duration> is the sounding length; undo tuplet scaling to get the written value.
  const tuplet = parseTuplet(noteNode);
  const raw = Number(textOf(noteNode.duration));
  if (tuplet && divisions > 0 && raw > 0) {
    return nearestDuration(((raw / divisions) * tuplet.actual) / tuplet.normal, isRest);
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

function parseGraceSlash(graceNode: unknown): boolean {
  if (graceNode == null || typeof graceNode !== 'object') return false;
  const attrs = graceNode as Record<string, unknown>;
  const slash = textOf(attrs['@_slash'] ?? attrs.slash).toLowerCase();
  return slash === 'yes' || slash === 'true' || slash === '1';
}

function parseGraceTone(noteNode: Record<string, unknown>, divisions: number): GraceTone | null {
  if (noteNode.rest != null) return null;
  const pitch = resolvePitch(noteNode);
  if (!pitch) return null;
  const notehead = parseNotehead(noteNode);
  return {
    id: createId('grace'),
    pitch: pitch.step,
    octave: pitch.octave,
    duration: parseDuration(noteNode, false, divisions),
    accidental: parseAccidental(noteNode),
    ...(notehead ? { notehead } : {}),
    ...(parseGraceSlash(noteNode.grace) ? { slash: true } : {}),
  };
}

function parseNote(noteNode: Record<string, unknown>, divisions: number): Note | null {
  // Cue notes stay out of the editable melody line; grace notes are attached separately.
  if (noteNode.cue != null) return null;
  const isRestNote = noteNode.rest != null;
  const duration = parseDuration(noteNode, isRestNote, divisions);
  const tuplet = parseTuplet(noteNode);
  if (isRestNote) {
    return {
      id: createId('note'),
      pitch: 'B',
      octave: 4,
      duration,
      ...(tuplet ? { tuplet } : {}),
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
    ...(tuplet ? { tuplet } : {}),
  };
}

function restFromBeats(beats: number): Note {
  return {
    id: createId('note'),
    pitch: 'B',
    octave: 4,
    duration: nearestDuration(beats, true),
  };
}

function readDefaultX(noteNode: Record<string, unknown>): number | null {
  const raw = noteNode['@_default-x'] ?? noteNode['default-x'];
  if (raw == null || raw === '') return null;
  const value = Number(textOf(raw));
  return Number.isFinite(value) ? value : null;
}

/**
 * Audiveris sometimes keeps visual spacing (default-x) for a rest it never emitted.
 * When a bar is underfull, insert the missing duration into the largest default-x gap.
 */
export function fillImpliedRestsFromSpacing(
  notes: Note[],
  defaultXs: (number | null)[],
  capacityBeats: number,
): Note[] {
  const filled = notes.reduce((sum, note) => sum + noteBeats(note), 0);
  const missing = capacityBeats - filled;
  // Only synthesize rests when Audiveris left a visible hole (default-x), not for
  // empty bars or ordinary underfull measures without spacing evidence.
  if (missing <= 1e-9 || notes.length < 2) return notes;

  const gaps: { insertIndex: number; gap: number }[] = [];
  for (let i = 1; i < notes.length; i += 1) {
    const left = defaultXs[i - 1];
    const right = defaultXs[i];
    if (left == null || right == null) continue;
    gaps.push({ insertIndex: i, gap: right - left });
  }
  if (gaps.length === 0) return notes;

  let best = gaps[0];
  for (let i = 1; i < gaps.length; i += 1) {
    if (gaps[i].gap > best.gap) best = gaps[i];
  }

  const otherGaps = gaps.filter((g) => g.insertIndex !== best.insertIndex).map((g) => g.gap);
  const avgOther =
    otherGaps.length > 0 ? otherGaps.reduce((sum, gap) => sum + gap, 0) / otherGaps.length : 0;

  // Require a clearly larger hole than neighboring gaps (Audiveris omitted-rest pattern).
  if (otherGaps.length > 0 && best.gap < avgOther * 1.5) return notes;

  const next = [...notes];
  next.splice(best.insertIndex, 0, restFromBeats(missing));
  return next;
}

/** A principal note or rest placed on the measure timeline (times in divisions). */
type TimedEvent = {
  onset: number;
  length: number;
  voice: string;
  note: Note;
  defaultX: number | null;
};

function readTokenDuration(chunk: string): number {
  const match = chunk.match(/<duration\b[^>]*>\s*([^<\s]+)\s*</i);
  const raw = match ? Number(match[1]) : NaN;
  return Number.isFinite(raw) && raw > 0 ? raw : 0;
}

function readTokenVoice(chunk: string): string | null {
  const match = chunk.match(/<voice\b[^>]*>\s*([^<\s]+)\s*</i);
  return match ? match[1] : null;
}

function sameTone(a: { pitch: string; octave: number }, b: { pitch: string; octave: number }) {
  return a.pitch === b.pitch && a.octave === b.octave;
}

/**
 * Collapse several voices into the single-line model: notes that start together
 * become one chord, and each event lasts until the next onset so the bar still adds up.
 */
function mergeVoicesByOnset(
  events: TimedEvent[],
  voiceOrder: string[],
  divisions: number,
): { notes: Note[]; defaultXs: (number | null)[] } {
  const voiceRank = (voice: string) => voiceOrder.indexOf(voice);
  const pitched = events.filter((e) => !isRest(e.note.duration));
  const coveredByPitched = (onset: number) =>
    pitched.some((p) => p.onset <= onset && onset < p.onset + p.length);
  const kept = events.filter((e) => !isRest(e.note.duration) || !coveredByPitched(e.onset));

  const onsets = [...new Set(kept.map((e) => e.onset))].sort((a, b) => a - b);
  const measureEnd = Math.max(...events.map((e) => e.onset + e.length));
  const notes: Note[] = [];
  const defaultXs: (number | null)[] = [];

  onsets.forEach((onset, i) => {
    const atOnset = kept
      .filter((e) => e.onset === onset)
      .sort((a, b) => {
        const restOrder = Number(isRest(a.note.duration)) - Number(isRest(b.note.duration));
        return restOrder !== 0 ? restOrder : voiceRank(a.voice) - voiceRank(b.voice);
      });
    const [primaryEvent, ...others] = atOnset;
    const gap = (onsets[i + 1] ?? measureEnd) - onset;
    const note: Note = { ...primaryEvent.note };

    if (!isRest(note.duration)) {
      const chord = [...(note.chord ?? [])];
      const grace = [...(note.grace ?? [])];
      for (const other of others) {
        if (isRest(other.note.duration)) continue;
        for (const tone of [other.note, ...(other.note.chord ?? [])]) {
          if (sameTone(tone, note) || chord.some((c) => sameTone(c, tone))) continue;
          chord.push({
            pitch: tone.pitch,
            octave: tone.octave,
            ...(tone.accidental ? { accidental: tone.accidental } : {}),
            ...(tone.notehead ? { notehead: tone.notehead } : {}),
          });
        }
        grace.push(...(other.note.grace ?? []));
      }
      if (chord.length > 0) note.chord = chord;
      if (grace.length > 0) note.grace = grace;
    }

    if (primaryEvent.length !== gap && divisions > 0) {
      note.duration = nearestDuration(gap / divisions, isRest(note.duration));
      delete note.tuplet;
    }
    notes.push(note);
    defaultXs.push(primaryEvent.defaultX);
  });

  return { notes, defaultXs };
}

/**
 * Walk `<note>` / `<forward>` / `<backup>` in document order, tracking the time cursor
 * per voice. (Default fast-xml-parser objects lose interleaving order between those tags.)
 */
export function parseMeasureBodyInOrder(
  measureInnerXml: string,
  divisions: number,
): { notes: Note[]; defaultXs: (number | null)[] } {
  const events: TimedEvent[] = [];
  const voiceOrder: string[] = [];
  const lastEventByVoice = new Map<string, TimedEvent>();
  const pendingGraceByVoice = new Map<string, GraceTone[]>();
  let cursor = 0;

  const noteVoice = (voice: string | null) => {
    const id = voice ?? '1';
    if (!voiceOrder.includes(id)) voiceOrder.push(id);
    return id;
  };

  const chunkParser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: '@_',
    processEntities: false,
    htmlEntities: false,
    trimValues: true,
    isArray: (name) => name === 'dot',
  });

  const tokenRe = /<(note|forward|backup)\b[\s\S]*?<\/\1>/gi;
  let match: RegExpExecArray | null;
  while ((match = tokenRe.exec(measureInnerXml)) !== null) {
    const tag = match[1].toLowerCase();
    const chunk = match[0];
    const raw = readTokenDuration(chunk);

    if (tag === 'backup') {
      cursor = Math.max(0, cursor - raw);
      continue;
    }
    if (tag === 'forward') {
      if (raw > 0 && divisions > 0) {
        const event: TimedEvent = {
          onset: cursor,
          length: raw,
          voice: noteVoice(readTokenVoice(chunk)),
          note: restFromBeats(raw / divisions),
          defaultX: null,
        };
        events.push(event);
        lastEventByVoice.set(event.voice, event);
      }
      cursor += raw;
      continue;
    }

    let parsed: Record<string, unknown>;
    try {
      parsed = chunkParser.parse(chunk) as Record<string, unknown>;
    } catch {
      continue;
    }
    const noteNode = parsed.note as Record<string, unknown> | undefined;
    if (!noteNode) continue;
    const voice = noteVoice(readTokenVoice(chunk));

    // Cue notes are skipped; grace notes buffer until the next principal note in their voice.
    if (noteNode.cue != null) continue;
    if (noteNode.grace != null) {
      if (noteNode.chord != null) continue;
      const grace = parseGraceTone(noteNode, divisions);
      if (grace) pendingGraceByVoice.set(voice, [...(pendingGraceByVoice.get(voice) ?? []), grace]);
      continue;
    }

    if (noteNode.chord != null) {
      const pitch = resolvePitch(noteNode);
      const prev = lastEventByVoice.get(voice)?.note;
      if (!pitch || !prev || isRest(prev.duration)) continue;
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
    if (!note) continue;
    const pendingGrace = pendingGraceByVoice.get(voice);
    if (pendingGrace?.length) {
      note.grace = pendingGrace;
      pendingGraceByVoice.delete(voice);
    }
    const length = raw > 0 ? raw : Math.round(noteBeats(note) * divisions);
    const event: TimedEvent = {
      onset: cursor,
      length,
      voice,
      note,
      defaultX: readDefaultX(noteNode),
    };
    events.push(event);
    lastEventByVoice.set(voice, event);
    cursor += length;
  }

  // Audiveris often fills an unused voice with a whole-bar rest; drop rest-only voices.
  const realVoices = voiceOrder.filter((voice) =>
    events.some((e) => e.voice === voice && !isRest(e.note.duration)),
  );
  const keptVoices = realVoices.length > 0 ? realVoices : voiceOrder.slice(0, 1);
  const keptEvents = events
    .filter((e) => keptVoices.includes(e.voice))
    .sort((a, b) => a.onset - b.onset);

  if (keptVoices.length <= 1) {
    return {
      notes: keptEvents.map((e) => e.note),
      defaultXs: keptEvents.map((e) => e.defaultX),
    };
  }
  return mergeVoicesByOnset(keptEvents, keptVoices, divisions);
}

function extractMeasureInners(xml: string): string[] {
  const inners: string[] = [];
  const re = /<measure\b[^>]*>([\s\S]*?)<\/measure>/gi;
  let match: RegExpExecArray | null;
  while ((match = re.exec(xml)) !== null) {
    inners.push(match[1]);
  }
  return inners;
}

function countParsableNotes(part: Record<string, unknown>): number {
  let count = 0;
  for (const measureNode of asArray(part.measure as Record<string, unknown> | Record<string, unknown>[])) {
    for (const noteNode of asArray(measureNode.note as Record<string, unknown> | Record<string, unknown>[])) {
      // Chord tones attach to the previous note; still count toward density.
      if (noteNode.cue != null) continue;
      if (noteNode.rest != null || resolvePitch(noteNode)) count += 1;
    }
  }
  return count;
}

function pickDensestPart(parts: Record<string, unknown>[]): {
  part: Record<string, unknown>;
  index: number;
} {
  let best = parts[0];
  let bestIndex = 0;
  let bestCount = countParsableNotes(best);
  for (let i = 1; i < parts.length; i++) {
    const count = countParsableNotes(parts[i]);
    if (count > bestCount) {
      best = parts[i];
      bestIndex = i;
      bestCount = count;
    }
  }
  return { part: best, index: bestIndex };
}

function extractPartInnerXml(xml: string, partIndex: number): string {
  const partChunks = [...xml.matchAll(/<part\b[^>]*>[\s\S]*?<\/part>/gi)].map((m) => m[0]);
  return partChunks[partIndex] ?? xml;
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
  const { part, index: partIndex } = pickDensestPart(parts);
  const measureNodes = asArray(part.measure as Record<string, unknown> | Record<string, unknown>[]);
  const measureInners = extractMeasureInners(extractPartInnerXml(sanitized, partIndex));

  let clef: Score['clef'] = 'treble';
  let keySignature = 'C';
  let timeSignature = { beats: 4, beatType: 4 };
  let divisions = 4;
  const measures: Measure[] = [];

  for (let measureIndex = 0; measureIndex < measureNodes.length; measureIndex += 1) {
    const measureNode = measureNodes[measureIndex];
    const attrs = measureNode.attributes as Record<string, unknown> | undefined;
    if (attrs) {
      const div = Number(textOf(attrs.divisions));
      if (!Number.isNaN(div) && div > 0) divisions = div;

      const clefNode = asArray(attrs.clef as Record<string, unknown> | Record<string, unknown>[])[0];
      const sign = textOf(clefNode?.sign).toLowerCase();
      if (sign === 'g') clef = 'treble';
      if (sign === 'f') clef = 'bass';
      // Percussion / TAB etc. still render on a treble-like staff in v1.

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

    const inner = measureInners[measureIndex] ?? '';
    const capacityBeats = timeSignature.beats * (4 / timeSignature.beatType);
    let notes: Note[];
    if (inner.length > 0) {
      const parsed = parseMeasureBodyInOrder(inner, divisions);
      notes = fillImpliedRestsFromSpacing(parsed.notes, parsed.defaultXs, capacityBeats);
    } else {
      // Fallback if measure regex missed (malformed whitespace, etc.).
      const collected: Note[] = [];
      const defaultXs: (number | null)[] = [];
      let pendingGrace: GraceTone[] = [];
      for (const noteNode of asArray(
        measureNode.note as Record<string, unknown> | Record<string, unknown>[],
      )) {
        if (noteNode.cue != null) continue;
        if (noteNode.grace != null) {
          if (noteNode.chord != null) continue;
          const grace = parseGraceTone(noteNode, divisions);
          if (grace) pendingGrace.push(grace);
          continue;
        }
        if (noteNode.chord != null) {
          const pitch = resolvePitch(noteNode);
          if (!pitch || collected.length === 0) continue;
          const prev = collected[collected.length - 1];
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
        if (note) {
          if (pendingGrace.length > 0) {
            note.grace = pendingGrace;
            pendingGrace = [];
          }
          collected.push(note);
          defaultXs.push(readDefaultX(noteNode));
        }
      }
      notes = fillImpliedRestsFromSpacing(collected, defaultXs, capacityBeats);
    }

    const measure: Measure = {
      id: createId('measure'),
      notes,
      ...(Number.isFinite(Number(textOf(measureNode['@_width']))) &&
      Number(textOf(measureNode['@_width'])) > 0
        ? { width: Number(textOf(measureNode['@_width'])) }
        : {}),
    };
    // OMR misses barlines (repeats, tempo marks), packing several printed bars into one measure.
    measures.push(...splitOverfullMeasure(measure, capacityBeats));
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
