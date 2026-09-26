import { describe, expect, it } from 'vitest';
import {
  appendHiddenMeasureCue,
  columnStaveWidths,
  noteSlotWidth,
} from '../components/ScoreCanvas';

const notes = (duration: string, count: number) =>
  Array.from({ length: count }, () => ({ duration }));

describe('noteSlotWidth', () => {
  it('gives longer notes more room than shorter ones', () => {
    expect(noteSlotWidth('h')).toBeGreaterThan(noteSlotWidth('q'));
    expect(noteSlotWidth('q')).toBeGreaterThan(noteSlotWidth('8'));
    expect(noteSlotWidth('8')).toBeGreaterThan(noteSlotWidth('16'));
    expect(noteSlotWidth('16')).toBeGreaterThan(noteSlotWidth('32'));
  });

  it('steps 4px between adjacent note values', () => {
    expect(noteSlotWidth('32')).toBe(16);
    expect(noteSlotWidth('16')).toBe(20);
    expect(noteSlotWidth('8')).toBe(24);
    expect(noteSlotWidth('q')).toBe(28);
    expect(noteSlotWidth('h')).toBe(32);
    expect(noteSlotWidth('w')).toBe(36);
  });

  it('treats rests and dotted values by their length', () => {
    expect(noteSlotWidth('16r')).toBe(noteSlotWidth('16'));
    expect(noteSlotWidth('qd')).toBeGreaterThan(noteSlotWidth('q'));
    expect(noteSlotWidth('qd')).toBeLessThan(noteSlotWidth('h'));
  });

  it('packs a bar of 16ths tighter per note than a bar of quarters', () => {
    const sixteenths = columnStaveWidths([{ notes: notes('16', 16) }], 1)[0];
    const quarters = columnStaveWidths([{ notes: notes('q', 16) }], 1)[0];
    expect(sixteenths).toBeLessThan(quarters);
  });
});

describe('columnStaveWidths', () => {
  it('aligns columns to the densest measure in each slot across systems', () => {
    // System 0: light, System 1: dense in column 1 (index 5)
    const measures = [
      { notes: notes('w', 1) },
      { notes: notes('w', 1) },
      { notes: notes('w', 1) },
      { notes: notes('w', 1) },
      { notes: notes('w', 1) },
      { notes: notes('8', 8) },
      { notes: notes('w', 1) },
      { notes: notes('w', 1) },
    ];
    const widths = columnStaveWidths(measures, 4);
    expect(widths).toHaveLength(4);
    // Column 0 includes system-start padding; columns 1–3 do not.
    expect(widths[0]).toBeGreaterThan(widths[2]);
    // Column 1 sized for 8 notes; other non-start columns stay at default.
    expect(widths[1]).toBeGreaterThan(widths[2]);
    expect(widths[2]).toBe(widths[3]);
  });

  it('sizes measures to their notes instead of a fixed minimum', () => {
    const beamedSixteenths = notes('16', 16).map((n) => ({ ...n, beamed: true }));
    const [empty, whole, sixteenths] = columnStaveWidths(
      [{ notes: [] }, { notes: notes('w', 1) }, { notes: beamedSixteenths }],
      3,
      0,
    );
    expect(whole).toBeLessThan(empty);
    expect(sixteenths).toBe(26 + 16 * 20);
  });

  it('pads unbeamed notes more than beamed ones', () => {
    const eighths = notes('8', 4);
    const [beamed, unbeamed] = columnStaveWidths(
      [{ notes: eighths.map((n) => ({ ...n, beamed: true })) }, { notes: eighths }],
      2,
      0,
    );
    expect(unbeamed - beamed).toBe(4 * 10);
  });

  it('adds the system-start width only to the first column', () => {
    const measures = [{ notes: notes('q', 4) }, { notes: notes('q', 4) }];
    const [first, second] = columnStaveWidths(measures, 2, 50);
    expect(first - second).toBe(50);
  });
});

describe('appendHiddenMeasureCue', () => {
  it('draws a memorize cue and shared hatch pattern into the SVG', () => {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    appendHiddenMeasureCue(svg, 20, 20, 220);
    appendHiddenMeasureCue(svg, 240, 20, 220);

    expect(svg.querySelectorAll('.hidden-measure-cue')).toHaveLength(2);
    expect(svg.querySelector('#hidden-measure-hatch')).toBeTruthy();
    expect(svg.querySelectorAll('#hidden-measure-hatch')).toHaveLength(1);
    expect(svg.querySelector('.hidden-measure-cue-label')?.textContent).toBe('memorize');
  });
});
