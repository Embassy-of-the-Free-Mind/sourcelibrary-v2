// PRIOR ART: tests/unit/librarian-grounding.test.ts pins groundAnswer (is a quote on SOME page read);
// tests/unit/citation-fixes.test.ts pins slug repair. This pins the citation-page pass (#6946): a page
// link must name the page that says the thing. Fixtures are cut from the #6904 replay's real failures
// (Schneider p.3 → p.23, 1 Enoch p.39 → Dillmann p.46); every move has a twin that must NOT move.
import { describe, it, expect } from 'vitest';
import { applyGroundingEdits } from '@/lib/embassy/citation-fixes';
import type { GroundingImage, GroundingPage } from '@/lib/embassy/grounding';
import {
  buildPageIndex,
  captionNumberFix,
  checkCitationPages,
  citationTail,
  claimKey,
  dropLink,
  findPageLinks,
  linkedClaims,
  pagesHoldingQuote,
  repointLink,
  type CitationRouter,
} from '@/lib/embassy/citation-pages';
import { parseRoutes } from '@/lib/embassy/citation-router';
import { CitationRoutingStream } from '@/lib/embassy/citation-routing';

const BASE = 'https://sourcelibrary.org';
const page = (bookId: string, bookSlug: string, bookTitle: string, n: number, text: string): GroundingPage =>
  ({ bookId, bookSlug, bookTitle, page: n, text, parts: [text, '', ''] });

// Schneider, Dissertatio solemnis de philosophia silentii (1717): the Senate's "wholesomeness of
// silence" is on p.23; p.3 is the outline. The Librarian linked p.3.
const SCHNEIDER = 'dissertatio-solemnis-de-philosophia-silentii-schneider';
const SCH_3 = page('sch', SCHNEIDER, 'Solemn Dissertation on the Philosophy of Silence', 3,
  'It is the character of a true philosopher to sometimes be silent. §. I. Casual silence, illustrated by examples, is set aside. §. II. Voluntary silence, which is indifferent, is considered by the philosophy of silence so that it may become either good or evil. The lazy silence of the Indian Gymnosophists is reproved.');
const SCH_23 = page('sch', SCHNEIDER, 'Solemn Dissertation on the Philosophy of Silence', 23,
  'The Romans yielded nothing to the Greeks in this praise of silence, as Valerius Maximus says: "The heart of the Republic was faithful and deep, a Senate, fortified and hedged in on all sides by the wholesomeness of silence: those entering its threshold, having cast off private affection, took on the public one."');

// 1 Enoch: the "fragmentary survival" line is Charles's, printed in the Dillmann-based edition at p.46.
const ENOCH_39 = page('en1', '1-enoch-ethiopic-text-ed', 'The Ethiopic Text of 1 Enoch', 39,
  'The Book of Enoch. An ancient Jewish religious work, traditionally ascribed to Enoch, the great-grandfather of Noah, preserved in its entirety only in the Ge\'ez language of Ethiopia.');
const DILLMANN_46 = page('dil', 'das-buch-henoch-athiopischer-text-dillmann', 'Das Buch Henoch', 46,
  'THE DIFFERENT ELEMENTS IN THE BOOK OF ENOCH. The book of Enoch is a fragmentary survival of an entire literature that once circulated under his name. To this fact the plurality of books assigned to Enoch may in some degree point.');

const link = (slug: string, n: number, label = `Page ${n}`) => `[${label}](${BASE}/book/${slug}/page-number/${n})`;
const cite = (slug: string, title: string, n: number) => `— *[${title}](${BASE}/book/${slug})*, ${link(slug, n)}`;

async function pass(text: string, pages: GroundingPage[], opts: { router?: CitationRouter; images?: GroundingImage[] } = {}) {
  const r = await checkCitationPages({ text, edits: [], pages, supportLoaded: true, images: opts.images ?? [], router: opts.router });
  return { ...r, out: applyGroundingEdits(text, r.edits) };
}

