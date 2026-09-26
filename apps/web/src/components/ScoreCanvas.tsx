import { useEffect, useRef } from 'react';
import { Renderer, Stave, StaveNote, Voice, Formatter, Accidental, Beam } from 'vexflow';
import type { Score } from '../lib/score-model';
import { scoreToRenderInstructions, yToPitch } from '../lib/vexflow-render';
import type { Duration } from '../lib/score-model';

const MEASURE_WIDTH = 220;
const STAVE_HEIGHT = 120;
const SYSTEM_GAP = 40;
const MEASURES_PER_SYSTEM = 4;
const LINE_SPACING = 10;
const STAFF_TOP_OFFSET = 40;

type Props = {
  score: Score;
  practiceMode: boolean;
  hiddenMeasureIds: ReadonlySet<string>;
  selectedNoteId: string | null;
  onSelectNote: (noteId: string | null) => void;
  onToggleMeasureHidden: (measureId: string) => void;
  onDropNote: (measureId: string, duration: Duration, pitch: string, octave: number) => void;
};

type PalettePayload = {
  duration: Duration;
};

export function ScoreCanvas({
  score,
  practiceMode,
  hiddenMeasureIds,
  selectedNoteId,
  onSelectNote,
  onToggleMeasureHidden,
  onDropNote,
}: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const overlayRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const container = containerRef.current;
    const overlay = overlayRef.current;
    if (!container || !overlay) return;

    container.innerHTML = '';
    overlay.innerHTML = '';

    const instructions = scoreToRenderInstructions(score, hiddenMeasureIds);
    const systemCount = Math.max(1, Math.ceil(instructions.measures.length / MEASURES_PER_SYSTEM));
    const width = MEASURES_PER_SYSTEM * MEASURE_WIDTH + 40;
    const height = systemCount * (STAVE_HEIGHT + SYSTEM_GAP) + 40;

    const renderer = new Renderer(container, Renderer.Backends.SVG);
    renderer.resize(width, height);
    const context = renderer.getContext();
    context.setFont('Lora, Georgia, serif', 14);

    instructions.measures.forEach((measure, index) => {
      const systemIndex = Math.floor(index / MEASURES_PER_SYSTEM);
      const measureInSystem = index % MEASURES_PER_SYSTEM;
      const x = 20 + measureInSystem * MEASURE_WIDTH;
      const y = 20 + systemIndex * (STAVE_HEIGHT + SYSTEM_GAP);

      const stave = new Stave(x, y, MEASURE_WIDTH);
      if (measureInSystem === 0) {
        stave.addClef(instructions.clef);
        stave.addKeySignature(instructions.keySignature);
        stave.addTimeSignature(instructions.timeSignature);
      }
      stave.setContext(context).draw();

      const hit = document.createElement('div');
      hit.className = 'measure-hit';
      hit.dataset.measureId = measure.id;
      hit.style.left = `${x}px`;
      hit.style.top = `${y}px`;
      hit.style.width = `${MEASURE_WIDTH}px`;
      hit.style.height = `${STAVE_HEIGHT}px`;
      if (measure.hidden) {
        hit.classList.add('measure-hidden');
      }
      if (practiceMode) {
        hit.classList.add('practice-active');
      }
      hit.addEventListener('click', () => {
        if (practiceMode) {
          onToggleMeasureHidden(measure.id);
        }
      });
      hit.addEventListener('dragover', (e) => {
        e.preventDefault();
        hit.classList.add('drag-over');
      });
      hit.addEventListener('dragleave', () => hit.classList.remove('drag-over'));
      hit.addEventListener('drop', (e) => {
        e.preventDefault();
        hit.classList.remove('drag-over');
        const raw = e.dataTransfer?.getData('application/x-note-palette');
        if (!raw) return;
        let payload: PalettePayload;
        try {
          payload = JSON.parse(raw) as PalettePayload;
        } catch {
          return;
        }
        const rect = hit.getBoundingClientRect();
        const localY = e.clientY - rect.top;
        const { pitch, octave } = yToPitch(localY, STAFF_TOP_OFFSET, LINE_SPACING, score.clef);
        onDropNote(measure.id, payload.duration, pitch, octave);
      });
      overlay.appendChild(hit);

      if (!measure.hidden && measure.notes.length > 0) {
        const vfNotes = measure.notes.map((n) => {
          const note = new StaveNote({
            keys: n.keys,
            duration: n.duration,
            clef: instructions.clef,
          });
          if (n.accidental && !n.isRest) {
            note.addModifier(new Accidental(n.accidental));
          }
          if (n.id === selectedNoteId) {
            note.setStyle({ fillStyle: '#1a5f4a', strokeStyle: '#1a5f4a' });
          }
          note.setAttribute('id', n.id);
          return note;
        });

        const voice = new Voice({
          numBeats: score.timeSignature.beats,
          beatValue: score.timeSignature.beatType,
        }).setStrict(false);
        voice.addTickables(vfNotes);
        new Formatter().joinVoices([voice]).format([voice], MEASURE_WIDTH - 20);
        voice.draw(context, stave);

        // Beam consecutive 8ths/16ths so Audiveris-style groups look like the MusicXML.
        const beams = Beam.generateBeams(vfNotes, {
          beamRests: false,
        });
        beams.forEach((beam) => beam.setContext(context).draw());

        vfNotes.forEach((vfNote, i) => {
          const noteId = measure.notes[i]?.id;
          if (!noteId) return;
          const el = vfNote.getSVGElement();
          if (el) {
            el.style.cursor = 'pointer';
            el.addEventListener('click', (ev) => {
              ev.stopPropagation();
              if (!practiceMode) onSelectNote(noteId);
            });
          }
        });
      }
    });
  }, [
    score,
    practiceMode,
    hiddenMeasureIds,
    selectedNoteId,
    onSelectNote,
    onToggleMeasureHidden,
    onDropNote,
  ]);

  return (
    <div className="score-canvas-wrap" data-testid="score-canvas">
      <div ref={containerRef} className="score-svg" />
      <div ref={overlayRef} className="score-overlay" />
    </div>
  );
}
