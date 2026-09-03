#!/usr/bin/env node
/**
 * Repair sweep for #4572 — two metadata defects left by IIIF-manifest importers.
 *
 * 1. SHELFMARK AS DISPLAY TITLE. Gallica publishes the holding statement as the
 *    manifest `label`, and the importers wrote it to `display_title`. The reader,
 *    the library grid and the card all render `display_title ?? title`, so 977
 *    books are named after a shelf — 216 of them live and publicly readable.
 *    Repair: `$unset display_title`, so the correct `title` (which was captured
 *    correctly all along) shows through.
 *
 * 2. RECOVERABLE YEAR LEFT UNREAD. 1,698 books carry `published: 'Unknown'`
 *    while `catalog_metadata.publication_date` holds the year the importer had
 *    already extracted. 389 are live. They are invisible to every date-bounded
 *    query (`year_from`/`year_to` on /books/library and the MCP list_books tool)
 *    with the answer sitting in their own document.
 *    Repair: promote the catalog date into `published` + `year`.
 *
 * The code fixes (src/lib/manifest-label.ts, wired into src/lib/import-utils.ts
 * and src/app/api/import/iiif/route.ts) stop NEW imports doing this. This sweep
 * cleans up what already landed. Both are needed — a fix without a sweep leaves
 * 216 books named after a shelf forever.
 *
 * SAFETY
 *   - Never unsets `display_title` unless `title` is present, non-empty, and is
 *     not itself a holding statement. A book with two junk names must be looked
 *     at by a person, not silently left with none.
 *   - Writes a numeric `year` ONLY when the catalogue string names exactly one
 *     year. Ranges, centuries and open bounds get an honest `published` string
 *     and no `year`, so date-bounded queries are never answered with a
 *     fabricated precision (see parseCatalogDate below).
 *   - Records a ROW per book in `sweep_log` (#3969), not a new column on `books`.
 *   - `--dry-run` by default in spirit: pass `--apply` to write.
 *
 * AFTER RUNNING: the ~216 visible books whose name changes need the usual
 * three steps, not just the Mongo write — Supabase catalog sync (with an
 * `updated_at` bump, else the write is inert) and an ISR/Cloudflare purge.
 * The script prints the affected slugs so that can be scoped rather than
 * purging the world.
 *
 * Usage:
 *   set -a; source .env.production.local; set +a
 *   node scripts/maintenance/repair-manifest-metadata-4572.mjs            # report only
 *   node scripts/maintenance/repair-manifest-metadata-4572.mjs --apply
 *   node scripts/maintenance/repair-manifest-metadata-4572.mjs --apply --only=titles
 *   node scripts/maintenance/repair-manifest-metadata-4572.mjs --apply --only=dates
 */

import { MongoClient } from 'mongodb';
import { recordSweepAction } from '../lib/sweep-log.mjs';

const APPLY = process.argv.includes('--apply');
const ONLY = (process.argv.find(a => a.startsWith('--only=')) || '').split('=')[1] || 'both';
const SWEEP = 'manifest-metadata-repair-4572';

const uri = process.env.MONGODB_URI;
if (!uri) {
  console.error('MONGODB_URI not set. Source .env.production.local first.');
  process.exit(1);
}

// ── the same guard the importers now use, inlined so this script stays
// dependency-free (scripts/ cannot import from src/lib without a build step).
// Kept deliberately in step with src/lib/manifest-label.ts.
const REPOSITORY_PREFIXES = [
  'bnf', 'bibliotheque nationale de france', 'bibliotheca', 'bayerische staatsbibliothek',
  'staatsbibliothek zu berlin', 'osterreichische nationalbibliothek', 'koninklijke bibliotheek',
  'british library', 'bodleian library', 'biblioteca nazionale', 'biblioteca apostolica vaticana',
  'library of congress', 'universitatsbibliothek', 'universiteitsbibliotheek',
];
const SHELF_MARKERS = [
  'departement philosophie', 'departement litterature', 'departement droit', 'departement sciences',
  'departement reserve', 'departement des manuscrits', 'departement de la musique',
  'reserve des livres rares',
];
const fold = s => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
const stripRepo = f => {
  for (const p of REPOSITORY_PREFIXES) if (f.startsWith(p + ' ')) return f.slice(p.length + 1).trim();
  return f;
};
function isHoldingStatement(label, callNumber) {
  if (!label) return false;
  const l = stripRepo(fold(label));
  if (!l) return false;
  if (callNumber) {
    const c = stripRepo(fold(callNumber));
    if (c && (c === l || c.includes(l) || l.includes(c))) return true;
  }
  if (SHELF_MARKERS.some(m => l.includes(m))) return true;
  if (REPOSITORY_PREFIXES.includes(fold(label))) return true;
  return false;
}

