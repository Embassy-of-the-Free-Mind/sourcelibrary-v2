/**
 * Work-identity gold set for the reference-set search. (#3459)
 *
 * WHY THIS FILE EXISTS
 * --------------------
 * The matcher was tuned five times by eyeballing samples. Every pass fixed a
 * visible artifact and introduced an invisible one:
 *
 *   1. coverage of OUR tokens only        → "Iliad." vs "Homer, Iliad with
 *                                           Scholia" scored 0.33; 8 matches found
 *   2. max(both directions)               → 74 matches, but any single-token
 *                                           record matched anything containing it
 *   3. romanized-Tibetan stoplist         → shrank book token lists, INFLATING
 *                                           hits/bookTokens: 187 → 726 Tibetan
 *   4. specificity floor on token counts  → lost Cicero's *De Officiis* (Grimald
 *                                           1556), Plutarch's *Moralia* (1561) and
 *                                           Della Porta entirely — verified true
 *                                           positives, silently restored to
 *                                           "no prior found"
 *
 * Step 4 is the dangerous one: it made the corpus look CLEANER while being
 * strictly more wrong, and nothing would have caught it. Tuning a ratio against
 * whichever sample you happened to read is not convergence.
 *
 * So the thresholds are now pinned to hand-verified pairs. Every LoC row below
 * is REAL MARC fetched from the 2016 MDSConnect dump; every book is a real badged
 * record. Any future change to the matcher must keep the positives and keep
 * rejecting the negatives, and will be measured rather than argued about.
 *
 * The negatives matter as much as the positives — they are the false-positive
 * classes that four of the five iterations produced.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, it, expect } from 'vitest';

// @ts-expect-error — .mjs script module without type declarations
import {
  uniformTitleContainment,
  displayTitleOverlap,
  bookTitleTokens,
  vernacularContainment,
  cjkRuns,
  STRONG_WORK_IDENTITY,
} from '../../scripts/lib/work-identity-match.mjs';

type LocRow = {
  lccn: string; title: string; subtitle?: string; uniform_title: string; year: string;
  author?: string; added_entries?: string[];
  original_languages: string[];
};

const rows: LocRow[] = JSON.parse(
  readFileSync(resolve(__dirname, '../fixtures/reference-set/loc-gold-rows.json'), 'utf8'),
);

const byTitle = (re: RegExp) => {
  const hit = rows.find((r) => !r.uniform_title && re.test(r.title || ''));
  if (!hit) throw new Error(`gold fixture missing a 240-less row with title matching ${re}`);
  return hit;
};

const byUniform = (re: RegExp) => {
  const hit = rows.find((r) => re.test(r.uniform_title || ''));
  if (!hit) throw new Error(`gold fixture missing a row with uniform_title matching ${re}`);
  return hit;
};

/**
 * Tokenisation comes from the lib itself. A local copy would let the test and
 * the implementation drift apart, which is how a green guard stops guarding.
 */
const bookTokens = (...titles: string[]) => bookTitleTokens(...titles);

/** Same surname rule the search uses: "Last, First" → "last". */
const surname = (a: string) => {
  let c = (a || '').replace(/\([^)]*\)/g, '').replace(/\d{3,4}/g, '').split(';')[0].trim();
  if (c.includes(',')) c = c.split(',')[0];
  const w = c.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter((x) => x.length > 1);
  return w[w.length - 1] || '';
};

/** Author options exactly as the real run supplies them, from the fixture row. */
const authorOpts = (row: LocRow & { author?: string; added_entries?: string[] }, bookAuthor: string) => ({
  bookAuthorSurname: surname(bookAuthor),
  recordAuthorSurnames: [row.author, ...(row.added_entries || [])]
    .filter(Boolean).map(surname).filter(Boolean),
  // Full name strings, so the 245 fallback can discount personal-name tokens that
  // appear inside the titles themselves ("The Iliad of HOMER").
  authorNames: [bookAuthor, row.author, ...(row.added_entries || [])].filter(Boolean),
});

