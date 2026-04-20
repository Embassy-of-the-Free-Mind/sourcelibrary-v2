#!/usr/bin/env node
/**
 * Align Wikimedia Commons tablet photographs with the Thompson Gilgamesh edition.
 *
 * Maps each of the 12 tablets to page ranges in Thompson's 1930 edition,
 * then downloads tablet photos from Commons, archives to R2, and distributes
 * across the book's pages. Repeats the same tablet photo across multiple pages
 * when the tablet's text spans several pages.
 *
 * Usage:
 *   set -a; source .env.production.local; set +a
 *   node scripts/import/gilgamesh-align-images.mjs --book-id <id>
 *   node scripts/import/gilgamesh-align-images.mjs --book-id <id> --dry-run
 *
 * Flags:
 *   --book-id ID    The Thompson Gilgamesh book ID
 *   --dry-run       Preview without writing to DB/R2
 */
import { MongoClient, ObjectId } from 'mongodb';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';

// ── ENV ──
const MONGODB_URI = process.env.MONGODB_URI;
if (!MONGODB_URI) { console.error('MONGODB_URI not set'); process.exit(1); }

const R2_BUCKET = process.env.R2_BUCKET_NAME || 'sourcelibrary';
const R2_PUBLIC_URL = process.env.R2_PUBLIC_URL || 'https://images.sourcelibrary.org';
const R2_ACCOUNT_ID = process.env.R2_ACCOUNT_ID;
const R2_ACCESS_KEY_ID = process.env.R2_ACCESS_KEY_ID;
const R2_SECRET_ACCESS_KEY = process.env.R2_SECRET_ACCESS_KEY;

// ── CLI flags ──
const args = process.argv.slice(2);
function getFlag(name, defaultVal) {
  const idx = args.indexOf(`--${name}`);
  if (idx === -1) return defaultVal;
  return args[idx + 1] || defaultVal;
}
const BOOK_ID = getFlag('book-id', null);
const DRY_RUN = args.includes('--dry-run');

if (!BOOK_ID) {
  console.error('--book-id is required');
  process.exit(1);
}

if (!DRY_RUN && (!R2_ACCOUNT_ID || !R2_ACCESS_KEY_ID || !R2_SECRET_ACCESS_KEY)) {
  console.error('R2 credentials not set');
  process.exit(1);
}

