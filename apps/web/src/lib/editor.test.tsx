import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { NotePalette } from '../components/NotePalette';
import { Editor } from '../components/Editor';
import { createBlankScore } from './score-model';

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
