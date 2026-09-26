import { useCallback, useMemo, useState } from 'react';
import type { Duration, Score } from '../lib/score-model';
import {
  addEmptyMeasure,
  addNoteToMeasure,
  createId,
  measureOverflows,
  reflowOverflow,
  relocateNote,
  removeNote,
  updateScoreMeta,
} from '../lib/score-model';
import { countMusicXmlNoteElements, parseMusicXml } from '../lib/musicxml-parse';
import { serializeMusicXml } from '../lib/musicxml-serialize';
import { writeSheetText } from '../lib/file-system';
import type { OpenMeta } from '../App';
import { Toolbar } from './Toolbar';
import { NotePalette } from './NotePalette';
import { ScoreCanvas } from './ScoreCanvas';

type Props = {
  initialScore: Score;
  meta: OpenMeta;
  onBack: () => void;
  onMetaChange: (meta: OpenMeta) => void;
};

function omrEmptyNotesMessage(xmlNoteCount: number): string {
  if (xmlNoteCount > 0) {
    return ` — MusicXML has ${xmlNoteCount} note element(s) but none mapped onto the staff (cue notes or unsupported shapes may have been skipped). Inspect MusicXML below or edit the staff.`;
  }
  return ' — Audiveris exported no notes. Try a clearer, higher-resolution scan of a single page (grace notes need Audiveris “small heads”), then inspect MusicXML below or drag notes onto the staff.';
}

