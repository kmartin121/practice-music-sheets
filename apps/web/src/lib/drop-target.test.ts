import { describe, expect, it } from 'vitest';
import { dropTargetFromX } from '../components/ScoreCanvas';

describe('dropTargetFromX', () => {
  const centers = [40, 80, 120];
  const allChordable = [true, true, true];

  it('stacks onto a note when dropped on its center', () => {
    expect(dropTargetFromX(82, centers, allChordable, 200)).toEqual({
      kind: 'chord',
      noteIndex: 1,
      x: 80,
    });
  });

  it('inserts between notes when dropped in the gap', () => {
    expect(dropTargetFromX(100, centers, allChordable, 200)).toMatchObject({
      kind: 'insert',
      index: 2,
    });
  });

  it('never stacks onto rests', () => {
    expect(dropTargetFromX(80, centers, [true, false, true], 200).kind).toBe('insert');
  });

  it('shrinks the stacking zone for tightly spaced notes', () => {
    const tight = [40, 56, 72];
    expect(dropTargetFromX(61, tight, allChordable, 200).kind).toBe('insert');
    expect(dropTargetFromX(58, tight, allChordable, 200)).toMatchObject({ kind: 'chord', noteIndex: 1 });
  });
});
