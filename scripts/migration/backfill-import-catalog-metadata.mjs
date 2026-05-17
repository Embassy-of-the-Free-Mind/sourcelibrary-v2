#!/usr/bin/env node
/**
 * Backfill catalog_metadata + DC cross-refs on books imported BEFORE the
 * richer-imports change (PR #1794). For each IA-sourced and IIIF-sourced book
 * that lacks catalog_metadata, re-fetch the source metadata and PATCH the
 * derived fields onto the Mongo doc.
 *
 * ADDITIVE ONLY — never overwrites fields that may have been improved by AI
 * enrichment post-import (publisher, place_published, description, etc.).
 * Specifically:
 *   - catalog_metadata: always set (new field)
 *   - publisher: only if currently null/empty
 *   - place_published: only if currently null/empty
 *   - dublin_core.dc_publisher: only if missing
 *   - dublin_core.dc_subject: only if missing AND we have subjects
 *   - dublin_core.dc_identifier: APPEND ARK/OCLC/LCCN/DOI/persistent_id only
 *     if those identifiers aren't already in the array
 *
 * Usage:
 *   set -a; source .env.production.local; set +a
 *   node scripts/migration/backfill-import-catalog-metadata.mjs --dry-run
 *   node scripts/migration/backfill-import-catalog-metadata.mjs --provider internet_archive --limit 20
 *   node scripts/migration/backfill-import-catalog-metadata.mjs --apply
 *   node scripts/migration/backfill-import-catalog-metadata.mjs --apply --provider gallica
 *   node scripts/migration/backfill-import-catalog-metadata.mjs --apply --provider google_books
 *
 * Flags:
 *   --dry-run        Default. No writes.
 *   --apply          Write PATCHes.
 *   --provider P     Restrict to one image_source.provider value.
 *   --limit N        Cap the number of books processed.
 *   --start-from N   Skip the first N candidates (for resuming).
 *   --rate R         Requests per second (default 2 — polite to Gallica).
 */

import { MongoClient } from 'mongodb';

const args = process.argv.slice(2);
const DRY_RUN = !args.includes('--apply');
function flagVal(name, def) {
  const i = args.indexOf(name);
  if (i < 0 || i + 1 >= args.length) return def;
  const v = args[i + 1];
  if (v?.startsWith('--')) return def;
  return v;
}
const PROVIDER = flagVal('--provider', null);
const LIMIT = parseInt(flagVal('--limit', '0'), 10) || Infinity;
const SKIP = parseInt(flagVal('--start-from', '0'), 10) || 0;
const RATE = parseFloat(flagVal('--rate', '2')) || 2;

const MONGODB_URI = process.env.MONGODB_URI;
if (!MONGODB_URI) { console.error('MONGODB_URI missing'); process.exit(1); }

// ── Extraction helpers — match the production import routes exactly ───

const stripText = (s) => String(s || '').replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim();
const firstOf = (v) => {
  const raw = Array.isArray(v) ? (typeof v[0] === 'string' ? v[0] : null) : (typeof v === 'string' ? v : null);
  return raw ? stripText(raw) || null : null;
};
const arrOf = (v) => {
  const raw = Array.isArray(v) ? v.filter(x => typeof x === 'string') : (typeof v === 'string' ? [v] : []);
  return raw.map(stripText).filter(Boolean);
};

