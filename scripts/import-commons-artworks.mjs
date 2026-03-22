#!/usr/bin/env node
/**
 * Import artworks from Wikimedia Commons into Source Library.
 *
 * Usage:
 *   set -a; source .env.production.local; set +a; node scripts/import-commons-artworks.mjs
 *
 *   Options:
 *     --dry-run         Show what would be imported without writing to DB
 *     --category "..."  Import a single category (skip the built-in list)
 *     --limit N         Max items to import (default: unlimited)
 *     --skip-images     Don't download/upload images to R2 (metadata only)
 *     --force           Re-import items that already exist
 */

import { MongoClient } from 'mongodb';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';

const UA = 'SourceLibrary/1.0 (https://sourcelibrary.org; contact@sourcelibrary.org)';
const COMMONS_API = 'https://commons.wikimedia.org/w/api.php';
const R2_PREFIX = 'artwork';
const DELAY_MS = 200; // Polite rate limit for Commons

// ─── Import targets ──────────────────────────────────────────────────────────

const IMPORT_CATEGORIES = [
  // Drebbel
  { category: 'Prints by Cornelius Drebbel', artist: 'Cornelis Drebbel', type: 'print', recurse: false },
  { category: 'Cornelius Drebbel', artist: 'Cornelis Drebbel', type: 'print', recurse: false },

  // Goltzius and school
  { category: 'Prints by Hendrick Goltzius', artist: 'Hendrick Goltzius', type: 'print', recurse: false },
  { category: 'Works after Hendrick Goltzius', artist: 'Hendrick Goltzius (after)', type: 'print', recurse: false },
  { category: 'Prints by Jan Saenredam', artist: 'Jan Saenredam', type: 'print', recurse: false },

  // Florence 1400-1500
  { category: 'Paintings by Sandro Botticelli', artist: 'Sandro Botticelli', type: 'painting', recurse: true },
  { category: 'Paintings by Fra Angelico', artist: 'Fra Angelico', type: 'painting', recurse: true },
  { category: 'Paintings by Masaccio', artist: 'Masaccio', type: 'painting', recurse: true },
  { category: 'Paintings by Fra Filippo Lippi', artist: 'Fra Filippo Lippi', type: 'painting', recurse: true },
  { category: 'Paintings by Filippino Lippi', artist: 'Filippino Lippi', type: 'painting', recurse: true },
  { category: 'Paintings by Benozzo Gozzoli', artist: 'Benozzo Gozzoli', type: 'painting', recurse: true },
  { category: 'Paintings by Domenico Ghirlandaio', artist: 'Domenico Ghirlandaio', type: 'painting', recurse: true },
  { category: 'Paintings by Piero di Cosimo', artist: 'Piero di Cosimo', type: 'painting', recurse: true },
  { category: 'Paintings by Andrea del Verrocchio', artist: 'Andrea del Verrocchio', type: 'painting', recurse: true },
  { category: 'Paintings by Andrea del Castagno', artist: 'Andrea del Castagno', type: 'painting', recurse: true },
  { category: 'Paintings by Paolo Uccello', artist: 'Paolo Uccello', type: 'painting', recurse: true },
  { category: 'Paintings by Luca Signorelli', artist: 'Luca Signorelli', type: 'painting', recurse: true },
  { category: 'Paintings by Leonardo da Vinci', artist: 'Leonardo da Vinci', type: 'painting', recurse: true },
  { category: 'Paintings by Michelangelo Buonarroti', artist: 'Michelangelo', type: 'painting', recurse: true },
  { category: 'Paintings by Gentile da Fabriano', artist: 'Gentile da Fabriano', type: 'painting', recurse: true },
  { category: 'Paintings by Lorenzo Monaco', artist: 'Lorenzo Monaco', type: 'painting', recurse: true },
  { category: 'Paintings by Cosimo Rosselli', artist: 'Cosimo Rosselli', type: 'painting', recurse: true },
  { category: 'Paintings by Domenico Veneziano', artist: 'Domenico Veneziano', type: 'painting', recurse: true },

  // Rome / Central Italy 1400-1500
  { category: 'Paintings by Raffaello Sanzio', artist: 'Raphael', type: 'painting', recurse: true },
  { category: 'Paintings by Pietro Perugino', artist: 'Pietro Perugino', type: 'painting', recurse: true },
  { category: 'Paintings by Pinturicchio', artist: 'Pinturicchio', type: 'painting', recurse: true },
  { category: 'Paintings by Piero della Francesca', artist: 'Piero della Francesca', type: 'painting', recurse: true },
  { category: 'Paintings by Andrea Mantegna', artist: 'Andrea Mantegna', type: 'painting', recurse: true },
  { category: 'Paintings by Melozzo da Forlì', artist: 'Melozzo da Forlì', type: 'painting', recurse: true },

  // Esoteric / Alchemical art
  { category: 'Atalanta Fugiens', artist: 'Michael Maier', type: 'print', recurse: false },
  { category: 'Splendor Solis', artist: 'Splendor Solis', type: 'print', recurse: true },
  { category: 'Amphitheatrum sapientiae aeternae', artist: 'Heinrich Khunrath', type: 'print', recurse: false },
  { category: 'Hermes Trismegistus', artist: 'Various', type: 'print', recurse: false },
  { category: 'Alchemists in art', artist: 'Various', type: 'painting', recurse: true },
  { category: 'Alchemical symbols', artist: 'Various', type: 'print', recurse: false },
  { category: 'Emblemata', artist: 'Various', type: 'print', recurse: false },
  { category: 'Rosicrucianism', artist: 'Various', type: 'print', recurse: false },
  { category: 'Mantegna Tarocchi', artist: 'Unknown (Ferrara school)', type: 'print', recurse: true },
  { category: 'Danse Macabre (Holbein)', artist: 'Hans Holbein the Younger', type: 'print', recurse: true },

  // Dürer master prints
  { category: 'Prints by Albrecht Dürer', artist: 'Albrecht Dürer', type: 'print', recurse: false },
];