describe('MUST MATCH — hand-verified prior English translations', () => {
  // Each of these was confirmed by reading the record. Losing any one means the
  // search reports "no prior found" for a work that has been in English for
  // centuries.
  const cases: Array<[string, RegExp, string[], string]> = [
    ['Cicero, De Officiis → Grimald 1556', /^De officiis/i,
      ['De officiis. Add: Paradoxa Stoicorum. Hexastichon', 'De Officiis'], 'Cicero, Marcus Tullius'],
    ['pseudo-Seneca, De formula honestae vitae → 1546', /^Formula vitae honestae/i,
      ['De quattuor virtutibus cardinalibus, sive De formula honestae vitae', 'De formula honestae vitae'], 'Seneca, Lucius Annaeus'],
    ['Plutarch, Moralia → Three morall treatises 1561', /^Moralia/i,
      ['Plutarchi Chaeronensis Moralia (Hercher edition)', 'Plutarchi Chaeronensis Moralia'], 'Plutarch'],
    ['Euclid, Elements → Billingsley 1570', /^Elements/i,
      ['Elementa Euclides Geometriae, Planae ac Solidae', 'Στοιχεῖα (Elements)'], 'Euclid'],
    ['Boethius, Consolatio → 1609', /^De consolatione philosophiae/i,
      ['De Consolatione Philosophiae', 'De consolatione philosophiae'], 'Boethius'],
    ['Homer, Iliad → Chapman 1609', /^Iliad/i,
      ['Homer, Iliad with Scholia', 'The Iliad of Homer'], 'Homer'],
    ['Della Porta, Magia Naturalis → Natural magick 1658', /^Magiae naturalis/i,
      ['Magia Naturalis. 2', 'Magia Naturalis'], 'Della Porta, Giambattista'],
    ['Tibetan: Legs bshad gser phreng → Golden garland 2008', /^Legs bshad gser phreng/i,
      ['Neyphug Thor bu Legs bshad gser phreng', 'Neyphug Thor bu Legs bshad gser phreng'], ''],
  ];

  it.each(cases)('%s', (_label, uniformRe, titles, bookAuthor) => {
    const row = byUniform(uniformRe);
    const result = uniformTitleContainment(
      bookTokens(...titles), row.uniform_title, authorOpts(row as any, bookAuthor),
    );
    expect(result, `uniform title "${row.uniform_title}" should be contained in ${JSON.stringify(titles)}`)
      .not.toBeNull();
    expect(result.score).toBeGreaterThanOrEqual(0.6);
  });

  it('matches across Latin case-ending variation (magiae ⇔ magia)', () => {
    // Stemming earns its keep here: an exact-token rule would miss this.
    const row = byUniform(/^Magiae naturalis/i);
    expect(uniformTitleContainment(
      bookTokens('Magia Naturalis'), row.uniform_title,
      authorOpts(row as any, 'Della Porta, Giambattista'),
    )).not.toBeNull();
  });

  it('ignores word ORDER — a uniform title is a set, not a phrase', () => {
    // "Formula vitae honestae" vs our "De formula honestae vitae": substring
    // matching fails, set containment succeeds.
    const row = byUniform(/^Formula vitae honestae/i);
    expect(uniformTitleContainment(
      bookTokens('De formula honestae vitae'), row.uniform_title,
      authorOpts(row as any, 'Seneca, Lucius Annaeus'),
    )).not.toBeNull();
  });
});

