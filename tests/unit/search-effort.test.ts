/**
 * search_efforts: publish the SEARCH, not the unprovable negative. (#3459)
 *
 * "First English translation" cannot be established by any search — a catalogue
 * returns only *nothing found*. Every attempt to shore the claim up with better
 * evidence has failed the same way, because the claim's SHAPE is wrong, not its
 * evidence quality.
 *
 * So the artifact becomes the search itself: a bounded, dated, reproducible act
 * that a third party can re-run. These tests pin the properties that make such a
 * record trustworthy, and — more importantly — the ways it is REQUIRED to fail
 * closed. Each `toThrow` below corresponds to a real way we have previously
 * manufactured false confidence.
 */
import { describe, it, expect } from 'vitest';

// @ts-expect-error — .mjs script module without type declarations
import {
  buildSearchEffort,
  deriveVerdict,
  effortId,
  renderEffortSummary,
  latestEffortPerBook,
  SCREEN,
  VERDICT,
} from '../../scripts/lib/search-effort.mjs';

// @ts-expect-error — .mjs script module without type declarations
import { englishFraction, ENGLISH_SOURCE_THRESHOLD } from '../../scripts/lib/english-source-detect.mjs';

const refSet = {
  version: 'loc-2016.v1',
  sources: [{
    id: 'loc',
    name: 'Library of Congress MDSConnect Books-All',
    snapshot_date: '2016-12-31',
    record_count: 10_750_000,
    coverage: 'US imprint depth',
    known_gaps: ['post-2016 imprints absent by construction'],
  }],
};

const base = {
  bookId: 'bk-1',
  proposition: 'Does a complete English translation of X published before 1900 exist?',
  referenceSet: refSet,
  codeVersion: 'abc1234',
};

describe('fails closed on anything that would make a negative unverifiable', () => {
  it('refuses an effort with no pinned code version', () => {
    // Measured 2026-07-29: reversing one title-coverage ratio moved strong
    // matches from 8 to 74 over identical data. An effort that does not pin the
    // code that produced it is an anecdote, not a reproducible result.
    expect(() => buildSearchEffort({ ...base, codeVersion: undefined }))
      .toThrow(/codeVersion/);
  });

  it('refuses a reference set whose source has no snapshot date', () => {
    const undated = { version: 'v1', sources: [{ id: 'loc', name: 'LoC' }] };
    expect(() => buildSearchEffort({ ...base, referenceSet: undated }))
      .toThrow(/snapshot_date/);
  });

  it('refuses an effort with no reference set at all', () => {
    expect(() => buildSearchEffort({ ...base, referenceSet: { version: 'v1', sources: [] } }))
      .toThrow(/at least one source/);
  });

  it('refuses an effort with no stated proposition', () => {
    expect(() => buildSearchEffort({ ...base, proposition: '' })).toThrow(/proposition/);
  });
});

describe('deriveVerdict', () => {
  const v = (candidates: any[], searchable = true) => deriveVerdict({ candidates, searchable });

  it('reports none_found when nothing defeating was retrieved', () => {
    expect(v([{ screen: SCREEN.DIFFERENT_WORK }, { screen: SCREEN.LATER }]))
      .toBe(VERDICT.NONE_FOUND);
  });

  it('reports prior_found on a screened prior translation', () => {
    expect(v([{ screen: SCREEN.DIFFERENT_WORK }, { screen: SCREEN.PRIOR }]))
      .toBe(VERDICT.PRIOR_FOUND);
  });

  it('an UNRESOLVED candidate blocks none_found', () => {
    // The critical one. An unscreened candidate is an open question; rounding it
    // down to "nothing found" is exactly the false confidence this design exists
    // to remove.
    expect(v([{ screen: SCREEN.UNRESOLVED }])).toBe(VERDICT.INCONCLUSIVE);
  });

  it('a prior still wins over an unresolved candidate', () => {
    expect(v([{ screen: SCREEN.UNRESOLVED }, { screen: SCREEN.PRIOR }]))
      .toBe(VERDICT.PRIOR_FOUND);
  });

  it('partial-only is its own verdict, not none_found', () => {
    // "First COMPLETE translation" survives earlier selections; collapsing the
    // two loses the distinction the badge actually depends on.
    expect(v([{ screen: SCREEN.PARTIAL }])).toBe(VERDICT.ONLY_PARTIAL_FOUND);
  });

  it('a study never defeats a claim (#3428)', () => {
    expect(v([{ screen: SCREEN.NOT_A_TRANSLATION }])).toBe(VERDICT.NONE_FOUND);
  });

  it('not_searchable is distinct from none_found', () => {
    // A book with no catalogue access point was never asked about. Reporting
    // that as a clean negative is how an unasked question becomes a confident
    // claim.
    expect(v([], false)).toBe(VERDICT.NOT_SEARCHABLE);
    expect(v([], true)).toBe(VERDICT.NONE_FOUND);
  });
});

