import { describe, expect, it } from 'vitest';
import { createBlankScore, addNoteToMeasure } from './score-model';
import {
  durationToVex,
  pitchToVexKey,
  scoreToRenderInstructions,
  yToPitch,
} from './vexflow-render';

describe('vexflow-render helpers', () => {
  it('maps pitch and duration to VexFlow keys', () => {
    expect(pitchToVexKey('C', 4, 'sharp')).toBe('c#/4');
    expect(durationToVex('q')).toBe('q');
    expect(durationToVex('8r')).toBe('8r');
  });

  it('maps staff Y to nearest pitch', () => {
    const topLine = yToPitch(40, 40, 10, 'treble');
    expect(topLine.pitch).toBe('F');
    expect(topLine.octave).toBe(5);
  });

  it('builds render instructions including hidden measures', () => {
    let score = createBlankScore({ measureCount: 1 });
    score = addNoteToMeasure(score, score.measures[0].id, {
      pitch: 'G',
      octave: 4,
      duration: 'q',
    });
    const hidden = new Set([score.measures[0].id]);
    const render = scoreToRenderInstructions(score, hidden);
    expect(render.measures[0].hidden).toBe(true);
    expect(render.measures[0].notes[0].keys[0]).toBe('g/4');
  });
});
