#!/usr/bin/env node
/**
 * Import C.G. Jung's personal library from e-rara.
 *
 * Source: e-rara OAI-PMH set `cgj` ("C.G. Jung"), held by
 * Stiftung der Werke von C.G. Jung (Zürich). ~345 records.
 *
 * Pipeline:
 *   1. Harvest cgj OAI set
 *   2. Cross-ref each against existing `books` (erara_id + normalized title/author)
 *   3. Write report (JSON + Markdown)
 *   4. With --import: POST /api/import/e-rara for new records only
 *
 * Once imported, the existing archive-erara worker picks them up automatically
 * (queried by image_source.provider='e-rara' AND pages_archived missing), and
 * the enrich-erara-swiss-libraries job sets contributing_library from the
 * IIIF manifest logo (cgjung-werke.org → Stiftung der Werke von C.G. Jung).
 *
 * Books are imported as hidden/draft for editorial review.
 *
 * Usage:
 *   set -a; source .env.production.local; set +a
 *   node scripts/import-jung-library.mjs                 # cross-ref report only
 *   node scripts/import-jung-library.mjs --import        # cross-ref + import new
 *   node scripts/import-jung-library.mjs --import --dry-run
 *   node scripts/import-jung-library.mjs --set=alch      # alchemy/magic/kabbala subset (289)
 *   node scripts/import-jung-library.mjs --import --limit=10
 *   node scripts/import-jung-library.mjs --backfill-category   # tag existing books in the set
 *
 * Outputs (timestamped):
 *   .claude/docs/jung-library-crossref-YYYY-MM-DD.json
 *   .claude/docs/jung-library-crossref-YYYY-MM-DD.md
 */

import { MongoClient } from 'mongodb';
import * as fs from 'node:fs';
import * as path from 'node:path';

// ── CLI args ─────────────────────────────────────────────────────────────
const args = Object.fromEntries(
  process.argv.slice(2)
    .filter(a => a.startsWith('--'))
    .map(a => {
      const [key, val] = a.slice(2).split('=');
      return [key, val ?? true];
    })
);
const DO_IMPORT = 'import' in args;
const DO_BACKFILL = 'backfill-category' in args;
const DRY_RUN = 'dry-run' in args;
const OAI_SET = args.set || 'cgj';
const LIMIT = parseInt(args.limit) || Infinity;
const IMPORT_DELAY_MS = parseInt(args.delay) || 3000;
const OAI_BASE = 'https://www.e-rara.ch/oai';
const CONTRIBUTING_LIBRARY = 'Stiftung der Werke von C.G. Jung (Zürich)';
const CATEGORY_TAG = 'C.G. Jung Personal Library';

const MONGODB_URI = process.env.MONGODB_URI;
const CRON_SECRET = process.env.CRON_SECRET;
const API_URL = process.env.NEXT_PUBLIC_URL || 'https://sourcelibrary.org';

if (!MONGODB_URI) {
  console.error('MONGODB_URI required. Source .env.production.local first.');
  process.exit(1);
}
if (DO_IMPORT && !DRY_RUN && !CRON_SECRET) {
  console.error('CRON_SECRET required for --import. Source .env.production.local first.');
  process.exit(1);
}

const sleep = ms => new Promise(r => setTimeout(r, ms));

// ── OAI-PMH harvest ──────────────────────────────────────────────────────

function parseRecords(xml) {
  const records = [];
  const recordRegex = /<record>([\s\S]*?)<\/record>/g;
  let m;
  while ((m = recordRegex.exec(xml)) !== null) {
    const r = m[1];
    if (r.includes('status="deleted"')) continue;
    const idMatch = r.match(/<identifier>oai:www\.e-rara\.ch:(\d+)<\/identifier>/);
    if (!idMatch) continue;
    const id = idMatch[1];
    const get = (tag) => {
      const x = r.match(new RegExp(`<dc:${tag}>([^<]*)<\\/dc:${tag}>`));
      return x ? x[1].trim() : null;
    };
    const getAll = (tag) => {
      const out = [];
      const re = new RegExp(`<dc:${tag}>([^<]*)<\\/dc:${tag}>`, 'g');
      let mm;
      while ((mm = re.exec(r)) !== null) out.push(mm[1].trim());
      return out;
    };
    const date = get('date');
    const yearMatch = date && date.match(/(\d{4})/);
    const year = yearMatch ? parseInt(yearMatch[1]) : null;
    records.push({
      erara_id: id,
      title: get('title') || 'Unknown',
      author: get('creator') || 'Unknown',
      date,
      year,
      language: getAll('language')[0] || null,
      rights: get('rights'),
      source_url: `https://www.e-rara.ch/content/titleinfo/${id}`,
      manifest_url: `https://www.e-rara.ch/i3f/v21/${id}/manifest`,
    });
  }
  const tokenMatch = xml.match(/<resumptionToken[^>]*>([^<]*)<\/resumptionToken>/);
  const sizeMatch = xml.match(/completeListSize="(\d+)"/);
  return {
    records,
    resumptionToken: tokenMatch?.[1]?.trim() || null,
    totalSize: sizeMatch ? parseInt(sizeMatch[1]) : null,
  };
}

