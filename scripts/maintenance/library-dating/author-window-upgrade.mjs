#!/usr/bin/env node
/**
 * Upgrade bare model work dates to the author's dated window, library-wide (#6721, Derek 2026-10-15: "author lifespan,
 * no problem. a range is fine"). The lean writer (write-dates.mjs --lean) used the window only where the model's
 * estimate lay INSIDE it. Here, for every book whose work date is still basis model_knowledge and whose `author_id`
 * has a dated window (Wikidata P569/P570…, else BDRC: authorWindowOf()):
 *   keep    — the estimate's window lies inside the author's window and is narrower: the model was more precise
 *   replace — the estimate is wider than the window, or overlaps it with its year outside: the window replaces it
 *   check   — the estimate lies wholly outside the window. Usually `author_id` is a translator, editor or commentator
 *             (#6721: 641 of 3,791 on the first run), so a model is asked what the person is to the TEXT
 *             (date-books.mjs --lean role); only "author" at high confidence replaces (medium let through wrong-person author_ids: Xenophon of Ephesus
 *             carrying Xenophon of Athens's dates), at confidence medium.
 * Authors whose window ends before 600 CE are left out (traditional dates). The window is capped at the edition year (lifespanWork()); a window that starts after the edition is not used.
 * Human-edited rows are skipped; every write is logged to sweep_log first; `published` is never touched.
 *
 *   plan  <dir> --wikidata wikidata-cache.json --bdrc bdrc-cache.json  → plan.jsonl, role-queue.jsonl (READ-ONLY)
 *   (model) date-books.mjs <dir>/role-queue.jsonl <dir>/roles.jsonl --engine claude --model sonnet --lean role
 *   write <dir> <run_id> [--dry-run]
 *
 * PRIOR ART: write-dates.mjs --lean (the inside-the-window rule, and the author_window/model_work meta fields this
 * keeps); scripts/maintenance/qa-author-date-anachronisms.mjs flags author/date contradictions on `published`, not
 * work dates; tibetan-work-dates.mjs (Tibetan works, BDRC persons named in colophons).
 *
 *   node --env-file=/root/sourcelibrary/.env.production.local scripts/maintenance/library-dating/author-window-upgrade.mjs <step> <dir> …
 */
import fs from 'node:fs';
import path from 'node:path';
import { MongoClient, ObjectId } from 'mongodb';
import { recordSweepActions } from '../../lib/sweep-log.mjs';
import { authorWindowOf, lifespanWork } from '../../lib/date-works.mjs';

const [STEP, DIR, RUN_ID] = process.argv.slice(2, 5);
const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
if (!STEP || !DIR) { console.error('usage: author-window-upgrade.mjs plan|write <dir> …'); process.exit(2); }
const F = (n) => path.join(DIR, n);
const readRows = (f) => fs.existsSync(f) ? fs.readFileSync(f, 'utf8').split('\n').filter(Boolean).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean) : [];
const fmtYear = (y) => (y < 0 ? `${-y} BCE` : String(y));
const fmtSpan = (a, b) => (a === b ? fmtYear(a) : a < 0 && b < 0 ? `${-a}–${-b} BCE` : `${fmtYear(a)}–${fmtYear(b)}`);

const c = new MongoClient(process.env.MONGODB_URI); await c.connect();
const db = c.db(process.env.MONGODB_DB || 'bookstore');

/** keep | replace | check, for a model estimate `w` against an author's window `aw`. */
export function classify(w, aw) {
  if (w.to < aw.from || w.from > aw.to) return 'check';
  const inside = w.from >= aw.from && w.to <= aw.to;
  if (inside && w.year >= aw.from && w.year <= aw.to) return 'keep';
  return 'replace';
}

if (STEP === 'plan') {
  const wd = JSON.parse(fs.readFileSync(arg('--wikidata'), 'utf8'));
  const bd = arg('--bdrc') ? JSON.parse(fs.readFileSync(arg('--bdrc'), 'utf8')) : null;
  const names = new Map((await db.collection('authors').find({}, { projection: { canonical_name: 1 } }).toArray()).map((a) => [a._id, a.canonical_name]));
  const rows = await db.collection('books').find({ 'source_work_dates_meta.work.basis': 'model_knowledge', 'source_work_dates_meta.edited_by': { $exists: false },
    pages_count: { $gt: 0 }, author_id: { $exists: true, $nin: [null, ''] } },
  { projection: { id: 1, title: 1, display_title: 1, language: 1, author_id: 1, 'source_work_dates_meta.work': 1, 'source_work_dates_meta.edition': 1 } }).toArray();
  const out = []; const queue = []; const tally = { no_window: 0, keep: 0, replace: 0, check: 0, after_edition: 0 };
  for (const b of rows) {
    const aw = authorWindowOf(b, wd, bd); if (!aw) { tally.no_window++; continue; }
    const w = b.source_work_dates_meta.work; const ed = b.source_work_dates_meta.edition;
    const cls = classify(w, aw); tally[cls]++;
    if (cls === 'keep') continue;
    const lsw = lifespanWork(aw, ed?.year ?? null); if (!lsw) { tally.after_edition++; continue; }
    const id = String(b.id || b._id);
    const person = `${names.get(b.author_id) || b.author_id} (${aw.how === 'lifespan' ? `${fmtSpan(aw.from - 15, aw.to)}` : fmtSpan(aw.from, aw.to)})`;
    out.push(JSON.stringify({ book_id: id, _oid: String(b._id), cls, author_id: b.author_id, aw, lsw, work: w }));
    if (cls === 'check') queue.push(JSON.stringify({ book_id: id, original_title: b.title || null, title: b.display_title || null, language: b.language || null, person }));
  }
  fs.writeFileSync(F('plan.jsonl'), out.join('\n') + '\n'); fs.writeFileSync(F('role-queue.jsonl'), queue.join('\n') + '\n');
  console.log(JSON.stringify({ model_rows_with_author_id: rows.length, ...tally, to_write_now: out.length - queue.length, to_check: queue.length }));
  await c.close(); process.exit(0);
}

