#!/usr/bin/env node
// PRIOR ART: scripts/audit/hidden-meta-scan.mjs — its evidence()/classify() are the rule and its
// moveContinuityPayload() the transform; this is the writer it deliberately left out (it is
// measurement only). hetzner:/root/repair-t3-t12-5354/repair-t3-t12.mjs (#5148) — the shape of
// the write (revision first, update filtered on the text just read, Supabase dual-write) is
// copied from it; it unwraps by a length rule that cannot tell this page's text from the previous
// page's, which is exactly the hazard this writer avoids by re-running the scan's classifier.
/**
 * move-hidden-meta-own-text — put a page's own text back in the visible translation (#5376 tq11).
 *
 * On ~10,160 live pages the translator wrote the page's own opening lines (sometimes the whole
 * page) after `<meta>continues from previous page:` and every reader surface strips <meta>, so
 * the reader meets a blank or truncated page. Class `own-text` in the scan. The repair is $0:
 * the payload moves out of the meta into the body, word for word, behind a bare marker.
 *
 * Every candidate is RE-CLASSIFIED on the live page (and its live previous page) immediately
 * before its write, with the scan's own rule — the candidate list only nominates. A page is
 * written only when:
 *   - the live class is still `own-text`, with inBody ≤ 0.3 (dry-run.md: a payload the body
 *     already opens with would be shown twice);
 *   - the live payload has the word count the classification saw (it is the same text);
 *   - no person edited the translation (source 'manual' or edited_by), the page is not hidden,
 *     the book is not HELD, and #5148 did not already unwrap it;
 *   - the update matches the exact translation text read a moment earlier (a concurrent writer wins).
 * Before each write: a `sweep_log` row, then a `page_revisions` snapshot with reason
 * `hidden-meta-move-5376` (no snapshot → no write). The engine block, model and prompt fields stay
 * — it is the model's own text, moved; `content_hash` is recomputed; page `updated_at` is bumped
 * (the Supabase page_translations embedding resync keys on it). No new field on the page.
 *
 * ROLLBACK: every page_revisions row with reason `hidden-meta-move-5376` holds the text before.
 *
 *   node --env-file=.env.production.local scripts/maintenance/move-hidden-meta-own-text.mjs [--limit=N]
 *        [--pilot=20] [--apply] [--candidates=…/move-candidates.jsonl] [--out=scripts/output/hidden-meta-move]
 *   Dry run by default. --pilot=N: one page from each of N books, seeded, stratified by severity.
 *   Resumable: <out>/checkpoint.jsonl records every page decided under --apply; a restart skips them.
 */
import fs from 'fs';
import path from 'path';
import { evidence, classify, moveContinuityPayload, severity } from '../audit/hidden-meta-scan.mjs';
import { continuityMeta, hidesPageInMeta } from '../lib/hidden-translation.mjs';
import { contentHash } from '../lib/write-provenance.mjs';

export const SWEEP = 'hidden-meta-move-5376';
export const REASON = 'hidden-meta-move-5376';
export const MAX_IN_BODY = 0.3;
const PLAN_DIR = 'scripts/eval/results/hidden-meta-repair-plan-2026-10-01';
// The six copied-previous pages #5148 opened (the hazard posted on #5148, 2026-10-01): never touched.
export const HAZARD = new Set(['69b62fd91c1c21a3737fb4fb:124', '69b658e118b87551bfcf6dd5:15', '69e533e0d48480a38696480e:31',
  '69e8b18b2ff2a8dc09e76378:26', '69e8b2ac2ff2a8dc09e7883c:29', '6a08527949638a50931ba781:134']);

const words = (s) => String(s || '').replace(/<\/?[a-zA-Z][^>]*>/g, ' ').split(/\s+/).filter(w => /\p{L}/u.test(w));

/**
 * The decision for one live page. Pure: `page` and `prev` are live `pages` docs (or null),
 * `cand` the candidate row ({ book, p, words }), `medians` the scan's language length ratios.
 * Returns { write: true, text, … } or { write: false, why }.
 */
