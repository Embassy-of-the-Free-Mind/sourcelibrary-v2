#!/usr/bin/env node
/**
 * Align Wikimedia Commons manuscript images with ORAEC paginated texts.
 *
 * For each ORAEC book: searches Wikimedia Commons for manuscript images,
 * downloads them, archives to R2, and distributes across the book's pages.
 *
 * Usage:
 *   set -a; source .env.production.local; set +a
 *   node scripts/import/oraec-align-images.mjs --book-id 69e15811ec0a328a49d0a242
 *   node scripts/import/oraec-align-images.mjs --all
 *   node scripts/import/oraec-align-images.mjs --all --dry-run
 *
 * Flags:
 *   --book-id ID    Process a single book
 *   --all           Process all ORAEC books
 *   --dry-run       Preview without writing
 */
import { MongoClient, ObjectId } from 'mongodb';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import { readFileSync, existsSync } from 'fs';

// ── ENV checks ──
const MONGODB_URI = process.env.MONGODB_URI;
if (!MONGODB_URI) { console.error('MONGODB_URI not set'); process.exit(1); }

const R2_BUCKET = process.env.R2_BUCKET_NAME || 'sourcelibrary';
const R2_PUBLIC_URL = process.env.R2_PUBLIC_URL || 'https://images.sourcelibrary.org';
const R2_ACCOUNT_ID = process.env.R2_ACCOUNT_ID;
const R2_ACCESS_KEY_ID = process.env.R2_ACCESS_KEY_ID;
const R2_SECRET_ACCESS_KEY = process.env.R2_SECRET_ACCESS_KEY;
const REVALIDATE_SECRET = process.env.REVALIDATE_SECRET;

// ── CLI flags ──
const args = process.argv.slice(2);
function getFlag(name, defaultVal) {
  const idx = args.indexOf(`--${name}`);
  if (idx === -1) return defaultVal;
  return args[idx + 1] || defaultVal;
}
const BOOK_ID = getFlag('book-id', null);
const ALL = args.includes('--all');
const DRY_RUN = args.includes('--dry-run');
const CORPUS_DIR = '/tmp/oraec';

if (!BOOK_ID && !ALL) {
  console.error('Specify --book-id ID or --all');
  process.exit(1);
}