// ─── Helpers ─────────────────────────────────────────────────────────────────

async function commonsApi(params) {
  const url = new URL(COMMONS_API);
  url.searchParams.set('format', 'json');
  for (const [k, v] of Object.entries(params)) {
    url.searchParams.set(k, v);
  }
  const res = await fetch(url.toString(), { headers: { 'User-Agent': UA } });
  if (!res.ok) throw new Error(`Commons API ${res.status}: ${await res.text()}`);
  return res.json();
}

async function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

/** List all files in a category (with pagination) */
async function listCategoryFiles(category, recurse = false, maxDepth = 1) {
  const files = new Map(); // title -> true (dedupe)

  async function walkCategory(cat, depth) {
    let cmcontinue = undefined;
    do {
      const params = {
        action: 'query',
        list: 'categorymembers',
        cmtitle: `Category:${cat}`,
        cmlimit: '500',
        cmtype: 'file',
      };
      if (cmcontinue) params.cmcontinue = cmcontinue;

      const data = await commonsApi(params);
      for (const member of data.query?.categorymembers || []) {
        files.set(member.title, true);
      }
      cmcontinue = data.continue?.cmcontinue;
      await sleep(DELAY_MS);
    } while (cmcontinue);

    // Recurse into subcategories
    if (recurse && depth < maxDepth) {
      let subcontinue = undefined;
      do {
        const params = {
          action: 'query',
          list: 'categorymembers',
          cmtitle: `Category:${cat}`,
          cmlimit: '500',
          cmtype: 'subcat',
        };
        if (subcontinue) params.cmcontinue = subcontinue;

        const data = await commonsApi(params);
        for (const sub of data.query?.categorymembers || []) {
          const subName = sub.title.replace('Category:', '');
          await walkCategory(subName, depth + 1);
        }
        subcontinue = data.continue?.cmcontinue;
        await sleep(DELAY_MS);
      } while (subcontinue);
    }
  }

  await walkCategory(category, 0);
  return [...files.keys()];
}

