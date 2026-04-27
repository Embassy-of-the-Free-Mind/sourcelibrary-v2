#!/usr/bin/env node
/**
 * Search Quality Evaluation Suite
 *
 * Tests search across three consumer profiles:
 * 1. Human (website search bar) — uses /api/search/unified
 * 2. Librarian/Curator (curation workflow) — uses /api/search
 * 3. AI Agent (MCP/Thoth) — uses /api/search
 *
 * Run: node scripts/eval/search-quality-eval.mjs [--base-url URL]
 *
 * Exit code: number of FAIL results (0 = all pass)
 */

const BASE = process.argv.includes('--base-url')
  ? process.argv[process.argv.indexOf('--base-url') + 1]
  : 'https://sourcelibrary.org';

// ── Test Cases ─────────────────────────────────────────────────────────

const TESTS = [
  // ── EXACT TITLE MATCHES ──────────────────────────────────────────────
  {
    name: 'Single distinctive word finds book by title',
    query: 'stukeley',
    endpoint: '/api/search',
    expect: { minBooks: 1, titleContains: 'stonehenge' },
    consumer: 'all',
  },
  {
    name: 'Author search finds their works',
    query: 'avicenna',
    endpoint: '/api/search',
    expect: { minBooks: 1, titleOrAuthorContains: 'avicenna' },
    consumer: 'all',
  },

  // ── CROSS-LINGUAL / ALTERNATE NAMES ──────────────────────────────────
  {
    name: 'Panchatantra: finds related fable collections',
    query: 'panchatantra',
    endpoint: '/api/search',
    expect: {
      minResults: 1,
      // We may not have a book titled "Panchatantra" but should find
      // Kalila wa-Dimna, Bidpai, or any fable collection via semantic/keywords
      noResultIsAlsoOk: true, // If we truly don't have it, "not found" is better than false positives
      bookResultsShouldNotInclude: ['varahamihira', 'bestiary', 'pashakavali'],
    },
    consumer: 'librarian',
  },
  {
    name: 'Ibn Khaldun: returns results without error',
    query: 'ibn khaldun muqaddimah',
    endpoint: '/api/search',
    expect: {
      // We don't have a Muqaddimah in the library. Semantic search will return
      // nearby Arabic philosophy books — this isn't ideal but is acceptable.
      // The real fix is importing the Muqaddimah or showing "no exact match".
      noTimeout: true,
    },
    consumer: 'librarian',
    timeoutMs: 12000,
  },

  // ── SUBJECT/KEYWORD DISCOVERY ────────────────────────────────────────
  {
    name: 'Druids: finds books about druids even without "druid" in title',
    query: 'druids',
    endpoint: '/api/search',
    expect: { minResults: 1 },
    consumer: 'human',
  },
  {
    name: 'Mushroom: single word finds mycology/botany books',
    query: 'mushroom',
    endpoint: '/api/search',
    expect: { minResults: 1 },
    consumer: 'all',
  },

  // ── MULTI-WORD QUERIES (former timeout cases) ────────────────────────
  {
    name: 'Multi-word: mushroom truffle fungus returns without timeout',
    query: 'mushroom truffle fungus',
    endpoint: '/api/search',
    expect: { noTimeout: true, minResults: 1 },
    consumer: 'librarian',
    timeoutMs: 12000,
  },
  {
    name: 'Multi-word: 5-word query returns without timeout',
    query: 'bhang cannabis vijaya hemp intoxicant',
    endpoint: '/api/search',
    expect: { noTimeout: true },
    consumer: 'librarian',
    timeoutMs: 12000,
  },
  {
    name: 'Multi-word: music theory returns without timeout',
    query: 'music theory treatise harmony counterpoint',
    endpoint: '/api/search',
    expect: { noTimeout: true },
    consumer: 'librarian',
    timeoutMs: 12000,
  },

  // ── RESULT CAP ───────────────────────────────────────────────────────
  {
    name: 'Result cap: can request >100 results',
    query: 'Sanskrit',
    endpoint: '/api/search',
    params: { limit: 200 },
    expect: { minResults: 101 },
    consumer: 'librarian',
  },

  // ── LANGUAGE FILTER ──────────────────────────────────────────────────
  {
    name: 'Language filter: Sanskrit filter returns only Sanskrit books',
    query: 'philosophy',
    endpoint: '/api/search',
    params: { language: 'Sanskrit' },
    expect: { allLanguage: 'Sanskrit' },
    consumer: 'all',
  },

  // ── SEMANTIC BOOK PROMOTION ──────────────────────────────────────────
  {
    name: 'Semantic: "transmutation of metals" finds alchemy books as book-level results',
    query: 'transmutation of metals',
    endpoint: '/api/search',
    expect: { hasBookTypeResults: true },
    consumer: 'human',
  },
  {
    name: 'Semantic: "sacred geometry" finds relevant books',
    query: 'sacred geometry',
    endpoint: '/api/search',
    expect: { hasBookTypeResults: true },
    consumer: 'human',
  },

  // ── UNIFIED SEARCH (human typeahead) ─────────────────────────────────
  {
    name: 'Unified: returns books + semantic + collections',
    query: 'alchemy',
    endpoint: '/api/search/unified',
    expect: { hasBooks: true, hasSemantic: true },
    consumer: 'human',
  },
  {
    name: 'Unified: responds within 8s',
    query: 'hermetica',
    endpoint: '/api/search/unified',
    expect: { noTimeout: true },
    consumer: 'human',
    timeoutMs: 8000,
  },

  // ── SEMANTIC SEARCH ENDPOINT (Thoth) ─────────────────────────────────
  {
    name: 'Semantic endpoint: returns book-level results',
    query: 'dreams and prophecy in ancient world',
    endpoint: '/api/search/semantic',
    expect: { minResults: 1 },
    consumer: 'thoth',
  },

  // ── BOOK RANKING QUALITY ─────────────────────────────────────────────
  {
    name: 'Ranking: book-level results appear before page-level results',
    query: 'hermes trismegistus',
    endpoint: '/api/search',
    expect: { firstResultIsBook: true },
    consumer: 'all',
  },
  {
    name: 'Ranking: title match ranks above page mention',
    query: 'corpus hermeticum',
    endpoint: '/api/search',
    expect: { firstResultTitleContains: 'hermeticum' },
    consumer: 'all',
  },
];

