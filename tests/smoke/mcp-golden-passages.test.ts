/**
 * Golden-passage regression for the MCP read/search surface.
 *
 * ## Why this file exists, when tests/smoke/mcp-search.test.ts already does
 *
 * That file asks "did anything come back?". Every assertion in it is a
 * non-emptiness check, and **every one of them passed throughout** the period a
 * real MCP client was reporting that `search_within_book` was unusable: for a
 * natural-language query it returned 48 pages of front matter, in strict page
 * order, with the page containing the searched sentence verbatim ranked ~50th
 * or absent. The results were never empty. They were plausible and wrong.
 *
 * That is the failure mode this corpus is most exposed to, and it is invisible
 * to a non-emptiness assertion. A search tool that returns page 1 through 48 of
 * every book would pass the existing suite completely.
 *
 * So the assertions here are of a different kind:
 *
 *   1. GOLDEN PASSAGE — for this query on this book, THIS page must be in the
 *      top N. Sourced from a reader who verified the page contains the sentence.
 *   2. CONTROLS — a rare term must still return its few exact pages, and
 *      nonsense must return zero. Without these a "fix" that loosens matching
 *      until everything ranks everywhere would pass (1).
 *   3. FLAG CORRECTNESS — continuity flags asserted true where a human
 *      confirmed the page opens or breaks mid-word.
 *   4. STRUCTURAL INVARIANT — no chapter span may invert.
 *
 * Every case is a real reported defect, not a hypothetical. `$was` in the
 * fixture records what the API actually returned before the fix, so a future
 * reader can tell a regression from a never-worked.
 *
 * ## These hit production
 *
 * Smoke tests run against https://sourcelibrary.org by default and are not in
 * CI (there is no smoke job in .github/workflows). Run them by hand after any
 * change to search ranking, the continuity predicates, or chapter derivation:
 *
 *   npx vitest run --config vitest.smoke.config.ts tests/smoke/mcp-golden-passages.test.ts
 *
 * Set TEST_BASE_URL to point at a preview deploy.
 *
 * ## On maintaining these
 *
 * A failure here is far more likely to be a real regression than a stale
 * fixture — page numbers are physical scan positions and do not drift. But if a
 * book is re-archived or re-split, its page numbers CAN move (see
 * .claude/docs/invariants/paired-artifacts.md). Before editing an expectation,
 * confirm against the live page which of the two happened.
 */
import { describe, it, expect } from 'vitest';
import fixture from '../fixtures/mcp-golden-passages.json' with { type: 'json' };

const BASE = process.env.TEST_BASE_URL || 'https://sourcelibrary.org';

interface SearchResult {
  page: number;
  snippet?: string;
  score?: number;
  found_by?: string;
  is_front_matter?: boolean;
}

/**
 * Hit the MCP route itself rather than the underlying REST endpoints.
 *
 * The existing smoke file deliberately calls /api/search directly, which is
 * fine for the bugs it covers. It is the wrong choice here: the ranking
 * interleave, the front-matter ordering and the continuity flags are all
 * applied IN the MCP wrapper (src/app/api/mcp/route.ts), so testing the REST
 * layer would exercise none of the code these cases are about.
 */
async function mcpCall(name: string, args: Record<string, unknown>) {
  const res = await fetch(`${BASE}/api/mcp`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json, text/event-stream',
    },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'tools/call',
      params: { name, arguments: args },
    }),
  });
  expect(res.status, `MCP call ${name} returned HTTP ${res.status}`).toBe(200);
  const body = await res.json();
  const text = body?.result?.content?.[0]?.text;
  return text ? JSON.parse(text) : body?.result;
}

// ---------------------------------------------------------------------------
// 1. Golden passages — the page a reader verified must rank near the top
// ---------------------------------------------------------------------------

describe('search_within_book — the right page must rank, not merely appear', () => {
  for (const c of fixture.ranking.cases) {
    it(`${c.book}: "${c.query.slice(0, 48)}…" → p.${c.expectPage} in top ${c.withinTopN}`, async () => {
      const data = await mcpCall('search_within_book', {
        book_id: c.book_id,
        query: c.query,
      });
      const results: SearchResult[] = data?.results || [];
      expect(results.length, 'no results at all').toBeGreaterThan(0);

      const rank = results.findIndex((r) => r.page === c.expectPage);
      expect(
        rank,
        `p.${c.expectPage} not in results at all (returned ${results.length} of ${data?.total}). ` +
          `Top 5 pages: ${results.slice(0, 5).map((r) => r.page).join(', ')}. Previously: ${c.$was}`,
      ).toBeGreaterThanOrEqual(0);
      expect(
        rank + 1,
        `p.${c.expectPage} ranked ${rank + 1} of ${results.length}, wanted top ${c.withinTopN}. ` +
          `Pages above it: ${results.slice(0, rank).map((r) => r.page).join(', ')}`,
      ).toBeLessThanOrEqual(c.withinTopN);

      if ('contains' in c && c.contains) {
        expect(
          (results[rank].snippet || '').toLowerCase(),
          'the ranked page is the right number but its snippet does not carry the searched text',
        ).toContain(String(c.contains).toLowerCase());
      }
    });
  }

  it('front matter is ordered last, not merely labelled', async () => {
    // The flag shipped one release before the sort that uses it, so for a while
    // the response said front matter was "ordered last" while 48 flagged pages
    // occupied slots 1-48. Labelling without ordering is the regression.
    const c = fixture.ranking.cases[0];
    const data = await mcpCall('search_within_book', { book_id: c.book_id, query: c.query });
    const results: SearchResult[] = data?.results || [];
    const firstFront = results.findIndex((r) => r.is_front_matter);
    const lastBody = results.map((r) => !r.is_front_matter).lastIndexOf(true);
    if (firstFront >= 0 && lastBody >= 0) {
      expect(
        firstFront,
        `a front-matter result appears at rank ${firstFront + 1}, above body text ending at rank ${lastBody + 1}`,
      ).toBeGreaterThan(lastBody);
    }
  });
});