/** Get detailed metadata for a batch of files (up to 50) */
async function getFileInfo(titles) {
  const results = [];
  // API limit: 50 titles per request
  for (let i = 0; i < titles.length; i += 50) {
    const batch = titles.slice(i, i + 50);
    const data = await commonsApi({
      action: 'query',
      titles: batch.join('|'),
      prop: 'imageinfo|categories',
      iiprop: 'url|size|extmetadata|mime',
      iiurlwidth: '2400',
      cllimit: '50',
    });

    for (const page of Object.values(data.query?.pages || {})) {
      if (!page.imageinfo?.[0]) continue;
      const info = page.imageinfo[0];
      const ext = info.extmetadata || {};

      // Skip non-image files
      if (!info.mime?.startsWith('image/')) continue;
      // Skip tiny images (icons, logos)
      if (info.width < 300 || info.height < 300) continue;

      results.push({
        commonsTitle: page.title,
        thumbUrl: info.thumburl || info.url,
        fullUrl: info.url,
        width: info.width,
        height: info.height,
        mime: info.mime,
        // Extracted metadata
        title: cleanHtml(ext.ObjectName?.value) || page.title.replace('File:', '').replace(/\.[^.]+$/, ''),
        description: cleanHtml(ext.ImageDescription?.value) || '',
        artist: cleanHtml(ext.Artist?.value) || '',
        dateCreated: cleanHtml(ext.DateTimeOriginal?.value) || ext.DateTime?.value || '',
        medium: cleanHtml(ext.Medium?.value) || '',
        dimensions: cleanHtml(ext.Dimensions?.value) || '',
        license: ext.LicenseShortName?.value || 'Unknown',
        licenseUrl: ext.LicenseUrl?.value || '',
        credit: cleanHtml(ext.Credit?.value) || '',
        categories: (page.categories || []).map(c => c.title.replace('Category:', '')),
      });
    }
    await sleep(DELAY_MS);
  }
  return results;
}

