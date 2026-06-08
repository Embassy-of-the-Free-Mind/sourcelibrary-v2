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
const GEMINI_MODEL = arg('--gemini-model', 'gemini-3-flash-preview');
let IDS = (arg('--ids', '') || '').split(',').filter(Boolean);
if (!IDS.length && arg('--ids-file')) {
  IDS = JSON.parse((await import('fs')).readFileSync(arg('--ids-file'), 'utf8'));
}
if (!IDS.length) { console.error('Provide --ids or --ids-file'); process.exit(1); }

const MIN_SPREAD_AR = 1.1;

// Gemini gutter fallback — same prompt/model as split-book.mjs --gutter-only.
let geminiModel = null;
const GUTTER_PROMPT = `This is a photo of an open book showing a left page and a right page. Find the GUTTER — the vertical line where the two pages meet at the binding (often a shadow, or the innermost margins of the two pages). It may NOT be at the center; look carefully.

Respond with EXACTLY one tag and nothing else:
- Two-page spread: <split-position>N</split-position> where N (0-1000) is the gutter's horizontal position. 0 = far left edge, 1000 = far right edge.
- Single page (not a spread): <split-position>null</split-position>`;
async function initGemini() {
  const { GoogleGenerativeAI } = await import('@google/generative-ai');
  geminiModel = new GoogleGenerativeAI(process.env.GEMINI_API_KEY).getGenerativeModel({ model: GEMINI_MODEL });
}
async function runGutterDetect(buf) {
  const r = await geminiModel.generateContent([GUTTER_PROMPT, { inlineData: { mimeType: 'image/jpeg', data: buf.toString('base64') } }]);
  const m = r.response.text().match(/<split-position>([^<]*)<\/split-position>/);
  if (!m) return null;
  const n = parseInt(m[1]);
  return (!isNaN(n) && n > 0 && n < 1000) ? n : 'single';
}

// Resolve one decision-tree result (no writes): pixel valley + Gemini cross-check.
const AGREE_TOL = 80; // 0-1000 → 8%
async function decide(buf) {
  const meta = await sharp(buf).metadata();
  const ar = meta.width / meta.height;
  if (ar < MIN_SPREAD_AR) return { colPx: null, pct: null, method: 'portrait', color: '#7a7ae8', uncertain: false, ar, meta };
  const pix = await detectGutterPixel(buf);
  const pixPos = (pix.confidence === 'high' && pix.column != null) ? Math.round((pix.column / meta.width) * 1000) : null;
  if (!geminiModel) await initGemini();
  let gemPos = null;
  try { gemPos = await runGutterDetect(buf); if (typeof gemPos !== 'number') gemPos = null; } catch { gemPos = null; }
  const toCol = (pos1000) => Math.round((pos1000 / 1000) * meta.width);
  if (pixPos != null && gemPos != null) {
    if (Math.abs(pixPos - gemPos) <= AGREE_TOL) {
      const pos = Math.round((pixPos + gemPos) / 2);
      return { colPx: toCol(pos), pct: pos / 10, method: `agree px${pixPos}/gem${gemPos}`, color: '#7ae87a', uncertain: false, pos, confirmed: true, ar, meta };
    }
    // disagree → uncertain
    return { colPx: toCol(pixPos), pct: pixPos / 10, method: `DISAGREE px${pixPos}/gem${gemPos}`, color: '#e87a7a', uncertain: true, ar, meta };
  }
  if (pixPos != null) return { colPx: toCol(pixPos), pct: pixPos / 10, method: `pixel ${pix.reason}`, color: '#9ae87a', uncertain: false, pos: pixPos, confirmed: true, ar, meta };
  if (gemPos != null) return { colPx: toCol(gemPos), pct: gemPos / 10, method: `gemini ${gemPos}`, color: '#7a9ae8', uncertain: false, pos: gemPos, confirmed: true, ar, meta };
  if (ar >= 1.3) return { colPx: Math.round(meta.width / 2), pct: 50, method: 'center (uncertain)', color: '#e87a7a', uncertain: true, ar, meta };
  return { colPx: null, pct: null, method: 'kept-whole (uncertain)', color: '#e8b07a', uncertain: true, ar, meta };
}

const HEX = { '#7ae87a': [122, 232, 122], '#7a9ae8': [122, 154, 232], '#e87a7a': [232, 122, 122], '#e8b07a': [232, 176, 122], '#7a7ae8': [122, 122, 232] };

