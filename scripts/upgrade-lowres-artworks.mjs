#!/usr/bin/env node
/**
 * Find higher-resolution versions of low-res artworks.
 *
 * Strategy:
 * 1. For each hidden low-res artwork, check Wikidata for the entity
 * 2. Look for higher-res images on Commons (different filenames for same work)
 * 3. Check museum IIIF APIs (Rijksmuseum, Met, NGA, etc.)
 * 4. If found, download, upload to R2, update the book record, unhide
 *
 * Usage:
 *   set -a; source .env.production.local; set +a; node scripts/upgrade-lowres-artworks.mjs
 *   Options:
 *     --dry-run     Show what would be upgraded without writing
 *     --limit N     Process at most N artworks
 *     --source X    Only check one source: commons|rijks|met|nga|iiif
 */

import { MongoClient } from 'mongodb';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import sharp from 'sharp';

const UA = 'SourceLibrary/1.0 (https://sourcelibrary.org; contact@sourcelibrary.org)';
const MIN_UPGRADE_DIM = 800;
const DISPLAY_WIDTH = 3840;
const THUMB_WIDTH = 600;
const DELAY_MS = 200;

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// ─── Wikidata lookup ────────────────────────────────────────────────────────

/** Given a Commons filename, find the Wikidata entity and get all images */
async function findWikidataEntity(commonsTitle) {
  const filename = commonsTitle.replace('File:', '');
  // Search Wikidata for items using this image
  const url = `https://www.wikidata.org/w/api.php?action=query&list=search&srsearch=${encodeURIComponent(filename)}&srnamespace=0&srlimit=5&format=json`;
  const res = await fetch(url, { headers: { 'User-Agent': UA } });
  if (!res.ok) return null;
  const data = await res.json();

  const results = data.query?.search || [];
  if (!results.length) return null;

  // Check each result for P18 (image) claim
  for (const result of results) {
    const entityUrl = `https://www.wikidata.org/wiki/Special:EntityData/${result.title}.json`;
    const entityRes = await fetch(entityUrl, { headers: { 'User-Agent': UA } });
    if (!entityRes.ok) continue;
    const entityData = await entityRes.json();
    const entity = entityData.entities?.[result.title];
    if (!entity) continue;

    // Get P18 (image) — may have multiple
    const images = (entity.claims?.P18 || []).map(c => c.mainsnak?.datavalue?.value).filter(Boolean);
    // P973 (described at URL) — museum pages
    const describedAt = (entity.claims?.P973 || []).map(c => c.mainsnak?.datavalue?.value).filter(Boolean);
    // P217 (inventory number)
    const inventoryNo = (entity.claims?.P217 || []).map(c => c.mainsnak?.datavalue?.value).filter(Boolean);
    // P195 (collection) — museum name
    const collections = (entity.claims?.P195 || [])
      .map(c => c.mainsnak?.datavalue?.value?.id)
      .filter(Boolean);
    // P170 (creator)
    const creators = (entity.claims?.P170 || [])
      .map(c => c.mainsnak?.datavalue?.value?.id)
      .filter(Boolean);
    // P571 (inception / date created)
    const inception = entity.claims?.P571?.[0]?.mainsnak?.datavalue?.value?.time;
    // P186 (material used)
    const materials = (entity.claims?.P186 || [])
      .map(c => c.mainsnak?.datavalue?.value?.id)
      .filter(Boolean);
    // P276 (location)
    const locations = (entity.claims?.P276 || [])
      .map(c => c.mainsnak?.datavalue?.value?.id)
      .filter(Boolean);
    // P6216 (copyright status)
    const copyrightStatus = entity.claims?.P6216?.[0]?.mainsnak?.datavalue?.value?.id;

    const label = entity.labels?.en?.value || entity.labels?.de?.value || entity.labels?.fr?.value || '';
    const description = entity.descriptions?.en?.value || '';

    if (images.length > 0) {
      return {
        wikidataId: result.title,
        label,
        description,
        images,
        describedAt,
        inventoryNo,
        collections,
        creators,
        inception,
        materials,
        locations,
        copyrightStatus,
      };
    }
    await sleep(100);
  }
  return null;
}

