/**
 * Visual split-quality audit (reproduces the 2026-03/04 method).
 *
 * For a set of books, samples pages through each, runs the #2454 decision-tree
 * gutter detector (pixel-primary → Gemini fallback) WITHOUT writing anything,
 * and renders a self-contained HTML gallery: each sampled spread shown with the
 * proposed cut line overlaid at the detected position, colored by which detector
 * fired. The eye check is the only reliable confirmation (memory: numeric
 * distributions hide failure modes that look identical in aggregate).
 *
 * Cut-line color = method:  green pixel · blue gemini · red uncertain/center
 * Book border    = verdict: green ok · amber would-park
 *
 * Usage (read-only, no DB writes):
 *   set -a; source .env.production.local; set +a
 *   node scripts/maintenance/split-audit-visual.mjs --ids id1,id2,... --out /tmp/split-audit.html
 *   node scripts/maintenance/split-audit-visual.mjs --ids-file /tmp/ids.json --samples 6
 */

import { MongoClient } from 'mongodb';
import sharp from 'sharp';
import { writeFileSync } from 'fs';
import { detectGutterPixel } from '../lib/gutter-detect.mjs';

const arg = (flag, def) => {
  const i = process.argv.indexOf(flag);
  return i !== -1 ? process.argv[i + 1] : def;
};
const OUT = arg('--out', '/tmp/split-audit.html');
const SAMPLES = parseInt(arg('--samples', '6'), 10);
let IDS = (arg('--ids', '') || '').split(',').filter(Boolean);
if (!IDS.length && arg('--ids-file')) {
  IDS = JSON.parse((await import('fs')).readFileSync(arg('--ids-file'), 'utf8'));
}
if (!IDS.length) { console.error('Provide --ids or --ids-file'); process.exit(1); }

const MIN_SPREAD_AR = 1.1;

// Gemini gutter fallback — same prompt/model as split-book.mjs --gutter-only.
let geminiModel = null;
const GUTTER_PROMPT = `This image is a scan from a book. Decide whether it shows a TWO-PAGE SPREAD (an open book with a left and a right page) or a SINGLE page.

Respond with EXACTLY one tag and nothing else:
- Two-page spread: <split-position>N</split-position> where N (0-1000) is the horizontal position of the gutter (the fold between the pages). The gutter is usually near the center (400-600).
- Single page: <split-position>null</split-position>`;
async function initGemini() {
  const { GoogleGenerativeAI } = await import('@google/generative-ai');
  geminiModel = new GoogleGenerativeAI(process.env.GEMINI_API_KEY).getGenerativeModel({ model: 'gemini-3.1-flash-lite' });
}
async function runGutterDetect(buf) {
  const r = await geminiModel.generateContent([GUTTER_PROMPT, { inlineData: { mimeType: 'image/jpeg', data: buf.toString('base64') } }]);
  const m = r.response.text().match(/<split-position>([^<]*)<\/split-position>/);
  if (!m) return null;
  const n = parseInt(m[1]);
  return (!isNaN(n) && n > 0 && n < 1000) ? n : 'single';
}

// Resolve one decision-tree result for a page image (no writes).
async function decide(buf) {
  const meta = await sharp(buf).metadata();
  const ar = meta.width / meta.height;
  if (ar < MIN_SPREAD_AR) return { colPx: null, pct: null, method: 'portrait', color: '#7a7ae8', uncertain: false, ar, meta };
  const pix = await detectGutterPixel(buf);
  if (pix.confidence === 'high' && pix.column != null) {
    return { colPx: pix.column, pct: (pix.column / meta.width) * 100, method: `pixel (${pix.reason})`, color: '#7ae87a', uncertain: false, ar, meta };
  }
  if (!geminiModel) await initGemini();
  let gem = null;
  try { gem = await runGutterDetect(buf); } catch { gem = null; }
  if (typeof gem === 'number') return { colPx: Math.round((gem / 1000) * meta.width), pct: gem / 10, method: 'gemini', color: '#7a9ae8', uncertain: false, ar, meta };
  if (ar >= 1.3) return { colPx: Math.round(meta.width / 2), pct: 50, method: 'center (uncertain)', color: '#e87a7a', uncertain: true, ar, meta };
  return { colPx: null, pct: null, method: 'kept-whole (uncertain)', color: '#e8b07a', uncertain: true, ar, meta };
}

const HEX = { '#7ae87a': [122, 232, 122], '#7a9ae8': [122, 154, 232], '#e87a7a': [232, 122, 122], '#e8b07a': [232, 176, 122], '#7a7ae8': [122, 122, 232] };

// Gutter-zoom: crop a vertical band around the cut, burn the cut line into the
// image, return a base64 PNG data-URI. This is the diagnostic view — the
// line-vs-text relationship is unmistakable, and a data-URI always renders in a
// headless screenshot (remote loads can flake).
async function gutterZoom(buf, colPx, color, meta) {
  const H = 340;
  const bandHalf = Math.round(meta.width * 0.16);
  const left = colPx != null ? Math.max(0, colPx - bandHalf) : 0;
  const w = colPx != null ? Math.min(meta.width - left, bandHalf * 2) : meta.width;
  const region = await sharp(buf).extract({ left, top: 0, width: w, height: meta.height }).resize({ height: H }).toBuffer();
  const rMeta = await sharp(region).metadata();
  if (colPx == null) return `data:image/png;base64,${(await sharp(region).png().toBuffer()).toString('base64')}`;
  const scale = H / meta.height;
  const lineX = Math.round((colPx - left) * scale);
  const [r, g, b] = HEX[color] || [255, 0, 0];
  const svg = Buffer.from(`<svg width="${rMeta.width}" height="${H}"><line x1="${lineX}" y1="0" x2="${lineX}" y2="${H}" stroke="rgb(${r},${g},${b})" stroke-width="3"/></svg>`);
  const out = await sharp(region).composite([{ input: svg, top: 0, left: 0 }]).png().toBuffer();
  return `data:image/png;base64,${out.toString('base64')}`;
}