if (!DRY_RUN && (!R2_ACCOUNT_ID || !R2_ACCESS_KEY_ID || !R2_SECRET_ACCESS_KEY)) {
  console.error('R2 credentials not set (R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY)');
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

// ── Hardcoded image mappings for key texts ──
const HARDCODED_IMAGES = {
  'oraec:oraec17': [ // Sinuhe
    'Sinuhe-Papyrus_(Papyrus_Berlin_3022).jpg',
    'Papyrus_Berlin_3022_(A-I).jpg',
  ],
  'oraec:oraec30': [ // Westcar
    'PapyrusWestcar_photomerge-AltesMuseum-Berlin-1A.jpg',
    'PapyrusWestcar_photomerge-AltesMuseum-Berlin-1B.jpg',
    'PapyrusWestcar_photomerge-AltesMuseum-Berlin-2.png',
    'PapyrusWestcar_photomerge-AltesMuseum-Berlin-3.jpg',
    'PapyrusWestcar_photomerge-AltesMuseum-Berlin-3a.jpg',
    'PapyrusWestcar_photomerge-AltesMuseum-Berlin-4a.jpg',
    'PapyrusWestcar_photomerge-AltesMuseum-Berlin-5.jpg',
  ],
  'oraec:oraec21': [ // Ipuwer
    'Papyrus_van_Ipoewer_-_Google_Art_Project.jpg',
    'Ipuwer_Papyrus.jpg',
  ],
  'oraec:oraec36': [ // Ptahhotep / Prisse
    'Papyrus_Prisse_186_1.jpg',
    'Papyrus_Prisse_186_2.jpg',
    'Papyrus_Prisse_187.jpg',
    'Papyrus_Prisse_188.jpg',
    'Papyrus_Prisse_189_1.jpg',
    'Papyrus_Prisse_190_2.jpg',
    'Papyrus_Prisse_192_1.jpg',
    'Papyrus_Prisse_192_2.jpg',
    'Papyrus_Prisse_193_1.jpg',
  ],
  'oraec:oraec40': [ // Horus and Seth (Chester Beatty I)
    'Contendings_of_Horus_and_Seth_(CBL_Pap_1.2).jpg',
    'P._Chester_Beatty_I,_folio_13-14,_recto.jpg',
  ],
  'oraec:oraec13': [ // Edwin Smith Surgical Papyrus
    'Edwin_Smith_Papyrus_v2.jpg',
    'Page_from_Edwin_Smith_surgical_papyrus.._Wellcome_L0051970.jpg',
    'Page_from_Edwin_Smith_surgical_papyrus.._Wellcome_L0051967.jpg',
    'Page_from_Edwin_Smith_surgical_papyrus.._Wellcome_L0051972.jpg',
    'Page_from_Edwin_Smith_surgical_papyrus.._Wellcome_L0051971.jpg',
  ],
  'oraec:oraec58': [ // Book of the Heavenly Cow (Seti I tomb)
    'Book_of_the_Heavenly_Cow_KV17.jpg',
  ],
  'oraec:oraec1662': [ // Hymn to Aton
    'Great_Hymn_to_the_Aten_from_Ay%27s_EA25_tomb.jpg',
    'Aten_worship_-_Great_Hymn_to_Aten.jpg',
  ],
  'oraec:oraec51': [ // Two Brothers
    'Tale_of_two_brothers.jpg',
  ],
};

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

/**
 * Fetch a URL with User-Agent header and abort timeout.
 */
async function fetchWithUA(url, timeoutMs = 60_000) {
  const res = await fetch(url, {
    headers: { 'User-Agent': UA },
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  return res;
}

/**
 * Get the direct image URL and metadata for a Wikimedia Commons filename.
 */
async function getWikimediaImageInfo(filename) {
  const apiUrl = `https://commons.wikimedia.org/w/api.php?action=query&titles=File:${encodeURIComponent(filename)}&prop=imageinfo&iiprop=url|size|extmetadata|mime&format=json`;
  const res = await fetchWithUA(apiUrl);
  const data = await res.json();
  const pages = data.query?.pages;
  if (!pages) return null;
  const page = Object.values(pages)[0];
  if (!page || page.missing !== undefined) return null;
  const info = page.imageinfo?.[0];
  if (!info) return null;
  return {
    url: info.url,
    width: info.width,
    height: info.height,
    mime: info.mime || 'image/jpeg',
    filename,
  };
}

/**
 * Search Wikimedia Commons for images matching a search term.
 * Returns an array of filenames.
 */
async function searchWikimediaCommons(searchTerm) {
  const apiUrl = `https://commons.wikimedia.org/w/api.php?action=query&list=search&srsearch=${encodeURIComponent(searchTerm)}&srnamespace=6&format=json&srlimit=20`;
  const res = await fetchWithUA(apiUrl);
  const data = await res.json();
  const results = data.query?.search || [];

  // Extract filenames, filtering to images only
  const filenames = [];
  for (const result of results) {
    const title = result.title; // e.g. "File:Something.jpg"
    const filename = title.replace(/^File:/, '');
    const ext = filename.split('.').pop()?.toLowerCase();
    if (!ext || !['jpg', 'jpeg', 'png', 'tif', 'tiff'].includes(ext)) continue;
    // Skip PDFs, DjVu, GIF, SVG
    if (['pdf', 'djvu', 'gif', 'svg'].includes(ext)) continue;
    filenames.push(filename);
  }
  return filenames;
}

/**
 * Extract a search term from an ORAEC book title.
 * e.g. "Sinuhe / pBerlin P 3022 und Fragmente pAmherst m-q (B)" → "Papyrus Berlin 3022"
 */
function extractSearchTerm(title, oraecData) {
  // Try idno from corpus data first
  if (oraecData?.idno?.length) {
    const idno = oraecData.idno[0];
    // e.g. "P 3022" → "Papyrus Berlin 3022" or just use the raw idno
    return `papyrus ${idno}`;
  }

  // Extract papyrus name from title
  // Pattern: "Name / pLocation ID ..."
  const match = title.match(/\/\s*p(\w+)\s+([\w\s]+?)(?:\s+und|\s*\(|$)/i);
  if (match) {
    return `Papyrus ${match[1]} ${match[2].trim()}`;
  }

  // Fallback: use the short name before the slash
  const shortName = title.split('/')[0].trim();
  return `${shortName} papyrus Egyptian`;
}

/**
 * Filter Wikimedia results to actual manuscript photographs.
 * Removes maps, diagrams, portraits, modern photos, etc.
 */
async function filterManuscriptImages(filenames) {
  const results = [];
  for (const filename of filenames) {
    const lower = filename.toLowerCase();
    // Skip obvious non-manuscript content
    if (lower.includes('map') && !lower.includes('papyrus')) continue;
    if (lower.includes('portrait')) continue;
    if (lower.includes('photo_of_') && !lower.includes('papyrus')) continue;
    if (lower.includes('museum_exterior')) continue;
    if (lower.includes('logo')) continue;
    if (lower.includes('icon')) continue;
    if (lower.includes('diagram') && !lower.includes('papyrus')) continue;

    // Get image info to check dimensions
    await sleep(1000); // Rate limit
    const info = await getWikimediaImageInfo(filename);
    if (!info) continue;
    if (info.width < 500) continue; // Too small to be a useful manuscript image
    // Skip non-image MIME types
    if (!info.mime?.startsWith('image/')) continue;
    if (info.mime === 'image/gif' || info.mime === 'image/svg+xml') continue;

    results.push(info);
  }
  return results;
}

/**
 * Load ORAEC corpus data for a given oraec ID.
 */
function loadOraecData(oraecId) {
  // oraecId is like "oraec17"
  const filePath = `${CORPUS_DIR}/${oraecId}.json`;
  if (!existsSync(filePath)) return null;
  try {
    const raw = readFileSync(filePath, 'utf-8');
    const data = JSON.parse(raw);
    // The JSON has the ID as the top-level key
    return data[oraecId] || data;
  } catch {
    return null;
  }
}

/**
 * Download an image from a URL and return the buffer + content type.
 */
async function downloadImage(url) {
  const res = await fetchWithUA(url, 120_000);
  const buffer = Buffer.from(await res.arrayBuffer());
  const contentType = res.headers.get('content-type') || 'image/jpeg';
  return { buffer, contentType };
}

/**
 * Distribute N images across P pages.
 * Returns an array of length P, where each element is the image index (0-based).
 */
function distributeImages(numImages, numPages) {
  const assignment = [];
  for (let p = 0; p < numPages; p++) {
    const imageIdx = Math.min(
      Math.floor(p * numImages / numPages),
      numImages - 1
    );
    assignment.push(imageIdx);
  }
  return assignment;
}

/**
 * Process a single ORAEC book.
 */
async function processBook(db, book) {
  const bid = book.id || book._id.toHexString();
  const fingerprint = book.source_fingerprint;
  const oraecId = fingerprint?.replace('oraec:', '');

  console.log(`\n${'─'.repeat(60)}`);
  console.log(`Processing: ${book.title}`);
  console.log(`  Book ID: ${bid}`);
  console.log(`  Fingerprint: ${fingerprint}`);

  // Load corpus data
  const oraecData = oraecId ? loadOraecData(oraecId) : null;
  if (oraecData) {
    console.log(`  ORAEC idno: ${oraecData.idno?.join(', ') || 'none'}`);
    console.log(`  Location: ${oraecData.location?.map(l => l.location).join(', ') || 'unknown'}`);
  }

  // Get all pages for this book
  const pages = await db.collection('pages').find(
    { book_id: bid },
    { projection: { _id: 1, id: 1, page_number: 1, photo: 1, archived_photo: 1, photo_original: 1, thumbnail: 1 } }
  ).sort({ page_number: 1 }).toArray();

  if (pages.length === 0) {
    console.log('  No pages found, skipping.');
    return { status: 'skipped', reason: 'no pages' };
  }
  console.log(`  Pages: ${pages.length}`);

  // ── Resolve images ──
  let imageInfos = [];

  // Check hardcoded mappings first
  if (fingerprint && HARDCODED_IMAGES[fingerprint]) {
    const filenames = HARDCODED_IMAGES[fingerprint];
    console.log(`  Using hardcoded mapping: ${filenames.length} images`);
    for (const filename of filenames) {
      await sleep(1000);
      const info = await getWikimediaImageInfo(filename);
      if (info) {
        imageInfos.push(info);
        console.log(`    ✓ ${filename} (${info.width}x${info.height})`);
      } else {
        console.log(`    ✗ ${filename} — not found on Wikimedia`);
      }
    }
  } else {
    // Search Wikimedia Commons
    const searchTerm = extractSearchTerm(book.title, oraecData);
    console.log(`  Searching Wikimedia Commons: "${searchTerm}"`);
    await sleep(1000);
    const candidates = await searchWikimediaCommons(searchTerm);
    console.log(`  Found ${candidates.length} candidates`);

    if (candidates.length > 0) {
      imageInfos = await filterManuscriptImages(candidates);
      console.log(`  After filtering: ${imageInfos.length} manuscript images`);
      for (const info of imageInfos) {
        console.log(`    - ${info.filename} (${info.width}x${info.height})`);
      }
    }

    // If Wikimedia search yields nothing, try alternate search terms
    if (imageInfos.length === 0 && oraecData) {
      const altTerms = [];
      // Try the title before the slash
      const shortName = book.title.split('/')[0].trim();
      if (shortName.length > 3) altTerms.push(`${shortName} papyrus`);
      // Try location + idno
      if (oraecData.location?.length && oraecData.idno?.length) {
        altTerms.push(`${oraecData.location[0].location} ${oraecData.idno[0]}`);
      }

      for (const alt of altTerms) {
        if (imageInfos.length > 0) break;
        console.log(`  Trying alternate search: "${alt}"`);
        await sleep(1000);
        const altCandidates = await searchWikimediaCommons(alt);
        if (altCandidates.length > 0) {
          imageInfos = await filterManuscriptImages(altCandidates);
          console.log(`  After filtering: ${imageInfos.length} manuscript images`);
        }
      }
    }
  }

  if (imageInfos.length === 0) {
    console.log('  No images found, skipping.');
    return { status: 'skipped', reason: 'no images found' };
  }

  // Sort images by filename for consistent ordering
  imageInfos.sort((a, b) => a.filename.localeCompare(b.filename, undefined, { numeric: true }));

  // ── Distribution plan ──
  const assignment = distributeImages(imageInfos.length, pages.length);
  console.log(`\n  Distribution plan (${imageInfos.length} images → ${pages.length} pages):`);
  let currentImg = -1;
  for (let i = 0; i < pages.length; i++) {
    if (assignment[i] !== currentImg) {
      currentImg = assignment[i];
      const endPage = pages.findLastIndex((_, idx) => assignment[idx] === currentImg) + 1;
      console.log(`    Image ${currentImg + 1} (${imageInfos[currentImg].filename}): pages ${i + 1}-${endPage}`);
    }
  }

  if (DRY_RUN) {
    console.log('\n  [DRY RUN] Would download and distribute these images.');
    return { status: 'dry-run', images: imageInfos.length, pages: pages.length };
  }

  // ── Download, upload to R2, update pages ──
  // Download all unique images first
  const downloadedImages = [];
  for (let imgIdx = 0; imgIdx < imageInfos.length; imgIdx++) {
    const info = imageInfos[imgIdx];
    console.log(`  Downloading image ${imgIdx + 1}/${imageInfos.length}: ${info.filename}`);
    await sleep(1000); // Rate limit Wikimedia
    try {
      const { buffer, contentType } = await downloadImage(info.url);
      downloadedImages.push({ buffer, contentType, info });
      console.log(`    Downloaded: ${(buffer.length / 1024 / 1024).toFixed(1)} MB`);
    } catch (err) {
      console.error(`    Failed to download: ${err.message}`);
      downloadedImages.push(null);
    }
  }

  // Upload each image to R2 under the page paths for all pages it covers
  let firstArchivedUrl = null;
  let updatedCount = 0;

  for (let pageIdx = 0; pageIdx < pages.length; pageIdx++) {
    const page = pages[pageIdx];
    const imgIdx = assignment[pageIdx];
    const downloaded = downloadedImages[imgIdx];
    if (!downloaded) continue;

    const { buffer, contentType, info } = downloaded;
    const pageNum = String(page.page_number).padStart(4, '0');
    const ext = info.mime?.includes('png') ? 'png' : 'jpg';
    const r2Key = `pages/${bid}/${pageNum}.${ext}`;

    try {
      const archivedUrl = await uploadToR2(r2Key, buffer, contentType);

      // Also upload as the "archived" path
      const archivedKey = `archived/${bid}-${pageNum}.${ext}`;
      await uploadToR2(archivedKey, buffer, contentType);

      if (!firstArchivedUrl) firstArchivedUrl = archivedUrl;

      // Store the original Wikimedia URL for attribution
      const wikimediaPageUrl = `https://commons.wikimedia.org/wiki/File:${encodeURIComponent(info.filename)}`;

      // Update the page document
      await db.collection('pages').updateOne(
        { _id: page._id },
        {
          $set: {
            photo: archivedUrl,
            archived_photo: archivedUrl,
            photo_original: wikimediaPageUrl,
            thumbnail: archivedUrl,
            updated_at: new Date(),
          },
        }
      );
      updatedCount++;
    } catch (err) {
      console.error(`    Failed to upload page ${page.page_number}: ${err.message}`);
    }
  }

  // Update book thumbnail
  if (firstArchivedUrl) {
    await db.collection('books').updateOne(
      { $or: [{ id: bid }, { _id: book._id }] },
      {
        $set: {
          thumbnail: firstArchivedUrl,
          updated_at: new Date(),
        },
      }
    );
    console.log(`  Updated book thumbnail: ${firstArchivedUrl}`);
  }

  console.log(`  Done: ${updatedCount}/${pages.length} pages updated with ${imageInfos.length} images.`);

  // Revalidate if secret is set
  if (REVALIDATE_SECRET) {
    try {
      const slug = book.slug;
      if (slug) {
        await fetchWithUA(
          `https://sourcelibrary.org/api/revalidate?secret=${REVALIDATE_SECRET}&path=/book/${slug}`,
          10_000
        );
        console.log(`  Revalidated /book/${slug}`);
      }
    } catch (err) {
      console.warn(`  Revalidation failed: ${err.message}`);
    }
  }

  return { status: 'done', images: imageInfos.length, pages: updatedCount };
}

// ── Main ──
async function main() {
  const client = new MongoClient(MONGODB_URI);
  await client.connect();
  const db = client.db('bookstore');

  console.log('ORAEC Image Alignment');
  console.log(`Mode: ${DRY_RUN ? 'DRY RUN' : 'LIVE'}`);
  console.log(`Corpus dir: ${CORPUS_DIR} (${existsSync(CORPUS_DIR) ? 'found' : 'NOT FOUND'})`);

  let query = { 'image_source.provider': 'oraec' };
  if (BOOK_ID) {
    query = {
      $and: [
        { 'image_source.provider': 'oraec' },
        { $or: [{ id: BOOK_ID }, { _id: new ObjectId(BOOK_ID) }] },
      ],
    };
  }

  const books = await db.collection('books').find(query, {
    projection: { id: 1, _id: 1, title: 1, slug: 1, source_fingerprint: 1, thumbnail: 1, pages_count: 1 },
  }).toArray();

  console.log(`Found ${books.length} ORAEC book(s)`);

  const results = { done: 0, skipped: 0, 'dry-run': 0, failed: 0 };

  for (const book of books) {
    try {
      const result = await processBook(db, book);
      results[result.status] = (results[result.status] || 0) + 1;
    } catch (err) {
      console.error(`  FAILED: ${err.message}`);
      results.failed++;
    }
  }

  console.log(`\n${'═'.repeat(60)}`);
  console.log('Summary:', JSON.stringify(results));

  await client.close();
}

main().catch(err => {
  console.error('Fatal:', err);
  process.exit(1);
});
