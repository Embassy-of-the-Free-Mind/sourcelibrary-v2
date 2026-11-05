#!/usr/bin/env node
// #6740 read-surface, Amendment 6.8: the target population. The panel (DTA / CAMENA books with a typed reference) is
// tabulated against the first-read lane's frame (the pages the lane will read), and the panel's books are given
// post-stratification weights to the frame's century × face mix.
//
// PRIOR ART: scripts/eval/route-judge-6740/judge.mjs drawBlank (the first-read frame, cli-ocr-lane.mjs FIRST_READ_BOOKS +
//   firstReadSkip + spreadReason; used here through the same lane exports, with its interior rule); panel.mjs (this
//   directory: the panel's century quotas). Neither tabulates a panel against its frame or weights it.
//
//   node --env-file=… frame.mjs sample --work=DIR [--n=60]   DIR/frame/sample-<lang>.json + contact sheets for faces
//   (by eye: DIR/frame/faces-<lang>.jsonl, {item, face: fraktur|antiqua|mixed|none})
//   node frame.mjs table --work=DIR                           DIR/frame/table.json (+ weights)
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import sharp from 'sharp';

const arg = (n, d) => process.argv.find((a) => a.startsWith(`--${n}=`))?.split('=').slice(1).join('=') ?? d;
const STAGE = process.argv[2];
const WORK = path.resolve(arg('work', '.'));
const FR = path.join(WORK, 'frame');
const h = (s) => crypto.createHash('sha256').update(String(s)).digest('hex');
const jsonl = (f) => (fs.existsSync(f) ? fs.readFileSync(f, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)) : []);
const SEED = 'rs6740-frame';
const LANGS = { de: 'deu', la: 'lat', ...(process.argv.includes('--en') ? { en: 'eng' } : {}) };
export const centuryOf = (pub) => { const m = String(pub ?? '').match(/1[4-9]\d\d/); return m ? `${m[0].slice(0, 2)}00s` : 'undated'; };
const interior = (n, count) => !count || (n > Math.ceil(count * 0.15) && n <= Math.floor(count * 0.95));