function cleanHtml(html) {
  if (!html) return '';
  return html
    .replace(/<[^>]+>/g, '') // Strip HTML tags
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

function slugify(text) {
  return text
    .toLowerCase()
    .replace(/[^\w\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 80);
}

function generateId() {
  return Array.from({ length: 24 }, () => Math.floor(Math.random() * 16).toString(16)).join('');
}

/** Download image and upload to R2 */
async function uploadToR2(s3, imageUrl, key) {
  const res = await fetch(imageUrl, { headers: { 'User-Agent': UA } });
  if (!res.ok) return null;
  const buffer = Buffer.from(await res.arrayBuffer());

  const contentType = res.headers.get('content-type') || 'image/jpeg';
  await s3.send(new PutObjectCommand({
    Bucket: process.env.R2_BUCKET_NAME,
    Key: key,
    Body: buffer,
    ContentType: contentType,
  }));

  return `https://images.sourcelibrary.org/${key}`;
}

// ─── Main ────────────────────────────────────────────────────────────────────

async function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes('--dry-run');
  const skipImages = args.includes('--skip-images');
  const force = args.includes('--force');
  const limitIdx = args.indexOf('--limit');
  const limit = limitIdx >= 0 ? parseInt(args[limitIdx + 1]) : Infinity;
  const catIdx = args.indexOf('--category');
  const singleCategory = catIdx >= 0 ? args[catIdx + 1] : null;

  console.log(`Mode: ${dryRun ? 'DRY RUN' : 'LIVE'} | Images: ${skipImages ? 'SKIP' : 'UPLOAD'} | Limit: ${limit === Infinity ? 'none' : limit}`);

  // Connect to MongoDB
  const client = new MongoClient(process.env.MONGODB_URI);
  await client.connect();
  const db = client.db('bookstore');
  const books = db.collection('books');

  // Set up R2 client
  let s3 = null;
  if (!skipImages && !dryRun) {
    s3 = new S3Client({
      region: 'auto',
      endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
      credentials: {
        accessKeyId: process.env.R2_ACCESS_KEY_ID,
        secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
      },
    });
  }

  // Determine which categories to import
  const categories = singleCategory
    ? [{ category: singleCategory, artist: 'Unknown', type: 'print', recurse: false }]
    : IMPORT_CATEGORIES;

  let totalImported = 0;
  let totalSkipped = 0;
  let totalErrors = 0;
  const seenTitles = new Set();

  for (const cat of categories) {
    if (totalImported >= limit) break;

    console.log(`\n━━━ ${cat.category} (${cat.artist}) ━━━`);

    // List files in category
    const files = await listCategoryFiles(cat.category, cat.recurse);
    console.log(`  Found ${files.length} files`);

    // Dedupe across categories
    const newFiles = files.filter(f => !seenTitles.has(f));
    newFiles.forEach(f => seenTitles.add(f));
    if (newFiles.length < files.length) {
      console.log(`  ${files.length - newFiles.length} already seen in prior categories`);
    }

    // Get metadata in batches
    const allInfo = await getFileInfo(newFiles);
    console.log(`  ${allInfo.length} valid images (after filtering)`);

    for (const info of allInfo) {
      if (totalImported >= limit) break;

      const slug = slugify(info.title || info.commonsTitle.replace('File:', ''));
      if (!slug) continue;

      // Check if already exists
      if (!force) {
        const exists = await books.findOne(
          { $or: [{ slug: `art-${slug}` }, { 'commons_title': info.commonsTitle }] },
          { projection: { _id: 1 } }
        );
        if (exists) {
          totalSkipped++;
          continue;
        }
      }

      // Upload image to R2
      let thumbnailUrl = info.thumbUrl;
      if (s3 && !skipImages) {
        const r2Key = `${R2_PREFIX}/${slug}.jpg`;
        try {
          const r2Url = await uploadToR2(s3, info.thumbUrl, r2Key);
          if (r2Url) thumbnailUrl = r2Url;
          await sleep(100); // Don't hammer Commons
        } catch (err) {
          console.error(`  Failed to upload ${slug}: ${err.message}`);
          totalErrors++;
          continue;
        }
      }

      // Build the book document
      const doc = {
        id: generateId(),
        slug: `art-${slug}`,
        tenant_id: 'default',
        title: info.title || info.commonsTitle.replace('File:', '').replace(/\.[^.]+$/, ''),
        display_title: info.title || undefined,
        author: cat.artist,
        language: 'Visual',
        published: info.dateCreated?.match(/\d{4}/)?.[0] || '',
        resource_type: cat.type,
        medium: info.medium || (cat.type === 'print' ? 'Engraving' : 'Oil on panel'),
        dimensions_display: info.dimensions || '',
        thumbnail: thumbnailUrl,
        thumbnail_blob: thumbnailUrl,
        pages_count: 1,
        pages_ocr: 0,
        pages_translated: 0,
        status: 'draft',
        hidden: true, // Hidden until enriched
        hidden_reason: 'artwork_import',
        categories: [cat.type === 'painting' ? 'Visual Art — Painting' : 'Visual Art — Print'],
        created_at: new Date(),
        updated_at: new Date(),
        // Commons-specific metadata
        commons_title: info.commonsTitle,
        commons_url: `https://commons.wikimedia.org/wiki/${encodeURIComponent(info.commonsTitle)}`,
        commons_full_url: info.fullUrl,
        commons_width: info.width,
        commons_height: info.height,
        commons_license: info.license,
        commons_description: info.description?.slice(0, 2000) || '',
        commons_categories: info.categories,
        image_source: {
          provider: 'wikimedia_commons',
          provider_name: 'Wikimedia Commons',
          source_url: `https://commons.wikimedia.org/wiki/${encodeURIComponent(info.commonsTitle)}`,
          license: info.license === 'Public domain' ? 'CC0-1.0' : info.license,
        },
      };

      if (dryRun) {
        console.log(`  [DRY] ${doc.slug} — ${doc.title} (${info.width}x${info.height})`);
      } else {
        try {
          await books.insertOne(doc);
          console.log(`  ✓ ${doc.slug} — ${doc.title}`);
        } catch (err) {
          if (err.code === 11000) {
            totalSkipped++;
            continue;
          }
          console.error(`  ✗ ${doc.slug}: ${err.message}`);
          totalErrors++;
          continue;
        }
      }

      totalImported++;
    }
  }

  console.log(`\n━━━ DONE ━━━`);
  console.log(`Imported: ${totalImported}`);
  console.log(`Skipped (dupes): ${totalSkipped}`);
  console.log(`Errors: ${totalErrors}`);
  console.log(`Total seen: ${seenTitles.size}`);

  await client.close();
}

main().catch(err => {
  console.error('Fatal:', err);
  process.exit(1);
});
