#!/usr/bin/env node
// #6012 step 4, feasibility probe: can an EEBO-TCP English translation be placed against OUR pages at
// passage level without a model? Our page's stored English translation (modern English, by Gemini) is
// compared with each typed page of the 17th-century English by idf-weighted shared words, after a crude
// spelling fold (u/v, i/j, y/i, doubled letters, final e). A page is "placed" when its best typed page
// beats the runner-up by 1.5× and the placements rise with our page numbers.
// READ-ONLY on Mongo. $0. Reports only; writes <work>/eebo/passage-probe.json.
// PRIOR ART: scripts/eval/translation-vs-reference/ (#5695) aligns OUR translation to a published English
//   through a judge packet, per hand-picked page, with a model; no script places pages by word overlap
//   across four centuries of English spelling.
//   node --env-file=… scripts/eval/typed-refs-6012/translation-passage-probe.mjs --pairs=A01683:<book_id>,…
import fs from 'node:fs';
import zlib from 'node:zlib';
import { MongoClient } from 'mongodb';
import { stripMarkupTags } from '../../lib/strip-markup-tags.mjs';
import { argOf } from './lib.mjs';
const WORK = argOf('work', '/data/scratch/sl/typed-refs-6012');
const fold = (w) => w.toLowerCase().replace(/vv/g, 'w').replace(/v/g, 'u').replace(/j/g, 'i').replace(/y/g, 'i').replace(/(.)\1/g, '$1').replace(/e$/, '').replace(/[^a-z]/g, '');
const words = (t) => (String(t || '').match(/[A-Za-zſ]{5,}/g) || []).map((w) => fold(w.replace(/ſ/g, 's'))).filter((w) => w.length >= 4);
const manifest = new Map(fs.readFileSync(`${WORK}/eebo/manifest.jsonl`, 'utf8').split('\n').filter(Boolean).map((l) => { const m = JSON.parse(l); return [m.source_id, m]; }));
const client = new MongoClient(process.env.MONGODB_URI); await client.connect();
const pages = client.db('bookstore').collection('pages');
const out = [];
// --all: every work-level pair (matches and candidates) whose book has ≥ 40 stored translated pages.
let pairList = argOf('pairs', '').split(',').filter(Boolean);
if (process.argv.includes('--all')) pairList = [...new Set(fs.readFileSync(`${WORK}/eebo/translations.jsonl`, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)).filter((t) => t.book_id && (t.book?.pages_translated || 0) >= 40).map((t) => `${t.source_id}:${t.book_id}`))];
pairList.sort((a, b) => manifest.get(a.split(':')[0]).derived_shard.localeCompare(manifest.get(b.split(':')[0]).derived_shard));
const PASSAGE_VERSION = 'idf-words-v0';
const passages = fs.createWriteStream(`${WORK}/eebo/translation-passages.jsonl`);
let shardName = null, shardRows = null;
for (const pair of pairList) {
  const [tcp, bookId] = pair.split(':');
  const m = manifest.get(tcp);
  if (shardName !== m.derived_shard) { shardRows = new Map(zlib.gunzipSync(fs.readFileSync(`${WORK}/eebo/derived/${m.derived_shard}`)).toString('utf8').split('\n').filter(Boolean).map((l) => { const r = JSON.parse(l); return [r.source_id, r]; })); shardName = m.derived_shard; }
  const ref = shardRows.get(tcp);
  const keep = ref.pages.map((p, i) => ({ i, s: new Set(words(p.text)) })).filter((x) => x.s.size >= 30);
  const rp = keep.map((x) => x.s);
  const df = new Map(); for (const s of rp) for (const w of s) df.set(w, (df.get(w) || 0) + 1);
  const idf = (w) => Math.log(rp.length / (df.get(w) || rp.length));
  const ours = (await pages.find({ book_id: bookId, 'translation.data': { $exists: true } }, { projection: { page_number: 1, 'translation.data': 1 } }).hint({ book_id: 1, page_number: 1 }).toArray())
    .map((p) => ({ n: p.page_number, w: new Set(words(stripMarkupTags(p.translation?.data || ''))) })).filter((p) => p.w.size >= 40).sort((a, b) => a.n - b.n);
  const placed = [];
  for (const p of ours) {
    let best = -1, bs = 0, second = 0;
    rp.forEach((s, i) => { let sc = 0; for (const w of p.w) if (s.has(w)) sc += idf(w); if (sc > bs) { second = bs; bs = sc; best = i; } else if (sc > second) second = sc; });
    if (best >= 0 && bs > 1.5 * second && bs > 8) placed.push({ n: p.n, i: best, score: Math.round(bs * 10) / 10, margin: Math.round((bs / Math.max(second, 0.01)) * 100) / 100 });
  }
  let asc = 0; for (let k = 1; k < placed.length; k++) if (placed[k].i >= placed[k - 1].i) asc++;
  const row = { tcp, book_id: bookId, tcp_title: String(m.title).slice(0, 80), our_translated_pages: ours.length, typed_pages: rp.length, placed: placed.length, placed_share: ours.length ? Math.round((placed.length / ours.length) * 100) / 100 : 0, rising: placed.length > 1 ? Math.round((asc / (placed.length - 1)) * 100) / 100 : null, sample: placed.slice(0, 12) };
  out.push(row); console.log(JSON.stringify({ ...row, sample: undefined }));
  // Kept only where the placements hang together: at least 30 % of our translated pages placed, 90 % rising.
  if (row.placed >= 10 && row.placed_share >= 0.3 && row.rising >= 0.9) for (const x of placed) passages.write(JSON.stringify({ source: 'eebo-tcp', source_id: tcp, book_id: bookId, page_number: x.n, typed_page_idx: keep[x.i].i, typed_pb: ref.pages[keep[x.i].i].n ?? ref.pages[keep[x.i].i].ref, score: x.score, margin: x.margin, passage_version: PASSAGE_VERSION, kind: 'english-translation-of-our-work' }) + '\n');
}
passages.end(); await new Promise((res) => passages.on('finish', res));
fs.writeFileSync(`${WORK}/eebo/passage-probe.json`, JSON.stringify(out, null, 1));
await client.close();
