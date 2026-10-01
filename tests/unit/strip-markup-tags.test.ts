/**
 * #5564 — a bare `/<[^>]+>/g` tag strip reads the `<-` of an OCR centring marker
 * (`->text<-`) as a tag opener and deletes the body up to the next `>`. These pin
 * the shared helper, its .mjs twin, and each call site that was switched to it.
 */
import { describe, it, expect } from 'vitest';

import { stripMarkupTags } from '../../src/lib/strip-markup-tags';
import { stripMarkupTags as stripMarkupTagsMjs } from '../../scripts/lib/strip-markup-tags.mjs';
import { stripApparatusTags } from '../../src/lib/ngram-normalize';
import { stripApparatusTags as stripApparatusTagsMjs } from '../../scripts/lib/ngram-normalize.mjs';
import { transcriptionBody, loopVerdict } from '../../src/lib/ocr-loop-guard';
import { transcriptionBody as transcriptionBodyMjs } from '../../scripts/lib/blank-page-guard.mjs';
import { strippedBody } from '../../src/lib/page-grounding';
import { strippedBody as strippedBodyMjs } from '../../scripts/lib/page-grounding.mjs';
import { pageReadCaution } from '../../src/lib/transcription-reliability';
import { imageDescLen } from '../../src/lib/translate-write';
import { cleanText } from '../../scripts/eval/lib/metrics.mjs';
import { stripTags } from '../../scripts/eval/lib/edition-window.mjs';

// Verbatim shape of the Jonson *Catiline* 1611 page that scored "omitted 100+ words" (#5564).
const REPRO = '->**Fulvia, Galla,**<-\n->**Servant.**<-\nThose Roomes doe smell extremely…\n<vocab>Fulvia</vocab>';

describe('stripMarkupTags', () => {
  it('keeps the body after a centred line (the #5564 repro)', () => {
    // Negative control: the old pattern really does lose it.
    expect(REPRO.replace(/<[^>]+>/g, ' ')).not.toContain('Those Roomes');
    const out = stripMarkupTags(REPRO);
    expect(out).toContain('Those Roomes');
    expect(out).toContain('Servant.');
    expect(out).not.toMatch(/->|<-|<vocab>/);
  });

  it('still strips ordinary tags', () => {
    expect(stripMarkupTags('<header>x</header>').trim()).toBe('x');
    expect(stripMarkupTags('a<unclear>b</unclear>c', '')).toBe('abc');
  });

  it('does not let an arrow in prose eat text', () => {
    const out = stripMarkupTags('cause -> effect, and back <- again <note>n</note> tail');
    for (const w of ['cause', 'effect', 'back', 'again', 'n', 'tail']) expect(out).toContain(w);
  });

  it('handles empty input', () => {
    expect(stripMarkupTags('')).toBe('');
    expect(stripMarkupTags(null)).toBe('');
  });

  it('the .mjs twin is identical', () => {
    for (const s of [REPRO, '<header>x</header>', 'a -> b <- c <i>d</i>', '']) {
      expect(stripMarkupTagsMjs(s)).toBe(stripMarkupTags(s));
      expect(stripMarkupTagsMjs(s, '')).toBe(stripMarkupTags(s, ''));
    }
  });
});

describe('call sites keep the body after a centred line', () => {
  it('ngram stripApparatusTags (both twins, identical)', () => {
    const page = '<header>CATILINE.</header>\n' + REPRO;
    const out = stripApparatusTags(page);
    expect(out).toContain('Those Roomes');
    expect(out).not.toContain('CATILINE');
    expect(stripApparatusTagsMjs(page)).toBe(out);
  });

  it('ocr-loop-guard transcriptionBody (TS + blank-page-guard twin)', () => {
    expect(transcriptionBody(REPRO)).toContain('Those Roomes');
    expect(transcriptionBodyMjs(REPRO)).toBe(transcriptionBody(REPRO));
  });

  it('ocr-loop-guard loopVerdict measures the whole body of a centred-heading page', () => {
    const body = 'Those Roomes doe smell extremely, and the Senate sits in fear of what is coming upon the city; '
      + 'Catiline walks the streets at night and the consul keeps his own counsel in the forum.';
    const page = '->**Fulvia, Galla,**<-\n->**Servant.**<-\n' + body + '\n<vocab>Fulvia</vocab>';
    const v = loopVerdict(page);
    expect(v.refuse).toBe(false);
    // Before #5564 the body was cut to the two headings + "Fulvia" (~30 chars).
    expect(v.body).toBeGreaterThan(body.length * 0.8);
  });

  it('page-grounding strippedBody (both twins)', () => {
    expect(strippedBody(REPRO)).toContain('Those Roomes');
    expect(strippedBodyMjs(REPRO)).toBe(strippedBody(REPRO));
  });

  it('transcription-reliability counts the body after a centred line', () => {
    // 2 chars of <unclear> against a body that, truncated, would be under 60 chars.
    const page = '->**Servant.**<-\n' + 'Those Roomes doe smell extremely of the incense they burnt last night <unclear>ab</unclear>.\n<vocab>x</vocab>';
    expect(pageReadCaution({ ocr: { data: page } })).toBeNull();
  });

  it('translate-write imageDescLen', () => {
    expect(imageDescLen('<image-desc>->A title<-\nA plate of a <b>dragon</b></image-desc>')).toBeGreaterThan(15);
  });

  it('eval cleanText and edition-window stripTags', () => {
    expect(cleanText(REPRO, 'latin')).toContain('Those Roomes');
    expect(stripTags(REPRO)).toContain('Those Roomes');
  });
});