// ── R2 client ──
const r2 = DRY_RUN ? null : new S3Client({
  region: 'auto',
  endpoint: `https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
  credentials: {
    accessKeyId: R2_ACCESS_KEY_ID,
    secretAccessKey: R2_SECRET_ACCESS_KEY,
  },
});

const UA = 'SourceLibrary/1.0 (https://sourcelibrary.org; contact@sourcelibrary.org)';

/**
 * Thompson's 1930 edition page layout (approximate — to be refined after OCR):
 * The book is 59 pages. Pages 1-5 are front matter.
 * Tablets start around page 6 and are roughly 4-5 pages each.
 *
 * These mappings will be refined once OCR runs — for now, distribute tablet
 * photos across roughly equal sections. Each tablet gets its corresponding
 * photo repeated on all its pages.
 *
 * Tablet → { pages: [start, end], images: [Wikimedia filenames] }
 */
const TABLET_MAPPINGS = [
  {
    tablet: 'I',
    pages: [6, 10], // Tablet I: "He who saw the Deep"
    images: ['GilgameshTablet.jpg'], // The iconic tablet fragment
    caption: 'Fragment of Tablet I, Library of Ashurbanipal, Nineveh (BM)',
  },
  {
    tablet: 'II',
    pages: [11, 14], // Tablet II: Enkidu's creation and journey
    images: ['Fragment_of_Tablet_II_of_the_Epic_of_Gilgamesh._Old-Babylonian_period,_from_southern_Iraq._Sulaymaniyah_Museum,_Iraqi_Kurdistan.jpg'],
    caption: 'Fragment of Tablet II, Old Babylonian period, Sulaymaniyah Museum',
  },
  {
    tablet: 'III',
    pages: [15, 18], // Tablet III: Journey preparation
    images: ['CBS7771_Gilgamesh_Epic_Penn_Museum.jpg'],
    caption: 'Gilgamesh tablet fragment, Penn Museum (CBS 7771)',
  },
  {
    tablet: 'IV',
    pages: [19, 22], // Tablet IV: Journey to Cedar Forest
    images: ['The_Gilgamesh_Dream_tablet._From_Iraq._Middle_Babylonian_Period,_First_Sealand_Dynasty,_1732-1460_BCE._Iraq_Museum,_Baghdad.jpg'],
    caption: 'Dream Tablet, Middle Babylonian, Iraq Museum, Baghdad',
  },
  {
    tablet: 'V',
    pages: [23, 27], // Tablet V: Fight with Humbaba
    images: ['Tablet_V_of_the_Epic_of_Gligamesh.JPG'],
    caption: 'Tablet V (newly discovered), Sulaymaniyah Museum, Iraq',
  },
  {
    tablet: 'VI',
    pages: [28, 31], // Tablet VI: Ishtar's proposal, Bull of Heaven
    images: ['VAT4105.Gilgamesch-Epos.P1151472.jpg'],
    caption: 'Gilgamesh tablet (VAT 4105), Vorderasiatisches Museum, Berlin',
  },
  {
    tablet: 'VII',
    pages: [32, 35], // Tablet VII: Enkidu's dream and death
    images: ['GilgameshTablet.jpg'],
    caption: 'Cuneiform tablet fragment, Library of Ashurbanipal',
  },
  {
    tablet: 'VIII',
    pages: [36, 39], // Tablet VIII: Gilgamesh mourns Enkidu
    images: ['CBS7771_Gilgamesh_Epic_Penn_Museum.jpg'],
    caption: 'Gilgamesh tablet fragment, Penn Museum',
  },
  {
    tablet: 'IX',
    pages: [40, 43], // Tablet IX: Journey to Utnapishtim
    images: ['VAT4105.Gilgamesch-Epos.P1151472.jpg'],
    caption: 'Gilgamesh tablet, Vorderasiatisches Museum, Berlin',
  },
  {
    tablet: 'X',
    pages: [44, 47], // Tablet X: Siduri and the ferryman
    images: ['The_Gilgamesh_Dream_tablet._From_Iraq._Middle_Babylonian_Period,_First_Sealand_Dynasty,_1732-1460_BCE._Iraq_Museum,_Baghdad.jpg'],
    caption: 'Dream Tablet, Iraq Museum',
  },
  {
    tablet: 'XI',
    pages: [48, 54], // Tablet XI: The Flood Story (longest tablet)
    images: [
      'British_Museum_Flood_Tablet.jpg',
      'Library_of_Ashurbanipal_The_Flood_Tablet.jpg',
    ],
    caption: 'The Flood Tablet (K.3375), British Museum, Nineveh',
  },
  {
    tablet: 'XII',
    pages: [55, 59], // Tablet XII: Enkidu's ghost
    images: ['GilgameshTablet.jpg'],
    caption: 'Tablet fragment, Library of Ashurbanipal',
  },
];

// ── Helpers ──
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function uploadToR2(key, buffer, contentType = 'image/jpeg') {
  await r2.send(new PutObjectCommand({
    Bucket: R2_BUCKET,
    Key: key,
    Body: buffer,
    ContentType: contentType,
    CacheControl: 'public, max-age=86400, s-maxage=86400',
  }));
  return `${R2_PUBLIC_URL}/${key}`;
}

async function fetchWithUA(url, timeoutMs = 60_000) {
  const res = await fetch(url, {
    headers: { 'User-Agent': UA },
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  return res;
}

async function getWikimediaImageUrl(filename) {
  const apiUrl = `https://commons.wikimedia.org/w/api.php?action=query&titles=File:${encodeURIComponent(filename)}&prop=imageinfo&iiprop=url|size|mime&format=json`;
  const res = await fetchWithUA(apiUrl);
  const data = await res.json();
  const pages = data.query?.pages;
  if (!pages) return null;
  const page = Object.values(pages)[0];
  if (!page || page.missing !== undefined) return null;
  const info = page.imageinfo?.[0];
  return info ? { url: info.url, width: info.width, height: info.height, mime: info.mime } : null;
}

// ── Main ──
async function main() {
  const client = new MongoClient(MONGODB_URI, { serverSelectionTimeoutMS: 30000 });
  await client.connect();
  const db = client.db('bookstore');

  // Verify book exists
  const book = await db.collection('books').findOne(
    { id: BOOK_ID },
    { projection: { _id: 1, id: 1, title: 1, pages_count: 1 } }
  );
  if (!book) {
    console.error(`Book not found: ${BOOK_ID}`);
    await client.close();
    process.exit(1);
  }
  console.log(`Book: ${book.title} (${book.pages_count} pages)`);

  // Get all pages
  const pages = await db.collection('pages')
    .find({ book_id: BOOK_ID }, { projection: { _id: 1, id: 1, page_number: 1, photo: 1 } })
    .sort({ page_number: 1 })
    .toArray();
  console.log(`Found ${pages.length} pages`);

  // Download and archive each unique image, then assign to pages
  const imageCache = {}; // filename → R2 URL
  let pagesUpdated = 0;

  for (const mapping of TABLET_MAPPINGS) {
    const [startPage, endPage] = mapping.pages;
    const tabletPages = pages.filter(p => p.page_number >= startPage && p.page_number <= endPage);

    if (tabletPages.length === 0) {
      console.log(`  Tablet ${mapping.tablet}: no pages in range ${startPage}-${endPage}`);
      continue;
    }

    console.log(`\n  Tablet ${mapping.tablet} (pages ${startPage}-${endPage}, ${tabletPages.length} pages):`);

    // Download images for this tablet
    const imageUrls = [];
    for (const filename of mapping.images) {
      if (imageCache[filename]) {
        imageUrls.push(imageCache[filename]);
        continue;
      }

      console.log(`    Fetching: ${filename.slice(0, 60)}...`);
      const info = await getWikimediaImageUrl(filename);
      if (!info) {
        console.log(`    WARNING: image not found on Commons`);
        continue;
      }

      if (DRY_RUN) {
        imageUrls.push(info.url);
        imageCache[filename] = info.url;
      } else {
        // Download and upload to R2
        const imgRes = await fetchWithUA(info.url);
        const buffer = Buffer.from(await imgRes.arrayBuffer());
        const ext = filename.split('.').pop().toLowerCase();
        const r2Key = `tablets/${BOOK_ID}/${mapping.tablet.toLowerCase()}-${filename.slice(0, 40).replace(/[^a-zA-Z0-9]/g, '_')}.${ext}`;
        const r2Url = await uploadToR2(r2Key, buffer, info.mime || 'image/jpeg');
        console.log(`    Archived → ${r2Key}`);
        imageUrls.push(r2Url);
        imageCache[filename] = r2Url;
      }
      await sleep(1000); // polite delay for Commons
    }

    if (imageUrls.length === 0) continue;

    // Distribute images across pages for this tablet
    // If 1 image: same photo on all pages. If 2+: distribute linearly.
    for (let i = 0; i < tabletPages.length; i++) {
      const page = tabletPages[i];
      const imgIdx = Math.min(Math.floor(i * imageUrls.length / tabletPages.length), imageUrls.length - 1);
      const imgUrl = imageUrls[imgIdx];

      if (DRY_RUN) {
        console.log(`    Page ${page.page_number} → ${imgUrl.split('/').pop()?.slice(0, 50)}`);
      } else {
        await db.collection('pages').updateOne(
          { _id: page._id },
          {
            $set: {
              photo: imgUrl,
              photo_original: imgUrl,
              tablet_number: mapping.tablet,
              tablet_caption: mapping.caption,
              updated_at: new Date(),
            }
          }
        );
      }
      pagesUpdated++;
    }
    console.log(`    → ${tabletPages.length} pages aligned`);
  }

  // Update book thumbnail to Tablet XI flood tablet (most iconic)
  const floodImg = imageCache['British_Museum_Flood_Tablet.jpg'] ||
    'https://upload.wikimedia.org/wikipedia/commons/7/7a/British_Museum_Flood_Tablet.jpg';

  if (!DRY_RUN) {
    await db.collection('books').updateOne(
      { id: BOOK_ID },
      { $set: { thumbnail: floodImg, updated_at: new Date() } }
    );
  }
  console.log(`\nBook thumbnail → Flood Tablet`);
  console.log(`Done: ${pagesUpdated} pages aligned across ${TABLET_MAPPINGS.length} tablets`);

  await client.close();
}

main().catch(err => { console.error(err); process.exit(1); });
