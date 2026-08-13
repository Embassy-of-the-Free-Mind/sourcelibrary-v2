#!/usr/bin/env node
/**
 * Direct import of Marcianus graecus Z. 299 (= coll. 584) — the "Codex
 * Marcianus", the earliest and most important witness to the Greek alchemical
 * corpus (Zosimos of Panopolis, ps.-Democritus, Stephanus of Alexandria, the
 * Dialogue of the Philosophers and Cleopatra, the ouroboros). 10th–11th c.,
 * Biblioteca Nazionale Marciana, Venice.
 *
 * WHY direct: the Marciana digitization lives on Internet Culturale (Ministero
 * della Cultura). There is no Internet Archive copy and no IIIF manifest, so
 * neither the IA nor the IIIF import route applies. Internet Culturale exposes
 * the page map via its `magparser` XML endpoint and serves per-page JPEGs from
 * `cacheman/normal/...` (~1400px, the public display max). We fetch that map
 * from a residential IP, download each JPEG, mirror it to our own R2 bucket
 * (so the facsimile survives link rot / hotlink protection), and insert
 * book + pages straight into Mongo — same shape as harvard-wuzhen-direct.mjs.
 *
 * Imported HIDDEN (visible:false). OCR/translation is a separate, paid step
 * and is intentionally NOT triggered here.
 *
 * Usage:
 *   set -a; source .env.production.local; set +a
 *   node scripts/import/marcianus-299-direct.mjs --dry-run
 *   node scripts/import/marcianus-299-direct.mjs --commit
 */
import { MongoClient, ObjectId } from 'mongodb';
import { S3Client, PutObjectCommand, HeadObjectCommand } from '@aws-sdk/client-s3';

const COMMIT = process.argv.includes('--commit');

const OAI_ID = 'oai:193.206.197.121:18:VE0049:CSTOR.240.9949';
const TECA = 'marciana';
const IC_BASE = 'https://www.internetculturale.it/jmms/';
const MAGPARSER = `${IC_BASE}magparser?id=${encodeURIComponent(OAI_ID)}&teca=${TECA}&mode=all&fulltext=0`;
const SOURCE_URL = `https://www.internetculturale.it/it/16/search/detail?instance=magindice&id=${encodeURIComponent(OAI_ID)}`;
const FINGERPRINT = `internetculturale:${OAI_ID}`;
const R2_PREFIX = 'manuscripts/marciana-gr-299';

const r2 = new S3Client({
  region: 'auto',
  endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
  credentials: {
    accessKeyId: process.env.R2_ACCESS_KEY_ID,
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
  },
});
const BUCKET = process.env.R2_BUCKET_NAME || 'sourcelibrary-images';
const PUBLIC = (process.env.R2_PUBLIC_URL || 'https://images.sourcelibrary.org').replace(/\/$/, '');

const IC_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
  Referer: `${IC_BASE}iccuviewer/iccu.jsp?id=${encodeURIComponent(OAI_ID)}&mode=all&teca=${TECA}`,
};

function slugify(text, maxLen = 70) {
  return text.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9\s-]/g, '').replace(/\s+/g, '-').replace(/-+/g, '-')
    .replace(/^-|-$/g, '').substring(0, maxLen).replace(/-$/, '');
}
async function uniqueSlug(db, base) {
  let slug = base, i = 2;
  while (await db.collection('books').findOne({ slug }, { projection: { _id: 1 } })) slug = `${base}-${i++}`;
  return slug;
}

/** Parse the magparser XML page list with a tolerant attribute regex. */
function parsePages(xml) {
  const out = [];
  const re = /<page\b([^>]*?)\/?>/g;
  let m;
  while ((m = re.exec(xml)) !== null) {
    const attrs = {};
    const ar = /([a-zA-Z]+)="([^"]*)"/g;
    let a;
    while ((a = ar.exec(m[1])) !== null) attrs[a[1]] = a[2];
    if (!attrs.src) continue;
    out.push({
      idx: attrs.idx != null ? Number(attrs.idx) : out.length,
      name: (attrs.name || '').trim(),
      src: attrs.src,
      w: attrs.w ? Number(attrs.w) : undefined,
      h: attrs.h ? Number(attrs.h) : undefined,
    });
  }
  out.sort((a, b) => a.idx - b.idx);
  return out;
}

