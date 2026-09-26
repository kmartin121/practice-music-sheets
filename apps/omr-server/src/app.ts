import cors from 'cors';
import express, { type Express, type Request, type Response, type NextFunction } from 'express';
import multer from 'multer';
import { access, readdir, readFile, rm, mkdir, writeFile } from 'node:fs/promises';
import { constants as fsConstants, createWriteStream } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, extname } from 'node:path';
import { randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { pipeline } from 'node:stream/promises';
import { Readable } from 'node:stream';

export const HOST = '127.0.0.1';
export const PORT = Number(process.env.OMR_PORT ?? 8787);
export const MAX_UPLOAD_BYTES = 20 * 1024 * 1024;
export const OMR_TIMEOUT_MS = Number(process.env.OMR_TIMEOUT_MS ?? 120_000);
export const ALLOWED_ORIGINS = (
  process.env.OMR_CORS_ORIGINS ?? 'http://localhost:5173,http://127.0.0.1:5173'
).split(',');

const ALLOWED_MIME = new Set(['image/png', 'image/jpeg', 'application/pdf']);
const ALLOWED_EXT = new Set(['.png', '.jpg', '.jpeg', '.pdf']);

let busy = false;

export type OmRDeps = {
  resolveAudiverisBin: () => Promise<string | null>;
  runAudiveris: (bin: string, inputPath: string, outputDir: string) => Promise<void>;
};

export async function defaultResolveAudiverisBin(): Promise<string | null> {
  if (process.env.AUDIVERIS_BIN) {
    try {
      await access(process.env.AUDIVERIS_BIN, fsConstants.X_OK);
      return process.env.AUDIVERIS_BIN;
    } catch {
      return null;
    }
  }
  const candidates = [
    'audiveris',
    'Audiveris',
    '/Applications/Audiveris.app/Contents/MacOS/Audiveris',
    '/opt/audiveris/bin/Audiveris',
  ];
  for (const candidate of candidates) {
    try {
      if (candidate.includes('/')) {
        await access(candidate, fsConstants.X_OK);
        return candidate;
      }
      const found = await new Promise<string | null>((resolve) => {
        const child = spawn('which', [candidate], { stdio: ['ignore', 'pipe', 'ignore'] });
        let out = '';
        child.stdout.on('data', (d: Buffer) => {
          out += d.toString();
        });
        child.on('close', (code) => {
          resolve(code === 0 ? out.trim() || null : null);
        });
        child.on('error', () => resolve(null));
      });
      if (found) return found;
    } catch {
      // continue
    }
  }
  return null;
}

/** Pull a short human reason from Audiveris batch logs (mostly on stdout). */
export function summarizeAudiverisFailure(log: string, exitCode: number | null): string {
  const lines = log
    .split(/\r?\n/)
    .map((line) => line.replace(/^.*?\| /, '').trim())
    .filter(Boolean);

  const patterns: RegExp[] = [
    /does not seem to contain staff lines/i,
    /Too few staff filaments/i,
    /No regularly spaced lines found/i,
    /Could not export since transcription did not complete/i,
    /Sheet .+ flagged as invalid/i,
    /StepException: (.+)/i,
    /Error in export/i,
  ];

  for (const pattern of patterns) {
    for (const line of lines) {
      const match = line.match(pattern);
      if (match) {
        if (pattern.source.startsWith('StepException') && match[1]) {
          return `Audiveris could not read this scan: ${match[1]}`;
        }
        return `Audiveris could not read this scan: ${line}`;
      }
    }
  }

  const warnOrError = lines.find((line) => /^(WARN|ERROR)/i.test(line));
  if (warnOrError) {
    return `Audiveris could not read this scan: ${warnOrError.replace(/^(WARN|ERROR)\s*/i, '')}`;
  }

  return `Audiveris exited with code ${exitCode ?? 'unknown'}`;
}

export async function defaultRunAudiveris(
  bin: string,
  inputPath: string,
  outputDir: string,
): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const child = spawn(bin, ['-batch', '-export', '-output', outputDir, inputPath], {
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    // Audiveris writes almost all diagnostics to stdout, not stderr.
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d: Buffer) => {
      stdout += d.toString();
    });
    child.stderr.on('data', (d: Buffer) => {
      stderr += d.toString();
    });
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      reject(Object.assign(new Error('OMR timed out'), { code: 'TIMEOUT' }));
    }, OMR_TIMEOUT_MS);
    child.on('error', (err) => {
      clearTimeout(timer);
      reject(err);
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      if (code === 0) resolve();
      else reject(new Error(summarizeAudiverisFailure(`${stdout}\n${stderr}`, code)));
    });
  });
}

