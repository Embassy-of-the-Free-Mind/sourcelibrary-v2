#!/usr/bin/env node
/**
 * Generic Morgan Library importer.
 *
 * Three-phase pipeline (each idempotent, run independently or together):
 *
 *   --gather       Probe URLs, fetch ICA per-folio descriptions. No DB / R2 writes.
 *                  Caches a manifest snapshot at scripts/import/morgan-cache/<bibId>/.
 *
 *   --insert       Insert book + page docs (with ICA descriptions on pages where
 *                  available). If book already exists, updates ICA fields only.
 *                  Pages point at themorgan.org JPEGs until --archive runs.
 *
 *   --archive      For each page, download the Zoomify .zif master pyramid,
 *                  extract level-0 JPEG (5000x7200 px typical), generate display
 *                  (1200px) + thumb (150px) variants, upload all FOUR to R2:
 *                    archived/<bookId>/<N>.zif        - preservation deep-zoom
 *                    archived/<bookId>/<N>.jpg        - extracted master JPEG
 *                    pages/<bookId>/<NNNN>.jpg        - display
 *                    pages/<bookId>/<NNNN>-thumb.jpg  - thumb
 *                  Updates page docs with R2 URLs.
 *
 *   --all          gather + insert + archive in sequence.
 *
 * Manifest format (one JSON file with array of records, or a single record):
 *
 *   {
 *     "bibId": "143828",
 *     "accession": "MS M.422",
 *     "accession_slug": "m422",         // for host.themorgan.org/facsimile/images/<slug>/
 *     "title": "Fables and other poems",
 *     "display_title": "Fables and Other Poems",
 *     "author": "Pierre Sala",
 *     "place": "Southern France",
 *     "date": "ca. 1515",
 *     "language": "French",
 *     "categories": ["medieval-manuscripts","illuminated-manuscripts","fables"],
 *     "page_count": 152,
 *     "image_offset": 25,               // first viewer page maps to filename index = 1 + offset
 *     "filename_prefix": "143828v",     // viewer image filenames: <prefix>_NNNN.jpg
 *     "ica_thumbs_url": "http://ica.themorgan.org/manuscript/thumbs/143828",
 *     "ica_page_count": 78,
 *     "record_url": "https://www.themorgan.org/manuscript/143828",
 *     "iiif_manifest_url": null,
 *     "notes": "..."
 *   }
 *
 * Usage:
 *   set -a; source .env.production.local; set +a
 *   node scripts/import/morgan-direct.mjs --manifest=path.json --bibId=143828 --gather
 *   node scripts/import/morgan-direct.mjs --manifest=path.json --bibId=143828 --insert
 *   node scripts/import/morgan-direct.mjs --manifest=path.json --bibId=143828 --archive --concurrency=2 --limit=20
 *   node scripts/import/morgan-direct.mjs --manifest=path.json --bibId=143828 --all
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { execFile as _execFile } from 'child_process';
import { promisify } from 'util';
import { MongoClient, ObjectId } from 'mongodb';
import { S3Client, PutObjectCommand, HeadObjectCommand } from '@aws-sdk/client-s3';
import { uploadPageVariants } from '../workers/lib/display-image.mjs';

const execFile = promisify(_execFile);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CACHE_DIR = path.join(__dirname, 'morgan-cache');

// ───────────────────────── args ─────────────────────────
const args = process.argv.slice(2);
const getArg = (n, d = null) => {
  const m = args.find(a => a.startsWith(`--${n}=`));
  return m ? m.split('=').slice(1).join('=') : d;
};
const has = (n) => args.includes(`--${n}`);

const MANIFEST = getArg('manifest');
const ONLY_BIB = getArg('bibId');
const PAGE_LIMIT = parseInt(getArg('limit', '999'), 10);
const CONCURRENCY = parseInt(getArg('concurrency', '2'), 10);
const DO_GATHER = has('gather') || has('all');
const DO_INSERT = has('insert') || has('all');
const DO_ARCHIVE = has('archive') || has('all');
const DRY_RUN = has('dry-run');

if (!MANIFEST) { console.error('Missing --manifest=<path>'); process.exit(1); }
if (!DO_GATHER && !DO_INSERT && !DO_ARCHIVE) {
  console.error('Pick at least one phase: --gather --insert --archive (or --all)');
  process.exit(1);
}

// ───────────────────────── env ─────────────────────────
const MONGODB_URI = process.env.MONGODB_URI;
const R2_ACCOUNT_ID = process.env.R2_ACCOUNT_ID;
const R2_BUCKET_NAME = process.env.R2_BUCKET_NAME || 'sourcelibrary';
const R2_PUBLIC_URL = process.env.R2_PUBLIC_URL || 'https://images.sourcelibrary.org';

if (DO_INSERT && !MONGODB_URI) { console.error('Missing MONGODB_URI (need for --insert)'); process.exit(1); }
if (DO_ARCHIVE && (!MONGODB_URI || !R2_ACCOUNT_ID)) {
  console.error('Missing MONGODB_URI / R2_ACCOUNT_ID (need for --archive)');
  process.exit(1);
}

const r2 = R2_ACCOUNT_ID ? new S3Client({
  region: 'auto',
  endpoint: `https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
  credentials: {
    accessKeyId: process.env.R2_ACCESS_KEY_ID,
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
  },
}) : null;

const USER_AGENT = 'SourceLibrary/1.0 (https://sourcelibrary.org; derek@ancientwisdomtrust.org)';
const HOST_REFERER = (slug) => `https://host.themorgan.org/facsimile/${slug}/`;

// ───────────────────────── URL builders ─────────────────────────
//
// Filename patterns (set via rec.filename_pattern):
//
//   numeric_4d (default)  <prefix>_NNNN.jpg where NNNN = image_offset + vp - 1, 4-digit
//                         e.g. 144038v_0026.jpg, 77327v_0001.jpg
//   recto_verso           <prefix>NNNr.jpg or NNNv.jpg, folio = ceil((image_offset + vp - 1)/2), 3-digit
//                         e.g. ma3900_001r.jpg, ma3900_001v.jpg, M1044_002r.jpg
//   simple_numeric        <prefix>N.jpg where N = image_offset + vp - 1, no padding
//                         e.g. anne_m50f1.jpg, anne_m50f23.jpg
//   custom                exact filenames in rec.page_filenames[vp-1]
//                         e.g. m630_15.jpg for Visconti-Sforza
//
// image_offset semantic: the NNNN value that corresponds to viewer page 1.
// e.g. M.785 vp1 → 144038v_0026.jpg, so image_offset = 26.
function imageFileName(rec, viewerPage) {
  const pattern = rec.filename_pattern || 'numeric_4d';
  switch (pattern) {
    case 'numeric_4d': {
      const idx = rec.image_offset + viewerPage - 1;
      return `${rec.filename_prefix}_${String(idx).padStart(4, '0')}.jpg`;
    }
    case 'simple_numeric': {
      const idx = rec.image_offset + viewerPage - 1;
      return `${rec.filename_prefix}${idx}.jpg`;
    }
    case 'recto_verso': {
      // (image_offset, vp) — image_offset is the folio number of vp 1 recto.
      // Each folio = 2 viewer pages (recto, verso). For offset=1: vp1→001r, vp2→001v, vp3→002r, ...
      const sequencePos = viewerPage - 1; // 0-based
      const folioNum = rec.image_offset + Math.floor(sequencePos / 2);
      const side = sequencePos % 2 === 0 ? 'r' : 'v';
      return `${rec.filename_prefix}${String(folioNum).padStart(3, '0')}${side}.jpg`;
    }
    case 'custom': {
      if (!rec.page_filenames || !rec.page_filenames[viewerPage - 1]) {
        throw new Error(`custom pattern requires page_filenames[${viewerPage - 1}] for vp ${viewerPage}`);
      }
      // Entries may include a dir prefix like "318716/142017v_0001.jpg" for MSS
      // (M.386 Persian Album, MA 1139 Codex Huygens) where every page lives in
      // its own bibId folder. We strip the dir part here and recover it via
      // imageDir() — see imageDir comments.
      const entry = rec.page_filenames[viewerPage - 1];
      const slash = entry.indexOf('/');
      return slash >= 0 ? entry.slice(slash + 1) : entry;
    }
    default:
      throw new Error(`Unknown filename_pattern: ${pattern}`);
  }
}
function zifFileName(rec, viewerPage) {
  return imageFileName(rec, viewerPage).replace(/\.jpg$/, '.zif');
}
// Per-MS image dir. Default = bibId. May be overridden globally via
// image_dir_override, or per-page if rec.filename_pattern === 'custom' and the
// page_filenames entry begins with "<dir>/<file>" (e.g. M.386 Persian Album
// is bound from multiple manuscript fragments — each viewer page references
// its own bibId folder; MA 1139 Codex Huygens has 124+ separate dirs).
function imageDir(rec, viewerPage) {
  if (viewerPage != null && (rec.filename_pattern || 'numeric_4d') === 'custom') {
    const entry = rec.page_filenames?.[viewerPage - 1];
    if (entry) {
      const slash = entry.indexOf('/');
      if (slash >= 0) return entry.slice(0, slash);
    }
  }
  return rec.image_dir_override || rec.bibId;
}
function publicJpegUrl(rec, viewerPage) {
  return `https://www.themorgan.org/sites/default/files/facsimile/${imageDir(rec, viewerPage)}/${imageFileName(rec, viewerPage)}`;
}
function publicThumbUrl(rec, viewerPage) {
  return `https://www.themorgan.org/sites/default/files/styles/largest_800_x_800_/public/facsimile/${imageDir(rec, viewerPage)}/${imageFileName(rec, viewerPage)}`;
}
function zifUrl(rec, viewerPage) {
  return `https://host.themorgan.org/facsimile/images/${rec.accession_slug}/${zifFileName(rec, viewerPage)}`;
}

// ───────────────────────── HTTP helpers ─────────────────────────
async function headCheck(url, opts = {}) {
  const r = await fetch(url, {
    method: 'HEAD',
    headers: { 'User-Agent': USER_AGENT, ...(opts.headers || {}) },
    signal: AbortSignal.timeout(20_000),
  });
  return { ok: r.ok, status: r.status, contentType: r.headers.get('content-type'), contentLength: r.headers.get('content-length') };
}
async function fetchBuffer(url, opts = {}) {
  const r = await fetch(url, {
    headers: { 'User-Agent': USER_AGENT, ...(opts.headers || {}) },
    signal: AbortSignal.timeout(120_000),
  });
  if (!r.ok) throw new Error(`HTTP ${r.status} ${url}`);
  return Buffer.from(await r.arrayBuffer());
}

// ───────────────────────── ICA descriptions ─────────────────────────
async function fetchIcaDescriptions(rec) {
  if (!rec.ica_page_count || rec.ica_page_count < 1) return [];
  const out = [];
  const concurrency = 8;
  let cursor = 1;
  async function worker() {
    while (true) {
      const p = cursor++;
      if (p > rec.ica_page_count) return;
      try {
        const html = await fetchBuffer(`http://ica.themorgan.org/manuscript/page/${p}/${rec.bibId}`).then(b => b.toString('utf-8'));
        const folioMatch = html.match(/MS\s+[\w.]+\s+fol\.?\s+([\w.]+)/);
        const folio_label = folioMatch ? folioMatch[0] : null;
        // Description block sits between the SECOND <!--ZOOMRESTART--> and <!--ZOOMSTOP-->
        let body = null;
        const parts = html.split('<!--ZOOMRESTART-->');
        if (parts.length >= 3) {
          let after = parts[2].split('<!--ZOOMSTOP-->')[0];
          after = after.replace(/<script[\s\S]*?<\/script>/g, '').replace(/<style[\s\S]*?<\/style>/g, '');
          after = after.replace(/<br\s*\/?>/gi, '\n').replace(/<[^>]+>/g, ' ');
          after = after
            .replace(/&#187;/g, '»').replace(/&#171;/g, '«')
            .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
            .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&nbsp;/g, ' ');
          body = after.split('\n').map(l => l.trim()).filter(Boolean).join('\n').trim();
          if (!body) body = null;
        }
        out.push({ ica_page: p, folio_label, body });
      } catch (e) {
        out.push({ ica_page: p, error: e.message });
      }
    }
  }
  await Promise.all(Array(concurrency).fill(0).map(worker));
  out.sort((a, b) => a.ica_page - b.ica_page);
  return out;
}

// Extract the set of {folio,side} tokens (e.g. "1r", "2v") referenced by a label.
// Handles labels like:
//   "fol. 1r"                  → {1r}
//   "fols. 1v–2r"              → {1v, 2r}      (opening: two folios in one viewer page)
//   "p. [iii]v–fol. 1r"        → {1r}          (front-matter to first folio transition)
//   "front cover"              → {}            (no folio reference)
function extractFolioSides(label) {
  if (!label) return new Set();
  const out = new Set();
  // Plain "fol. Nr" or "fol. Nv" — N is a number
  for (const m of label.matchAll(/\bfols?\.?\s+(\d+)([rv])\b/gi)) {
    out.add(`${m[1]}${m[2].toLowerCase()}`);
  }
  // Range "fols. Av–Br" or "fols. Av-Br" (en-dash or hyphen)
  for (const m of label.matchAll(/\bfols?\.?\s+(\d+)([rv])\s*[–-]\s*(\d+)([rv])/gi)) {
    out.add(`${m[1]}${m[2].toLowerCase()}`);
    out.add(`${m[3]}${m[4].toLowerCase()}`);
  }
  return out;
}

// Map ICA folio_label ("MS M.785 fol. 4r") to our viewer page number.
// Looks for the viewer page whose label includes the same folio+side token.
// Works for both per-folio viewers (M.785, M.422) and opening viewers (M.133).
function buildIcaPageMap(icaRecs, pageLabels) {
  const map = new Map();
  // Pre-compute folio→vp index from the page labels
  const folioToVp = new Map();
  for (let i = 0; i < pageLabels.length; i++) {
    for (const side of extractFolioSides(pageLabels[i])) {
      if (!folioToVp.has(side)) folioToVp.set(side, i + 1);
    }
  }
  for (const r of icaRecs) {
    if (!r.folio_label) continue;
    const m = r.folio_label.match(/fols?\.?\s+(\d+)([rv])/i);
    if (!m) continue;
    const token = `${m[1]}${m[2].toLowerCase()}`;
    const vp = folioToVp.get(token);
    if (vp && !map.has(vp)) map.set(vp, r);
  }
  return map;
}

// ───────────────────────── page label fetcher ─────────────────────────
// Morgan's online viewer's /thumbs page lists every viewer page's image with a
// label like "007. MS M.422, fol. 1r". We scrape these to use as proper page
// labels (so ICA folio_label matches work, and so the reader sees "fol. 1r"
// not "page 7"). Tries both URL conventions: /collection/<slug>/<bibId>/thumbs
// (new pattern) and /collection/<slug>/thumbs (older pattern).
async function fetchPageLabelsFromThumbs(rec) {
  if (Array.isArray(rec.page_labels) && rec.page_labels.length === rec.page_count) {
    return rec.page_labels;
  }

  // Find the canonical /collection/<slug>/... URL from the record page
  let recordHtml;
  for (const root of [rec.record_root || '/manuscript', '/manuscript', '/incunables', '/drawings/item']) {
    try {
      recordHtml = await fetchBuffer(`https://www.themorgan.org${root}/${rec.bibId}`).then(b => b.toString('utf-8'));
      break;
    } catch {}
  }
  if (!recordHtml) return null;

  // The record page links to one of three slug patterns:
  //   /collection/<slug>/<bibId>      (newer pattern, M.422 → fables-poems)
  //   /collection/<slug>/thumbs       (older pattern, Worksop)
  //   /collection/<slug>"             (terse pattern, M.383 → renaissance-fighting-manual)
  // Skip the generic Morgan-wide links (/collection/coptic-manuscripts, etc).
  const SKIP_SLUGS = new Set([
    'curatorial-departments','medieval-and-renaissance-manuscripts','coptic-manuscripts',
    'coptic-bindings','indian-miniatures','the-morgan-library-museum',
  ]);
  let slug = null;
  const slugPatterns = [
    new RegExp(`/collection/([^"'/]+)/${rec.bibId}`),
    new RegExp(`/collection/([^"'/]+)/thumbs`),
    /\/collection\/([^"'/?]+)["?]/g,
  ];
  for (const re of slugPatterns) {
    if (re.global) {
      let m;
      while ((m = re.exec(recordHtml)) !== null) {
        if (!SKIP_SLUGS.has(m[1])) { slug = m[1]; break; }
      }
    } else {
      const m = recordHtml.match(re);
      if (m && !SKIP_SLUGS.has(m[1])) { slug = m[1]; }
    }
    if (slug) break;
  }
  if (!slug) return null;

  // Determine which URL prefix worked (with or without bibId), then paginate through
  // all thumbs pages (Morgan paginates 12 thumbs per page).
  let thumbsBase = null;
  for (const url of [
    `https://www.themorgan.org/collection/${slug}/${rec.bibId}/thumbs`,
    `https://www.themorgan.org/collection/${slug}/thumbs`,
  ]) {
    try {
      const html = await fetchBuffer(url).then(b => b.toString('utf-8'));
      if (html.length > 1000) { thumbsBase = url; break; }
    } catch {}
  }
  if (!thumbsBase) return null;

  // Labels live in <span class="field-content small">NNN. <hdr> <label></span>.
  // Strip the bibliographic header — common forms: "MS X.Y," / "MS X.Y" / "PML 1.1-2" / "MA 3900"
  const HEADER_RE = /^(?:MS|PML|MA|Ms\.?)\s*[\w.-]*,?\s*/;
  const allEntries = new Map();
  const PER_PAGE = 12;
  const maxPage = Math.ceil(rec.page_count / PER_PAGE) + 2;
  for (let p = 0; p < maxPage; p++) {
    const url = `${thumbsBase}?page=${p}`;
    let html;
    try { html = await fetchBuffer(url).then(b => b.toString('utf-8')); } catch { break; }
    const re = /<span\s+class="field-content small">\s*(\d{3})\.\s+(.+?)\s*<\/span>/g;
    let m, found = 0;
    while ((m = re.exec(html)) !== null) {
      const vp = parseInt(m[1], 10);
      if (vp < 1 || vp > rec.page_count || allEntries.has(vp)) continue;
      let label = m[2].replace(/<[^>]+>/g, ' ').replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim();
      label = label.replace(HEADER_RE, '').trim();
      if (label && label.length <= 200) {
        allEntries.set(vp, label);
        found++;
      }
    }
    if (found === 0) break;
  }

  if (allEntries.size === 0) return null;
  const labels = new Array(rec.page_count).fill(null);
  for (const [vp, l] of allEntries) labels[vp - 1] = l;
  return labels;
}