describe('MUST NOT MATCH — the false-positive classes the tuning produced', () => {
  it('rejects a French novel against a Tibetan ritual text (the "dregs" case)', () => {
    // "The cup to the dregs" matched at 1.00 because "dregs" is both an English
    // word and a romanized Tibetan syllable, and the record's display title
    // reduced to that single token.
    const row = byUniform(/^Calice/i);
    const result = uniformTitleContainment(
      bookTokens('Neyphug Thor bu Thugs sgrub dregs pa zil gnon'),
      row.uniform_title,
    );
    expect(result).toBeNull();
  });

  it('rejects a match resting only on generic Tibetan vocabulary', () => {
    // "ʼDod paʼi bstan bcos" ("Tibetan arts of love") vs an unrelated treatise.
    // `bstan bcos` just means "treatise" — the equivalent of matching on
    // "tractatus".
    const row = byUniform(/bstan bcos/i);
    const result = uniformTitleContainment(
      bookTokens("she bya rab tu gsal ba'I bstan bcos dang sen"),
      row.uniform_title,
    );
    expect(result).toBeNull();
  });

  it('rejects a same-author different-work pairing', () => {
    const row = byUniform(/^De officiis/i);
    expect(uniformTitleContainment(
      bookTokens('De natura deorum'), row.uniform_title,
      authorOpts(row as any, 'Cicero, Marcus Tullius'),
    )).toBeNull();
  });

  it('returns null rather than guessing when there is no uniform title', () => {
    // 32% of reference-set rows have no 240. Absent is not a match.
    expect(uniformTitleContainment(bookTokens('De Officiis'), '', { bookAuthorSurname: 'cicero', recordAuthorSurnames: ['cicero'] })).toBeNull();
    expect(uniformTitleContainment([], 'De officiis.')).toBeNull();
  });
});

describe('generic uniform titles need author corroboration', () => {
  // A one- or two-word uniform title is often a GENRE, not a work. Containment
  // alone matched these four in the full corpus run, and each is absurd on
  // sight — every one pairs a different author.
  const generic: Array<[string, string, string[], string]> = [
    ['Annales. — Masonic annals vs Tacitus', 'Annales.',
      ['Annales mac[onniques]'], 'tacitus'],
    ['Itinerarium. — Portuguese voyage vs Mandeville', 'Itinerarium.',
      ['Itinerarium Portugallensium e Lusitania in Indiam'], 'mandeville'],
    ['Journal. — Hermetisches Journal vs a French diarist', 'Journal.',
      ['Hermetisches Journal'], 'guerin'],
    ['Max und Moritz — a German life vs Wilhelm Busch', 'Max und Moritz.',
      ['Merckwürdiges Leben des Herrn Moritz Wilhelms'], 'busch'],
  ];

  it.each(generic)('rejects %s when the author disagrees', (_l, uniform, titles, recordAuthor) => {
    const result = uniformTitleContainment(bookTokens(...titles), uniform, {
      bookAuthorSurname: 'anonymous-or-different',
      recordAuthorSurnames: [recordAuthor],
    });
    expect(result).toBeNull();
  });

  it('rejects a generic uniform title when the book has NO author at all', () => {
    // The conservative direction: an anonymous work can only match on a long,
    // distinctive uniform title. Better to leave a claim standing than to demote
    // it on a coincidence.
    expect(uniformTitleContainment(bookTokens('Annales mac[onniques]'), 'Annales.', {
      bookAuthorSurname: '',
      recordAuthorSurnames: ['tacitus'],
    })).toBeNull();
  });

  it('ACCEPTS a one-token uniform title when the author agrees', () => {
    // The true positives are all one-token: "De officiis.", "Moralia.",
    // "Elements.", "Poetics.". Raising a threshold would have lost every one of
    // them, which is why corroboration is the right lever, not specificity.
    const result = uniformTitleContainment(
      bookTokens('De officiis. Add: Paradoxa Stoicorum', 'De Officiis'),
      'De officiis.',
      { bookAuthorSurname: 'cicero', recordAuthorSurnames: ['cicero'] },
    );
    expect(result).not.toBeNull();
    expect(result.basis).toBe('uniform_title_containment+author');
  });

  it('does not require author agreement for a long, distinctive uniform title', () => {
    // "Legs bshad gser phreng" is 4 tokens and unmistakable; its catalogued
    // "author" on our side is a monastery collection, so demanding agreement
    // would discard a genuine find.
    const row = byUniform(/^Legs bshad gser phreng/i);
    const result = uniformTitleContainment(
      bookTokens('Neyphug Thor bu Legs bshad gser phreng'),
      row.uniform_title,
      { bookAuthorSurname: '', recordAuthorSurnames: [] },
    );
    expect(result).not.toBeNull();
  });
});