/** Get Commons image info for a filename */
async function getCommonsImageInfo(filename) {
  const url = `https://commons.wikimedia.org/w/api.php?action=query&titles=File:${encodeURIComponent(filename)}&prop=imageinfo&iiprop=url|size|extmetadata|mime&iiurlwidth=3840&format=json`;
  const res = await fetch(url, { headers: { 'User-Agent': UA } });
  if (!res.ok) return null;
  const data = await res.json();
  const pages = Object.values(data.query?.pages || {});
  const info = pages[0]?.imageinfo?.[0];
  if (!info) return null;
  const ext = info.extmetadata || {};
  return {
    url: info.url,
    thumbUrl: info.thumburl,
    width: info.width,
    height: info.height,
    mime: info.mime,
    title: cleanHtml(ext.ObjectName?.value) || '',
    description: cleanHtml(ext.ImageDescription?.value) || '',
    artist: cleanHtml(ext.Artist?.value) || '',
    dateCreated: cleanHtml(ext.DateTimeOriginal?.value) || '',
    medium: cleanHtml(ext.Medium?.value) || '',
    dimensions: cleanHtml(ext.Dimensions?.value) || '',
    license: ext.LicenseShortName?.value || '',
    credit: cleanHtml(ext.Credit?.value) || '',
    assessment: ext.Assessments?.value || '',
  };
}

function cleanHtml(html) {
  if (!html) return '';
  return html.replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .replace(/\s+/g, ' ').trim();
}

// ─── Title matching ─────────────────────────────────────────────────────────

/** Check if a museum result plausibly matches our artwork */
function isPlausibleMatch(queryTitle, queryArtist, resultTitle, resultArtist) {
  const normalize = s => (s || '').toLowerCase().replace(/[^a-z0-9]/g, ' ').replace(/\s+/g, ' ').trim();
  const qTitle = normalize(queryTitle);
  const rTitle = normalize(resultTitle);
  const qArtist = normalize(queryArtist);
  const rArtist = normalize(resultArtist);

  // Must share significant words in title (exclude very common words)
  const stopWords = new Set(['the', 'and', 'with', 'from', 'for', 'saint', 'san', 'santa', 'detail', 'painting', 'portrait', 'madonna', 'virgin', 'child']);
  const qWords = new Set(qTitle.split(' ').filter(w => w.length > 2 && !stopWords.has(w)));
  const rWords = new Set(rTitle.split(' ').filter(w => w.length > 2 && !stopWords.has(w)));
  const shared = [...qWords].filter(w => rWords.has(w));
  const titleOverlap = qWords.size > 0 ? shared.length / qWords.size : 0;

  // Artist surname match (last word of artist name, or any word > 4 chars)
  const qArtistWords = qArtist.split(' ').filter(w => w.length > 3);
  const rArtistWords = rArtist.split(' ').filter(w => w.length > 3);
  const artistMatch = qArtistWords.some(w => rArtistWords.includes(w));

  // Strict: need strong title match, artist match is supporting evidence only
  if (titleOverlap >= 0.6 && shared.length >= 2) return true;
  if (artistMatch && titleOverlap >= 0.5 && shared.length >= 2) return true;
  // Exact title substring match (handles "Hercules and Telephos" → "Farnese Hercules")
  if (qTitle.length > 8 && (rTitle.includes(qTitle) || qTitle.includes(rTitle))) return true;

  return false;
}

// ─── Museum APIs ────────────────────────────────────────────────────────────

