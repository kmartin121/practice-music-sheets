const OMR_URL = import.meta.env.VITE_OMR_URL ?? '';

const MAX_503_RETRIES = 8;
const RETRY_DELAY_MS = 750;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Run a single file through the local Audiveris OMR sidecar; returns MusicXML text. */
export async function runOmrOnFile(file: File): Promise<string> {
  let lastError: Error | null = null;

  for (let attempt = 0; attempt <= MAX_503_RETRIES; attempt += 1) {
    const body = new FormData();
    body.append('file', file);

    let res: Response;
    try {
      res = await fetch(`${OMR_URL}/omr`, { method: 'POST', body });
    } catch {
      throw new Error(
        'Cannot reach the OMR sidecar. In another terminal run: npm run dev:omr',
      );
    }

    if (res.status === 503 && attempt < MAX_503_RETRIES) {
      await sleep(RETRY_DELAY_MS);
      continue;
    }

    if (!res.ok) {
      const msg = await res.text();
      lastError = new Error(msg || `OMR failed (${res.status})`);
      throw lastError;
    }

    return res.text();
  }

  throw lastError ?? new Error('OMR busy; try again shortly');
}

export function filenameStem(name: string): string {
  return name.replace(/\.[^.]+$/, '');
}
