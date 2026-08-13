#!/usr/bin/env node
/**
 * Import artwork from Wikimedia Commons, Met Open Access, Rijksmuseum, or direct URLs.
 * Each image becomes its own book document with content_type: 'artwork'.
 * NO pages collection entries — the thumbnail IS the artwork.
 *
 * Usage: set -a; source .env.production.local; set +a; node scripts/import/import-artwork.mjs artworks.json
 *
 * Input JSON format — array of entries:
 *
 * wikimedia_commons:
 *   { source: "wikimedia_commons", category: "Category:I_modi_...", collections: [...], resource_type: "print" }
 *
 * met_openaccess:
 *   { source: "met_openaccess", object_ids: [341366, ...], collections: [...], resource_type: "print" }
 *
 * rijksmuseum:
 *   { source: "rijksmuseum", object_ids: ["RP-P-2006-274", ...], collections: [...], resource_type: "print" }
 *
 * direct_urls:
 *   { source: "direct_urls", images: [{ url, title, author, date, medium, source_url, license }], collections: [...], resource_type: "painting" }
 */
import { MongoClient, ObjectId } from 'mongodb';
import fs from 'fs';

const MONGODB_URI = process.env.MONGODB_URI;
if (!MONGODB_URI) { console.error('MONGODB_URI not set'); process.exit(1); }

// ── helpers ──

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

// Strip HTML tags from a string
function stripHtml(s) { return (s || '').replace(/<[^>]*>/g, '').trim(); }

// ── Wikimedia Commons fetcher ──
// Returns array of individual artwork metadata objects

async function fetchWikimediaCategory(category) {
  const filePages = [];
  let cmcontinue = null;
  const catTitle = category.startsWith('Category:') ? category : `Category:${category}`;

  // Step 1: get all file members of the category
  do {
    const params = new URLSearchParams({
      action: 'query', list: 'categorymembers', cmtitle: catTitle,
      cmtype: 'file', cmlimit: '500', format: 'json',
    });
    if (cmcontinue) params.set('cmcontinue', cmcontinue);

    const res = await fetch(`https://commons.wikimedia.org/w/api.php?${params}`, { signal: AbortSignal.timeout(30000) });
    if (!res.ok) throw new Error(`Wikimedia category API HTTP ${res.status}`);
    const data = await res.json();

    for (const m of (data.query?.categorymembers || [])) {
      filePages.push(m.title); // e.g. "File:Something.jpg"
    }
    cmcontinue = data.continue?.cmcontinue || null;
    if (cmcontinue) await sleep(1500);
  } while (cmcontinue);

  if (filePages.length === 0) return [];

  // Step 2: fetch imageinfo + extmetadata in batches of 50
  const results = [];
  for (let i = 0; i < filePages.length; i += 50) {
    const batch = filePages.slice(i, i + 50);
    const titles = batch.join('|');

    const params = new URLSearchParams({
      action: 'query', titles, prop: 'imageinfo',
      iiprop: 'url|size|mime|extmetadata', format: 'json',
    });

    const res = await fetch(`https://commons.wikimedia.org/w/api.php?${params}`, { signal: AbortSignal.timeout(30000) });
    if (!res.ok) throw new Error(`Wikimedia imageinfo API HTTP ${res.status}`);
    const data = await res.json();

    for (const page of Object.values(data.query?.pages || {})) {
      const info = page.imageinfo?.[0];
      if (!info?.url || !info.mime?.startsWith('image/')) continue;

      const ext = info.extmetadata || {};
      const objectName = stripHtml(ext.ObjectName?.value || '');
      const artist = stripHtml(ext.Artist?.value || '');
      const dateStr = stripHtml(ext.DateTimeOriginal?.value || ext.DateTime?.value || '');
      const description = stripHtml(ext.ImageDescription?.value || '');
      const licenseShort = ext.LicenseShortName?.value || '';
      const licenseUrl = ext.LicenseUrl?.value || '';
      const categories = ext.Categories?.value || '';

      // Derive a title: ObjectName > filename without extension
      const fallbackTitle = page.title?.replace(/^File:/, '').replace(/\.\w+$/, '') || 'Untitled';
      const title = objectName || fallbackTitle;

      results.push({
        url: info.url,
        width: info.width || null,
        height: info.height || null,
        title,
        author: artist || 'Unknown artist',
        date: dateStr || null,
        commons_description: description || null,
        commons_categories: categories || null,
        commons_page_title: page.title,
        license: licenseUrl || licenseShort || 'publicdomain',
        license_short: licenseShort || null,
        source_url: `https://commons.wikimedia.org/wiki/${encodeURIComponent(page.title)}`,
      });
    }

    if (i + 50 < filePages.length) await sleep(1500);
  }

  return results;
}

