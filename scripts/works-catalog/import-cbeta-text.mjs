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
import { fetchRetry } from './lib.mjs';

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

// ── import ───────────────────────────────────────────────────────────────────
const mc = new MongoClient(process.env.MONGODB_URI);
await mc.connect();
const Books = mc.db('bookstore').collection('books');
const Pages = mc.db('bookstore').collection('pages');
const now = new Date();
let created = 0, skipped = 0;

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
  await Books.insertOne({
    _id, id, slug, title, display_title: title, author: author || 'Anonymous',
    language: 'Classical Chinese', original_language: 'lzh', published: null,
    content_type: 'text', resource_type: 'text',
    collections: ['chinese-buddhist-canon', 'world-traditions'],
    categories: ['buddhist-canon', 'chinese-literature'],
    pages_count: pages.length, pages_ocr: pages.length, pages_translated: 0, pages_blank: 0,
    image_source: {
      provider: 'cbeta', provider_name: 'CBETA (Chinese Buddhist Electronic Text Association)',
      source_url: `https://cbetaonline.dila.edu.tw/${wid}`,
      license: 'CC BY-NC-SA 3.0 TW; base text © Taishō Tripiṭaka (Daizō Shuppansha) / Zokuzōkyō (Kokusho Kankōkai), input rights granted to CBETA',
      attribution: 'CBETA digital edition; base text: Taishō Tripiṭaka (Daizō Shuppansha) & Zokuzōkyō (Kokusho Kankōkai)',
      access_date: now,
    },
    metadata: { source: 'cbeta', cbeta_id: wid, dynasty: wi.dynasty || null, category: wi.category || null, total_chars: totalChars, script: 'Han (Traditional)' },
    source_fingerprint: fingerprint, status: 'imported', hidden: !VISIBLE, visible: VISIBLE,
    pipeline_auto: { status: 'images_complete', ocr_deferred: true, ocr_deferred_reason: 'text-only work (CBETA digital edition); no scan' },
    created_at: now, updated_at: now,
  });
  await Pages.insertMany(pages.map((p, idx) => ({
    book_id: id, page_number: idx + 1, page_label: p.label,
    ocr: { data: p.text, model: 'cbeta-tei-p5', generated_at: now },
    created_at: now, updated_at: now,
  })));
  created++;
  console.log(`  + ${wid} "${title}" — ${pages.length} pages, ${totalChars} chars (${VISIBLE ? 'visible' : 'hidden'})  /book/${slug}`);
}
await mc.close();
console.log(`\nDone. created ${created}, skipped ${skipped} (existing).${DRY_RUN ? ' [DRY RUN — nothing written]' : ''}`);
