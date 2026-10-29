#!/usr/bin/env node
// PRIOR ART: scripts/eval/caseless-drift-7503/calibrate.mjs — runs detectBlockDrift (caseless) over #7518's breaks;
// it reads #7518's committed reads and OCR snapshot, not a new arm's out dirs, and does not replay what the guard did
// in production (which calls it split, which pages it sent to be read alone). Same detector, same reading of a
// one-per-call arm (every break as if it were a block's: a flag there is the false-flag floor).
/**
 * #5600: the Han page-break guard per arm, plus calls, pages re-read alone and the quota index after those re-reads.
 *
 *   node --env-file=... scripts/eval/siku-percall-5600/drift.mjs --scratch=DIR [--arms=A,B,C]
 *
 * Block arms (calls.jsonl): every successful multi-page call is split again from its kept raw reply
 * (claude-translate.mjs splitBlockReply) and each in-block break is run through detectBlockDrift({caseless:true}),
 * the test claude-translate.mjs runs before it keeps a block. One-per-call arms: each of the 3 breaks in each of the
 * 30 four-page blocks, read as if it were a block's. Writes DIR/drift.json; OCR snapshot DIR/ocr.json.
 */
import fs from 'node:fs';
import path from 'node:path';
import { detectBlockDrift } from '../../lib/block-drift.mjs';
import { splitBlockReply } from '../../batch/claude-translate.mjs';

const HERE = path.dirname(new URL(import.meta.url).pathname);
const arg = (n) => process.argv.find((a) => a.startsWith(`--${n}=`))?.split('=').slice(1).join('=');
const S = path.resolve(arg('scratch'));
const ARMS = (arg('arms') || 'A,B,C').split(',');
const W = 6; // quota index weight on output + thinking, as #7518: an ASSUMPTION (list-price ratio), not a measured rate
const draw = JSON.parse(fs.readFileSync(path.join(HERE, 'draw.json'), 'utf8'));
const jsonl = (f) => (fs.existsSync(f) ? fs.readFileSync(f, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)) : []);

const ocrFile = path.join(S, 'ocr.json');
let ocr = fs.existsSync(ocrFile) ? JSON.parse(fs.readFileSync(ocrFile, 'utf8')) : null;
if (!ocr) {
  const { MongoClient } = await import('mongodb');
  const c = new MongoClient(process.env.MONGODB_URI); await c.connect();
  const ids = draw.books.flatMap((b) => b.block.map((p) => p.page_id));
  const rows = await c.db('bookstore').collection('pages').find({ id: { $in: ids } }, { projection: { id: 1, book_id: 1, page_number: 1, 'ocr.data': 1 } }).toArray();
  await c.close();
  ocr = {};
  for (const r of rows) (ocr[r.book_id] ||= {})[r.page_number] = r.ocr?.data ?? '';
  fs.writeFileSync(ocrFile, JSON.stringify(ocr));
}
const pageOf = new Map(draw.books.flatMap((b) => b.block.map((p) => [`${b.book_id}:${p.page_number}`, p.page_id])));
const readText = (arm, id) => { const f = path.join(S, arm, `${id}.txt`); return fs.existsSync(f) ? fs.readFileSync(f, 'utf8') : ''; };