// ── Wikimedia individual files fetcher ──
// Same as category fetcher step 2, but for an explicit list of File: titles

async function fetchWikimediaFiles(fileTitles) {
  const results = [];
  for (let i = 0; i < fileTitles.length; i += 50) {
    const batch = fileTitles.slice(i, i + 50);
    const titles = batch.join('|');

    const params = new URLSearchParams({
      action: 'query', titles, prop: 'imageinfo',
      iiprop: 'url|size|mime|extmetadata', format: 'json',
    });

    const res = await fetch(`https://commons.wikimedia.org/w/api.php?${params}`, { signal: AbortSignal.timeout(30000) });
    if (!res.ok) throw new Error(`Wikimedia imageinfo API HTTP ${res.status}`);
    const data = await res.json();

    for (const page of Object.values(data.query?.pages || {})) {
      if (page.missing !== undefined) {
        console.warn(`  WARNING: file not found on Commons: ${page.title}`);
        continue;
      }
      const info = page.imageinfo?.[0];
      if (!info?.url || !info.mime?.startsWith('image/')) continue;

      const ext = info.extmetadata || {};
      const objectName = stripHtml(ext.ObjectName?.value || '');
      const artist = stripHtml(ext.Artist?.value || '');
      const dateStr = stripHtml(ext.DateTimeOriginal?.value || ext.DateTime?.value || '');
      const description = stripHtml(ext.ImageDescription?.value || '');
      const licenseShort = ext.LicenseShortName?.value || '';
      const licenseUrl = ext.LicenseUrl?.value || '';
      const categories = ext.Categories?.value || '';

      const fallbackTitle = page.title?.replace(/^File:/, '').replace(/\.\w+$/, '') || 'Untitled';
      const title = objectName || fallbackTitle;

      results.push({
        url: info.url,
        width: info.width || null,
        height: info.height || null,
        title,
        author: artist || 'Unknown artist',
        date: dateStr || null,
        commons_description: description || null,
        commons_categories: categories || null,
        commons_page_title: page.title,
        license: licenseUrl || licenseShort || 'publicdomain',
        license_short: licenseShort || null,
        source_url: `https://commons.wikimedia.org/wiki/${encodeURIComponent(page.title)}`,
      });
    }

    if (i + 50 < fileTitles.length) await sleep(1500);
  }

  return results;
}

// ── Met Open Access fetcher ──
// Returns one artwork object per object_id (using primaryImage only)

async function fetchMetObjects(objectIds) {
  const results = [];

  for (let i = 0; i < objectIds.length; i++) {
    const id = objectIds[i];
    try {
      const res = await fetch(
        `https://collectionapi.metmuseum.org/public/collection/v1/objects/${id}`,
        { signal: AbortSignal.timeout(15000) }
      );
      if (!res.ok) { console.warn(`  Met object ${id}: HTTP ${res.status}`); continue; }
      const obj = await res.json();

      if (!obj.primaryImage) {
        console.warn(`  Met object ${id}: no primaryImage (isPublicDomain=${obj.isPublicDomain})`);
        continue;
      }

      results.push({
        url: obj.primaryImage,
        title: obj.title || `Met Object ${id}`,
        author: obj.artistDisplayName || 'Unknown artist',
        date: obj.objectDate || null,
        medium: obj.medium || null,
        dimensions: obj.dimensions || null,
        department: obj.department || null,
        accession_number: obj.accessionNumber || null,
        credit_line: obj.creditLine || null,
        repository: obj.repository || null,
        source_url: obj.objectURL || `https://www.metmuseum.org/art/collection/search/${id}`,
        met_object_id: id,
        license: obj.isPublicDomain ? 'https://creativecommons.org/publicdomain/zero/1.0/' : null,
      });
    } catch (err) {
      console.warn(`  Met object ${id}: ${err.message}`);
    }

    if (i < objectIds.length - 1) await sleep(1000);
  }

  return results;
}

// ── Rijksmuseum scraper ──
// Scrapes object page to find Micrio IIIF ID, title, artist, date

