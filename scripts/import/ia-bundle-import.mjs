#!/usr/bin/env node
/**
 * Generic importer for books bundled inside large multi-file IA items.
 *
 * Many serious texts on IA exist only as files inside user-uploaded "library
 * bundle" items (often Arabic, Persian, Hebrew). Standard catalog search
 * doesn't find them (the bundle item has placeholder metadata like
 * title: "fff"), and the regular importer assumes one IA item = one book.
 *
 * This script imports specific files from a bundle, generating IIIF image
 * server URLs that target the per-book JP2 zip inside the bundle. It uses
 * NFD-normalized filenames because IA stores Arabic/Hebrew filenames
 * decomposed on disk (NFC URLs return 404 from the CDN mirrors).
 *
 * Input JSON format:
 *   {
 *     "bundle_id": "20230305_20230305_1003",
 *     "contributing_library": "...",  // optional
 *     "entries": [
 *       {
 *         "base_filename": "النفري - الأعمال الصوفية",   // NFC, no extension
 *         "title": "Al-A'mal al-Sufiyya",
 *         "display_title": "الأعمال الصوفية",
 *         "author": "Muhammad ibn Abd al-Jabbar al-Niffari",
 *         "year": 965,
 *         "language": "Arabic",
 *         "notes": "..."
 *       },
 *       ...
 *     ]
 *   }
 *
 * Usage:
 *   set -a; source .env.production.local; set +a
 *   node scripts/import/ia-bundle-import.mjs --data=/path/to/batch.json [--dry-run]
 */

import { MongoClient, ObjectId } from 'mongodb';
import fs from 'fs';
import crypto from 'crypto';

const args = process.argv.slice(2);
const DRY_RUN = args.includes('--dry-run');
const DATA_FILE = args.find(a => a.startsWith('--data='))?.split('=')[1];

if (!DATA_FILE) {
  console.error('Required: --data=/path/to/batch.json');
  process.exit(1);
}
const config = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
const { bundle_id, contributing_library, entries } = config;

if (!bundle_id || !Array.isArray(entries)) {
  console.error('Config must have bundle_id and entries[]');
  process.exit(1);
}

function nfd(s) { return s.normalize('NFD'); }

function buildPageFns(entry, pageCount) {
  const baseNFD = nfd(entry.base_filename);
  const zipFn = `${baseNFD}_jp2.zip`;
  const zipBase = `${baseNFD}_jp2`;
  const pageFor = (zeroIndex) => {
    const padded = String(zeroIndex).padStart(4, '0');
    return `${baseNFD}_${padded}.jp2`;
  };
  const url = (zeroIndex, pct) => {
    const path = `${encodeURIComponent(bundle_id)}%2F${encodeURIComponent(zipFn)}%2F${encodeURIComponent(zipBase)}%2F${encodeURIComponent(pageFor(zeroIndex))}`;
    const size = pct ? `pct:${pct}` : 'max';
    return `https://iiif.archive.org/image/iiif/3/${path}/full/${size}/0/default.jpg`;
  };
  return {
    getPageUrl: (i) => url(i),
    getThumbUrl: (i) => url(i, 15),
  };
}

async function getPageCount(entry) {
  const baseNFD = nfd(entry.base_filename);
  const scandataFn = `${baseNFD}_scandata.xml`;
  const url = `https://archive.org/download/${bundle_id}/${encodeURIComponent(scandataFn)}`;
  const res = await fetch(url, { signal: AbortSignal.timeout(20000), headers: { 'User-Agent': 'Mozilla/5.0' } });
  if (!res.ok) throw new Error(`scandata fetch failed: HTTP ${res.status}`);
  const text = await res.text();
  const matches = text.match(/<page leafNum="\d+"/g) || [];
  if (matches.length === 0) throw new Error('no <page leafNum> in scandata');
  return matches.length;
}

function slugify(text, maxLen = 60) {
  return text.toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-').replace(/-+/g, '-').trim().replace(/^-|-$/g, '')
    .substring(0, maxLen);
}

async function generateUniqueSlug(db, base) {
  let slug = base, i = 2;
  while (await db.collection('books').findOne({ slug }, { projection: { _id: 1 } })) {
    slug = `${base}-${i++}`;
  }
  return slug;
}

function normalizeTitle(t) {
  return t?.toLowerCase().replace(/[^a-z0-9 ]/g, '').replace(/\s+/g, ' ').trim() || '';
}
function normalizeAuthor(a) {
  return a?.toLowerCase().replace(/[^a-z0-9 ]/g, '').replace(/\s+/g, ' ').trim() || '';
}

