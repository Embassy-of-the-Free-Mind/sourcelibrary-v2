#!/usr/bin/env node
// PRIOR ART: scripts/lib/stranded-leaf-gate.mjs corroboration() — the check cli-ocr's --stranded gate now makes before a
// write; this runs the same check AFTER a wave over the pages it wrote (the pilot was written before the check existed).
/**
 * corroborate — is each page an offleaf-5309 wave wrote corroborated by an earlier read of its own leaf? (#5309)
 *
 *   node --env-file=.env.production.local scripts/eval/offleaf-5309/corroborate.mjs --ledger F --diagnose F --out FILE
 *
 * Per written page n: the shift d is the page's own diagnosed offset, else the book's most common one, else each of
 * ±1…±3. Corroborated when the written text shares >= 0.4 with an earlier OCR revision of page n−d (or its current text
 * while that page is still stranded), or with the page's OWN text before the write (the 40% floor's own test). Model-free; one line per page {page_id, book_id, n, d, corroborated, shared, best_any}.
 * `best_any` is the best share with ANY neighbour's current or earlier text (an uncorroborated read that matches
 * nothing anywhere is the invented-page shape).
 */
import fs from 'node:fs';
import { MongoClient } from 'mongodb';
import { leafTokens, sharedShare, corroboration } from '../../lib/stranded-leaf-gate.mjs';

const arg = (n, d = null) => { const i = process.argv.indexOf(`--${n}`); return i >= 0 ? process.argv[i + 1] : d; };
const readJsonl = (f) => fs.readFileSync(f, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
const led = readJsonl(arg('ledger')).filter((r) => r.ocr_written);
const diag = readJsonl(arg('diagnose'));
const stranded = new Map(diag.map((r) => [r.page_id, r]));
const bookD = new Map();
for (const r of diag) if (r.verdict === 'offleaf') { const m = bookD.get(r.book_id) || bookD.set(r.book_id, new Map()).get(r.book_id); m.set(r.offset, (m.get(r.offset) || 0) + 1); }
const c = new MongoClient(process.env.MONGODB_URI, { readPreference: 'secondaryPreferred' });
await c.connect();
const db = c.db('bookstore');
const out = [];
for (const r of led) {
  const page = await db.collection('pages').findOne({ id: r.page_id }, { projection: { id: 1, page_number: 1, book_id: 1, 'ocr.data': 1 } });
  const n = page.page_number;
  const near = await db.collection('pages').find({ book_id: page.book_id, page_number: { $gte: n - 8, $lte: n + 8, $ne: n } }, { projection: { id: 1, page_number: 1, 'ocr.data': 1, 'ocr.updated_at': 1 } }).toArray();
  const hist = new Map();
  for (const h of await db.collection('page_revisions').find({ page_id: { $in: near.map((x) => x.id) }, field: 'ocr' }, { projection: { page_id: 1, data: 1 } }).toArray()) if (typeof h.data === 'string') (hist.get(h.page_id) || hist.set(h.page_id, []).get(h.page_id)).push(h.data);
  // still stranded = still holds the text the diagnosis read (not re-read since)
  const nb = near.map((x) => ({ id: x.id, n: x.page_number, d: x.page_number - n, text: x.ocr?.data ?? '', tok: leafTokens(x.ocr?.data), history: hist.get(x.id) || [], stranded: !!stranded.get(x.id) && !led.some((l) => l.page_id === x.id && l.ocr_written) }));
  const rd = leafTokens(page.ocr?.data);
  const own = stranded.get(r.page_id);
  const bd = bookD.get(page.book_id);
  const ds = own?.verdict === 'offleaf' ? [own.offset] : bd ? [[...bd.entries()].sort((a, b) => b[1] - a[1])[0][0]] : [-1, 1, -2, 2, -3, 3];
  let hit = null, dUsed = ds[0];
  for (const d of ds) { const h = corroboration(rd, nb, -d); if (h) { hit = h; dUsed = d; break; } }
  // The page's own text before this write (a page the 40% floor let through agreed with it: a timestamp false positive
  // whose stored text was its own leaf, e.g. IA's djvu text, #5803).
  const ownPrior = await db.collection('page_revisions').find({ page_id: r.page_id, field: 'ocr' }, { projection: { data: 1 } }).toArray();
  const ownShare = Math.max(0, ...ownPrior.map((h) => sharedShare(rd, leafTokens(h.data))));
  let bestAny = 0, bestAt = null;
  for (const x of nb) for (const t of [x.text, ...x.history]) { const s = sharedShare(rd, leafTokens(t)); if (s > bestAny) { bestAny = s; bestAt = x.n; } }
  out.push({ page_id: r.page_id, book_id: page.book_id, n, language: r.language, words: rd.size, d: dUsed, corroborated: !!hit || ownShare >= 0.4, by: hit ? 'n-d' : ownShare >= 0.4 ? 'own-prior' : null, shared: hit?.shared ?? null, own_prior: Number(ownShare.toFixed(3)), best_any: Number(bestAny.toFixed(3)), best_any_n: bestAt });
}
fs.writeFileSync(arg('out'), out.map((x) => JSON.stringify(x)).join('\n') + '\n');
const un = out.filter((x) => !x.corroborated);
console.log(`${out.length} written pages: corroborated ${out.length - un.length}, not ${un.length} (of which matching nothing anywhere, best < 0.2: ${un.filter((x) => x.best_any < 0.2).length})`);
await c.close();
