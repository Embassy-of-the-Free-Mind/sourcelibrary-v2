#!/usr/bin/env node
/**
 * PRIOR ART: scripts/audit/convergent-audit-weekly.mjs `draw` — the frame (visible non-English books with a translated
 * page) and the page rule (`eligible`) are copied from it so a scored pool is drawn from exactly the audit's frame; it
 * draws pages but cannot score them. scripts/eval/error-zoo/labels.mjs writes REVIEWED pages; this writes UNREVIEWED
 * candidates in the same row shape (source 'candidate', no label) so fetch-pages.mjs and features.py run unchanged and
 * score.py can rank them. Read-only.
 *
 *   node --env-file=… scripts/eval/error-zoo/pool.mjs --out=DIR [--books=2500] [--seed=N]
 *        [--langs=Latin:150,German:150,...]   per-language quotas instead of a uniform draw (the calibration set)
 * Writes DIR/candidates.jsonl: {source:'candidate', book_id, page_id, page_number, language, serious:false, errors:[]}.
 */
import { MongoClient } from 'mongodb';
import fs from 'node:fs';
import path from 'node:path';

const arg = (n, d) => process.argv.find((a) => a.startsWith(`--${n}=`))?.split('=').slice(1).join('=') ?? d;
const OUT = path.resolve(arg('out', '')); if (!arg('out')) { console.error('--out=DIR required'); process.exit(2); }
const NBOOKS = Number(arg('books', 2500)), SEED = Number(arg('seed', Date.now() % 1e9));
const QUOTA = arg('langs') ? Object.fromEntries(arg('langs').split(',').map((x) => { const [l, n] = x.split(':'); return [l, Number(n)]; })) : null;
// Copied from convergent-audit-weekly.mjs so the pool is the audit's frame.
const ENGLISH = /^(english|middle english|old english|early modern english|en)$/i;
const EXCLUDED_TYPES = new Set(['archived-spread', 'blank', 'title-page', 'toc', 'index', 'illustration', 'digitizer-insert', 'colophon', 'errata', 'cover', 'map', 'plate']);
let s = SEED >>> 0; const rng = () => { s |= 0; s = (s + 0x6d2b79f5) | 0; let t = Math.imul(s ^ (s >>> 15), 1 | s); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
const shuffle = (a) => { a = [...a]; for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };

const c = new MongoClient(process.env.MONGODB_URI); await c.connect();
const db = c.db('bookstore');
const frame = (await db.collection('books').find({ visible: true, pages_count: { $gt: 0 }, pages_translated: { $gte: 1 } }, { projection: { _id: 0, id: 1, language: 1 } }).toArray())
  .filter((b) => b.id && b.language && !ENGLISH.test(String(b.language).trim()));
console.log('frame books', frame.length, 'seed', SEED);
const want = (b) => (QUOTA ? QUOTA[String(b.language).trim()] !== undefined : true);
const got = {}; const out = [];
fs.mkdirSync(OUT, { recursive: true });
for (const b of shuffle(frame.filter(want))) {
  const L = String(b.language).trim();
  if (QUOTA ? (got[L] || 0) >= QUOTA[L] : out.length >= NBOOKS) { if (!QUOTA) break; if (Object.entries(QUOTA).every(([l, n]) => (got[l] || 0) >= n)) break; continue; }
  // strlen-safe: both $strLenCP operands are wrapped in $ifNull with '' (string by construction)
  const pages = await db.collection('pages').aggregate([
    { $match: { book_id: b.id, page_number: { $gt: 0 } } },
    { $project: { id: 1, page_number: 1, page_type: 1, ol: { $strLenCP: { $ifNull: ['$ocr.data', ''] } }, tl: { $strLenCP: { $ifNull: ['$translation.data', ''] } } } },
    { $match: { ol: { $gte: 200 }, tl: { $gte: 100 } } },
  ]).toArray();
  const el = pages.filter((p) => !EXCLUDED_TYPES.has(p.page_type) && p.id);
  if (!el.length) continue;
  const p = el[Math.floor(rng() * el.length)];
  out.push({ source: 'candidate', method: 'candidate', run_id: `pool-${SEED}`, book_id: b.id, page_id: p.id, page_number: p.page_number, language: L, serious: false, errors: [], exposure: 'served', selection: 'random' });
  got[L] = (got[L] || 0) + 1;
  if (out.length % 250 === 0) console.log('  candidates', out.length);
}
await c.close();
fs.writeFileSync(path.join(OUT, 'candidates.jsonl'), out.map((r) => JSON.stringify(r)).join('\n') + '\n');
console.log('wrote', out.length, 'candidates', QUOTA ? JSON.stringify(got) : '');
