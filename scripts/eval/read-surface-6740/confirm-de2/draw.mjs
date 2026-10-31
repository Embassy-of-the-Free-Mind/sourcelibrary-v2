#!/usr/bin/env node
// #6740 read-surface, German confirmation 2 (confirm-de2/RULE.md): the frame census and the stratified draw.
//
// PRIOR ART: scripts/eval/route-judge-6740/judge.mjs drawBlank (the first-read frame, one interior unread page a book,
//   the block of consecutive unread pages; used for confirmation 1 with an era quota). This draw adds hidden books,
//   typeface strata labelled by eye, a per-library cap and a uniform body page, which drawBlank does not do. The sample
//   it writes has drawBlank's shape, so judge.mjs correct and confirm.mjs read it unchanged.
//
//   node --env-file=… draw.mjs census --out=DIR                       DIR/frame.json (books by era × holding library)
//   node --env-file=… draw.mjs candidates --out=DIR --era=E --from=N --n=24   contact sheets for the by-eye face label
//   (by eye: DIR/faces.jsonl {book_id, page_id, face: fraktur|antiqua|none, note})
//   node --env-file=… draw.mjs sample --out=DIR --quota=FILE          DIR/sample.json from the labelled candidates
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import sharp from 'sharp';
import { MongoClient } from 'mongodb';

const arg = (n, d) => process.argv.find((a) => a.startsWith(`--${n}=`))?.split('=').slice(1).join('=') ?? d;
const STAGE = process.argv[2];
const OUT = path.resolve(arg('out', '.'));
const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../../../..');
const h = (s) => crypto.createHash('sha256').update(String(s)).digest('hex');
const SALT = 'rs6740-c2-6741';
const jsonl = (f) => (fs.existsSync(f) ? fs.readFileSync(f, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)) : []);
export const eraOf = (pub) => { const m = String(pub ?? '').match(/1[4-9]\d\d/); const y = m ? Number(m[0]) : null; return y === null ? null : y < 1600 ? 'pre-1600' : y < 1700 ? '1600s' : y < 1800 ? '1700s' : '1800+'; };
const libOf = (b) => b.image_source?.contributing_library || b.image_source?.provider_name || b.image_source?.provider || 'unknown';
const EXCLUDE_FROM = ['scripts/eval/route-judge-6740/results/first-read-7701-2026-10-29/sample.json', 'scripts/eval/route-judge-6740/results/cheap-routes-7701-2026-10-29/sample.json', 'scripts/eval/route-judge-6740/results/german-cheaper-7701-2026-10-30/sample.json', 'scripts/eval/read-surface-6740/confirm/sample.json', 'scripts/eval/read-surface-6740/confirm-de/sample.json'];

async function frame(db) {
  const lane = await import('../../../batch/cli-ocr-lane.mjs');
  const q = { ...lane.FIRST_READ_BOOKS }; delete q.visible;   // hidden books of the same holds are in the frame (RULE.md)
  const bs = await db.collection('books').find(q, { projection: { id: 1, title: 1, visible: 1, language: 1, published: 1, pages_count: 1, pages_ocr: 1, image_source: 1, needs_splitting: 1, split_completed: 1, pipeline_auto: 1 } }).toArray();
  return bs.filter((b) => !lane.firstReadSkip({ ...b, visible: true }, { languages: ['deu'] }));
}

async function census() {
  const c = new MongoClient(process.env.MONGODB_URI); await c.connect();
  const F = await frame(c.db('bookstore'));
  await c.close();
  const by = {}, lib = {}, prov = {};
  for (const b of F) {
    const e = eraOf(b.published) ?? 'undated';
    by[e] = by[e] || { books: 0, pages_unread: 0, visible: 0, hidden: 0 };
    by[e].books++; by[e].pages_unread += Math.max(0, (b.pages_count || 0) - (b.pages_ocr || 0)); by[e][b.visible ? 'visible' : 'hidden']++;
    const L = libOf(b); (lib[e] ||= {})[L] = (lib[e][L] || 0) + 1;
    const P = b.image_source?.provider || 'unknown'; prov[P] = (prov[P] || 0) + 1;
  }
  const out = { built_at: new Date().toISOString(), frame: 'the German first-read lane frame (cli-ocr-lane.mjs FIRST_READ_BOOKS + firstReadSkip languages=deu), hidden books of the same holds included', books: F.length,
    visible: F.filter((b) => b.visible).length, hidden: F.filter((b) => !b.visible).length, by_era: by, by_era_library: lib, by_provider: prov };
  fs.mkdirSync(OUT, { recursive: true });
  fs.writeFileSync(path.join(OUT, 'frame.json'), JSON.stringify(out, null, 1));
  console.log(JSON.stringify({ books: out.books, visible: out.visible, hidden: out.hidden, by_era: by, by_provider: prov }, null, 1));
}