const client = new MongoClient(process.env.MONGODB_URI);
await client.connect();
const db = client.db('bookstore');

const esc = (s) => String(s || '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
let bookHtml = '';
let parkCount = 0;

for (const id of IDS) {
  const book = await db.collection('books').findOne({ id }, { projection: { id: 1, title: 1, slug: 1, pages_count: 1, image_source: 1 } });
  if (!book) { console.error(`skip ${id}: not found`); continue; }
  const pages = await db.collection('pages').find({ book_id: id }, { projection: { page_number: 1, archived_photo: 1, photo: 1 } }).sort({ page_number: 1 }).toArray();
  const total = pages.length;
  if (!total) continue;

  // sample SAMPLES pages evenly through the book
  const idxs = [...new Set(Array.from({ length: Math.min(SAMPLES, total) }, (_, i) => Math.floor(((i + 1) / (Math.min(SAMPLES, total) + 1)) * total)))];
  let samplesHtml = '';
  let uncertain = 0, landscape = 0;
  for (const idx of idxs) {
    const p = pages[idx];
    const url = p.archived_photo || p.photo;
    if (!url) continue;
    let d, zoom;
    try {
      const buf = Buffer.from(await (await fetch(url, { signal: AbortSignal.timeout(20000) })).arrayBuffer());
      d = await decide(buf);
      zoom = await gutterZoom(buf, d.colPx, d.color, d.meta);
    } catch (e) { samplesHtml += `<div class="sample"><div class="err">p${p.page_number} fetch fail</div></div>`; continue; }
    if (d.method !== 'portrait') landscape++;
    if (d.uncertain) uncertain++;
    samplesHtml += `<div class="sample"><div class="imgwrap"><img src="${zoom}" alt="p${p.page_number}"></div><div class="label" style="color:${d.color}">p${p.page_number} · AR ${d.ar.toFixed(2)}<br>${esc(d.method)}</div></div>`;
  }
  const uncertainFrac = landscape ? uncertain / landscape : 0;
  const wouldPark = uncertainFrac > 0.15;
  if (wouldPark) parkCount++;
  const url = `https://sourcelibrary.org/book/${book.slug || book.id}`;
  bookHtml += `<div class="book" style="border-color:${wouldPark ? '#e8b07a' : '#7ae87a'}">
    <h2><a href="${url}" target="_blank">${esc(book.title)}</a> ${wouldPark ? '<span class="park">WOULD PARK</span>' : ''}</h2>
    <div class="meta">${esc(book.image_source?.provider || '?')} · ${total} pages · ${uncertain}/${landscape} sampled-landscape uncertain</div>
    <div class="samples">${samplesHtml}</div>
  </div>`;
  console.error(`done ${id}: ${uncertain}/${landscape} uncertain${wouldPark ? ' (PARK)' : ''}`);
}

const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Split Audit — Difficult Subset</title><style>
body{font-family:system-ui;background:#1a1a1a;color:#ddd;padding:20px;max-width:1500px;margin:0 auto}
h1{color:#e8c87a}
.legend{display:flex;gap:18px;margin:14px 0;font-size:13px;flex-wrap:wrap}
.legend span{display:flex;align-items:center;gap:6px}
.dot{width:12px;height:12px;border-radius:50%;display:inline-block}
.book{border:2px solid #333;margin:18px 0;padding:14px;border-radius:8px;background:#222}
.book h2{font-size:15px;color:#e8c87a;margin:0 0 4px}
.book h2 a{color:#e8c87a;text-decoration:none}
.park{color:#e8b07a;font-size:11px;border:1px solid #e8b07a;padding:1px 6px;border-radius:4px;margin-left:8px}
.meta{font-size:12px;color:#888;margin-bottom:10px}
.samples{display:flex;gap:10px;overflow-x:auto;padding-bottom:8px}
.sample{flex-shrink:0;text-align:center}
.imgwrap{position:relative;display:inline-block}
.imgwrap img{height:340px;border:1px solid #444;border-radius:4px;display:block;image-rendering:auto}
.cut{position:absolute;top:0;bottom:0;width:2px;opacity:0.85}
.label{font-size:11px;margin-top:4px;line-height:1.3}
.err{color:#e87a7a;font-size:12px;height:360px;display:flex;align-items:center;padding:0 20px}
</style></head><body>
<h1>Split Audit — Difficult Subset (${IDS.length} books, ${parkCount} would park)</h1>
<p style="font-size:13px;color:#aaa">Each tile is a <b>zoom on the gutter region</b> with the proposed cut line burned in. Check: does the line sit in the binding, or slice through text? Color = which detector chose the cut.</p>
<div class="legend">
<span><span class="dot" style="background:#7ae87a"></span>pixel (free)</span>
<span><span class="dot" style="background:#7a9ae8"></span>gemini fallback</span>
<span><span class="dot" style="background:#e87a7a"></span>center — uncertain</span>
<span><span class="dot" style="background:#e8b07a"></span>kept whole — uncertain</span>
<span><span class="dot" style="background:#7a7ae8"></span>portrait (no cut)</span>
</div>
${bookHtml}
</body></html>`;

writeFileSync(OUT, html);
console.error(`\nWrote ${OUT} (${IDS.length} books, ${parkCount} would park)`);
await client.close();