export function planMove({ cand, page, prev, bookLang, medians, held = false }) {
  if (!page) return { write: false, why: 'page-missing' };
  if (HAZARD.has(`${cand.book}:${cand.p}`)) return { write: false, why: 'hazard-5148' };
  if (held) return { write: false, why: 'held' };
  if (page.hidden === true) return { write: false, why: 'hidden-page' };
  const t = page.translation || {};
  const tr = t.data;
  if (typeof tr !== 'string' || !tr.trim()) return { write: false, why: 'no-translation' };
  if (t.source === 'manual' || t.edited_by) return { write: false, why: 'human-edited' };
  if (t.unwrapped_by) return { write: false, why: 'unwrapped-5148' };
  const cm = continuityMeta(tr);
  if (!cm || cm.form !== 'text') return { write: false, why: 'no-payload-now' };
  if (cand.words != null && cm.words !== cand.words) return { write: false, why: 'changed-since-classification' };
  const row = { p: page.page_number, tr, ocr: page.ocr?.data || '' };
  const ev = evidence({ row, prev: prev ? { p: prev.page_number, tr: prev.translation?.data || '', ocr: prev.ocr?.data || '' } : null, bookLang });
  if (!ev || ev.form !== 'text') return { write: false, why: 'no-payload-now' };
  const cls = classify(ev, medians[ev.lang] ?? medians._all);
  if (cls !== 'own-text') return { write: false, why: `class-now:${cls}`, ev };
  if ((ev.inBody ?? 0) > MAX_IN_BODY) return { write: false, why: 'in-body', ev };
  const out = moveContinuityPayload(tr);
  if (!out.changed) return { write: false, why: 'no-change' };
  // The move adds a marker and whitespace and drops the label; it never loses a word of the payload.
  const before = words(tr.replace(cm.raw, ' ')).length + cm.words;
  const after = words(out.text.replace(/<meta>continues from previous page<\/meta>/, ' ')).length;
  if (after < before) return { write: false, why: 'assert-words' };
  if (hidesPageInMeta(out.text) || continuityMeta(out.text)?.form !== 'bare') return { write: false, why: 'assert-bare' };
  return { write: true, text: out.text, before_hash: contentHash(tr), after_hash: contentHash(out.text), cls, sev: severity(ev), share: ev.share, inBody: ev.inBody ?? 0, words: cm.words, ev };
}

/** N candidates from N different books, seeded, round-robin over severity. */
export function pickPilot(cands, n, seed = 5376) {
  let s = seed; const rnd = () => { s = (s * 1664525 + 1013904223) % 4294967296; return s / 4294967296; };
  const bySev = new Map();
  for (const c of cands) (bySev.get(c.sev) || bySev.set(c.sev, []).get(c.sev)).push(c);
  const pools = [...bySev.keys()].sort().map(k => [...bySev.get(k)]);
  const picks = [], books = new Set();
  for (let i = 0; picks.length < n && pools.some(p => p.length); i++) {
    const pool = pools[i % pools.length];
    while (pool.length) {
      const c = pool.splice(Math.floor(rnd() * pool.length), 1)[0];
      if (!books.has(c.book)) { books.add(c.book); picks.push(c); break; }
    }
  }
  return picks;
}

const arg = (k, d) => process.argv.find(a => a.startsWith(`--${k}=`))?.split('=').slice(1).join('=') ?? d;
const flag = (k) => process.argv.includes(`--${k}`);