describe('findPageLinks / citationTail', () => {
  it('finds both page-link shapes and the citation tail they end', () => {
    const s = `He wrote it ${cite(SCHNEIDER, 'Philosophy of Silence', 3)}.`;
    const [l] = findPageLinks(s);
    expect(l).toMatchObject({ slug: SCHNEIDER, page: 3, label: 'Page 3' });
    const t = citationTail(s, l)!;
    expect(s.slice(t.start, t.end)).toBe(` ${cite(SCHNEIDER, 'Philosophy of Silence', 3)}`);
    expect(t.titleLink?.slug).toBe(SCHNEIDER);
    expect(findPageLinks(`see [p. 5](${BASE}/es/book/x?page=5)`)[0]).toMatchObject({ slug: 'x', page: 5, locale: '/es' });
  });
  it('a title-shaped link inside a sentence is not a citation tail', () => {
    const s = `a drawing from ${link('dell-elixir', 223, "Dell'elixir vitae")} by Donato`;
    expect(citationTail(s, findPageLinks(s)[0])).toBeNull();
  });
});

describe('repointLink / dropLink', () => {
  it('re-points within a book: URL and the number in the label', () => {
    const s = `the Senate ${cite(SCHNEIDER, 'Philosophy of Silence', 3)}.`;
    expect(repointLink(s, findPageLinks(s)[0], SCH_23)).toBe(`the Senate ${cite(SCHNEIDER, 'Philosophy of Silence', 23)}.`);
  });
  it('re-points across books: the title link in the citation names the new book', () => {
    const s = `a literature ${cite('1-enoch-ethiopic-text-ed', 'The Ethiopic Text of 1 Enoch', 39)}.`;
    const out = repointLink(s, findPageLinks(s)[0], DILLMANN_46);
    expect(out).toBe(`a literature ${cite('das-buch-henoch-athiopischer-text-dillmann', 'Das Buch Henoch', 46)}.`);
  });
  it('drops a citation tail whole and keeps the sentence', () => {
    const s = `Singing was thought superior ${cite('phonurgia', 'Phonurgia Nova', 239)}. Next.`;
    expect(dropLink(s, findPageLinks(s)[0])).toBe('Singing was thought superior. Next.');
    const p = `a concealment of the light (${link('tree', 130)}). Next.`;
    expect(dropLink(p, findPageLinks(p)[0])).toBe('a concealment of the light. Next.');
  });
  it('a dropped link inside a sentence keeps its words and points at the book', () => {
    const s = `from ${link('dell-elixir', 223, "Dell'elixir vitae")} by Donato`;
    expect(dropLink(s, findPageLinks(s)[0])).toBe(`from [Dell'elixir vitae](${BASE}/book/dell-elixir) by Donato`);
  });
});

