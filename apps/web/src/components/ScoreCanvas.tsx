import { useEffect, useRef } from 'react';
import {
  Renderer,
  Stave,
  StaveNote,
  GraceNote,
  GraceNoteGroup,
  Voice,
  Formatter,
  Accidental,
  Beam,
  Fraction,
  Stem,
  Dot,
  Tuplet,
} from 'vexflow';
import type { Score } from '../lib/score-model';
import { scoreToRenderInstructions, snapStaffY, yToPitch } from '../lib/vexflow-render';
import type { RenderMeasure, RenderScore } from '../lib/vexflow-render';
import type { Duration } from '../lib/score-model';
import { formatMeasureBeats, isRest, measureBeatStatus } from '../lib/score-model';
import { PITCHED_NOTE_MIME, paletteLabelFor } from './NotePalette';

const EMPTY_MEASURE_WIDTH = 120;
const DEFAULT_SYSTEM_START_EXTRA = 80;
const STAVE_HEIGHT = 120;
const SYSTEM_GAP = 40;
const MEASURES_PER_SYSTEM = 4;
const LINE_SPACING = 10;
const STAFF_TOP_OFFSET = 40;
/** Keep in sync with `--selected` in index.css (VexFlow styles need a literal color). */
const SELECTED_COLOR = '#16a34a';
const MEASURE_PADDING_PX = 26;
const ACCIDENTAL_ALLOWANCE_PX = 10;
const GRACE_ALLOWANCE_PX = 12;
const UNBEAMED_PADDING_PX = 10;
const THIRTY_SECOND_SLOT_PX = 16;
const SLOT_STEP_PX = 4;
const SVG_NS = 'http://www.w3.org/2000/svg';
const HIDDEN_HATCH_ID = 'hidden-measure-hatch';

const PALETTE_MIME = 'application/x-note-palette';

type Props = {
  score: Score;
  practiceMode: boolean;
  showMeasureNumbers: boolean;
  /** Troubleshooting tags under each note: stored value and the palette button it maps to. */
  showNoteLabels?: boolean;
  hiddenMeasureIds: ReadonlySet<string>;
  selectedNoteId: string | null;
  onSelectNote: (noteId: string | null) => void;
  onToggleMeasureHidden: (measureId: string) => void;
  onDropNote: (
    measureId: string,
    duration: Duration,
    pitch: string,
    octave: number,
    index?: number,
  ) => void;
  onAddChordTone: (noteId: string, pitch: string, octave: number) => void;
  onMoveNote: (
    noteId: string,
    measureId: string,
    pitch: string,
    octave: number,
    index?: number,
  ) => void;
};

type PalettePayload = {
  duration: Duration;
};

type MeasureLayout = {
  hit: HTMLDivElement;
  guide: HTMLDivElement;
  guideH: HTMLDivElement;
  guideV: HTMLDivElement;
  noteCentersX: number[];
  noteIds: string[];
  chordable: boolean[];
};

/** Snap the drop cursor to an insert slot (before/between/after notes). */
function insertSlotFromX(
  localX: number,
  noteCentersX: number[],
  measureWidth: number,
): { index: number; x: number } {
  const left = 28;
  const right = measureWidth - 12;
  if (noteCentersX.length === 0) {
    return { index: 0, x: Math.min(Math.max(localX, left), right) };
  }

  const slots: { index: number; x: number }[] = [
    { index: 0, x: Math.max(left, noteCentersX[0] - (noteCentersX[0] - left) / 2) },
  ];
  for (let i = 0; i < noteCentersX.length - 1; i += 1) {
    slots.push({ index: i + 1, x: (noteCentersX[i] + noteCentersX[i + 1]) / 2 });
  }
  const last = noteCentersX[noteCentersX.length - 1];
  slots.push({
    index: noteCentersX.length,
    x: Math.min(right, last + (right - last) / 2),
  });

  let best = slots[0];
  let bestDist = Math.abs(localX - best.x);
  for (let i = 1; i < slots.length; i += 1) {
    const dist = Math.abs(localX - slots[i].x);
    if (dist < bestDist) {
      best = slots[i];
      bestDist = dist;
    }
  }
  return best;
}

