#!/usr/bin/env node
/**
 * Guard script for the `collections` Mongo collection (db `bookstore`),
 * per GitHub issue #3002 section F.
 *
 * Read-only. Runs a battery of structural/data-quality checks over
 * `collections` (and, for membership integrity, `books`) and reports
 * PASS/FAIL/WARN per check:
 *
 *   1. FAIL — duplicate display `name` among visible collections
 *   2. FAIL — visible collection missing `kind` or `kind` outside the enum
 *   3. FAIL — visible tradition/region collections under the minimum book_count
 *   4. FAIL — parent slugs that don't resolve to an existing collection doc
 *   5. FAIL — hierarchy depth > 4, or a parent cycle
 *   6. WARN — visible tradition collections with no curation content
 *   7. FAIL/WARN — book membership integrity vs `books.collections`
 *   8. FAIL — merged docs missing from the redirect map / stale redirect targets
 *   9. WARN — visible collections with no `hero_image`
 *
 * This script NEVER writes to the database.
 *
 * Usage:
 *   set -a; source .env.production.local; set +a
 *   node scripts/maintenance/audit-collections.mjs               # normal (FAILs exit 1)
 *   node scripts/maintenance/audit-collections.mjs --warn-only   # downgrade all FAILs to WARN, always exit 0
 */
import { MongoClient } from 'mongodb';
import { readFileSync } from 'fs';

const WARN_ONLY = process.argv.includes('--warn-only');

const uri = process.env.MONGODB_URI;
if (!uri) {
  console.error('MONGODB_URI not set. Try: set -a; source .env.production.local; set +a');
  process.exit(1);
}

const MAIN_TENANT_ID = 'bce03f71-c18d-4460-b8ad-224c817f9aa0';
const VALID_KINDS = new Set(['tradition', 'region', 'provenance', 'exhibit', 'artwork']);
const MIN_BOOK_COUNT = { tradition: 15, region: 50 };
// Depth convention: a root is depth 1. Prod's real max today is 4 (e.g. the
// Chinese/Islamic/Indian sub-tradition trees) — the issue #3002 "max depth 3"
// snapshot counted edges from the root. Guard against going DEEPER than today.
const MAX_DEPTH = 4;

const results = []; // { check, level: 'FAIL'|'WARN', count }

function isMainTenant(doc) {
  return doc.tenantId == null || doc.tenantId === MAIN_TENANT_ID;
}

function parentsOf(doc) {
  if (doc.parent == null) return [];
  if (Array.isArray(doc.parent)) return doc.parent.filter(Boolean);
  return [doc.parent];
}

function section(title) {
  console.log(`\n--- ${title} ---`);
}

function report(checkName, level, items, formatFn) {
  const effectiveLevel = WARN_ONLY ? 'WARN' : level;
  if (items.length === 0) {
    console.log('PASS: no issues found');
    return;
  }
  console.log(`${effectiveLevel}: ${items.length} issue(s) found`);
  for (const item of items) {
    console.log(`  - ${formatFn(item)}`);
  }
  results.push({ check: checkName, level: effectiveLevel, count: items.length });
}

const client = await MongoClient.connect(uri);
const db = client.db('bookstore');
const collections = db.collection('collections');
const books = db.collection('books');

const allDocs = await collections.find({}).toArray();
const bySlug = new Map(allDocs.map((d) => [d.slug, d]));
const mainDocs = allDocs.filter(isMainTenant);
const visibleMainDocs = mainDocs.filter((d) => d.visible === true);

console.log(`Loaded ${allDocs.length} collection docs (${mainDocs.length} main-tenant, ${visibleMainDocs.length} visible main-tenant).`);

// ---------------------------------------------------------------------------
// 1. Duplicate display `name` among visible collections (case-insensitive, trimmed)
// ---------------------------------------------------------------------------
section('1. Duplicate names among visible collections');
{
  const byName = new Map(); // normalized name -> [slugs]
  for (const d of visibleMainDocs) {
    const norm = String(d.name ?? '').trim().toLowerCase();
    if (!norm) continue;
    if (!byName.has(norm)) byName.set(norm, []);
    byName.get(norm).push(d.slug);
  }
  const dupes = [...byName.entries()].filter(([, slugs]) => slugs.length > 1);
  report('1-duplicate-names', 'FAIL', dupes, ([name, slugs]) => `"${name}" — ${slugs.join(', ')}`);
}

