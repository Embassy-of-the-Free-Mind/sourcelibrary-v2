#!/usr/bin/env node
/**
 * Import artworks from Wikimedia Commons into Source Library gallery.
 * Supports CC0, Public Domain, CC-BY, CC-BY-SA licensed images.
 *
 * Usage:
 *   set -a; source .env.production.local; set +a; node scripts/import/import-commons-artworks.mjs
 *   Add --dry-run to skip actual imports
 */

import { MongoClient, ObjectId } from 'mongodb';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import sharp from 'sharp';
import crypto from 'crypto';

const R2_PREFIX = 'artwork';
const DISPLAY_MAX = 3840;
const THUMB_WIDTH = 600;
const DELAY_MS = 2000; // Be polite to Commons — they rate-limit aggressively
const DRY_RUN = process.argv.includes('--dry-run');

const generateId = () => new ObjectId().toString();

function slugify(str) {
  return str.toLowerCase()
    .replace(/[^\w\s-]/g, '')
    .replace(/[\s_]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .substring(0, 80);
}

// ─── Artwork definitions ──────────────────────────────────────────────────────

const ARTWORKS = [
  // === TURIN EROTIC PAPYRUS (CC0, Museo Egizio) ===
  {
    commons_file: 'Turin_Satirical-Erotic_Papyrus_-_Museo_Egizio_Turin_C_2031_p01.jpg',
    title: 'Turin Erotic Papyrus, Section 1',
    author: 'Unknown Egyptian artist',
    date: '-1150',
    resource_type: 'drawing',
    medium: 'Ink on papyrus',
    categories: ['Egyptian', 'Visual Art'],
    contributing_library: 'Museo Egizio, Turin',
    license: 'CC0 1.0',
  },
  {
    commons_file: 'Turin_Satirical-Erotic_Papyrus_-_Museo_Egizio_Turin_C_2031_p02.jpg',
    title: 'Turin Erotic Papyrus, Section 2',
    author: 'Unknown Egyptian artist',
    date: '-1150',
    resource_type: 'drawing',
    medium: 'Ink on papyrus',
    categories: ['Egyptian', 'Visual Art'],
    contributing_library: 'Museo Egizio, Turin',
    license: 'CC0 1.0',
  },
  {
    commons_file: 'Turin_Satirical-Erotic_Papyrus_-_Museo_Egizio_Turin_C_2031_p03.jpg',
    title: 'Turin Erotic Papyrus, Section 3',
    author: 'Unknown Egyptian artist',
    date: '-1150',
    resource_type: 'drawing',
    medium: 'Ink on papyrus',
    categories: ['Egyptian', 'Visual Art'],
    contributing_library: 'Museo Egizio, Turin',
    license: 'CC0 1.0',
  },
  {
    commons_file: 'Turin_Satirical-Erotic_Papyrus_-_Museo_Egizio_Turin_C_2031_p05.jpg',
    title: 'Turin Erotic Papyrus, Section 5',
    author: 'Unknown Egyptian artist',
    date: '-1150',
    resource_type: 'drawing',
    medium: 'Ink on papyrus',
    categories: ['Egyptian', 'Visual Art'],
    contributing_library: 'Museo Egizio, Turin',
    license: 'CC0 1.0',
  },

  // === TASSILI N'AJJER CAVE PAINTINGS ===
  {
    commons_file: "Cave_painting_from_the_Tassili_n'Ajjer_mountains.jpg",
    title: "Cave Painting from the Tassili n'Ajjer Mountains",
    author: 'Unknown prehistoric artist',
    date: '-6000',
    resource_type: 'fresco',
    medium: 'Pigment on rock',
    categories: ['Visual Art', 'Archaeology'],
    contributing_library: "Tassili n'Ajjer, Algeria",
    license: 'Public domain',
  },
  {
    commons_file: "The_Tanzoumaitak_cave_painting_in_Tassili_n'ajjer.jpg",
    title: "The Tanzoumaitak Cave Painting, Tassili n'Ajjer",
    author: 'Unknown prehistoric artist',
    date: '-6000',
    resource_type: 'fresco',
    medium: 'Pigment on rock',
    categories: ['Visual Art', 'Archaeology'],
    contributing_library: "Tassili n'Ajjer, Algeria",
    license: 'CC BY-SA 4.0',
  },

  // === MOCHE EROTIC POTTERY (Larco Museum) ===
  {
    commons_file: '007-erotic_pottery_from_the_Moche_period.jpg',
    title: 'Erotic Pottery from the Moche Period',
    author: 'Unknown Moche artist',
    date: '400',
    resource_type: 'object',
    medium: 'Ceramic',
    categories: ['Visual Art', 'Pre-Columbian'],
    contributing_library: 'Larco Museum, Lima',
    license: 'CC BY 2.0',
  },
  {
    commons_file: 'Huacos_Moche_Eroticos.jpg',
    title: 'Moche Erotic Vessels (Huacos)',
    author: 'Unknown Moche artist',
    date: '400',
    resource_type: 'object',
    medium: 'Ceramic',
    categories: ['Visual Art', 'Pre-Columbian'],
    contributing_library: 'Larco Museum, Lima',
    license: 'CC BY-SA 4.0',
  },
  {
    commons_file: 'Larco_Museum_Erotic_Art_III.jpg',
    title: 'Moche Erotic Vessel (Larco Museum III)',
    author: 'Unknown Moche artist',
    date: '400',
    resource_type: 'object',
    medium: 'Ceramic',
    categories: ['Visual Art', 'Pre-Columbian'],
    contributing_library: 'Larco Museum, Lima',
    license: 'CC BY-SA 3.0',
  },
  {
    commons_file: 'Larco_Museum_Erotic_Art_IV.jpg',
    title: 'Moche Erotic Vessel (Larco Museum IV)',
    author: 'Unknown Moche artist',
    date: '400',
    resource_type: 'object',
    medium: 'Ceramic',
    categories: ['Visual Art', 'Pre-Columbian'],
    contributing_library: 'Larco Museum, Lima',
    license: 'CC BY-SA 3.0',
  },

  // === KOREAN CHUNHWADO — Kim Hong-do (Danwon) 운우도첩 ===
  ...Array.from({ length: 11 }, (_, i) => ({
    commons_file: `운우도첩${i === 0 ? '' : i}.jpg`,
    title: `Clouds and Rain (운우도첩) — Scene ${i + 1}`,
    author: 'Kim Hong-do (김홍도, Danwon)',
    date: '1800',
    resource_type: 'painting',
    medium: 'Ink and color on paper',
    categories: ['Visual Art', 'Korean Art'],
    contributing_library: 'Gansong Art Museum, Seoul',
    license: 'Public domain',
  })),

  // === KOREAN CHUNHWADO — Shin Yun-bok (Hyewon) 건곤일회첩 ===
  ...Array.from({ length: 7 }, (_, i) => ({
    commons_file: `건곤일회첩${i === 0 ? '' : i + 1}.jpg`,
    title: `Album of Heaven and Earth United (건곤일회첩) — Scene ${i + 1}`,
    author: 'Shin Yun-bok (신윤복, Hyewon)',
    date: '1805',
    resource_type: 'painting',
    medium: 'Ink and color on silk',
    categories: ['Visual Art', 'Korean Art'],
    contributing_library: 'Gansong Art Museum, Seoul',
    license: 'Public domain',
  })),
];

// ─── Commons API ──────────────────────────────────────────────────────────────

async function getCommonsImageInfo(filename) {
  const encoded = encodeURIComponent('File:' + filename);
  const url = `https://commons.wikimedia.org/w/api.php?action=query&titles=${encoded}&prop=imageinfo&iiprop=url|size|extmetadata&format=json`;
  const res = await fetch(url, { headers: { 'User-Agent': 'SourceLibrary/1.0 (https://sourcelibrary.org)' } });
  const d = await res.json();
  const pages = d.query?.pages || {};
  for (const p of Object.values(pages)) {
    const ii = (p.imageinfo || [{}])[0];
    return {
      url: ii.url,
      width: ii.width,
      height: ii.height,
      descriptionUrl: ii.descriptionurl,
    };
  }
  return null;
}

// ─── R2 Upload ────────────────────────────────────────────────────────────────

async function uploadToR2(s3, sourceUrl, key) {
  const res = await fetch(sourceUrl, {
    headers: { 'User-Agent': 'SourceLibrary/1.0 (https://sourcelibrary.org)' },
    signal: AbortSignal.timeout(30000),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());

  const img = sharp(buf);
  const meta = await img.metadata();
  const w = meta.width || 0;
  const h = meta.height || 0;

  // Display image (max 3840px)
  const displayBuf = (w > DISPLAY_MAX || h > DISPLAY_MAX)
    ? await img.resize({ width: DISPLAY_MAX, height: DISPLAY_MAX, fit: 'inside' }).jpeg({ quality: 85 }).toBuffer()
    : await img.jpeg({ quality: 85 }).toBuffer();

  await s3.send(new PutObjectCommand({
    Bucket: process.env.R2_BUCKET_NAME,
    Key: `${key}.jpg`,
    Body: displayBuf,
    ContentType: 'image/jpeg',
  }));

  // Thumbnail
  const thumbBuf = await sharp(buf).resize({ width: THUMB_WIDTH, fit: 'inside' }).jpeg({ quality: 80 }).toBuffer();
  await s3.send(new PutObjectCommand({
    Bucket: process.env.R2_BUCKET_NAME,
    Key: `${key}-thumb.jpg`,
    Body: thumbBuf,
    ContentType: 'image/jpeg',
  }));

  const base = `https://images.sourcelibrary.org`;
  return {
    display: `${base}/${key}.jpg`,
    thumb: `${base}/${key}-thumb.jpg`,
    width: w,
    height: h,
  };
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  console.log(`=== Commons Artwork Import: ${ARTWORKS.length} items ===`);
  console.log(`Mode: ${DRY_RUN ? 'DRY RUN' : 'LIVE'}\n`);

  const client = new MongoClient(process.env.MONGODB_URI);
  await client.connect();
  const db = client.db('bookstore');
  const books = db.collection('books');

  const s3 = DRY_RUN ? null : new S3Client({
    region: 'auto',
    endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
    credentials: {
      accessKeyId: process.env.R2_ACCESS_KEY_ID,
      secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
    },
  });

  let imported = 0, skipped = 0, errors = 0;

  for (let i = 0; i < ARTWORKS.length; i++) {
    const art = ARTWORKS[i];
    const slug = 'commons-' + slugify(art.title);

    // Check for existing
    const existing = await books.findOne({ slug });
    if (existing) {
      console.log(`  Skip (exists): ${art.title}`);
      skipped++;
      continue;
    }

    // Get image info from Commons
    const info = await getCommonsImageInfo(art.commons_file);
    if (!info?.url) {
      console.log(`  ERROR: No image URL for ${art.commons_file}`);
      errors++;
      continue;
    }

    if (DRY_RUN) {
      console.log(`  [DRY] ${slug} — ${art.author} — ${art.title} (${info.width}x${info.height})`);
      imported++;
      await new Promise(r => setTimeout(r, 100));
      continue;
    }

    // Upload to R2
    let displayUrl, thumbUrl, width = 0, height = 0;
    try {
      const r2Key = `${R2_PREFIX}/${slug}`;
      const urls = await uploadToR2(s3, info.url, r2Key);
      displayUrl = urls.display;
      thumbUrl = urls.thumb;
      width = urls.width;
      height = urls.height;
    } catch (err) {
      console.log(`  ERROR uploading ${art.commons_file}: ${err.message}`);
      errors++;
      continue;
    }

    const doc = {
      id: generateId(),
      slug,
      tenant_id: 'default',
      title: art.title,
      display_title: art.title,
      author: art.author,
      language: 'Visual',
      published: art.date,
      resource_type: art.resource_type,
      medium: art.medium,
      thumbnail: thumbUrl,
      thumbnail_blob: displayUrl,
      pages_count: 1,
      pages_ocr: 0,
      pages_translated: 0,
      status: 'published',
      visible: true,
      categories: art.categories,
      created_at: new Date(),
      updated_at: new Date(),
      commons_width: width,
      commons_height: height,
      commons_title: art.title,
      commons_url: info.descriptionUrl || `https://commons.wikimedia.org/wiki/File:${encodeURIComponent(art.commons_file)}`,
      commons_full_url: info.url,
      commons_license: art.license,
      commons_categories: art.categories,
      image_source: {
        provider: 'commons',
        provider_name: 'Wikimedia Commons',
        source_url: info.descriptionUrl || `https://commons.wikimedia.org/wiki/File:${encodeURIComponent(art.commons_file)}`,
        identifier: `commons-${crypto.createHash('md5').update(art.commons_file).digest('hex').substring(0, 12)}`,
        license: art.license,
        attribution: art.contributing_library,
        contributing_library: art.contributing_library,
        access_date: new Date().toISOString(),
      },
      harvested_at: new Date(),
    };

    try {
      await books.insertOne(doc);
      console.log(`  ✓ ${slug} — ${art.author} — ${art.title}`);
      imported++;
    } catch (err) {
      if (err.code === 11000) {
        skipped++;
        continue;
      }
      console.log(`  ERROR: ${err.message}`);
      errors++;
    }

    await new Promise(r => setTimeout(r, DELAY_MS));
  }

  console.log(`\n━━━ DONE ━━━`);
  console.log(`Imported: ${imported}`);
  console.log(`Skipped: ${skipped}`);
  console.log(`Errors: ${errors}`);

  await client.close();
}

main().catch(console.error);