if (STEP === 'write') {
  if (!RUN_ID) { console.error('write needs a run_id'); process.exit(2); }
  const DRY = process.argv.includes('--dry-run');
  const roles = new Map(readRows(F('roles.jsonl')).map((r) => [r.book_id, r]));
  // an ancient author's "lifespan" is often the tradition's (Aesop 604–563 BCE, Homer 885–701 BCE, King David): before
  // 600 CE the model's scholarly estimate stays
  const todo = readRows(F('plan.jsonl')).filter((p) => p.aw.to >= 600).filter((p) => p.cls === 'replace' || (roles.get(p.book_id)?.role === 'author' && roles.get(p.book_id)?.confidence === 'high'));
  const books = db.collection('books'); const stats = { written: 0, human: 0, changed_since_plan: 0, roles_not_author: [...roles.values()].filter((r) => r.role !== 'author').length }; const sample = [];
  for (let i = 0; i < todo.length; i += 300) {
    const batch = todo.slice(i, i + 300);
    // by _id, as planned (16K books carry a re-minted _id beside their `id`; book-deletion-and-identity.md)
    const live = await books.find({ _id: { $in: batch.map((t) => (/^[0-9a-f]{24}$/i.test(t._oid) ? new ObjectId(t._oid) : t._oid)) } }, { projection: { id: 1, source_work_dates: 1, source_work_dates_meta: 1 } }).toArray();
    const byId = new Map(live.map((x) => [String(x._id), x]));
    const go = [];
    for (const t of batch) {
      const cur = byId.get(t._oid); if (!cur) { stats.changed_since_plan++; continue; }
      const meta = cur.source_work_dates_meta || {};
      if (meta.edited_by) { stats.human++; continue; }
      // the plan was made from this row: anything else wrote it since, leave it
      if (meta.work?.basis !== 'model_knowledge' || JSON.stringify(meta.work) !== JSON.stringify(t.work)) { stats.changed_since_plan++; continue; }
      const w = t.lsw; const rule = t.cls === 'replace' ? 'author_window_narrower' : 'author_window_role_checked';
      const layer = { type: 'composition', date: String(w.year), date_display: w.display, date_precision: w.to - w.from <= 10 ? 'decade' : w.to - w.from <= 150 ? 'century' : 'millennium', basis: w.basis, evidence: w.evidence };
      const layers = [layer, ...(cur.source_work_dates || []).filter((l) => !['composition', 'compilation'].includes(l.type))];
      const checks = (meta.checks || []).filter((x) => x !== 'outside_author_window');
      const newMeta = { ...meta, work: w, model_work: meta.work, author_window: t.aw, confidence: t.cls === 'replace' ? (meta.confidence === 'low' ? 'medium' : 'high') : 'medium',
        work_update: { run_id: RUN_ID, rule, at: new Date(), previous_work: meta.work, previous_confidence: meta.confidence ?? null, ...(roles.get(t.book_id) ? { author_role: roles.get(t.book_id).role } : {}) } };
      if (checks.length) newMeta.checks = checks; else delete newMeta.checks;
      go.push({ t, cur, set: { source_work_dates: layers, source_work_dates_meta: newMeta } });
    }
    if (DRY) { for (const g of go) if (sample.length < 40) sample.push({ book_id: g.t.book_id, rule: g.set.source_work_dates_meta.work_update.rule, before: g.t.work.display, after: g.t.lsw.display, evidence: g.t.lsw.evidence }); stats.written += go.length; continue; }
    if (!go.length) continue;
    await recordSweepActions(db, go.map(({ t, cur }) => ({ sweep: 'library-dating', book_id: t.book_id, action: 'date-work',
      detail: { run_id: RUN_ID, rule: t.cls, previous: { source_work_dates: cur.source_work_dates ?? null, source_work_dates_meta: cur.source_work_dates_meta ?? null } } })));
    const res = await books.bulkWrite(go.map(({ cur, set }) => ({ updateOne: { filter: { _id: cur._id, 'source_work_dates_meta.edited_by': { $exists: false } }, update: { $set: set } } })), { ordered: false });
    stats.written += res.modifiedCount;
    console.log(`  ${i + batch.length}/${todo.length}: ${JSON.stringify(stats)}`);
  }
  if (DRY) fs.writeFileSync(F('dry-run-sample.json'), JSON.stringify(sample, null, 1));
  console.log(`done ${JSON.stringify(stats)}${DRY ? ' (dry run)' : ''}`);
  await c.close(); process.exit(0);
}
console.error(`unknown step ${STEP}`); process.exit(2);