async function harvestSet(setSpec) {
  console.log(`\n=== Harvesting OAI set "${setSpec}" ===`);
  let url = `${OAI_BASE}?verb=ListRecords&metadataPrefix=oai_dc&set=${setSpec}`;
  const all = [];
  let totalSize = null;
  let page = 0;
  while (url) {
    page++;
    const res = await fetch(url, {
      headers: { 'User-Agent': 'SourceLibrary/1.0 (Jung Library crossref; team@sourcelibrary.org)' },
      signal: AbortSignal.timeout(60000),
    });
    if (!res.ok) {
      console.error(`OAI request failed (page ${page}): ${res.status}`);
      await sleep(5000);
      continue;
    }
    const xml = await res.text();
    if (xml.includes('<error code="')) {
      const e = xml.match(/<error code="([^"]+)">([^<]*)<\/error>/);
      console.error(`OAI error: ${e?.[1]} — ${e?.[2]}`);
      break;
    }
    const { records, resumptionToken, totalSize: ts } = parseRecords(xml);
    if (ts && !totalSize) {
      totalSize = ts;
      console.log(`Total records in set: ${totalSize}`);
    }
    all.push(...records);
    console.log(`  Page ${page}: +${records.length} records (running total: ${all.length}${totalSize ? `/${totalSize}` : ''})`);
    url = resumptionToken
      ? `${OAI_BASE}?verb=ListRecords&resumptionToken=${encodeURIComponent(resumptionToken)}`
      : null;
    if (all.length >= LIMIT) {
      console.log(`  Hit --limit=${LIMIT}, stopping harvest`);
      break;
    }
    await sleep(1000);
  }
  return all;
}

// ── Dedup helpers (mirror src/lib/dedup.ts shape) ────────────────────────