// ---------------------------------------------------------------------------
// 2. Controls — without these, "rank everything everywhere" would pass above
// ---------------------------------------------------------------------------

describe('search_within_book — precision controls', () => {
  for (const c of fixture.rare_term_control.cases) {
    it(`a rare term ("${c.query}") still returns its exact pages`, async () => {
      const data = await mcpCall('search_within_book', { book_id: c.book_id, query: c.query });
      const pages = (data?.results || []).map((r: SearchResult) => r.page);
      for (const p of c.expectPagesInclude) {
        expect(pages, `p.${p} missing for rare term "${c.query}"`).toContain(p);
      }
      expect(
        data?.total,
        `"${c.query}" matched ${data?.total} pages — matching has been loosened past usefulness`,
      ).toBeLessThanOrEqual(c.maxTotal);
    });
  }

  /**
   * KNOWN FAILURE — #3699. `it.fails` asserts this DOES fail, so when the bug
   * is fixed the test goes red and whoever fixed it removes the marker. A
   * `skip` would rot silently instead.
   *
   * The invariant is the one that matters to a caller deciding whether a
   * passage is present or absent: a query the book cannot possibly answer must
   * score BELOW one it answers verbatim. Today both top out at 1.0, because
   * `score` is normalised within the result set — so the best of a bad lot is
   * always a perfect match and the tool can never say "nothing here".
   *
   * Note this is NOT the control the original reporter wrote. Theirs was
   * "nonsense returns total 0", which passed before #3680 because the semantic
   * leg was not firing at all. It now fires — a genuine fix — so returning
   * neighbours for nonsense is correct. Scoring them 1.0 is not.
   */
  for (const c of fixture.nonsense_control.cases) {
    it.fails(`[#3699] nonsense ("${c.query}") must score below a verbatim hit`, async () => {
      const golden = fixture.ranking.cases.find((r) => r.book_id === c.book_id)!;
      const [nonsense, real] = await Promise.all([
        mcpCall('search_within_book', { book_id: c.book_id, query: c.query }),
        mcpCall('search_within_book', { book_id: c.book_id, query: golden.query }),
      ]);
      const topScore = (d: { results?: SearchResult[] }) =>
        Math.max(0, ...(d?.results || []).map((r) => r.score ?? 0));

      expect(
        topScore(nonsense),
        `nonsense top score ${topScore(nonsense)} vs verbatim-hit top score ${topScore(real)} — ` +
          'a caller cannot distinguish "found it" from "not in this book"',
      ).toBeLessThan(topScore(real));
    });
  }
});

// ---------------------------------------------------------------------------
// 3. Continuity flags — wrong here means a confident misquote
// ---------------------------------------------------------------------------

describe('get_quote — page-edge flags', () => {
  for (const c of fixture.continuity.cases) {
    const [flag] = Object.keys(c.expect);
    it(`${c.book_id} p.${c.page}: ${flag} is ${Object.values(c.expect)[0]}`, async () => {
      const data = await mcpCall('get_quote', { book_id: c.book_id, page: c.page });
      const continuity = data?.continuity || {};
      for (const [key, want] of Object.entries(c.expect)) {
        expect(
          continuity[key],
          `${key} was ${continuity[key]}, wanted ${want}. ${c.$why}`,
        ).toBe(want);
      }
    });
  }
});

// ---------------------------------------------------------------------------
// 4. Structural invariant — a span may never run backwards
// ---------------------------------------------------------------------------

describe('get_book — chapter spans', () => {
  for (const c of fixture.structure.cases) {
    it(`${c.book}: no chapter span inverts`, async () => {
      const data = await mcpCall('get_book', { book_id: c.book_id });
      const chapters = data?.chapters || [];
      expect(chapters.length, 'no chapters returned').toBeGreaterThan(0);

      const inverted = chapters.filter(
        (ch: { pageNumber: number; endPage: number }) =>
          typeof ch.endPage === 'number' && ch.endPage < ch.pageNumber,
      );
      expect(
        inverted.map((ch: { title: string; pageNumber: number; endPage: number }) =>
          `"${ch.title}" ${ch.pageNumber}–${ch.endPage}`),
        'chapter spans running backwards',
      ).toEqual([]);
    });

    it(`${c.book}: a container spans its children`, async () => {
      const data = await mcpCall('get_book', { book_id: c.book_id });
      const chapters = data?.chapters || [];
      const want = c.expectChapter;
      const found = chapters.find(
        (ch: { title: string; pageNumber: number }) =>
          ch.title === want.title && ch.pageNumber === want.pageNumber,
      );
      expect(found, `no chapter "${want.title}" starting at p.${want.pageNumber}`).toBeTruthy();
      expect(
        found.endPage,
        `"${want.title}" ends at ${found.endPage}; it should run to ${want.endPage}, where the next entry at its own level begins`,
      ).toBe(want.endPage);
    });
  }
});