/**
 * Split a catalogue date string into an honest `published` and — only when the
 * string really names ONE year — a numeric `year`.
 *
 * This deliberately does NOT match `publishedToYear` in src/lib/resolve-language.ts,
 * which takes the first 3–4 digit run it finds. That rule is fine for a caller
 * hint typed by a curator; run over catalogue strings it fabricates precision:
 *
 *   "1601-1700"                                  → 1601   (a century, not a year)
 *   "after 1599/1st half of the 17th century"    → 1599   (the one year it is NOT)
 *   "1301-1500 / 1401-1500 / 1301-1400"          → 1301   (three overlapping ranges)
 *
 * A book with a century-range imprint genuinely has no year, and saying 1601
 * would make it answer a `year_from=1601&year_to=1601` query with false
 * confidence. Better: give it an honest `published` string so the catalogue
 * shows a date, and leave `year` unset so date-bounded queries don't lie.
 */
function parseCatalogDate(raw) {
  if (raw == null) return null;
  const s = String(raw).trim();
  if (!s || /^unknown$/i.test(s)) return null;

  const plausible = n => Number.isFinite(n) && n >= 800 && n <= new Date().getFullYear();

  // Anything expressing a span, a century, or an open bound gets `published`
  // only. Checked BEFORE the single-year match so "after 1599" can't slip past.
  const isSpan = /(\d{3,4})\s*[-–—/]\s*(\d{3,4})/.test(s)          // 1601-1700, 1301/1400
    || /\bcentur(y|ies)\b|\bsiècle\b|\bjh\.?\b|\bjahrhundert\b/i.test(s)
    || /\b(after|before|nach|vor|post|ante|not before|not after)\b/i.test(s)
    || /\b(quarter|half|third)\b/i.test(s);

  const singleYear = s.match(/^\s*(?:ca\.?|circa|around|about|approx\.?|vers|um|c\.)?\s*\[?\s*(\d{3,4})\s*\]?\s*\.?\s*$/i);

  if (!isSpan && singleYear) {
    const n = parseInt(singleYear[1], 10);
    if (plausible(n)) return { published: s, year: n, precision: 'year' };
  }

  // Keep the honest string if it contains any plausible year at all, so the
  // catalogue can show something true even when we can't pin a number.
  const anyYear = [...s.matchAll(/(?<!\d)\d{3,4}(?!\d)/g)].map(m => parseInt(m[0], 10)).filter(plausible);
  if (anyYear.length) return { published: s, year: null, precision: 'range' };

  return null;
}

async function repairTitles(db, books) {
  console.log('\n=== 1. Shelfmark in display_title ===');
  const candidates = await books.find(
    { display_title: { $type: 'string', $ne: '' } },
    { projection: { id: 1, slug: 1, title: 1, display_title: 1, visible: 1, 'catalog_metadata.call_number': 1 } },
  ).toArray();

  const toFix = [];
  const skipped = [];
  for (const b of candidates) {
    if (!isHoldingStatement(b.display_title, b.catalog_metadata?.call_number)) continue;
    // Refuse to leave a book with no usable name at all.
    const title = typeof b.title === 'string' ? b.title.trim() : '';
    if (!title || isHoldingStatement(title, b.catalog_metadata?.call_number)) {
      skipped.push(b);
      continue;
    }
    toFix.push(b);
  }

  console.log(`shelfmark display_titles found: ${toFix.length + skipped.length}`);
  console.log(`  repairable (real title behind them): ${toFix.length}  (visible: ${toFix.filter(b => b.visible).length})`);
  console.log(`  SKIPPED — title is junk too, needs a person: ${skipped.length}`);
  for (const b of skipped.slice(0, 10)) console.log(`    ${b.id}  title=${JSON.stringify(b.title)}  display=${JSON.stringify(b.display_title)}`);

  console.log('\n  sample repairs:');
  for (const b of toFix.slice(0, 5)) {
    console.log(`    ${b.id} ${b.visible ? '[LIVE]' : '      '} ${JSON.stringify(b.display_title)}`);
    console.log(`      → falls back to: ${JSON.stringify(b.title)}`);
  }

  if (!APPLY) return { fixed: 0, visibleSlugs: [] };

  let fixed = 0;
  const visibleSlugs = [];
  for (const b of toFix) {
    const res = await books.updateOne(
      { _id: b._id },
      { $unset: { display_title: '' }, $currentDate: { updated_at: true } },
    );
    if (res.modifiedCount === 1) {
      fixed++;
      if (b.visible && b.slug) visibleSlugs.push(b.slug);
      await recordSweepAction(db, {
        sweep: SWEEP,
        book_id: String(b.id),
        action: 'unset-shelfmark-display-title',
        detail: { was: b.display_title, now_shows: b.title, was_visible: Boolean(b.visible) },
      });
    }
  }
  console.log(`\n  APPLIED: ${fixed} display_titles unset (${visibleSlugs.length} on live books)`);
  return { fixed, visibleSlugs };
}

