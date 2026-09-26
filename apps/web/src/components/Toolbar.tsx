import type { Score } from '../lib/score-model';

type Props = {
  score: Score;
  dirty: boolean;
  practiceMode: boolean;
  selectedNoteId: string | null;
  canSave: boolean;
  showMusicXml: boolean;
  onToggleMusicXml: () => void;
  onTitleChange: (title: string) => void;
  onClefChange: (clef: Score['clef']) => void;
  onKeyChange: (key: string) => void;
  onTimeChange: (beats: number, beatType: number) => void;
  onTogglePractice: () => void;
  onSave: () => void;
  onSaveAs: () => void;
  onPrint: () => void;
  onDeleteNote: () => void;
  onAddMeasure: () => void;
  onBack: () => void;
};

const KEYS = ['C', 'G', 'D', 'A', 'E', 'B', 'F#', 'F', 'Bb', 'Eb', 'Ab', 'Db'];

export function Toolbar({
  score,
  dirty,
  practiceMode,
  selectedNoteId,
  canSave,
  showMusicXml,
  onToggleMusicXml,
  onTitleChange,
  onClefChange,
  onKeyChange,
  onTimeChange,
  onTogglePractice,
  onSave,
  onSaveAs,
  onPrint,
  onDeleteNote,
  onAddMeasure,
  onBack,
}: Props) {
  return (
    <header className="toolbar no-print">
      <button type="button" className="btn ghost" onClick={onBack}>
        Library
      </button>
      <input
        className="title-input"
        value={score.title}
        onChange={(e) => onTitleChange(e.target.value)}
        aria-label="Score title"
      />
      {dirty && <span className="dirty-badge">Unsaved</span>}
      <label>
        Clef
        <select
          value={score.clef}
          onChange={(e) => onClefChange(e.target.value as Score['clef'])}
        >
          <option value="treble">Treble</option>
          <option value="bass">Bass</option>
        </select>
      </label>
      <label>
        Key
        <select value={score.keySignature} onChange={(e) => onKeyChange(e.target.value)}>
          {KEYS.map((k) => (
            <option key={k} value={k}>
              {k}
            </option>
          ))}
        </select>
      </label>
      <label>
        Time
        <select
          value={`${score.timeSignature.beats}/${score.timeSignature.beatType}`}
          onChange={(e) => {
            const [b, t] = e.target.value.split('/').map(Number);
            onTimeChange(b, t);
          }}
        >
          <option value="4/4">4/4</option>
          <option value="3/4">3/4</option>
          <option value="2/4">2/4</option>
          <option value="6/8">6/8</option>
        </select>
      </label>
      <button
        type="button"
        className={`btn ${practiceMode ? 'active' : ''}`}
        onClick={onTogglePractice}
        data-testid="practice-toggle"
      >
        Practice
      </button>
      <button type="button" className="btn" onClick={onAddMeasure}>
        + Bar
      </button>
      <button
        type="button"
        className="btn"
        onClick={onDeleteNote}
        disabled={!selectedNoteId}
        data-testid="delete-note"
      >
        Delete note
      </button>
      <button
        type="button"
        className={`btn ${showMusicXml ? 'active' : ''}`}
        onClick={onToggleMusicXml}
        data-testid="musicxml-toggle"
      >
        MusicXML
      </button>
      <button type="button" className="btn" onClick={onSave} disabled={!canSave}>
        Save
      </button>
      <button type="button" className="btn" onClick={onSaveAs} disabled={!canSave}>
        Save as
      </button>
      <button type="button" className="btn primary" onClick={onPrint} data-testid="print-btn">
        Print
      </button>
    </header>
  );
}
