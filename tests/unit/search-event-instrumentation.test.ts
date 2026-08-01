import { describe, it, expect, vi, beforeEach } from 'vitest';
import fs from 'fs';
import path from 'path';

// A whole search box recorded nothing for four months.
//
// The BPH reading room's front-page catalogue search (`/api/catalog/bph`) had
// no logging of any kind, while five *other* search routes each hand-rolled
// their own `analytics_events` insert. The consequences were both directions of
// wrong: reading-room searches were invisible, and the ones that were visible
// stored no `host`, so all 94,442 events collapsed into a single unattributable
// bucket. A usage report briefly told the partner "readers here don't search."
//
// Two kinds of test below, deliberately:
//
//   1. BEHAVIOUR — drive `logSearchEvent` and assert on the document it really
//      writes. Breaking the classifier wiring, dropping `host`, or logging
//      empty queries fails these.
//   2. ABSENCE — assert no route hand-rolls a `search_query` insert, and that
//      every known search route imports the shared writer. Here deletion *is*
//      the failure mode (a new route that forgets to log looks identical to a
//      route nobody searches), which is the one case CLAUDE.md allows a
//      source-shape assertion — same rationale as the soft-404 loading guard.

const inserted: Record<string, unknown>[] = [];

vi.mock('@/lib/mongodb', () => ({
  getDb: vi.fn(async () => ({
    collection: () => ({
      insertOne: async (doc: Record<string, unknown>) => {
        inserted.push(doc);
        return { insertedId: 'test' };
      },
    }),
  })),
}));

import { logSearchEvent } from '@/lib/search-event-log';

function req(headers: Record<string, string> = {}) {
  const h = new Headers({
    'user-agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_7 like Mac OS X) Safari/604.1',
    host: 'bph.sourcelibrary.org',
    'x-forwarded-for': '203.0.113.45',
    'cf-ipcountry': 'NL',
    ...headers,
  });
  return { headers: h } as unknown as Parameters<typeof logSearchEvent>[0]['request'];
}

/** logSearchEvent is fire-and-forget; let its microtask chain settle. */
const settle = () => new Promise((r) => setTimeout(r, 0));

beforeEach(() => {
  inserted.length = 0;
});

describe('logSearchEvent — the document it writes', () => {
  it('stores host, traffic class and user agent so a search can be attributed later', async () => {
    logSearchEvent({
      request: req(),
      query: 'quicksilver',
      resultsCount: 46,
      source: 'catalogue',
      tenantId: 'bce03f71-c18d-4460-b8ad-224c817f9aa0',
    });
    await settle();

    expect(inserted).toHaveLength(1);
    const doc = inserted[0];
    // The three fields whose absence made the original data unusable.
    expect(doc.host).toBe('bph.sourcelibrary.org');
    expect(doc.traffic_class).toBe('human');
    expect(doc.user_agent).toContain('iPhone');

    expect(doc.event).toBe('search_query');
    expect(doc.query).toBe('quicksilver');
    expect(doc.results_count).toBe(46);
    expect(doc.source).toBe('catalogue');
    expect(doc.country).toBe('NL');
  });

  it('promotes tenantId to a top-level field and keeps it in filters for back-compat', async () => {
    logSearchEvent({
      request: req(), query: 'boehme', resultsCount: 23,
      source: 'catalogue', tenantId: 'tenant-x',
    });
    await settle();

    // Four months of existing rows carry tenant only at filters.tenantId; the
    // admin search dashboards read that path. Both must be present.
    expect(inserted[0].tenantId).toBe('tenant-x');
    expect((inserted[0].filters as Record<string, unknown>).tenantId).toBe('tenant-x');
  });

  it('classifies a crawler as non-human instead of dropping it', async () => {
    logSearchEvent({
      request: req({ 'user-agent': 'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)' }),
      query: 'alchemy', resultsCount: 9, source: 'unified',
    });
    await settle();

    // Stored, not discarded — retroactive classification is impossible once the
    // user-agent is gone, so the class is recorded and filtered at read time.
    expect(inserted).toHaveLength(1);
    expect(inserted[0].traffic_class).not.toBe('human');
  });

  it('does not write a row for an empty or whitespace-only query', async () => {
    logSearchEvent({ request: req(), query: '', resultsCount: 0, source: 'catalogue' });
    logSearchEvent({ request: req(), query: '   ', resultsCount: 0, source: 'catalogue' });
    await settle();

    // Typeahead noise, not searches — it inflated the old zero-result lists.
    expect(inserted).toHaveLength(0);
  });

  it('records a genuine no-hit search', async () => {
    logSearchEvent({ request: req(), query: 'tekhelet', resultsCount: 0, source: 'catalogue' });
    await settle();

    // A real search returning nothing is the most valuable row in the table —
    // it is the collection-gap signal. Must not be confused with the empty case.
    expect(inserted).toHaveLength(1);
    expect(inserted[0].results_count).toBe(0);
  });

  it('truncates a very long query rather than storing it whole', async () => {
    logSearchEvent({ request: req(), query: 'x'.repeat(5000), resultsCount: 1, source: 'global' });
    await settle();
    expect((inserted[0].query as string).length).toBeLessThanOrEqual(300);
  });
});

