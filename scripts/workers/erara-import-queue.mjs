#!/usr/bin/env node
/**
 * e-rara Import Queue Processor
 *
 * Reads e-rara IDs from a queue file (one per line), imports each into MongoDB,
 * then removes processed entries. The existing archive-erara launchd agent
 * handles image downloads afterward.
 *
 * Queue file: scripts/erara-queue.txt
 * Format: one e-rara ID per line, optionally followed by tab-separated overrides:
 *   9895502
 *   1234567	Title Override	Author Override	1650
 *
 * Usage: set -a; source .env.production.local; set +a; node scripts/workers/erara-import-queue.mjs
 */

import { MongoClient, ObjectId } from 'mongodb';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
import { acquisitionGate, confirmClaims } from '../lib/acquire-book.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const QUEUE_FILE = path.join(__dirname, '..', 'erara-queue.txt');
const BATCH_SIZE = 10; // max imports per run
const DELAY_MS = 3000; // polite delay between e-rara API calls

const { MONGODB_URI } = process.env;
if (!MONGODB_URI) { console.error('Missing MONGODB_URI'); process.exit(1); }

// MARC "sine nomine" sigils mean the source has no author named on the title
// page. Treat as null rather than storing the placeholder verbatim. Kept in
// sync with src/lib/marc-utils.ts (this script is .mjs and runs standalone).
const MARC_NO_NAME = new Set(['[s.n.]', '[S.N.]', 's.n.', 'S.N.', '[s.n]', '[S.n.]']);
function normalizeMarcAuthor(raw) {
  if (raw == null) return null;
  const t = String(raw).trim();
  if (!t) return null;
  if (MARC_NO_NAME.has(t)) return null;
  return t;
}

function readQueue() {
  if (!fs.existsSync(QUEUE_FILE)) return [];
  return fs.readFileSync(QUEUE_FILE, 'utf-8')
    .split('\n')
    .map(l => l.trim())
    .filter(l => l && !l.startsWith('#'));
}

function writeQueue(lines) {
  // Preserve comments
  const original = fs.existsSync(QUEUE_FILE)
    ? fs.readFileSync(QUEUE_FILE, 'utf-8').split('\n')
    : [];
  const comments = original.filter(l => l.startsWith('#'));
  fs.writeFileSync(QUEUE_FILE, [...comments, ...lines, ''].join('\n'));
}

function parseLine(line) {
  const parts = line.split('\t');
  return {
    eraraId: parts[0].trim(),
    title: parts[1]?.trim() || null,
    author: normalizeMarcAuthor(parts[2]),
    year: parts[3]?.trim() ? parseInt(parts[3].trim()) : null,
  };
}

async function fetchMetadata(eraraId) {
  // OAI metadata
  const oaiUrl = `https://www.e-rara.ch/oai?verb=GetRecord&identifier=oai:www.e-rara.ch:${eraraId}&metadataPrefix=oai_dc`;
  const oaiRes = await fetch(oaiUrl);
  const oaiXml = oaiRes.ok ? await oaiRes.text() : '';
  const getTag = (tag) => oaiXml.match(new RegExp(`<dc:${tag}>([^<]+)<\\/dc:${tag}>`))?.[1];
  const doiMatch = oaiXml.match(/<dc:identifier>doi:([^<]+)<\/dc:identifier>/);

  // IIIF manifest
  const manifestUrl = `https://www.e-rara.ch/i3f/v21/${eraraId}/manifest`;
  const manifestRes = await fetch(manifestUrl, {
    headers: {
      'User-Agent': 'SourceLibrary/1.0 (https://sourcelibrary.org; scholarly digital library)',
      'Accept': 'application/json, application/ld+json',
    }
  });
  if (!manifestRes.ok) throw new Error(`Manifest fetch failed: ${manifestRes.status}`);
  const manifest = await manifestRes.json();
  const canvases = manifest.sequences?.[0]?.canvases || [];

  return {
    title: getTag('title') || manifest.label || 'Untitled',
    author: normalizeMarcAuthor(getTag('creator')),
    date: getTag('date'),
    language: getTag('language'),
    publisher: getTag('publisher'),
    doi: doiMatch?.[1] || null,
    manifest,
    manifestUrl,
    canvases,
  };
}

const LANG_MAP = { ger: 'German', lat: 'Latin', fre: 'French', ita: 'Italian', eng: 'English', dut: 'Dutch' };

