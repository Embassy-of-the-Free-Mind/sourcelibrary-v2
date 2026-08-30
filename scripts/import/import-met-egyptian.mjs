#!/usr/bin/env node
/**
 * Import inscribed Egyptian objects from The Metropolitan Museum of Art API.
 * Writes directly to MongoDB, matching the direct-ia-import.mjs pattern.
 *
 * Usage:
 *   set -a; source .env.production.local; set +a; node scripts/import/import-met-egyptian.mjs
 *
 * Flags:
 *   --limit N              Max objects to import (default: 500)
 *   --classification X     Filter by single classification (e.g. "Stela")
 *   --dry-run              Print what would be imported without writing
 */
import { MongoClient, ObjectId } from 'mongodb';
import { makeBookDoc, makePageDoc } from '../lib/book-docs.mjs';

const MONGODB_URI = process.env.MONGODB_URI;
if (!MONGODB_URI) { console.error('MONGODB_URI not set'); process.exit(1); }

// ── CLI flags ──
const args = process.argv.slice(2);
function getFlag(name, defaultVal) {
  const idx = args.indexOf(`--${name}`);
  if (idx === -1) return defaultVal;
  return args[idx + 1] || defaultVal;
}
const LIMIT = parseInt(getFlag('limit', '500'), 10);
const CLASSIFICATION_FILTER = getFlag('classification', null);
const DRY_RUN = args.includes('--dry-run');

// ── Classification allowlist ──
const INSCRIBED_CLASSIFICATIONS = [
  'stela', 'papyrus', 'ostracon', 'relief', 'statue',
  'coffin', 'sarcophagus', 'scarab', 'amulet', 'temple',
];

// Textual artifacts (papyri, ostraca, inscribed stelae, cuneiform tablets) carry readable
// text and belong in the BOOK pipeline — like the Egyptian Book-of-the-Dead papyri.
// Everything else this importer touches (statue, relief, coffin, scarab, amulet, …) is a
// single-object ARTWORK. content_type is AUTHORITATIVE downstream — a 'book' is never
// reclassified as artwork (see pipeline-orchestrator ARTWORK_MATCH).
const TEXTUAL_TYPES = ['papyrus', 'ostracon', 'stela', 'cuneiform', 'tablet'];
function classifyContentType(obj) {
  const s = `${obj.objectName || ''} ${obj.classification || ''}`.toLowerCase();
  const t = TEXTUAL_TYPES.find(x => s.includes(x));
  return t ? { content_type: 'book', resource_type: t } : { content_type: 'artwork', resource_type: 'object' };
}

// ── Helpers ──
function slugify(text) {
  return text.toLowerCase().replace(/[^\w\s-]/g, '').replace(/[\s_]+/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '').slice(0, 80);
}

async function generateSlug(db, title) {
  const base = slugify(title);
  let slug = base;
  let i = 1;
  while (await db.collection('books').findOne({ slug }, { projection: { _id: 1 } })) {
    slug = `${base}-${i++}`;
  }
  return slug;
}

function normalizeTitle(t) { return (t || '').toLowerCase().replace(/[^\w\s]/g, '').replace(/\s+/g, ' ').trim(); }
function normalizeAuthor(a) { return (a || '').toLowerCase().replace(/[^\w\s]/g, '').replace(/\s+/g, ' ').trim(); }

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

/**
 * Map period/culture to language label.
 * Pharaonic periods → Egyptian hieroglyphs
 * Ptolemaic/Roman → Demotic (common administrative script)
 * Coptic period → Coptic
 */
function mapLanguage(obj) {
  const period = (obj.period || '').toLowerCase();
  const culture = (obj.culture || '').toLowerCase();

  if (culture.includes('coptic') || period.includes('coptic')) return 'Coptic';
  if (period.includes('ptolemaic') || period.includes('roman')) return 'Demotic';
  if (period.includes('byzantine') || period.includes('islamic') || period.includes('arab')) return 'Arabic';
  // Default for pharaonic Egypt
  return 'Egyptian hieroglyphs';
}

/**
 * Build a display title from Met object fields.
 * Prefers objectName (has subject names) over title (often just "Stela").
 * Appends dynasty/reign/date for disambiguation.
 */
function buildTitle(obj) {
  // objectName often has better info: "Stela, Ptah" vs just "Stela"
  let base = obj.objectName || obj.title || 'Egyptian Object';
  // If title has a proper name the objectName doesn't, prefer title
  if (obj.title && obj.title !== obj.objectName && obj.title.length > (obj.objectName || '').length) {
    base = obj.title;
  }
  // Add context: reign > dynasty > period > date
  const context = obj.reign || obj.dynasty || obj.period || obj.objectDate;
  if (context && !base.includes(context)) {
    base = `${base} (${context})`;
  }
  return base;
}