const CHORD_SNAP_MAX_PX = 8;

export type DropTarget =
  | { kind: 'insert'; index: number; x: number }
  | { kind: 'chord'; noteIndex: number; x: number };

/**
 * Dropping right on a note stacks onto it as a chord; anywhere else inserts.
 * The stacking zone shrinks with tight spacing so insert slots stay reachable.
 */
export function dropTargetFromX(
  localX: number,
  noteCentersX: number[],
  chordable: boolean[],
  measureWidth: number,
): DropTarget {
  for (let i = 0; i < noteCentersX.length; i += 1) {
    if (!chordable[i]) continue;
    const center = noteCentersX[i];
    const neighborGaps = [noteCentersX[i - 1], noteCentersX[i + 1]]
      .filter((x): x is number => x != null)
      .map((x) => Math.abs(x - center));
    const zone = Math.min(CHORD_SNAP_MAX_PX, ...neighborGaps.map((gap) => gap * 0.3));
    if (Math.abs(localX - center) <= zone) return { kind: 'chord', noteIndex: i, x: center };
  }
  return { kind: 'insert', ...insertSlotFromX(localX, noteCentersX, measureWidth) };
}

/**
 * Ink bounds of a note's heads (or rest glyph) in SVG/overlay pixels, excluding stem and flag.
 * DOM rects of VexFlow's glyph `<text>` span the font's whole line box, so use VexFlow's
 * canvas-measured metrics instead.
 */
function noteheadBox(note: StaveNote): { left: number; top: number; right: number; bottom: number } {
  const boxes = note.noteHeads
    .map((head) => head.getBoundingBox())
    .filter((b) => b.getW() > 0 && b.getH() > 0 && Number.isFinite(b.getX() + b.getY()));
  if (boxes.length > 0) {
    return {
      left: Math.min(...boxes.map((b) => b.getX())),
      top: Math.min(...boxes.map((b) => b.getY())),
      right: Math.max(...boxes.map((b) => b.getX() + b.getW())),
      bottom: Math.max(...boxes.map((b) => b.getY() + b.getH())),
    };
  }
  const { yTop, yBottom } = note.getNoteHeadBounds();
  return {
    left: note.getNoteHeadBeginX(),
    top: Math.min(yTop, yBottom) - LINE_SPACING / 2,
    right: note.getNoteHeadEndX(),
    bottom: Math.max(yTop, yBottom) + LINE_SPACING / 2,
  };
}

/** Noteheads plus stem, for the click/drag target. */
function noteHitBox(note: StaveNote): { left: number; top: number; right: number; bottom: number } {
  const box = noteheadBox(note);
  if (note.isRest() || !note.hasStem()) return box;
  const { topY, baseY } = note.getStemExtents();
  const stemX = note.getStemX();
  if (![topY, baseY, stemX].every(Number.isFinite)) return box;
  return {
    left: Math.min(box.left, stemX),
    top: Math.min(box.top, topY, baseY),
    right: Math.max(box.right, stemX),
    bottom: Math.max(box.bottom, topY, baseY),
  };
}

const VEX_BASE_BEATS: Record<string, number> = {
  w: 4,
  h: 2,
  q: 1,
  '8': 0.5,
  '16': 0.25,
  '32': 0.125,
};

/**
 * Horizontal space for one note: 32nd = 16px, and each doubling of note value
 * adds 4px (16th 20, 8th 24, quarter 28, half 32, whole 36).
 */
export function noteSlotWidth(vexDuration: string): number {
  const bare = vexDuration.replace(/r$/, '');
  const dots = /d*$/.exec(bare)?.[0].length ?? 0;
  const base = VEX_BASE_BEATS[bare.slice(0, bare.length - dots)] ?? 1;
  const beats = base * (2 - 0.5 ** dots);
  const doublings = Math.max(0, Math.log2(beats / VEX_BASE_BEATS['32']));
  return THIRTY_SECOND_SLOT_PX + SLOT_STEP_PX * doublings;
}

