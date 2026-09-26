const MUSIC_EXTENSIONS = ['.musicxml', '.mxl', '.xml'];

export type SheetFile = {
  name: string;
  handle: FileSystemFileHandle;
};

export function isFileSystemAccessSupported(): boolean {
  return typeof window !== 'undefined' && 'showDirectoryPicker' in window;
}

export function isMusicSheetName(name: string): boolean {
  const lower = name.toLowerCase();
  return MUSIC_EXTENSIONS.some((ext) => lower.endsWith(ext));
}

export async function openDirectory(): Promise<FileSystemDirectoryHandle> {
  if (!isFileSystemAccessSupported()) {
    throw new Error('File System Access API is not supported in this browser. Use Chrome or Edge.');
  }
  return window.showDirectoryPicker({ mode: 'readwrite' });
}

export async function listMusicSheets(dir: FileSystemDirectoryHandle): Promise<SheetFile[]> {
  const sheets: SheetFile[] = [];
  for await (const [name, handle] of dir.entries()) {
    if (handle.kind === 'file' && isMusicSheetName(name)) {
      sheets.push({ name, handle: handle as FileSystemFileHandle });
    }
  }
  sheets.sort((a, b) => a.name.localeCompare(b.name));
  return sheets;
}

export async function readSheetText(handle: FileSystemFileHandle): Promise<string> {
  const file = await handle.getFile();
  return file.text();
}

export async function writeSheetText(
  dir: FileSystemDirectoryHandle,
  filename: string,
  contents: string,
): Promise<FileSystemFileHandle> {
  const safeName = filename.replace(/[^\w.\- ()]/g, '_');
  const withExt = safeName.toLowerCase().endsWith('.musicxml')
    ? safeName
    : `${safeName}.musicxml`;
  const handle = await dir.getFileHandle(withExt, { create: true });
  const writable = await handle.createWritable();
  await writable.write(contents);
  await writable.close();
  return handle;
}

const IDB_NAME = 'practice-music-sheets';
const IDB_STORE = 'handles';
const IDB_KEY = 'directory';

function openIdb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(IDB_NAME, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(IDB_STORE)) {
        db.createObjectStore(IDB_STORE);
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function persistDirectoryHandle(handle: FileSystemDirectoryHandle): Promise<void> {
  const db = await openIdb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(IDB_STORE, 'readwrite');
    tx.objectStore(IDB_STORE).put(handle, IDB_KEY);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
  db.close();
}

export async function loadPersistedDirectoryHandle(): Promise<FileSystemDirectoryHandle | null> {
  try {
    const db = await openIdb();
    const handle = await new Promise<FileSystemDirectoryHandle | null>((resolve, reject) => {
      const tx = db.transaction(IDB_STORE, 'readonly');
      const req = tx.objectStore(IDB_STORE).get(IDB_KEY);
      req.onsuccess = () => resolve((req.result as FileSystemDirectoryHandle) ?? null);
      req.onerror = () => reject(req.error);
    });
    db.close();
    if (!handle) return null;
    const permission = await handle.queryPermission({ mode: 'readwrite' });
    if (permission === 'granted') return handle;
    const requested = await handle.requestPermission({ mode: 'readwrite' });
    return requested === 'granted' ? handle : null;
  } catch {
    return null;
  }
}