/**
 * THE 240 RECALL CEILING
 * ----------------------
 * 35.2% of reference-set rows carry no MARC 240 (41,678 of 118,352). Work
 * identity is established by 240 containment, and the 245 display-title fallback
 * was capped at 0.55 — below the 0.60 confirmation threshold — so over a third of
 * the set could NEVER produce a confirmed match no matter how exactly it agreed.
 * Every one of those rows could only ever yield `none_found`.
 *
 * The naive repair is to raise the cap. That is the ratio-tuning that failed five
 * times, and it fails here for a nameable reason: on a 245 the overlap is
 * frequently carried by THE AUTHOR'S OWN NAME. "Poetics" against "The Rhetoric of
 * Aristotle." scores well while sharing no work content at all, because both
 * titles say "Aristotle".
 *
 * So the instrument, not the threshold: discount personal-name tokens, then
 * require SET CONTAINMENT of what remains in one direction or the other, plus
 * author agreement. Containment is the same test the 240 path uses, for the same
 * reason — an edition's 245 carries apparatus ("The thirteen books of…",
 * "English translation of…") that a ratio punishes and containment tolerates.
 *
 * Every row below is real MARC from the 2016 dump with a genuinely empty 240, and
 * every book is a real record in our corpus.
 */
describe('245 display-title fallback — MUST CONFIRM (the 240-less true positives)', () => {
  const cases: Array<[string, RegExp, string[], string]> = [
    ['Homer, Iliad → Lang/Leaf/Myers 1903', /^The Iliad of Homer,/,
      ['The Iliad of Homer'], 'Homer'],
    ['Euclid, Elements → Heath 1908 (record carries "thirteen books of")', /thirteen books of Euclid/,
      ['Elementa (Euclid)', 'Στοιχεῖα (Elements)'], 'Euclid'],
    ['Chaucer, Canterbury Tales → Coghill 1952', /^The Canterbury tales/,
      ['The Canterbury Tales'], 'Geoffrey Chaucer'],
    ['al-Bukhari, Sahih → 1973 (record is CONTAINED in our title)', /English translation of Sahih al-Bukhari/,
      ['Sahih al-Bukhari (Complete)'], 'Imam al-Bukhari'],
    ['Hammurabi, Code → Viel 2005', /^The complete code of Hammurabi/,
      ['Code of Hammurabi'], 'Court scribe of Hammurabi'],
    ['Petrie, Egyptian Tales → 1899', /^Egyptian tales translated from the papyri/,
      ['Egyptian Tales Translated from the Papyri'], 'W. M. Flinders Petrie'],
    ['Wittgenstein, Tractatus → 2014', /^Tractatus logico-philosophicus/,
      ['Tractatus Logico-Philosophicus'], 'Ludwig Wittgenstein'],
    ['Suetonius, De grammaticis → Kaster 1995', /^De grammaticis et rhetoribus/,
      ['De grammaticis et rhetoribus'], 'Suetonius'],
  ];

  it.each(cases)('%s', (_label, titleRe, bookTitles, bookAuthor) => {
    const row = byTitle(titleRe);
    const result = displayTitleOverlap(
      bookTokens(...bookTitles), `${row.title} ${row.subtitle ?? ''}`, authorOpts(row, bookAuthor),
    );
    expect(result, `"${row.title}" should confirm against ${JSON.stringify(bookTitles)}`).not.toBeNull();
    expect(result.score).toBeGreaterThanOrEqual(STRONG_WORK_IDENTITY);
  });
});