// ── Runner ──────────────────────────────────────────────────────────────

async function runTest(test) {
  const url = new URL(`${BASE}${test.endpoint}`);
  url.searchParams.set('q', test.query);
  if (test.params) {
    for (const [k, v] of Object.entries(test.params)) {
      url.searchParams.set(k, String(v));
    }
  }
  // Default limit for non-cap tests
  if (!test.params?.limit && test.endpoint === '/api/search') {
    url.searchParams.set('limit', '20');
  }

  const timeout = test.timeoutMs || 15000;
  const start = Date.now();

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeout);
    const res = await fetch(url.toString(), { signal: controller.signal });
    clearTimeout(timer);
    const elapsed = Date.now() - start;

    if (!res.ok) {
      if (test.expect.noTimeout) {
        return { pass: false, reason: `HTTP ${res.status} (${elapsed}ms)` };
      }
      return { pass: false, reason: `HTTP ${res.status}` };
    }

    const data = await res.json();

    // ── Assertions ──────────────────────────────────────────────────────

    // Unified endpoint has different shape
    const isUnified = test.endpoint === '/api/search/unified';
    const isSemantic = test.endpoint === '/api/search/semantic';
    const results = isUnified ? (data.books?.results || []) : (data.results || []);
    const semanticResults = isUnified ? (data.semantic?.results || []) : [];
    const bookResults = results.filter(r => r.type === 'book');
    const pageResults = results.filter(r => r.type === 'page');

    const failures = [];

    if (test.expect.noTimeout) {
      // Pass — we got a response
    }

    if (test.expect.minResults !== undefined) {
      const total = isSemantic ? results.length : (isUnified ? results.length : results.length);
      if (total < test.expect.minResults) {
        failures.push(`Expected >= ${test.expect.minResults} results, got ${total}`);
      }
    }

    if (test.expect.minBooks !== undefined) {
      if (bookResults.length < test.expect.minBooks) {
        failures.push(`Expected >= ${test.expect.minBooks} book results, got ${bookResults.length}`);
      }
    }

    if (test.expect.titleContains) {
      const needle = test.expect.titleContains.toLowerCase();
      const found = results.some(r => (r.title || r.display_title || '').toLowerCase().includes(needle));
      if (!found) failures.push(`No result title contains "${needle}"`);
    }

    if (test.expect.titleOrAuthorContains) {
      const needle = test.expect.titleOrAuthorContains.toLowerCase();
      const found = results.some(r =>
        (r.title || '').toLowerCase().includes(needle) ||
        (r.display_title || '').toLowerCase().includes(needle) ||
        (r.author || '').toLowerCase().includes(needle)
      );
      if (!found) failures.push(`No result title/author contains "${needle}"`);
    }

    if (test.expect.bookResultsShouldNotInclude) {
      for (const bad of test.expect.bookResultsShouldNotInclude) {
        const needle = bad.toLowerCase();
        // Only check first 5 results — those are the ones users see
        const topResults = results.slice(0, 5);
        const found = topResults.find(r =>
          (r.title || '').toLowerCase().includes(needle) ||
          (r.display_title || '').toLowerCase().includes(needle) ||
          (r.author || '').toLowerCase().includes(needle)
        );
        if (found) {
          failures.push(`Top results include false positive: "${found.display_title || found.title}" (matched "${bad}")`);
        }
      }
    }

    if (test.expect.allLanguage) {
      const wrongLang = bookResults.find(r => r.language !== test.expect.allLanguage);
      if (wrongLang) {
        failures.push(`Expected all books in ${test.expect.allLanguage}, found "${wrongLang.title}" in ${wrongLang.language}`);
      }
    }

    if (test.expect.hasBookTypeResults) {
      if (bookResults.length === 0) {
        failures.push('Expected at least one book-level result, got only page results');
      }
    }

    if (test.expect.hasBooks) {
      if (results.length === 0) failures.push('No book results in unified response');
    }

    if (test.expect.hasSemantic) {
      if (semanticResults.length === 0) failures.push('No semantic results in unified response');
    }

    if (test.expect.firstResultIsBook) {
      if (results.length > 0 && results[0].type !== 'book') {
        failures.push(`First result is type "${results[0].type}", expected "book"`);
      }
    }

    if (test.expect.firstResultTitleContains) {
      const needle = test.expect.firstResultTitleContains.toLowerCase();
      if (results.length > 0) {
        const title = (results[0].display_title || results[0].title || '').toLowerCase();
        if (!title.includes(needle)) {
          failures.push(`First result title "${title}" doesn't contain "${needle}"`);
        }
      } else {
        failures.push('No results to check first result title');
      }
    }

    if (failures.length > 0) {
      return { pass: false, reason: failures.join('; '), elapsed, resultCount: results.length, bookCount: bookResults.length };
    }

    return { pass: true, elapsed, resultCount: results.length, bookCount: bookResults.length };

  } catch (err) {
    const elapsed = Date.now() - start;
    if (err.name === 'AbortError') {
      if (test.expect.noTimeout) {
        return { pass: false, reason: `Timeout after ${timeout}ms`, elapsed };
      }
      return { pass: false, reason: `Timeout after ${timeout}ms`, elapsed };
    }
    return { pass: false, reason: String(err), elapsed };
  }
}

