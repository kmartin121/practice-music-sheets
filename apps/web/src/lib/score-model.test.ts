import { describe, expect, it } from 'vitest';
import {
  addNoteToMeasure,
  createBlankScore,
  measureOverflows,
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
});