describe('quotations, deterministically', () => {
  it('moves a quotation to the one page of its own book that holds it (Schneider p.3 → p.23)', async () => {
    const text = `The text runs from the "lazy silence" of the Gymnosophists to the "wholesomeness of silence" in the Roman Senate ${cite(SCHNEIDER, 'Philosophy of Silence', 3)}.`;
    const r = await pass(text, [SCH_3, SCH_23]);
    // "lazy silence" is two words: too short to place. "wholesomeness of silence" is on p.23 only.
    expect(r.out).toContain(link(SCHNEIDER, 23));
    expect(r.report.quotesRepointed).toBe(1);
  });
  it('twin: the quotation IS on the linked page → untouched', async () => {
    const text = `The Senate was "hedged in on all sides by the wholesomeness of silence" ${cite(SCHNEIDER, 'Philosophy of Silence', 23)}.`;
    const r = await pass(text, [SCH_3, SCH_23]);
    expect(r.edits).toEqual([]);
    expect(r.report.quotesOnCitedPage).toBe(1);
  });
  it('moves a long quotation to the one other book that holds it (1 Enoch p.39 → Dillmann p.46)', async () => {
    const text = `These texts represent a "fragmentary survival of an entire literature" that once circulated under Enoch's name ${cite('1-enoch-ethiopic-text-ed', 'The Ethiopic Text of 1 Enoch', 39)}.`;
    const r = await pass(text, [ENOCH_39, DILLMANN_46]);
    expect(r.out).toContain(link('das-buch-henoch-athiopischer-text-dillmann', 46));
    expect(r.out).toContain(`[Das Buch Henoch](${BASE}/book/das-buch-henoch-athiopischer-text-dillmann)`);
  });
  it('twin: a short quotation never crosses into another book', async () => {
    const text = `It was called "an entire literature" by later scholars ${cite('1-enoch-ethiopic-text-ed', 'The Ethiopic Text of 1 Enoch', 39)}.`;
    const r = await pass(text, [ENOCH_39, DILLMANN_46]);
    expect(r.out).toContain(link('1-enoch-ethiopic-text-ed', 39));
    expect(r.report.quotesRepointed).toBe(0);
  });
  it('twin: a quoted Title-Case name is not a quotation and moves nothing (Steganographia p.342, #6946)', async () => {
    const text = `His Polygraphia gives the "Secret Alphabet of Honorius of Thebes" among others ${cite('1-enoch-ethiopic-text-ed', 'The Ethiopic Text of 1 Enoch', 39)}.`;
    const named = page('stw', 'steganologia-schwenter', 'Steganologia', 205, 'Here follows the Secret Alphabet of Honorius of Thebes, as Trithemius gives it.');
    const r = await pass(text, [ENOCH_39, named]);
    expect(r.report.quotesRepointed).toBe(0);
    expect(r.out).toBe(text);
  });
  it('twin: a linked page that was not loaded is not judged', async () => {
    const text = `These texts represent a "fragmentary survival of an entire literature" here ${cite('1-enoch-ethiopic-text-ed', 'The Ethiopic Text of 1 Enoch', 41)}.`;
    const r = await pass(text, [ENOCH_39, DILLMANN_46]);
    expect(r.edits).toEqual([]);
  });
  it('a quotation running over the page break counts for the page it starts on', () => {
    const a = page('b', 'book', 'Book', 193, 'the spirit which is above all things ad perpetranda');
    const b = page('b', 'book', 'Book', 194, 'miracula rei unius and nothing else');
    const idx = buildPageIndex([a, b]);
    expect(pagesHoldingQuote('ad perpetranda miracula rei unius', idx).whole).toEqual([0, 1]);
  });
  it('a blockquote found only in pieces across two books is reported and left as written', async () => {
    const text = `> "The book of Enoch is a fragmentary survival of an entire literature ... hedged in on all sides by the wholesomeness of silence"\n— ${link('das-buch-henoch-athiopischer-text-dillmann', 46)}\n\nAfter.`;
    const r = await pass(text, [DILLMANN_46, SCH_23]);
    expect(r.out).toBe(text);
    expect(r.report.quotesStitched).toBe(1);
  });
});

describe('paraphrases, by the router (evidence-checked)', () => {
  const text = `Valerius Maximus praised the Roman Senate for guarding its deliberations behind silence ${cite(SCHNEIDER, 'Philosophy of Silence', 3)}.`;
  const router = (page: number | null, evidence?: string): CitationRouter => async claims => claims.map((_, i) => ({ claim: i, page, evidence }));

  it('moves a paraphrase when the router quotes words that are on the new page', async () => {
    const r = await pass(text, [SCH_3, SCH_23], { router: router(1, 'a Senate, fortified and hedged in on all sides by the wholesomeness of silence') });
    expect(r.out).toContain(link(SCHNEIDER, 23));
    expect(r.report.claimsRepointed).toBe(1);
  });
  it('twin: no move when the evidence is not on the new page (the model guessed)', async () => {
    const r = await pass(text, [SCH_3, SCH_23], { router: router(1, 'the Senate guarded every secret of the Republic with great care') });
    expect(r.out).toBe(text);
    expect(r.report.routes[0].applied).toBe('guarded');
  });
  it('drops the link when no page states it and the linked page shares few of its words', async () => {
    const t = `Pythagoras imposed five years of silence on every new disciple of his school ${cite(SCHNEIDER, 'Philosophy of Silence', 23)}.`;
    const r = await pass(t, [SCH_3, SCH_23], { router: router(null) });
    expect(r.out).toBe('Pythagoras imposed five years of silence on every new disciple of his school.');
  });
  it('twin: "none" from the router does not drop a link whose page shares most of the claim', async () => {
    const t = `The Romans yielded nothing to the Greeks in their praise of silence, as Valerius Maximus says ${cite(SCHNEIDER, 'Philosophy of Silence', 23)}.`;
    const r = await pass(t, [SCH_3, SCH_23], { router: router(null) });
    expect(r.out).toBe(t);
  });
  it('a router that throws leaves every link as it was', async () => {
    const r = await pass(text, [SCH_3, SCH_23], { router: async () => { throw new Error('503'); } });
    expect(r.out).toBe(text);
    expect(r.report.routerError).toBe('503');
  });
  it('folds into the grounding edit of the same unit (one edit per unit)', async () => {
    const t = `First paragraph.\n\n${text}`;
    const at = t.indexOf('Valerius');
    const prior = { find: 'Valerius Maximus', replace: 'Valerius Maximus himself', at, reasons: ['unquote' as const] };
    const r = await checkCitationPages({ text: t, edits: [prior], pages: [SCH_3, SCH_23], supportLoaded: true, images: [], router: router(1, 'a Senate, fortified and hedged in on all sides by the wholesomeness of silence') });
    expect(r.edits).toHaveLength(1);
    expect(r.edits[0].reasons).toEqual(expect.arrayContaining(['unquote', 'citation_page']));
    const out = applyGroundingEdits(t, r.edits);
    expect(out).toContain('Valerius Maximus himself');
    expect(out).toContain(link(SCHNEIDER, 23));
  });
});