const out = { generated_at: new Date().toISOString(), floor_7503: { rate: 0.0458, breaks: 13937, books: 138, note: 'the Han guard on this lane at 1/call, measured 2026-10-29 21:25Z (#5600)' }, weight_output: W, arms: {} };
for (const arm of ARMS) {
  const dir = path.join(S, arm);
  const calls = jsonl(path.join(dir, 'calls.jsonl'));
  const metas = fs.readdirSync(dir).filter((f) => f.endsWith('.meta.json')).map((f) => JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')));
  const rows = [];
  const t = { input: 0, output: 0, thinking: 0, cache_read: 0 };
  const add = (u) => { for (const k of Object.keys(t)) t[k] += Number(u?.[k] || 0); };
  let nCalls = 0, refused = 0, alone = 0, filtered = 0;
  if (calls.length) {
    for (const c of calls) {
      nCalls++; add(c.usage);
      if (c.cls) refused++;
      if (/-2$/.test(c.call_id) || /-3$/.test(c.call_id)) alone++;
      const raw = fs.existsSync(path.join(dir, 'raw', `${c.call_id}.txt`)) ? fs.readFileSync(path.join(dir, 'raw', `${c.call_id}.txt`), 'utf8') : '';
      if (/blocked by Gemini's filters/i.test(raw)) filtered++;
      if (c.cls || c.pages.length < 2) continue;
      const texts = splitBlockReply(raw, c.pages);
      if (!texts) continue;
      for (const n of c.pages.slice(0, -1)) {
        const r = detectBlockDrift({ ocrPrev: ocr[c.book_id][n], ocrNext: ocr[c.book_id][n + 1], trPrev: texts.get(n), trNext: texts.get(n + 1), caseless: true });
        rows.push({ book: c.book_id, break: `${n}→${n + 1}`, call: c.call_id, flagged: !!r.drift, shift: r.shift == null ? null : +r.shift.toFixed(3) });
      }
    }
  } else {
    for (const m of metas) { nCalls += m.attempts || 1; if ((m.attempts || 1) > 1) refused += m.attempts - 1; add(m.call_usage); }
    for (const b of draw.books) for (const p of b.block.slice(0, -1)) {
      const n = p.page_number;
      const r = detectBlockDrift({ ocrPrev: ocr[b.book_id][n], ocrNext: ocr[b.book_id][n + 1], trPrev: readText(arm, pageOf.get(`${b.book_id}:${n}`)), trNext: readText(arm, pageOf.get(`${b.book_id}:${n + 1}`)), caseless: true });
      rows.push({ book: b.book_id, break: `${n}→${n + 1}`, flagged: !!r.drift, shift: r.shift == null ? null : +r.shift.toFixed(3) });
    }
  }
  // Final texts (what the lane would apply): the same test over every break of every block, after the re-reads.
  const finalRows = [];
  for (const b of draw.books) for (const p of b.block.slice(0, -1)) {
    const n = p.page_number;
    const r = detectBlockDrift({ ocrPrev: ocr[b.book_id][n], ocrNext: ocr[b.book_id][n + 1], trPrev: readText(arm, pageOf.get(`${b.book_id}:${n}`)), trNext: readText(arm, pageOf.get(`${b.book_id}:${n + 1}`)), caseless: true });
    finalRows.push({ book: b.book_id, break: `${n}→${n + 1}`, flagged: !!r.drift });
  }
  const pages = metas.length;
  const k = rows.filter((r) => r.flagged).length;
  // One-sided binomial: P(X >= k | n, floor).
  const p0 = out.floor_7503.rate, n = rows.length;
  let tail = 0; for (let i = k; i <= n; i++) { let c = 1; for (let j = 0; j < i; j++) c = (c * (n - j)) / (j + 1); tail += c * p0 ** i * (1 - p0) ** (n - i); }
  out.arms[arm] = {
    pages, ok: metas.filter((m) => m.exit === 0).length, calls: nCalls, calls_per_page: +(nCalls / pages).toFixed(3), refused_calls: refused, gemini_filter_refusals: filtered, pages_reread_alone: alone,
    call_sizes: calls.length ? calls.reduce((s, c) => ({ ...s, [c.pages.length]: (s[c.pages.length] || 0) + 1 }), {}) : { 1: nCalls },
    per_page: Object.fromEntries(Object.entries(t).map(([kk, v]) => [kk, Math.round(v / pages)])),
    quota_index: Math.round((t.input + W * (t.output + t.thinking)) / pages), quota_index_uncached: Math.round((t.input - t.cache_read + W * (t.output + t.thinking)) / pages),
    guard: { breaks: n, flagged: k, rate: n ? +(k / n).toFixed(4) : null, p_at_least_k_under_floor: n ? +tail.toFixed(3) : null, kind: calls.length ? 'in-block breaks the guard saw in production' : 'every break, read as if a block (1/call cannot move text: floor)', flags: rows.filter((r) => r.flagged) },
    final_texts: { breaks: finalRows.length, flagged: finalRows.filter((r) => r.flagged).length, flags: finalRows.filter((r) => r.flagged) },
  };
}
const base = out.arms[ARMS[0]];
for (const a of ARMS) { out.arms[a].quota_rel_A = +(out.arms[a].quota_index / base.quota_index).toFixed(3); out.arms[a].quota_rel_A_uncached = +(out.arms[a].quota_index_uncached / base.quota_index_uncached).toFixed(3); out.arms[a].calls_rel_A = +(out.arms[a].calls_per_page / base.calls_per_page).toFixed(3); }
fs.writeFileSync(path.join(S, 'drift.json'), JSON.stringify(out, null, 1));
console.log(JSON.stringify(out, (kk, v) => (kk === 'flags' ? (v.length ? v.map((r) => `${r.book.slice(-6)} ${r.break}${r.shift != null ? ` s${r.shift}` : ''}`) : undefined) : v), 1));
