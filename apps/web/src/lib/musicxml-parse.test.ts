import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  countMusicXmlNoteElements,
  MAX_MUSICXML_BYTES,
  MusicXmlParseError,
  parseMusicXml,
} from './musicxml-parse';
import { serializeMusicXml } from './musicxml-serialize';

const fixtures = resolve(dirname(fileURLToPath(import.meta.url)), '../../../../fixtures');

describe('musicxml parse/serialize', () => {
  it('round-trips the sample melody fixture', () => {
    const xml = readFileSync(resolve(fixtures, 'sample-melody.musicxml'), 'utf8');
    const score = parseMusicXml(xml);
    expect(score.title).toBe('Sample Melody');
    expect(score.clef).toBe('treble');
    expect(score.keySignature).toBe('C');
    expect(score.timeSignature).toEqual({ beats: 4, beatType: 4 });
    expect(score.measures).toHaveLength(2);
    expect(score.measures[0].notes.map((n) => `${n.pitch}${n.octave}`)).toEqual([
      'C4',
      'D4',
      'E4',
      'F4',
    ]);

    const again = parseMusicXml(serializeMusicXml(score));
    expect(again.title).toBe(score.title);
    expect(again.clef).toBe(score.clef);
    expect(again.measures).toHaveLength(2);
    expect(again.measures[0].notes.map((n) => n.pitch)).toEqual(['C', 'D', 'E', 'F']);
    expect(again.measures[1].notes[1].duration).toBe('hr');
  });

  it('rejects XXE-shaped documents', () => {
    const xml = readFileSync(resolve(fixtures, 'xxe-attack.musicxml'), 'utf8');
    expect(() => parseMusicXml(xml)).toThrow(/ENTITY/i);
  });

  it('accepts MusicXML with a standard DOCTYPE (Audiveris-style)', () => {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE score-partwise PUBLIC
  "-//Recordare//DTD MusicXML 4.0 Partwise//EN"
  "http://www.musicxml.org/dtds/partwise.dtd">
<score-partwise version="4.0">
  <part-list><score-part id="P1"><part-name>Melody</part-name></score-part></part-list>
  <part id="P1">
    <measure number="1">
      <attributes>
        <divisions>4</divisions>
        <key><fifths>0</fifths></key>
        <time><beats>4</beats><beat-type>4</beat-type></time>
        <clef><sign>G</sign><line>2</line></clef>
      </attributes>
      <note>
        <pitch><step>C</step><octave>4</octave></pitch>
        <duration>4</duration>
        <type>quarter</type>
      </note>
    </measure>
  </part>
</score-partwise>`;
    const score = parseMusicXml(xml);
    expect(score.measures).toHaveLength(1);
    expect(score.measures[0].notes[0].pitch).toBe('C');
  });

  it('extracts score-partwise from mixed container + score payloads', () => {
    const xml = `<?xml version="1.0"?><container><rootfile full-path="score.xml"/></container>
<score-partwise version="4.0">
  <part-list><score-part id="P1"><part-name>Melody</part-name></score-part></part-list>
  <part id="P1">
    <measure number="1">
      <note>
        <pitch><step>G</step><octave>4</octave></pitch>
        <duration>4</duration>
        <type>quarter</type>
      </note>
    </measure>
  </part>
</score-partwise>`;
    const score = parseMusicXml(xml);
    expect(score.measures[0].notes[0].pitch).toBe('G');
  });

  it('picks the densest part when multiple parts exist', () => {
    const xml = readFileSync(resolve(fixtures, 'multi-part-melody.musicxml'), 'utf8');
    const score = parseMusicXml(xml);
    expect(score.measures[0].notes.map((n) => `${n.pitch}${n.octave}`)).toEqual([
      'G4',
      'A4',
      'B4',
      'C5',
    ]);
  });

  it('maps unpitched display-step/octave, 32nd to 16th, and dotted quarter toward half', () => {
    const xml = readFileSync(resolve(fixtures, 'unpitched-notes.musicxml'), 'utf8');
    const score = parseMusicXml(xml);
    expect(score.measures[0].notes).toHaveLength(3);
    expect(score.measures[0].notes[0].pitch).toBe('E');
    expect(score.measures[0].notes[1].duration).toBe('16');
    expect(score.measures[0].notes[2].duration).toBe('h');
  });

  it('keeps chord tones on the first note of a chord group', () => {
    const xml = readFileSync(resolve(fixtures, 'chord-root-kept.musicxml'), 'utf8');
    const score = parseMusicXml(xml);
    expect(score.measures[0].notes.map((n) => n.pitch)).toEqual(['C', 'D']);
    expect(score.measures[0].notes[0].chord).toEqual([
      { pitch: 'E', octave: 4 },
      { pitch: 'G', octave: 4 },
    ]);
  });

  it('parses x noteheads on chord tones for drum notation', () => {
    const xml = `<?xml version="1.0"?>
<score-partwise version="4.0">
  <part-list><score-part id="P1"><part-name>Drums</part-name></score-part></part-list>
  <part id="P1">
    <measure number="1">
      <attributes><divisions>4</divisions><clef><sign>G</sign><line>2</line></clef></attributes>
      <note>
        <unpitched><display-step>C</display-step><display-octave>5</display-octave></unpitched>
        <duration>4</duration><type>quarter</type>
      </note>
      <note>
        <chord/>
        <unpitched><display-step>G</display-step><display-octave>5</display-octave></unpitched>
        <duration>4</duration><type>quarter</type>
        <notehead>x</notehead>
      </note>
      <note>
        <unpitched><display-step>F</display-step><display-octave>4</display-octave></unpitched>
        <duration>4</duration><type>quarter</type>
      </note>
    </measure>
  </part>
</score-partwise>`;
    const score = parseMusicXml(xml);
    expect(score.measures[0].notes[0].pitch).toBe('C');
    expect(score.measures[0].notes[0].chord).toEqual([
      { pitch: 'G', octave: 5, notehead: 'x' },
    ]);
    const again = parseMusicXml(serializeMusicXml(score));
    expect(again.measures[0].notes[0].chord?.[0].notehead).toBe('x');
  });

  it('parses unpitched drum measure with 16ths and a dyad', () => {
    const xml = `<?xml version="1.0"?>
<score-partwise version="4.0">
  <part-list><score-part id="P1"><part-name>Drums</part-name></score-part></part-list>
  <part id="P1">
    <measure number="1">
      <attributes><divisions>4</divisions><clef><sign>G</sign><line>2</line></clef></attributes>
      <note>
        <unpitched><display-step>F</display-step><display-octave>4</display-octave></unpitched>
        <duration>4</duration><type>quarter</type>
      </note>
      <note>
        <unpitched><display-step>C</display-step><display-octave>5</display-octave></unpitched>
        <duration>1</duration><type>16th</type>
      </note>
      <note>
        <unpitched><display-step>C</display-step><display-octave>5</display-octave></unpitched>
        <duration>1</duration><type>16th</type>
      </note>
      <note>
        <unpitched><display-step>C</display-step><display-octave>5</display-octave></unpitched>
        <duration>1</duration><type>16th</type>
      </note>
      <note>
        <unpitched><display-step>C</display-step><display-octave>5</display-octave></unpitched>
        <duration>1</duration><type>16th</type>
      </note>
      <note>
        <unpitched><display-step>F</display-step><display-octave>4</display-octave></unpitched>
        <duration>4</duration><type>quarter</type>
      </note>
      <note>
        <chord/>
        <unpitched><display-step>C</display-step><display-octave>5</display-octave></unpitched>
        <duration>4</duration><type>quarter</type>
      </note>
      <note><rest/><duration>4</duration><type>quarter</type></note>
    </measure>
  </part>
</score-partwise>`;
    const score = parseMusicXml(xml);
    const notes = score.measures[0].notes;
    expect(notes.map((n) => n.duration)).toEqual(['q', '16', '16', '16', '16', 'q', 'qr']);
    expect(notes[5].pitch).toBe('F');
    expect(notes[5].chord).toEqual([{ pitch: 'C', octave: 5 }]);
  });

  it('parses Audiveris-style empty measures without notes', () => {
    const xml = readFileSync(resolve(fixtures, 'empty-measures-audiveris.musicxml'), 'utf8');
    const score = parseMusicXml(xml);
    expect(score.measures).toHaveLength(2);
    expect(score.measures.every((m) => m.notes.length === 0)).toBe(true);
    expect(countMusicXmlNoteElements(xml)).toBe(0);
  });

  it('rejects empty and oversized input', () => {
    expect(() => parseMusicXml('')).toThrow(/empty/i);
    const huge = `<score-partwise>${'a'.repeat(MAX_MUSICXML_BYTES)}</score-partwise>`;
    expect(() => parseMusicXml(huge)).toThrow(/limit/i);
  });

  it('rejects malformed xml', () => {
    expect(() => parseMusicXml('<not-music')).toThrow(MusicXmlParseError);
  });
});
