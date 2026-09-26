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
} from 'vexflow';
import type { Score } from '../lib/score-model';
import { scoreToRenderInstructions, snapStaffY, yToPitch } from '../lib/vexflow-render';
import type { Duration } from '../lib/score-model';

const MEASURE_WIDTH = 220;
const SYSTEM_START_EXTRA = 80; // clef + key + time on the first bar of each system
const STAVE_HEIGHT = 120;
const SYSTEM_GAP = 40;
const MEASURES_PER_SYSTEM = 4;
const LINE_SPACING = 10;
const STAFF_TOP_OFFSET = 40;
const NOTE_SLOT_PX = 28;
const SVG_NS = 'http://www.w3.org/2000/svg';
const HIDDEN_HATCH_ID = 'hidden-measure-hatch';

const PALETTE_MIME = 'application/x-note-palette';

type Props = {
  score: Score;
  practiceMode: boolean;
  showMeasureNumbers: boolean;
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

function measureBaseWidth(noteCount: number, engravingWidth: number | undefined): number {
  const fromContent = Math.max(MEASURE_WIDTH, 48 + noteCount * NOTE_SLOT_PX);
  const fromXml = engravingWidth && engravingWidth > 0 ? engravingWidth : 0;
  return Math.max(fromContent, fromXml);
}

/**
 * Column widths shared across systems so barlines line up vertically.
 * Each column uses the max content width of that slot on any system;
 * the first column also gets clef/key/time padding.
 */
export function columnStaveWidths(
  measures: ReadonlyArray<{ notes: { length: number }; width?: number }>,
  measuresPerSystem = MEASURES_PER_SYSTEM,
): number[] {
  const columnBase = Array.from({ length: measuresPerSystem }, () => MEASURE_WIDTH);
  for (let index = 0; index < measures.length; index += 1) {
    const col = index % measuresPerSystem;
    const measure = measures[index];
    columnBase[col] = Math.max(
      columnBase[col],
      measureBaseWidth(measure.notes.length, measure.width),
    );
  }
  return columnBase.map((base, col) => (col === 0 ? base + SYSTEM_START_EXTRA : base));
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
  hiddenMeasureIds,
  selectedNoteId,
  onSelectNote,
  onToggleMeasureHidden,
  onDropNote,
  onMoveNote,
}: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const overlayRef = useRef<HTMLDivElement>(null);
  const layoutsRef = useRef<Map<string, MeasureLayout>>(new Map());
  const callbacksRef = useRef({
    onSelectNote,
    onToggleMeasureHidden,
    onDropNote,
    onMoveNote,
    clef: score.clef,
  });
  callbacksRef.current = {
    onSelectNote,
    onToggleMeasureHidden,
    onDropNote,
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

    const laidOut: LaidOutMeasure[] = [];
    let maxRight = 40;
    const staveWidths = columnStaveWidths(instructions.measures);
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

    const showGuide = (measureId: string, clientX: number, clientY: number) => {
      clearAllGuides();
      const layout = layoutsRef.current.get(measureId);
      if (!layout) return;
      const rect = layout.hit.getBoundingClientRect();
      const localX = clientX - rect.left;
      const snappedY = snapStaffY(clientY - rect.top, STAFF_TOP_OFFSET, LINE_SPACING);
      const slot = insertSlotFromX(localX, layout.noteCentersX, rect.width);
      layout.guideH.style.top = `${snappedY}px`;
      layout.guideV.style.left = `${slot.x}px`;
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

    // One beat per beam group (fits 4/4 16th runs of four).
    const beamGroups = [new Fraction(1, 4)];

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
        numberLabel.textContent = String(measureNumber);
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
      };
      layoutsRef.current.set(measure.id, layout);

      hit.addEventListener('click', () => {
        if (practiceMode) callbacksRef.current.onToggleMeasureHidden(measure.id);
        else callbacksRef.current.onSelectNote(null);
      });
      hit.addEventListener('dragover', (e) => {
        e.preventDefault();
        if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy';
        showGuide(measure.id, e.clientX, e.clientY);
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
        callbacksRef.current.onDropNote(
          measure.id,
          payload.duration,
          placed.pitch,
          placed.octave,
          placed.index,
        );
      });
      overlay.appendChild(hit);

      if (!measure.hidden && measure.notes.length > 0) {
        const vfNotes = measure.notes.map((n) => {
          const note = new StaveNote({
            keys: n.keys,
            duration: n.duration,
            clef: instructions.clef,
            autoStem: true,
          });
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
              const grace = new GraceNote({
                keys: g.keys,
                duration: g.duration,
                slash: g.slash ?? false,
              });
              if (g.accidental) {
                grace.addModifier(new Accidental(g.accidental));
              }
              return grace;
            });
            note.addModifier(new GraceNoteGroup(graceNotes).beamNotes());
          }
          if (n.id === selectedNoteId) {
            note.setStyle({ fillStyle: '#c2410c', strokeStyle: '#c2410c' });
          }
          note.setAttribute('id', n.id);
          return note;
        });

        // Beams must be created before format/draw so flags are suppressed.
        const beams = Beam.generateBeams(vfNotes, {
          beamRests: false,
          stemDirection: Stem.UP,
          groups: beamGroups,
        });

        const voice = new Voice({
          numBeats: score.timeSignature.beats,
          beatValue: score.timeSignature.beatType,
        }).setStrict(false);
        voice.addTickables(vfNotes);
        // formatToStave reserves Stave.defaultPadding so the last note
        // sits off the end bar similarly to the first note after the start bar.
        new Formatter().joinVoices([voice]).formatToStave([voice], stave);
        voice.draw(context, stave);
        beams.forEach((beam) => beam.setContext(context).draw());

        const overlayRect = overlay.getBoundingClientRect();

        vfNotes.forEach((vfNote, i) => {
          const noteId = measure.notes[i]?.id;
          if (!noteId) return;
          const el = vfNote.getSVGElement();
          if (!el) return;

          layout.noteCentersX.push(vfNote.getAbsoluteX() - x);

          if (practiceMode) return;

          const noteRect = el.getBoundingClientRect();
          const pad = 10;
          const noteHit = document.createElement('div');
          noteHit.className = 'note-hit';
          if (noteId === selectedNoteId) noteHit.classList.add('is-selected');
          noteHit.dataset.noteId = noteId;
          noteHit.style.left = `${noteRect.left - overlayRect.left - pad}px`;
          noteHit.style.top = `${noteRect.top - overlayRect.top - pad}px`;
          noteHit.style.width = `${Math.max(noteRect.width, 12) + pad * 2}px`;
          noteHit.style.height = `${Math.max(noteRect.height, 12) + pad * 2}px`;
          noteHit.title = 'Drag to move note';

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
  }, [score, practiceMode, showMeasureNumbers, hiddenMeasureIds, selectedNoteId]);

  return (
    <div className="score-canvas-wrap" data-testid="score-canvas">
      <div ref={containerRef} className="score-svg" />
      <div ref={overlayRef} className="score-overlay" />
    </div>
  );
}