/** Rijksmuseum API — returns high-res image URL if available */
async function searchRijksmuseum(title, artist) {
  const key = process.env.RIJKS_API_KEY;
  if (!key) return null;
  const q = encodeURIComponent(`${artist} ${title}`.slice(0, 100));
  const url = `https://www.rijksmuseum.nl/api/en/collection?key=${key}&q=${q}&ps=5&imgonly=true&format=json`;
  const res = await fetch(url, { headers: { 'User-Agent': UA } });
  if (!res.ok) return null;
  const data = await res.json();
  for (const obj of data.artObjects || []) {
    if (!obj.webImage?.url) continue;
    if (!isPlausibleMatch(title, artist, obj.title, obj.principalOrFirstMaker)) continue;
    const imageUrl = obj.webImage.url.replace(/=s\d+$/, '=s3840');
    return {
      source: 'rijksmuseum',
      imageUrl,
      width: obj.webImage.width,
      height: obj.webImage.height,
      objectUrl: `https://www.rijksmuseum.nl/en/collection/${obj.objectNumber}`,
      objectNumber: obj.objectNumber,
      title: obj.title,
      artist: obj.principalOrFirstMaker,
      license: 'CC0-1.0',
    };
  }
  return null;
}

/** Metropolitan Museum of Art — CC0 images */
async function searchMet(title, artist) {
  const q = encodeURIComponent(`${artist} ${title}`.slice(0, 100));
  const url = `https://collectionapi.metmuseum.org/public/collection/v1/search?q=${q}&hasImages=true`;
  const res = await fetch(url, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(10000) });
  if (!res.ok) return null;
  const data = await res.json();
  if (!data.objectIDs?.length) return null;

  // Check first few results
  for (const id of data.objectIDs.slice(0, 3)) {
    const objRes = await fetch(`https://collectionapi.metmuseum.org/public/collection/v1/objects/${id}`,
      { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(10000) });
    if (!objRes.ok) continue;
    const obj = await objRes.json();
    if (!obj.primaryImage || !obj.isPublicDomain) continue;
    if (!isPlausibleMatch(title, artist, obj.title, obj.artistDisplayName)) continue;
    return {
      source: 'met',
      imageUrl: obj.primaryImage,
      objectUrl: obj.objectURL,
      objectNumber: String(obj.objectID),
      title: obj.title,
      artist: obj.artistDisplayName,
      dateCreated: obj.objectDate,
      medium: obj.medium,
      dimensions: obj.dimensions,
      department: obj.department,
      license: 'CC0-1.0',
    };
  }
  return null;
}

/** National Gallery of Art (Washington) — public domain IIIF */
async function searchNGA(title, artist) {
  const q = encodeURIComponent(`${artist} ${title}`.slice(0, 80));
  const url = `https://api.nga.gov/art/tms/objects.json?apikey=DEMO_KEY&keyword=${q}&hasImage=true`;
  try {
    const res = await fetch(url, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(10000) });
    if (!res.ok) return null;
    const data = await res.json();
    if (!data.data?.length) return null;
    const obj = data.data[0];
    if (!obj.primaryImage) return null;
    return {
      source: 'nga',
      imageUrl: obj.primaryImage,
      objectUrl: `https://www.nga.gov/collection/art-object-page.${obj.objectID}.html`,
      objectNumber: String(obj.objectID),
      title: obj.title,
      artist: obj.attribution,
      license: 'CC0-1.0',
    };
  } catch { return null; }
}

