import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import request from 'supertest';
import { afterEach, describe, expect, it } from 'vitest';
import { createApp, resetBusyFlag, writeFakeMusicXml, writeFakeMxl } from './app.js';

const fixtures = resolve(dirname(fileURLToPath(import.meta.url)), '../../../fixtures');
const sampleXml = readFileSync(resolve(fixtures, 'sample-melody.musicxml'), 'utf8');
const tinyPng = readFileSync(resolve(fixtures, 'tiny.png'));

afterEach(() => {
  resetBusyFlag();
});

describe('OMR sidecar', () => {
  it('rejects unsupported MIME types with 415', async () => {
    const app = createApp({
      resolveAudiverisBin: async () => '/fake/audiveris',
      runAudiveris: async () => undefined,
    });
    const res = await request(app)
      .post('/omr')
      .attach('file', Buffer.from('not-an-image'), {
        filename: 'note.txt',
        contentType: 'text/plain',
      });
    expect(res.status).toBe(415);
  });

  it('returns 503 when Audiveris is missing', async () => {
    const app = createApp({
      resolveAudiverisBin: async () => null,
    });
    const res = await request(app)
      .post('/omr')
      .attach('file', tinyPng, { filename: 'tiny.png', contentType: 'image/png' });
    expect(res.status).toBe(503);
    expect(res.text).toMatch(/Audiveris/i);
  });

  it('runs fake Audiveris via argv-style runner and returns MusicXML', async () => {
    const calls: string[][] = [];
    const app = createApp({
      resolveAudiverisBin: async () => '/usr/bin/fake-audiveris',
      runAudiveris: async (bin, inputPath, outputDir) => {
        calls.push([bin, inputPath, outputDir]);
        await writeFakeMusicXml(outputDir, sampleXml);
      },
    });
    const res = await request(app)
      .post('/omr')
      .attach('file', tinyPng, { filename: 'scan.png', contentType: 'image/png' });
    expect(res.status).toBe(200);
    expect(res.text).toContain('score-partwise');
    expect(calls[0][0]).toBe('/usr/bin/fake-audiveris');
    expect(calls[0][1]).toMatch(/input\.png$/);
  });

  it('accepts Audiveris .mxl (compressed MusicXML) exports', async () => {
    const app = createApp({
      resolveAudiverisBin: async () => '/usr/bin/fake-audiveris',
      runAudiveris: async (_bin, _input, outputDir) => {
        await writeFakeMxl(outputDir, sampleXml);
      },
    });
    const res = await request(app)
      .post('/omr')
      .attach('file', tinyPng, { filename: 'scan.png', contentType: 'image/png' });
    expect(res.status).toBe(200);
    expect(res.text).toContain('score-partwise');
  });

  it('returns 503 when already busy', async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    let resolveStarted!: () => void;
    const started = new Promise<void>((resolve) => {
      resolveStarted = resolve;
    });

    const app = createApp({
      resolveAudiverisBin: async () => {
        resolveStarted();
        await gate;
        return '/usr/bin/fake-audiveris';
      },
      runAudiveris: async (_bin, _input, outputDir) => {
        await writeFakeMusicXml(outputDir, sampleXml);
      },
    });

    const firstPromise = request(app)
      .post('/omr')
      .attach('file', tinyPng, { filename: 'a.png', contentType: 'image/png' });
    // SuperTest only sends after the promise is observed.
    void firstPromise.then(() => undefined);

    await started;

    const second = await request(app)
      .post('/omr')
      .attach('file', tinyPng, { filename: 'b.png', contentType: 'image/png' });
    expect(second.status).toBe(503);

    release();
    const firstRes = await firstPromise;
    expect(firstRes.status).toBe(200);
  }, 15_000);

  it('maps timeout to 504', async () => {
    const app = createApp({
      resolveAudiverisBin: async () => '/usr/bin/fake-audiveris',
      runAudiveris: async () => {
        throw Object.assign(new Error('OMR timed out'), { code: 'TIMEOUT' });
      },
    });
    const res = await request(app)
      .post('/omr')
      .attach('file', tinyPng, { filename: 'scan.png', contentType: 'image/png' });
    expect(res.status).toBe(504);
  });
});