describe('captions', () => {
  const img: GroundingImage = { url: 'https://images.sourcelibrary.org/artwork/art-maier-atalanta-fugiens-emblema-ii.jpg', bookTitle: 'Atalanta Fugiens Emblema II', description: 'Mother Nature nursing the earth' };
  it('keeps an emblem number the image record carries (Emblema II ↔ Emblem II)', () => {
    expect(captionNumberFix('*Emblem II from Maier\'s Atalanta Fugiens.*', img)).toBeNull();
  });
  it('drops an emblem number the record never carries', () => {
    expect(captionNumberFix('*Emblem XI from Maier\'s Atalanta Fugiens.*', img)).toBe('*Emblem from Maier\'s Atalanta Fugiens.*');
  });
  it('in the pass: the caption line under the embed', async () => {
    const text = `![Emblem XI](${img.url})\n*Emblem XI from Maier's Atalanta Fugiens.*\n\nAfter.`;
    const r = await pass(text, [], { images: [img] });
    expect(r.out).toBe(`![Emblem](${img.url})\n*Emblem from Maier's Atalanta Fugiens.*\n\nAfter.`);
  });
});

describe('parseRoutes', () => {
  it('reads page labels and none, drops malformed entries', () => {
    expect(parseRoutes('{"routes":[{"c":0,"p":"P2","evidence":"x y"},{"c":1,"p":"none","evidence":""},{"c":2,"p":"P9"},{"c":0,"p":"P1"}]}', 3, 5))
      .toEqual([{ claim: 0, page: 2, evidence: 'x y' }, { claim: 1, page: null, evidence: undefined }]);
    expect(parseRoutes('not json', 1, 1)).toEqual([]);
  });
});

describe('CitationRoutingStream', () => {
  it('routes finished paragraphs while the text streams, and the rest on finish', async () => {
    const p1 = `Valerius Maximus praised the Roman Senate for guarding its deliberations behind silence ${cite(SCHNEIDER, 'Philosophy of Silence', 3)}.`;
    const p2 = `Pythagoras imposed five years of silence on every new disciple of his school ${cite(SCHNEIDER, 'Philosophy of Silence', 23)}.`;
    const calls: string[][] = [];
    const stream = new CitationRoutingStream({
      router: async claims => { calls.push(claims.map(c => c.claim)); return claims.map((_, i) => ({ claim: i, page: null })); },
      loadPages: async keys => [SCH_3, SCH_23].filter(p => keys.includes(`${p.bookId}:${p.page}`)),
      resolveSlugs: async slugs => new Map(slugs.map(s => [s, 'sch'])),
      retrievedKeys: () => ['sch:3', 'sch:23'],
    });
    stream.feed(`${p1}\n\n${p2.slice(0, 20)}`);
    await stream.settled();
    expect(calls).toHaveLength(1);
    stream.finish(`${p1}\n\n${p2}`);
    const v = await stream.settled();
    expect(calls).toHaveLength(2);
    const [l2] = findPageLinks(p2);
    const [c2] = linkedClaims(p2, 'prose');
    expect(v.get(claimKey(l2, c2.claim))).toEqual({ to: null, evidence: undefined });
  });
});