// ---------------------------------------------------------------------------
// 2. Missing/invalid `kind` on visible collections
// ---------------------------------------------------------------------------
section('2. Missing or invalid `kind` on visible collections');
{
  const bad = visibleMainDocs.filter((d) => !d.kind || !VALID_KINDS.has(d.kind));
  report('2-invalid-kind', 'FAIL', bad, (d) => `${d.slug} — kind=${JSON.stringify(d.kind ?? null)}`);
}

// ---------------------------------------------------------------------------
// 3. book_count minimums for visible tradition/region collections (skip merged)
// ---------------------------------------------------------------------------
section('3. book_count below minimum for visible tradition/region collections');
{
  // The size bar is a FRONT-DOOR rule: it applies to root collections (the
  // ones the /collections bands surface), not to sub-shelves under a hall.
  const under = visibleMainDocs.filter((d) => {
    if (d.merged_into) return false;
    if (parentsOf(d).length > 0) return false;
    const min = MIN_BOOK_COUNT[d.kind];
    if (min == null) return false;
    return (d.book_count ?? 0) < min;
  });
  report(
    '3-under-min-book-count',
    'FAIL',
    under,
    (d) => `${d.slug} (kind=${d.kind}) — book_count=${d.book_count ?? 0}, min=${MIN_BOOK_COUNT[d.kind]}`
  );
}

// ---------------------------------------------------------------------------
// 4. Parent slugs that don't resolve, across ALL docs (incl. tenant docs)
// ---------------------------------------------------------------------------
section('4. Unresolvable parent slugs (all docs, incl. tenant)');
{
  const broken = [];
  for (const d of allDocs) {
    for (const p of parentsOf(d)) {
      if (!bySlug.has(p)) broken.push({ slug: d.slug, parent: p });
    }
  }
  report('4-unresolvable-parent', 'FAIL', broken, (b) => `${b.slug} -> parent "${b.parent}" (not found)`);
}

// ---------------------------------------------------------------------------
// 5. hierarchy depth > 4, and parent cycles (main-tenant docs; multi-parent = max depth)
// ---------------------------------------------------------------------------
section('5. hierarchy depth > 4 / parent cycles');
{
  const depthCache = new Map(); // slug -> depth (or 'CYCLE')
  const tooDeep = [];
  const cycles = [];

  function depthOf(slug, stack) {
    if (depthCache.has(slug)) return depthCache.get(slug);
    if (stack.has(slug)) {
      cycles.push([...stack, slug].join(' -> '));
      depthCache.set(slug, 1); // avoid infinite recursion / cascading depth errors
      return 1;
    }
    const doc = bySlug.get(slug);
    if (!doc) {
      depthCache.set(slug, 1);
      return 1;
    }
    const parents = parentsOf(doc).filter((p) => bySlug.has(p));
    if (parents.length === 0) {
      depthCache.set(slug, 1);
      return 1;
    }
    const nextStack = new Set(stack);
    nextStack.add(slug);
    const maxParentDepth = Math.max(...parents.map((p) => depthOf(p, nextStack)));
    const d = maxParentDepth + 1;
    depthCache.set(slug, d);
    return d;
  }

  for (const d of mainDocs) {
    const depth = depthOf(d.slug, new Set());
    if (depth > MAX_DEPTH) tooDeep.push({ slug: d.slug, depth });
  }

  // de-dupe cycle strings (same cycle can be discovered from multiple entry points)
  const uniqueCycles = [...new Set(cycles)];

  report('5-hierarchy-too-deep', 'FAIL', tooDeep, (t) => `${t.slug} — depth=${t.depth} (max ${MAX_DEPTH})`);
  report('5-parent-cycle', 'FAIL', uniqueCycles, (c) => c);
}

