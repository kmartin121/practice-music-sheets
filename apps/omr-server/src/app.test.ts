import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import request from 'supertest';
import { afterEach, describe, expect, it } from 'vitest';
import {
  countMusicXmlNotes,
  createApp,
  findExportedMusicXml,
  mergeScorePartwiseDocuments,
  resetBusyFlag,
  writeFakeMusicXml,
  writeFakeMxl,
} from './app.js';

const fixtures = resolve(dirname(fileURLToPath(import.meta.url)), '../../../fixtures');
const sampleXml = readFileSync(resolve(fixtures, 'sample-melody.musicxml'), 'utf8');
const tinyPng = readFileSync(resolve(fixtures, 'tiny.png'));

const sparseXml = `<?xml version="1.0"?>
<score-partwise version="4.0">
  <part-list><score-part id="P1"><part-name>Empty</part-name></score-part></part-list>
  <part id="P1">
    <measure number="1">
      <attributes><divisions>1</divisions><clef><sign>G</sign><line>2</line></clef></attributes>
    </measure>
  </part>
</score-partwise>`;

const denseXml = `<?xml version="1.0"?>
<score-partwise version="4.0">
  <part-list><score-part id="P1"><part-name>Dense</part-name></score-part></part-list>
  <part id="P1">
    <measure number="1">
      <note><pitch><step>C</step><octave>4</octave></pitch><duration>1</duration><type>quarter</type></note>
      <note><pitch><step>D</step><octave>4</octave></pitch><duration>1</duration><type>quarter</type></note>
    </measure>
  </part>
</score-partwise>`;

const mvt2Xml = `<?xml version="1.0"?>
<score-partwise version="4.0">
  <part-list><score-part id="P1"><part-name>Mvt2</part-name></score-part></part-list>
  <part id="P1">
    <measure number="1">
      <note><pitch><step>E</step><octave>4</octave></pitch><duration>1</duration><type>quarter</type></note>
    </measure>
  </part>
</score-partwise>`;

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

  it('ignores Audiveris book.xml when .mxl exports exist', async () => {
    const app = createApp({
      resolveAudiverisBin: async () => '/usr/bin/fake-audiveris',
      runAudiveris: async (_bin, _input, outputDir) => {
        const omrDir = join(outputDir, 'input.omr');
        mkdirSync(join(omrDir, 'sheet#1'), { recursive: true });
        writeFileSync(join(omrDir, 'book.xml'), '<book><sheet/></book>', 'utf8');
        writeFileSync(join(omrDir, 'sheet#1', 'sheet#1.xml'), '<sheet/>', 'utf8');
        await writeFakeMxl(outputDir, sampleXml, 'input.mvt1.mxl');
      },
    });
    const res = await request(app)
      .post('/omr')
      .attach('file', tinyPng, { filename: 'scan.png', contentType: 'image/png' });
    expect(res.status).toBe(200);
    expect(res.text).toContain('score-partwise');
    expect(res.text).toContain('Sample Melody');
    expect(res.text).not.toContain('<book>');
  });

  it('merges multi-movement Audiveris .mxl exports', async () => {
    const app = createApp({
      resolveAudiverisBin: async () => '/usr/bin/fake-audiveris',
      runAudiveris: async (_bin, _input, outputDir) => {
        await writeFakeMxl(outputDir, denseXml, 'input.mvt1.mxl');
        await writeFakeMxl(outputDir, mvt2Xml, 'input.mvt2.mxl');
      },
    });
    const res = await request(app)
      .post('/omr')
      .attach('file', tinyPng, { filename: 'scan.png', contentType: 'image/png' });
    expect(res.status).toBe(200);
    expect(countMusicXmlNotes(res.text)).toBe(3);
    expect(res.text).toMatch(/number="2"/);
    expect(res.text).toContain('<step>E</step>');
  });

  it('picks the denser MusicXML when multiple non-movement scores exist', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'omr-pick-'));
    writeFileSync(join(dir, 'sparse.musicxml'), sparseXml, 'utf8');
    writeFileSync(join(dir, 'dense.musicxml'), denseXml, 'utf8');
    const xml = await findExportedMusicXml(dir);
    expect(countMusicXmlNotes(xml)).toBe(2);
    expect(xml).toContain('Dense');
  });

  it('mergeScorePartwiseDocuments concatenates measures', () => {
    const merged = mergeScorePartwiseDocuments([denseXml, mvt2Xml]);
    expect(countMusicXmlNotes(merged)).toBe(3);
    expect(merged).toMatch(/number="2"/);
  });
});