function defaultPageLabels(rec) {
  if (Array.isArray(rec.page_labels) && rec.page_labels.length === rec.page_count) {
    return rec.page_labels;
  }
  return Array.from({ length: rec.page_count }, (_, i) => `page ${i + 1}`);
}

// ───────────────────────── ZIF extraction ─────────────────────────
async function extractMasterFromZif(zifBuffer) {
  // Write to a temp file, run ImageMagick to extract level 0 as JPEG.
  const tmpZif = `/tmp/morgan_${process.pid}_${Date.now()}_${Math.random().toString(36).slice(2)}.tif`;
  const tmpJpg = tmpZif.replace(/\.tif$/, '_master.jpg');
  fs.writeFileSync(tmpZif, zifBuffer);
  try {
    await execFile('magick', [`${tmpZif}[0]`, '-quality', '92', tmpJpg], { maxBuffer: 64 * 1024 * 1024 });
    return fs.readFileSync(tmpJpg);
  } finally {
    try { fs.unlinkSync(tmpZif); } catch {}
    try { fs.unlinkSync(tmpJpg); } catch {}
  }
}

// ───────────────────────── R2 upload helpers ─────────────────────────
async function uploadToR2(key, buffer, contentType = 'image/jpeg', cacheControl = 'public, max-age=86400, s-maxage=86400') {
  await r2.send(new PutObjectCommand({
    Bucket: R2_BUCKET_NAME, Key: key, Body: buffer,
    ContentType: contentType, CacheControl: cacheControl,
  }));
  return `${R2_PUBLIC_URL}/${key}`;
}
async function r2KeyExists(key) {
  try {
    await r2.send(new HeadObjectCommand({ Bucket: R2_BUCKET_NAME, Key: key }));
    return true;
  } catch (e) {
    if (e.$metadata?.httpStatusCode === 404 || e.name === 'NotFound') return false;
    throw e;
  }
}