async function sample() {
  const { MongoClient } = await import('mongodb');
  const lane = await import('../../batch/cli-ocr-lane.mjs');
  const { getPageSource } = await import('../../lib/page-image-url.mjs');
  const N = Number(arg('n', 60));
  const c = new MongoClient(process.env.MONGODB_URI); await c.connect();
  const db = c.db('bookstore');
  fs.mkdirSync(FR, { recursive: true });
  const ONLY = arg('only') ? arg('only').split(',') : null;
  for (const [lang, code] of Object.entries(LANGS).filter(([l]) => !ONLY || ONLY.includes(l))) {
    const books = (await db.collection('books').find(lane.FIRST_READ_BOOKS, { projection: { id: 1, title: 1, language: 1, published: 1, visible: 1, pages_count: 1, pages_ocr: 1, processing_priority: 1, image_source: 1, needs_splitting: 1, split_completed: 1, pipeline_auto: 1 } }).toArray())
      .filter((b) => !lane.firstReadSkip(b, { languages: [code] }));
    // The frame's century mix is the whole frame's (books, and pages unread, from pages_count − pages_ocr).
    const frameCent = {};
    for (const b of books) { const k = centuryOf(b.published); frameCent[k] ||= { books: 0, pages: 0 }; frameCent[k].books++; frameCent[k].pages += Math.max(0, (b.pages_count || 0) - (b.pages_ocr || 0)); }
    const order = [...books].sort((a, b) => h(`${SEED}-${lang}${a.id}`).localeCompare(h(`${SEED}-${lang}${b.id}`)));
    const rows = [];
    for (const b of order) {
      if (rows.length >= N) break;
      const unread = await db.collection('pages').find({ book_id: b.id, ...lane.UNREAD }, { projection: { _id: 0, id: 1, book_id: 1, page_number: 1, archived_photo: 1, cropped_photo: 1, split_from_spread: 1, crop: 1, photo: 1, enhanced_photo: 1, photo_original: 1 } }).sort({ page_number: 1 }).toArray();
      if (lane.spreadReason(b, unread)) continue;
      const inner = unread.filter((p) => interior(p.page_number, b.pages_count));
      if (!inner.length) continue;
      const p = inner.sort((x, y) => h(`${SEED}${x.id}`).localeCompare(h(`${SEED}${y.id}`)))[0];
      const src = getPageSource(p);
      let meta = null;
      try { const r = await fetch(src); if (r.ok) { const buf = Buffer.from(await r.arrayBuffer()); const m = await sharp(buf).metadata(); meta = { w: m.width, h: m.height }; fs.mkdirSync(path.join(FR, 'img'), { recursive: true }); fs.writeFileSync(path.join(FR, 'img', `${lang}-${String(rows.length + 1).padStart(2, '0')}.jpg`), buf); } } catch { /* unreachable image: recorded as null */ }
      rows.push({ item: `${lang}-${String(rows.length + 1).padStart(2, '0')}`, book_id: b.id, page_id: p.id, page_number: p.page_number, title: b.title, published: b.published ?? null, century: centuryOf(b.published), provider: b.image_source?.provider ?? null, image_url: src, long_edge: meta ? Math.max(meta.w, meta.h) : null });
      await new Promise((s) => setTimeout(s, 200));
    }
    fs.writeFileSync(path.join(FR, `sample-${lang}.json`), JSON.stringify({ drawn_at: new Date().toISOString(), seed: SEED, frame: { books: books.length, century: frameCent }, rows }, null, 1));
    // Contact sheets for the by-eye face label: the middle of each page, 12 to a sheet.
    for (let s = 0; s * 12 < rows.length; s++) {
      const tiles = [];
      for (const [k, r] of rows.slice(s * 12, s * 12 + 12).entries()) {
        const f = path.join(FR, 'img', `${r.item}.jpg`);
        if (!fs.existsSync(f)) continue;
        const im = sharp(fs.readFileSync(f)); const m = await im.metadata();
        const cw = Math.round(m.width * 0.5), ch = Math.round(m.height * 0.22);
        const tile = await sharp(fs.readFileSync(f)).extract({ left: Math.round(m.width * 0.25), top: Math.round(m.height * 0.4), width: cw, height: ch }).resize(560, 260, { fit: 'contain', background: '#fff' }).toBuffer();
        const label = Buffer.from(`<svg width='560' height='26'><rect width='560' height='26' fill='#fff'/><text x='6' y='19' font-size='18' font-family='DejaVu Sans'>${r.item}</text></svg>`);
        tiles.push({ input: tile, left: (k % 3) * 570, top: Math.floor(k / 3) * 300 + 28 }, { input: label, left: (k % 3) * 570, top: Math.floor(k / 3) * 300 });
      }
      await sharp({ create: { width: 3 * 570, height: 4 * 300 + 30, channels: 3, background: '#ffffff' } }).composite(tiles).jpeg({ quality: 80 }).toFile(path.join(FR, `sheet-${lang}-${s + 1}.jpg`));
    }
    console.log(`${lang}: frame ${books.length} books; sampled ${rows.length}; sheets in ${FR}`);
  }
  await c.close();
}