type SizedNote = {
  duration: string;
  accidental?: string;
  grace?: ReadonlyArray<unknown>;
  beamed?: boolean;
};

function measureBaseWidth(notes: ReadonlyArray<SizedNote>): number {
  if (notes.length === 0) return EMPTY_MEASURE_WIDTH;
  const content = notes.reduce(
    (sum, n) =>
      sum +
      noteSlotWidth(n.duration) +
      (n.beamed ? 0 : UNBEAMED_PADDING_PX) +
      (n.accidental ? ACCIDENTAL_ALLOWANCE_PX : 0) +
      (n.grace?.length ?? 0) * GRACE_ALLOWANCE_PX,
    0,
  );
  return MEASURE_PADDING_PX + content;
}

/**
 * Column widths shared across systems so barlines line up vertically.
 * Each column uses the max content width of that slot on any system;
 * the first column also gets room for the clef/key/time signature.
 */
export function columnStaveWidths(
  measures: ReadonlyArray<{ notes: ReadonlyArray<SizedNote> }>,
  measuresPerSystem = MEASURES_PER_SYSTEM,
  systemStartExtra = DEFAULT_SYSTEM_START_EXTRA,
): number[] {
  const columnBase = Array.from({ length: measuresPerSystem }, () => 0);
  for (let index = 0; index < measures.length; index += 1) {
    const col = index % measuresPerSystem;
    columnBase[col] = Math.max(columnBase[col], measureBaseWidth(measures[index].notes));
  }
  return columnBase.map((base, col) => {
    const width = base || EMPTY_MEASURE_WIDTH;
    return col === 0 ? width + systemStartExtra : width;
  });
}

type BuiltMeasure = { vfNotes: StaveNote[]; tuplets: Tuplet[]; beams: Beam[] };

function buildMeasureNotes(
  measure: RenderMeasure,
  clef: RenderScore['clef'],
  selectedNoteId: string | null,
): BuiltMeasure {
  const vfNotes = measure.notes.map((n) => {
    const note = new StaveNote({ keys: n.keys, duration: n.duration, clef, autoStem: true });
    if (n.accidental && !n.isRest) {
      note.addModifier(new Accidental(n.accidental));
    }
    if (n.dots && n.dots > 0) {
      for (let d = 0; d < n.dots; d += 1) {
        Dot.buildAndAttach([note], { all: true });
      }
    }
    if (n.grace && n.grace.length > 0) {
      const graceNotes = n.grace.map((g) => {
        const grace = new GraceNote({ keys: g.keys, duration: g.duration, slash: g.slash ?? false });
        if (g.accidental) {
          grace.addModifier(new Accidental(g.accidental));
        }
        return grace;
      });
      note.addModifier(new GraceNoteGroup(graceNotes).beamNotes());
    }
    if (n.id === selectedNoteId) {
      note.setStyle({ fillStyle: SELECTED_COLOR, strokeStyle: SELECTED_COLOR });
    }
    note.setAttribute('id', n.id);
    return note;
  });

  // Tuplets rescale note ticks, so they must exist before beaming and formatting.
  const tuplets = measure.tuplets.map(
    (group) =>
      new Tuplet(vfNotes.slice(group.start, group.end + 1), {
        numNotes: group.actual,
        notesOccupied: group.normal,
        bracketed: true,
      }),
  );

  // Beams must be created before format/draw so flags are suppressed.
  // One beat per beam group (fits 4/4 16th runs of four).
  const beams = Beam.generateBeams(vfNotes, {
    beamRests: false,
    stemDirection: Stem.UP,
    groups: [new Fraction(1, 4)],
  });

  return { vfNotes, tuplets, beams };
}