// ───────────────────────── phases ─────────────────────────
async function phaseGather(rec) {
  const dir = path.join(CACHE_DIR, rec.bibId);
  fs.mkdirSync(dir, { recursive: true });

  console.log(`\n[${rec.bibId}] === GATHER === ${rec.accession} — ${rec.title}`);

  // Probe 3 sample image URLs (start, middle, end)
  const samples = [1, Math.ceil(rec.page_count / 2), rec.page_count];
  const probes = [];
  for (const vp of samples) {
    const pubUrl = publicJpegUrl(rec, vp);
    const zifUrlVal = zifUrl(rec, vp);
    const [pubR, zifR] = await Promise.all([
      headCheck(pubUrl),
      headCheck(zifUrlVal, { headers: { Referer: HOST_REFERER(rec.accession_slug) } }),
    ]);
    probes.push({ viewerPage: vp, public: pubR, zif: zifR, pubUrl, zifUrl: zifUrlVal });
    console.log(`  vp ${String(vp).padStart(3)}  public:${pubR.status} ${pubR.contentLength||'-'}b   zif:${zifR.status} ${zifR.contentLength||'-'}b`);
    if (!pubR.ok) console.warn(`    ! public URL not OK`);
    if (!zifR.ok && pubR.ok) console.warn(`    ! ZIF URL not OK — masters unavailable for this MS`);
  }

  // If the last sample 404'd but vp 1 worked, binary-search for the real page count.
  let detectedPageCount = rec.page_count;
  if (probes[2].public && !probes[2].public.ok && probes[0].public && probes[0].public.ok) {
    console.log(`  last page 404 → binary-searching for true page count...`);
    let lo = 1, hi = rec.page_count;
    while (lo < hi) {
      const mid = Math.floor((lo + hi + 1) / 2);
      const r = await headCheck(publicJpegUrl(rec, mid));
      if (r.ok) lo = mid; else hi = mid - 1;
    }
    detectedPageCount = lo;
    console.log(`  detected page count: ${detectedPageCount} (manifest said ${rec.page_count})`);
  }

  // Fetch ICA descriptions (if any)
  let ica = [];
  if (rec.ica_page_count > 0) {
    console.log(`  fetching ${rec.ica_page_count} ICA descriptions...`);
    ica = await fetchIcaDescriptions(rec);
    console.log(`  got ${ica.filter(r => r.body).length}/${ica.length} ICA descriptions`);
  }

  fs.writeFileSync(path.join(dir, 'manifest.json'), JSON.stringify({ ...rec, detected_page_count: detectedPageCount }, null, 2));
  fs.writeFileSync(path.join(dir, 'probes.json'), JSON.stringify(probes, null, 2));
  fs.writeFileSync(path.join(dir, 'ica.json'), JSON.stringify(ica, null, 2));
  console.log(`  cache written: ${dir}`);
}