function extractIaCatalog(ia_identifier, metadata) {
  const m = metadata.metadata || {};
  const catalog = {
    source: 'internet_archive',
    identifier: ia_identifier,
    ark: m['identifier-ark'] || null,
    mediatype: m.mediatype || null,
    collections: arrOf(m.collection),
    access_restricted: m['access-restricted-item'] === 'true' || m['access-restricted-item'] === true,
    publisher: firstOf(m.publisher),
    place: firstOf(m.publishplace) || firstOf(m.place),
    creator: firstOf(m.creator),
    edition: firstOf(m.edition),
    volume: firstOf(m.volume),
    description: firstOf(m.description),
    subjects: arrOf(m.subject),
    notes: arrOf(m.notes),
    isbn: arrOf(m.isbn),
    oclc_id: firstOf(m['oclc-id']),
    lccn: firstOf(m.lccn),
    openlibrary_work: firstOf(m.openlibrary_work),
    openlibrary_edition: firstOf(m.openlibrary_edition),
    external_identifiers: arrOf(m['external-identifier']),
    page_progression: firstOf(m['page-progression']),
    ppi: m.ppi ? parseInt(String(m.ppi), 10) : null,
    imagecount: m.imagecount ? parseInt(String(m.imagecount), 10) : null,
    ocr_detected_lang: firstOf(m.ocr_detected_lang),
    ocr_detected_script: firstOf(m.ocr_detected_script),
    date_iso: firstOf(m.date),
    public_date: firstOf(m.publicdate),
    scan_date: firstOf(m.scandate),
    scanning_center: firstOf(m.scanningcenter),
    scanner: firstOf(m.scanner),
    scraped_at: new Date().toISOString(),
  };
  for (const k of Object.keys(catalog)) {
    const v = catalog[k];
    if (v === null || v === undefined || (Array.isArray(v) && v.length === 0)) delete catalog[k];
  }
  return catalog;
}

function flattenIiifValue(v) {
  if (typeof v === 'string') return stripText(v);
  if (Array.isArray(v)) return v.map(flattenIiifValue).filter(Boolean).join(' / ');
  if (v && typeof v === 'object') {
    const en = v['en'] || v['none'] || Object.values(v)[0];
    if (Array.isArray(en)) return en.map(flattenIiifValue).filter(Boolean).join(' / ');
    if (typeof en === 'string') return stripText(en);
  }
  return '';
}

function extractIiifCatalog(manifest, manifest_url) {
  const v3 = manifest.type === 'Manifest' || (manifest['@context'] && String(manifest['@context']).includes('/3/'));
  const iiifMetadata = [];
  for (const item of (manifest.metadata || [])) {
    const label = flattenIiifValue(item.label);
    const value = flattenIiifValue(item.value);
    if (label && value) iiifMetadata.push({ label, value });
  }
  const labelGet = (...needles) => {
    for (const n of needles) {
      const hit = iiifMetadata.find(m => m.label.toLowerCase().includes(n.toLowerCase()));
      if (hit) return hit.value;
    }
    return null;
  };
  const description = v3
    ? flattenIiifValue(manifest.summary)
    : (manifest.description ? flattenIiifValue(manifest.description) : '');
  const seeAlso = [];
  for (const ref of (Array.isArray(manifest.seeAlso) ? manifest.seeAlso : manifest.seeAlso ? [manifest.seeAlso] : [])) {
    const id = ref?.id || ref?.['@id'] || ref;
    if (typeof id === 'string') seeAlso.push(id);
  }
  const catalog = {
    source: 'iiif',
    manifest_url,
    manifest_version: v3 ? 'v3' : 'v2',
    publisher: labelGet('publisher'),
    place: labelGet('publication place', 'place of publication'),
    publication_date: labelGet('publication date', 'date issued', 'date'),
    creator: labelGet('creator', 'author'),
    call_number: labelGet('call number', 'shelfmark', 'shelf mark'),
    doi: labelGet('doi'),
    bibliographic_id: labelGet('bibliographic id', 'bibliographic identifier'),
    persistent_id: labelGet('persistent id', 'persistent identifier'),
    description: description || null,
    see_also: seeAlso,
    metadata_pairs: iiifMetadata,
    nav_date: manifest.navDate || null,
    viewing_direction: manifest.viewingDirection || null,
    scraped_at: new Date().toISOString(),
  };
  for (const k of Object.keys(catalog)) {
    const v = catalog[k];
    if (v === null || v === undefined || v === '' || (Array.isArray(v) && v.length === 0)) delete catalog[k];
  }
  return catalog;
}

// ── Build the additive-only update doc ────────────────────────────────