export function Editor({ initialScore, meta, onBack, onMetaChange }: Props) {
  const [score, setScore] = useState(initialScore);
  const [dirty, setDirty] = useState(false);
  const [practiceMode, setPracticeMode] = useState(false);
  const [hiddenMeasureIds, setHiddenMeasureIds] = useState<Set<string>>(() => new Set());
  const [selectedNoteId, setSelectedNoteId] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [musicXmlText, setMusicXmlText] = useState(meta.sourceXml ?? serializeMusicXml(initialScore));
  const [showMusicXml, setShowMusicXml] = useState(Boolean(meta.fromOmr || meta.sourceXml));

  const noteCount = useMemo(
    () => score.measures.reduce((sum, m) => sum + m.notes.length, 0),
    [score],
  );

  const sourceXmlNoteCount = useMemo(
    () => (meta.fromOmr && meta.sourceXml ? countMusicXmlNoteElements(meta.sourceXml) : 0),
    [meta.fromOmr, meta.sourceXml],
  );

  const overflowing = useMemo(
    () => score.measures.some((m) => measureOverflows(score, m)),
    [score],
  );

  const markDirty = useCallback((next: Score) => {
    setScore(next);
    setDirty(true);
    setStatus(null);
  }, []);

  const onDropNote = useCallback(
    (
      measureId: string,
      duration: Duration,
      pitch: string,
      octave: number,
      index?: number,
    ) => {
      const id = createId('note');
      markDirty(
        reflowOverflow(
          addNoteToMeasure(
            score,
            measureId,
            {
              id,
              pitch,
              octave,
              duration,
            },
            index,
          ),
        ),
      );
      setSelectedNoteId(id);
    },
    [markDirty, score],
  );

  const onMoveNote = useCallback(
    (
      noteId: string,
      measureId: string,
      pitch: string,
      octave: number,
      index?: number,
    ) => {
      markDirty(reflowOverflow(relocateNote(score, noteId, measureId, pitch, octave, index)));
      setSelectedNoteId(noteId);
    },
    [markDirty, score],
  );

  const onToggleMeasureHidden = useCallback((measureId: string) => {
    setHiddenMeasureIds((prev) => {
      const next = new Set(prev);
      if (next.has(measureId)) next.delete(measureId);
      else next.add(measureId);
      return next;
    });
  }, []);

  function applyMusicXml() {
    try {
      const next = parseMusicXml(musicXmlText);
      setScore(next);
      setDirty(true);
      setSelectedNoteId(null);
      setHiddenMeasureIds(new Set());
      const notes = next.measures.reduce((sum, m) => sum + m.notes.length, 0);
      setStatus(`Applied MusicXML: ${next.measures.length} bars, ${notes} notes`);
    } catch (e) {
      setStatus(e instanceof Error ? e.message : 'Could not parse MusicXML');
    }
  }

  async function save(asNew: boolean) {
    if (!meta.dir) {
      setStatus('Open a folder from the library to save.');
      return;
    }
    try {
      const xml = dirty || !meta.sourceXml ? serializeMusicXml(score) : musicXmlText;
      let filename = meta.filename;
      if (asNew || !filename) {
        const suggested = `${score.title || 'untitled'}.musicxml`;
        const entered = window.prompt('Filename', suggested);
        if (!entered) return;
        filename = entered;
      }
      const handle = await writeSheetText(meta.dir, filename, xml);
      onMetaChange({ ...meta, filename: handle.name, fileHandle: handle, sourceXml: xml });
      setMusicXmlText(xml);
      setDirty(false);
      setStatus(`Saved ${handle.name}`);
    } catch (e) {
      setStatus(e instanceof Error ? e.message : 'Save failed');
    }
  }

  return (
    <div className="editor" data-testid="editor">
      <Toolbar
        score={score}
        dirty={dirty}
        practiceMode={practiceMode}
        selectedNoteId={selectedNoteId}
        canSave={Boolean(meta.dir)}
        showMusicXml={showMusicXml}
        onToggleMusicXml={() => setShowMusicXml((v) => !v)}
        onTitleChange={(title) => markDirty(updateScoreMeta(score, { title }))}
        onClefChange={(clef) => markDirty(updateScoreMeta(score, { clef }))}
        onKeyChange={(keySignature) => markDirty(updateScoreMeta(score, { keySignature }))}
        onTimeChange={(beats, beatType) =>
          markDirty(updateScoreMeta(score, { timeSignature: { beats, beatType } }))
        }
        onTogglePractice={() => setPracticeMode((p) => !p)}
        onSave={() => void save(false)}
        onSaveAs={() => void save(true)}
        onPrint={() => window.print()}
        onDeleteNote={() => {
          if (!selectedNoteId) return;
          markDirty(removeNote(score, selectedNoteId));
          setSelectedNoteId(null);
        }}
        onAddMeasure={() => markDirty(addEmptyMeasure(score))}
        onBack={onBack}
      />
      <NotePalette disabled={practiceMode} />
      {meta.fromOmr && (
        <p className="status no-print" data-testid="omr-summary">
          OMR import: {score.measures.length} bars, {noteCount} notes
          {noteCount === 0 ? omrEmptyNotesMessage(sourceXmlNoteCount) : '.'}
        </p>
      )}
      {overflowing && (
        <p className="warn no-print" role="status">
          One or more bars exceed the time signature.
        </p>
      )}
      {practiceMode && (
        <p className="status no-print">Practice mode: click a bar to hide or reveal its notes.</p>
      )}
      {status && (
        <p className="status no-print" role="status">
          {status}
        </p>
      )}
      {showMusicXml && (
        <section className="musicxml-panel no-print" data-testid="musicxml-panel">
          <div className="musicxml-panel-header">
            <h2>MusicXML</h2>
            <div className="musicxml-panel-actions">
              <button type="button" className="btn" onClick={applyMusicXml}>
                Apply to score
              </button>
              <button
                type="button"
                className="btn ghost"
                onClick={() => setMusicXmlText(serializeMusicXml(score))}
              >
                Refresh from score
              </button>
            </div>
          </div>
          <textarea
            className="musicxml-editor"
            value={musicXmlText}
            onChange={(e) => setMusicXmlText(e.target.value)}
            spellCheck={false}
            aria-label="MusicXML source"
          />
        </section>
      )}
      <div className="score-page">
        <h1 className="score-title">{score.title}</h1>
        <ScoreCanvas
          score={score}
          practiceMode={practiceMode}
          hiddenMeasureIds={hiddenMeasureIds}
          selectedNoteId={selectedNoteId}
          onSelectNote={setSelectedNoteId}
          onToggleMeasureHidden={onToggleMeasureHidden}
          onDropNote={onDropNote}
          onMoveNote={onMoveNote}
        />
      </div>
    </div>
  );
}
