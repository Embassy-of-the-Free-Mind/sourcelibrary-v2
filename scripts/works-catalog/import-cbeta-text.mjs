#!/usr/bin/env node
/**
 * Import CBETA Buddhist-canon TEXT EDITIONS into Source Library as readable
 * scanless books (#2453). The reader already supports text-only works via
 * content_type:'text' (precedent: the Wikisource "Babad Tanah Djawi" import —
 * pages.ocr.data holds the text, no page images, pipeline_auto.ocr_deferred).
 *
 * Source: CBETA TEI P5 (github.com/cbeta-org/xml-p5). Rights: text bodies are
 * CC BY-NC-SA 3.0 TW; base Taishō © Daizō Shuppansha / Zokuzōkyō © Kokusho
 * Kankōkai (input rights granted to CBETA) — non-commercial + ShareAlike +
 * attribution. Source Library is a nonprofit and records full attribution +
 * version, so the terms are met (Derek-approved 2026-06-17).
 *
 * TEXT EXTRACTION is careful by design — corrupting scripture violates the
 * quote-integrity doctrine. We: resolve gaiji <g ref="#CBxxxx"/> via the CBETA
 * gaiji map (unicode-char > normal > zzs descriptor), DROP <note>/<rdg> variant
 * apparatus (keep <lem>), segment pages on Taishō <pb n=…> (citation anchors),
 * strip remaining tags, and remove intra-line whitespace while preserving
 * paragraph breaks. Always --dry-run and eyeball before writing.
 *
 *   set -a; source .env.production.local; set +a
 *   node scripts/works-catalog/import-cbeta-text.mjs --ids=T0251,T0235,T2008 --dry-run
 *   node scripts/works-catalog/import-cbeta-text.mjs --ids=T0251,T0235,T2008 --visible
 *   node scripts/works-catalog/import-cbeta-text.mjs --canon=T --limit=200   # bulk (hidden)
 */
import { MongoClient, ObjectId } from 'mongodb';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import { fetchRetry } from './lib.mjs';
import { uploadPageVariants } from '../workers/lib/display-image.mjs';

const args = Object.fromEntries(process.argv.slice(2).filter(a => a.startsWith('--')).map(a => { const [k, v] = a.slice(2).split('='); return [k, v ?? true]; }));
const DRY_RUN = 'dry-run' in args;
const VISIBLE = 'visible' in args;            // default: hidden (import-doctrine)
const LIMIT = parseInt(args.limit) || Infinity;
const RAW = 'https://raw.githubusercontent.com';
const REPO_META = 'DILA-edu/cbeta-metadata';
const REPO_XML = 'cbeta-org/xml-p5';

// ── gaiji map (CB id -> char) ────────────────────────────────────────────────
console.error('Loading CBETA gaiji map…');
const GAIJI = await (await fetchRetry(`${RAW}/${REPO_META}/master/gaiji/gaiji.json`)).json();
const resolveGaiji = (id) => {
  const e = GAIJI[id];
  if (!e) return `〔${id}〕`;
  return e['unicode-char'] || e['normal'] || (e.zzs ? e.zzs : `〔${id}〕`);
};

// ── work list ────────────────────────────────────────────────────────────────
async function workInfoFor(canons) {
  const map = {};
  for (const canon of canons) {
    const j = await (await fetchRetry(`${RAW}/${REPO_META}/master/work-info/${canon}.json`)).json();
    Object.assign(map, j);
  }
  return map;
}
const canonOf = (wid) => (wid.match(/^[A-Z]+/) || [''])[0];

let ids;
if (args.ids) ids = String(args.ids).split(',');
else if (args.canon) {
  const wi = await workInfoFor([args.canon]);
  ids = Object.entries(wi).filter(([, w]) => (!w.type || w.type === 'textbody') && w.title).map(([k]) => k).slice(0, LIMIT);
} else { console.error('Provide --ids=… or --canon=…'); process.exit(1); }

const canons = [...new Set(ids.map(canonOf))];
const WI = await workInfoFor(canons);