/**
 * Check if object matches our inscribed-object filter.
 * Met Egyptian Art uses objectName (not classification) for type info.
 */
function isInscribedObject(obj) {
  const name = (obj.objectName || '').toLowerCase();
  const cls = (obj.classification || '').toLowerCase();
  const combined = `${name} ${cls}`;
  if (CLASSIFICATION_FILTER) {
    return combined.includes(CLASSIFICATION_FILTER.toLowerCase());
  }
  return INSCRIBED_CLASSIFICATIONS.some(c => combined.includes(c));
}

/**
 * Fetch with retry (Met API can be flaky).
 */
async function fetchWithRetry(url, retries = 3) {
  for (let attempt = 0; attempt < retries; attempt++) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(30000) });
      if (res.status === 429) {
        console.warn(`  Rate limited, waiting 5s...`);
        await sleep(5000);
        continue;
      }
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.json();
    } catch (err) {
      if (attempt === retries - 1) throw err;
      await sleep(2000);
    }
  }
}

// ── Main ──
async function main() {
  console.log(`Met Egyptian Import — limit: ${LIMIT}, classification: ${CLASSIFICATION_FILTER || 'all inscribed'}, dry-run: ${DRY_RUN}`);

  // Step 1: Fetch Egyptian Art object IDs (departmentId=10)
  // Use classification filter as search term if set, otherwise search all
  const searchTerm = CLASSIFICATION_FILTER || '*';
  console.log(`Fetching Egyptian Art object IDs from Met API (search: "${searchTerm}")...`);
  const searchUrl = `https://collectionapi.metmuseum.org/public/collection/v1/search?departmentId=10&hasImages=true&isPublicDomain=true&q=${encodeURIComponent(searchTerm)}`;
  const searchResult = await fetchWithRetry(searchUrl);
  const allIds = searchResult.objectIDs || [];
  console.log(`Found ${allIds.length} public domain Egyptian Art objects with images`);

  if (allIds.length === 0) {
    console.log('No objects found. Exiting.');
    process.exit(0);
  }

  // Step 2: Connect to MongoDB
  const client = new MongoClient(MONGODB_URI, { serverSelectionTimeoutMS: 30000 });
  await client.connect();
  const db = client.db('bookstore');
  console.log('Connected to MongoDB');

  let imported = 0, skipped = 0, filtered = 0, errors = 0, dupes = 0;
  let totalPages = 0;
  const importedIds = [];
  let checked = 0;

  // Step 3: Iterate objects, fetch details, filter, and import
  for (const objectID of allIds) {
    if (imported >= LIMIT) break;
    checked++;

    // Rate limit: 1 req/sec
    await sleep(1000);

    let obj;
    try {
      obj = await fetchWithRetry(`https://collectionapi.metmuseum.org/public/collection/v1/objects/${objectID}`);
    } catch (err) {
      errors++;
      if (checked % 50 === 0) logProgress();
      continue;
    }

    // Filter: must have primary image
    if (!obj.primaryImage) {
      filtered++;
      if (checked % 50 === 0) logProgress();
      continue;
    }

    // Filter: must match inscribed classification
    if (!isInscribedObject(obj)) {
      filtered++;
      if (checked % 50 === 0) logProgress();
      continue;
    }

    const title = buildTitle(obj);
    const author = obj.culture || 'Egyptian';
    const normalizedT = normalizeTitle(title);

    // Dedup check
    try {
      const existing = await db.collection('books').findOne(
        { $or: [
          { normalized_title: normalizedT },
          { 'image_source.identifier': String(objectID), 'image_source.provider': 'met' },
        ]},
        { projection: { _id: 1, title: 1 }, maxTimeMS: 30000 }
      );
      if (existing) {
        dupes++;
        if (checked % 50 === 0) logProgress();
        continue;
      }
    } catch (err) {
      console.warn(`  Dedup check failed for ${objectID}: ${err.message}`);
      errors++;
      continue;
    }

    // Build image list: primary + additional
    const images = [obj.primaryImage];
    if (obj.additionalImages?.length) {
      images.push(...obj.additionalImages);
    }

    const language = mapLanguage(obj);
    const year = obj.objectBeginDate || null;
    const { content_type: contentType, resource_type: resourceType } = classifyContentType(obj);

    if (DRY_RUN) {
      console.log(`  [DRY] ${title} | ${obj.objectName || obj.classification} | ${contentType} | ${language} | ${year || '?'} | ${images.length} images`);
      imported++;
      if (checked % 50 === 0) logProgress();
      continue;
    }

    // Create book document
    try {
      const bookId = new ObjectId();
      const bookIdStr = bookId.toHexString();
      const slug = await generateSlug(db, title);

      const bookDoc = makeBookDoc({
        _id: bookId,
        id: bookIdStr,
        slug,
        title,
        author,
        language,
        original_language: language,
        published: year ? String(year) : 'Unknown',
        categories: [],
        collections: ['middle-east-africa', 'ancient-egyptian'],
        content_type: contentType,
        resource_type: resourceType,
        thumbnail: obj.primaryImageSmall || obj.primaryImage,
        pages_count: images.length,
        pages_ocr: 0,
        pages_translated: 0,
        dublin_core: {
          dc_identifier: [`met:${objectID}`],
          dc_source: obj.objectURL || `https://www.metmuseum.org/art/collection/search/${objectID}`,
        },
        image_source: {
          provider: 'met',
          provider_name: 'The Metropolitan Museum of Art',
          source_url: obj.objectURL || `https://www.metmuseum.org/art/collection/search/${objectID}`,
          identifier: String(objectID),
          license: 'CC0',
          contributing_library: obj.creditLine || 'The Metropolitan Museum of Art',
          access_date: new Date(),
        },
        field_provenance: {
          title: { source: 'met_api', method: 'import', confidence: 1.0, date: new Date() },
          author: { source: 'met_api', method: 'import', confidence: 0.9, date: new Date() },
          language: { source: 'met_api', method: 'heuristic', confidence: 0.7, date: new Date() },
        },
        status: 'draft',
        hidden: false,
        visible: true,
        // Textual artifacts enter the book pipeline (OCR the inscription); single-object
        // artworks terminalize immediately (no text to OCR/translate).
        pipeline_auto: contentType === 'artwork'
          ? { status: 'complete', skipped: 'artwork', source: 'import', last_updated: new Date() }
          : {
              status: 'archiving',
              source: 'import',
              queued_at: new Date(),
              last_updated: new Date(),
              retry_count: 0,
            },
        source_fingerprint: `met:${objectID}`,
        normalized_title: normalizedT,
        normalized_author: normalizeAuthor(author),
        // Met-specific metadata
        met_object_id: objectID,
        met_classification: obj.objectName || obj.classification || null,
        met_period: obj.period || null,
        met_dynasty: obj.dynasty || null,
        met_reign: obj.reign || null,
        met_medium: obj.medium || null,
        met_dimensions: obj.dimensions || null,
        met_department: obj.department || null,
        created_at: new Date(),
        updated_at: new Date(),
      });

      await db.collection('books').insertOne(bookDoc);

      // Create page documents
      const pageDocs = images.map((imgUrl, idx) => {
        const pageId = new ObjectId();
        return makePageDoc({
          _id: pageId,
          id: pageId.toHexString(),
          book_id: bookIdStr,
          page_number: idx + 1,
          photo: imgUrl,
          thumbnail: idx === 0 ? (obj.primaryImageSmall || imgUrl) : imgUrl,
          photo_original: imgUrl,
          created_at: new Date(),
          updated_at: new Date(),
        });
      });

      await db.collection('pages').insertMany(pageDocs, { ordered: false });

      imported++;
      totalPages += images.length;
      importedIds.push(bookIdStr);
      process.stdout.write(`  [${imported}/${LIMIT}] ${title.slice(0, 60)} — ${images.length} pages\n`);

    } catch (err) {
      console.error(`  ERROR importing ${objectID}: ${err.message?.slice(0, 80)}`);
      errors++;
    }

    if (checked % 50 === 0) logProgress();
  }

  logProgress();
  console.log(`\nDone: ${imported} imported, ${dupes} dupes, ${filtered} filtered, ${errors} errors, ${totalPages} total pages`);
  console.log(`Checked ${checked} of ${allIds.length} Met objects`);

  if (importedIds.length > 0) {
    console.log(`\nImported book IDs:\n${importedIds.join('\n')}`);
  }

  await client.close();

  function logProgress() {
    console.log(`--- Progress: checked ${checked}/${allIds.length} | imported ${imported} | dupes ${dupes} | filtered ${filtered} | errors ${errors} ---`);
  }
}

main().catch(e => { console.error(e); process.exit(1); });