async function main() {
  const APPLY = flag('apply');
  const LIMIT = Number(arg('limit', 0)) || Infinity;
  const PILOT = Number(arg('pilot', 0));
  const outDir = arg('out', 'scripts/output/hidden-meta-move');
  const candFile = arg('candidates', path.join(PLAN_DIR, 'move-candidates.jsonl'));
  const medians = JSON.parse(fs.readFileSync(path.join(PLAN_DIR, 'summary.json'), 'utf8')).lengthMedians;
  fs.mkdirSync(outDir, { recursive: true });
  const ckFile = path.join(outDir, 'checkpoint.jsonl');
  const done = new Set();
  if (fs.existsSync(ckFile)) for (const l of fs.readFileSync(ckFile, 'utf8').split('\n')) { if (!l) continue; try { const r = JSON.parse(l); done.add(`${r.book}:${r.p}`); } catch { /* torn tail */ } }

  let cands = fs.readFileSync(candFile, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l)).filter(c => !done.has(`${c.book}:${c.p}`));
  if (PILOT) cands = pickPilot(cands, PILOT);

  const { MongoClient } = await import('mongodb');
  const { saveRevisionBeforeOverwrite } = await import('../lib/page-revisions.mjs');
  const { recordSweepAction } = await import('../lib/sweep-log.mjs');
  const { isHeld } = await import('../lib/pipeline-hold.mjs');
  const { syncPageUpdate } = await import('../workers/lib/supabase-page-writer.mjs');
  const client = new MongoClient(process.env.MONGODB_URI); await client.connect();
  const db = client.db(process.env.MONGODB_DB || 'bookstore');
  const pages = db.collection('pages');
  const books = new Map();
  const bookOf = async (id) => {
    if (!books.has(id)) books.set(id, await db.collection('books').findOne({ id }, { projection: { id: 1, language: 1, pipeline_auto: 1 } }));
    return books.get(id);
  };

  const runFile = path.join(outDir, `${APPLY ? 'applied' : 'dryrun'}-${new Date().toISOString().replace(/[:.]/g, '-')}.jsonl`);
  const tally = { apply: APPLY, candidates: cands.length, written: 0, eligible: 0, skipped: {} };
  const skip = (why) => { tally.skipped[why] = (tally.skipped[why] || 0) + 1; };
  const record = (r) => { fs.appendFileSync(runFile, JSON.stringify(r) + '\n'); if (APPLY) fs.appendFileSync(ckFile, JSON.stringify(r) + '\n'); };
  const proj = { id: 1, book_id: 1, page_number: 1, hidden: 1, page_type: 1, 'ocr.data': 1, translation: 1 };
  let seen = 0;

  for (const c of cands) {
    if (tally.written >= LIMIT || (!APPLY && tally.eligible >= LIMIT)) break;
    if (++seen % 500 === 0) console.log(`${seen}/${cands.length} ${JSON.stringify(tally)}`);
    const docs = await pages.find({ book_id: c.book, page_number: { $in: [c.p - 1, c.p] } }, { projection: proj, maxTimeMS: 60000 }).toArray();
    const here = docs.filter(d => d.page_number === c.p), before = docs.filter(d => d.page_number === c.p - 1);
    if (here.length > 1) { skip('ambiguous-page'); record({ book: c.book, p: c.p, why: 'ambiguous-page' }); continue; }
    const page = here[0] || null;
    const book = await bookOf(c.book);
    const plan = planMove({ cand: c, page, prev: before.length === 1 ? before[0] : null, bookLang: book?.language || 'unknown', medians, held: book ? isHeld(book) : false });
    const base = { book: c.book, p: c.p, page_id: page?.id ?? null };
    if (!plan.write) { skip(plan.why); record({ ...base, why: plan.why }); continue; }
    tally.eligible++;
    const row = { ...base, sev: plan.sev, words: plan.words, share: plan.share, inBody: plan.inBody, before_hash: plan.before_hash, after_hash: plan.after_hash };
    if (!APPLY) { record({ ...row, why: 'eligible' }); continue; }

    const tr = page.translation.data;
    await recordSweepAction(db, { sweep: SWEEP, book_id: c.book, action: 'move-continuity-payload', detail: { page_id: page.id, page_number: c.p, before_hash: plan.before_hash, after_hash: plan.after_hash, words: plan.words } });
    const saved = await saveRevisionBeforeOverwrite(db, page.id, 'translation', { jobId: SWEEP, reason: REASON, keepMeta: true });
    if (!saved) { skip('revision-failed'); record({ ...row, why: 'revision-failed' }); continue; }
    const now = new Date();
    const set = { 'translation.data': plan.text, 'translation.content_hash': plan.after_hash, updated_at: now };
    const res = await pages.updateOne({ id: page.id, 'translation.data': tr, 'translation.source': { $ne: 'manual' }, 'translation.edited_by': { $in: [null, ''] } }, { $set: set });
    if (res.modifiedCount !== 1) {
      skip('raced');
      await recordSweepAction(db, { sweep: SWEEP, book_id: c.book, action: 'move-not-written', detail: { page_id: page.id, page_number: c.p, why: 'raced' } });
      record({ ...row, why: 'raced' });
      continue;
    }
    syncPageUpdate(page.id, { 'translation.data': plan.text, updated_at: now });
    tally.written++;
    record({ ...row, why: 'written' });
  }
  if (APPLY) await new Promise(r => setTimeout(r, 5000)); // let the fire-and-forget Supabase writes drain
  await client.close();
  tally.file = runFile;
  console.log(JSON.stringify(tally, null, 1));
}

if (import.meta.url === `file://${process.argv[1]}`) await main();
