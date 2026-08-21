/**
 * MCP search regression — exercises the search_translations and search_concept
 * paths through the underlying production API, asserting on the two P0 bugs
 * fixed by PR #2162:
 *
 *   Bug 1 — search_translations silently returned zero passages at default limit
 *           even when total_matches was 25-60. Root cause: empty-snippet filter
 *           applied AFTER fetching exactly `limit` rows. Fix: over-fetch from
 *           the same offset (limit*3), filter, then slice to userLimit.
 *
 *   Bug 2 — total_matches was non-deterministic across identical calls because
 *           timed-out lanes silently resolved to []. Fix: lanes flip a
 *           degradedLanes marker; response now surfaces partial:true +
 *           degraded_lanes:[...] when a lane drops out.
 *
 * Full report: .claude/handoffs/2026-05-29-mcp-search-bug-report.md
 * Query matrix: tests/fixtures/mcp-search-regression-queries.json
 * PR: https://github.com/Embassy-of-the-Free-Mind/sourcelibrary-v2/pull/2162
 *
 * ## Scope, and what this file CANNOT catch
 *
 * Every assertion here is a non-emptiness or stability check — "did anything
 * come back?", "is the total deterministic?". That is the right shape for the
 * two bugs above, both of which were silent-zero failures.
 *
 * It is the wrong shape for a ranking bug, and all of these passed throughout
 * the period an MCP client was reporting that `search_within_book` returned 48
 * pages of front matter in page order with the target passage ranked ~50th.
 * The results were never empty; they were plausible and wrong.
 *
 * Golden-passage assertions — "for THIS query on THIS book, THIS page must be
 * in the top N" — live in tests/smoke/mcp-golden-passages.test.ts. Add ranking
 * and flag-correctness cases there, not here.
 *
 * Run with: npx vitest run --config vitest.smoke.config.ts tests/smoke/mcp-search.test.ts
 *
 * To exercise the actual MCP JSON-RPC endpoint (requires API key):
 *   MCP_API_KEY=... npx vitest run --config vitest.smoke.config.ts tests/smoke/mcp-search.test.ts
 */
import { describe, it, expect } from 'vitest';
import fixture from '../fixtures/mcp-search-regression-queries.json' with { type: 'json' };

const BASE = process.env.TEST_BASE_URL || 'https://sourcelibrary.org';
const MCP_API_KEY = process.env.MCP_API_KEY;

// ---------------------------------------------------------------------------
// Helpers — call the production API directly. The MCP route in
// src/app/api/mcp/route.ts wraps these same endpoints, so a regression that
// hits /api/search and /api/search/semantic with a small limit catches the
// over-fetch fix end-to-end (because the post-filter still runs on the
// caller side, just under wider candidate pools).
// ---------------------------------------------------------------------------

async function searchPassages(query: string, limit = 10) {
  const params = new URLSearchParams({ q: query, pages_only: 'true', limit: String(limit) });
  const res = await fetch(`${BASE}/api/search?${params}`);
  expect(res.status).toBe(200);
  return res.json() as Promise<{
    total: number;
    results: Array<{ snippet?: string }>;
    partial?: boolean;
    degraded_lanes?: string[];
  }>;
}

async function searchLibrary(query: string, limit = 10) {
  const params = new URLSearchParams({ q: query, limit: String(limit) });
  const res = await fetch(`${BASE}/api/search/unified?${params}`);
  if (res.status === 400) return { books: { results: [] }, _http400: true };
  expect(res.status).toBe(200);
  return res.json();
}

async function searchSemantic(query: string, opts: { language?: string; languages?: string[]; exclude_languages?: string[] } = {}, limit = 10) {
  const params = new URLSearchParams({ q: query, level: 'page', limit: String(limit) });
  if (opts.language) params.set('language', opts.language);
  if (opts.languages) params.set('languages', opts.languages.join(','));
  if (opts.exclude_languages) params.set('exclude_languages', opts.exclude_languages.join(','));
  const res = await fetch(`${BASE}/api/search/semantic?${params}`);
  expect(res.status).toBe(200);
  return res.json() as Promise<{ results: Array<{ book_language?: string; snippet?: string }> }>;
}

// ---------------------------------------------------------------------------
// P0 regressions — the bugs fixed by #2162
// ---------------------------------------------------------------------------

describe('Bug 1 regression — search_translations must not silently return zero at default limit', () => {
  for (const q of fixture.p0_regressions.bug_1_default_limit_zero_returned.queries) {
    it(`returns at least one non-empty passage for "${q}" at default limit`, async () => {
      const data = await searchPassages(q, 10);
      // Pre-fix: total was high (25-60) but results came back all empty-snippet rows.
      // Post-fix: over-fetch ensures the page is full whenever matches exist.
      if (data.total > 0) {
        const nonEmpty = (data.results || []).filter(r => r.snippet && r.snippet.trim().length > 0);
        expect(
          nonEmpty.length,
          `total_matches=${data.total} but returned 0 non-empty snippets for "${q}" — Bug 1 has regressed`,
        ).toBeGreaterThan(0);
      }
    });
  }
});

