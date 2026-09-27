import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { NotePalette } from '../components/NotePalette';
import { Editor } from '../components/Editor';
import { addNoteToMeasure, createBlankScore } from './score-model';

describe('NotePalette', () => {
  it('sets drag payload for a quarter note', () => {
    render(<NotePalette />);
    const quarter = screen.getByTitle('Quarter');
    const dataTransfer = {
      setData: vi.fn(),
      effectAllowed: '',
    };
    fireEvent.dragStart(quarter, { dataTransfer });
    expect(dataTransfer.setData).toHaveBeenCalledWith(
      'application/x-note-palette',
      JSON.stringify({ duration: 'q' }),
    );
  });

  it('highlights the button matching the selected note value', () => {
    const { rerender } = render(<NotePalette selectedDuration="q" />);
    expect(screen.getByTitle('Quarter')).toHaveClass('is-selected');
    expect(document.querySelectorAll('.palette-item.is-selected')).toHaveLength(1);

    rerender(<NotePalette selectedDuration="qd" />);
    expect(screen.getByTitle('Quarter')).toHaveClass('is-selected');

    rerender(<NotePalette selectedDuration="32" />);
    expect(screen.getByTitle('32nd')).toHaveClass('is-selected');

    rerender(<NotePalette selectedDuration="hdr" />);
    expect(screen.getByTitle('Dotted half rest')).toHaveClass('is-selected');

    rerender(<NotePalette selectedDuration={null} />);
    expect(document.querySelectorAll('.palette-item.is-selected')).toHaveLength(0);
  });
});

