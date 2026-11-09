#!/usr/bin/env node
// PRIOR ART: scripts/audit/stranded-image-repair-text.mjs (#5309) lists stranded pages from timestamps alone — it says
// when the text was read, not what it reads; #5803's needs-read.json shows its false positives (a whole ia_djvu book the
// djvu detector reads ALIGNED). scripts/audit/ia-model-ocr-off-leaf.mjs (#5398) matches against IA's djvu leaves (29 h
// of IA fetches, abstains where IA cannot read). This reads only Mongo: a stranded page's stored text against the text
// its NEIGHBOURS hold now, where a neighbour was re-read from the repaired image (`resolved`), so holds its own leaf.
/**
 * diagnose — for every page the stranded audit lists, which leaf does its stored text belong to? (#5309)
 *
 *   node --env-file=.env.production.local scripts/eval/offleaf-5309/diagnose.mjs \
 *     --audit $JOB_SCRATCH/audit-2026-11-08.jsonl --out $JOB_SCRATCH/diagnose.jsonl
 *
 * Per stranded page n: shared(stored n, own text of m) for m = n±1 … n±8, where m's class is `resolved` (its text was
 * read from its own, repaired image, or moved onto it). shared = the share of the stored text's distinct folded words
 * (5+ letters; character trigrams for unspaced scripts; scripts/lib/stranded-leaf-gate.mjs) found in m's text.
 * Verdict: `offleaf` when the best neighbour shares >= 0.4 and beats the next best by >= 0.15 (offset = m - n);
 * `own_like` when no neighbour reaches 0.2 and n's own text is long (the page may be right: an aligned ia_djvu read);
 * `undecided` otherwise (neighbours also stranded, short text, repeated running heads).
 * Read-only. One line per page: {page_id, book_id, n, stored_hash, verdict, offset, ref_page_id, ref_hash, shared, second}.
 */
import fs from 'node:fs';
import { MongoClient } from 'mongodb';
import { strandedByImageRepair } from '../../lib/page-alignment.mjs';
import { contentHash } from '../../lib/write-provenance.mjs';
import { leafTokens, sharedShare } from '../../lib/stranded-leaf-gate.mjs';

const arg = (n, d = null) => { const i = process.argv.indexOf(`--${n}`); return i >= 0 ? process.argv[i + 1] : d; };
const AUDIT = arg('audit');
const OUT = arg('out');
const K = Number(arg('k', '8'));

const tokens = leafTokens;
const shared = sharedShare;

export function diagnosePage(n, byNum, ownTok) {
  const scores = [];
  for (let d = -K; d <= K; d++) {
    if (!d) continue;
    const m = byNum.get(n + d);
    if (!m || m.cls !== 'resolved' || m.tok.size < 15) continue;
    scores.push({ d, s: shared(ownTok, m.tok), id: m.id, hash: m.hash });
  }
  scores.sort((a, b) => b.s - a.s);
  const [best, second] = scores;
  if (ownTok.size < 20) return { verdict: 'undecided', why: 'short text', best, second };
  if (best && best.s >= 0.4 && best.s - (second?.s || 0) >= 0.15) return { verdict: 'offleaf', best, second };
  if (!best || best.s < 0.2) return { verdict: scores.length ? 'own_like' : 'undecided', why: scores.length ? 'no neighbour matches' : 'no resolved neighbour', best, second };
  return { verdict: 'undecided', why: 'weak or tied match', best, second };
}

if (process.argv[1] && process.argv[1].endsWith('diagnose.mjs')) {
  const rows = fs.readFileSync(AUDIT, 'utf8').split('\n').filter(Boolean).map(JSON.parse).filter((r) => r.stranded > 0);
  const c = new MongoClient(process.env.MONGODB_URI, { readPreference: 'secondaryPreferred' });
  await c.connect();
  const db = c.db('bookstore');
  const w = fs.createWriteStream(OUT);
  const tally = {};
  for (const r of rows) {
    const pages = await db.collection('pages').find({ book_id: r.book_id }, { projection: { _id: 1, id: 1, page_number: 1, archive_metadata: 1, 'ocr.data': 1, 'ocr.updated_at': 1, 'ocr.created_at': 1, text_shift_repaired_at: 1 } }).toArray();
    const byNum = new Map();
    for (const p of pages) byNum.set(p.page_number, { id: p.id || String(p._id), cls: strandedByImageRepair(p, r.repaired_at), tok: tokens(p.ocr?.data), hash: contentHash(p.ocr?.data ?? '') });
    const want = new Set(r.stranded_page_ids);
    for (const p of pages) {
      if (!want.has(String(p._id))) continue;
      const own = byNum.get(p.page_number);
      const v = diagnosePage(p.page_number, byNum, own.tok);
      tally[v.verdict] = (tally[v.verdict] || 0) + 1;
      w.write(JSON.stringify({ page_id: own.id, book_id: r.book_id, language: r.language, n: p.page_number, stored_hash: own.hash, verdict: v.verdict, why: v.why ?? null,
        offset: v.verdict === 'offleaf' ? v.best.d : null, ref_page_id: v.best?.id ?? null, ref_hash: v.best?.hash ?? null, ref_d: v.best?.d ?? null,
        shared: v.best ? Number(v.best.s.toFixed(3)) : null, second: v.second ? Number(v.second.s.toFixed(3)) : null }) + '\n');
    }
  }
  w.end();
  await c.close();
  console.log(JSON.stringify(tally));
}