describe('245 display-title fallback — MUST NOT CONFIRM', () => {
  // The whole reason a cap existed. Each of these agrees on AUTHOR and shares
  // tokens; none of them is the same work.
  it('rejects Poetics against "The Rhetoric of Aristotle" — the overlap IS the author', () => {
    const row = byTitle(/^The Rhetoric of Aristotle\./);
    const result = displayTitleOverlap(
      bookTokens('Poetics'), `${row.title} ${row.subtitle ?? ''}`, authorOpts(row, 'Aristotle'),
    );
    expect(result?.score ?? 0).toBeLessThan(STRONG_WORK_IDENTITY);
  });

  it('rejects Phaedo against "Four texts on Socrates" (Euthyphro, Apology, Crito)', () => {
    const row = byTitle(/^Four texts on Socrates/);
    const result = displayTitleOverlap(
      bookTokens('Phaedo'), `${row.title} ${row.subtitle ?? ''}`, authorOpts(row, 'Plato'),
    );
    expect(result?.score ?? 0).toBeLessThan(STRONG_WORK_IDENTITY);
  });

  it('rejects Villon\'s Oeuvres against his Testaments — a part is not the whole', () => {
    const row = byTitle(/^The testaments of Francois Villon/);
    const result = displayTitleOverlap(
      bookTokens('Les Oeuvres de François Villon'), `${row.title} ${row.subtitle ?? ''}`,
      authorOpts(row, 'François Villon'),
    );
    expect(result?.score ?? 0).toBeLessThan(STRONG_WORK_IDENTITY);
  });

  it('rejects two works of one author that share a single ordinary token', () => {
    // Historia animalium vs De partibus animalium: "animalium" is shared, neither
    // title is contained in the other. A min-coverage rule at 0.5 confirms this;
    // containment does not.
    const result = displayTitleOverlap(
      bookTokens('Historia animalium'), 'De partibus animalium',
      { bookAuthorSurname: 'aristotle', recordAuthorSurnames: ['aristotle'], authorNames: ['Aristotle'] },
    );
    expect(result?.score ?? 0).toBeLessThan(STRONG_WORK_IDENTITY);
  });

  it('NEVER confirms without author agreement, however exact the title', () => {
    // The title-token lane has no author access point at all. A 245 match there
    // rests on nothing but words, which is precisely how "The cup to the dregs"
    // matched a Tibetan ritual text.
    const row = byTitle(/^The Canterbury tales/);
    const noAuthor = displayTitleOverlap(
      bookTokens('The Canterbury Tales'), row.title,
      { bookAuthorSurname: '', recordAuthorSurnames: [] },
    );
    expect(noAuthor?.score ?? 0).toBeLessThan(STRONG_WORK_IDENTITY);

    const wrongAuthor = displayTitleOverlap(
      bookTokens('The Canterbury Tales'), row.title,
      authorOpts(row, 'Someone Else'),
    );
    expect(wrongAuthor?.score ?? 0).toBeLessThan(STRONG_WORK_IDENTITY);
  });

  it('still returns the weak hint rather than null, so screening can see it', () => {
    // A rejected confirmation must not become an absence. The candidate is still
    // retrieved and screened; it simply cannot assert work identity by itself.
    const row = byTitle(/^The Rhetoric of Aristotle\./);
    const result = displayTitleOverlap(bookTokens('Poetics of Aristotle'), row.title, authorOpts(row, 'Aristotle'));
    expect(result).not.toBeNull();
    expect(result.basis).toBe('display_title_overlap');
  });
});