// ── TEI text extraction ──────────────────────────────────────────────────────
function teiPath(wid) {
  const w = WI[wid]; if (!w?.vol) return null;
  const canon = canonOf(wid);
  const num = wid.slice(canon.length);
  return `${canon}/${w.vol}/${w.vol}n${num}.xml`;
}
function decode(s) { return s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&').replace(/&#x([0-9A-Fa-f]+);/g, (_, h) => String.fromCodePoint(parseInt(h, 16))); }

function extract(xml) {
  const bodyM = xml.match(/<body[^>]*>([\s\S]*?)<\/body>/);
  if (!bodyM) return { pages: [] };
  let body = bodyM[1];
  body = body.replace(/<g\s+ref="#([A-Za-z0-9_]+)"\s*\/>/g, (_, id) => resolveGaiji(id));
  body = body.replace(/<note\b[\s\S]*?<\/note>/g, '');         // editorial / inline notes
  body = body.replace(/<rdg\b[\s\S]*?<\/rdg>/g, '');           // variant readings (keep <lem>)
  // page segmentation on Taishō <pb>. NOTE: text before the first <pb> (e.g. the
  // sutra's opening 如是我聞…) is real content on the opening page — fold it into
  // page 1, never drop it.
  const labels = [...body.matchAll(/<pb\b[^>]*?\bn="([^"]+)"[^>]*\/>/g)].map(m => m[1]);
  const segs = body.split(/<pb\b[^>]*\/>/);
  const clean = (seg) => decode(seg
    .replace(/<lb\b[^>]*\/>/g, '')
    .replace(/<\/(p|head|lg|l|lem|cb:mulu|cb:docNumber|cb:juan|cb:div|div|trailer|byline)>/g, '\n')
    .replace(/<[^>]+>/g, ''))
    .replace(/[ \t　]+/g, '')
    .replace(/\n{2,}/g, '\n').trim();
  const pages = [];
  if (segs.length === 1) {                 // no <pb> at all — whole body is one page
    const text = clean(segs[0]);
    if (/[㐀-鿿]/.test(text)) pages.push({ label: 'p1', text });
    return { pages };
  }
  for (let i = 1; i < segs.length; i++) {
    const text = clean(i === 1 ? segs[0] + '\n' + segs[1] : segs[i]); // fold pre-first-pb front into page 1
    if (/[㐀-鿿]/.test(text)) pages.push({ label: labels[i - 1] || `p${i}`, text });
  }
  return { pages };
}
function teiTitle(xml) { return (xml.match(/<title level="m"[^>]*xml:lang="zh-Hant"[^>]*>([^<]+)/) || xml.match(/<title level="m"[^>]*>([^<]+)/) || [])[1] || null; }
function teiAuthor(xml) { return (xml.match(/<author>([^<]+)<\/author>/) || [])[1] || null; }

// ── representative facsimile cover (cuneiform model) ─────────────────────────
// Match the work to an OPENLY-LICENSED scanned edition we've harvested and use a
// representative page as the book's cover/hero. NOT the Taishō print facsimile
// (© Daizō Shuppansha, uncleared) — only libraries whose digitised copies are
// freely reusable. The scan is representative of the work, not page-aligned.
const COVER_PROVIDERS = ['sbb', 'ia_language', 'bsb', 'sat_daizokyo', 'harvard', 'goettingen'];
const COVER_PROVIDER_NAME = { sbb: 'Staatsbibliothek zu Berlin', ia_language: 'Internet Archive', bsb: 'Bayerische Staatsbibliothek', sat_daizokyo: 'SAT Daizōkyō (partner libraries)', harvard: 'Harvard-Yenching Library', goettingen: 'Göttingen State and University Library' };
const cjkOnly = (s) => [...(s || '')].filter(ch => /[㐀-鿿]/.test(ch)).join('');

async function matchFacsimile(ICands, cjkTitle) {
  const key = cjkOnly(cjkTitle);
  if (key.length < 2) return null;
  // candidates from open providers whose title CONTAINS the work title (work name leads)
  const cands = await ICands.find(
    { source: { $in: COVER_PROVIDERS }, manifest_url: { $ne: null }, title: { $regex: key.slice(0, 12) } },
    { projection: { title: 1, source: 1, manifest_url: 1, source_url: 1 } }
  ).limit(30).toArray();
  // prefer exact-title match, then shortest (least extra commentary), provider order
  const scored = cands
    .map(c => ({ c, ct: cjkOnly(c.title) }))
    .filter(x => x.ct.startsWith(key) || key.startsWith(x.ct))
    .sort((a, b) => (a.ct === key ? -1 : b.ct === key ? 1 : 0) || a.ct.length - b.ct.length || COVER_PROVIDERS.indexOf(a.c.source) - COVER_PROVIDERS.indexOf(b.c.source));
  return scored[0]?.c || null;
}

// First canvas image of a IIIF v2/v3 manifest → a full-ish JPEG URL.
async function coverImageUrl(manifestUrl) {
  try {
    const m = await (await fetchRetry(manifestUrl)).json();
    // IIIF v2
    let svc = m?.sequences?.[0]?.canvases?.[0]?.images?.[0]?.resource?.service;
    svc = Array.isArray(svc) ? svc[0] : svc;
    let base = svc?.['@id'] || svc?.id;
    if (base) return `${base.replace(/\/$/, '')}/full/!1000,1400/0/default.jpg`;
    // IIIF v3
    const body = m?.items?.[0]?.items?.[0]?.items?.[0]?.body;
    svc = Array.isArray(body?.service) ? body.service[0] : body?.service;
    base = svc?.id || svc?.['@id'];
    if (base) return `${base.replace(/\/$/, '')}/full/!1000,1400/0/default.jpg`;
    // last resort: direct image id
    const direct = m?.sequences?.[0]?.canvases?.[0]?.images?.[0]?.resource?.['@id'] || body?.id;
    return direct || null;
  } catch { return null; }
}

// ── import ───────────────────────────────────────────────────────────────────
const mc = new MongoClient(process.env.MONGODB_URI);
await mc.connect();
const Books = mc.db('bookstore').collection('books');
const Pages = mc.db('bookstore').collection('pages');
const ICands = mc.db('bookstore').collection('import_candidates');
const now = new Date();
let created = 0, skipped = 0, withCover = 0;

// R2 (rehost the representative cover, like every other SL image)
const r2 = new S3Client({
  region: 'auto', endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
  credentials: { accessKeyId: process.env.R2_ACCESS_KEY_ID, secretAccessKey: process.env.R2_SECRET_ACCESS_KEY },
});
const R2_BUCKET = process.env.R2_BUCKET_NAME || 'sourcelibrary';
const R2_PUBLIC = process.env.R2_PUBLIC_URL || 'https://images.sourcelibrary.org';
const uploadToR2 = async (key, buf, ct = 'image/jpeg') => {
  await r2.send(new PutObjectCommand({ Bucket: R2_BUCKET, Key: key, Body: buf, ContentType: ct, CacheControl: 'public, max-age=86400, s-maxage=86400' }));
  return `${R2_PUBLIC}/${key}`;
};
async function buildCover(bookId, cjkTitle) {
  const fac = await matchFacsimile(ICands, cjkTitle);
  if (!fac) return null;
  const imgUrl = await coverImageUrl(fac.manifest_url);
  if (!imgUrl) return null;
  try {
    const res = await fetch(imgUrl, { signal: AbortSignal.timeout(45000) });
    if (!res.ok) return null;
    const buf = Buffer.from(await res.arrayBuffer());
    const v = await uploadPageVariants(buf, bookId, 1, uploadToR2);
    return { ...v, facsimile: fac };
  } catch { return null; }
}

for (const wid of ids.slice(0, LIMIT)) {
  const path = teiPath(wid);
  if (!path) { console.error(`  ${wid}: no work-info/vol, skip`); continue; }
  let xml;
  try { const r = await fetchRetry(`${RAW}/${REPO_XML}/master/${path}`); if (!r.ok) throw new Error('HTTP ' + r.status); xml = await r.text(); }
  catch (e) { console.error(`  ${wid}: fetch ${path} failed (${e.message})`); continue; }

  const { pages } = extract(xml);
  const wi = WI[wid] || {};
  const title = wi.title || teiTitle(xml) || wid;
  const author = (wi.byline || teiAuthor(xml) || '').trim() || null;
  const totalChars = pages.reduce((s, p) => s + p.text.length, 0);
  if (!pages.length || totalChars < 10) { console.error(`  ${wid} "${title}": no extractable text, skip`); continue; }

  const fingerprint = `cbeta:${wid}`;
  const existing = await Books.findOne({ source_fingerprint: fingerprint }, { projection: { _id: 1 } });
  if (DRY_RUN) {
    console.log(`\n=== ${wid}  ${title}  (${author || '—'}) ===`);
    console.log(`pages: ${pages.length} | chars: ${totalChars} | exists: ${!!existing}`);
    console.log(`first page [${pages[0].label}]: ${pages[0].text.slice(0, 180)}…`);
    const lastp = pages[pages.length - 1];
    console.log(`last page  [${lastp.label}]: ${lastp.text.slice(-120)}`);
    const leftover = pages.some(p => /[<>]|〔CB/.test(p.text));
    if (leftover) console.log('  ⚠ possible markup/gaiji leakage — inspect');
    continue;
  }
  if (existing) { skipped++; continue; }

  const _id = new ObjectId();
  const id = _id.toString();
  const slug = `cbeta-${wid.toLowerCase()}`;
  const cover = await buildCover(id, title);   // representative facsimile (may be null)
  if (cover) withCover++;
  const fac = cover?.facsimile;
  await Books.insertOne({
    _id, id, slug, title, display_title: title, author: author || 'Anonymous',
    language: 'Classical Chinese', original_language: 'lzh', published: null,
    content_type: 'book',
    collections: ['chinese-buddhist-canon', 'world-traditions'],
    categories: ['buddhist-canon', 'chinese-literature'],
    pages_count: pages.length, pages_ocr: pages.length, pages_translated: 0, pages_blank: 0,
    // The readable text is CBETA's digital edition; the cover is a representative
    // scan from an open library (NOT the © Taishō print). image_source credits the
    // scan provider; metadata.text_edition + attribution credit CBETA + the publishers.
    image_source: cover ? {
      provider: fac.source, provider_name: COVER_PROVIDER_NAME[fac.source] || fac.source,
      source_url: fac.source_url || fac.manifest_url,
      license: 'Representative facsimile from an open library (see provider); text: CC BY-NC-SA 3.0 TW (CBETA)',
      attribution: `Representative scan: ${COVER_PROVIDER_NAME[fac.source] || fac.source}. Text: CBETA digital edition of the Taishō Tripiṭaka (© Daizō Shuppansha) / Zokuzōkyō (© Kokusho Kankōkai)`,
      access_date: now,
    } : {
      provider: 'cbeta', provider_name: 'CBETA (Chinese Buddhist Electronic Text Association)',
      source_url: `https://cbetaonline.dila.edu.tw/${wid}`,
      license: 'CC BY-NC-SA 3.0 TW; base text © Taishō (Daizō Shuppansha) / Zokuzōkyō (Kokusho Kankōkai)',
      attribution: 'CBETA digital edition; base text: Taishō Tripiṭaka (Daizō Shuppansha) & Zokuzōkyō (Kokusho Kankōkai)',
      access_date: now,
    },
    ...(cover ? { thumbnail: cover.thumb, image_thumb: cover.thumb, image_display: cover.display, thumbnail_blob: cover.thumb, cover_page: 1 } : {}),
    metadata: { source: 'cbeta', cbeta_id: wid, dynasty: wi.dynasty || null, category: wi.category || null, total_chars: totalChars, script: 'Han (Traditional)', text_edition: 'CBETA', cover_facsimile: fac ? `${fac.source}:${fac.manifest_url}` : null },
    source_fingerprint: fingerprint, status: 'imported', hidden: !VISIBLE, visible: VISIBLE,
    pipeline_auto: { status: 'images_complete', ocr_deferred: true, ocr_deferred_reason: 'CBETA text edition; cover is a representative facsimile, body pages are scholarly text' },
    created_at: now, updated_at: now,
  });
  await Pages.insertMany(pages.map((p, idx) => {
    const pid = new ObjectId();             // pages have a UNIQUE index on `id`
    const doc = {
      _id: pid, id: pid.toString(),
      book_id: id, page_number: idx + 1, page_label: p.label,
      ocr: { data: p.text, model: 'cbeta-tei-p5', generated_at: now, updated_at: now },
      created_at: now, updated_at: now,
    };
    if (idx === 0 && cover) {               // representative scan sits on the opening page
      doc.display_photo = cover.display; doc.archived_photo = cover.archived; doc.thumbnail_blob = cover.thumb;
      if (cover.width) doc.image_width = cover.width;
      if (cover.height) doc.image_height = cover.height;
    }
    return doc;
  }));
  created++;
  console.log(`  + ${wid} "${title}" — ${pages.length} pages, ${totalChars} chars${cover ? ` +cover[${fac.source}]` : ' (no facsimile match)'} (${VISIBLE ? 'visible' : 'hidden'})  /book/${slug}`);
}
await mc.close();
console.log(`\nDone. created ${created} (${withCover} with a representative scan), skipped ${skipped} (existing).${DRY_RUN ? ' [DRY RUN — nothing written]' : ''}`);