// Candidates for one era, in seeded order: each book's body page drawn uniformly (first 10 % and last 5 % skipped),
// unread, with a contact sheet tile for the by-eye face label. Books of the excluded draws are left out.
async function candidates() {
  const lane = await import('../../../batch/cli-ocr-lane.mjs');
  const { getPageSource } = await import('../../../lib/page-image-url.mjs');
  const ERA = arg('era'), FROM = Number(arg('from', 0)), N = Number(arg('n', 24));
  const ex = new Set(EXCLUDE_FROM.flatMap((f) => Object.values(JSON.parse(fs.readFileSync(path.join(ROOT, f), 'utf8')).cells).flatMap((c) => c.pages.map((p) => p.book_id))));
  const c = new MongoClient(process.env.MONGODB_URI); await c.connect();
  const db = c.db('bookstore');
  const F = (await frame(db)).filter((b) => eraOf(b.published) === ERA && !ex.has(b.id)).sort((a, b) => h(SALT + a.id).localeCompare(h(SALT + b.id)));
  const outF = path.join(OUT, 'candidates.jsonl');
  const have = new Set(jsonl(outF).map((r) => r.book_id));
  const tiles = [];
  let k = FROM;
  for (const b of F.slice(FROM, FROM + N)) {
    k++;
    if (have.has(b.id)) continue;
    const unread = await db.collection('pages').find({ book_id: b.id, ...lane.UNREAD }, { projection: { _id: 0, id: 1, book_id: 1, page_number: 1, archived_photo: 1, cropped_photo: 1, split_from_spread: 1, crop: 1, photo: 1, enhanced_photo: 1, photo_original: 1 } }).sort({ page_number: 1 }).toArray();
    const n = b.pages_count || unread.length;
    const body = unread.filter((p) => p.page_number > Math.floor(n * 0.10) && p.page_number <= Math.floor(n * 0.95));
    const row = { era: ERA, rank: k, book_id: b.id, title: b.title, published: b.published ?? null, visible: !!b.visible, library: libOf(b), provider: b.image_source?.provider ?? null, spread: lane.spreadReason(b, unread) || null };
    if (!body.length || row.spread) { fs.appendFileSync(outF, JSON.stringify({ ...row, skip: row.spread ? `spread: ${row.spread}` : 'no unread body page' }) + '\n'); continue; }
    const p = body[parseInt(h(`${SALT}-page-${b.id}`).slice(0, 8), 16) % body.length];
    // The block: consecutive unread pages around p, up to 8, p at a seeded position (drawBlank's rule).
    const byNum = new Map(unread.map((x) => [x.page_number, x]));
    const pos = parseInt(h(`pos-${p.id}`).slice(0, 8), 16) % 8;
    let start = p.page_number - pos;
    const runTo = (a, z) => { for (let i = a; i <= z; i++) if (!byNum.has(i)) return false; return true; };
    while (start < p.page_number && !runTo(start, p.page_number)) start++;
    let end = p.page_number; while (end + 1 - start < 8 && byNum.has(end + 1)) end++;
    const block = Array.from({ length: end - start + 1 }, (_, i) => byNum.get(start + i).id);
    const src = getPageSource(p);
    let fetched = null;
    try { const r = await fetch(src); if (r.ok) { const buf = Buffer.from(await r.arrayBuffer()); fetched = buf; } else row.fetch_status = r.status; } catch (e) { row.fetch_status = String(e.message).slice(0, 60); }
    Object.assign(row, { page_id: p.id, page_number: p.page_number, pages_count: n, block, image_url: src, fetchable: !!fetched });
    fs.appendFileSync(outF, JSON.stringify(row) + '\n');
    if (fetched) {
      const m = await sharp(fetched).metadata();
      const tile = await sharp(fetched).resize(420, 600, { fit: 'contain', background: '#fff' }).toBuffer();
      tiles.push({ id: `${ERA}-${String(k).padStart(3, '0')}`, tile, row });
    }
    await new Promise((s) => setTimeout(s, 150));
  }
  await c.close();
  // Whole page at small size (face, and title page / plate / blank visible at once), 8 to a sheet.
  for (let s = 0; s * 8 < tiles.length; s++) {
    const comp = [];
    tiles.slice(s * 8, s * 8 + 8).forEach((t, i) => {
      comp.push({ input: t.tile, left: (i % 4) * 430, top: Math.floor(i / 4) * 640 + 30 });
      comp.push({ input: Buffer.from(`<svg width="420" height="28"><rect width="420" height="28" fill="#fff"/><text x="4" y="20" font-size="18" font-family="DejaVu Sans">${t.id} ${t.row.book_id.slice(-6)}</text></svg>`), left: (i % 4) * 430, top: Math.floor(i / 4) * 640 });
    });
    await sharp({ create: { width: 4 * 430, height: 2 * 640 + 30, channels: 3, background: '#ffffff' } }).composite(comp).jpeg({ quality: 75 }).toFile(path.join(OUT, `sheet-${ERA}-${FROM}-${s + 1}.jpg`));
  }
  console.log(`${ERA}: ${F.length} books in the era after exclusions; walked ${FROM}..${FROM + N}; ${tiles.length} tiles`);
}

