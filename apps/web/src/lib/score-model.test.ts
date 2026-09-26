import { describe, expect, it } from 'vitest';
import {
  addChordTone,
  addNoteToMeasure,
  copyNote,
  createBlankScore,
  durationBeats,
  formatMeasureBeats,
  measureBeatStatus,
  measureFilledBeats,
  measureOverflows,
  mergeScores,
  noteBeats,
  reflowOverflow,
  relocateNote,
  removeNote,
  splitOverfullMeasure,
} from './score-model';

describe('score-model', () => {
  it('counts a dotted half rest as three beats', () => {
    expect(durationBeats('hdr')).toBe(3);
    expect(durationBeats('hd')).toBe(3);
  });

  it('splits an overfull measure locally, moving a straddling note to the next bar', () => {
    const measure = {
      id: 'm1',
      notes: [
        { id: 'a', pitch: 'C', octave: 4, duration: 'hd' as const },
        { id: 'b', pitch: 'D', octave: 4, duration: 'h' as const },
        { id: 'c', pitch: 'E', octave: 4, duration: 'q' as const },
      ],
    };
    const pieces = splitOverfullMeasure(measure, 4);
    expect(pieces.map((p) => p.notes.map((n) => n.id))).toEqual([['a'], ['b', 'c']]);
    expect(pieces[0].id).toBe('m1');
    expect(splitOverfullMeasure({ id: 'x', notes: measure.notes.slice(0, 1) }, 4)).toHaveLength(1);
  });

  it('stacks chord tones onto a note without duplicating pitches or touching rests', () => {
    const blank = createBlankScore({ measureCount: 1 });
    const measureId = blank.measures[0].id;
    let score = addNoteToMeasure(blank, measureId, { pitch: 'C', octave: 4, duration: 'q' });
    score = addNoteToMeasure(score, measureId, { pitch: 'B', octave: 4, duration: 'qr' });
    const [note, rest] = score.measures[0].notes;

    score = addChordTone(score, note.id, { pitch: 'E', octave: 4 });
    score = addChordTone(score, note.id, { pitch: 'G', octave: 4 });
    expect(score.measures[0].notes[0].chord).toEqual([
      { pitch: 'E', octave: 4 },
      { pitch: 'G', octave: 4 },
    ]);
    expect(score.measures[0].notes[0].duration).toBe('q');

    expect(addChordTone(score, note.id, { pitch: 'C', octave: 4 })).toBe(score);
    expect(addChordTone(score, note.id, { pitch: 'E', octave: 4 })).toBe(score);
    expect(addChordTone(score, rest.id, { pitch: 'E', octave: 4 })).toBe(score);
  });

  it('formats filled vs expected beats in the time signature beat unit', () => {
    const fourFour = createBlankScore({ measureCount: 1 });
    const id44 = fourFour.measures[0].id;
    let score = addNoteToMeasure(fourFour, id44, { pitch: 'F', octave: 4, duration: 'hd' });
    score = addNoteToMeasure(score, id44, { pitch: 'F', octave: 4, duration: '32' });
    score = addNoteToMeasure(score, id44, { pitch: 'F', octave: 4, duration: '32' });
    expect(formatMeasureBeats(score, score.measures[0])).toBe('3.25/4');
    expect(formatMeasureBeats(fourFour, fourFour.measures[0])).toBe('0/4');

    const sixEight = createBlankScore({ measureCount: 1, timeSignature: { beats: 6, beatType: 8 } });
    const id68 = sixEight.measures[0].id;
    score = addNoteToMeasure(sixEight, id68, { pitch: 'F', octave: 4, duration: 'qd' });
    expect(formatMeasureBeats(score, score.measures[0])).toBe('3/6');

    const triplet = { actual: 3, normal: 2 };
    score = addNoteToMeasure(fourFour, id44, { pitch: 'F', octave: 4, duration: '8', tuplet: triplet });
    expect(formatMeasureBeats(score, score.measures[0])).toBe('0.33/4');
  });

  it('scales tuplet notes to their sounding length', () => {
    expect(noteBeats({ duration: '8', tuplet: { actual: 3, normal: 2 } })).toBeCloseTo(1 / 3);
    expect(noteBeats({ duration: 'q' })).toBe(1);
  });

  it('reports whether a measure meets its beat count', () => {
    const score = createBlankScore({ timeSignature: { beats: 3, beatType: 4 } });
    const note = (id: string, duration: 'h' | 'q' | '8') => ({
      id,
      pitch: 'C',
      octave: 4,
      duration,
    });
    const tripletEighth = (id: string) => ({
      ...note(id, '8'),
      tuplet: { actual: 3, normal: 2 },
    });
    expect(measureBeatStatus(score, { id: 'e', notes: [] })).toBe('empty');
    expect(measureBeatStatus(score, { id: 's', notes: [note('a', 'h')] })).toBe('short');
    expect(measureBeatStatus(score, { id: 'f', notes: [note('a', 'h'), note('b', 'q')] })).toBe(
      'full',
    );
    expect(
      measureBeatStatus(score, {
        id: 't',
        notes: [note('a', 'h'), tripletEighth('b'), tripletEighth('c'), tripletEighth('d')],
      }),
    ).toBe('full');
    expect(
      measureBeatStatus(score, { id: 'o', notes: [note('a', 'h'), note('b', 'h')] }),
    ).toBe('over');
  });

  it('creates a blank sheet with empty measures', () => {
    const score = createBlankScore({ measureCount: 3, title: 'Practice' });
    expect(score.title).toBe('Practice');
    expect(score.measures).toHaveLength(3);
    expect(score.measures.every((m) => m.notes.length === 0)).toBe(true);
  });

  it('adds and removes notes', () => {
    let score = createBlankScore({ measureCount: 1 });
    const measureId = score.measures[0].id;
    score = addNoteToMeasure(score, measureId, {
      pitch: 'C',
      octave: 4,
      duration: 'q',
    });
    expect(score.measures[0].notes).toHaveLength(1);
    const noteId = score.measures[0].notes[0].id;
    score = removeNote(score, noteId);
    expect(score.measures[0].notes).toHaveLength(0);
  });

  it('relocates a note to a new pitch and measure', () => {
    let score = createBlankScore({ measureCount: 2 });
    const [first, second] = score.measures;
    score = addNoteToMeasure(score, first.id, {
      pitch: 'C',
      octave: 4,
      duration: 'q',
    });
    const noteId = score.measures[0].notes[0].id;
    score = relocateNote(score, noteId, second.id, 'E', 5);
    expect(score.measures[0].notes).toHaveLength(0);
    expect(score.measures[1].notes).toEqual([
      expect.objectContaining({ id: noteId, pitch: 'E', octave: 5, duration: 'q' }),
    ]);
  });

  it('relocates within a measure to a new index', () => {
    let score = createBlankScore({ measureCount: 1 });
    const measureId = score.measures[0].id;
    score = addNoteToMeasure(score, measureId, { pitch: 'C', octave: 4, duration: 'q' });
    score = addNoteToMeasure(score, measureId, { pitch: 'D', octave: 4, duration: 'q' });
    score = addNoteToMeasure(score, measureId, { pitch: 'E', octave: 4, duration: 'q' });
    const noteId = score.measures[0].notes[2].id;
    score = relocateNote(score, noteId, measureId, 'E', 5, 0);
    expect(score.measures[0].notes.map((n) => n.pitch)).toEqual(['E', 'C', 'D']);
    expect(score.measures[0].notes[0].octave).toBe(5);
  });

  it('detects measure overflow against time signature', () => {
    let score = createBlankScore({
      measureCount: 1,
      timeSignature: { beats: 4, beatType: 4 },
    });
    const measureId = score.measures[0].id;
    for (let i = 0; i < 5; i += 1) {
      score = addNoteToMeasure(score, measureId, {
        pitch: 'C',
        octave: 4,
        duration: 'q',
      });
    }
    expect(measureOverflows(score, score.measures[0])).toBe(true);
  });

  it('reflows overflow notes into the next measure', () => {
    let score = createBlankScore({
      measureCount: 1,
      timeSignature: { beats: 4, beatType: 4 },
    });
    const first = score.measures[0].id;
    for (let i = 0; i < 5; i += 1) {
      score = addNoteToMeasure(score, first, { pitch: 'C', octave: 4, duration: 'q' });
    }
    expect(measureOverflows(score, score.measures[0])).toBe(true);

    score = reflowOverflow(score);
    expect(score.measures).toHaveLength(2);
    expect(score.measures[0].notes).toHaveLength(4);
    expect(score.measures[1].notes).toHaveLength(1);
    expect(measureOverflows(score, score.measures[0])).toBe(false);
  });

  it('does not count grace notes toward measure capacity', () => {
    let score = createBlankScore({
      measureCount: 1,
      timeSignature: { beats: 4, beatType: 4 },
    });
    const measureId = score.measures[0].id;
    for (let i = 0; i < 4; i += 1) {
      score = addNoteToMeasure(score, measureId, {
        pitch: 'C',
        octave: 5,
        duration: 'q',
        grace: [
          {
            id: `grace-${i}`,
            pitch: 'G',
            octave: 5,
            duration: '16',
            notehead: 'x',
            slash: true,
          },
        ],
      });
    }
    expect(measureFilledBeats(score.measures[0])).toBe(4);
    expect(measureOverflows(score, score.measures[0])).toBe(false);
  });

  it('copies a note with a new id immediately after the original', () => {
    let score = createBlankScore({ measureCount: 1 });
    const measureId = score.measures[0].id;
    score = addNoteToMeasure(score, measureId, {
      pitch: 'C',
      octave: 4,
      duration: 'q',
      accidental: 'sharp',
      grace: [{ id: 'grace-1', pitch: 'D', octave: 4, duration: '16', slash: true }],
    });
    score = addNoteToMeasure(score, measureId, { pitch: 'E', octave: 4, duration: 'q' });
    const originalId = score.measures[0].notes[0].id;

    const { score: next, newNoteId } = copyNote(score, originalId);
    expect(newNoteId).toBeTruthy();
    expect(next.measures[0].notes).toHaveLength(3);
    expect(next.measures[0].notes.map((n) => n.pitch)).toEqual(['C', 'C', 'E']);
    expect(next.measures[0].notes[1].id).toBe(newNoteId);
    expect(next.measures[0].notes[1].id).not.toBe(originalId);
    expect(next.measures[0].notes[1].accidental).toBe('sharp');
    expect(next.measures[0].notes[1].grace?.[0].id).not.toBe('grace-1');
  });

  it('reflows when a copied note overflows the bar', () => {
    let score = createBlankScore({
      measureCount: 1,
      timeSignature: { beats: 4, beatType: 4 },
    });
    const measureId = score.measures[0].id;
    for (let i = 0; i < 4; i += 1) {
      score = addNoteToMeasure(score, measureId, { pitch: 'C', octave: 4, duration: 'q' });
    }
    const lastId = score.measures[0].notes[3].id;
    const { score: next, newNoteId } = copyNote(score, lastId);
    expect(newNoteId).toBeTruthy();
    expect(next.measures).toHaveLength(2);
    expect(next.measures[0].notes).toHaveLength(4);
    expect(next.measures[1].notes).toHaveLength(1);
    expect(next.measures[1].notes[0].id).toBe(newNoteId);
  });

  it('mergeScores concatenates measures from later pages', () => {
    let page1 = createBlankScore({
      title: 'Page One',
      clef: 'treble',
      keySignature: 'G',
      timeSignature: { beats: 3, beatType: 4 },
      measureCount: 1,
    });
    page1 = addNoteToMeasure(page1, page1.measures[0].id, {
      pitch: 'C',
      octave: 4,
      duration: 'q',
    });

    let page2 = createBlankScore({
      title: 'Page Two',
      clef: 'bass',
      keySignature: 'F',
      timeSignature: { beats: 4, beatType: 4 },
      measureCount: 2,
    });
    page2 = addNoteToMeasure(page2, page2.measures[0].id, {
      pitch: 'E',
      octave: 3,
      duration: 'h',
    });
    page2 = addNoteToMeasure(page2, page2.measures[1].id, {
      pitch: 'G',
      octave: 3,
      duration: 'qr',
    });

    const merged = mergeScores([page1, page2]);
    expect(merged.title).toBe('Page One');
    expect(merged.clef).toBe('treble');
    expect(merged.keySignature).toBe('G');
    expect(merged.timeSignature).toEqual({ beats: 3, beatType: 4 });
    expect(merged.measures).toHaveLength(3);
    expect(merged.measures[0].notes[0].pitch).toBe('C');
    expect(merged.measures[1].notes[0].pitch).toBe('E');
    expect(merged.measures[2].notes[0].duration).toBe('qr');
  });

  it('mergeScores assigns fresh measure and note ids', () => {
    let page1 = createBlankScore({ measureCount: 1 });
    page1 = addNoteToMeasure(page1, page1.measures[0].id, {
      pitch: 'C',
      octave: 4,
      duration: 'q',
      grace: [{ id: 'grace-old', pitch: 'D', octave: 4, duration: '16', slash: true }],
    });
    let page2 = createBlankScore({ measureCount: 1 });
    page2 = addNoteToMeasure(page2, page2.measures[0].id, {
      pitch: 'E',
      octave: 4,
      duration: 'q',
    });

    const originalIds = new Set([
      page1.measures[0].id,
      page1.measures[0].notes[0].id,
      page1.measures[0].notes[0].grace![0].id,
      page2.measures[0].id,
      page2.measures[0].notes[0].id,
    ]);

    const merged = mergeScores([page1, page2]);
    const mergedIds = [
      merged.measures[0].id,
      merged.measures[0].notes[0].id,
      merged.measures[0].notes[0].grace![0].id,
      merged.measures[1].id,
      merged.measures[1].notes[0].id,
    ];
    expect(new Set(mergedIds).size).toBe(mergedIds.length);
    for (const id of mergedIds) {
      expect(originalIds.has(id)).toBe(false);
    }
  });

  it('mergeScores skips later pages that have no notes', () => {
    let page1 = createBlankScore({ measureCount: 1 });
    page1 = addNoteToMeasure(page1, page1.measures[0].id, {
      pitch: 'C',
      octave: 4,
      duration: 'q',
    });
    const blankPage = createBlankScore({ measureCount: 2 });
    const merged = mergeScores([page1, blankPage]);
    expect(merged.measures).toHaveLength(1);
    expect(merged.measures[0].notes[0].pitch).toBe('C');
  });
});