// Post-stratification cells: century × face; a panel cell with no book merges into the nearest century of that face.
const ORDER = ['before 1700', '1700s', '1800 on'];
export const eraOf = (c) => (['1400s', '1500s', '1600s'].includes(c) ? 'before 1700' : c === '1700s' ? '1700s' : ['1800s', '1900s'].includes(c) ? '1800 on' : null);
const FROZEN = (() => { try { return JSON.parse(fs.readFileSync(path.resolve(arg('frozen', 'scripts/eval/read-surface-6740/results/exclusions-frozen.json')), 'utf8')); } catch { return null; } })();
export function weights(panelBooks, frameShares) {
  // panelBooks: [{book_id, cell}], frameShares: {cell: share}; returns {book_id: weight} (mean 1) and the merge log.
  const have = new Set(panelBooks.map((b) => b.cell));
  const merged = {}, log = [];
  for (const [cell, share] of Object.entries(frameShares)) {
    let to = cell;
    if (!have.has(cell)) {
      const [cent, face] = cell.split('|');
      const i = ORDER.indexOf(cent);
      const cands = [...have].filter((c) => c.endsWith(`|${face}`)).sort((a, b) => Math.abs(ORDER.indexOf(a.split('|')[0]) - i) - Math.abs(ORDER.indexOf(b.split('|')[0]) - i));
      to = cands[0] ?? [...have].sort((a, b) => Math.abs(ORDER.indexOf(a.split('|')[0]) - i) - Math.abs(ORDER.indexOf(b.split('|')[0]) - i))[0];
      log.push(`${cell} (${(100 * share).toFixed(0)} % of the frame) has no panel book: merged into ${to}`);
    }
    merged[to] = (merged[to] || 0) + share;
  }
  const n = panelBooks.length, count = {};
  for (const b of panelBooks) count[b.cell] = (count[b.cell] || 0) + 1;
  const w = Object.fromEntries(panelBooks.map((b) => [b.book_id, ((merged[b.cell] || 0) * n) / count[b.cell]]));
  return { w, log, cells: Object.fromEntries(Object.keys(count).map((c) => [c, { panel: count[c] / n, frame: merged[c] || 0, weight: ((merged[c] || 0) * n) / count[c] }])) };
}