function slugify(text, maxLen = 80) {
  return text.toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-').replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .substring(0, maxLen);
}
async function generateUniqueSlug(db, base) {
  let slug = base, i = 2;
  while (await db.collection('books').findOne({ slug }, { projection: { _id: 1 } })) {
    slug = `${base}-${i++}`;
  }
  return slug;
}

async function phaseInsert(rec, db) {
  console.log(`\n[${rec.bibId}] === INSERT === ${rec.accession}`);

  const fingerprint = `morgan:${rec.accession_slug}`;
  const existing = await db.collection('books').findOne(
    { $or: [
      { source_fingerprint: fingerprint },
      { morgan_accession: rec.accession },
      { 'image_source.identifier': rec.accession, 'image_source.provider': 'morgan' },
    ] },
    { projection: { _id: 1, slug: 1 } }
  );

  // Load ICA descriptions if cached
  const icaPath = path.join(CACHE_DIR, rec.bibId, 'ica.json');
  const ica = fs.existsSync(icaPath) ? JSON.parse(fs.readFileSync(icaPath, 'utf-8')) : [];

  // Try to fetch real per-vp labels from the Morgan /thumbs viewer page
  console.log(`  fetching per-page labels from Morgan /thumbs viewer...`);
  const fetchedLabels = await fetchPageLabelsFromThumbs(rec);
  const labels = fetchedLabels || defaultPageLabels(rec);
  console.log(`  ${fetchedLabels ? 'fetched' : 'using default'} labels for ${labels.length} pages`);
  const icaMap = buildIcaPageMap(ica, labels);

  if (existing) {
    console.log(`  book exists: ${existing._id} (slug=${existing.slug})`);

    // If we fetched fresh labels, update page docs that have generic ones
    if (fetchedLabels) {
      const existingPages = await db.collection('pages')
        .find({ book_id: existing._id.toString() })
        .project({ page_number: 1, label: 1 })
        .toArray();
      const bulk = db.collection('pages').initializeUnorderedBulkOp();
      let toUpdate = 0;
      for (const p of existingPages) {
        const newLabel = fetchedLabels[p.page_number - 1];
        if (newLabel && newLabel !== p.label) {
          bulk.find({ _id: p._id }).updateOne({ $set: { label: newLabel, updated_at: new Date() } });
          toUpdate++;
        }
      }
      if (toUpdate > 0) {
        const res = await bulk.execute();
        console.log(`  refreshed ${res.modifiedCount}/${toUpdate} page labels`);
      }
    }

    if (ica.length > 0 && icaMap.size > 0) {
      const bulk = db.collection('pages').initializeUnorderedBulkOp();
      for (const [vp, icaRec] of icaMap) {
        bulk.find({ book_id: existing._id.toString(), page_number: vp }).updateOne({
          $set: {
            iconographic_description: icaRec.body,
            ica_folio_label: icaRec.folio_label,
            ica_source_url: `http://ica.themorgan.org/manuscript/page/${icaRec.ica_page}/${rec.bibId}`,
            updated_at: new Date(),
          },
        });
      }
      const res = await bulk.execute();
      console.log(`  enriched ${res.modifiedCount}/${icaMap.size} pages with ICA descriptions`);
    } else if (ica.length > 0) {
      console.log(`  no ICA descriptions matched page labels (have ${ica.length} ICA records but 0 matched)`);
    }

    // Always store ICA records on the book doc as a fallback (searchable, no data loss)
    if (ica.length > 0) {
      await db.collection('books').updateOne(
        { _id: existing._id },
        { $set: {
          ica_records: ica.filter(r => r.body).map(r => ({
            folio_label: r.folio_label, body: r.body, ica_page: r.ica_page,
            ica_source_url: `http://ica.themorgan.org/manuscript/page/${r.ica_page}/${rec.bibId}`,
          })),
          updated_at: new Date(),
        } }
      );
    }
    return { _id: existing._id, slug: existing.slug, isNew: false };
  }

  const slug = await generateUniqueSlug(db, slugify(`morgan-${rec.accession_slug}-${rec.title}`));
  const bookId = new ObjectId();
  const bookIdStr = bookId.toHexString();

  const bookDoc = {
    _id: bookId,
    id: bookIdStr,
    slug,
    tenant_id: 'default',
    title: rec.title,
    display_title: rec.display_title || rec.title,
    author: rec.author || 'Anonymous',
    language: rec.language || null,
    original_language: rec.language || null,
    published: rec.date || null,
    published_place: rec.place || null,
    categories: rec.categories || ['medieval-manuscripts', 'illuminated-manuscripts'],
    morgan_accession: rec.accession,
    morgan_bibid: rec.bibId,
    thumbnail: publicThumbUrl(rec, Math.min(11, rec.page_count)),
    pages_count: rec.page_count,
    pages_ocr: 0,
    pages_translated: 0,
    pages_archived: 0,
    dublin_core: {
      dc_identifier: [`MORGAN:${rec.accession}`],
      dc_source: rec.record_url,
    },
    image_source: {
      provider: 'morgan',
      provider_name: 'The Morgan Library & Museum',
      source_url: rec.record_url,
      identifier: rec.accession,
      license: 'publicdomain',
      attribution: `New York, The Morgan Library & Museum, ${rec.accession}.`,
      contributing_library: 'The Morgan Library & Museum',
      shelfmark: rec.accession,
      iiif_manifest: rec.iiif_manifest_url || null,
      access_date: new Date(),
      notes: rec.notes || null,
    },
    notes: rec.notes || null,
    status: 'draft',
    hidden: true,
    visible: false,
    // Blocks the catch-all archive-ocr.mjs worker from picking the book up before
    // morgan-direct.mjs --archive has had a chance to run. Cron'd worker only
    // skips on `archive_metadata.blocked: true` (NEEDS_ARCHIVE_EXPR also gates on
    // pages_archived < pages_count, so this becomes redundant once we finish).
    archive_metadata: { blocked: true, source: 'morgan_zif_pending' },
    source_fingerprint: fingerprint,
    normalized_title: slugify(rec.title).replace(/-/g, ' '),
    normalized_author: rec.author ? slugify(rec.author).replace(/-/g, ' ') : null,
    ica_records: ica.length > 0 ? ica.filter(r => r.body).map(r => ({
      folio_label: r.folio_label, body: r.body, ica_page: r.ica_page,
      ica_source_url: `http://ica.themorgan.org/manuscript/page/${r.ica_page}/${rec.bibId}`,
    })) : undefined,
    created_at: new Date(),
    updated_at: new Date(),
  };

  if (DRY_RUN) {
    console.log(`  DRY-RUN: would insert book ${bookIdStr} slug=${slug} + ${rec.page_count} pages`);
    return { _id: bookId, slug, isNew: true, dryRun: true };
  }

  await db.collection('books').insertOne(bookDoc);
  console.log(`  inserted book ${bookIdStr} slug=${slug}`);

  const CHUNK = 500;
  for (let start = 0; start < rec.page_count; start += CHUNK) {
    const pageDocs = [];
    for (let p = start; p < Math.min(start + CHUNK, rec.page_count); p++) {
      const viewerPage = p + 1;
      const pageId = new ObjectId();
      const icaRec = icaMap.get(viewerPage) || null;
      pageDocs.push({
        _id: pageId,
        id: pageId.toHexString(),
        tenant_id: 'default',
        book_id: bookIdStr,
        page_number: viewerPage,
        label: labels[p],
        photo: publicJpegUrl(rec, viewerPage),
        thumbnail: publicThumbUrl(rec, viewerPage),
        photo_original: publicJpegUrl(rec, viewerPage),
        ...(icaRec ? {
          iconographic_description: icaRec.body,
          ica_folio_label: icaRec.folio_label,
          ica_source_url: `http://ica.themorgan.org/manuscript/page/${icaRec.ica_page}/${rec.bibId}`,
        } : {}),
        created_at: new Date(),
        updated_at: new Date(),
      });
    }
    await db.collection('pages').insertMany(pageDocs, { ordered: false });
    console.log(`  inserted pages ${start + 1}-${start + pageDocs.length}`);
  }
  return { _id: bookId, slug, isNew: true };
}