function normalizeForDedup(str) {
  return (str || '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/^(the|a|an|der|die|das|de|le|la|les|il|lo|gli|i|el|los|las)\s+/i, '')
    .replace(/[^\w\s]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

// ── Cross-ref against existing books ─────────────────────────────────────

async function crossRef(db, candidates) {
  console.log(`\n=== Cross-referencing ${candidates.length} candidates against books collection ===`);

  // Pull all existing e-rara books by erara_id
  const eraraIds = candidates.map(c => c.erara_id);
  const byEraraId = await db.collection('books')
    .find(
      { erara_id: { $in: eraraIds } },
      { projection: { id: 1, _id: 1, erara_id: 1, title: 1, author: 1, image_source: 1, hidden: 1, visible: 1 } }
    )
    .toArray();
  const eraraIdMap = new Map(byEraraId.map(b => [b.erara_id, b]));
  console.log(`  ${byEraraId.length} candidates already have books by erara_id`);

  // For remaining, build a normalized-title index from books
  const remaining = candidates.filter(c => !eraraIdMap.has(c.erara_id));
  console.log(`  Checking ${remaining.length} remaining by normalized title/author...`);

  const existing = await db.collection('books')
    .find(
      { normalized_title: { $exists: true } },
      { projection: { id: 1, _id: 1, title: 1, author: 1, normalized_title: 1, normalized_author: 1, image_source: 1 } }
    )
    .toArray();
  const titleAuthorMap = new Map();
  for (const b of existing) {
    if (b.normalized_title && b.normalized_title.length >= 5) {
      const key = `${b.normalized_title}|||${b.normalized_author || ''}`;
      if (!titleAuthorMap.has(key)) titleAuthorMap.set(key, b);
    }
  }
  console.log(`  Indexed ${titleAuthorMap.size} title/author keys`);

  const results = candidates.map(c => {
    const byId = eraraIdMap.get(c.erara_id);
    if (byId) {
      return {
        ...c,
        match_type: 'erara_id',
        existing_book_id: byId.id || byId._id?.toString(),
        existing_title: byId.title,
        existing_visible: !byId.hidden && byId.visible !== false,
      };
    }
    const normT = normalizeForDedup(c.title);
    const normA = normalizeForDedup(c.author);
    if (normT.length >= 5) {
      const m = titleAuthorMap.get(`${normT}|||${normA}`);
      if (m) {
        return {
          ...c,
          match_type: 'title_author',
          existing_book_id: m.id || m._id?.toString(),
          existing_title: m.title,
          existing_provider: m.image_source?.provider,
        };
      }
    }
    return { ...c, match_type: 'new' };
  });

  return results;
}

// ── Write reports ────────────────────────────────────────────────────────

function summarize(results) {
  const total = results.length;
  const byEraraId = results.filter(r => r.match_type === 'erara_id').length;
  const byTitleAuthor = results.filter(r => r.match_type === 'title_author').length;
  const newCount = results.filter(r => r.match_type === 'new').length;
  return { total, byEraraId, byTitleAuthor, newCount };
}

function writeReports(results, summary) {
  const today = new Date().toISOString().slice(0, 10);
  const baseDir = path.join(process.cwd(), '.claude/docs');
  fs.mkdirSync(baseDir, { recursive: true });

  const jsonPath = path.join(baseDir, `jung-library-crossref-${today}.json`);
  fs.writeFileSync(jsonPath, JSON.stringify({
    generated_at: new Date().toISOString(),
    oai_set: OAI_SET,
    contributing_library: CONTRIBUTING_LIBRARY,
    summary,
    records: results,
  }, null, 2));
  console.log(`\nWrote ${jsonPath}`);

  const mdPath = path.join(baseDir, `jung-library-crossref-${today}.md`);
  const lines = [];
  lines.push(`# C.G. Jung Library — e-rara cross-reference (${today})`);
  lines.push('');
  lines.push(`Source: e-rara OAI-PMH set \`${OAI_SET}\` → ${CONTRIBUTING_LIBRARY}`);
  lines.push('');
  lines.push(`## Summary`);
  lines.push('');
  lines.push(`- Total records harvested: **${summary.total}**`);
  lines.push(`- Already in our database (erara_id match): **${summary.byEraraId}**`);
  lines.push(`- Already in our database (title/author match, different source): **${summary.byTitleAuthor}**`);
  lines.push(`- New to our library: **${summary.newCount}**`);
  lines.push('');

  const newOnes = results.filter(r => r.match_type === 'new').sort((a, b) => (a.year || 9999) - (b.year || 9999));
  if (newOnes.length) {
    lines.push(`## New books (${newOnes.length}) — would import on \`--import\``);
    lines.push('');
    lines.push('| Year | Author | Title | e-rara |');
    lines.push('|---|---|---|---|');
    for (const r of newOnes) {
      const t = (r.title || '').slice(0, 80).replace(/\|/g, '\\|');
      const a = (r.author || '').slice(0, 40).replace(/\|/g, '\\|');
      lines.push(`| ${r.year || '–'} | ${a} | ${t} | [${r.erara_id}](${r.source_url}) |`);
    }
    lines.push('');
  }

  const titleAuthorMatches = results.filter(r => r.match_type === 'title_author');
  if (titleAuthorMatches.length) {
    lines.push(`## Title/author overlap (${titleAuthorMatches.length}) — physical/conceptual matches in other libraries`);
    lines.push('');
    lines.push('| Year | Author | Jung title | Existing book |');
    lines.push('|---|---|---|---|');
    for (const r of titleAuthorMatches) {
      const t = (r.title || '').slice(0, 60).replace(/\|/g, '\\|');
      const a = (r.author || '').slice(0, 30).replace(/\|/g, '\\|');
      const e = (r.existing_title || '').slice(0, 60).replace(/\|/g, '\\|');
      lines.push(`| ${r.year || '–'} | ${a} | ${t} | [${e}](https://sourcelibrary.org/book/${r.existing_book_id}) (${r.existing_provider || '?'}) |`);
    }
    lines.push('');
  }

  const eraraDupes = results.filter(r => r.match_type === 'erara_id');
  if (eraraDupes.length) {
    lines.push(`## Already imported (${eraraDupes.length}) — e-rara IDs already in our DB`);
    lines.push('');
    lines.push('| Title | Existing book |');
    lines.push('|---|---|');
    for (const r of eraraDupes.slice(0, 50)) {
      const t = (r.title || '').slice(0, 60).replace(/\|/g, '\\|');
      lines.push(`| ${t} | [${r.existing_book_id}](https://sourcelibrary.org/book/${r.existing_book_id}) |`);
    }
    if (eraraDupes.length > 50) lines.push(`| _...and ${eraraDupes.length - 50} more_ | |`);
    lines.push('');
  }

  fs.writeFileSync(mdPath, lines.join('\n'));
  console.log(`Wrote ${mdPath}`);
  return { jsonPath, mdPath };
}

// ── Import via /api/import/e-rara ────────────────────────────────────────

async function importOne(candidate) {
  if (DRY_RUN) {
    return { status: 'dry_run', candidate };
  }
  try {
    const res = await fetch(`${API_URL}/api/import/e-rara`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${CRON_SECRET}`,
      },
      body: JSON.stringify({
        erara_id: candidate.erara_id,
        categories: [CATEGORY_TAG],
      }),
      signal: AbortSignal.timeout(120000),
    });
    const body = await res.json().catch(() => ({}));
    if (res.ok && body.success) {
      return { status: 'imported', bookId: body.bookId, pages: body.pagesCreated, candidate };
    }
    if (res.status === 409) {
      return { status: 'duplicate', existingId: body.existingId, error: body.error, candidate };
    }
    return { status: 'failed', httpStatus: res.status, error: body.error || body.details || `HTTP ${res.status}`, candidate };
  } catch (err) {
    return { status: 'failed', error: err.message, candidate };
  }
}

async function runImport(newRecords) {
  console.log(`\n=== Importing ${newRecords.length} new records ===`);
  if (DRY_RUN) console.log('(DRY RUN — no API calls)');

  const out = { imported: 0, duplicate: 0, failed: 0, results: [] };
  for (let i = 0; i < newRecords.length; i++) {
    const c = newRecords[i];
    const result = await importOne(c);
    out.results.push(result);

    const label = `${c.year || '?'} ${(c.author || '?').slice(0, 25)} — ${(c.title || '').slice(0, 50)}`;
    if (result.status === 'imported') {
      out.imported++;
      console.log(`  [${i + 1}/${newRecords.length}] ✓ imported (${result.pages}p) — ${label}`);
    } else if (result.status === 'duplicate') {
      out.duplicate++;
      console.log(`  [${i + 1}/${newRecords.length}] ↻ duplicate (${result.existingId}) — ${label}`);
    } else if (result.status === 'dry_run') {
      console.log(`  [${i + 1}/${newRecords.length}] [DRY] would import — ${label}`);
    } else {
      out.failed++;
      console.log(`  [${i + 1}/${newRecords.length}] ✗ ${result.error?.slice(0, 80)} — ${label}`);
    }

    if (!DRY_RUN && i < newRecords.length - 1) {
      await sleep(IMPORT_DELAY_MS);
    }
  }
  return out;
}

// ── Category backfill: tag existing books in the set ────────────────────

const CONTRIBUTING_LIBRARY_VARIANTS = [
  'Stiftung der Werke von C.G.Jung',           // no space — needs normalization
  'Stiftung der Werke von C.G. Jung',          // missing (Zürich) — canonical adds it
  'e-rara (Swiss libraries)',                  // generic pre-enrichment label
];

async function backfillCategory(db, records) {
  const eraraIds = records.map(r => r.erara_id);
  const existing = await db.collection('books').find(
    { erara_id: { $in: eraraIds } },
    { projection: { id: 1, erara_id: 1, categories: 1, 'image_source.contributing_library': 1 } }
  ).toArray();

  console.log(`\n=== Category backfill ===`);
  console.log(`  Looking at ${existing.length} books already in DB`);

  const needsCategory = existing.filter(b =>
    !Array.isArray(b.categories) || !b.categories.includes(CATEGORY_TAG)
  );
  // Every Jung Küsnacht book should carry the canonical Stiftung label.
  // Fix when missing entirely, or when it's one of the known variants we
  // want to normalize away from.
  const needsLibFix = existing.filter(b => {
    const cl = b.image_source?.contributing_library;
    if (!cl) return true;                                  // null/missing
    if (cl === CONTRIBUTING_LIBRARY) return false;         // already canonical
    return CONTRIBUTING_LIBRARY_VARIANTS.some(v => cl === v || cl.startsWith(v));
  });

  console.log(`  Need category tag: ${needsCategory.length}`);
  console.log(`  Need contributing_library normalization: ${needsLibFix.length}`);

  if (DRY_RUN) {
    console.log('\n(DRY RUN — no writes)');
    return { needsCategory: needsCategory.length, needsLibFix: needsLibFix.length, dryRun: true };
  }

  if (needsCategory.length === 0 && needsLibFix.length === 0) {
    console.log('  Nothing to update.');
    return { categoryUpdated: 0, libUpdated: 0 };
  }

  const ops = [];
  for (const b of needsCategory) {
    ops.push({
      updateOne: {
        filter: { id: b.id },
        update: { $addToSet: { categories: CATEGORY_TAG }, $set: { updated_at: new Date() } },
      },
    });
  }
  for (const b of needsLibFix) {
    ops.push({
      updateOne: {
        filter: { id: b.id },
        update: { $set: { 'image_source.contributing_library': CONTRIBUTING_LIBRARY, updated_at: new Date() } },
      },
    });
  }

  const result = await db.collection('books').bulkWrite(ops, { ordered: false });
  console.log(`  bulkWrite: matched=${result.matchedCount}, modified=${result.modifiedCount}`);
  return { categoryUpdated: needsCategory.length, libUpdated: needsLibFix.length, modified: result.modifiedCount };
}

// ── Main ─────────────────────────────────────────────────────────────────

async function main() {
  const t0 = Date.now();
  console.log(`Jung Library — set=${OAI_SET}, import=${DO_IMPORT}, backfill=${DO_BACKFILL}, dry-run=${DRY_RUN}, limit=${LIMIT === Infinity ? '∞' : LIMIT}`);

  const records = await harvestSet(OAI_SET);
  if (records.length === 0) {
    console.error('No records harvested. Exiting.');
    process.exit(1);
  }

  const client = new MongoClient(MONGODB_URI, { maxPoolSize: 2, serverSelectionTimeoutMS: 10000 });
  await client.connect();
  const db = client.db('bookstore');

  try {
    const results = await crossRef(db, records);
    const summary = summarize(results);

    console.log(`\n=== Cross-ref summary ===`);
    console.log(`  Total harvested: ${summary.total}`);
    console.log(`  Already in DB (erara_id): ${summary.byEraraId}`);
    console.log(`  Title/author overlap: ${summary.byTitleAuthor}`);
    console.log(`  New: ${summary.newCount}`);

    writeReports(results, summary);

    if (DO_BACKFILL) {
      await backfillCategory(db, records);
    }

    if (DO_IMPORT) {
      const newRecords = results.filter(r => r.match_type === 'new');
      if (newRecords.length === 0) {
        console.log('\nNothing new to import.');
      } else {
        const importStats = await runImport(newRecords);
        console.log(`\n=== Import complete ===`);
        console.log(`  Imported: ${importStats.imported}`);
        console.log(`  Duplicates (caught by /api): ${importStats.duplicate}`);
        console.log(`  Failed: ${importStats.failed}`);

        const today = new Date().toISOString().slice(0, 10);
        const importLogPath = path.join(process.cwd(), '.claude/docs', `jung-library-import-${today}.json`);
        fs.writeFileSync(importLogPath, JSON.stringify(importStats, null, 2));
        console.log(`Wrote ${importLogPath}`);
      }
    } else if (!DO_BACKFILL) {
      console.log(`\nReport-only mode. Re-run with --import (create new records) or --backfill-category (tag existing).`);
    }
  } finally {
    await client.close();
  }

  const mins = ((Date.now() - t0) / 60000).toFixed(1);
  console.log(`\nDone in ${mins} min.`);
}

main().catch(err => {
  console.error('Fatal:', err);
  process.exit(1);
});
