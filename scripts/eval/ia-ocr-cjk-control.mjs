#!/usr/bin/env node
/**
 * PRIOR ART: scripts/eval/ia-ocr-delivered-quality.mjs (CER of WRITTEN pages against a fresh paid
 * model read — measures delivered text, not the scorer, and costs money); scripts/eval/neighbour-leaf-test.mjs
 * (does a revision fit its own leaf better than its neighbours — one book, page_revisions, the
 * agreementPrimary metric, not the gate's ratio); scripts/eval/ia-ocr-baseline.mjs (July pilot, the
 * word-token instrument this replaces). None scores the GATE's own ratio against a control.
 *
 * ia-ocr-cjk-control — does the free-OCR gate's score (scripts/lib/ia-ocr-agreement.mjs) mean
 * anything on the books it is about to judge? Free: cached leaves + Mongo reads, no archive.org, no model.
 *
 * For every reference page (model OCR) of every listed book it computes, at leaf offset 0:
 *   new_pos    the gate's score against the page's OWN leaf (what the ingester will use)
 *   old_pos    the same with the pre-#4806 word tokenizer (the Latin-script regression: must not move)
 *   body       new tokenizer with editorial blocks (<image-desc> …) DROPPED — what the known bias costs
 *   neg_same   against a DIFFERENT leaf of the same book (k + 7)
 *   neg_other  against the same leaf index of the PREVIOUS listed book (a different book entirely)
 * A score that cannot say NO is not a score: neg_* must sit far below the cutoff, or per-character
 * matching over a small inventory is manufacturing agreement (lesson: a degenerate reference unit
 * turns alignment into subsequence matching). Per-book medians go to --out (JSONL); a summary prints.
 *
 * Usage (Hetzner; leaves must already be in --cache, i.e. after the dry run):
 *   node scripts/eval/ia-ocr-cjk-control.mjs --ids <file> --cache /root/sl-ia-cache --out <jsonl> [--cutoff 0.85] [--max-ref 40]
 */
import fs from 'node:fs';
import path from 'node:path';
import { ObjectId } from 'mongodb';
import { withMongo } from '../lib/mongo.mjs';
import { dehyphenateLineBreaks } from '../lib/dehyphenate.mjs';
import { tokens, tokensBody, ratio } from '../lib/ia-ocr-agreement.mjs';
import { scriptClassOf } from './lib/metrics.mjs';

const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const IDS = arg('--ids', null); const CACHE = arg('--cache', null); const OUT = arg('--out', null);
const CUTOFF = +arg('--cutoff', 0.85); const MAX_REF = +arg('--max-ref', 40);
if (!IDS || !CACHE || !OUT) { console.error('need --ids --cache --out'); process.exit(2); }

