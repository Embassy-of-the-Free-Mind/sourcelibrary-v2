#!/usr/bin/env node
/**
 * Can a reader find a Greek author by their Greek name?
 *
 * This is the acceptance test for the `name_forms` index change, and it is
 * expected to FAIL until that change is applied — `books_search` is
 * dynamic:false, so the field is invisible to search until it is mapped.
 * See `.claude/docs/greek-search-index-change.md`.
 *
 *   node scripts/audit/greek-name-search.mjs [baseUrl]
 *
 * Why a live audit rather than a unit test: the thing under test is Atlas
 * Search's *analyzer*, which no amount of local assertion can exercise. Per
 * `.claude/docs/invariants/tests-that-are-not-guards.md`, the assertion has to
 * exercise the thing — here, a real query against a real index.
 *
 * The accent cases are the point. The live analyzer `standard_diacritic` uses
 * `asciiFolding`, which maps only Latin accented characters and leaves Greek
 * untouched. Under it `Πλάτων` would match and `πλατων` would not — a feature
 * that half-works for the few who type polytonic correctly and silently fails
 * for everyone else. `icuFolding` is what makes the unaccented and uppercase
 * cases below pass, so those three rows ARE the test.
 */

const BASE = (process.argv[2] || process.env.GREEK_AUDIT_BASE || 'https://sourcelibrary.org').replace(/\/$/, '');
const UA = { 'User-Agent': 'Mozilla/5.0 (compatible; SourceLibrary-GreekAudit/1.0)' };

const CASES = [
  { q: 'Πλάτων', expect: /plato/i, why: 'polytonic, as printed' },
  { q: 'πλατων', expect: /plato/i, why: 'UNACCENTED — needs icuFolding' },
  { q: 'ΠΛΑΤΩΝ', expect: /plato/i, why: 'UPPERCASE — needs icuFolding' },
  { q: 'Ἀριστοτέλης', expect: /aristot/i, why: 'polytonic with breathing' },
  { q: 'αριστοτελης', expect: /aristot/i, why: 'bare, no diacritics at all' },
  { q: 'Γαληνός', expect: /galen/i, why: 'Galen — 105 books, 1 work in Perseus' },
  { q: 'Πρόκλος', expect: /proclus/i, why: 'Proclus — 65 books, 1 work in Perseus' },
];

const results = [];
for (const { q, expect, why } of CASES) {
  let ok = false, detail = '';
  try {
    const r = await fetch(`${BASE}/api/books/library?search=${encodeURIComponent(q)}&limit=3`, { headers: UA });
    const j = await r.json();
    const books = j.books || [];
    const hit = books.find((b) => expect.test(`${b.author || ''} ${b.title || ''} ${b.display_title || ''}`));
    ok = Boolean(hit);
    detail = books.length ? `${books.length} results, top: ${(hit || books[0]).author || '—'}` : 'no results';
  } catch (e) {
    detail = `request failed: ${e.message}`;
  }
  results.push({ ok, q, why });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${q.padEnd(14)} ${why.padEnd(40)} ${detail}`);
}

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} passed against ${BASE}`);
if (failed.length) {
  console.log('\nIf ALL rows fail, the index has not been updated yet — that is the expected');
  console.log('state before the change in .claude/docs/greek-search-index-change.md is applied.');
  console.log('If only the unaccented/uppercase rows fail, the field is mapped but under the');
  console.log('wrong analyzer: asciiFolding does not fold Greek. It needs icuFolding.');
  process.exit(1);
}
