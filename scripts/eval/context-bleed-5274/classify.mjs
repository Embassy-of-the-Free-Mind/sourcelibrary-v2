#!/usr/bin/env node
// PRIOR ART: scripts/eval/context-bleed-5274/scan.mjs (writes the rows this reads); the 2026-11-04 #5274 spot check's
// $0 screen (n-1 / n+1 / n±4 shares on the 518, an inline query, not kept as a file). None splits the classes the brief
// asks for, cuts score bands, or subtracts the #5021 ledger, so this does.
/**
 * Context-bleed classes and bands (#5274), from scan.mjs cands.jsonl. $0, no model, one Mongo read for the write
 * order (n-1's English time) of the pages it classes.
 *
 *   node --env-file=.env.production.local scripts/eval/context-bleed-5274/classify.mjs --scan=DIR --out=DIR
 *
 * Shares are the fraction of page n's English content words found in a neighbour's English. base = max(n-4, n+4),
 * the topical overlap two leaves of the same book have anyway. Class (first that holds):
 *   prev     s(-1) ≥ 0.5, s(-1) − base ≥ 0.2, s(-1) ≥ s(+1)          the leaf before's English
 *   next     s(+1) ≥ 0.5, s(+1) − base ≥ 0.2                         the leaf after's English
 *   pm2      max(s(-2), s(+2)) ≥ 0.5, it − base ≥ 0.2                two leaves away
 *   composed every share < 0.35 and the source nearly empty (src_w < 150): prose found on no neighbour
 *   padding  the rest: long English on a short source, no neighbour carries it (own leaf with apparatus/padding, or
 *            a dense script whose English is legitimately long)
 * Band, on the strength of the signal: A = (prev|next|pm2) with share ≥ 0.7 and src_w < 150; B = (prev|next|pm2) the
 * rest; C = composed; D = padding. The judge measures precision per band before any band is acted on.
 * Lane by write order (the cause test, write-order.mjs): `after-prev` = written 0–15 min after n-1's English (the
 * chained single-page lanes, n-1's English sent as context); `same-stamp` = within 2 s of n-1 (a Batch block);
 * `before-prev`; `apart` = more than 15 min after; `unknown`.
 */
import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';
import { MongoClient } from 'mongodb';

const arg = (n, d) => process.argv.find((a) => a.startsWith(`--${n}=`))?.split('=').slice(1).join('=') ?? d;
const SCAN = path.resolve(arg('scan'));
const OUT = path.resolve(arg('out'));
fs.mkdirSync(OUT, { recursive: true });

const v = (x) => (x == null ? 0 : x);
export function classify(r) {
  const s = r.share, base = Math.max(v(s['-4']), v(s['4']));
  const p1 = v(s['-1']), n1 = v(s['1']), m2 = Math.max(v(s['-2']), v(s['2']));
  let cls, top = 0;
  if (p1 >= 0.5 && p1 - base >= 0.2 && p1 >= n1) { cls = 'prev'; top = p1; }
  else if (n1 >= 0.5 && n1 - base >= 0.2) { cls = 'next'; top = n1; }
  else if (m2 >= 0.5 && m2 - base >= 0.2) { cls = 'pm2'; top = m2; }
  else if (Math.max(p1, n1, m2, base) < 0.35 && r.src_w < 150) cls = 'composed';
  else cls = 'padding';
  const band = ['prev', 'next', 'pm2'].includes(cls) ? (top >= 0.7 && r.src_w < 150 ? 'A' : 'B') : cls === 'composed' ? 'C' : 'D';
  return { cls, band, top: +top.toFixed(3), base: +base.toFixed(3) };
}

// the #5021 ledger: pages re-translated there are not counted again
const L5021 = '/data/scratch/sl/jobs/wrong-leaf-fix-5021/fix/ledger.jsonl';
const fixed5021 = new Set();
if (fs.existsSync(L5021)) for (const l of fs.readFileSync(L5021, 'utf8').split('\n')) { if (!l) continue; try { const o = JSON.parse(l); if (o.state === 'retranslated') fixed5021.add(o.page_id); } catch { /* a torn last line */ } }
const q5021 = new Set();
const Q5021 = '/data/scratch/sl/jobs/wrong-leaf-fix-5021/fix/queue.jsonl';
if (fs.existsSync(Q5021)) for (const l of fs.readFileSync(Q5021, 'utf8').split('\n')) { if (l) try { q5021.add(JSON.parse(l).page_id); } catch { /* */ } }