// The sample: per (era, face) cell, the labelled candidates in rank order, at most 2 a holding library, up to the quota.
function sample() {
  const quota = JSON.parse(fs.readFileSync(arg('quota'), 'utf8')).cells;
  const cand = new Map(jsonl(path.join(OUT, 'candidates.jsonl')).filter((r) => r.page_id).map((r) => [r.book_id, r]));
  const faces = jsonl(path.join(OUT, 'faces.jsonl'));
  const pages = [], filled = {};
  const ordered = faces.map((f) => ({ ...cand.get(f.book_id), face: f.face, face_note: f.note ?? null })).filter((r) => r.page_id && ['fraktur', 'antiqua'].includes(r.face)).sort((a, b) => a.era.localeCompare(b.era) || a.rank - b.rank);
  for (const r of ordered) {
    const cell = `${r.era}|${r.face}`, q = quota[cell] ?? 0;
    filled[cell] ||= { n: 0, libs: {} };
    if (filled[cell].n >= q || (filled[cell].libs[r.library] || 0) >= 2) continue;
    filled[cell].n++; filled[cell].libs[r.library] = (filled[cell].libs[r.library] || 0) + 1;
    pages.push({ page_id: r.page_id, book_id: r.book_id, page_number: r.page_number, draft_model: null, draft_sha: null, block: r.block, book_language: 'deu', provider: r.provider, library: r.library, era: r.era, script_face: r.face, visible: r.visible, published: r.published });
  }
  const s = { drawn_at: new Date().toISOString(), seed: SALT, n: pages.length, cells: { 'de-surface2': { task: 'ocr', lang: 'German', paired: true, kind: 'router-test', blank: true, pages, frame: { rule: 'confirm-de2/RULE.md: era × face strata, proportional with a floor of 4, at most 2 books a holding library within a cell, uniform body page', quota, filled: Object.fromEntries(Object.entries(filled).map(([k, v]) => [k, v.n])) } } } };
  fs.writeFileSync(path.join(OUT, 'sample.json'), JSON.stringify(s, null, 1));
  console.log(`sample: ${pages.length} pages; filled ${JSON.stringify(s.cells['de-surface2'].frame.filled)}; quota ${JSON.stringify(quota)}`);
}

if (STAGE === 'census') await census();
else if (STAGE === 'candidates') await candidates();
else if (STAGE === 'sample') sample();
else { console.error('usage: draw.mjs census|candidates|sample --out=DIR'); process.exit(2); }