async function repairDates(db, books) {
  console.log('\n=== 2. published Unknown with a recoverable catalog date ===');
  const candidates = await books.find(
    {
      $or: [{ published: 'Unknown' }, { published: { $exists: false } }, { published: null }, { published: '' }],
      'catalog_metadata.publication_date': { $exists: true, $nin: [null, ''] },
    },
    { projection: { id: 1, slug: 1, title: 1, published: 1, year: 1, visible: 1, 'catalog_metadata.publication_date': 1, 'image_source.provider': 1 } },
  ).toArray();

  const toFix = [];
  const unparseable = [];
  for (const b of candidates) {
    const raw = b.catalog_metadata.publication_date;
    const parsed = parseCatalogDate(raw);
    if (!parsed) { unparseable.push({ id: b.id, raw }); continue; }
    toFix.push({ ...b, _parsed: parsed });
  }

  const exact = toFix.filter(b => b._parsed.precision === 'year');
  const ranged = toFix.filter(b => b._parsed.precision === 'range');
  console.log(`candidates: ${candidates.length}  (visible: ${candidates.filter(b => b.visible).length})`);
  console.log(`  repairable: ${toFix.length}  (visible: ${toFix.filter(b => b.visible).length})`);
  console.log(`    exact year  → published + year: ${exact.length}  (visible: ${exact.filter(b => b.visible).length})`);
  console.log(`    range/century → published ONLY, year left unset: ${ranged.length}  (visible: ${ranged.filter(b => b.visible).length})`);
  console.log(`  SKIPPED — no plausible year in the string at all: ${unparseable.length}`);
  for (const u of unparseable.slice(0, 10)) console.log(`    ${u.id}  ${JSON.stringify(u.raw)}`);

  console.log('\n  range samples (deliberately get NO year):');
  for (const b of ranged.slice(0, 5)) console.log(`    ${b.id}  ${JSON.stringify(b._parsed.published)}`);

  const byProvider = {};
  for (const b of toFix) byProvider[b.image_source?.provider || 'none'] = (byProvider[b.image_source?.provider || 'none'] || 0) + 1;
  console.log('  by provider:', Object.entries(byProvider).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k}=${v}`).join(' '));

  console.log('\n  sample repairs (exact):');
  for (const b of exact.slice(0, 5)) {
    console.log(`    ${b.id} ${b.visible ? '[LIVE]' : '      '} ${String(b.title || '').slice(0, 50)}`);
    console.log(`      published: ${JSON.stringify(b.published ?? null)} → ${JSON.stringify(b._parsed.published)}   year → ${b._parsed.year}`);
  }

  if (!APPLY) return { fixed: 0, visibleSlugs: [] };

  let fixed = 0;
  const visibleSlugs = [];
  for (const b of toFix) {
    const set = { published: b._parsed.published };
    // Only claim a numeric year when the catalogue string names exactly one.
    if (b._parsed.year !== null) set.year = b._parsed.year;
    const res = await books.updateOne(
      { _id: b._id },
      { $set: set, $currentDate: { updated_at: true } },
    );
    if (res.modifiedCount === 1) {
      fixed++;
      if (b.visible && b.slug) visibleSlugs.push(b.slug);
      await recordSweepAction(db, {
        sweep: SWEEP,
        book_id: String(b.id),
        action: 'promote-catalog-publication-date',
        detail: {
          published: b._parsed.published,
          year: b._parsed.year,
          precision: b._parsed.precision,
          source: 'catalog_metadata.publication_date',
          was_visible: Boolean(b.visible),
        },
      });
    }
  }
  console.log(`\n  APPLIED: ${fixed} dates promoted (${visibleSlugs.length} on live books)`);
  return { fixed, visibleSlugs };
}

async function main() {
  const client = new MongoClient(uri);
  await client.connect();
  const db = client.db('bookstore');
  const books = db.collection('books');

  console.log(`=== #4572 manifest metadata repair — ${APPLY ? 'APPLY' : 'REPORT ONLY (pass --apply to write)'} ===`);
  console.log(`scope: ${ONLY}`);

  const titles = ONLY === 'dates' ? { fixed: 0, visibleSlugs: [] } : await repairTitles(db, books);
  const dates = ONLY === 'titles' ? { fixed: 0, visibleSlugs: [] } : await repairDates(db, books);

  if (APPLY) {
    const slugs = [...new Set([...titles.visibleSlugs, ...dates.visibleSlugs])];
    console.log('\n=== FOLLOW-UP REQUIRED ===');
    console.log(`${slugs.length} LIVE books changed. A Mongo write alone does not reach readers:`);
    console.log('  1. Supabase catalog sync (the grid reads Supabase, not Mongo)');
    console.log('  2. ISR revalidate + Cloudflare purge for each /book/<slug>');
    if (slugs.length) {
      console.log('\nAffected live slugs:');
      for (const s of slugs) console.log(`  ${s}`);
    }
  }

  await client.close();
}

main().catch(err => { console.error(err); process.exit(1); });