const rows = [];
const rl = readline.createInterface({ input: fs.createReadStream(path.join(SCAN, 'cands.jsonl')) });
for await (const l of rl) { if (!l) continue; const r = JSON.parse(l); rows.push({ ...r, ...classify(r), head: undefined, in5021: q5021.has(r.page_id), fixed5021: fixed5021.has(r.page_id) }); }

// write order for the neighbour classes only (n-1's English time, current or the revision that stood then)
const c = new MongoClient(process.env.MONGODB_URI, { readPreference: 'secondaryPreferred' });
await c.connect();
const db = c.db('bookstore');
const want = rows.filter((r) => r.band !== 'D');
const byBook = new Map();
for (const r of want) (byBook.get(r.book_id) ?? byBook.set(r.book_id, []).get(r.book_id)).push(r);
const titles = new Map();
let k = 0;
for (const [b, rs] of byBook) {
  const prevs = await db.collection('pages').find({ book_id: b, page_number: { $in: rs.map((r) => r.page - 1) } }, { projection: { _id: 0, id: 1, page_number: 1, 'translation.updated_at': 1 } }).toArray();
  const m = new Map(prevs.map((p) => [p.page_number, p]));
  for (const r of rs) {
    const p = m.get(r.page - 1);
    let t = p?.translation?.updated_at ? new Date(p.translation.updated_at) : null;
    const at = r.at ? new Date(r.at) : null;
    if (p && t && at && t > at) {
      const rev = await db.collection('page_revisions').find({ page_id: p.id, field: 'translation', original_date: { $lte: new Date(at.getTime() + 3600e3) } }).project({ original_date: 1 }).sort({ original_date: -1 }).limit(1).toArray();
      t = rev[0]?.original_date ? new Date(rev[0].original_date) : null;
    }
    const d = t && at ? (at - t) / 1000 : null;
    r.lane = d == null ? 'unknown' : Math.abs(d) <= 2 ? 'same-stamp' : d < 0 ? 'before-prev' : d <= 900 ? 'after-prev' : 'apart';
  }
  if (++k % 500 === 0) console.log(`write order: ${k}/${byBook.size} books`);
}
for (const b of await db.collection('books').find({ id: { $in: [...byBook.keys()] } }, { projection: { _id: 0, id: 1, title: 1 } }).toArray()) titles.set(b.id, b.title || '');
await c.close();

// book family: the title with volume/juan/part numbers taken off
const family = (t) => String(t || '').replace(/[\s,.:;·]*(卷|巻|第|vol\.?|volume|tome|tom\.?|t\.|band|bd\.?|part|pars|tomus|liber|book)\s*[\dIVXLCDMivxlcdm一二三四五六七八九十百千〇零上中下]+.*$/i, '').replace(/[\s\d]+$/, '').slice(0, 40) || '?';
for (const r of rows) { r.title = titles.get(r.book_id) ?? null; r.family = r.title ? family(r.title) : null; r.month = String(r.at || '').slice(0, 7); } // imprint-write-ok: in-memory report row, not a books write

const tab = (key, filter = () => true) => {
  const t = {};
  for (const r of rows) { if (!filter(r)) continue; const kk = typeof key === 'function' ? key(r) : r[key]; (t[kk] ??= { A: 0, B: 0, C: 0, D: 0 })[r.band]++; }
  return Object.fromEntries(Object.entries(t).sort((a, b) => (b[1].A + b[1].B + b[1].C) - (a[1].A + a[1].B + a[1].C)));
};
const live = (r) => !r.fixed5021 && !r.human;
const summary = {
  at: new Date().toISOString(), scanned_rows: rows.length,
  in_5021_queue: rows.filter((r) => r.in5021).length, fixed_in_5021: rows.filter((r) => r.fixed5021).length, human_edited: rows.filter((r) => r.human).length,
  by_class: tab('cls', live), by_band_state: tab((r) => r.state.split(':')[0], live),
  by_language: Object.fromEntries(Object.entries(tab((r) => (r.language || '?').slice(0, 24), live)).slice(0, 30)),
  by_model: tab((r) => r.model || '?', live), by_month: tab('month', live), by_lane: tab((r) => r.lane || '(D: not looked up)', live),
  by_family: Object.fromEntries(Object.entries(tab('family', (r) => live(r) && r.band !== 'D')).slice(0, 40)),
};
fs.writeFileSync(path.join(OUT, 'classified.jsonl'), rows.map((r) => JSON.stringify(r)).join('\n') + '\n');
fs.writeFileSync(path.join(OUT, 'summary.json'), JSON.stringify(summary, null, 1));
console.log(JSON.stringify({ by_class: summary.by_class, by_band_state: summary.by_band_state, by_model: summary.by_model, by_lane: summary.by_lane }, null, 1));