describe('fixture integrity', () => {
  it('holds real LoC rows with LCCNs', () => {
    expect(rows.length).toBeGreaterThanOrEqual(14);
    for (const r of rows) expect(r.lccn, `row "${r.title}" has no LCCN`).toBeTruthy();
  });

  it('includes both positive and negative uniform titles', () => {
    expect(rows.some((r) => /^De officiis/i.test(r.uniform_title))).toBe(true);
    expect(rows.some((r) => /^Calice/i.test(r.uniform_title))).toBe(true);
  });
});

describe('CJK original-script matching (MARC 880)', () => {
  // Romanized matching is unusable for CJK: LoC mixes pinyin and Wade-Giles,
  // pinyin is syllable-separated where our titles are joined, and most syllables
  // fall under the token floor. Concatenate-and-substring was measured at ~2 real
  // matches in 38 — "mingshi" sits inside "zhiwumingshitukao", matching a herbal
  // to the Ming History. Han characters are morphemes with one spelling, so a
  // shared run is strong evidence.
  it('matches an exact vernacular uniform title', () => {
    expect(vernacularContainment(['針灸大成 (Zhenjiu Dacheng)'], {
      vernacular_uniform_title: '針灸大成',
    })).not.toBeNull();
  });

  it('treats a contained run as a real related-work signal', () => {
    // 本草綱目 inside 本草綱目拾遺 is the Bencao Gangmu within its own supplement —
    // precisely the relation screening needs to see, not noise.
    const r = vernacularContainment(['本草綱目拾遺(五)'], { vernacular_uniform_title: '本草綱目' });
    expect(r).not.toBeNull();
    expect(r.matched_run).toBe('本草綱目');
    expect(r.exact).toBe(false);
  });

  it('rejects the romanized false positives it replaces', () => {
    // 植物名實圖考 vs 明史 — no shared run, where "mingshi"/"zhiwumingshitukao"
    // collided romanized.
    expect(vernacularContainment(['植物名實圖考(一)'], { vernacular_uniform_title: '明史' })).toBeNull();
    // 周易參同契發揮 vs 銅器 ("Tong qi" / bronze ware) — likewise.
    expect(vernacularContainment(['周易參同契發揮'], { vernacular_uniform_title: '銅器' })).toBeNull();
  });

  it('ignores runs shorter than MIN_CJK_RUN', () => {
    // Two characters is often a common bigram (中國, 大成); three is usually a title.
    expect(vernacularContainment(['大成'], { vernacular_uniform_title: '大成' })).toBeNull();
  });

  it('returns null when either side has no CJK at all', () => {
    expect(vernacularContainment(['De Officiis'], { vernacular_uniform_title: '針灸大成' })).toBeNull();
    expect(vernacularContainment(['針灸大成'], { uniform_title: 'Zhen jiu da cheng.' })).toBeNull();
  });

  it('cjkRuns splits on Latin and punctuation', () => {
    expect(cjkRuns('皇極經世書 (Huangji Jingshi Shu, juan 13)')).toEqual(['皇極經世書']);
  });
});

describe('CJK volume enumerations are not work identity', () => {
  // 三才圖會(三十九) matched "The Thirty-Nine Steps" and 武備志(一百二) matched
  // "The 120 Days of Sodom" — the parenthetical is a VOLUME NUMBER, and Wikidata
  // carries Chinese labels for Buchan and Sade containing those numerals. Same
  // failure the Western VOLUME guard catches, in a different script.
  it('drops a run that is only CJK numerals', () => {
    expect(cjkRuns('三才圖會(三十九)')).toEqual(['三才圖會']);
    expect(cjkRuns('武備志(一百二)')).toEqual(['武備志']);
  });

  it('keeps a real title that merely begins with a numeral character', () => {
    // 三才圖會 starts with 三 (three) but is not an enumeration.
    expect(cjkRuns('三才圖會')).toEqual(['三才圖會']);
  });

  it('no longer pairs a Chinese compendium with an English thriller', () => {
    expect(vernacularContainment(['三才圖會(三十九)'], {
      vernacular_uniform_title: '三十九級台階',
    })).toBeNull();
  });
});