// ---------------------------------------------------------------------------
// 6. WARN: visible tradition collections with no curation content
// ---------------------------------------------------------------------------
section('6. Visible tradition collections with no curation content');
{
  const uncurated = visibleMainDocs.filter((d) => {
    if (d.kind !== 'tradition') return false;
    const noDesc = !d.expanded_description || String(d.expanded_description).trim() === '';
    const noHighlights = !Array.isArray(d.highlighted_books) || d.highlighted_books.length === 0;
    return noDesc || noHighlights;
  });
  report(
    '6-uncurated-traditions',
    'WARN',
    uncurated,
    (d) => {
      const missing = [];
      if (!d.expanded_description || String(d.expanded_description).trim() === '') missing.push('expanded_description');
      if (!Array.isArray(d.highlighted_books) || d.highlighted_books.length === 0) missing.push('highlighted_books');
      return `${d.slug} — missing: ${missing.join(', ')}`;
    }
  );
}

// ---------------------------------------------------------------------------
// 7. Book membership integrity vs books.collections
// ---------------------------------------------------------------------------
section('7. Book membership integrity (books.collections vs collections)');
{
  const referencedSlugs = await books.distinct('collections', { visible: true, pages_count: { $gt: 0 } });
  const missing = referencedSlugs.filter((s) => s && !bySlug.has(s));
  const mergedButReferenced = referencedSlugs.filter((s) => s && bySlug.has(s) && bySlug.get(s).merged_into);

  report('7-missing-collection-docs', 'FAIL', missing, (s) => `"${s}" — referenced by live books, no collection doc exists`);
  report(
    '7-referenced-merged-collections',
    'WARN',
    mergedButReferenced,
    (s) => `"${s}" -> merged_into "${bySlug.get(s).merged_into}" but still referenced by live books (re-tag missed)`
  );
}

// ---------------------------------------------------------------------------
// 8. Redirect map coverage for merged docs
// ---------------------------------------------------------------------------
section('8. Redirect map coverage for merged collections');
{
  const mergedDocs = allDocs.filter((d) => d.merged_into);
  let redirectMap = null;
  try {
    redirectMap = JSON.parse(
      readFileSync(new URL('../../src/lib/collection-redirects.json', import.meta.url))
    );
  } catch (err) {
    console.log(`WARN: redirect map not found or unreadable (${err.code ?? err.message}) — skipping check 8`);
    results.push({ check: '8-redirect-map-missing', level: 'WARN', count: 1 });
    redirectMap = null;
  }

  if (redirectMap) {
    const missingFromMap = mergedDocs.filter((d) => !(d.slug in redirectMap));
    report(
      '8-merged-not-in-redirect-map',
      'FAIL',
      missingFromMap,
      (d) => `${d.slug} — merged_into "${d.merged_into}" but absent from collection-redirects.json`
    );

    const staleTargets = Object.entries(redirectMap).filter(([, target]) => {
      const targetDoc = bySlug.get(target);
      return !targetDoc || targetDoc.merged_into;
    });
    report(
      '8-stale-redirect-targets',
      'FAIL',
      staleTargets,
      ([from, target]) => `"${from}" -> "${target}" — target ${bySlug.has(target) ? 'is itself merged' : 'does not exist'}`
    );
  }
}

// ---------------------------------------------------------------------------
// 9. WARN: visible collections with no hero_image
// ---------------------------------------------------------------------------
section('9. Visible collections with no hero_image');
{
  const noHero = visibleMainDocs.filter((d) => !d.hero_image || String(d.hero_image).trim() === '');
  report('9-no-hero-image', 'WARN', noHero, (d) => d.slug);
}

// ---------------------------------------------------------------------------
// Summary
// ---------------------------------------------------------------------------
section('SUMMARY');
const failCount = results.filter((r) => r.level === 'FAIL').reduce((sum, r) => sum + r.count, 0);
const warnCount = results.filter((r) => r.level === 'WARN').reduce((sum, r) => sum + r.count, 0);

if (results.length === 0) {
  console.log('No issues found across any check.');
} else {
  for (const r of results) {
    console.log(`  [${r.level}] ${r.check}: ${r.count}`);
  }
}
console.log(`\nTotal: ${failCount} failure(s), ${warnCount} warning(s).`);

await client.close();

const hasFailures = results.some((r) => r.level === 'FAIL');
if (hasFailures) {
  console.log(`\nAUDIT FAILED (${failCount} failures)`);
  process.exit(1);
} else {
  console.log('\nAUDIT PASSED');
  process.exit(0);
}
