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

  it('includes chord tones as extra VexFlow keys', () => {
    let score = createBlankScore({ measureCount: 1 });
    score = addNoteToMeasure(score, score.measures[0].id, {
      pitch: 'F',
      octave: 4,
      duration: 'q',
      chord: [{ pitch: 'C', octave: 5 }],
    });
    const render = scoreToRenderInstructions(score);
    expect(render.measures[0].notes[0].keys).toEqual(['f/4', 'c/5']);
  });

  it('maps x noteheads into VexFlow key codes', () => {
    expect(pitchToVexKey('G', 5, undefined, 'x')).toBe('g/5/x');
    let score = createBlankScore({ measureCount: 1 });
    score = addNoteToMeasure(score, score.measures[0].id, {
      pitch: 'C',
      octave: 5,
      duration: 'q',
      chord: [{ pitch: 'G', octave: 5, notehead: 'x' }],
    });
    const render = scoreToRenderInstructions(score);
    expect(render.measures[0].notes[0].keys).toEqual(['c/5', 'g/5/x']);
  });
});
