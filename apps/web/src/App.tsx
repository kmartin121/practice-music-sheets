import { useCallback, useState } from 'react';
import type { Score } from './lib/score-model';
import { Library } from './components/Library';
import { Editor } from './components/Editor';
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

  if (view.kind === 'editor') {
    return (
      <Editor
        initialScore={view.score}
        meta={view.meta}
        onBack={() => setView({ kind: 'library' })}
        onMetaChange={(meta) => setView({ ...view, meta })}
      />
    );
  }

  return (
    <Library
      onOpenScore={onOpenScore}
      directory={directory}
      onDirectoryChange={setDirectory}
    />
  );
}