async function walkFiles(dir: string): Promise<string[]> {
  const results: string[] = [];
  const entries = await readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...(await walkFiles(full)));
    } else {
      results.push(full);
    }
  }
  return results;
}

export async function readMxlAsXml(mxlPath: string): Promise<string> {
  const listing = await new Promise<string>((resolve, reject) => {
    const child = spawn('unzip', ['-Z1', mxlPath], { stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    let stderr = '';
    child.stdout.on('data', (d: Buffer) => {
      out += d.toString();
    });
    child.stderr.on('data', (d: Buffer) => {
      stderr += d.toString();
    });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code !== 0) reject(new Error(stderr || `Failed to list .mxl (${code})`));
      else resolve(out);
    });
  });

  const members = listing
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
  const preferred =
    members.find((m) => m.toLowerCase().endsWith('.musicxml')) ||
    members.find((m) => /score/i.test(m) && m.toLowerCase().endsWith('.xml')) ||
    members.find((m) => m.toLowerCase().endsWith('.xml') && !m.toLowerCase().includes('container')) ||
    members[0];

  if (!preferred) {
    throw new Error('Unzipped .mxl did not contain MusicXML');
  }

  return new Promise((resolve, reject) => {
    const child = spawn('unzip', ['-p', mxlPath, preferred], {
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const chunks: Buffer[] = [];
    let stderr = '';
    child.stdout.on('data', (d: Buffer) => chunks.push(d));
    child.stderr.on('data', (d: Buffer) => {
      stderr += d.toString();
    });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code !== 0) {
        reject(new Error(stderr || `Failed to read .mxl (${code})`));
        return;
      }
      const text = Buffer.concat(chunks).toString('utf8').trim();
      if (!text.includes('score-partwise') && !text.includes('score-timewise')) {
        reject(new Error('Unzipped .mxl did not contain MusicXML'));
        return;
      }
      resolve(text);
    });
  });
}