async function fetchRijksmuseumObjects(objectIds) {
  const results = [];

  for (let i = 0; i < objectIds.length; i++) {
    const objId = objectIds[i];
    try {
      const pageUrl = `https://www.rijksmuseum.nl/en/collection/${objId}`;
      const res = await fetch(pageUrl, {
        signal: AbortSignal.timeout(30000),
        headers: { 'User-Agent': 'SourceLibrary/1.0 (https://sourcelibrary.org; scholarly research)' },
      });
      if (!res.ok) { console.warn(`  Rijksmuseum ${objId}: HTTP ${res.status}`); continue; }
      const html = await res.text();

      // Extract Micrio IIIF ID from the page (pattern: data-micrio-id="..." or micr.io/{ID})
      let micrioId = null;
      const micrioMatch = html.match(/data-micrio-id="([^"]+)"/) || html.match(/micr\.io\/([a-zA-Z0-9]+)/);
      if (micrioMatch) micrioId = micrioMatch[1];

      // Extract title from og:title or <title>
      const titleMatch = html.match(/<meta\s+property="og:title"\s+content="([^"]+)"/)
        || html.match(/<title>([^<]+)<\/title>/);
      let title = titleMatch ? stripHtml(titleMatch[1]).replace(/ - Rijksmuseum$/, '').trim() : objId;

      // Extract artist from og:description or structured data
      const descMatch = html.match(/<meta\s+property="og:description"\s+content="([^"]+)"/);
      let artist = 'Unknown artist';
      let date = null;
      if (descMatch) {
        const desc = stripHtml(descMatch[1]);
        // Common pattern: "Artist Name, date, medium"
        const parts = desc.split(',').map(p => p.trim());
        if (parts.length >= 1) artist = parts[0];
        if (parts.length >= 2) date = parts[1];
      }

      // Build image URL
      let imageUrl;
      if (micrioId) {
        imageUrl = `https://iiif.micr.io/${micrioId}/full/full/0/default.jpg`;
      } else {
        // Fallback: try OG image
        const ogImg = html.match(/<meta\s+property="og:image"\s+content="([^"]+)"/);
        if (ogImg) {
          imageUrl = ogImg[1];
        } else {
          console.warn(`  Rijksmuseum ${objId}: no image found`);
          continue;
        }
      }

      results.push({
        url: imageUrl,
        title,
        author: artist,
        date,
        source_url: pageUrl,
        rijksmuseum_id: objId,
        micrio_id: micrioId,
        license: 'https://creativecommons.org/publicdomain/zero/1.0/',
      });
    } catch (err) {
      console.warn(`  Rijksmuseum ${objId}: ${err.message}`);
    }

    if (i < objectIds.length - 1) await sleep(2000);
  }

  return results;
}

// ── Create a single artwork book document ──

