import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { NotePalette } from '../components/NotePalette';
import { Editor } from '../components/Editor';
import { createBlankScore } from './score-model';

describe('NotePalette', () => {
  it('sets drag payload for a quarter note', () => {
    render(<NotePalette />);
    const quarter = screen.getByTitle('q');
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

    fireEvent.change(screen.getByLabelText('Score title'), {
      target: { value: 'Edited' },
    });
    expect(screen.getByText('Unsaved')).toBeInTheDocument();
  });
});
