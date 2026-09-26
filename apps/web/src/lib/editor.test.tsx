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