function buildUpdate(book, catalog) {
  const set = { catalog_metadata: catalog, updated_at: new Date() };

  // Top-level publisher / place_published: only if currently empty
  if (catalog.publisher && (!book.publisher || !String(book.publisher).trim())) {
    set.publisher = String(catalog.publisher);
  }
  if (catalog.place && (!book.place_published || !String(book.place_published).trim())) {
    set.place_published = String(catalog.place);
  }

  // dublin_core augmentation
  const dc = { ...(book.dublin_core || {}) };
  let dcChanged = false;
  if (catalog.publisher && !dc.dc_publisher) {
    dc.dc_publisher = String(catalog.publisher);
    dcChanged = true;
  }
  if (Array.isArray(catalog.subjects) && catalog.subjects.length && !dc.dc_subject) {
    dc.dc_subject = catalog.subjects;
    dcChanged = true;
  }
  // dc_description: only set if missing (AI enrichment often produces better
  // descriptions; don't clobber).
  if (catalog.description && !dc.dc_description) {
    dc.dc_description = String(catalog.description);
    dcChanged = true;
  }
  // Append cross-ref identifiers to dc_identifier if not already present.
  const existingIds = new Set(Array.isArray(dc.dc_identifier) ? dc.dc_identifier : dc.dc_identifier ? [dc.dc_identifier] : []);
  const newIds = [];
  if (catalog.ark) newIds.push(String(catalog.ark));
  if (catalog.oclc_id) newIds.push(`OCLC:${catalog.oclc_id}`);
  if (catalog.lccn) newIds.push(`LCCN:${catalog.lccn}`);
  if (catalog.doi) newIds.push(`DOI:${catalog.doi}`);
  if (catalog.persistent_id) newIds.push(String(catalog.persistent_id));
  if (catalog.bibliographic_id) newIds.push(`BIB:${catalog.bibliographic_id}`);
  let appendedIds = 0;
  for (const id of newIds) {
    if (!existingIds.has(id)) {
      existingIds.add(id);
      appendedIds++;
    }
  }
  if (appendedIds > 0) {
    dc.dc_identifier = [...existingIds];
    dcChanged = true;
  }
  if (dcChanged) set.dublin_core = dc;

  return set;
}

// ── Source fetchers ──────────────────────────────────────────────────

async function fetchIaMetadata(identifier) {
  const r = await fetch(`https://archive.org/metadata/${encodeURIComponent(identifier)}`, {
    signal: AbortSignal.timeout(20_000),
  });
  if (!r.ok) throw new Error(`IA ${identifier}: ${r.status}`);
  return r.json();
}

async function fetchIiifManifest(url) {
  const r = await fetch(url, { signal: AbortSignal.timeout(30_000) });
  if (!r.ok) throw new Error(`IIIF ${url}: ${r.status}`);
  return r.json();
}

/**
 * Construct a Gallica IIIF manifest URL from a bare ARK identifier.
 * Gallica ARKs may be bare (bpt6k58348r) or full (ark:/12148/bpt6k58348r).
 * Returns null if we can't construct a plausible URL.
 */
