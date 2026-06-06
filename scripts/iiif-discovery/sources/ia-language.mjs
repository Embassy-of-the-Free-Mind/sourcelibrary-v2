#!/usr/bin/env node
/**
 * Internet Archive Discovery Crawler — by language or collection
 *
 * IA is the largest IIIF corpus on the web: every text item has an
 * auto-generated IIIF manifest at https://iiif.archive.org/iiif/{id}/manifest.json,
 * so discovery is a pure metadata scrape — no manifest fetches needed.
 *
 * Uses the Scraping API (cursor-based, no deep-pagination cap, 10K rows/request):
 * https://archive.org/developers/scraping.html
 *
 * IMPORTANT: IA language metadata is freetext. Querying only the full language
 * name massively undercounts (e.g. language:sanskrit = 3,335 items but
 * language:(san OR sanskrit) = 93,390 — a 28x difference, measured 2026-06-06).
 * The presets below use code unions. See issue #2447.
 *
 * Usage:
 *   set -a; source .env.production.local; set +a
 *   node scripts/iiif-discovery/sources/ia-language.mjs --language=sanskrit
 *   node scripts/iiif-discovery/sources/ia-language.mjs --language=chinese
 *   node scripts/iiif-discovery/sources/ia-language.mjs --collection=digitallibraryindia
 *
 * Options:
 *   --language=xxx       Language preset: latin | chinese | sanskrit (uses code-union query)
 *   --collection=xxx     Sweep an IA collection instead (language often untagged)
 *   --query=xxx          Raw IA query override (advanced)
 *   --max-records=N      Stop after N records (default: unlimited)
 *   --cursor=xxx         Resume from a scrape cursor (printed every batch)
 *   --dry-run            Parse and report, but don't write to MongoDB
 */

import { withMongo } from '../../lib/mongo.mjs';
import { ensureIndexes, insertCandidates } from '../lib/candidate-store.mjs';
import { normalizeLanguage } from '../lib/iiif-metadata.mjs';

const SOURCE = 'ia_language';
const SCRAPE_BASE = 'https://archive.org/services/search/v1/scrape';
const PAGE_SIZE = 10000; // Scraping API max
const FIELDS = 'identifier,title,creator,language,year,date,imagecount,collection,access-restricted-item';

// Code unions per language — IA's language field is freetext, so we match
// ISO 639-2/B, 639-2/T, 639-1, and the English name.
const LANGUAGE_PRESETS = {
  latin: '(lat OR latin OR la)',
  chinese: '(chi OR zho OR zh OR cmn OR chinese)',
  sanskrit: '(san OR sanskrit OR sa)',
};

const args = Object.fromEntries(
  process.argv.slice(2)
    .filter(a => a.startsWith('--'))
    .map(a => {
      const [key, val] = a.slice(2).split('=');
      return [key, val ?? true];
    })
);

const MAX_RECORDS = parseInt(args['max-records']) || Infinity;
const DRY_RUN = 'dry-run' in args;
const LANGUAGE = args.language || null;
const COLLECTION = args.collection || null;
const QUERY_OVERRIDE = args.query || null;
let cursor = args.cursor || null;

const sleep = ms => new Promise(r => setTimeout(r, ms));

function buildQuery() {
  if (QUERY_OVERRIDE) return QUERY_OVERRIDE;
  if (COLLECTION) return `collection:${COLLECTION} AND mediatype:texts`;
  if (LANGUAGE) {
    const union = LANGUAGE_PRESETS[LANGUAGE.toLowerCase()];
    if (!union) {
      console.error(`Unknown language preset "${LANGUAGE}". Available: ${Object.keys(LANGUAGE_PRESETS).join(', ')}`);
      console.error('For other languages, pass a raw query: --query=\'language:(heb OR hebrew) AND mediatype:texts\'');
      process.exit(1);
    }
    return `language:${union} AND mediatype:texts`;
  }
  console.error('Provide --language=, --collection=, or --query=');
  process.exit(1);
}

/** IA fields can be a string or an array — normalize to first value + full list. */
function firstOf(value) {
  if (Array.isArray(value)) return value[0] ?? null;
  return value ?? null;
}
function listOf(value) {
  if (Array.isArray(value)) return value;
  return value != null ? [value] : [];
}

function toCandidate(item) {
  const id = item.identifier;
  const languages = listOf(item.language);
  const year = Number.isInteger(item.year) ? item.year : (parseInt(item.year) || null);

  return {
    manifest_url: `https://iiif.archive.org/iiif/${id}/manifest.json`,
    source: SOURCE,
    origin_library: 'Internet Archive',
    title: firstOf(item.title) || 'Unknown',
    author: firstOf(item.creator) || 'Unknown',
    language: normalizeLanguage(firstOf(item.language)),
    date_text: firstOf(item.date) || (year ? String(year) : null),
    date_earliest: year,
    date_latest: year,
    page_count: parseInt(item.imagecount) || null,
    categories: [],
    provider_name: 'Internet Archive',
    source_url: `https://archive.org/details/${id}`,
    source_id: id,
    metadata: {
      ia_identifier: id,
      languages,
      collections: listOf(item.collection),
      access_restricted: item['access-restricted-item'] === 'true' || item['access-restricted-item'] === true,
      discovery_query: LANGUAGE || COLLECTION || 'custom',
    },
  };
}

