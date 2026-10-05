import { describe, it, expect } from 'vitest';
import {
  cleanPageLines, paneText, pickFilmLines, readPageDescription, readTerms, containsLoose, pickOutroSentence,
} from '@/lib/journey/journey-text';
import { buildTimeline, segAt } from '@/components/journey/journey-timeline';
import { buildJourneyCopy, type JourneyData } from '@/lib/journey/types';

// Shapes taken from Bodhicaryāvatāra p.13 (6a308272675ed2bdbe36f649), trimmed.
const OCR = `<scan-quality>good</scan-quality>
<language>Sanskrit, English</language>
<page-num>2</page-num>
<header>बोधिचित्तानुशंसः प्रथमः परिच्छेदः ।</header>

अनेन श्लोकद्वयेन <margin>1 Nirabhimānatā, new word.</margin> निरभिमानतामात्मनो दर्शयति ।

> क्षणसंपदियं सुदुर्लभा
> प्रतिलब्ध्या पुरुषार्थसाधनी ।
> यदि नात्र विचिन्त्यते हितं
> पुनरप्येष समागमः कुतः ॥ ४ ॥

<vocab>Bodhisattva, Kṣaṇasaṃpad</vocab>`;

const EN = `With these two verses, the author demonstrates his own freedom from pride <margin>1 Freedom from pride <note>original: "Nirabhimānatā"</note>, a new word.</margin>. Now he says:

> This opportunity and wealth of a human life is very difficult to obtain.
> Having attained it, it is the means to accomplish the goals of human existence.
> If one does not consider what is beneficial in this life,
> how will such a meeting ever occur again? (4)

The wealth of opportunity <term>kṣaṇasaṃpad</term> <gloss>the perfection of the moment</gloss> is very difficult to obtain.

<summary>This page explains the rarity of human life, and mentions the previous page.</summary>
<keywords>human rebirth, kṣaṇa, liberation</keywords>`;

describe('journey text', () => {
  it('never lets describing blocks into the pane text', () => {
    const o = paneText(cleanPageLines(OCR));
    const e = paneText(cleanPageLines(EN));
    for (const t of [o, e]) {
      expect(t).not.toMatch(/scan-quality|previous page|human rebirth|Bodhisattva, Kṣaṇasaṃpad|<|>/);
    }
    // a margin follows its paragraph instead of splitting the sentence
    expect(e).toContain('freedom from pride. Now he says:');
    expect(e).toContain('1 Freedom from pride, a new word.');
    // AI notes and glosses are dropped; the kept term stays
    expect(e).not.toContain('perfection of the moment');
    expect(e).toContain('opportunity kṣaṇasaṃpad is');
  });

  it('lifts the verse line for line', () => {
    const l = pickFilmLines(cleanPageLines(OCR), cleanPageLines(EN), null, 'क्षणसंपदियं')!;
    expect(l.pairing).toBe('verse');
    expect(l.original).toHaveLength(4);
    expect(l.original[0]).toBe('क्षणसंपदियं सुदुर्लभा');
    expect(l.english[3]).toBe('how will such a meeting ever occur again? (4)');
  });

  it('falls back to Trace pairs, skipping fragments', () => {
    const l = pickFilmLines('INDEX EORVM\nQVAE IN SINGVLIS', 'INDEX OF THOSE\nWHICH ARE', [
      { s: 'INDEX EORVM', t: 'INDEX OF THOSE THINGS', so: 0, to: 0 },
      { s: 'um cœlestium, continentur.', t: 'spheres.', so: 20, to: 20 },
      { s: 'LIBER PRIMVS.', t: 'BOOK ONE.', so: 40, to: 40 },
    ])!;
    expect(l.pairing).toBe('trace');
    expect(l.original).toEqual(['INDEX EORVM', 'LIBER PRIMVS.']);
  });

  it('reads the machine-written description separately', () => {
    expect(readPageDescription(EN)).toEqual({
      summary: 'This page explains the rarity of human life, and mentions the previous page.',
      keywords: ['human rebirth', 'kṣaṇa', 'liberation'],
    });
    expect(readTerms(EN)).toEqual(['kṣaṇasaṃpad']);
  });

  it('verifies curated strings loosely but not vacuously', () => {
    const e = paneText(cleanPageLines(EN));
    expect(containsLoose(e, 'How will such a meeting ever occur again?')).toBe(true);
    expect(containsLoose(e, 'How will such a meeting never occur again?')).toBe(false);
  });

  it('closes on a whole sentence, not a shouted heading', () => {
    expect(pickOutroSentence('INDEX OF THOSE THINGS WHICH ARE CONTAINED IN THE SIX books of Nicolaus Copernicus. 1. That the universe is spherical, and the earth also is spherical.'))
      .toBe('That the universe is spherical, and the earth also is spherical.');
  });
});

describe('journey timeline', () => {
  const base: JourneyData = {
    bookId: 'b', pageId: 'p', pageNumber: 13, bookPath: '/book/b', readerPath: '/book/b/page/p',
    title: 'T', language: 'Sanskrit', pagesCount: 10, readBy: 'Gemini', readByModel: true, machineDraft: true,
    scan: { url: 'x' }, vault: [], shelf: [], lines: { original: ['a'], english: ['b'], pairing: 'verse' },
    paneOriginal: 'a', paneEnglish: 'b', keywords: [], terms: [], outroQuote: 'q', outroSource: 's',
    citation: { locator: 'p. 13', chicago: '', inline: '', url: '', short_url: '' }, script: 'latin', config: {},
  };

  it('shows only the steps that happened to this page', () => {
    const { steps } = buildJourneyCopy(base);
    expect(steps.map(s => s.key)).toEqual(['find', 'read', 'translate', 'check', 'publish']);
    const tl = buildTimeline(base, steps);
    expect(tl.segs.some(g => g.screen === 'trace')).toBe(false);
    expect(tl.segs.some(g => g.s === 9)).toBe(false);
    // chapter starts are increasing, so the transport can find the chapter
    expect([...tl.chStart].sort((a, b) => a - b)).toEqual(tl.chStart);
  });

  it('includes copy, trace and describe when they happened', () => {
    const d = { ...base, pagesArchived: 10, trace: { s: 'a', t: 'b' }, summary: 'x' };
    const { steps } = buildJourneyCopy(d);
    expect(steps.map(s => s.key)).toEqual(['find', 'copy', 'read', 'translate', 'check', 'describe', 'publish']);
    const tl = buildTimeline(d, steps);
    expect(tl.segs.filter(g => g.screen).map(g => g.screen)).toEqual(['ocr', 'english', 'trace', 'draft', 'overview', 'cite']);
    expect(segAt(tl, tl.total - 0.01).g.end).toBe(true);
  });

  it('never claims a scholar review', () => {
    const { steps } = buildJourneyCopy({ ...base, machineDraft: false });
    const text = steps.map(s => s.body).join(' ');
    expect(text).not.toMatch(/reviewed by a scholar\b(?! *\.)|scholar has reviewed/i);
  });
});