/** Art Institute of Chicago — CC0 IIIF images */
async function searchAIC(title, artist) {
  const q = encodeURIComponent(`${artist} ${title}`.slice(0, 100));
  const url = `https://api.artic.edu/api/v1/artworks/search?q=${q}&fields=id,title,image_id,artist_title,date_display,medium_display,dimensions,is_public_domain&limit=5`;
  try {
    const res = await fetch(url, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(10000) });
    if (!res.ok) return null;
    const data = await res.json();
    for (const obj of data.data || []) {
      if (!obj.image_id || !obj.is_public_domain) continue;
      if (!isPlausibleMatch(title, artist, obj.title, obj.artist_title)) continue;
      const imageUrl = `https://www.artic.edu/iiif/2/${obj.image_id}/full/3840,/0/default.jpg`;
      return {
        source: 'aic',
        imageUrl,
        objectUrl: `https://www.artic.edu/artworks/${obj.id}`,
        objectNumber: String(obj.id),
        title: obj.title,
        artist: obj.artist_title,
        dateCreated: obj.date_display,
        medium: obj.medium_display,
        dimensions: obj.dimensions,
        license: 'CC0-1.0',
      };
    }
  } catch { /* ignore */ }
  return null;
}

// ─── R2 Upload ──────────────────────────────────────────────────────────────

async function uploadToR2(s3, imageUrl, key) {
  const res = await fetch(imageUrl, {
    headers: { 'User-Agent': UA },
    signal: AbortSignal.timeout(60000),
  });
  if (!res.ok) return null;
  const buffer = Buffer.from(await res.arrayBuffer());
  const metadata = await sharp(buffer).metadata();

  if (Math.max(metadata.width, metadata.height) < MIN_UPGRADE_DIM) return null;

  const displayBuffer = await sharp(buffer)
    .resize({ width: DISPLAY_WIDTH, withoutEnlargement: true })
    .jpeg({ quality: 85, mozjpeg: true })
    .toBuffer();

  const displayMeta = await sharp(displayBuffer).metadata();

  await s3.send(new PutObjectCommand({
    Bucket: process.env.R2_BUCKET_NAME,
    Key: key,
    Body: displayBuffer,
    ContentType: 'image/jpeg',
    CacheControl: 'public, max-age=31536000, immutable',
  }));

  const thumbKey = key.replace(/\.jpg$/, '-thumb.jpg');
  const thumbBuffer = await sharp(buffer)
    .resize({ width: THUMB_WIDTH, withoutEnlargement: true })
    .jpeg({ quality: 80, mozjpeg: true })
    .toBuffer();
  await s3.send(new PutObjectCommand({
    Bucket: process.env.R2_BUCKET_NAME,
    Key: thumbKey,
    Body: thumbBuffer,
    ContentType: 'image/jpeg',
    CacheControl: 'public, max-age=31536000, immutable',
  }));

  return {
    display: `https://images.sourcelibrary.org/${key}`,
    thumb: `https://images.sourcelibrary.org/${thumbKey}`,
    width: displayMeta.width,
    height: displayMeta.height,
    originalWidth: metadata.width,
    originalHeight: metadata.height,
  };
}

// ─── Resolve Wikidata entity IDs to labels ──────────────────────────────────

async function resolveEntityLabels(ids) {
  if (!ids.length) return {};
  const url = `https://www.wikidata.org/w/api.php?action=wbgetentities&ids=${ids.join('|')}&props=labels&languages=en|de|fr|la&format=json`;
  const res = await fetch(url, { headers: { 'User-Agent': UA } });
  if (!res.ok) return {};
  const data = await res.json();
  const labels = {};
  for (const [id, entity] of Object.entries(data.entities || {})) {
    labels[id] = entity.labels?.en?.value || entity.labels?.de?.value || entity.labels?.fr?.value || id;
  }
  return labels;
}

// ─── Main ───────────────────────────────────────────────────────────────────