function gallicaArkToManifestUrl(identifier) {
  if (!identifier) return null;
  // Strip any leading "ark:/12148/" if present
  const bare = identifier.replace(/^ark:\/12148\//, '').trim();
  if (!bare) return null;
  return `https://gallica.bnf.fr/iiif/ark:/12148/${bare}/manifest.json`;
}

// ── Rate limiter ─────────────────────────────────────────────────────

let lastFetchAt = 0;
async function rateLimit() {
  const minGapMs = 1000 / RATE;
  const wait = lastFetchAt + minGapMs - Date.now();
  if (wait > 0) await new Promise(r => setTimeout(r, wait));
  lastFetchAt = Date.now();
}

// ── Main ─────────────────────────────────────────────────────────────

async function main() {
  console.log(`=== Backfill import catalog_metadata ===`);
  console.log(`Mode      : ${DRY_RUN ? 'DRY RUN' : 'APPLY'}`);
  console.log(`Provider  : ${PROVIDER || '(all IA + IIIF + google_books)'}`);
  console.log(`Limit     : ${LIMIT === Infinity ? '(none)' : LIMIT}`);
  console.log(`Rate      : ${RATE} req/s\n`);

  const mongo = new MongoClient(MONGODB_URI);
  await mongo.connect();
  const db = mongo.db('bookstore');

  const IIIF_PROVIDERS = ['bodleian','vatican','gallica','allard_pierson','cambridge','laurenziana','e-rara','e-codices','mdz','wellcome','iiif','manchester','google_books'];
  const providers = PROVIDER ? [PROVIDER] : ['internet_archive', ...IIIF_PROVIDERS];

  const candidates = await db.collection('books').find(
    {
      'image_source.provider': { $in: providers },
      catalog_metadata: { $exists: false },
    },
    { projection: { id: 1, _id: 1, title: 1, ia_identifier: 1, publisher: 1, place_published: 1, dublin_core: 1, image_source: 1 } },
  ).toArray();
  console.log(`Candidates: ${candidates.length}`);
  if (SKIP) console.log(`Skipping first ${SKIP}`);

  const todo = candidates.slice(SKIP, LIMIT === Infinity ? undefined : SKIP + LIMIT);
  console.log(`Processing: ${todo.length}\n`);

  const stats = { ok: 0, skip_no_id: 0, skip_no_manifest: 0, ark_constructed: 0, ia_mirror_used: 0, fetch_err: 0, fetch_429: 0, no_change: 0, dry: 0 };
  const errSamples = [];
  let i = 0;
  for (const book of todo) {
    i++;
    const provider = book.image_source?.provider;
    try {
      let catalog;

      if (provider === 'internet_archive') {
        // Standard IA fetch
        const id = book.ia_identifier || book.image_source?.identifier;
        if (!id) { stats.skip_no_id++; continue; }
        await rateLimit();
        const meta = await fetchIaMetadata(id);
        catalog = extractIaCatalog(id, meta);

      } else if (provider === 'google_books') {
        // Google Books books are mirrored on IA as bub_gb_* — use the IA
        // metadata API with the ia_identifier stored on the book.
        const id = book.ia_identifier || book.image_source?.ia_identifier || book.image_source?.identifier;
        if (!id) { stats.skip_no_id++; continue; }
        await rateLimit();
        const meta = await fetchIaMetadata(id);
        catalog = extractIaCatalog(id, meta);
        // Tag the catalog so we know which route was used.
        catalog.source = 'google_books_via_ia';
        stats.ia_mirror_used++;

      } else {
        // IIIF provider (includes gallica, vatican, bodleian, mdz, etc.)
        let manifest_url = book.image_source?.iiif_manifest;

        // Gallica ARK fallback: construct manifest URL from bare identifier
        if (!manifest_url && provider === 'gallica') {
          const identifier = book.image_source?.identifier;
          manifest_url = gallicaArkToManifestUrl(identifier);
          if (manifest_url) {
            stats.ark_constructed++;
            if (i <= 20 || i % 100 === 0) {
              console.log(`[${i}] ARK→manifest: ${manifest_url}`);
            }
          }
        }

        if (!manifest_url) { stats.skip_no_manifest++; continue; }

        await rateLimit();
        const manifest = await fetchIiifManifest(manifest_url);
        catalog = extractIiifCatalog(manifest, manifest_url);
      }

      const set = buildUpdate(book, catalog);
      // Trivially-empty catalog (no useful fields beyond source/identifier) is
      // still worth recording so we don't re-fetch on next run.
      if (DRY_RUN) {
        stats.dry++;
        if (i <= 5 || i % 200 === 0) {
          console.log(`[${i}/${todo.length}] ${provider} ${book.id} would set: ${Object.keys(set).filter(k => k !== 'updated_at').join(', ')}`);
        }
      } else {
        await db.collection('books').updateOne({ _id: book._id }, { $set: set });
        stats.ok++;
        if (i % 100 === 0) console.log(`[${i}/${todo.length}] ok=${stats.ok} errs=${stats.fetch_err} 429s=${stats.fetch_429}`);
      }
    } catch (e) {
      if (e.message && e.message.includes(': 429')) {
        stats.fetch_429++;
        if (errSamples.length < 5) errSamples.push(`429: ${provider} ${book.id}: ${e.message}`);
      } else {
        stats.fetch_err++;
        if (errSamples.length < 10) errSamples.push(`${provider} ${book.id}: ${e.message}`);
      }
    }
  }

  console.log(`\n=== Done ===`);
  console.log(JSON.stringify(stats, null, 2));
  if (errSamples.length) {
    console.log(`\nFirst errors:`);
    errSamples.forEach(e => console.log(`  ${e}`));
  }
  await mongo.close();
}

main().catch(e => { console.error(e); process.exit(1); });