// LEGACY: the gate's tokenizer from #4783 to #4806, kept only to measure the change. Never reuse.
const legacyTokens = (s) => (s || '').replace(/<[^>]+>/g, ' ').normalize('NFC').replace(/[’‘ʼ]/g, "'").toLowerCase().match(/[\p{L}\p{N}']+/gu) || [];

const decode = (s) => s.replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&').replace(/&#(\d+);/g, (_, n) => String.fromCharCode(+n));
function leafTexts(xml) {
  const out = [];
  for (const o of xml.split(/<OBJECT\b/).slice(1)) {
    const paras = [];
    for (const p of o.split(/<PARAGRAPH\b/).slice(1)) {
      const lines = [];
      for (const l of p.split(/<LINE\b/).slice(1)) { const w = [...l.matchAll(/<WORD[^>]*>([\s\S]*?)<\/WORD>/g)].map((m) => decode(m[1]).trim()).filter(Boolean); if (w.length) lines.push(w.join(' ')); }
      if (lines.length) paras.push(lines.join('\n'));
    }
    out.push(paras.join('\n\n'));
  }
  return out;
}
function loadLeaves(iaId) {
  const j = path.join(CACHE, `${iaId}.leaves.json`), x = path.join(CACHE, `${iaId}_djvu.xml`);
  if (fs.existsSync(j)) return JSON.parse(fs.readFileSync(j, 'utf8')).map(dehyphenateLineBreaks);
  if (fs.existsSync(x)) return leafTexts(fs.readFileSync(x, 'utf8')).map(dehyphenateLineBreaks);
  return null;
}
const leafIndex = (p) => { const m = String(p.photo || p.archived_photo || '').match(/\/page\/n(\d+)\//); return m ? +m[1] : (p.page_number || 1) - 1; };
const median = (xs) => { const s = xs.filter((x) => x !== null && x !== undefined).sort((x, y) => x - y); return s.length ? s[Math.floor(s.length / 2)] : null; };
const pct = (xs, q) => { const s = xs.filter((x) => x !== null && x !== undefined).sort((x, y) => x - y); return s.length ? s[Math.min(s.length - 1, Math.floor(s.length * q))] : null; };
const spread = (n, k) => { if (n <= k) return [...Array(n).keys()]; const out = []; for (let i = 0; i < k; i++) out.push(Math.floor((i * n) / k)); return out; };

const ids = fs.readFileSync(IDS, 'utf8').split(/\r?\n/).map((x) => x.trim()).filter(Boolean);
const rows = [];
await withMongo(async (db) => {
  const B = db.collection('books'), P = db.collection('pages');
  const books = await B.find({ $or: [{ id: { $in: ids } }, { _id: { $in: ids.filter((x) => ObjectId.isValid(x)).map((x) => new ObjectId(x)) } }] },
    { projection: { id: 1, title: 1, language: 1, published: 1, ia_identifier: 1, image_source: 1 } }).toArray();
  const byId = new Map(books.map((b) => [b.id || String(b._id), b]));
  let prev = null; // previous book with leaves: the "other book" negative control
  for (const bid of ids) {
    const b = byId.get(bid); if (!b) { console.log(`  ${bid} not found`); continue; }
    const iaId = b.ia_identifier || b.image_source?.identifier; if (!iaId) continue;
    const leaves = loadLeaves(iaId); if (!leaves) { console.log(`  ${bid} ${iaId} not in cache — skip`); continue; }
    const leafTok = leaves.map(tokens), leafOld = leaves.map(legacyTokens);
    const pages = await P.find({ book_id: bid, 'ocr.data': { $type: 'string' }, 'ocr.source': { $ne: 'ia_djvu' } },
      { projection: { page_number: 1, photo: 1, archived_photo: 1, 'ocr.data': 1 } }).sort({ page_number: 1 }).toArray();
    const refs = spread(pages.length, MAX_REF).map((i) => pages[i]);
    const per = { new_pos: [], old_pos: [], body: [], neg_same: [], neg_other: [] };
    let cls = 'unknown';
    for (const p of refs) {
      const k = leafIndex(p); if (k < 0 || k >= leaves.length) continue;
      const tt = tokens(p.ocr.data); if (tt.length < 20 || leafTok[k].length < 20) continue;
      if (cls === 'unknown') cls = scriptClassOf(p.ocr.data);
      per.new_pos.push(ratio(tt, leafTok[k]));
      per.old_pos.push(ratio(legacyTokens(p.ocr.data), leafOld[k]));
      per.body.push(ratio(tokensBody(p.ocr.data), leafTok[k]));
      const j = (k + 7) % leaves.length; if (leafTok[j].length >= 20) per.neg_same.push(ratio(tt, leafTok[j]));
      if (prev) { const o = prev.leafTok[k % prev.leafTok.length]; if (o.length >= 20) per.neg_other.push(ratio(tt, o)); }
    }
    if (per.new_pos.length < 5) { console.log(`  ${bid} ${iaId} ref pages ${per.new_pos.length} < 5 — skip`); prev = { leafTok }; continue; }
    const row = { book_id: bid, ia: iaId, language: b.language || null, year: String(b.published || '').slice(0, 4), title: (b.title || '').slice(0, 60), script_class: cls, n_ref: per.new_pos.length,
      new_pos: median(per.new_pos), old_pos: median(per.old_pos), body: median(per.body), neg_same: median(per.neg_same), neg_other: median(per.neg_other),
      neg_same_max: pct(per.neg_same, 1), neg_other_max: pct(per.neg_other, 1) };
    row.verdict_old = row.old_pos >= CUTOFF ? 'ACCEPT' : 'REJECT'; row.verdict_new = row.new_pos >= CUTOFF ? 'ACCEPT' : 'REJECT';
    rows.push(row); prev = { leafTok };
    console.log(`  ${row.script_class.padEnd(9)} ${bid} ${row.year} ${row.title.slice(0, 40).padEnd(40)} | new ${row.new_pos.toFixed(3)} old ${row.old_pos.toFixed(3)} body ${row.body.toFixed(3)} | neg same ${row.neg_same?.toFixed(3) ?? '  -  '} other ${row.neg_other?.toFixed(3) ?? '  -  '} | ${row.verdict_old}→${row.verdict_new}`);
  }
});
fs.writeFileSync(OUT, rows.map((r) => JSON.stringify(r)).join('\n') + '\n');
for (const cls of ['spaced', 'spaceless']) {
  const rs = rows.filter((r) => r.script_class === cls); if (!rs.length) continue;
  const d = rs.map((r) => r.new_pos - r.old_pos);
  const flips = rs.filter((r) => r.verdict_old !== r.verdict_new);
  console.log(JSON.stringify({ script_class: cls, books: rs.length, cutoff: CUTOFF,
    median_new_pos: median(rs.map((r) => r.new_pos)), median_old_pos: median(rs.map((r) => r.old_pos)), median_body: median(rs.map((r) => r.body)),
    delta_new_minus_old: { median: median(d), p05: pct(d, 0.05), p95: pct(d, 0.95), max_abs: Math.max(...d.map(Math.abs)) },
    verdict_flips: flips.length, flips: flips.map((r) => `${r.book_id} ${r.old_pos.toFixed(3)}→${r.new_pos.toFixed(3)}`).slice(0, 20),
    neg_same: { median: median(rs.map((r) => r.neg_same)), p95: pct(rs.map((r) => r.neg_same), 0.95), max: pct(rs.map((r) => r.neg_same_max), 1) },
    neg_other: { median: median(rs.map((r) => r.neg_other)), p95: pct(rs.map((r) => r.neg_other), 0.95), max: pct(rs.map((r) => r.neg_other_max), 1) },
    books_where_a_negative_clears_cutoff: rs.filter((r) => (r.neg_same_max ?? 0) >= CUTOFF || (r.neg_other_max ?? 0) >= CUTOFF).length,
    accept_new: rs.filter((r) => r.verdict_new === 'ACCEPT').length, accept_old: rs.filter((r) => r.verdict_old === 'ACCEPT').length }));
}