async function main() {
  let client;
  if (!DRY_RUN) {
    client = new MongoClient(process.env.MONGODB_URI, { maxPoolSize: 3 });
    await client.connect();
  }
  const db = client?.db('bookstore');

  let imported = 0, skipped = 0, errors = 0;

  for (const entry of entries) {
    const tag = `[${entries.indexOf(entry) + 1}/${entries.length}] ${entry.title.substring(0, 50)}`;
    try {
      const pageCount = await getPageCount(entry);

      // IIIF spot check (page 0)
      const { getPageUrl, getThumbUrl } = buildPageFns(entry, pageCount);
      const headRes = await fetch(getPageUrl(0), { method: 'HEAD', signal: AbortSignal.timeout(15000), headers: { 'User-Agent': 'Mozilla/5.0' } });
      if (!headRes.ok) throw new Error(`IIIF check failed for page 0: HTTP ${headRes.status}`);

      if (DRY_RUN) {
        console.log(`${tag}: DRY-RUN ${pageCount}p OK`);
        imported++;
        continue;
      }

      // Fingerprint uses sha1 of base_filename so non-ASCII (Arabic/Hebrew/etc.)
      // filenames produce distinct, stable IDs. slugify() strips all non-Latin chars.
      const fileHash = crypto.createHash('sha1').update(entry.base_filename).digest('hex').slice(0, 16);
      const fingerprint = `ia-bundle:${bundle_id}/${fileHash}`;
      const existing = await db.collection('books').findOne(
        { source_fingerprint: fingerprint },
        { projection: { _id: 1 } }
      );
      if (existing) {
        console.log(`${tag}: SKIP (dupe ${existing._id})`);
        skipped++;
        continue;
      }

      const slug = await generateUniqueSlug(db, slugify(`${entry.title}-${entry.author}`.substring(0, 80)));
      const bookId = new ObjectId();
      const bookIdStr = bookId.toHexString();

      const bookDoc = {
        _id: bookId,
        id: bookIdStr,
        slug,
        title: entry.title,
        display_title: entry.display_title || null,
        author: entry.author,
        language: entry.language,
        published: entry.year ? String(entry.year) : 'Unknown',
        categories: [],
        ia_identifier: null,
        thumbnail: getThumbUrl(0),
        pages_count: pageCount,
        pages_ocr: 0,
        pages_translated: 0,
        pages_archived: 0,
        dublin_core: {
          dc_identifier: [`IA-BUNDLE:${bundle_id}/${fileHash}`],
          dc_source: `https://archive.org/details/${bundle_id}`,
        },
        image_source: {
          provider: 'internet_archive',
          provider_name: 'Internet Archive',
          source_url: `https://archive.org/details/${bundle_id}`,
          identifier: bundle_id,
          license: 'publicdomain',
          contributing_library: contributing_library || 'Internet Archive (bundled upload)',
          access_date: new Date(),
        },
        page_count_source: 'bundle_scandata',
        notes: entry.notes,
        status: 'draft',
        hidden: true,
        visible: false,
        source_fingerprint: fingerprint,
        normalized_title: normalizeTitle(entry.title),
        normalized_author: normalizeAuthor(entry.author),
        created_at: new Date(),
        updated_at: new Date(),
      };

      await db.collection('books').insertOne(bookDoc);

      const CHUNK = 500;
      for (let start = 0; start < pageCount; start += CHUNK) {
        const pageDocs = [];
        for (let p = start; p < Math.min(start + CHUNK, pageCount); p++) {
          const pageId = new ObjectId();
          pageDocs.push({
            _id: pageId,
            id: pageId.toHexString(),
            book_id: bookIdStr,
            page_number: p + 1,
            photo: getPageUrl(p),
            thumbnail: getThumbUrl(p),
            photo_original: getPageUrl(p),
            created_at: new Date(),
            updated_at: new Date(),
          });
        }
        await db.collection('pages').insertMany(pageDocs, { ordered: false });
      }

      console.log(`${tag}: OK ${pageCount}p id=${bookIdStr}`);
      imported++;
    } catch (err) {
      console.error(`${tag}: ERROR ${err.message}`);
      errors++;
    }
  }

  if (client) await client.close();
  console.log(`\n=== DONE ===\nImported: ${imported} | Skipped: ${skipped} | Errors: ${errors}`);
}

main().catch(e => { console.error(e); process.exit(1); });
