#!/usr/bin/env node
// PRIOR ART: scripts/eval/spotcheck-latin-5924/draw.mjs (same getPageSource image fetch for a by-eye packet; draws served pages, not pass changes).
/**
 * apply-gate-draw.mjs — the long-s apply gate's page draw (#5924). From apply-dry's changed flash pages: 10 pages where the reader
 * writes ſ as f and 10 where it does not, one per book per stratum (new books first), seeded; fetches each page image and writes a
 * packet (changed lines before/after, tokens, full text after the pass) for an image-open reader. Read-only.
 *   SEED=n GATE=<subdir> PRIOR=<earlier manifests.json> EXCLUDE=<book ids> LONGS_MODEL=… JOB_SCRATCH=… \
 *     node --env-file=/root/sourcelibrary/.env.production.local apply-gate-draw.mjs
 * Verdicts of the four rounds: apply-gate-5924.json.
 */
import fs from 'node:fs'; import zlib from 'node:zlib'; import readline from 'node:readline'; import path from 'node:path';
import { MongoClient } from 'mongodb';
const S = process.env.JOB_SCRATCH;
const L = await import('../../lib/longs-orthography.mjs');
const { getPageSource } = await import('../../lib/page-image-url.mjs');
const model = new L.Model(JSON.parse(zlib.gunzipSync(fs.readFileSync(process.env.LONGS_MODEL)).toString()));
function mulberry32(a) { return () => { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
const rnd = mulberry32(+(process.env.SEED || 5924023));
const GATE = process.env.GATE || 'gate';
const prior = process.env.PRIOR ? JSON.parse(fs.readFileSync(process.env.PRIOR, 'utf8')) : [];
const priorBooks = new Set(prior.map((m) => m.book_id)), priorPages = new Set(prior.map((m) => m.id));
const ch = []; for await (const l of readline.createInterface({ input: fs.createReadStream(S + '/dry-changes.jsonl.gz').pipe(zlib.createGunzip()) })) { const r = JSON.parse(l); if (r.eng === 'flash' && r.kept >= 3) ch.push(r); }
// one page per book per stratum, seeded shuffle; 10 habit + 10 non-habit, max 2 pages per book overall
for (let i = ch.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [ch[i], ch[j]] = [ch[j], ch[i]]; }
const pick = []; const perBook = new Map();
// re-apply the CURRENT rule: a page counts only if it still has >= 3 changes; new books first, then any book
const excl = new Set((process.env.EXCLUDE || '').split(',').filter(Boolean));
const cur = ch.filter((r) => !priorPages.has(r.id) && !excl.has(r.book_id));
for (const want of [true, false]) { let n = 0; const seen = new Set();
  for (const pass of [0, 1]) for (const r of cur) { if (n >= 10) break; if (pass === 0 && priorBooks.has(r.book_id)) continue;
    if (r.habit.habit !== want || seen.has(r.book_id) || (perBook.get(r.book_id) || 0) >= 2 || pick.includes(r)) continue;
    seen.add(r.book_id); perBook.set(r.book_id, (perBook.get(r.book_id) || 0) + 1); pick.push(r); n++; } }
const c = new MongoClient(process.env.MONGODB_URI); await c.connect(); const db = c.db('bookstore');
const dir = path.join(S, GATE); fs.mkdirSync(dir, { recursive: true });
const manifest = [];
for (const r of pick) {
  const p = await db.collection('pages').findOne({ id: r.id }, { projection: { id: 1, book_id: 1, page_number: 1, ocr: 1, photo: 1, archived_photo: 1, cropped_photo: 1, split_from_spread: 1, enhanced_photo: 1, photo_original: 1, display_photo: 1 } });
  const b = await db.collection('books').findOne({ $or: [{ id: r.book_id }, { _id: r.book_id }] }, { projection: { title: 1, published: 1, language: 1 } });
  const o = L.applyLongS(p.ocr.data, model);
  const slug = `${r.book_id.slice(0, 8)}-p${p.page_number}`;
  const src = getPageSource(p); let img = null;
  try { const res = await fetch(src, { signal: AbortSignal.timeout(60000) }); if (!res.ok) throw new Error('HTTP ' + res.status); fs.writeFileSync(path.join(dir, slug + '.jpg'), Buffer.from(await res.arrayBuffer())); img = slug + '.jpg'; } catch (e) { console.log('img fail', slug, e.message); }
  const A = p.ocr.data.split('\n'), B = o.text.split('\n'); const lines = [];
  for (let i = 0; i < A.length; i++) if (A[i] !== B[i]) {
    const toks = []; const re = /[\p{L}\p{M}ſ]+/gu; let m; while ((m = re.exec(B[i]))) { const orig = A[i].slice(m.index, m.index + m[0].length); if (orig !== m[0]) toks.push(`${orig} → ${m[0]}`); }
    lines.push({ line: i + 1, before: A[i], after: B[i], changes: toks });
  }
  const nChanges = lines.reduce((k, l) => k + l.changes.length, 0);
  fs.writeFileSync(path.join(dir, slug + '.packet.txt'), [`PAGE ${slug}  book ${r.book_id} "${b?.title}" (${b?.published}), page_number ${p.page_number}, ocr.model ${p.ocr.model}`,
    `habit: ${JSON.stringify(o.habit)}  changes: ${nChanges}`, `IMAGE: ${img ? path.join(dir, img) : 'MISSING'}`, '', '=== CHANGED LINES (OCR line number; before / after; tokens changed) ===',
    ...lines.flatMap((l) => [`L${l.line}: BEFORE: ${l.before}`, `L${l.line}: AFTER:  ${l.after}`, `L${l.line}: CHANGES: ${l.changes.join(' | ')}`, '']),
    '=== FULL OCR AFTER THE PASS ===', o.text].join('\n'));
  manifest.push({ slug, id: p.id, book_id: r.book_id, title: b?.title, published: b?.published, habit: o.habit.habit, changes: nChanges, img });
}
fs.writeFileSync(path.join(dir, 'manifest.json'), JSON.stringify(manifest, null, 1));
console.log(manifest.map((m) => `${m.slug} habit=${m.habit} n=${m.changes} img=${!!m.img} ${String(m.title).slice(0, 40)}`).join('\n'));
await c.close();
