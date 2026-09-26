import type { Accidental, Duration, GraceTone, Notehead, Score } from './score-model';
import { isRest } from './score-model';

const KEY_NAME_TO_FIFTHS: Record<string, number> = {
  Cb: -7,
  Gb: -6,
  Db: -5,
  Ab: -4,
  Eb: -3,
  Bb: -2,
  F: -1,
  C: 0,
  G: 1,
  D: 2,
  A: 3,
  E: 4,
  B: 5,
  'F#': 6,
  'C#': 7,
};

const DURATION_TO_TYPE: Record<string, string> = {
  w: 'whole',
  h: 'half',
  hd: 'half',
  q: 'quarter',
  qd: 'quarter',
  '8': 'eighth',
  '8d': 'eighth',
  '16': '16th',
  '32': '32nd',
};

const DURATION_DOTS: Record<string, number> = {
  hd: 1,
  qd: 1,
  '8d': 1,
};

const DIVISIONS_PER_QUARTER = 8;

const DURATION_TO_DIVISIONS: Record<string, number> = {
  w: 32,
  h: 16,
  hd: 24,
  q: 8,
  qd: 12,
  '8': 4,
  '8d': 6,
  '16': 2,
  '32': 1,
};

const NOTEHEAD_TO_XML: Record<Notehead, string> = {
  normal: 'normal',
  x: 'x',
  diamond: 'diamond',
  slash: 'slash',
  triangle: 'triangle',
};

function escapeXml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;');
}

function alterFor(accidental?: Accidental): number | undefined {
  if (accidental === 'sharp') return 1;
  if (accidental === 'flat') return -1;
  if (accidental === 'natural') return 0;
  return undefined;
}

function graceNoteXml(grace: GraceTone): string {
  const base = grace.duration.replace(/r$/, '');
  const type = DURATION_TO_TYPE[base] ?? '16th';
  const lines: string[] = ['      <note>'];
  lines.push(grace.slash ? '        <grace slash="yes"/>' : '        <grace/>');
  lines.push('        <pitch>');
  lines.push(`          <step>${escapeXml(grace.pitch)}</step>`);
  const alter = alterFor(grace.accidental);
  if (alter !== undefined && alter !== 0) {
    lines.push(`          <alter>${alter}</alter>`);
  }
  lines.push(`          <octave>${grace.octave}</octave>`);
  lines.push('        </pitch>');
  lines.push(`        <type>${type}</type>`);
  if (grace.accidental) {
    lines.push(`        <accidental>${grace.accidental}</accidental>`);
  }
  if (grace.notehead && grace.notehead !== 'normal') {
    lines.push(`        <notehead>${NOTEHEAD_TO_XML[grace.notehead]}</notehead>`);
  }
  lines.push('      </note>');
  return lines.join('\n');
}

function noteXml(
  pitch: string,
  octave: number,
  duration: Duration,
  accidental: Accidental | undefined,
  divisions: number,
  options?: { chord?: boolean; notehead?: Notehead },
): string {
  const base = duration.replace(/r$/, '');
  const type = DURATION_TO_TYPE[base] ?? 'quarter';
  const dur = DURATION_TO_DIVISIONS[base] ?? DIVISIONS_PER_QUARTER;
  const lines: string[] = ['      <note>'];
  if (options?.chord) {
    lines.push('        <chord/>');
  }
  if (isRest(duration)) {
    lines.push('        <rest/>');
  } else {
    lines.push('        <pitch>');
    lines.push(`          <step>${escapeXml(pitch)}</step>`);
    const alter = alterFor(accidental);
    if (alter !== undefined && alter !== 0) {
      lines.push(`          <alter>${alter}</alter>`);
    }
    lines.push(`          <octave>${octave}</octave>`);
    lines.push('        </pitch>');
  }
  lines.push(`        <duration>${dur}</duration>`);
  lines.push(`        <type>${type}</type>`);
  const dots = DURATION_DOTS[base] ?? 0;
  for (let i = 0; i < dots; i += 1) {
    lines.push('        <dot/>');
  }
  if (accidental && !isRest(duration)) {
    lines.push(`        <accidental>${accidental}</accidental>`);
  }
  if (options?.notehead && options.notehead !== 'normal' && !isRest(duration)) {
    lines.push(`        <notehead>${NOTEHEAD_TO_XML[options.notehead]}</notehead>`);
  }
  lines.push('      </note>');
  void divisions;
  return lines.join('\n');
}

export function serializeMusicXml(score: Score): string {
  const fifths = KEY_NAME_TO_FIFTHS[score.keySignature] ?? 0;
  const clefSign = score.clef === 'bass' ? 'F' : 'G';
  const clefLine = score.clef === 'bass' ? 4 : 2;
  const divisions = DIVISIONS_PER_QUARTER;

  const measureBlocks = score.measures
    .map((measure, index) => {
      const attrs =
        index === 0
          ? `      <attributes>
        <divisions>${divisions}</divisions>
        <key>
          <fifths>${fifths}</fifths>
        </key>
        <time>
          <beats>${score.timeSignature.beats}</beats>
          <beat-type>${score.timeSignature.beatType}</beat-type>
        </time>
        <clef>
          <sign>${clefSign}</sign>
          <line>${clefLine}</line>
        </clef>
      </attributes>`
          : '';

      const notes = measure.notes
        .map((n) => {
          const graceBlock = (n.grace ?? []).map((g) => graceNoteXml(g)).join('\n');
          const primary = noteXml(n.pitch, n.octave, n.duration, n.accidental, divisions, {
            notehead: n.notehead,
          });
          const chordTones = (n.chord ?? [])
            .map((tone) =>
              noteXml(tone.pitch, tone.octave, n.duration, tone.accidental, divisions, {
                chord: true,
                notehead: tone.notehead,
              }),
            )
            .join('\n');
          const principal = chordTones ? `${primary}\n${chordTones}` : primary;
          return graceBlock ? `${graceBlock}\n${principal}` : principal;
        })
        .join('\n');

      return `    <measure number="${index + 1}">
${attrs}${attrs && notes ? '\n' : ''}${notes}
    </measure>`;
    })
    .join('\n');

  return `<?xml version="1.0" encoding="UTF-8"?>
<score-partwise version="4.0">
  <work>
    <work-title>${escapeXml(score.title)}</work-title>
  </work>
  <part-list>
    <score-part id="P1">
      <part-name>Melody</part-name>
    </score-part>
  </part-list>
  <part id="P1">
${measureBlocks}
  </part>
</score-partwise>
`;
}