/** Width the clef, key and time signature add ahead of the first note. */
function systemStartExtra(clef: string, keySignature: string, timeSignature: string): number {
  const plain = new Stave(0, 0, 500);
  const decorated = new Stave(0, 0, 500)
    .addClef(clef)
    .addKeySignature(keySignature)
    .addTimeSignature(timeSignature);
  return Math.max(0, decorated.getNoteStartX() - plain.getNoteStartX());
}

function ensureHiddenMeasureDefs(svg: SVGSVGElement): void {
  if (svg.querySelector(`#${HIDDEN_HATCH_ID}`)) return;
  let defs = svg.querySelector('defs');
  if (!defs) {
    defs = document.createElementNS(SVG_NS, 'defs');
    svg.insertBefore(defs, svg.firstChild);
  }
  const pattern = document.createElementNS(SVG_NS, 'pattern');
  pattern.setAttribute('id', HIDDEN_HATCH_ID);
  pattern.setAttribute('patternUnits', 'userSpaceOnUse');
  pattern.setAttribute('width', '9');
  pattern.setAttribute('height', '9');
  const line = document.createElementNS(SVG_NS, 'line');
  line.setAttribute('x1', '0');
  line.setAttribute('y1', '9');
  line.setAttribute('x2', '9');
  line.setAttribute('y2', '0');
  line.setAttribute('class', 'hidden-measure-hatch-line');
  pattern.appendChild(line);
  defs.appendChild(pattern);
}

/**
 * Draw a print-safe memorization cue into the SVG so it scales with the score.
 * Empty staff + hatch reads as "notes removed for practice" in color and B&W.
 */
export function appendHiddenMeasureCue(
  svg: SVGSVGElement,
  x: number,
  y: number,
  staveWidth: number,
): void {
  ensureHiddenMeasureDefs(svg);
  const g = document.createElementNS(SVG_NS, 'g');
  g.setAttribute('class', 'hidden-measure-cue');
  g.setAttribute('aria-label', 'Hidden for memorization');

  const inset = 3;
  const left = x + inset;
  const top = y + STAFF_TOP_OFFSET - 8;
  const width = Math.max(12, staveWidth - inset * 2);
  const height = LINE_SPACING * 4 + 16;

  const fill = document.createElementNS(SVG_NS, 'rect');
  fill.setAttribute('x', String(left));
  fill.setAttribute('y', String(top));
  fill.setAttribute('width', String(width));
  fill.setAttribute('height', String(height));
  fill.setAttribute('class', 'hidden-measure-cue-fill');
  g.appendChild(fill);

  const hatch = document.createElementNS(SVG_NS, 'rect');
  hatch.setAttribute('x', String(left));
  hatch.setAttribute('y', String(top));
  hatch.setAttribute('width', String(width));
  hatch.setAttribute('height', String(height));
  hatch.setAttribute('fill', `url(#${HIDDEN_HATCH_ID})`);
  hatch.setAttribute('class', 'hidden-measure-cue-hatch');
  g.appendChild(hatch);

  const label = document.createElementNS(SVG_NS, 'text');
  label.setAttribute('x', String(left + width / 2));
  label.setAttribute('y', String(top + height / 2 + 4));
  label.setAttribute('text-anchor', 'middle');
  label.setAttribute('class', 'hidden-measure-cue-label');
  label.textContent = 'memorize';
  g.appendChild(label);

  svg.appendChild(g);
}