describe('Editor practice + dirty state', () => {
  it('toggles practice mode and marks dirty after meta edit', () => {
    const score = createBlankScore({ title: 'Test', measureCount: 2 });
    render(
      <Editor
        initialScore={score}
        meta={{ filename: null, fileHandle: null, dir: null }}
        onBack={() => undefined}
        onMetaChange={() => undefined}
      />,
    );

    fireEvent.click(screen.getByTestId('practice-toggle'));
    expect(screen.getByText(/Practice mode/i)).toBeInTheDocument();

    fireEvent.click(screen.getByTestId('measure-numbers-toggle'));
    expect(screen.getByTestId('measure-numbers-toggle')).toHaveAttribute('aria-pressed', 'false');
    fireEvent.click(screen.getByTestId('measure-numbers-toggle'));
    expect(screen.getByTestId('measure-numbers-toggle')).toHaveAttribute('aria-pressed', 'true');

    fireEvent.change(screen.getByLabelText('Score title'), {
      target: { value: 'Edited' },
    });
    expect(screen.getByText('Unsaved')).toBeInTheDocument();
  });

  it('renders 32nds, dotted eighths, and triplet brackets without VexFlow errors', () => {
    let score = createBlankScore({ title: 'Rhythms', measureCount: 2 });
    const [first, second] = score.measures.map((m) => m.id);
    const t = { actual: 3, normal: 2 };
    for (const note of [
      { pitch: 'F', octave: 4, duration: '8d' as const },
      { pitch: 'F', octave: 4, duration: '32' as const },
      { pitch: 'F', octave: 4, duration: '32' as const },
      { pitch: 'E', octave: 5, duration: 'q' as const },
      { pitch: 'F', octave: 4, duration: 'h' as const },
    ]) {
      score = addNoteToMeasure(score, first, note);
    }
    score = addNoteToMeasure(score, second, { pitch: 'F', octave: 4, duration: 'h' });
    score = addNoteToMeasure(score, second, {
      pitch: 'E',
      octave: 5,
      duration: 'q',
      tuplet: { ...t, start: true },
    });
    score = addNoteToMeasure(score, second, { pitch: 'E', octave: 5, duration: 'q', tuplet: t });
    score = addNoteToMeasure(score, second, {
      pitch: 'E',
      octave: 5,
      duration: 'q',
      tuplet: { ...t, stop: true },
    });

    render(
      <Editor
        initialScore={score}
        meta={{ filename: null, fileHandle: null, dir: null }}
        onBack={() => undefined}
        onMetaChange={() => undefined}
      />,
    );
    expect(document.querySelectorAll('.measure-hit')).toHaveLength(2);
    expect(document.querySelectorAll('.score-svg svg .vf-tuplet')).toHaveLength(1);
  });

  it('brackets the next three dropped notes as a triplet when the toggle is on', () => {
    render(
      <Editor
        initialScore={createBlankScore({ title: 'Triplets', measureCount: 1 })}
        meta={{ filename: null, fileHandle: null, dir: null }}
        onBack={() => undefined}
        onMetaChange={() => undefined}
      />,
    );
    const toggle = screen.getByTestId('triplet-toggle');
    const dropQuarter = () => {
      // jsdom lacks DragEvent; MouseEvent carries the coordinates the canvas reads.
      // Far right of the bar so drops insert instead of snapping onto a chord.
      const drop = new MouseEvent('drop', { bubbles: true, cancelable: true, clientX: 10_000, clientY: 50 });
      Object.defineProperty(drop, 'dataTransfer', {
        value: { getData: () => JSON.stringify({ duration: 'q' }), types: [] },
      });
      fireEvent(document.querySelector('.measure-hit')!, drop);
    };

    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute('aria-pressed', 'true');
    expect(toggle).toHaveTextContent('Triplet 0/3');
    expect(screen.getByTestId('palette-hint')).toHaveTextContent('Drag 3 more notes');

    dropQuarter();
    dropQuarter();
    expect(toggle).toHaveTextContent('Triplet 2/3');
    dropQuarter();

    expect(toggle).toHaveAttribute('aria-pressed', 'false');
    expect(toggle).toHaveTextContent(/^Triplet$/);
    expect(document.querySelectorAll('.note-hit')).toHaveLength(3);
    expect(document.querySelectorAll('.score-svg svg .vf-tuplet')).toHaveLength(1);

    dropQuarter();
    expect(document.querySelectorAll('.note-hit')).toHaveLength(4);
    fireEvent.click(screen.getByTestId('musicxml-toggle'));
    fireEvent.click(screen.getByText('Refresh from score'));
    const xml = (screen.getByLabelText('MusicXML source') as HTMLTextAreaElement).value;
    expect(xml.match(/<time-modification>/g)).toHaveLength(3);
    expect(xml.match(/<tuplet type="start"\/>/g)).toHaveLength(1);
    expect(xml.match(/<tuplet type="stop"\/>/g)).toHaveLength(1);
  });

  it('renders a memorize cue when a practice-hidden measure is active', () => {
    const score = createBlankScore({ title: 'Practice', measureCount: 2 });
    render(
      <Editor
        initialScore={score}
        meta={{ filename: null, fileHandle: null, dir: null }}
        onBack={() => undefined}
        onMetaChange={() => undefined}
      />,
    );

    fireEvent.click(screen.getByTestId('practice-toggle'));
    const hit = document.querySelector('.measure-hit');
    expect(hit).toBeTruthy();
    fireEvent.click(hit!);

    expect(document.querySelector('.measure-hit.measure-hidden')).toBeTruthy();
    expect(document.querySelectorAll('.hidden-measure-cue')).toHaveLength(1);
    expect(document.querySelector('.hidden-measure-cue-label')?.textContent).toBe('memorize');
  });

  it('diagnoses OMR imports with empty measures vs dropped notes', () => {
    const emptyScore = createBlankScore({ title: 'Empty', measureCount: 2 });
    const { rerender } = render(
      <Editor
        initialScore={emptyScore}
        meta={{
          filename: null,
          fileHandle: null,
          dir: null,
          fromOmr: true,
          sourceXml: '<score-partwise><part><measure/></part></score-partwise>',
        }}
        onBack={() => undefined}
        onMetaChange={() => undefined}
      />,
    );
    expect(screen.getByTestId('omr-summary')).toHaveTextContent(/Audiveris exported no notes/i);

    rerender(
      <Editor
        initialScore={emptyScore}
        meta={{
          filename: null,
          fileHandle: null,
          dir: null,
          fromOmr: true,
          sourceXml:
            '<score-partwise><part><measure><note><cue/><pitch><step>C</step><octave>4</octave></pitch></note></measure></part></score-partwise>',
        }}
        onBack={() => undefined}
        onMetaChange={() => undefined}
      />,
    );
    expect(screen.getByTestId('omr-summary')).toHaveTextContent(/none mapped onto the staff/i);
  });

  describe('undo', () => {
    const renderEditor = (score = createBlankScore({ title: 'Test', measureCount: 1 })) =>
      render(
        <Editor
          initialScore={score}
          meta={{ filename: null, fileHandle: null, dir: null }}
          onBack={() => undefined}
          onMetaChange={() => undefined}
        />,
      );

    it('restores a deleted note', () => {
      const blank = createBlankScore({ title: 'Test', measureCount: 1 });
      renderEditor(
        addNoteToMeasure(blank, blank.measures[0].id, { pitch: 'F', octave: 4, duration: 'q' }),
      );
      expect(screen.getByTestId('undo')).toBeDisabled();

      // jsdom lacks PointerEvent; MouseEvent carries the `button` the canvas checks.
      fireEvent(
        document.querySelector('.note-hit')!,
        new MouseEvent('pointerdown', { bubbles: true, button: 0 }),
      );
      fireEvent(window, new MouseEvent('pointerup', { button: 0 }));
      expect(screen.getByTestId('delete-note')).toBeEnabled();
      expect(screen.getByTitle('Quarter')).toHaveClass('is-selected');
      expect(document.querySelectorAll('.note-outline')).toHaveLength(1);
      fireEvent.click(screen.getByTestId('delete-note'));
      expect(document.querySelectorAll('.palette-item.is-selected')).toHaveLength(0);
      expect(document.querySelectorAll('.note-outline')).toHaveLength(0);
      expect(document.querySelectorAll('.note-hit')).toHaveLength(0);

      fireEvent.click(screen.getByTestId('undo'));
      expect(document.querySelectorAll('.note-hit')).toHaveLength(1);
      expect(screen.getByTestId('undo')).toBeDisabled();
    });

    it('highlights the palette value when a chord is selected', () => {
      const blank = createBlankScore({ title: 'Test', measureCount: 1 });
      renderEditor(
        addNoteToMeasure(blank, blank.measures[0].id, {
          pitch: 'F',
          octave: 4,
          duration: 'h',
          chord: [{ pitch: 'A', octave: 4 }, { pitch: 'C', octave: 5 }],
        }),
      );
      fireEvent(
        document.querySelector('.note-hit')!,
        new MouseEvent('pointerdown', { bubbles: true, button: 0 }),
      );
      fireEvent(window, new MouseEvent('pointerup', { button: 0 }));
      expect(screen.getByTestId('delete-note')).toBeEnabled();
      expect(screen.getByTitle('Half')).toHaveClass('is-selected');
    });

    it('labels each note with its value and matching palette button when Labels is on', () => {
      const blank = createBlankScore({ title: 'Test', measureCount: 1 });
      const measureId = blank.measures[0].id;
      let score = addNoteToMeasure(blank, measureId, {
        pitch: 'F',
        octave: 4,
        duration: 'q',
        chord: [{ pitch: 'A', octave: 4 }],
      });
      score = addNoteToMeasure(score, measureId, { pitch: 'G', octave: 4, duration: 'qd' });
      score = addNoteToMeasure(score, measureId, { pitch: 'A', octave: 4, duration: '32' });
      renderEditor(score);
      expect(document.querySelectorAll('.note-label')).toHaveLength(0);

      fireEvent.click(screen.getByTestId('note-labels-toggle'));
      const labels = [...document.querySelectorAll('.note-label')].map((l) => l.textContent);
      expect(labels).toEqual(['q +1Quarter', 'qdQuarter', '3232nd']);
      expect(document.querySelectorAll('.note-label.is-unmapped')).toHaveLength(0);

      fireEvent(
        document.querySelector('.note-hit')!,
        new MouseEvent('pointerdown', { bubbles: true, button: 0 }),
      );
      fireEvent(window, new MouseEvent('pointerup', { button: 0 }));
      expect(document.querySelector('.note-label.is-selected')?.textContent).toBe('q +1Quarter');
    });

    it('reverts an added bar with Ctrl+Z outside text fields', () => {
      renderEditor();
      fireEvent.click(screen.getByText('+ Bar'));
      expect(document.querySelectorAll('.measure-hit')).toHaveLength(2);

      fireEvent.keyDown(screen.getByLabelText('Score title'), { key: 'z', ctrlKey: true });
      expect(document.querySelectorAll('.measure-hit')).toHaveLength(2);

      fireEvent.keyDown(document.body, { key: 'z', ctrlKey: true });
      expect(document.querySelectorAll('.measure-hit')).toHaveLength(1);
    });

    it('undoes a run of title keystrokes as one step', () => {
      renderEditor();
      const title = screen.getByLabelText('Score title');
      fireEvent.change(title, { target: { value: 'Te' } });
      fireEvent.change(title, { target: { value: 'Tem' } });
      fireEvent.change(title, { target: { value: 'Temp' } });
      fireEvent.click(screen.getByTestId('undo'));
      expect(title).toHaveValue('Test');
      expect(screen.getByTestId('undo')).toBeDisabled();
    });
  });

  it('shows a disabled Copy note control until a note is selected', () => {
    const score = createBlankScore({ title: 'Test', measureCount: 1 });
    render(
      <Editor
        initialScore={score}
        meta={{ filename: null, fileHandle: null, dir: null }}
        onBack={() => undefined}
        onMetaChange={() => undefined}
      />,
    );
    expect(screen.getByTestId('copy-note')).toBeDisabled();
  });
});