async function createArtworkDoc(db, artwork, entry) {
  const normTitle = normalizeTitle(artwork.title);
  const normAuthor = normalizeAuthor(artwork.author);

  // Dupe check: use source URL first (most reliable), then title+author as fallback
  const sourceUrl = artwork.source_url || artwork.commons_page_title || null;
  if (sourceUrl) {
    const existingBySource = await db.collection('books').findOne(
      { $or: [
        { 'image_source.source_url': sourceUrl },
        { 'dublin_core.dc_source': sourceUrl },
        { commons_page_title: artwork.commons_page_title },
      ].filter(q => Object.values(q)[0]) },
      { projection: { _id: 1, title: 1 }, maxTimeMS: 30000 }
    );
    if (existingBySource) {
      return { status: 'skip', reason: `dupe: ${existingBySource.title?.slice(0, 40)}` };
    }
  }

  // For non-generic titles, also check title+author
  const genericTitles = new Set(['print', 'drawing', 'painting', 'photograph', 'untitled', 'sculpture', 'engraving', 'woodcut']);
  if (!genericTitles.has(normTitle)) {
    const dupeQuery = { normalized_title: normTitle };
    if (normAuthor && normAuthor !== 'unknown artist') dupeQuery.normalized_author = normAuthor;
    const existing = await db.collection('books').findOne(
      dupeQuery,
      { projection: { _id: 1, title: 1 }, maxTimeMS: 30000 }
    );
    if (existing) {
      return { status: 'skip', reason: `dupe: ${existing.title?.slice(0, 40)}` };
    }
  }

  const bookId = new ObjectId();
  const bookIdStr = bookId.toHexString();
  const slug = await generateSlug(db, artwork.title);

  // Determine provider info
  const source = entry.source;
  let provider, providerName, attribution, contributingLibrary;

  if (source === 'wikimedia_commons') {
    provider = 'wikimedia_commons';
    providerName = 'Wikimedia Commons';
    attribution = 'Wikimedia Commons';
    contributingLibrary = entry.contributing_library || null;
  } else if (source === 'met_openaccess') {
    provider = 'met_openaccess';
    providerName = 'Metropolitan Museum of Art';
    attribution = artwork.credit_line || 'Metropolitan Museum of Art';
    contributingLibrary = artwork.repository || 'Metropolitan Museum of Art (New York)';
  } else if (source === 'rijksmuseum') {
    provider = 'rijksmuseum';
    providerName = 'Rijksmuseum';
    attribution = 'Rijksmuseum';
    contributingLibrary = 'Rijksmuseum (Amsterdam)';
  } else {
    provider = 'direct_urls';
    providerName = entry.provider || 'Direct Source';
    attribution = entry.attribution || null;
    contributingLibrary = entry.contributing_library || null;
  }

  // Extract year from date string
  let year = null;
  if (artwork.date) {
    const yearMatch = artwork.date.match(/(\d{4})/);
    if (yearMatch) year = parseInt(yearMatch[1], 10);
  }

  const bookDoc = {
    _id: bookId,
    id: bookIdStr,
    slug,
    title: artwork.title,
    display_title: artwork.title,
    author: artwork.author || 'Unknown artist',
    language: entry.language || entry.original_language || 'Unknown',
    original_language: entry.original_language || null,
    published: artwork.date || 'Unknown',
    ...(year ? { year } : {}),
    thumbnail: artwork.url,
    image_display: artwork.url,
    image_source_url: artwork.url,
    pageCount: 1,
    pages_count: 1,
    pages_ocr: 0,
    pages_translated: 0,
    content_type: 'artwork',
    resource_type: entry.resource_type || 'print',
    status: 'live',
    hidden: false,
    visible: true,
    categories: entry.categories || ['visual-art'],
    ...(entry.collections?.length ? { collections: entry.collections } : {}),
    image_source: {
      provider,
      provider_name: providerName,
      source_url: artwork.source_url || artwork.url,
      license: artwork.license || entry.license || 'publicdomain',
      ...(attribution ? { attribution } : {}),
      ...(contributingLibrary ? { contributing_library: contributingLibrary } : {}),
      access_date: new Date(),
    },
    dublin_core: {
      dc_identifier: [`${provider}:${artwork.met_object_id || artwork.rijksmuseum_id || artwork.commons_page_title || slug}`],
      dc_source: artwork.source_url || artwork.url,
      ...(artwork.medium ? { dc_format: artwork.medium } : {}),
    },
    // Artwork-specific metadata
    ...(artwork.medium ? { medium: artwork.medium } : {}),
    ...(artwork.dimensions ? { dimensions: artwork.dimensions } : {}),
    ...(artwork.department ? { department: artwork.department } : {}),
    ...(artwork.accession_number ? { accession_number: artwork.accession_number } : {}),
    ...(artwork.commons_description ? { commons_description: artwork.commons_description } : {}),
    ...(artwork.commons_categories ? { commons_categories: artwork.commons_categories } : {}),
    ...(artwork.commons_page_title ? { commons_page_title: artwork.commons_page_title } : {}),
    // Original image dimensions and full-res URL for archival
    ...(artwork.width ? { commons_width: artwork.width, image_width: artwork.width } : {}),
    ...(artwork.height ? { commons_height: artwork.height, image_height: artwork.height } : {}),
    commons_full_url: artwork.url, // Full-res original (thumbnail may later be replaced by R2)
    ...(artwork.met_object_id ? { met_object_id: artwork.met_object_id } : {}),
    ...(artwork.rijksmuseum_id ? { rijksmuseum_id: artwork.rijksmuseum_id } : {}),
    ...(artwork.micrio_id ? { micrio_id: artwork.micrio_id } : {}),
    source_fingerprint: `artwork:${normTitle}:${normAuthor}`,
    normalized_title: normTitle,
    normalized_author: normAuthor,
    created_at: new Date(),
    updated_at: new Date(),
  };

  await db.collection('books').insertOne(bookDoc);
  return { status: 'ok', id: bookIdStr, title: artwork.title };
}