export function ScoreCanvas({
  score,
  practiceMode,
  showMeasureNumbers,
  showNoteLabels = false,
  hiddenMeasureIds,
  selectedNoteId,
  onSelectNote,
  onToggleMeasureHidden,
  onDropNote,
  onAddChordTone,
  onMoveNote,
}: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const overlayRef = useRef<HTMLDivElement>(null);
  const layoutsRef = useRef<Map<string, MeasureLayout>>(new Map());
  const callbacksRef = useRef({
    onSelectNote,
    onToggleMeasureHidden,
    onDropNote,
    onAddChordTone,
    onMoveNote,
    clef: score.clef,
  });
  callbacksRef.current = {
    onSelectNote,
    onToggleMeasureHidden,
    onDropNote,
    onAddChordTone,
    onMoveNote,
    clef: score.clef,
  };

  useEffect(() => {
    const container = containerRef.current;
    const overlay = overlayRef.current;
    if (!container || !overlay) return;

    container.innerHTML = '';
    overlay.innerHTML = '';
    layoutsRef.current = new Map();

    const instructions = scoreToRenderInstructions(score, hiddenMeasureIds);
    const systemCount = Math.max(1, Math.ceil(instructions.measures.length / MEASURES_PER_SYSTEM));

    type LaidOutMeasure = {
      measure: (typeof instructions.measures)[number];
      measureNumber: number;
      systemIndex: number;
      measureInSystem: number;
      x: number;
      y: number;
      staveWidth: number;
    };

    const builtMeasures = instructions.measures.map((measure) =>
      measure.notes.length > 0
        ? buildMeasureNotes(measure, instructions.clef, selectedNoteId)
        : null,
    );

    const laidOut: LaidOutMeasure[] = [];
    let maxRight = 40;
    const staveWidths = columnStaveWidths(
      instructions.measures.map((measure, index) => ({
        notes: measure.notes.map((note, i) => ({
          ...note,
          beamed: builtMeasures[index]?.vfNotes[i].hasBeam() ?? false,
        })),
      })),
      MEASURES_PER_SYSTEM,
      systemStartExtra(instructions.clef, instructions.keySignature, instructions.timeSignature),
    );
    for (let index = 0; index < instructions.measures.length; index += 1) {
      const measure = instructions.measures[index];
      const systemIndex = Math.floor(index / MEASURES_PER_SYSTEM);
      const measureInSystem = index % MEASURES_PER_SYSTEM;
      const staveWidth = staveWidths[measureInSystem];
      const x =
        measureInSystem === 0
          ? 20
          : laidOut[index - 1].x + laidOut[index - 1].staveWidth;
      const y = 20 + systemIndex * (STAVE_HEIGHT + SYSTEM_GAP);
      laidOut.push({
        measure,
        measureNumber: index,
        systemIndex,
        measureInSystem,
        x,
        y,
        staveWidth,
      });
      maxRight = Math.max(maxRight, x + staveWidth);
    }

    const width = maxRight + 40;
    const height = systemCount * (STAVE_HEIGHT + SYSTEM_GAP) + 40;

    const renderer = new Renderer(container, Renderer.Backends.SVG);
    renderer.resize(width, height);
    const context = renderer.getContext();
    context.setFont('Lora, Georgia, serif', 14);
    const svg = container.querySelector('svg');

    const clearAllGuides = () => {
      for (const layout of layoutsRef.current.values()) {
        layout.hit.classList.remove('drag-over');
        layout.guide.style.display = 'none';
      }
    };

    const showGuide = (
      measureId: string,
      clientX: number,
      clientY: number,
      allowChord = false,
    ) => {
      clearAllGuides();
      const layout = layoutsRef.current.get(measureId);
      if (!layout) return;
      const rect = layout.hit.getBoundingClientRect();
      const localX = clientX - rect.left;
      const snappedY = snapStaffY(clientY - rect.top, STAFF_TOP_OFFSET, LINE_SPACING);
      const target = allowChord
        ? dropTargetFromX(localX, layout.noteCentersX, layout.chordable, rect.width)
        : { kind: 'insert' as const, ...insertSlotFromX(localX, layout.noteCentersX, rect.width) };
      layout.guideH.style.top = `${snappedY}px`;
      layout.guideV.style.left = `${target.x}px`;
      layout.guide.classList.toggle('is-chord', target.kind === 'chord');
      layout.guide.style.display = 'block';
      layout.hit.classList.add('drag-over');
    };

    const measureAtPoint = (clientX: number, clientY: number): MeasureLayout | null => {
      for (const layout of layoutsRef.current.values()) {
        const rect = layout.hit.getBoundingClientRect();
        if (
          clientX >= rect.left &&
          clientX <= rect.right &&
          clientY >= rect.top &&
          clientY <= rect.bottom
        ) {
          return layout;
        }
      }
      return null;
    };

    const placeFromPoint = (measureId: string, clientX: number, clientY: number) => {
      const layout = layoutsRef.current.get(measureId);
      if (!layout) return null;
      const rect = layout.hit.getBoundingClientRect();
      const localX = clientX - rect.left;
      const localY = clientY - rect.top;
      const { pitch, octave } = yToPitch(
        localY,
        STAFF_TOP_OFFSET,
        LINE_SPACING,
        callbacksRef.current.clef,
      );
      const slot = insertSlotFromX(localX, layout.noteCentersX, rect.width);
      return { pitch, octave, index: slot.index };
    };

    laidOut.forEach(({ measure, measureNumber, measureInSystem, x, y, staveWidth }) => {
      const stave = new Stave(x, y, staveWidth);
      if (measureInSystem === 0) {
        stave.addClef(instructions.clef);
        stave.addKeySignature(instructions.keySignature);
        stave.addTimeSignature(instructions.timeSignature);
      }
      stave.setContext(context).draw();

      if (measure.hidden && svg instanceof SVGSVGElement) {
        appendHiddenMeasureCue(svg, x, y, staveWidth);
      }

      if (showMeasureNumbers) {
        const numberLabel = document.createElement('div');
        numberLabel.className = 'measure-number no-print';
        const scoreMeasure = score.measures[measureNumber];
        const beatStatus = measureBeatStatus(score, scoreMeasure);
        if (beatStatus === 'short' || beatStatus === 'over') {
          numberLabel.classList.add(`is-${beatStatus}`);
        }
        numberLabel.textContent = `${measureNumber} · ${formatMeasureBeats(score, scoreMeasure)}`;
        numberLabel.style.left = `${x}px`;
        numberLabel.style.top = `${y + STAVE_HEIGHT - 18}px`;
        numberLabel.style.width = `${staveWidth}px`;
        overlay.appendChild(numberLabel);
      }

      const hit = document.createElement('div');
      hit.className = 'measure-hit';
      hit.dataset.measureId = measure.id;
      hit.dataset.measureNumber = String(measureNumber);
      hit.style.left = `${x}px`;
      hit.style.top = `${y}px`;
      hit.style.width = `${staveWidth}px`;
      hit.style.height = `${STAVE_HEIGHT}px`;
      if (measure.hidden) hit.classList.add('measure-hidden');
      if (practiceMode) hit.classList.add('practice-active');

      const guide = document.createElement('div');
      guide.className = 'drop-guide';
      guide.setAttribute('aria-hidden', 'true');
      const guideH = document.createElement('div');
      guideH.className = 'drop-guide-h';
      const guideV = document.createElement('div');
      guideV.className = 'drop-guide-v';
      guide.append(guideH, guideV);
      hit.appendChild(guide);

      const layout: MeasureLayout = {
        hit,
        guide,
        guideH,
        guideV,
        noteCentersX: [],
        noteIds: [],
        chordable: [],
      };
      layoutsRef.current.set(measure.id, layout);

      hit.addEventListener('click', () => {
        if (practiceMode) callbacksRef.current.onToggleMeasureHidden(measure.id);
        else callbacksRef.current.onSelectNote(null);
      });
      hit.addEventListener('dragover', (e) => {
        e.preventDefault();
        if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy';
        const pitched = Array.from(e.dataTransfer?.types ?? []).includes(PITCHED_NOTE_MIME);
        showGuide(measure.id, e.clientX, e.clientY, pitched);
      });
      hit.addEventListener('dragleave', (e) => {
        if (e.relatedTarget instanceof Node && hit.contains(e.relatedTarget)) return;
        hit.classList.remove('drag-over');
        guide.style.display = 'none';
      });
      hit.addEventListener('drop', (e) => {
        e.preventDefault();
        clearAllGuides();
        const raw = e.dataTransfer?.getData(PALETTE_MIME);
        if (!raw) return;
        let payload: PalettePayload;
        try {
          payload = JSON.parse(raw) as PalettePayload;
        } catch {
          return;
        }
        const placed = placeFromPoint(measure.id, e.clientX, e.clientY);
        if (!placed) return;
        const rect = hit.getBoundingClientRect();
        const target = isRest(payload.duration)
          ? null
          : dropTargetFromX(e.clientX - rect.left, layout.noteCentersX, layout.chordable, rect.width);
        if (target?.kind === 'chord') {
          callbacksRef.current.onAddChordTone(
            layout.noteIds[target.noteIndex],
            placed.pitch,
            placed.octave,
          );
          return;
        }
        callbacksRef.current.onDropNote(
          measure.id,
          payload.duration,
          placed.pitch,
          placed.octave,
          placed.index,
        );
      });
      overlay.appendChild(hit);

      const built = builtMeasures[measureNumber];
      if (!measure.hidden && built) {
        const { vfNotes, tuplets, beams } = built;
        const voice = new Voice({
          numBeats: score.timeSignature.beats,
          beatValue: score.timeSignature.beatType,
        }).setStrict(false);
        voice.addTickables(vfNotes);
        voice.setStave(stave);
        // Format without justification, then pin each note to its fixed slot so
        // notes never stretch to fill the measure.
        new Formatter().joinVoices([voice]).format([voice], 0);
        let cursor = 0;
        vfNotes.forEach((vfNote, i) => {
          const tickContext = vfNote.getTickContext();
          const { notePx, totalLeftPx, totalRightPx } = tickContext.getMetrics();
          const padding = vfNote.hasBeam() ? 0 : UNBEAMED_PADDING_PX / 2;
          const noteX = cursor + padding + totalLeftPx;
          tickContext.setX(noteX);
          cursor =
            noteX +
            Math.max(noteSlotWidth(measure.notes[i].duration), notePx + totalRightPx) +
            padding;
        });
        voice.draw(context, stave);
        beams.forEach((beam) => beam.setContext(context).draw());
        tuplets.forEach((tuplet) => tuplet.setContext(context).draw());

        vfNotes.forEach((vfNote, i) => {
          const noteId = measure.notes[i]?.id;
          if (!noteId) return;
          const el = vfNote.getSVGElement();
          if (!el) return;

          layout.noteCentersX.push(vfNote.getAbsoluteX() - x);
          layout.noteIds.push(noteId);
          layout.chordable.push(!measure.notes[i].isRest);

          if (practiceMode) return;

          const scoreNote = score.measures[measureNumber]?.notes[i];
          if (showNoteLabels && scoreNote) {
            const button = paletteLabelFor(scoreNote.duration);
            const extras = [
              scoreNote.chord?.length ? `+${scoreNote.chord.length}` : '',
              scoreNote.tuplet ? `${scoreNote.tuplet.actual}:${scoreNote.tuplet.normal}` : '',
            ].filter(Boolean);
            const label = document.createElement('div');
            label.className = 'note-label no-print';
            if (noteId === selectedNoteId) label.classList.add('is-selected');
            if (!button) label.classList.add('is-unmapped');
            label.dataset.noteId = noteId;
            label.style.left = `${vfNote.getAbsoluteX() + 5}px`;
            // Alternate rows so neighbouring labels in dense bars (16ths, 32nds) don't overlap.
            label.style.top = `${y + STAVE_HEIGHT - 4 + (i % 2) * 22}px`;
            const code = document.createElement('span');
            code.textContent = [scoreNote.duration, ...extras].join(' ');
            const name = document.createElement('span');
            name.textContent = button ?? 'no button';
            label.append(code, name);
            label.title = `${scoreNote.pitch}${scoreNote.octave} · value "${scoreNote.duration}" · button: ${button ?? 'none'} · id ${noteId}`;
            overlay.appendChild(label);
          }

          const hitBox = noteHitBox(vfNote);
          const padX = 6;
          const padY = 4;
          const noteHit = document.createElement('div');
          noteHit.className = 'note-hit';
          if (noteId === selectedNoteId) noteHit.classList.add('is-selected');
          noteHit.dataset.noteId = noteId;
          noteHit.style.left = `${hitBox.left - padX}px`;
          noteHit.style.top = `${hitBox.top - padY}px`;
          noteHit.style.width = `${Math.max(hitBox.right - hitBox.left, 12) + padX * 2}px`;
          noteHit.style.height = `${Math.max(hitBox.bottom - hitBox.top, 12) + padY * 2}px`;
          noteHit.title = 'Drag to move note';

          if (noteId === selectedNoteId) {
            const box = noteheadBox(vfNote);
            const outlinePad = 3;
            const outline = document.createElement('div');
            outline.className = 'note-outline';
            outline.style.left = `${box.left - outlinePad}px`;
            outline.style.top = `${box.top - outlinePad}px`;
            outline.style.width = `${box.right - box.left + outlinePad * 2}px`;
            outline.style.height = `${box.bottom - box.top + outlinePad * 2}px`;
            overlay.appendChild(outline);
          }

          noteHit.addEventListener('pointerdown', (ev) => {
            if (ev.button !== 0) return;
            ev.preventDefault();
            ev.stopPropagation();

            const startX = ev.clientX;
            const startY = ev.clientY;
            let dragging = false;
            const pointerId = ev.pointerId;
            noteHit.classList.add('is-dragging');

            const onMove = (moveEv: PointerEvent) => {
              if (moveEv.pointerId !== pointerId) return;
              const dx = moveEv.clientX - startX;
              const dy = moveEv.clientY - startY;
              if (!dragging && dx * dx + dy * dy < 16) return;
              dragging = true;
              document.body.classList.add('note-dragging');
              const over = measureAtPoint(moveEv.clientX, moveEv.clientY);
              if (over) {
                const measureId = over.hit.dataset.measureId;
                if (measureId) showGuide(measureId, moveEv.clientX, moveEv.clientY);
              } else {
                clearAllGuides();
              }
            };

            const onUp = (upEv: PointerEvent) => {
              if (upEv.pointerId !== pointerId) return;
              window.removeEventListener('pointermove', onMove);
              window.removeEventListener('pointerup', onUp);
              window.removeEventListener('pointercancel', onUp);
              document.body.classList.remove('note-dragging');
              noteHit.classList.remove('is-dragging');
              clearAllGuides();

              if (!dragging) {
                callbacksRef.current.onSelectNote(noteId);
                return;
              }

              const over = measureAtPoint(upEv.clientX, upEv.clientY);
              const measureId = over?.hit.dataset.measureId;
              if (!measureId) return;
              const placed = placeFromPoint(measureId, upEv.clientX, upEv.clientY);
              if (!placed) return;
              callbacksRef.current.onMoveNote(
                noteId,
                measureId,
                placed.pitch,
                placed.octave,
                placed.index,
              );
              callbacksRef.current.onSelectNote(noteId);
            };

            window.addEventListener('pointermove', onMove);
            window.addEventListener('pointerup', onUp);
            window.addEventListener('pointercancel', onUp);
          });

          overlay.appendChild(noteHit);
        });
      }
    });

    return () => {
      document.body.classList.remove('note-dragging');
    };
  }, [score, practiceMode, showMeasureNumbers, showNoteLabels, hiddenMeasureIds, selectedNoteId]);

  return (
    <div className="score-canvas-wrap" data-testid="score-canvas">
      <div ref={containerRef} className="score-svg" />
      <div ref={overlayRef} className="score-overlay" />
    </div>
  );
}