// Every route that serves a search box a human can type into. Adding a search
// surface means adding it here — otherwise this guard silently stops covering
// the thing it exists to cover (the failure mode of the five `entities.books[]`
// writers in CLAUDE.md, where a fix "landed everywhere" twice and did not).
const SEARCH_ROUTES = [
  'src/app/api/catalog/bph/route.ts',
  'src/app/api/search/route.ts',
  'src/app/api/search/unified/route.ts',
  'src/app/api/search/index/route.ts',
  'src/app/api/books/[id]/search/route.ts',
  'src/app/api/[tenant]/books/[id]/search/route.ts',
];

const repoRoot = path.resolve(__dirname, '../..');
const read = (p: string) => fs.readFileSync(path.join(repoRoot, p), 'utf8');

describe('search instrumentation coverage', () => {
  it.each(SEARCH_ROUTES)('%s logs through the shared writer', (route) => {
    const src = read(route);
    expect(src).toContain("from '@/lib/search-event-log'");
    expect(src).toContain('logSearchEvent(');
  });

  it('no route hand-rolls its own search_query insert', () => {
    // Five divergent copies is how `host` went missing from all of them.
    const offenders = SEARCH_ROUTES.filter((r) => {
      const src = read(r);
      return /analytics_events'\)\s*\.insertOne\(\{[\s\S]{0,200}event:\s*'search_query'/.test(src);
    });
    expect(offenders).toEqual([]);
  });

  it('every tenant-aware search route passes its tenant to the logger', () => {
    // A route that resolves a tenant in order to *scope* its query, but does
    // not pass it to the logger, produces rows that cannot be attributed later
    // — which is exactly how `search_queries` ended up with four months of
    // unsplittable rows, and how `/api/search` shipped in the first pass of
    // #3484. If a route knows its tenant, the log must know it too.
    // Comments are stripped before matching. The first version of this test
    // did not strip them, so the explanatory comment sitting directly above
    // `tenantId,` satisfied the assertion and the test passed with the actual
    // argument deleted — a check that could not fail.
    const stripComments = (s: string) => s.replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '');

    for (const route of SEARCH_ROUTES) {
      const src = read(route);
      const resolvesTenant = /getTenantContextFromRequest|resolveTenantId|const tenantId/.test(src);
      if (!resolvesTenant) continue;
      const call = src.slice(src.indexOf('logSearchEvent({'));
      const callBody = stripComments(call.slice(0, call.indexOf('});') + 3));
      expect(callBody, `${route} resolves a tenant but does not pass it to logSearchEvent`)
        .toMatch(/\btenantId\b/);
    }
  });

  it('the semantic lane logs latency but does NOT emit a second search_query event', () => {
    // /api/search/semantic is fired by the same page-load as /api/search for a
    // single user query. Adding a search_query event here would double-count
    // every search. It logs to `search_queries` (latency/lane telemetry) only —
    // which is why it is deliberately absent from SEARCH_ROUTES above.
    const src = read('src/app/api/search/semantic/route.ts');
    expect(src).toContain('logSearchQuery(');
    expect(src).not.toContain('logSearchEvent(');
  });

  it('search_queries rows carry tenant and host so the log can be split later', () => {
    const src = read('src/lib/search-log.ts');
    // Derived inside the writer, not threaded through callers — a new caller
    // must not be able to omit them.
    expect(src).toContain('tenant_id:');
    expect(src).toContain('host:');
    expect(src).toContain('getTenantContextFromRequest');
  });

  it('the BPH catalogue route only logs real searches, not catalogue browsing', () => {
    const src = read('src/app/api/catalog/bph/route.ts');
    // Guards the numerator: without this, every page of catalogue browsing and
    // every pagination click counts as a search, and the resulting rate against
    // reading-room pageviews is meaningless.
    //
    // Asserted as one composite string that must sit *before* the log call —
    // `offset === 0` and `hasSearchTerm` each appear elsewhere in this file, so
    // testing for them separately would pass even with the logging deleted.
    const guard = src.indexOf('if (hasSearchTerm && offset === 0) {');
    const call = src.indexOf('logSearchEvent({');
    expect(guard).toBeGreaterThan(-1);
    expect(call).toBeGreaterThan(guard);
  });
});