describe('effort identity', () => {
  it('is stable for the same book, reference set and code', () => {
    expect(effortId({ bookId: 'b', referenceSetVersion: 'v1', codeVersion: 'sha1' }))
      .toBe(effortId({ bookId: 'b', referenceSetVersion: 'v1', codeVersion: 'sha1' }));
  });

  it('changes when the reference set changes', () => {
    // A new snapshot IS a different search, and must not silently overwrite the
    // old one — that is what lets a previously-asserted negative be re-opened
    // when the reference set grows.
    expect(effortId({ bookId: 'b', referenceSetVersion: 'v1', codeVersion: 'sha1' }))
      .not.toBe(effortId({ bookId: 'b', referenceSetVersion: 'v2', codeVersion: 'sha1' }));
  });

  it('changes when the code changes', () => {
    expect(effortId({ bookId: 'b', referenceSetVersion: 'v1', codeVersion: 'sha1' }))
      .not.toBe(effortId({ bookId: 'b', referenceSetVersion: 'v1', codeVersion: 'sha2' }));
  });
});

describe('buildSearchEffort', () => {
  const effort = buildSearchEffort({
    ...base,
    queries: [{ source: 'loc', query: 'bath.author="Ficino"', result_count: 88 }],
    candidates: [
      { identifiers: { lccn: '123' }, title: 'On Pleasure', year: 1980, screen: SCREEN.DIFFERENT_WORK, reason: 'different work by the same author' },
      { identifiers: { lccn: '456' }, title: 'A Study of Ficino', year: 1990, screen: SCREEN.NOT_A_TRANSLATION, reason: '041 absent; criticism-and-interpretation heading' },
    ],
    limitations: ['journal-published translations are largely uncatalogued'],
  });

  it('records counts derived from the actual queries and candidates', () => {
    expect(effort.counts.queries).toBe(1);
    expect(effort.counts.records_returned).toBe(88);
    expect(effort.counts.candidates_screened).toBe(2);
    expect(effort.counts.by_screen[SCREEN.NOT_A_TRANSLATION]).toBe(1);
  });

  it('inherits each source\'s declared gaps as limitations of THIS effort', () => {
    // A gap named once in a manifest and never surfaced on the claim it
    // undermines is a footnote nobody reads.
    expect(effort.limitations).toContain('loc: post-2016 imprints absent by construction');
    expect(effort.limitations).toContain('journal-published translations are largely uncatalogued');
  });

  it('keeps every candidate INCLUDING the rejects, with reasons', () => {
    // The rejects are what show the search was real rather than a lookup that
    // happened to miss.
    expect(effort.candidates).toHaveLength(2);
    for (const c of effort.candidates) expect(c.reason).toBeTruthy();
  });

  it('derives the verdict rather than accepting one', () => {
    expect(effort.verdict).toBe(VERDICT.NONE_FOUND);
  });

  it('never writes a verdict onto the book', () => {
    // An effort is EVIDENCE. The public flag stays behind the sign-off-gated
    // reconcile (#2933), which is what makes it safe to run this at corpus scale.
    expect(effort).not.toHaveProperty('is_first_translation');
    expect(Object.keys(effort)).not.toContain('books');
  });
});