// Honest render: the FULL spread with the cut line at its TRUE horizontal
// position (not a band re-centered on the cut). This is the only view that
// shows whether the line lands in the binding or slices a column. Burned into
// the image (data-URI) so a headless screenshot always renders it.
async function fullSpreadWithLine(buf, colPx, color, meta) {
  const W = 520;
  const scale = W / meta.width;
  const H = Math.round(meta.height * scale);
  const base = await sharp(buf).resize(W, H, { fit: 'fill' }).toBuffer();
  if (colPx == null) return `data:image/png;base64,${(await sharp(base).png().toBuffer()).toString('base64')}`;
  const lineX = Math.round(colPx * scale);
  const [r, g, b] = HEX[color] || [255, 0, 0];
  const svg = Buffer.from(`<svg width="${W}" height="${H}"><line x1="${lineX}" y1="0" x2="${lineX}" y2="${H}" stroke="rgb(${r},${g},${b})" stroke-width="2"/></svg>`);
  const out = await sharp(base).composite([{ input: svg, top: 0, left: 0 }]).png().toBuffer();
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
  const pages = await db.collection('pages').find({ book_id: id }, { projection: { page_number: 1, archived_photo: 1, photo: 1, page_type: 1, 'ocr.data': 1 } }).sort({ page_number: 1 }).toArray();
  const total = pages.length;
  if (!total) continue;

  // OCR content class (free): plate/map book vs text spread book.
  const IMG_PAGE_TYPES = new Set(['map', 'illustration', 'diagram', 'frontispiece', 'plate']);
  let imgPages = 0, contentPages = 0;
  for (const pg of pages) {
    if (pg.page_type === 'blank') continue;
    const body = (pg.ocr?.data || '').replace(/<[^>]+>/g, '').trim().length;
    if (IMG_PAGE_TYPES.has(pg.page_type) || (/<image-desc>/i.test(pg.ocr?.data || '') && body < 400)) imgPages++; else contentPages++;
  }
  const imgFrac = (imgPages + contentPages) ? imgPages / (imgPages + contentPages) : 0;
  const contentClass = imgFrac >= 0.6 ? 'PLATE/MAP — keep whole' : imgFrac >= 0.25 ? 'MIXED — review' : 'text';

  // Pass 1: decide each sampled page (no rendering yet — need the book median first).
  const idxs = [...new Set(Array.from({ length: Math.min(SAMPLES, total) }, (_, i) => Math.floor(((i + 1) / (Math.min(SAMPLES, total) + 1)) * total)))];
  const samples = [];
  const confidentPositions = [];
  let landscape = 0;
  for (const idx of idxs) {
    const p = pages[idx];
    const url = p.archived_photo || p.photo;
    if (!url) continue;
    try {
      const buf = Buffer.from(await (await fetch(url, { signal: AbortSignal.timeout(20000) })).arrayBuffer());
      const d = await decide(buf);
      if (d.method !== 'portrait') landscape++;
      if (d.confirmed && typeof d.pos === 'number') confidentPositions.push(d.pos);
      samples.push({ p, buf, d });
    } catch { samples.push({ p, err: true }); }
  }

  // Book consensus (approach A): robust median + MAD; snap outliers/uncertain to it.
  const sorted = [...confidentPositions].sort((a, b) => a - b);
  const median = sorted.length ? sorted[Math.floor(sorted.length / 2)] : 500;
  const mad = sorted.length ? [...sorted.map(v => Math.abs(v - median))].sort((a, b) => a - b)[Math.floor(sorted.length / 2)] : 0;
  const enoughSignal = confidentPositions.length >= Math.max(2, Math.ceil(landscape * 0.25));
  const scattered = confidentPositions.length >= 3 && mad > 60;
  const wouldPark = imgFrac >= 0.25 || !enoughSignal || scattered;
  if (wouldPark) parkCount++;

  // Pass 2: render, snapping outlier/uncertain landscape pages to the median.
  let samplesHtml = '', snapped = 0;
  for (const s of samples) {
    if (s.err) { samplesHtml += `<div class="sample"><div class="err">p${s.p.page_number} fetch fail</div></div>`; continue; }
    let { d } = s; let colPx = d.colPx, color = d.color, method = d.method;
    const isLandscape = d.method !== 'portrait';
    if (!wouldPark && isLandscape && (d.uncertain || (typeof d.pos === 'number' && Math.abs(d.pos - median) > 80))) {
      colPx = Math.round((median / 1000) * d.meta.width); color = '#c79ae8'; method = `book-median(${median})`; snapped++;
    }
    const zoom = await fullSpreadWithLine(s.buf, colPx, color, d.meta);
    samplesHtml += `<div class="sample"><div class="imgwrap"><img src="${zoom}" alt="p${s.p.page_number}"></div><div class="label" style="color:${color}">p${s.p.page_number} · AR ${d.ar.toFixed(2)}<br>${esc(method)}</div></div>`;
  }
  const url = `https://sourcelibrary.org/book/${book.slug || book.id}`;
  bookHtml += `<div class="book" style="border-color:${wouldPark ? '#e8b07a' : '#7ae87a'}">
    <h2><a href="${url}" target="_blank">${esc(book.title)}</a> ${wouldPark ? '<span class="park">WOULD PARK</span>' : ''}</h2>
    <div class="meta">${esc(book.image_source?.provider || '?')} · ${total}p · ${esc(contentClass)} (imgFrac ${imgFrac.toFixed(2)}) · median ${median} MAD ${mad} · ${confidentPositions.length}/${landscape} conf${snapped ? ` · ${snapped} snapped` : ''}${scattered ? ' · SCATTERED' : ''}</div>
    <div class="samples">${samplesHtml}</div>
  </div>`;
  console.error(`done ${id}: median ${median} MAD ${mad} ${confidentPositions.length}/${landscape} conf${wouldPark ? ' (PARK)' : ''}`);
}

const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Split Audit — ${GEMINI_MODEL}</title><style>
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
<h1>Split Audit — gutter model: ${GEMINI_MODEL} (${IDS.length} books, ${parkCount} would park)</h1>
<p style="font-size:13px;color:#aaa">Each tile is a <b>zoom on the gutter region</b> with the proposed cut line burned in. Check: does the line sit in the binding, or slice through text? Color = which detector chose the cut.</p>
<div class="legend">
<span><span class="dot" style="background:#7ae87a"></span>pixel + gemini agree</span>
<span><span class="dot" style="background:#9ae87a"></span>pixel only</span>
<span><span class="dot" style="background:#7a9ae8"></span>gemini only</span>
<span><span class="dot" style="background:#e87a7a"></span>disagree / center — uncertain</span>
<span><span class="dot" style="background:#e8b07a"></span>kept whole — uncertain</span>
<span><span class="dot" style="background:#7a7ae8"></span>portrait (no cut)</span>
</div>
${bookHtml}
</body></html>`;

writeFileSync(OUT, html);
console.error(`\nWrote ${OUT} (${IDS.length} books, ${parkCount} would park)`);
await client.close();