async function phaseArchive(rec, db, bookInfo) {
  const bookId = bookInfo._id.toString();
  console.log(`\n[${rec.bibId}] === ARCHIVE === ${rec.accession} bookId=${bookId}`);

  // Decide which pages to archive — anything missing the master ZIF in R2
  const pages = await db.collection('pages')
    .find({ book_id: bookId })
    .project({ _id: 1, page_number: 1, photo: 1 })
    .sort({ page_number: 1 })
    .toArray();
  console.log(`  ${pages.length} pages in DB`);

  let processed = 0, skipped = 0, failed = 0;
  const tasks = pages.slice(0, PAGE_LIMIT);

  async function worker(workerId) {
    while (true) {
      const idx = tasks.findIndex(t => !t._claimed);
      if (idx < 0) return;
      const page = tasks[idx];
      page._claimed = true;
      const viewerPage = page.page_number;

      const num = String(viewerPage).padStart(4, '0');
      const zifKey = `archived/${bookId}/${viewerPage}.zif`;
      const masterKey = `archived/${bookId}/${viewerPage}.jpg`;
      const displayKey = `pages/${bookId}/${num}.jpg`;
      const thumbKey = `pages/${bookId}/${num}-thumb.jpg`;

      // Idempotent: skip if master + display + thumb already in R2 (ZIF optional —
      // public-JPEG-only books don't have one). If they exist, refresh the page
      // doc URLs in case an older importer left them pointing at themorgan.org.
      try {
        const [zifEx, masterEx, displayEx, thumbEx] = await Promise.all([
          r2KeyExists(zifKey), r2KeyExists(masterKey),
          r2KeyExists(displayKey), r2KeyExists(thumbKey),
        ]);
        if (masterEx && displayEx && thumbEx) {
          await db.collection('pages').updateOne(
            { _id: page._id },
            { $set: {
              archived_photo: `${R2_PUBLIC_URL}/${masterKey}`,
              display_photo: `${R2_PUBLIC_URL}/${displayKey}`,
              thumbnail_blob: `${R2_PUBLIC_URL}/${thumbKey}`,
              ...(zifEx ? { zif_archive: `${R2_PUBLIC_URL}/${zifKey}` } : {}),
              photo: `${R2_PUBLIC_URL}/${displayKey}`,
              thumbnail: `${R2_PUBLIC_URL}/${thumbKey}`,
              'archive_metadata.source': zifEx ? 'morgan_zif' : 'morgan_public_jpeg',
              'archive_metadata.archived_at': new Date(),
              updated_at: new Date(),
            } }
          );
          skipped++;
          if ((processed + skipped) % 10 === 0) console.log(`  [w${workerId}] vp ${viewerPage}: already archived (${processed} done, ${skipped} skipped, ${failed} failed)`);
          continue;
        }
      } catch (e) {
        console.warn(`  [w${workerId}] vp ${viewerPage}: HEAD check failed: ${e.message}`);
      }

      const t0 = Date.now();
      try {
        // 1. Try ZIF (high-res master pyramid). Fall back to the public JPEG
        // when no ZIF is published for this MS (Mellon, Drake, Huygens, etc.).
        let zifBuffer = null, masterBuffer = null, sourceKind = 'morgan_zif';
        try {
          zifBuffer = await fetchBuffer(zifUrl(rec, viewerPage), {
            headers: { Referer: HOST_REFERER(rec.accession_slug) },
          });
          masterBuffer = await extractMasterFromZif(zifBuffer);
        } catch (zifErr) {
          // Public JPEG fallback. The ~1.3 MB Morgan download is itself a
          // ~2500-wide JPEG — usable as master though smaller than ZIF.
          sourceKind = 'morgan_public_jpeg';
          masterBuffer = await fetchBuffer(publicJpegUrl(rec, viewerPage));
        }

        if (DRY_RUN) {
          console.log(`  [w${workerId}] vp ${viewerPage}: DRY-RUN ${sourceKind} master=${masterBuffer.length}b`);
          processed++;
          continue;
        }

        // 2. Upload ZIF preservation copy (only if we have one)
        let zifUrlR2 = null;
        if (zifBuffer) {
          zifUrlR2 = await uploadToR2(zifKey, zifBuffer, 'image/tiff', 'public, max-age=2592000, s-maxage=2592000');
        }

        // 3. Upload master + display + thumb (uploadPageVariants writes archived/<bookId>/<N>.jpg + display + thumb)
        const variants = await uploadPageVariants(masterBuffer, bookId, viewerPage, uploadToR2);

        // 4. Update page doc
        await db.collection('pages').updateOne(
          { _id: page._id },
          { $set: {
            archived_photo: variants.archived,
            display_photo: variants.display,
            thumbnail_blob: variants.thumb,
            ...(zifUrlR2 ? { zif_archive: zifUrlR2 } : {}),
            photo: variants.display,
            thumbnail: variants.thumb,
            image_width: variants.width,
            image_height: variants.height,
            archive_metadata: {
              source: sourceKind,
              source_url: zifBuffer ? zifUrl(rec, viewerPage) : publicJpegUrl(rec, viewerPage),
              original_url: publicJpegUrl(rec, viewerPage),
              archived_at: new Date(),
              ...(zifBuffer ? { zif_bytes: zifBuffer.length } : {}),
              master_bytes: masterBuffer.length,
              master_width: variants.width,
              master_height: variants.height,
            },
            updated_at: new Date(),
          } }
        );
        processed++;
        const ms = Date.now() - t0;
        const srcDesc = zifBuffer ? `${(zifBuffer.length/1e6).toFixed(1)}MB zif` : `${(masterBuffer.length/1e6).toFixed(1)}MB public-jpeg`;
        console.log(`  [w${workerId}] vp ${String(viewerPage).padStart(3)}: ${srcDesc} → ${variants.width}x${variants.height} master (${ms}ms)`);
      } catch (e) {
        failed++;
        console.error(`  [w${workerId}] vp ${viewerPage}: FAILED ${e.message}`);
      }
    }
  }

  await Promise.all(Array(CONCURRENCY).fill(0).map((_, i) => worker(i + 1)));

  console.log(`\n  archive summary: ${processed} processed, ${skipped} skipped, ${failed} failed`);

  // Roll up pages_archived
  if (!DRY_RUN) {
    const archivedCount = await db.collection('pages').countDocuments({
      book_id: bookId,
      archived_photo: { $regex: '^https://images\\.sourcelibrary\\.org/' },
    });
    await db.collection('books').updateOne(
      { _id: bookInfo._id },
      { $set: { pages_archived: archivedCount, updated_at: new Date() } }
    );
    console.log(`  books.pages_archived = ${archivedCount}`);
  }
}

