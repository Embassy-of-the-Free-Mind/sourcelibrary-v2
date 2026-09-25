/**
 * Semantic health checks at the translation door (issue #3756).
 *
 * assessTranslationHealth was extracted from retranslate-pages.mjs; these
 * fixtures pin the thresholds EXACTLY as ported (COLLAPSE_ABS_CAP 800, the
 * 0.3 collapse ratio behind a 400-char OCR floor, the 3× runaway ratio, the
 * 20k raw cap) so a drift in the shared copy fails loudly. The CJK fixture is
 * the #2532 lesson: length-ratio runaway flags were ~97% false positives on
 * CJK (which legitimately expands ~3× in chars) — normal expansion must NOT
 * be flagged.
 */
import { describe, it, expect } from 'vitest';
import {
  assessTranslationHealth,
  bodyLen,
  isCollapsed,
  isExcess,
  COLLAPSE_ABS_CAP,
  BLOCK_TAGS,
  writePageTranslation,
  // eslint-disable-next-line @typescript-eslint/ban-ts-comment
  // @ts-ignore — plain-JS module, no declarations
} from '../../scripts/lib/translate-core.mjs';

const latinOcr = 'x'.repeat(2000); // a substantial page (body 2000)

describe('threshold constants (ported exactly from retranslate-pages)', () => {
  it('COLLAPSE_ABS_CAP is 800', () => {
    expect(COLLAPSE_ABS_CAP).toBe(800);
  });
  it('BLOCK_TAGS carries the editorial-wrapper list', () => {
    expect(BLOCK_TAGS).toEqual(['meta','image-desc','vocab','summary','keywords','warning','note',
      'scan-quality','language','page-type','page-num','header','sig','insert','columns','script']);
  });
});

describe('bodyLen', () => {
  it('strips editorial block wrappers before measuring', () => {
    const tr = `<summary>${'s'.repeat(600)}</summary> ${'x'.repeat(100)}`;
    expect(bodyLen(tr)).toBe(100);
  });
  it('handles null/empty', () => {
    expect(bodyLen(null)).toBe(0);
    expect(bodyLen('')).toBe(0);
  });
});

describe('collapsed page', () => {
  it('a wrapper-only sliver against real OCR is collapsed', () => {
    const tr = `<summary>${'s'.repeat(600)}</summary> ${'x'.repeat(100)}`;
    expect(isCollapsed(latinOcr, tr)).toBe(true);
    expect(assessTranslationHealth(latinOcr, tr)).toEqual({ healthy: false, reason: 'collapsed' });
  });

  it('"continued from previous page" stub under 60 chars is collapsed', () => {
    const tr = 'Continued from previous page.';
    expect(assessTranslationHealth('x'.repeat(500), tr)).toEqual({ healthy: false, reason: 'collapsed' });
  });

  it('dense page: low ratio but body >= 800 is NOT a collapse (absolute cap)', () => {
    // Ratio-only flagged ~20% false positives from oversized OCR denominators.
    const tr = 'x'.repeat(800);
    expect(assessTranslationHealth('x'.repeat(10000), tr).healthy).toBe(true);
    // one char below the cap with the same low ratio IS a collapse
    expect(assessTranslationHealth('x'.repeat(10000), 'x'.repeat(799)))
      .toEqual({ healthy: false, reason: 'collapsed' });
  });

  it('short OCR (< 400 body) never counts as collapsed', () => {
    expect(assessTranslationHealth('x'.repeat(399), 'x'.repeat(20)).healthy).toBe(true);
  });
});

describe('runaway page', () => {
  it('translation body > 3x OCR body (OCR >= 300) is a runaway', () => {
    expect(isExcess('x'.repeat(500), 'x'.repeat(2000))).toBe(true);
    expect(assessTranslationHealth('x'.repeat(500), 'x'.repeat(2000)))
      .toEqual({ healthy: false, reason: 'runaway' });
  });

  it('the 3x ratio is strict: exactly 3x is NOT a runaway', () => {
    expect(assessTranslationHealth('x'.repeat(300), 'x'.repeat(900)).healthy).toBe(true);
    expect(assessTranslationHealth('x'.repeat(300), 'x'.repeat(901)).healthy).toBe(false);
  });

  it('raw length > 20000 is always a runaway, regardless of OCR', () => {
    expect(assessTranslationHealth('', 'x'.repeat(20001)))
      .toEqual({ healthy: false, reason: 'runaway' });
  });

  it('low-OCR pages (headers, image-only) are exempt from the ratio', () => {
    expect(assessTranslationHealth('x'.repeat(299), 'x'.repeat(5000)).healthy).toBe(true);
  });
});