// ── main ──

async function main() {
  const arg = process.argv[2];
  if (!arg) {
    console.error('Usage: node import-artwork.mjs <artworks.json>');
    process.exit(1);
  }

  const imports = JSON.parse(fs.readFileSync(arg, 'utf8'));
  if (!Array.isArray(imports)) {
    console.error('Input must be a JSON array');
    process.exit(1);
  }

  const client = new MongoClient(MONGODB_URI, { serverSelectionTimeoutMS: 30000 });
  await client.connect();
  const db = client.db('bookstore');

  let imported = 0, skipped = 0, errors = 0;
  const importedIds = [];

  for (let e = 0; e < imports.length; e++) {
    const entry = imports[e];
    const label = entry.source + (entry.category ? `:${entry.category}` : entry.object_ids ? `:${entry.object_ids.length} objects` : '');
    console.log(`\n=== [${e + 1}/${imports.length}] ${label} ===`);

    try {
      // Fetch artwork metadata based on source type
      let artworks = [];

      if (entry.source === 'wikimedia_commons') {
        if (!entry.category && !entry.files?.length) { console.log('ERROR: missing category or files'); errors++; continue; }
        if (entry.files?.length) {
          process.stdout.write(`  Fetching ${entry.files.length} Wikimedia files ... `);
          artworks = await fetchWikimediaFiles(entry.files);
        } else {
          process.stdout.write(`  Fetching Wikimedia category ${entry.category} ... `);
          artworks = await fetchWikimediaCategory(entry.category);
        }
        console.log(`${artworks.length} images`);

      } else if (entry.source === 'met_openaccess') {
        if (!entry.object_ids?.length) { console.log('ERROR: missing object_ids'); errors++; continue; }
        process.stdout.write(`  Fetching ${entry.object_ids.length} Met objects ... `);
        artworks = await fetchMetObjects(entry.object_ids);
        console.log(`${artworks.length} images`);

      } else if (entry.source === 'rijksmuseum') {
        if (!entry.object_ids?.length) { console.log('ERROR: missing object_ids'); errors++; continue; }
        process.stdout.write(`  Fetching ${entry.object_ids.length} Rijksmuseum objects ... `);
        artworks = await fetchRijksmuseumObjects(entry.object_ids);
        console.log(`${artworks.length} images`);

      } else if (entry.source === 'direct_urls') {
        if (!entry.images?.length) { console.log('ERROR: missing images array'); errors++; continue; }
        artworks = entry.images.map(img => ({
          url: img.url,
          title: img.title || 'Untitled',
          author: img.author || 'Unknown artist',
          date: img.date || null,
          medium: img.medium || null,
          source_url: img.source_url || img.url,
          license: img.license || entry.license || 'publicdomain',
        }));
        console.log(`  ${artworks.length} direct images`);

      } else {
        console.log(`ERROR: unknown source "${entry.source}"`);
        errors++;
        continue;
      }

      if (artworks.length === 0) {
        console.log('  No images found');
        errors++;
        continue;
      }

      // Create one book document per artwork
      for (let a = 0; a < artworks.length; a++) {
        const artwork = artworks[a];
        const shortTitle = (artwork.title || 'untitled').slice(0, 50);
        process.stdout.write(`  [${a + 1}/${artworks.length}] ${shortTitle} ... `);

        try {
          const result = await createArtworkDoc(db, artwork, entry);
          if (result.status === 'skip') {
            console.log(`SKIP (${result.reason})`);
            skipped++;
          } else {
            console.log(`OK (${result.id})`);
            imported++;
            importedIds.push(result.id);
          }
        } catch (err) {
          console.log(`ERROR: ${err.message?.slice(0, 100)}`);
          errors++;
        }
      }

    } catch (err) {
      console.log(`ERROR: ${err.message?.slice(0, 100)}`);
      errors++;
    }
  }

  console.log(`\nDone: ${imported} imported, ${skipped} dupes, ${errors} errors`);

  if (importedIds.length > 0) {
    console.log(`\nImported IDs (${importedIds.length}):`);
    console.log(importedIds.join(','));
  }

  await client.close();
}

main().catch(err => { console.error('Fatal:', err); process.exit(1); });