// ───────────────────────── main ─────────────────────────
(async () => {
  const raw = JSON.parse(fs.readFileSync(MANIFEST, 'utf-8'));
  const records = Array.isArray(raw) ? raw : [raw];
  const targets = ONLY_BIB ? records.filter(r => r.bibId === ONLY_BIB) : records;
  if (targets.length === 0) {
    console.error(`No records found matching ${ONLY_BIB ? `bibId=${ONLY_BIB}` : 'manifest'}`);
    process.exit(1);
  }
  console.log(`Targets: ${targets.length} manuscript(s) — ${targets.map(r => r.accession).join(', ')}`);

  let client = null, db = null;
  if (DO_INSERT || DO_ARCHIVE) {
    client = new MongoClient(MONGODB_URI, { maxPoolSize: 5 });
    await client.connect();
    db = client.db('bookstore');
  }

  for (const rec of targets) {
    try {
      if (DO_GATHER) await phaseGather(rec);
    } catch (e) {
      console.error(`[${rec.bibId}] GATHER FAILED: ${e.message}`);
      if (targets.length === 1) throw e; // single-target: bubble up
      continue; // multi-target: keep going
    }
    let bookInfo = null;
    if (DO_INSERT) bookInfo = await phaseInsert(rec, db);
    if (DO_ARCHIVE) {
      if (!bookInfo) {
        // Look up the book if we skipped --insert
        const book = await db.collection('books').findOne(
          { $or: [
            { source_fingerprint: `morgan:${rec.accession_slug}` },
            { morgan_accession: rec.accession },
          ] },
          { projection: { _id: 1, slug: 1 } }
        );
        if (!book) {
          console.error(`[${rec.bibId}] --archive: no book in DB. Run --insert first.`);
          continue;
        }
        bookInfo = { _id: book._id, slug: book.slug, isNew: false };
      }
      await phaseArchive(rec, db, bookInfo);
    }
  }

  if (client) await client.close();
  console.log('\nDone.');
})().catch(e => { console.error(e); process.exit(1); });