describe('healthy page', () => {
  it('an ordinary translation of an ordinary page is healthy', () => {
    expect(assessTranslationHealth(latinOcr, 'x'.repeat(1800)))
      .toEqual({ healthy: true, reason: null });
  });
});

describe('CJK expansion (#2532: NOT a runaway)', () => {
  it('a ~2.8x char expansion of a CJK page is healthy', () => {
    const cjkOcr = '道'.repeat(1000); // body 1000
    const english = 'x'.repeat(2800); // ~2.8x — normal CJK-to-English expansion
    expect(assessTranslationHealth(cjkOcr, english)).toEqual({ healthy: true, reason: null });
  });
});

// ── refuseUnhealthy mode of writePageTranslation ───────────────────────────
function makeDbStub() {
  const calls: { updates: unknown[]; revisions: unknown[] } = { updates: [], revisions: [] };
  const pageDoc = { id: 'p1', book_id: 'b1', translation: { data: 'old ai', source: 'ai' } };
  const db = {
    collection(name: string) {
      return {
        findOne: async () => pageDoc,
        find: () => ({ toArray: async () => [pageDoc] }),
        updateOne: async (...args: unknown[]) => { if (name === 'pages') calls.updates.push(args); return { modifiedCount: 1 }; },
        insertMany: async (docs: unknown[]) => { if (name === 'page_revisions') calls.revisions.push(...docs); return {}; },
        aggregate: () => ({ toArray: async () => [] }),
      };
    },
  };
  return { db, calls };
}

const baseArgs = {
  page: { id: 'p1', book_id: 'b1', ocr: { data: latinOcr } },
  book: { language: 'latin' },
  promptRef: { id: 'x', name: 'Standard Translation', version: 12 },
};

describe('writePageTranslation refuseUnhealthy', () => {
  it('refuses a collapsed result: no write, no revision, reason surfaced', async () => {
    const { db, calls } = makeDbStub();
    const r = await writePageTranslation(db, { ...baseArgs, text: 'tiny.', refuseUnhealthy: true });
    expect(r).toMatchObject({ written: false, unhealthy: true, reason: 'collapsed' });
    expect(calls.updates.length).toBe(0);
    expect(calls.revisions.length).toBe(0);
  });

  it('refuses a runaway result', async () => {
    const { db, calls } = makeDbStub();
    const r = await writePageTranslation(db, { ...baseArgs, text: 'x'.repeat(20001), refuseUnhealthy: true });
    expect(r).toMatchObject({ written: false, unhealthy: true, reason: 'runaway' });
    expect(calls.updates.length).toBe(0);
  });

  it('writes a healthy result normally', async () => {
    const { db, calls } = makeDbStub();
    const r = await writePageTranslation(db, { ...baseArgs, text: 'x'.repeat(1800), refuseUnhealthy: true });
    expect(r.written).toBe(true);
    expect(calls.updates.length).toBe(1);
  });

  it('is OPT-IN: without the flag an unhealthy result still writes (worker behavior unchanged)', async () => {
    const { db, calls } = makeDbStub();
    const r = await writePageTranslation(db, { ...baseArgs, text: 'tiny.' });
    expect(r.written).toBe(true);
    expect(r.unhealthy).toBeUndefined();
    expect(calls.updates.length).toBe(1);
  });
});

/**
 * The echo tier (#5103 round 4): a "translation" that is the source handed back. The fixture is
 * the shape that reached the gate: page 68 of the Neukirch chapter statutes, whose Latin oath the
 * model had already completed on page 67 and then echoed verbatim as page 68's translation. The
 * tier is armed only by the book's language — an English source is modernised and shares runs
 * with its "translation" by design.
 */
