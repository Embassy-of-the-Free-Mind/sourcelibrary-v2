#!/usr/bin/env node
/**
 * PRIOR ART: scripts/eval/paddle-correct-6561/draw.mjs (set B: Paddle pages with a trusted own Kanripo leaf; its
 * 3.8 Flash-low second read is reused here as set F) and scripts/eval/zh-skqs-5568-kanripo.mjs (leaf text by <pb>).
 * Neither re-reads a page with Paddle under other settings.
 *
 * Draws the pages for the Paddle self-agreement test (README.md, PREREG.md). Reads Mongo and GitHub only; writes
 * files in --out only.
 *   set R  150 random pages of zh-shi-ji-8053 (one per book, seed 6871, interior, >= 40 Han), trusted leaf (dice >= 0.6)
 *   set L   50 more pages the same way, but with the lane's dice in [0.6, 0.9): enough wrong pages to rank
 *   set F  the 60 #6561 set-B pages, which carry a 3.8 Flash-low read of the same image
 *
 *   node --env-file=/root/sourcelibrary/.env.production.local draw.mjs --lane /root/jobs/zh-shi-ji-8053 --out DIR
 * Writes DIR/draw.json (one row per page, with the folded Kanripo leaf) and DIR/manifest.tsv (bid, uid, image URL:
 * the runner keys its output by the 2nd column).
 */
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { withMongo } from '../../lib/mongo.mjs';
import { makeRng } from '../lib/paired-stats.mjs';
import { pbPages } from '../zh-skqs-5568-kanripo.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const arg = (k, d) => { const i = process.argv.indexOf(`--${k}`); return i > 0 ? process.argv[i + 1] : d; };
const LANE = arg('lane', '/root/jobs/zh-shi-ji-8053'), OUT = arg('out', path.join(HERE, 'w'));
const N_R = 150, N_L = 50, SEED = 6871;
fs.mkdirSync(OUT, { recursive: true });

// candidate pages: one per book, from what the lane applied (applied.jsonl rows carry han and pid)
const byBook = new Map();
for (const l of fs.readFileSync(path.join(LANE, 'applied.jsonl'), 'utf8').split('\n')) {
  if (!l) continue; const r = JSON.parse(l); if (r.han < 40) continue;
  (byBook.get(r.bid) || byBook.set(r.bid, []).get(r.bid)).push(r);
}
const rnd = makeRng(SEED);
const books = [...byBook.keys()].sort();
for (let i = books.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [books[i], books[j]] = [books[j], books[i]]; }

const leafCache = new Map();
async function leaf(pb) {
  if (!pb) return null;
  const m = pb.match(/^(KR\w+?)_WYG_(\d{3})-/); if (!m) return null;
  const key = `${m[1]}/${m[2]}`;
  if (!leafCache.has(key)) leafCache.set(key, await pbPages(m[1], 'WYG', [+m[2]]).catch(() => []));
  return leafCache.get(key).find((p) => p.pb === pb)?.text || null;
}

const rows = [];
await withMongo(async (db) => {
  let r = 0, lo = 0;
  for (let k = 0; k < books.length && (r < N_R || lo < N_L); k += 40) {
    const batch = books.slice(k, k + 40);
    const pick = batch.map((b) => { const ps = byBook.get(b); const n = ps.length; const inner = ps.filter((p) => p.pn > n * 0.15 && p.pn <= n * 0.95); const c = inner.length ? inner : ps; return c[Math.floor(rnd() * c.length)]; });
    const docs = await db.collection('pages').find({ id: { $in: pick.map((p) => p.pid) } },
      { projection: { id: 1, book_id: 1, page_number: 1, 'ocr.qa_screen': 1, 'ocr.source': 1 } }).toArray();
    const plan = new Map();
    for (const p of pick) {
      const f = path.join(LANE, 'plan', `${p.bid}.json`);
      if (fs.existsSync(f)) for (const x of JSON.parse(fs.readFileSync(f, 'utf8')).pages) if (x.pid === p.pid) plan.set(p.pid, x.src);
    }
    for (const d of docs) {
      const q = d.ocr?.qa_screen;
      if (d.ocr?.source !== 'paddle' || q?.status !== 'screened' || !(q.dice >= 0.6) || !plan.get(d.id)) continue;
      const stratum = r < N_R ? 'R' : (q.dice < 0.9 && lo < N_L ? 'L' : null);
      if (!stratum) continue;
      const text = await leaf(q.pb); if (!text || text.length < 40) continue;
      rows.push({ uid: `${stratum}${String(stratum === 'R' ? ++r : ++lo).padStart(3, '0')}`, stratum, pid: d.id, bid: d.book_id, pn: d.page_number, src: plan.get(d.id), lane_dice: q.dice, pb: q.pb, leaf: text });
    }
    process.stderr.write(`\rR ${r}/${N_R} L ${lo}/${N_L} (books tried ${Math.min(k + 40, books.length)})`);
  }
});

// set F: the #6561 set-B pages and their 3.8 Flash-low reads
const D6561 = path.join(HERE, '../paddle-correct-6561/results');
const fl = new Map(zlib.gunzipSync(fs.readFileSync(path.join(D6561, 'out-flashlow-second.jsonl.gz'))).toString().split('\n').filter(Boolean).map((l) => JSON.parse(l)).map((x) => [x.uid, x.text]));
for (const x of JSON.parse(fs.readFileSync(path.join(D6561, 'draw.json'), 'utf8')).filter((x) => x.stratum !== 'A')) {
  const pb = x.kanripo_pb || x.qa_pb; const text = await leaf(pb); if (!text) continue;
  rows.push({ uid: `F-${x.uid}`, stratum: 'F', pid: x.pid, bid: x.bid, pn: x.pn, src: x.image_url, lane_dice: x.qa_dice ?? null, pb, leaf: text, flashlow: fl.get(x.uid) ?? null });
}
fs.writeFileSync(path.join(OUT, 'draw.json'), JSON.stringify(rows, null, 1));
fs.writeFileSync(path.join(OUT, 'manifest.tsv'), rows.map((x) => `${x.bid}\t${x.uid}\t${x.src}`).join('\n') + '\n');
console.log(`\n${rows.length} pages: ${['R', 'L', 'F'].map((s) => `${s} ${rows.filter((x) => x.stratum === s).length}`).join(', ')} → ${OUT}`);