function table() {
  const panel = JSON.parse(fs.readFileSync(path.join(WORK, 'panel.json'), 'utf8'));
  const out = { built_at: new Date().toISOString(), langs: {} };
  for (const lang of Object.keys(LANGS).filter((l) => fs.existsSync(path.join(FR, `sample-${l}.json`)))) {
    const S = JSON.parse(fs.readFileSync(path.join(FR, `sample-${lang}.json`), 'utf8'));
    const faces = new Map(jsonl(path.join(FR, `faces-${lang}.jsonl`)).map((r) => [r.item, r.face]));
    const eye = new Map(jsonl(path.join(WORK, 'eye', `verdicts-${lang}.jsonl`)).map((r) => [r.slug, r.face]));
    const T = panel.langs[lang].targets;
    // Panel long edge: the served native size recorded by a fitted read of the target (B05 / B10 metas).
    const native = new Map();
    for (const run of ['B05', 'B10', 'B09']) {
      const d = path.join(WORK, 'runs', lang, run);
      for (const t of T) { const f = path.join(d, `${t.page_id}.meta.json`); if (!native.has(t.page_id) && fs.existsSync(f)) { const m = JSON.parse(fs.readFileSync(f, 'utf8')); if (m.image_fit?.native) native.set(t.page_id, Math.max(m.image_fit.native.w, m.image_fit.native.h)); } }
    }
    const pRows = T.map((t) => ({ book_id: t.book_id, century: t.period ?? centuryOf(t.published), face: eye.get(t.slug) ?? null, long_edge: native.get(t.page_id) ?? null, letters: t.ref_letters ?? null }));
    const qRows = S.rows.map((r) => ({ ...r, face: faces.get(r.item) ?? null }));
    const dist = (rows, k) => { const m = {}; for (const r of rows) m[r[k] ?? 'unknown'] = (m[r[k] ?? 'unknown'] || 0) + 1; return Object.fromEntries(Object.entries(m).map(([a, b]) => [a, { n: b, share: b / rows.length }])); };
    const quant = (xs) => { const s = xs.filter((x) => x != null).sort((a, b) => a - b); const q = (p) => s[Math.min(s.length - 1, Math.floor(p * (s.length - 1)))]; return s.length ? { n: s.length, p10: q(0.1), median: q(0.5), p90: q(0.9) } : null; };
    // Frame century shares from the whole frame (pages unread), face shares from the by-eye sample.
    const fc = S.frame.century, totalPages = Object.values(fc).reduce((a, x) => a + x.pages, 0);
    const faceShare = dist(qRows.filter((r) => r.face && r.face !== 'none'), 'face');
    // Cells (Amendment 6.8(b), fixed 10:15Z): era × face. Era shares: the whole frame's unread pages; the face mix within
    // an era: the by-eye sample's (the whole sample's where an era has under 5 faced pages). Latin: one face (roman).
    const faced = qRows.filter((r) => r.face && r.face !== 'none');
    const faceKey = (f) => (lang === 'la' ? 'roman' : f === 'mixed' ? 'fraktur' : f);
    const eraPages = {}; for (const [k, v] of Object.entries(fc)) { const e = eraOf(k); if (e) eraPages[e] = (eraPages[e] || 0) + v.pages; }
    const eraTotal = Object.values(eraPages).reduce((a, b) => a + b, 0);
    const faceMix = (rows) => { const m = {}; for (const r of rows) m[faceKey(r.face)] = (m[faceKey(r.face)] || 0) + 1 / rows.length; return m; };
    const overall = lang === 'la' ? { roman: 1 } : faceMix(faced);
    const joint = {};
    for (const [e, pg] of Object.entries(eraPages)) {
      const rows = faced.filter((r) => eraOf(r.century) === e);
      const mix = lang === 'la' ? { roman: 1 } : rows.length >= 5 ? faceMix(rows) : overall;
      for (const [f, sh] of Object.entries(mix)) joint[`${e}|${f}`] = (joint[`${e}|${f}`] || 0) + (pg / eraTotal) * sh;
    }
    const frozen = new Set((FROZEN?.[lang] || []).map((e) => e.slug));
    const kept = T.filter((t) => !frozen.has(t.slug));
    const pb = pRows.filter((r, i) => !frozen.has(T[i].slug) && eraOf(r.century) && (lang === 'la' || r.face)).map((r) => ({ book_id: r.book_id, cell: `${eraOf(r.century)}|${faceKey(r.face)}` }));
    const undated = pRows.filter((r, i) => !frozen.has(T[i].slug) && !eraOf(r.century)).map((r) => r.book_id);
    out.langs[lang] = {
      frame_books: S.frame.books, sample_n: qRows.length, sample_seed: S.seed,
      century: { panel: dist(pRows, 'century'), frame_pages: Object.fromEntries(Object.entries(fc).map(([k, v]) => [k, { pages: v.pages, books: v.books, share: v.pages / totalPages }])), sample: dist(qRows, 'century') },
      face: { panel: dist(pRows, 'face'), sample: faceShare },
      long_edge: { panel: quant(pRows.map((r) => r.long_edge)), sample: quant(qRows.map((r) => r.long_edge)) },
      letters: { panel: quant(pRows.map((r) => r.letters)), queue: null },
      weights: (() => { const W = weights(pb, joint); for (const b of undated) W.w[b] = 1; W.undated = undated; W.books = kept.length; return W; })(),
      frame_cells: joint,
    };
  }
  fs.writeFileSync(path.join(FR, 'table.json'), JSON.stringify(out, null, 1));
  fs.writeFileSync(path.join(FR, 'weights.json'), JSON.stringify(Object.fromEntries(Object.entries(out.langs).map(([l, v]) => [l, v.weights.w])), null, 1));
  console.log(JSON.stringify(Object.fromEntries(Object.entries(out.langs).map(([l, v]) => [l, { century: v.century, face: v.face, long_edge: v.long_edge, letters: v.letters, cells: v.weights.cells, log: v.weights.log }])), null, 1));
}

if (STAGE === 'sample') await sample();
else if (STAGE === 'table') table();
else if (STAGE) { console.error('usage: frame.mjs sample|table --work=DIR'); process.exit(2); }