/** Audiveris writes book.xml / sheet#N/sheet#N.xml inside .omr trees — not MusicXML. */
export function isAudiverisInternalXml(filePath: string): boolean {
  const lower = filePath.replace(/\\/g, '/').toLowerCase();
  const base = lower.split('/').pop() ?? '';
  if (base === 'book.xml' || lower.endsWith('.omr.xml')) return true;
  if (/\/sheet#\d+\//.test(lower) || /^sheet#\d+\.xml$/.test(base)) return true;
  return false;
}

export function countMusicXmlNotes(xml: string): number {
  return (xml.match(/<note[\s>]/gi) || []).length;
}

export function extractScorePartwise(xml: string): string | null {
  const match = xml.match(/<score-partwise\b[\s\S]*<\/score-partwise>/i);
  return match ? match[0] : null;
}

/**
 * Concatenate measures from later movements into the first score-partwise document.
 * Audiveris often splits one scan into input.mvt1.mxl + input.mvt2.mxl.
 */
export function mergeScorePartwiseDocuments(documents: string[]): string {
  if (documents.length === 0) {
    throw new Error('No MusicXML documents to merge');
  }
  if (documents.length === 1) return documents[0];

  const bases = documents.map((doc) => extractScorePartwise(doc)).filter((d): d is string => Boolean(d));
  if (bases.length === 0) {
    throw new Error('No score-partwise documents to merge');
  }
  if (bases.length === 1) return bases[0];

  let base = bases[0];
  let measureNumber = 0;
  const existing = base.match(/<measure\b[^>]*\bnumber="(\d+)"/gi) ?? [];
  for (const m of existing) {
    const n = Number(/number="(\d+)"/i.exec(m)?.[1] ?? 0);
    if (n > measureNumber) measureNumber = n;
  }

  for (let i = 1; i < bases.length; i++) {
    const extra = bases[i];
    const partMatch = extra.match(/<part\b[^>]*>[\s\S]*?<\/part>/i);
    if (!partMatch) continue;
    const measureBlocks =
      partMatch[0].match(/<measure\b[\s\S]*?<\/measure>/gi) ?? [];
    if (measureBlocks.length === 0) continue;

    const renumbered = measureBlocks.map((block) => {
      measureNumber += 1;
      if (/\bnumber="/i.test(block)) {
        return block.replace(/\bnumber="[^"]*"/i, `number="${measureNumber}"`);
      }
      return block.replace(/<measure\b/i, `<measure number="${measureNumber}"`);
    });

    const insertAt = base.lastIndexOf('</part>');
    if (insertAt < 0) continue;
    base = `${base.slice(0, insertAt)}${renumbered.join('\n')}\n${base.slice(insertAt)}`;
  }

  return base;
}

async function loadMusicXmlCandidate(full: string): Promise<string | null> {
  const lower = full.toLowerCase();
  try {
    let text: string;
    if (lower.endsWith('.mxl')) {
      text = await readMxlAsXml(full);
    } else {
      text = await readFile(full, 'utf8');
    }
    const partwise = extractScorePartwise(text);
    return partwise ?? (text.includes('score-partwise') ? text : null);
  } catch {
    return null;
  }
}

export async function findExportedMusicXml(outputDir: string): Promise<string> {
  const files = await walkFiles(outputDir);
  const candidates: string[] = [];

  for (const full of files) {
    const lower = full.toLowerCase();
    if (lower.endsWith('.mxl') || lower.endsWith('.musicxml')) {
      candidates.push(full);
      continue;
    }
    if (lower.endsWith('.xml') && !isAudiverisInternalXml(full)) {
      candidates.push(full);
    }
  }

  // Prefer movement order: mvt1 before mvt2, then lexical.
  candidates.sort((a, b) => {
    const ma = /\.mvt(\d+)/i.exec(a)?.[1];
    const mb = /\.mvt(\d+)/i.exec(b)?.[1];
    if (ma && mb) return Number(ma) - Number(mb);
    if (ma) return -1;
    if (mb) return 1;
    return a.localeCompare(b);
  });

  const documents: string[] = [];
  for (const full of candidates) {
    const xml = await loadMusicXmlCandidate(full);
    if (xml) documents.push(xml);
  }

  if (documents.length === 0) {
    const names = files.map((f) => f.slice(outputDir.length + 1));
    throw new Error(
      names.length === 0
        ? 'Audiveris produced no MusicXML output (empty output folder — recognition may have failed)'
        : `Audiveris produced no MusicXML output (found: ${names.join(', ')})`,
    );
  }

  // Multiple Audiveris movements from one scan → one continuous score.
  if (documents.length > 1 && candidates.some((c) => /\.mvt\d+/i.test(c))) {
    return mergeScorePartwiseDocuments(documents);
  }

  // Otherwise pick the densest score-partwise document.
  let best = documents[0];
  let bestNotes = countMusicXmlNotes(best);
  for (let i = 1; i < documents.length; i++) {
    const notes = countMusicXmlNotes(documents[i]);
    if (notes > bestNotes) {
      best = documents[i];
      bestNotes = notes;
    }
  }
  return best;
}

function extensionFor(file: Express.Multer.File): string {
  const fromName = extname(file.originalname || '').toLowerCase();
  if (ALLOWED_EXT.has(fromName)) return fromName;
  if (file.mimetype === 'image/png') return '.png';
  if (file.mimetype === 'image/jpeg') return '.jpg';
  if (file.mimetype === 'application/pdf') return '.pdf';
  return '';
}

export function createApp(deps: Partial<OmRDeps> = {}): Express {
  const resolveAudiverisBin = deps.resolveAudiverisBin ?? defaultResolveAudiverisBin;
  const runAudiveris = deps.runAudiveris ?? defaultRunAudiveris;

  const app = express();
  app.disable('x-powered-by');

  app.use(
    cors({
      origin(origin, callback) {
        if (!origin || ALLOWED_ORIGINS.includes(origin)) {
          callback(null, true);
        } else {
          callback(new Error('Origin not allowed'));
        }
      },
    }),
  );

  const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: MAX_UPLOAD_BYTES, files: 1 },
    fileFilter(_req, file, cb) {
      const ext = extname(file.originalname || '').toLowerCase();
      const mimeOk = ALLOWED_MIME.has(file.mimetype);
      const extOk = !ext || ALLOWED_EXT.has(ext);
      if (!mimeOk || !extOk) {
        cb(Object.assign(new Error('Unsupported file type'), { status: 415 }));
        return;
      }
      cb(null, true);
    },
  });

  app.get('/health', (_req, res) => {
    res.json({ ok: true });
  });

  app.post(
    '/omr',
    (req, res, next) => {
      upload.single('file')(req, res, (err: unknown) => {
        if (err) {
          const anyErr = err as { code?: string; status?: number; message?: string };
          if (anyErr.code === 'LIMIT_FILE_SIZE') {
            res.status(413).type('text/plain').send('Upload exceeds 20MB limit');
            return;
          }
          res.status(anyErr.status ?? 400).type('text/plain').send(anyErr.message ?? 'Upload failed');
          return;
        }
        next();
      });
    },
    async (req: Request, res: Response) => {
      if (busy) {
        res.status(503).type('text/plain').send('OMR busy; try again shortly');
        return;
      }
      busy = true;

      const file = req.file;
      if (!file) {
        busy = false;
        res.status(400).type('text/plain').send('Missing file field');
        return;
      }
      const ext = extensionFor(file);
      if (!ext || !ALLOWED_MIME.has(file.mimetype)) {
        busy = false;
        res.status(415).type('text/plain').send('Unsupported file type');
        return;
      }

      const bin = await resolveAudiverisBin();
      if (!bin) {
        busy = false;
        res
          .status(503)
          .type('text/plain')
          .send('Audiveris binary not found. Set AUDIVERIS_BIN or install Audiveris.');
        return;
      }

      const workDir = join(tmpdir(), `omr-${randomUUID()}`);
      const inputPath = join(workDir, `input${ext}`);
      const outputDir = join(workDir, 'out');

      try {
        await mkdir(outputDir, { recursive: true });
        await pipeline(Readable.from(file.buffer), createWriteStream(inputPath));
        await runAudiveris(bin, inputPath, outputDir);
        const xml = await findExportedMusicXml(outputDir);
        res.type('application/xml').send(xml);
      } catch (err) {
        const anyErr = err as { code?: string; message?: string };
        if (anyErr.code === 'TIMEOUT') {
          res.status(504).type('text/plain').send('OMR timed out');
        } else {
          const message =
            process.env.NODE_ENV === 'production'
              ? 'OMR conversion failed'
              : (anyErr.message ?? 'OMR conversion failed');
          res.status(500).type('text/plain').send(message);
        }
      } finally {
        busy = false;
        await rm(workDir, { recursive: true, force: true }).catch(() => undefined);
      }
    },
  );

  app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    const message = err instanceof Error ? err.message : 'Server error';
    if (message === 'Origin not allowed') {
      res.status(403).type('text/plain').send(message);
      return;
    }
    res
      .status(500)
      .type('text/plain')
      .send(process.env.NODE_ENV === 'production' ? 'Server error' : message);
  });

  return app;
}

export function resetBusyFlag(): void {
  busy = false;
}

export async function writeFakeMusicXml(outputDir: string, xml: string): Promise<void> {
  await mkdir(outputDir, { recursive: true });
  await writeFile(join(outputDir, 'score.musicxml'), xml, 'utf8');
}

export async function writeFakeMxl(
  outputDir: string,
  xml: string,
  fileName = 'score.mxl',
): Promise<void> {
  await mkdir(outputDir, { recursive: true });
  const xmlPath = join(outputDir, `${fileName}.tmp.xml`);
  const mxlPath = join(outputDir, fileName);
  await writeFile(xmlPath, xml, 'utf8');
  await new Promise<void>((resolve, reject) => {
    const child = spawn('zip', ['-q', '-j', mxlPath, xmlPath], { stdio: 'ignore' });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`zip exited ${code}`));
    });
  });
  await rm(xmlPath, { force: true });
}