async function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes('--dry-run');
  const limitIdx = args.indexOf('--limit');
  const limit = limitIdx >= 0 ? parseInt(args[limitIdx + 1]) : Infinity;

  console.log(`Mode: ${dryRun ? 'DRY RUN' : 'LIVE'} | Limit: ${limit === Infinity ? 'none' : limit}`);

  const client = new MongoClient(process.env.MONGODB_URI);
  await client.connect();
  const db = client.db('bookstore');

  let s3 = null;
  if (!dryRun) {
    s3 = new S3Client({
      region: 'auto',
      endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
      credentials: {
        accessKeyId: process.env.R2_ACCESS_KEY_ID,
        secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
      },
    });
  }

  // Get all low-res artworks
  const lowRes = await db.collection('books').find(
    { commons_full_url: { $exists: true }, hidden_reason: 'low_resolution' },
    { projection: { slug: 1, title: 1, author: 1, commons_title: 1, commons_full_url: 1, commons_width: 1, commons_height: 1 } }
  ).toArray();

  console.log(`Found ${lowRes.length} low-res artworks to upgrade\n`);

  let upgraded = 0, noUpgrade = 0, errors = 0;

  for (const book of lowRes) {
    if (upgraded >= limit) break;

    const oldMax = Math.max(book.commons_width || 0, book.commons_height || 0);
    console.log(`\n─── ${book.title?.slice(0, 60)} (${oldMax}px) ───`);

    try {
      // Strategy 1: Check Wikidata for alternate Commons images
      let bestImage = null;
      let wikidataMetadata = null;

      const wdEntity = await findWikidataEntity(book.commons_title);
      if (wdEntity) {
        console.log(`  Wikidata: ${wdEntity.wikidataId} — ${wdEntity.label}`);
        wikidataMetadata = wdEntity;

        // Check all P18 images for higher-res versions
        for (const imgFilename of wdEntity.images) {
          if (`File:${imgFilename}` === book.commons_title) continue; // Skip current
          const info = await getCommonsImageInfo(imgFilename);
          if (!info) continue;
          const maxDim = Math.max(info.width, info.height);
          if (maxDim >= MIN_UPGRADE_DIM && maxDim > oldMax) {
            console.log(`  Found better Commons image: ${imgFilename} (${info.width}x${info.height})`);
            bestImage = { ...info, source: 'commons', filename: imgFilename };
            break;
          }
          await sleep(DELAY_MS);
        }
      }

      // Strategy 2: Try museum APIs
      const searchTitle = (book.title || '').replace(/^art-/, '').slice(0, 80);
      const searchArtist = book.author || '';

      if (!bestImage) {
        const rijks = await searchRijksmuseum(searchTitle, searchArtist);
        if (rijks) {
          console.log(`  Found on Rijksmuseum: ${rijks.title} (${rijks.objectNumber})`);
          bestImage = rijks;
        }
        await sleep(DELAY_MS);
      }

      if (!bestImage) {
        const met = await searchMet(searchTitle, searchArtist);
        if (met) {
          console.log(`  Found on Met: ${met.title} (${met.objectNumber})`);
          bestImage = met;
        }
        await sleep(DELAY_MS);
      }

      if (!bestImage) {
        const aic = await searchAIC(searchTitle, searchArtist);
        if (aic) {
          console.log(`  Found on AIC: ${aic.title} (${aic.objectNumber})`);
          bestImage = aic;
        }
        await sleep(DELAY_MS);
      }

      if (!bestImage) {
        console.log(`  No higher-res source found`);
        noUpgrade++;
        continue;
      }

      // Resolve Wikidata entity labels for metadata enrichment
      let entityLabels = {};
      if (wikidataMetadata) {
        const allIds = [
          ...wikidataMetadata.collections,
          ...wikidataMetadata.creators,
          ...wikidataMetadata.materials,
          ...wikidataMetadata.locations,
        ].filter(Boolean);
        if (allIds.length) {
          entityLabels = await resolveEntityLabels(allIds);
        }
      }

      if (dryRun) {
        console.log(`  [DRY] Would upgrade from ${bestImage.source}: ${bestImage.imageUrl?.slice(0, 100)}`);
        if (wikidataMetadata) {
          console.log(`  [DRY] Wikidata metadata: creator=${wikidataMetadata.creators.map(c => entityLabels[c] || c).join(', ')}, ` +
            `location=${wikidataMetadata.locations.map(l => entityLabels[l] || l).join(', ')}, ` +
            `collection=${wikidataMetadata.collections.map(c => entityLabels[c] || c).join(', ')}`);
        }
        upgraded++;
        continue;
      }

      // Download and upload to R2
      const imageUrl = bestImage.source === 'commons'
        ? bestImage.url || bestImage.thumbUrl
        : bestImage.imageUrl;

      const r2Key = `artwork/${book.slug.replace(/^art-/, '')}.jpg`;
      const result = await uploadToR2(s3, imageUrl, r2Key);

      if (!result) {
        console.log(`  Upload failed or image still too small`);
        noUpgrade++;
        continue;
      }

      // Build update with full metadata
      const update = {
        thumbnail_blob: result.display,
        thumbnail: result.thumb,
        full_width: result.originalWidth,
        full_height: result.originalHeight,
        hidden: false,
        hidden_reason: null,
        updated_at: new Date(),
        upgrade_source: bestImage.source,
        upgrade_date: new Date(),
      };

      // Enrich with Wikidata metadata if available
      if (wikidataMetadata) {
        update.wikidata_id = wikidataMetadata.wikidataId;
        if (wikidataMetadata.label) update.display_title = wikidataMetadata.label;
        if (wikidataMetadata.description) update.wikidata_description = wikidataMetadata.description;
        if (wikidataMetadata.inception) update.date_inception = wikidataMetadata.inception;
        if (wikidataMetadata.inventoryNo?.length) update.inventory_number = wikidataMetadata.inventoryNo[0];
        if (wikidataMetadata.describedAt?.length) update.museum_url = wikidataMetadata.describedAt[0];
        if (wikidataMetadata.collections.length) {
          update.holding_institution = wikidataMetadata.collections.map(c => entityLabels[c] || c).join('; ');
        }
        if (wikidataMetadata.locations.length) {
          update.current_location = wikidataMetadata.locations.map(l => entityLabels[l] || l).join('; ');
        }
        if (wikidataMetadata.materials.length) {
          update.materials = wikidataMetadata.materials.map(m => entityLabels[m] || m);
        }
      }

      // Museum-specific metadata
      if (bestImage.source !== 'commons') {
        update.museum_source = bestImage.source;
        if (bestImage.objectUrl) update.museum_url = bestImage.objectUrl;
        if (bestImage.objectNumber) update.museum_object_number = bestImage.objectNumber;
        if (bestImage.license) update['image_source.license'] = bestImage.license;
        if (bestImage.medium) update.medium = bestImage.medium;
        if (bestImage.dimensions) update.dimensions_display = bestImage.dimensions;
        if (bestImage.dateCreated) update.published = bestImage.dateCreated;
      } else {
        // Better Commons image — update commons fields
        update.commons_title = `File:${bestImage.filename}`;
        update.commons_full_url = bestImage.url;
        update.commons_width = bestImage.width;
        update.commons_height = bestImage.height;
        if (bestImage.title) update.display_title = update.display_title || bestImage.title;
        if (bestImage.artist) update.author = bestImage.artist;
        if (bestImage.medium) update.medium = bestImage.medium;
        if (bestImage.credit) update.commons_credit = bestImage.credit;
      }

      await db.collection('books').updateOne(
        { _id: book._id },
        { $set: update }
      );

      console.log(`  UPGRADED: ${result.originalWidth}x${result.originalHeight} from ${bestImage.source}`);
      upgraded++;

    } catch (err) {
      console.error(`  ERROR: ${err.message}`);
      errors++;
    }

    await sleep(DELAY_MS);
  }

  console.log(`\n━━━ DONE ━━━`);
  console.log(`Upgraded: ${upgraded}`);
  console.log(`No upgrade found: ${noUpgrade}`);
  console.log(`Errors: ${errors}`);
  console.log(`Remaining hidden: ${lowRes.length - upgraded}`);

  await client.close();
}

main().catch(err => { console.error('Fatal:', err); process.exit(1); });
