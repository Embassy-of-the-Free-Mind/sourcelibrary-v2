// #6740 read-surface: the paired panel for the Box-Behnken tuning of the agy first read. One target page per book,
// German from DTA and Latin from CAMENA (#6012), each target a typed page whose page breaks fall on ours
// (`congruent`, one typed page), with the 8-page window around it that the pages-per-call runs read.
//
// PRIOR ART: scripts/eval/euro-gpu-correct-7567/build-panel.py (DTA pages with DTA's own images, not our library
//   pages; Latin from CAMENA + Wikisource, two pages per work); scripts/eval/typed-refs-6012/align.mjs (the alignment
//   rows this reads, and the shard layout of the typed text); scripts/eval/lib/sampling.mjs sampleOnePagePerBook (one
//   page per book from a page list; it has no window, century quota or typed-page filter). None draws a target that
//   can be read 1, 4 or 8 pages a call with its own book's neighbours.
//
//   node --env-file=/root/sourcelibrary/.env.production.local scripts/eval/read-surface-6740/panel.mjs --work=DIR [--langs=en --merge]
// Amendment 6 (second form): English (EEBO-TCP same-edition pages, the English rows only) is drawn alone with a fresh
// seed-6740 stream and MERGED into an existing panel.json / refs.jsonl.gz, leaving German and Latin as they were.
// Writes DIR/panel.json (targets, windows, quotas, seed) and DIR/refs.jsonl.gz (target typed text; private: never
// committed, the R2 bucket is the store). Reads Mongo and the private R2 bucket; writes nothing else.
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { createHash } from 'node:crypto';
import { MongoClient } from 'mongodb';
import { GetObjectCommand } from '@aws-sdk/client-s3';
import { r2, BUCKET, keyOf } from '../typed-refs-6012/lib.mjs';
import { getPageSource } from '../../lib/page-image-url.mjs';

const arg = (n, d) => process.argv.find((a) => a.startsWith(`--${n}=`))?.split('=').slice(1).join('=') ?? d;
const WORK = path.resolve(arg('work'));
const HERE = path.dirname(new URL(import.meta.url).pathname);
const OUTPUT = path.join(HERE, '..', 'output');
const SEED = 6740;
// Century quotas per language (preregistered in the experiment file): spread over the centuries held, 40 + 8 spares.
const QUOTA = {
  de: { source: 'dta', want: { '1500s': 2, '1600s': 14, '1700s': 14, '1800s': 14 }, n: 40 },
  la: { source: 'camena', want: { '1500s': 16, '1600s': 18, '1700s': 6, unknown: 2 }, n: 40 },
  en: { source: 'eebo-tcp', manifest: 'manifest-matched', language: 'English', want: { '1500s': 12, '1600s': 26, '1700s': 2 }, n: 40 },
};
const LANGS = arg('langs') ? arg('langs').split(',') : ['de', 'la'];
const MERGE = process.argv.includes('--merge');
const SPARES = 8;
// The window the 8-a-call runs read: target at position 4 of 8 (t-3 … t+4); 4-a-call: position 2 of 4 (t-1 … t+2).
const WIN8 = [-3, -2, -1, 0, 1, 2, 3, 4];

