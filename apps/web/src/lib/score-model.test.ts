import { describe, expect, it } from 'vitest';
import {
  addNoteToMeasure,
  copyNote,
  createBlankScore,
  durationBeats,
  measureFilledBeats,
  measureOverflows,
  mergeScores,
  noteBeats,
  reflowOverflow,
  relocateNote,
  removeNote,
} from './score-model';

describe('score-model', () => {
  it('counts a dotted half rest as three beats', () => {
    expect(durationBeats('hdr')).toBe(3);
    expect(durationBeats('hd')).toBe(3);
  });

  it('scales tuplet notes to their sounding length', () => {
    expect(noteBeats({ duration: '8', tuplet: { actual: 3, normal: 2 } })).toBeCloseTo(1 / 3);
    expect(noteBeats({ duration: 'q' })).toBe(1);
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