describe('renderEffortSummary — what a reader actually sees', () => {
  const make = (candidates: any[], searchable = true) =>
    buildSearchEffort({ ...base, searchable, candidates, queries: [{ source: 'loc', query: 'q', result_count: 3 }] });

  it('states the search, not the unprovable claim', () => {
    const s = renderEffortSummary(make([]));
    expect(s).toMatch(/No prior English translation found/);
    expect(s).toMatch(/Searched 1 catalogue/);
    expect(s).toMatch(/10,750,000 records/);
    expect(s).toMatch(/2016/);
    // The thing we must never render:
    expect(s).not.toMatch(/first English translation/i);
  });

  it('distinguishes partial-only from nothing-found', () => {
    expect(renderEffortSummary(make([{ screen: SCREEN.PARTIAL, reason: 'selections' }])))
      .toMatch(/No prior COMPLETE English translation found/);
  });

  it('says so plainly when the work was never searchable', () => {
    expect(renderEffortSummary(make([], false))).toMatch(/Not yet searchable/);
  });

  it('does not claim a clean negative while candidates are unscreened', () => {
    expect(renderEffortSummary(make([{ screen: SCREEN.UNRESOLVED, reason: 'could not decide' }])))
      .toMatch(/Inconclusive/);
  });
});

describe('latestEffortPerBook — the collection is a history, not a state', () => {
  it('keeps only the newest effort per book', () => {
    // Efforts are immutable: a new code version or snapshot mints a new id
    // instead of overwriting, which is what lets a stale negative be re-opened.
    // The cost is that a naive read mixes generations — measured on the real
    // collection, 265 "inconclusive" rows against a current generation of 75.
    const efforts = [
      { book_id: 'a', run_at: '2026-07-29T00:00:00Z', verdict: 'none_found' },
      { book_id: 'a', run_at: '2026-07-30T00:00:00Z', verdict: 'inconclusive' },
      { book_id: 'b', run_at: '2026-07-30T00:00:00Z', verdict: 'none_found' },
    ];
    const current = latestEffortPerBook(efforts);
    expect(current).toHaveLength(2);
    expect(current.find((e: any) => e.book_id === 'a').verdict).toBe('inconclusive');
  });

  it('ignores rows with no book_id rather than bucketing them together', () => {
    expect(latestEffortPerBook([{ run_at: '2026-07-30T00:00:00Z' }])).toHaveLength(0);
  });
});

describe('english-source detection reads the SOURCE, not our own annotations', () => {
  // pages.ocr.data embeds AI-written English annotation blocks (<meta>,
  // <scan-quality>, <page-type>) describing the page in English whatever language
  // the page is in. Stripping only the TAGS keeps that prose — the exact bug
  // CLAUDE.md documents. It made a Greek Corpus Hermeticum score 0.26-0.36
  // English on annotated pages while real Greek pages scored 0.00, and inflated
  // the "already English" count from 1,410 to 2,349.
  it('ignores English editorial wrappers around foreign text', () => {
    const greekPage = '<scan-quality>Significant ink bleed-through from the verso page, and the page '
      + 'features numerous red ink corrections or additions by a later hand</scan-quality>'
      + '<meta>This page of the manuscript is written in a compact minuscule</meta>'
      + ' τοῦ δὲ καταῤῥέοντος ὕδατος ὅτι πασῶν τριῶσαν ἐχυθῇ τὸ πνεῦμα καὶ ἡ ψυχή';
    // With wrappers stripped there is essentially no Latin-script text left, so
    // the page must not be judged English.
    const f = englishFraction(greekPage, 5);
    expect(f === null || f < ENGLISH_SOURCE_THRESHOLD).toBe(true);
  });

  it('still detects a genuinely English source page', () => {
    const budge = 'the seven tablets of creation or the babylonian and assyrian legends concerning '
      + 'the creation of the world and of mankind edited with transliterations and there is in the '
      + 'text a great deal of that which we have from the earliest period of all these things';
    expect(englishFraction(budge)).toBeGreaterThan(ENGLISH_SOURCE_THRESHOLD);
  });

  it('refuses to judge a page with too little text', () => {
    expect(englishFraction('blank')).toBeNull();
  });
});