async function fetchWithRetry(url, opts, tries = 4) {
  let lastErr;
  for (let i = 0; i < tries; i++) {
    try {
      const r = await fetch(url, opts);
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return r;
    } catch (e) {
      lastErr = e;
      await new Promise((res) => setTimeout(res, 500 * (i + 1)));
    }
  }
  throw lastErr;
}

async function r2Exists(key) {
  try { await r2.send(new HeadObjectCommand({ Bucket: BUCKET, Key: key })); return true; }
  catch { return false; }
}

async function main() {
  console.log('Fetching page map from Internet Culturale…');
  const xml = await (await fetchWithRetry(MAGPARSER, { headers: IC_HEADERS })).text();
  const pages = parsePages(xml);
  if (!pages.length) { console.error('No <page> elements parsed from magparser XML'); process.exit(1); }
  console.log(`Parsed ${pages.length} pages. First: "${pages[0].name}"  Last: "${pages[pages.length - 1].name}"`);

  const title = 'Marcianus graecus Z. 299 (=584) — Corpus of the Greek Alchemists';
  const display_title = 'Marcianus graecus Z. 299';
  const author = 'Zosimos of Panopolis, Stephanus of Alexandria, ps.-Democritus, et al.';

  if (!COMMIT) {
    console.log('\nDRY-RUN — no downloads, no R2 writes, no DB writes.');
    console.log(`  would import 1 book (HIDDEN) + ${pages.length} pages`);
    console.log(`  title: ${title}`);
    console.log(`  R2 prefix: ${PUBLIC}/${R2_PREFIX}/<n>.jpg`);
    console.log(`  fingerprint: ${FINGERPRINT}`);
    console.log(`  sample image: ${IC_BASE}${pages[10].src}`);
    console.log(`  sample folios: ${pages.slice(6, 14).map((p) => p.name).join(' | ')}`);
    return;
  }

  const client = new MongoClient(process.env.MONGODB_URI, { maxPoolSize: 3 });
  await client.connect();
  const db = client.db('bookstore');

  const existing = await db.collection('books').findOne(
    { $or: [{ source_fingerprint: FINGERPRINT }, { 'dublin_core.dc_source': OAI_ID }] },
    { projection: { _id: 1, slug: 1 } });
  if (existing) { console.log(`Already imported: ${existing.slug} (${existing._id}). Aborting.`); await client.close(); return; }

  // 1) Mirror every page image to R2 (bounded concurrency).
  console.log(`\nMirroring ${pages.length} images to R2 (${BUCKET})…`);
  const CONC = 5;
  let done = 0, failed = 0;
  const uploaded = new Array(pages.length);
  async function worker(start) {
    for (let i = start; i < pages.length; i += CONC) {
      const p = pages[i];
      const key = `${R2_PREFIX}/${i + 1}.jpg`;
      const publicUrl = `${PUBLIC}/${key}`;
      try {
        if (!(await r2Exists(key))) {
          const res = await fetchWithRetry(IC_BASE + p.src, { headers: IC_HEADERS });
          const buf = Buffer.from(await res.arrayBuffer());
          if (buf.length < 1000) throw new Error(`suspiciously small (${buf.length}b)`);
          await r2.send(new PutObjectCommand({
            Bucket: BUCKET, Key: key, Body: buf, ContentType: 'image/jpeg',
            CacheControl: 'public, max-age=31536000, immutable',
          }));
        }
        uploaded[i] = publicUrl;
        if (++done % 25 === 0) console.log(`  …${done}/${pages.length} uploaded`);
      } catch (e) {
        failed++;
        console.error(`  ✗ page ${i + 1} (${p.name}): ${e.message}`);
      }
    }
  }
  await Promise.all(Array.from({ length: CONC }, (_, k) => worker(k)));
  console.log(`Mirror done: ${done} ok, ${failed} failed.`);
  if (failed > 0) { console.error('Aborting insert — some images failed. Re-run to resume (existing R2 objects are skipped).'); await client.close(); process.exit(1); }

  // 2) Insert book + pages.
  const bookId = new ObjectId();
  const bookIdStr = bookId.toHexString();
  const slug = await uniqueSlug(db, slugify('marcianus-graecus-299-greek-alchemists'));
  const now = new Date();

  const bookDoc = {
    _id: bookId, id: bookIdStr, slug,
    title, display_title, author,
    language: 'Greek', original_language: 'Greek',
    text_role: 'original',
    published: '10th–11th century',
    original_work_year: 950,
    categories: [], collections: ['alchemy', 'hermetica'],
    thumbnail: uploaded[0] || '',
    pages_count: pages.length, pages_ocr: 0, pages_translated: 0, pages_archived: pages.length,
    content_type: 'book',
    dublin_core: {
      dc_title: title,
      dc_source: OAI_ID,
      dc_identifier: [`internetculturale:${OAI_ID}`, 'Biblioteca Nazionale Marciana, Gr. Z. 299 (=584)'],
      dc_type: 'manuscript',
    },
    image_source: {
      provider: 'marciana', provider_name: 'Biblioteca Nazionale Marciana',
      source_url: SOURCE_URL,
      license: 'Digitization © Ministero della Cultura — Biblioteca Nazionale Marciana. Internet Culturale terms of use.',
      contributing_library: 'Biblioteca Nazionale Marciana, Venice (via Internet Culturale / Ministero della Cultura)',
      attribution: 'Su concessione del Ministero della Cultura — Biblioteca Nazionale Marciana, Venezia.',
      access_date: now,
    },
    notes: 'The "Codex Marcianus" (Gr. Z. 299, =584), 10th–11th c. parchment codex, ff. I–VIII, 1–196 (310×228 mm). Earliest and most important witness to the Greek alchemical corpus: Zosimos of Panopolis, ps.-Democritus, Stephanus of Alexandria, the Dialogue of the Philosophers and Cleopatra, alchemical symbol lists, the ouroboros. Digitized by the Biblioteca Nazionale Marciana; imported direct from the Internet Culturale page map (residential fetch) and mirrored to R2. Facsimile at the ~1400px display resolution Internet Culturale exposes publicly. OCR/translation pending (paid step, not yet run).',
    status: 'draft', hidden: true, visible: false,
    source_fingerprint: FINGERPRINT,
    normalized_title: 'marcianus graecus 299',
    normalized_author: 'zosimos of panopolis',
    created_at: now, updated_at: now,
  };
  await db.collection('books').insertOne(bookDoc);
  console.log(`\nInserted book ${bookIdStr} slug=${slug}`);

  const CHUNK = 500;
  for (let s = 0; s < pages.length; s += CHUNK) {
    const docs = pages.slice(s, s + CHUNK).map((p, k) => {
      const gi = s + k;
      const pid = new ObjectId();
      const r2url = uploaded[gi];
      return {
        _id: pid, id: pid.toHexString(), book_id: bookIdStr,
        page_number: gi + 1,
        page_label: p.name || null,
        photo: IC_BASE + p.src,          // provenance: original Internet Culturale source
        archived_photo: r2url,            // self-hosted display copy (R2) — reader serves this
        photo_original: r2url,
        thumbnail: r2url,
        image_width: p.w || null, image_height: p.h || null,
        created_at: now, updated_at: now,
      };
    });
    await db.collection('pages').insertMany(docs, { ordered: false });
    console.log(`  inserted pages ${s + 1}-${s + docs.length}`);
  }
  await client.close();
  console.log(`\nDone. Book ${bookIdStr}, ${pages.length} pages, HIDDEN. slug=${slug}`);
  console.log(`Preview (admin): https://sourcelibrary.org/book/${slug}`);
}
main().catch((e) => { console.error(e); process.exit(1); });