const OATH_LATIN = 'Capituli Patronis hunc eligere, quem credam futurum eidem Capitulo in spiritualibus & temporalibus utiliorem, nec illi vocem dare, quem verisimiliter, si verò promissione, aut datione alicujus rei temporalis seu portio per se, aut interpositam personam, aut aliàs qualitercunque directè vel indirectè pro se Electionem procurâsse. Sic me Deus adjuvet, & hæc sancta Dei Evangelia. Ego NN. in Decanum hujus Capituli canonicè electus spondeo, voveo, & juro, Deo Omnipotenti, Beatissimæ Mariæ Virgini, sanctis Apostolis Petro & Paulo Patronis ejusdem, me Jura, Privilegia, consuetudines antedicti Capituli pro viribus contra quoscunque defensurum.';
const OATH_OCR = `<language>Latin</language>\n<page-num>57</page-num>\n\n${OATH_LATIN}`;
const OATH_ENGLISH = 'of the Chapter, to elect him whom I believe will be more useful to the same Chapter in spiritual and temporal matters, and not to give my vote to him who, in my judgment, has procured the election for himself by promise or by the giving of some temporal thing or portion, either by himself or through an intermediary person, or otherwise in any way directly or indirectly. So help me God, and these holy Gospels of God. I, N.N., canonically elected as Dean of this Chapter, promise, vow, and swear to God Almighty, to the most Blessed Virgin Mary, and to the holy Apostles Peter and Paul, patrons of the same, that I will defend the rights, privileges and customs of the aforesaid Chapter with all my strength against anyone.';

describe('echo tier (#5103): the source handed back as the translation', () => {
  it('a Latin page whose "translation" is its own source is refused as echo', () => {
    const echoed = `<page-num>57</page-num>\n\n${OATH_LATIN}`;
    expect(assessTranslationHealth(OATH_OCR, echoed, { lang: 'Latin' })).toEqual({ healthy: false, reason: 'echo' });
  });

  it('the real translation of the same page is healthy', () => {
    expect(assessTranslationHealth(OATH_OCR, OATH_ENGLISH, { lang: 'Latin' })).toEqual({ healthy: true, reason: null });
  });

  it('negative control — without the book language the echo tier is skipped, never guessed', () => {
    const echoed = `<page-num>57</page-num>\n\n${OATH_LATIN}`;
    expect(assessTranslationHealth(OATH_OCR, echoed)).toEqual({ healthy: true, reason: null });
  });

  it('an English source is exempt: its modernisation shares the text by design', () => {
    const english = 'Whosoever therefore shall be ashamed of me and of my words in this adulterous and sinful generation, of him also shall the Son of man be ashamed, when he cometh in the glory of his Father with the holy angels. And he said unto them, Verily I say unto you, that there be some of them that stand here, which shall not taste of death, till they have seen the kingdom of God come with power.';
    const modernised = english.replace('Whosoever', 'Whoever').replace('cometh', 'comes').replace('unto', 'to');
    expect(assessTranslationHealth(`<language>English</language>\n\n${english}`, modernised, { lang: 'English' })).toEqual({ healthy: true, reason: null });
    expect(assessTranslationHealth(`<language>English</language>\n\n${english}`, modernised, { lang: 'en' })).toEqual({ healthy: true, reason: null });
  });

  it('a list-like run kept in the original (an index of names with page numbers) is not an echo while it is part of the page', () => {
    const names = 'Vitalianus Bapst 175. Marggraff Ottho von Wit. 282. Wittichius der Gotthen König 170. Vladislaus König in Ungern vnd Behem 381. Vlid Saracenisch. Amyr. 180. Vlpianus ein fürnemer Rechtsgelehrt 131. Vlm kompt an das Gottshauß Reichenaw 195. S. Ulrich 210. Valentinianus Keyser 88. Valerius Maximus 34. Varro 77. Vespasianus Keyser 12. Vitellius Keyser 11.';
    const ocr = `<language>German</language>\n<page-type>index</page-type>\n\n${names}`;
    const tr = `Register of names. ${names} These are the persons and places named in the foregoing chronicle, with the leaf on which each is treated, so that the reader may find any king, bishop or town without turning the whole book; the compiler has followed the order of the alphabet as far as the old spellings allow it, and has added the emperors of Rome at the end for the convenience of those who read the histories of the ancients beside the histories of the Germans.`;
    expect(assessTranslationHealth(ocr, tr, { lang: 'German' })).toEqual({ healthy: true, reason: null });
  });

  it('collapse and runaway still come first', () => {
    expect(assessTranslationHealth(latinOcr, 'tiny.', { lang: 'Latin' }).reason).toBe('collapsed');
  });
});