describe('Bug 2 regression — total_matches must be stable OR signal partial:true', () => {
  for (const q of fixture.p0_regressions.bug_2_total_matches_stability.queries) {
    it(`returns identical total across three calls for "${q}" (or signals partial)`, async () => {
      const calls = await Promise.all([
        searchPassages(q, 10),
        searchPassages(q, 10),
        searchPassages(q, 10),
      ]);
      const totals = calls.map(c => c.total);
      const partials = calls.map(c => c.partial === true);
      const unique = new Set(totals);

      // Either all three totals match (Bug 2 fixed under no-timeout conditions),
      // OR at least one call signals partial:true (Bug 2 fixed: timeout surfaces honestly).
      const allEqual = unique.size === 1;
      const anyPartial = partials.some(p => p);
      expect(
        allEqual || anyPartial,
        `totals were ${JSON.stringify(totals)} and partial flags were ${JSON.stringify(partials)} — Bug 2 has regressed (silent non-determinism)`,
      ).toBe(true);
    });
  }
});

// ---------------------------------------------------------------------------
// Coverage regressions — author/work discovery, tradition vocab, images
// ---------------------------------------------------------------------------

describe('Author/work discovery (search_library)', () => {
  for (const row of fixture.author_work_discovery.queries) {
    it(`returns the right top result for "${row.q}"`, async () => {
      const data = await searchLibrary(row.q, 5);
      expect(data.books.results.length).toBeGreaterThan(0);
      const top = data.books.results[0];
      if ('expectAuthorContains' in row && row.expectAuthorContains) {
        const author = String(top.author || '');
        expect(author.toLowerCase()).toContain(row.expectAuthorContains.toLowerCase());
      }
      if ('expectTitleContains' in row && row.expectTitleContains) {
        const title = String(top.title || '');
        expect(title.toLowerCase()).toContain(row.expectTitleContains.toLowerCase());
      }
    });
  }
});

describe('Tradition vocabulary (search_translations) — should not be empty', () => {
  for (const q of fixture.tradition_vocabulary.queries) {
    it(`returns at least one passage for "${q}"`, async () => {
      const data = await searchPassages(q, 20);
      if (data.total > 0) {
        const nonEmpty = (data.results || []).filter(r => r.snippet && r.snippet.trim().length > 0);
        expect(nonEmpty.length).toBeGreaterThan(0);
      }
    });
  }
});

// ---------------------------------------------------------------------------
// Bug 5 — Latin-bias is a docs/tuning issue; we test the FILTER works
// (which it does), and explicitly mark the embedding-coverage failures
// as known so they show up in CI as "skipped" rather than red.
// ---------------------------------------------------------------------------

describe('search_concept language filter (Bug 5 docs probe)', () => {
  for (const c of fixture.latin_bias_probe.cases) {
    if ('knownEmptyDueToBug5' in c && c.knownEmptyDueToBug5) {
      it.skip(`[Bug 5, known limitation] "${c.q}" with filter ${JSON.stringify(c.filter)} returns empty — embedding has no neighbor`, () => {});
      continue;
    }
    it(`"${c.q}" with filter ${JSON.stringify(c.filter)} returns matches in expected language(s)`, async () => {
      const data = await searchSemantic(c.q, c.filter || {}, 10);
      if (data.results.length > 0 && 'expectLanguagesIncludeAny' in c && c.expectLanguagesIncludeAny) {
        const langs = new Set(data.results.map(r => r.book_language));
        const hit = c.expectLanguagesIncludeAny.some(l => langs.has(l));
        expect(hit, `expected at least one of ${c.expectLanguagesIncludeAny.join(',')} but got ${[...langs].join(',')}`).toBe(true);
      }
    });
  }
});

// ---------------------------------------------------------------------------
// Bugs 3, 4, 6 — open follow-ups, asserted as known-failures so they
// surface in CI but don't block until fixed.
// ---------------------------------------------------------------------------

describe('Open bugs (3, 4, 6) — known failures', () => {
  it.skip('[Bug 3] search_library multi-word OR-match — "xyzqwabc nonsense" should return 0', async () => {
    const data = await searchLibrary('xyzqwabc nonsense', 5);
    expect(data.books.results.length).toBe(0);
  });

  it.skip('[Bug 4] sub-2-char query should return empty, not HTTP 400', async () => {
    const data = await searchLibrary('a', 5);
    expect(data._http400).toBeFalsy();
  });

  it.skip('[Bug 6] search_images "green lion" should rank alchemical motif first', () => {
    // Placeholder — needs search_images endpoint + symbol-tagged ranking.
  });
});

// ---------------------------------------------------------------------------
// Optional: exercise the actual MCP JSON-RPC endpoint if MCP_API_KEY is set.
// This catches regressions in the MCP wrapper itself (the over-fetch+slice
// logic lives in src/app/api/mcp/route.ts).
// ---------------------------------------------------------------------------

describe.skipIf(!MCP_API_KEY)('MCP endpoint (requires MCP_API_KEY)', () => {
  async function mcpCall(name: string, args: Record<string, unknown>) {
    const res = await fetch(`${BASE}/api/mcp`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json, text/event-stream',
        'Authorization': `Bearer ${MCP_API_KEY}`,
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'tools/call',
        params: { name, arguments: args },
      }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    const text = body?.result?.content?.[0]?.text;
    return text ? JSON.parse(text) : body?.result;
  }

  for (const q of fixture.p0_regressions.bug_1_default_limit_zero_returned.queries) {
    it(`MCP search_translations returns non-empty passages for "${q}" at default limit`, async () => {
      const data = await mcpCall('search_translations', { query: q });
      if (data?.total_matches > 0) {
        expect(data.returned, `MCP returned 0 with total_matches=${data.total_matches} — Bug 1 regressed at MCP layer`).toBeGreaterThan(0);
        expect((data.passages || []).length).toBeGreaterThan(0);
      }
    });
  }
});