function rng(seed) { let s = seed >>> 0; return () => { s = (s + 0x6D2B79F5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
const readGz = (f) => zlib.gunzipSync(fs.readFileSync(f)).toString('utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));

const client = new MongoClient(process.env.MONGODB_URI);
await client.connect();
const db = client.db('bookstore');
fs.mkdirSync(WORK, { recursive: true });
const rand = rng(SEED);
const panel = MERGE ? JSON.parse(fs.readFileSync(path.join(WORK, 'panel.json'), 'utf8')) : { issue: 6740, seed: SEED, built_at: new Date().toISOString(), quota: QUOTA, window8: WIN8, langs: {} };
if (MERGE) { panel.quota = { ...panel.quota, ...Object.fromEntries(LANGS.map((l) => [l, QUOTA[l]])) }; panel.merged = [...(panel.merged || []), { langs: LANGS, at: new Date().toISOString(), seed: SEED }]; }
const refRows = MERGE ? readGz(path.join(WORK, 'refs.jsonl.gz')).filter((r) => !LANGS.some((l) => r.slug.startsWith(`${l}-`))) : [];

for (const [lang, q] of Object.entries(QUOTA).filter(([l]) => LANGS.includes(l))) {
  const rows = readGz(path.join(OUTPUT, `typed-refs-6012-2026-10-06.${q.source}.aligned-pages.jsonl.gz`))
    .filter((r) => r.kind === 'same-edition' && r.congruent && r.ref_page_idx[0] === r.ref_page_idx[1] && (!q.language || r.language === q.language));
  const manifest = new Map(readGz(path.join(OUTPUT, `typed-refs-6012-2026-10-06.${q.source}.${q.manifest || 'manifest'}.jsonl.gz`)).map((m) => [m.source_id, m]));
  const byBook = new Map();
  for (const r of rows) { if (!byBook.has(r.book_id)) byBook.set(r.book_id, []); byBook.get(r.book_id).push(r); }
  const ids = [...byBook.keys()];
  const books = new Map((await db.collection('books').find({ $or: [{ id: { $in: ids } }, { _id: { $in: ids } }] }, { projection: { id: 1, title: 1, author: 1, published: 1, language: 1, pages_count: 1, needs_splitting: 1, split_completed: 1, visible: 1 } }).toArray()).map((b) => [b.id ?? String(b._id), b]));
  const eligible = [];
  for (const [bookId, rs] of byBook) {
    const b = books.get(bookId);
    if (!b || b.needs_splitting === true && !b.split_completed) continue;
    const pages = await db.collection('pages').find({ book_id: bookId }, { projection: { id: 1, book_id: 1, page_number: 1, archived_photo: 1, photo: 1, cropped_photo: 1, split_from_spread: 1, split_from_pecha: 1, crop: 1, enhanced_photo: 1, photo_original: 1 } }).toArray();
    const byNum = new Map(pages.map((p) => [p.page_number, p]));
    const n = Math.max(b.pages_count || 0, pages.length);
    // Interior targets (skip the front 15 % and the back 5 %; eval-design §3.2; CAMENA: from page 4, because #6012 aligned
    // most CAMENA books only on their first 25 OCR'd pages, so the front rule leaves 12 books) whose whole 8-page window exists with an image.
    const ok = rs.filter((r) => r.page_number >= (q.source === 'camena' ? 4 : Math.max(4, Math.floor(n * 0.15))) && r.page_number <= Math.floor(n * 0.95) - 4
      && WIN8.every((d) => { const p = byNum.get(r.page_number + d); return p && getPageSource(p); })
      && r.our_letters >= 400);
    if (!ok.length) continue;
    // Several candidates per book; the typed text decides (no notes on the typed page) after the shard read.
    const picks = [...ok].sort(() => rand() - 0.5).slice(0, 4);
    eligible.push({ bookId, period: rs[0].period, book: b, picks, byNum });
  }
  // Typed text of the candidate pages, from the shards that hold them.
  const shards = new Map();
  for (const e of eligible) for (const r of e.picks) { const m = manifest.get(r.source_id); if (!shards.has(m.derived_key)) shards.set(m.derived_key, new Set()); shards.get(m.derived_key).add(r.source_id); }
  const typed = new Map();
  for (const [shard, srcs] of shards) {
    const key = shard.startsWith('eval-refs/') ? shard : keyOf(shard);
    const obj = await r2().send(new GetObjectCommand({ Bucket: BUCKET, Key: key }));
    const chunks = []; for await (const c of obj.Body) chunks.push(c);
    for (const l of zlib.gunzipSync(Buffer.concat(chunks)).toString('utf8').split('\n')) {
      if (!l) continue; const r = JSON.parse(l); if (srcs.has(r.source_id)) typed.set(r.source_id, r);
    }
    console.log(`${lang}: shard ${shard} read (${srcs.size} sources)`);
  }
  const strata = {};
  for (const e of eligible) {
    const pick = e.picks.find((r) => { const t = typed.get(r.source_id)?.pages?.[r.ref_page_idx[0]]; return t && !(t.notes || []).join('').trim() && t.text.replace(/\W/g, '').length >= 400; });
    if (!pick) continue;
    e.pick = pick;
    (strata[e.period] ||= []).push(e);
  }
  const chosen = [], spares = [];
  for (const [period, want] of Object.entries(q.want)) {
    const pool = (strata[period] || []).sort(() => rand() - 0.5);
    chosen.push(...pool.slice(0, want)); spares.push(...pool.slice(want));
  }
  // A short century fills from the spares, in draw order; the rest are spares.
  spares.sort(() => rand() - 0.5);
  while (chosen.length < q.n && spares.length) chosen.push(spares.shift());
  while (chosen.length > q.n) spares.unshift(chosen.pop());
  const out = (e, spare) => {
    const t = e.pick.page_number;
    const tp = typed.get(e.pick.source_id).pages[e.pick.ref_page_idx[0]];
    const window = WIN8.map((d) => e.byNum.get(t + d).id);
    const refText = tp.text;
    refRows.push({ slug: `${lang}-${e.bookId}-p${t}`, ref_text: refText });
    return {
      slug: `${lang}-${e.bookId}-p${t}`, lang, book_id: e.bookId, page_number: t, page_id: e.byNum.get(t).id,
      window8: window, window4: window.slice(2, 6), title: e.book.title, author: e.book.author ?? null, published: e.book.published ?? null,
      period: e.period, visible: !!e.book.visible, source: q.source, source_id: e.pick.source_id, typed_page: tp.n ?? null,
      typed_facs: tp.facs ?? null, overlap: e.pick.overlap, licence: manifest.get(e.pick.source_id)?.licence_key ?? null,
      ref_letters: refText.replace(/\W/g, '').length, ref_sha256: createHash('sha256').update(refText).digest('hex'), spare,
    };
  };
  panel.langs[lang] = { eligible_books: Object.values(strata).flat().length, targets: chosen.map((e) => out(e, false)), spares: spares.slice(0, SPARES).map((e) => out(e, true)) };
  console.log(`${lang}: ${panel.langs[lang].eligible_books} eligible books; ${chosen.length} targets; periods`, chosen.reduce((m, e) => ({ ...m, [e.period]: (m[e.period] || 0) + 1 }), {}));
}
fs.writeFileSync(path.join(WORK, 'panel.json'), JSON.stringify(panel, null, 1));
fs.writeFileSync(path.join(WORK, 'refs.jsonl.gz'), zlib.gzipSync(refRows.map((r) => JSON.stringify(r)).join('\n') + '\n'));
await client.close();
