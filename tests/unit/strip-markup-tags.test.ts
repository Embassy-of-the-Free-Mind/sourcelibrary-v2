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
// The scripts/lib follow-up sites (#5579).
import { stripOcrMetadata } from '../../scripts/lib/language-content-classify.mjs';
import { letterTrigrams } from '../../scripts/lib/ocr-plausibility.mjs';
import { cleanPageText } from '../../scripts/lib/page-embedding-text.mjs';
import { parseTranslationTerms, parseOcrVocab } from '../../scripts/lib/page-terms-parse.mjs';
import { letterCount } from '../../scripts/lib/syriac-kraken-lane.mjs';
import { pageProse } from '../../scripts/lib/title-page-ocr.mjs';
import { strippedBodyLen } from '../../scripts/lib/translate-batch-chained.mjs';
import { pageSkeleton } from '../../scripts/lib/translit-skeleton.mjs';

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

describe('scripts/lib follow-up sites keep the body after a centred line (#5579)', () => {
  // The issue's repro, plus a body tag after the text. Most sites strip <vocab> blocks
  // before the generic strip, which leaves the repro's `<-` with no `>` to run to; the
  // inline <i> survives those block strips, so only the second page pins those sites.
  const PAGES = [
    '->**Servant.**<-\nThose Roomes doe smell extremely\n<vocab>x</vocab>',
    '->**Servant.**<-\nThose Roomes doe <i>smell</i> extremely\n<vocab>x</vocab>',
  ];
  const BODY = 'Those Roomes doe smell extremely';

  it('negative control: the bare pattern loses the body of both pages', () => {
    for (const p of PAGES) expect(p.replace(/<[^>]+>/g, ' ')).not.toContain('Those Roomes');
  });

  it('language-content-classify stripOcrMetadata', () => {
    for (const p of PAGES) expect(stripOcrMetadata(p)).toContain('Those Roomes');
  });

  it('ocr-plausibility letterTrigrams', () => {
    for (const p of PAGES) expect(letterTrigrams(p)).toEqual(expect.arrayContaining(['roo', 'oom', 'mel']));
  });

  it('page-embedding-text cleanPageText (the embedding input)', () => {
    for (const p of PAGES) expect(cleanPageText(p)).toContain(BODY);
    // stripEditorialWrappers already unwrapped a same-line `->x<-`, so only a pair that
    // spans lines (or a stray `<-`) used to cut the embedding text. Pin those.
    expect(cleanPageText('->**Fulvia,\nServant.**<-\nThose Roomes doe <i>smell</i> extremely')).toContain(BODY);
    expect(cleanPageText('Servant.<-\nThose Roomes doe <i>smell</i> extremely')).toContain(BODY);
  });

  it('page-terms-parse keeps the context before a <term> and the term itself', () => {
    const tr = '->**Servant.**<-\nThose Roomes doe <i>smell</i> of <term>frankincense</term> <gloss>olibanum</gloss>';
    const [row] = parseTranslationTerms(tr, null);
    expect(row.term).toBe('frankincense');
    expect(row.context).toContain('Those Roomes');
    expect(parseOcrVocab('<vocab>->Servant<- (a man), Roome (<i>chamber</i>)</vocab>').map(r => r.term))
      .toEqual(expect.arrayContaining(['Servant', 'Roome']));
  });

  it('syriac-kraken-lane letterCount', () => {
    // Servant + Those Roomes doe smell extremely + x — the <vocab> body is page text here.
    for (const p of PAGES) expect(letterCount(p)).toBe('ServantThoseRoomesdoesmellextremelyx'.length);
  });

  it('title-page-ocr pageProse', () => {
    for (const p of PAGES) expect(pageProse(p)).toContain(BODY);
  });

  it('translate-batch-chained strippedBodyLen', () => {
    for (const p of PAGES) expect(strippedBodyLen(p)).toBeGreaterThanOrEqual(BODY.length);
  });

  it('translit-skeleton pageSkeleton', () => {
    const word = 'ἀλλοπρόσαλλος';
    const greek = `->Λόγος<-\n${word}\n<vocab>x</vocab>`;
    expect(greek.replace(/<[^>]+>/g, ' ')).not.toContain(word);
    expect(pageSkeleton('Greek', greek).str).toContain(pageSkeleton('Greek', word).str);
  });
});
