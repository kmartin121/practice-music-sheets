import { describe, expect, it } from 'vitest';
import { createBlankScore, addNoteToMeasure } from './score-model';
import {
  durationDots,
  durationToVex,
  pitchToVexKey,
  scoreToRenderInstructions,
  snapStaffY,
  yToPitch,
} from './vexflow-render';

describe('vexflow-render helpers', () => {
  it('maps pitch and duration to VexFlow keys', () => {
    expect(pitchToVexKey('C', 4, 'sharp')).toBe('c#/4');
    expect(durationToVex('q')).toBe('q');
    expect(durationToVex('8r')).toBe('8r');
    expect(durationToVex('hdr')).toBe('hdr');
    expect(durationDots('hdr')).toBe(1);
    expect(durationDots('hr')).toBe(0);
    expect(durationToVex('32')).toBe('32');
    expect(durationToVex('8d')).toBe('8d');
    expect(durationDots('8d')).toBe(1);
    expect(durationDots('qdr')).toBe(1);
  });

  it('includes augmentation dots on dotted half rests', () => {
    let score = createBlankScore({ measureCount: 1 });
    score = addNoteToMeasure(score, score.measures[0].id, {
      pitch: 'B',
      octave: 4,
      duration: 'hdr',
    });
    const render = scoreToRenderInstructions(score);
    expect(render.measures[0].notes[0]).toMatchObject({
      duration: 'hdr',
      isRest: true,
      dots: 1,
    });
  });

  it('maps staff Y to nearest pitch', () => {
    const topLine = yToPitch(40, 40, 10, 'treble');
    expect(topLine.pitch).toBe('F');
    expect(topLine.octave).toBe(5);
  });

  it('snaps Y to staff line/space steps', () => {
    expect(snapStaffY(42, 40, 10)).toBe(40);
    expect(snapStaffY(47, 40, 10)).toBe(45);
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

  it('maps grace notes (acciaccatura slash + x head) onto the principal render note', () => {
    let score = createBlankScore({ measureCount: 1 });
    score = addNoteToMeasure(score, score.measures[0].id, {
      pitch: 'C',
      octave: 5,
      duration: 'q',
      grace: [
        {
          id: 'grace-1',
          pitch: 'G',
          octave: 5,
          duration: '16',
          notehead: 'x',
          slash: true,
        },
      ],
    });
    const render = scoreToRenderInstructions(score);
    expect(render.measures[0].notes[0].grace).toEqual([
      { keys: ['g/5/x'], duration: '16', slash: true },
    ]);
  });
});
