import { describe, expect, it } from 'vitest';
import {
  addNoteToMeasure,
  createBlankScore,
  measureOverflows,
  reflowOverflow,
  relocateNote,
  removeNote,
} from './score-model';

describe('score-model', () => {
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
});
