import { useCallback, useState } from 'react';
import type { Score } from './lib/score-model';
import { Library } from './components/Library';
import { Editor } from './components/Editor';
import { ThemeToggle } from './components/ThemeToggle';
import { useTheme } from './lib/theme';
import './App.css';
import './styles/print.css';

export type OpenMeta = {
  filename: string | null;
  fileHandle: FileSystemFileHandle | null;
  dir: FileSystemDirectoryHandle | null;
  sourceXml?: string | null;
  fromOmr?: boolean;
};

type View =
  | { kind: 'library' }
  | {
      kind: 'editor';
      score: Score;
      meta: OpenMeta;
    };

export default function App() {
  const [view, setView] = useState<View>({ kind: 'library' });
  const [directory, setDirectory] = useState<FileSystemDirectoryHandle | null>(null);
  const { theme, toggleTheme } = useTheme();

  const onOpenScore = useCallback(
    (score: Score, meta: OpenMeta) => {
      setView({
        kind: 'editor',
        score,
        meta: { ...meta, dir: meta.dir ?? directory },
      });
    },
    [directory],
  );

  return (
    <>
      {view.kind === 'editor' ? (
        <Editor
          initialScore={view.score}
          meta={view.meta}
          onBack={() => setView({ kind: 'library' })}
          onMetaChange={(meta) => setView({ ...view, meta })}
        />
      ) : (
        <Library
          onOpenScore={onOpenScore}
          directory={directory}
          onDirectoryChange={setDirectory}
        />
      )}
      <ThemeToggle theme={theme} onToggle={toggleTheme} />
    </>
  );
}