/**
 * The deployed manifest_url index is NON-unique (see candidate-store.mjs), so
 * insertCandidates can't rely on duplicate-key errors. Pre-filter against
 * existing rows so re-runs and overlapping sweeps (e.g. a DLI collection sweep
 * after a sanskrit language sweep) don't pile up duplicate rows.
 */
async function filterNew(db, candidates) {
  if (candidates.length === 0) return [];
  const urls = candidates.map(c => c.manifest_url);
  const existing = await db.collection('import_candidates')
    .find({ manifest_url: { $in: urls } })
    .project({ manifest_url: 1 })
    .toArray();
  const seen = new Set(existing.map(d => d.manifest_url));
  return candidates.filter(c => !seen.has(c.manifest_url));
}

await withMongo(async (db) => {
  await ensureIndexes(db);

  const query = buildQuery();

  console.log(`\n=== Internet Archive IIIF Discovery ===`);
  console.log(`Query: ${query}`);
  console.log(`Dry run: ${DRY_RUN}`);
  if (cursor) console.log(`Resuming from cursor: ${cursor.slice(0, 40)}…`);
  console.log('');

  let totalDiscovered = 0;
  let totalExisting = 0;
  let totalRestricted = 0;
  let batchNum = 0;
  let totalRecords = null;
  let consecutiveErrors = 0;

  while (totalDiscovered < MAX_RECORDS) {
    batchNum++;

    const params = new URLSearchParams({
      q: query,
      fields: FIELDS,
      count: String(Math.min(PAGE_SIZE, MAX_RECORDS)),
    });
    if (cursor) params.set('cursor', cursor);

    let data;
    try {
      const res = await fetch(`${SCRAPE_BASE}?${params}`, {
        headers: {
          'User-Agent': 'SourceLibrary/1.0 (https://sourcelibrary.org; scholarly digital library)',
        },
        signal: AbortSignal.timeout(120000),
      });

      if (!res.ok) {
        consecutiveErrors++;
        console.error(`Scrape request failed: ${res.status} (attempt ${consecutiveErrors})`);
        if (consecutiveErrors >= 5) {
          console.error(`Bailing after 5 consecutive errors. Resume with: --cursor=${cursor || '(start)'}`);
          break;
        }
        await sleep(15000 * consecutiveErrors);
        continue;
      }

      data = await res.json();
      consecutiveErrors = 0;
    } catch (err) {
      consecutiveErrors++;
      console.error(`Scrape request error: ${err.message} (attempt ${consecutiveErrors})`);
      if (consecutiveErrors >= 5) {
        console.error(`Bailing after 5 consecutive errors. Resume with: --cursor=${cursor || '(start)'}`);
        break;
      }
      await sleep(15000 * consecutiveErrors);
      continue;
    }

    if (totalRecords === null && data.total != null) {
      totalRecords = data.total;
      console.log(`Total matching records: ${totalRecords.toLocaleString()}\n`);
    }

    const items = data.items || [];
    // Log empty buckets too — silent gaps have bitten us before.
    if (items.length === 0) {
      console.log(`Batch ${batchNum}: 0 items returned — done.`);
      break;
    }

    const candidates = items.filter(i => i.identifier).map(toCandidate);
    totalRestricted += candidates.filter(c => c.metadata.access_restricted).length;

    if (DRY_RUN) {
      totalDiscovered += candidates.length;
      console.log(`Batch ${batchNum}: ${items.length} items (dry run) | Total: ${totalDiscovered.toLocaleString()}`);
    } else {
      const fresh = await filterNew(db, candidates);
      const { inserted } = await insertCandidates(db, fresh);
      totalDiscovered += inserted;
      totalExisting += candidates.length - inserted;
      const pct = totalRecords ? ` (${((totalDiscovered + totalExisting) / totalRecords * 100).toFixed(1)}%)` : '';
      console.log(`Batch ${batchNum}: ${items.length} items → ${inserted} new, ${candidates.length - inserted} existing${pct} | Total new: ${totalDiscovered.toLocaleString()}`);
    }

    cursor = data.cursor || null;
    if (cursor) {
      console.log(`  cursor: ${cursor}`);
    } else {
      console.log('No more pages.');
      break;
    }

    await sleep(3000); // be polite — ~1 request / 3s
  }

  console.log(`\n=== Done ===`);
  console.log(`Discovered: ${totalDiscovered.toLocaleString()} new candidates`);
  console.log(`Already known: ${totalExisting.toLocaleString()}`);
  console.log(`Access-restricted (lending — unarchivable, kept for census): ${totalRestricted.toLocaleString()}`);
  if (cursor && totalDiscovered >= MAX_RECORDS) {
    console.log(`Stopped at --max-records. Resume with: --cursor=${cursor}`);
  }
});