async function importBook(db, entry) {
  const { eraraId, title: titleOverride, author: authorOverride, year: yearOverride } = entry;

  // Check existing
  const existing = await db.collection('books').findOne({ erara_id: eraraId });
  if (existing) {
    console.log(`  [skip] ${eraraId} already imported as ${existing.id}`);
    return 'skip';
  }

  const meta = await fetchMetadata(eraraId);
  if (meta.canvases.length === 0) {
    console.log(`  [skip] ${eraraId} has 0 canvases`);
    return 'skip';
  }

  const title = titleOverride || meta.title;
  const author = normalizeMarcAuthor(authorOverride) ?? meta.author;
  const yearStr = yearOverride || (meta.date ? parseInt(meta.date) : null);
  const language = LANG_MAP[meta.language?.toLowerCase()] || meta.language || 'Unknown';
  const sourceUrl = meta.doi ? `https://www.e-rara.ch/doi/${meta.doi}` : `https://www.e-rara.ch/content/titleinfo/${eraraId}`;

  const getImageUrl = (canvas, size) => {
    const serviceId = canvas?.images?.[0]?.resource?.service?.['@id'];
    if (serviceId) return `${serviceId}/full/${size},/0/default.jpg`;
    const canvasId = canvas?.['@id']?.split('/').pop();
    if (canvasId) return `https://www.e-rara.ch/download/webcache/${size}/${canvasId}`;
    return null;
  };

  const bookId = new ObjectId();
  const bookIdStr = bookId.toHexString();

  // Generate slug
  const slugBase = title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60);
  const slugWithYear = yearStr ? `${slugBase}-${yearStr}` : slugBase;
  const slugExists = await db.collection('books').findOne({ slug: slugWithYear });
  const slug = slugExists ? `${slugWithYear}-erara` : slugWithYear;

  const bookDoc = {
    _id: bookId,
    id: bookIdStr,
    slug,
    title,
    display_title: null,
    author,
    language,
    published: yearStr ? String(yearStr) : meta.date || 'Unknown',
    ...(yearStr ? { year: yearStr } : {}),
    categories: [],
    erara_id: eraraId,
    erara_doi: meta.doi,
    thumbnail: getImageUrl(meta.canvases[0], 200),
    pageCount: meta.canvases.length,
    pages_count: meta.canvases.length,
    dublin_core: {
      dc_identifier: [`ERARA:${eraraId}`, ...(meta.doi ? [`DOI:${meta.doi}`] : [])],
      dc_source: sourceUrl,
    },
    image_source: {
      provider: 'e-rara',
      provider_name: 'e-rara (Swiss rare books)',
      source_url: sourceUrl,
      iiif_manifest: meta.manifestUrl,
      identifier: eraraId,
      doi: meta.doi,
      license: 'unknown',
      attribution: meta.manifest.attribution || 'e-rara, the platform for digitized rare books from Swiss institutions',
      contributing_library: meta.publisher || 'e-rara',
      access_date: new Date(),
    },
    status: 'draft',
    hidden: true,
    visible: false,
    created_at: new Date(),
    updated_at: new Date(),
  };

  // Acquisition gate. This worker's doc literal predates `makeBookDoc()` (it
  // still writes `erara_id` / `pageCount`), so it takes the gate on its own
  // rather than going through `insertBookIfNew()`. A decline is a row in
  // `dedup_skips`, not a line of stdout.
  const gate = await acquisitionGate(db, bookDoc, {
    importer: 'worker:erara-import-queue',
    sourceIdentifier: eraraId,
    sourceUrl,
  });
  if (!gate.ok) {
    console.log(`  [skip] ${eraraId} — ${gate.message}`);
    return 'skip';
  }

  await db.collection('books').insertOne(bookDoc);
  await confirmClaims(db, gate.fingerprints, bookIdStr);

  const pageDocs = meta.canvases.map((canvas, i) => {
    const pageId = new ObjectId();
    return {
      _id: pageId,
      id: pageId.toHexString(),
      book_id: bookIdStr,
      page_number: i + 1,
      photo: getImageUrl(canvas, 1000),
      thumbnail: getImageUrl(canvas, 200),
      photo_original: getImageUrl(canvas, 1000),
      created_at: new Date(),
      updated_at: new Date(),
    };
  });

  await db.collection('pages').insertMany(pageDocs);
  console.log(`  [imported] ${eraraId} → ${bookIdStr} "${title}" (${meta.canvases.length} pages)`);
  return 'imported';
}

async function run() {
  const queue = readQueue();
  if (queue.length === 0) {
    console.log('[erara-import-queue] Queue empty, nothing to do.');
    return;
  }

  console.log(`[erara-import-queue] ${queue.length} items in queue, processing up to ${BATCH_SIZE}...`);

  const client = new MongoClient(MONGODB_URI, { maxPoolSize: 5 });
  await client.connect();
  const db = client.db('bookstore');

  const remaining = [...queue];
  let processed = 0;

  for (const line of queue.slice(0, BATCH_SIZE)) {
    const entry = parseLine(line);
    try {
      const result = await importBook(db, entry);
      remaining.splice(remaining.indexOf(line), 1);
      processed++;
      if (processed < BATCH_SIZE) await new Promise(r => setTimeout(r, DELAY_MS));
    } catch (err) {
      console.error(`  [error] ${entry.eraraId}: ${err.message}`);
      // Leave in queue for retry
    }
  }

  writeQueue(remaining);
  await client.close();
  console.log(`[erara-import-queue] Done. Processed ${processed}, ${remaining.length} remaining.`);
}

run().catch(err => { console.error(err); process.exit(1); });