// ── Main ────────────────────────────────────────────────────────────────

async function main() {
  console.log(`\nSearch Quality Evaluation — ${BASE}`);
  console.log(`Running ${TESTS.length} tests...\n`);

  let passed = 0;
  let failed = 0;
  const failures = [];

  for (const test of TESTS) {
    const result = await runTest(test);
    const status = result.pass ? 'PASS' : 'FAIL';
    const icon = result.pass ? '\x1b[32m✓\x1b[0m' : '\x1b[31m✗\x1b[0m';
    const timing = result.elapsed ? ` (${result.elapsed}ms)` : '';
    const counts = result.resultCount !== undefined ? ` [${result.bookCount}B/${result.resultCount}T]` : '';

    console.log(`${icon} [${test.consumer}] ${test.name}${timing}${counts}`);
    if (!result.pass) {
      console.log(`  → ${result.reason}`);
      failed++;
      failures.push({ name: test.name, reason: result.reason });
    } else {
      passed++;
    }
  }

  console.log(`\n${'─'.repeat(60)}`);
  console.log(`Results: ${passed} passed, ${failed} failed out of ${TESTS.length} tests`);

  if (failures.length > 0) {
    console.log('\nFailures:');
    for (const f of failures) {
      console.log(`  - ${f.name}: ${f.reason}`);
    }
  }

  console.log();
  process.exit(failed);
}

main();
