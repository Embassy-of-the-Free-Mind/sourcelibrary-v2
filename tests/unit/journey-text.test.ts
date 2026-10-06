import { describe, it, expect } from 'vitest';
import {
  cleanPageLines, paneText, pickFilmLines, containsLoose, pickOutroSentence,
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

  it('lifts only as many Trace lines as asked, without the verse number', () => {
    // Shape from Haṭhayogapradīpikā p.20 (6991d89a8c1030b12444c076), verse 1.10.
    const pairs = [
      { s: 'अल्लामः प्रभुदेवश्च घोडा चोली च टिटिणिः ॥', t: 'Allama, Prabhudeva, Ghoda, Choli, and Tintini. || 8 ||', so: 0, to: 0 },
      { s: 'अशेषतापतप्तानां समाश्रयमठो हठः ॥', t: 'Hatha Yoga is a sheltering monastery for those scorched by every kind of suffering.', so: 10, to: 10 },
      { s: 'अशेषयोगयुक्तानामाधारकमठो हठः ॥ १० ॥', t: 'For those engaged in any form of Yoga, Hatha is the supporting tortoise. || 10 ||', so: 20, to: 20 },
      { s: 'इत्यादय इति । इति पूर्वोक्ता आदयो येषां ते तथा ।', t: 'Regarding "These and others".', so: 30, to: 30 },
    ];
    const l = pickFilmLines('x', 'y', pairs, 'अशेषतापतप्तानां', 2)!;
    expect(l.pairing).toBe('trace');
    expect(l.original).toEqual(['अशेषतापतप्तानां समाश्रयमठो हठः ॥', 'अशेषयोगयुक्तानामाधारकमठो हठः ॥ १० ॥']);
    expect(l.english[1]).toBe('For those engaged in any form of Yoga, Hatha is the supporting tortoise.');
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
    paneOriginal: 'a', paneEnglish: 'b', outroQuote: 'q', outroSource: 's',
    citation: { locator: 'p. 13', chicago: '', inline: '', url: '', short_url: '' }, script: 'latin', config: {},
    connect: { index: [], editions: [] }, revisions: { count: 0 },
  };
  const connected: Partial<JourneyData> = {
    connect: {
      search: { query: 'masters who conquered death', rank: 1, results: [{ title: 'T', page: 13, href: '/x', here: true, sameWork: false }] },
      index: [{ name: 'Allama', type: 'person', href: '/encyclopedia/Allama' }],
      editions: [{ title: 'Hathayogapradipika', language: 'Sanskrit', published: '1867', href: '/book/e' }],
    },
    revisions: { count: 1, latest: { field: 'translation', at: '2026-10-06T10:16:24.479Z' } },
  };

  it('shows only the steps that happened to this page, publishing before checking', () => {
    const { steps, parts } = buildJourneyCopy(base);
    expect(steps.map(s => s.key)).toEqual(['find', 'read', 'translate', 'publish', 'check']);
    expect(parts.map(p => p.eyebrow)).toEqual(['Part I', 'Part II', 'Part III', 'Part IV']);
    const tl = buildTimeline(base, steps);
    expect(tl.segs.some(g => g.screen === 'trace' || g.screen === 'search' || g.screen === 'links')).toBe(false);
    expect(tl.segs.some(g => g.s === 9 || g.s === 45)).toBe(false);
    // chapter starts are increasing, so the transport can find the chapter
    expect([...tl.chStart].sort((a, b) => a - b)).toEqual(tl.chStart);
  });

  it('has six chapters in the order of Figure 1 when the page is connected', () => {
    const d = { ...base, ...connected, pagesArchived: 10, trace: { s: 'a', t: 'b' } } as JourneyData;
    const { steps, parts } = buildJourneyCopy(d);
    expect(steps.map(s => s.key)).toEqual(['find', 'read', 'translate', 'connect', 'publish', 'check']);
    expect(parts).toHaveLength(5);
    const tl = buildTimeline(d, steps);
    expect(tl.segs.filter(g => g.screen).map(g => g.screen))
      .toEqual(['ocr', 'english', 'search', 'links', 'overview', 'cite', 'trace', 'checks', 'draft']);
    expect([...tl.chStart].sort((a, b) => a - b)).toEqual(tl.chStart);
    expect(segAt(tl, tl.total - 0.01).g.end).toBe(true);
    const connect = steps.find(s => s.key === 'connect')!.body;
    expect(connect).toContain('“masters who conquered death”');
    expect(connect).toContain('first');
    expect(connect).toContain('Allama');
    expect(connect).toContain('the 1867 Sanskrit edition');
    const check = steps.find(s => s.key === 'check')!.body;
    expect(check).toContain('corrected once, most recently on 6 October 2026');
  });

  it('never says "machine draft"', () => {
    const d = { ...base, ...connected } as JourneyData;
    const { steps, parts } = buildJourneyCopy(d);
    const text = [...steps.map(s => `${s.title} ${s.body}`), ...parts.map(p => `${p.title} ${p.body}`)].join(' ');
    expect(text).not.toMatch(/machine[- ]draft/i);
  });

  it('never claims a scholar review', () => {
    const { steps } = buildJourneyCopy({ ...base, machineDraft: false });
    const text = steps.map(s => s.body).join(' ');
    expect(text).not.toMatch(/reviewed by a scholar\b(?! *\.)|scholar has reviewed/i);
  });
});
