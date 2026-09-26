import { describe, expect, it } from 'vitest';
import { columnStaveWidths } from '../components/ScoreCanvas';

describe('columnStaveWidths', () => {
  it('aligns columns to the densest measure in each slot across systems', () => {
    // System 0: light, System 1: dense in column 1 (index 5)
    const measures = [
      { notes: { length: 1 } },
      { notes: { length: 1 } },
      { notes: { length: 1 } },
      { notes: { length: 1 } },
      { notes: { length: 1 } },
      { notes: { length: 8 } },
      { notes: { length: 1 } },
      { notes: { length: 1 } },
    ];
    const widths = columnStaveWidths(measures, 4);
    expect(widths).toHaveLength(4);
    // Column 0 includes system-start padding; columns 1–3 do not.
    expect(widths[0]).toBeGreaterThan(widths[2]);
    // Column 1 sized for 8 notes; other non-start columns stay at default.
    expect(widths[1]).toBeGreaterThan(widths[2]);
    expect(widths[2]).toBe(widths[3]);
  });

  it('uses engraving width hints when larger than content', () => {
    const measures = [
      { notes: { length: 1 }, width: 400 },
      { notes: { length: 1 } },
      { notes: { length: 1 } },
      { notes: { length: 1 } },
    ];
    const widths = columnStaveWidths(measures, 4);
    expect(widths[0]).toBeGreaterThanOrEqual(400 + 80);
  });
});
