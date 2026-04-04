/**
 * Fetch museum artwork images for collection hero images.
 * Uses Met Open Access API (CC0 public domain).
 * Uploads to R2, sets hero_image on collection.
 *
 * Run: set -a; source .env.production.local; set +a; node scripts/tmp-collection-hero-images.mjs
 */
import { MongoClient } from 'mongodb';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import dotenv from 'dotenv';
dotenv.config({ path: '.env.production.local' });

const R2 = new S3Client({
  region: 'auto',
  endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
  credentials: {
    accessKeyId: process.env.R2_ACCESS_KEY_ID,
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
  },
});
const R2_BUCKET = process.env.R2_BUCKET_NAME || 'sourcelibrary-images';
const R2_PUBLIC = process.env.R2_PUBLIC_URL || 'https://images.sourcelibrary.org';

// Collection slug -> { query, filters, fallbackObjectId }
// Met API: search returns IDs, then fetch each object for image
const COLLECTION_IMAGES = [
  // New papyri/manuscripts collections
  { slug: 'ancient-papyri', objectId: 545445 }, // Heqanakht Letter I — actual papyrus
  { slug: 'papyri-magical', objectId: 464456 }, // Amulet carved in intaglio — magical
  { slug: 'papyri-literary', objectId: 248134 }, // Papyrus fragment with Homer's Odyssey
  { slug: 'papyri-historical', query: 'papyrus decree letter ancient', objectId: 551898 },
  { slug: 'papyri-christian', query: 'coptic christian manuscript egypt', objectId: 475477 }, // Seth on Sinai
  { slug: 'papyri-philosophical', objectId: 436105 }, // Death of Socrates (David)
  { slug: 'papyri-school', objectId: 324332 }, // Panels of a writing board
  { slug: 'great-manuscripts', objectId: 477499 }, // Jaharis Byzantine Lectionary
  { slug: 'herculaneum-papyri', query: 'roman fresco pompeii herculaneum scroll', objectId: 250134 },

  // Missing images
  { slug: 'norse-germanic', query: 'viking brooch migration period scandinavian', objectId: 466112 },
  { slug: 'sikhism', query: 'sikh miniature painting', objectId: 73368 },
  { slug: 'druze', objectId: 457717 }, // Panel with geometric pattern and inscriptions
  { slug: 'bahai', query: 'persian illuminated calligraphy', objectId: 453367 },
  { slug: 'polynesian', query: 'polynesian oceanic tiki wood carving', objectId: 313256 },
  { slug: 'samaritan', objectId: 239512 }, // Torah crown (keter)
  { slug: 'letters-from-the-desert', objectId: 475477 }, // Papyrus fragments with Seth on Sinai
  { slug: 'syriac-church', query: 'syriac gospel manuscript illuminated', objectId: 466307 },
  { slug: 'indigenous-sacred-narratives', query: 'native american bark cloth ceremony', objectId: 309400 },
  { slug: 'hesychast-tradition', objectId: 479796 }, // Four Icons from doors
  { slug: 'canon-of-avicenna', objectId: 451400 }, // "Preparing Medicine from Honey"

  // Chinese collections missing images
  { slug: 'chinese-buddhist-texts', objectId: 49165 }, // Tree Peonies by Yun Shouping (scroll)
  { slug: 'chinese-medicine-natural-philosophy', query: 'chinese painting natural landscape ink wash', objectId: 73410 },
  { slug: 'chinese-divination-cosmology', query: 'chinese yin yang diagram trigram', objectId: 49252 },
  { slug: 'chinese-history-statecraft', query: 'chinese court scroll painting calligraphy', objectId: 39901 },

  // Replace bad/weak images
  { slug: 'jungs-library', query: 'tibetan mandala thangka buddhist wheel', objectId: 38021 }, // Chakrasamvara — keep but use search to find better
  { slug: 'fechner', objectId: 439844 }, // Heroic Landscape with Rainbow — perfect for Fechner
];

async function fetchMetObject(objectId) {
  const resp = await fetch(`https://collectionapi.metmuseum.org/public/collection/v1/objects/${objectId}`);
  if (!resp.ok) return null;
  return resp.json();
}

async function searchMet(query) {
  const resp = await fetch(`https://collectionapi.metmuseum.org/public/collection/v1/search?q=${encodeURIComponent(query)}&hasImages=true&isPublicDomain=true`);
  if (!resp.ok) return [];
  const data = await resp.json();
  return data.objectIDs?.slice(0, 10) || [];
}

async function findBestArtwork(query, curatedId) {
  // Prefer curated object ID when available
  if (curatedId) {
    const obj = await fetchMetObject(curatedId);
    if (obj?.primaryImage && obj.isPublicDomain) return obj;
  }

  // Fall back to search
  if (query) {
    const ids = await searchMet(query);
    for (const id of ids) {
      const obj = await fetchMetObject(id);
      if (obj?.primaryImage && obj.isPublicDomain) return obj;
      await new Promise(r => setTimeout(r, 200));
    }
  }

  return null;
}

async function downloadAndUpload(imageUrl, slug) {
  const resp = await fetch(imageUrl, { signal: AbortSignal.timeout(30000) });
  if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
  const buffer = Buffer.from(await resp.arrayBuffer());

  // Skip tiny images
  if (buffer.length < 50000) {
    console.log(`  SKIP: image too small (${Math.round(buffer.length / 1024)}KB)`);
    return null;
  }

  const key = `artwork/collection-hero-${slug}.jpg`;
  await R2.send(new PutObjectCommand({
    Bucket: R2_BUCKET,
    Key: key,
    Body: buffer,
    ContentType: 'image/jpeg',
  }));

  return `${R2_PUBLIC}/${key}`;
}

async function main() {
  const client = await MongoClient.connect(process.env.MONGODB_URI);
  const db = client.db('bookstore');

  let updated = 0, failed = 0;

  for (const item of COLLECTION_IMAGES) {
    console.log(`\n[${item.slug}] Searching: "${item.query}"...`);

    try {
      const artwork = await findBestArtwork(item.query, item.objectId);
      if (!artwork?.primaryImage) {
        console.log(`  FAIL: no artwork found`);
        failed++;
        continue;
      }

      console.log(`  Found: "${artwork.title}" (${artwork.objectDate || 'undated'})`);
      console.log(`  By: ${artwork.artistDisplayName || 'Unknown'}`);
      console.log(`  Dept: ${artwork.department}`);

      const r2Url = await downloadAndUpload(artwork.primaryImage, item.slug);
      if (!r2Url) { failed++; continue; }

      console.log(`  Uploaded: ${r2Url}`);

      await db.collection('collections').updateOne(
        { slug: item.slug },
        {
          $set: {
            hero_image: r2Url,
            hero_image_attribution: {
              title: artwork.title,
              artist: artwork.artistDisplayName || 'Unknown',
              date: artwork.objectDate,
              museum: 'The Metropolitan Museum of Art',
              accession: artwork.accessionNumber,
              object_id: artwork.objectID,
              license: 'CC0',
            },
            updated_at: new Date(),
          },
        }
      );

      updated++;
      console.log(`  SET hero_image on ${item.slug}`);
    } catch (e) {
      console.error(`  ERROR: ${e.message}`);
      failed++;
    }

    // Rate limit
    await new Promise(r => setTimeout(r, 500));
  }

  console.log(`\n=== DONE ===`);
  console.log(`Updated: ${updated}`);
  console.log(`Failed: ${failed}`);

  await client.close();
}

main().catch(console.error);
