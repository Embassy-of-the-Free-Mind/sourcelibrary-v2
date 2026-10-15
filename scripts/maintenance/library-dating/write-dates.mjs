#!/usr/bin/env node
/**
 * Write work and edition dates to `books` (#6721): `source_work_dates` (the layers, each with nested `basis` +
 * `evidence`) and `source_work_dates_meta` (schema 2). NEVER `published`: a placeholder or a contradiction goes in
 * `catalogue_note` only. No new top-level field.
 *
 * Inputs: plan.json (plan.mjs: clusters, representatives, rule editions) and one or more dated JSONL files
 * (date-books.mjs). Per book:
 *   work    — the cluster representative's dated work (members inherit it; `work.from_book` names the representative)
 *   edition — first of: the rule's title_page (catalogue year printed on the leaves) > the model's VERIFIED title_page
 *             > the rule's catalogue year > the model's edition. `edition.rule` says which rule fired.
 *   confidence — the representative's; with a second family (--check <dated.jsonl>), agreement within each other's
 *             windows keeps it, a disagreement beyond 50 years or a different century makes it 'low' and is
 *             recorded in `agree_with` (amendment 2).
 *
 * Every write is logged first: recordSweepAction(sweep 'library-dating', action 'date', detail.previous) — and a
 * resumed run still writes a book it already logged: the skip test is the book's own stored value (this run's
 * `run_id` AND the same dates), never the log. A book a human has dated (`source_work_dates_meta.edited_by`, re-read LIVE) is skipped.
 * Batches of 500. `--dry-run` writes nothing and prints the first batch's before/after to <dir>/dry-run-diff.json.
 *
 * LEAN ROUTE (`--lean`, #6721 2026-10-15): <plan.json> from `plan.mjs --lean`, <dated.jsonl> = lean WORK rows
 * (date-books.mjs --lean work), `--editions <f>` = lean EDITION rows, `--earlier <f>` = an earlier run's full rows
 * (its editions are reused; its work date only where no lean or sourced one exists). Per book:
 *   work    — the lean model's (else the earlier run's); where the cluster's Wikidata work item (`wikidata_work`)
 *             agrees with it (agreesWith), the item's date, basis wikidata, and the model's kept as `model_work`; where
 *             it disagrees, the model's, flagged `wikidata_disagrees`. The author's Wikidata window is recorded as
 *             `author_window`, flagged `outside_author_window` when the date lies outside it (usually a translator or
 *             editor in author_id, or a pseudepigraphon: informational, confidence unchanged). Where the lean and the
 *             earlier run's years differ by more than 50, the one inside the author's window wins if only one is,
 *             else the lean one; either way at confidence low, the other recorded in `agree_with`.
 *   edition — rule title_page > lean model title_page > rule catalogue (year or window) > lean model > the
 *             representative's (same catalogue string) > the earlier run's own
 * A row the earlier run (`--earlier-run`) already wrote is REWRITTEN only when the work date is now sourced (basis
 * wikidata), or the lean model's year is more than 50 years from the stored one; each rewrite records `rewrote` in the meta and the
 * sweep_log detail. Every other earlier row is left as it is.
 *
 * PRIOR ART: scripts/_archived/2026-09-unmetered/enrichment/enrich-source-work-dates.mjs wrote source_work_dates with
 * no basis per date and no sweep log; scripts/lib/sweep-log.mjs (recordSweepActions) is used as is.
 *
 *   node --env-file=/root/sourcelibrary/.env.production.local scripts/maintenance/library-dating/write-dates.mjs \
 *     <plan.json> <run_id> <dated.jsonl>[,more.jsonl] [--check other-family.jsonl] [--dry-run] [--max-batches N] [--only ids.txt]
 *     [--lean --editions ed.jsonl --earlier run1.jsonl --earlier-run library-dating-2026-10-14b]
 */
import fs from 'node:fs';
import path from 'node:path';
import { MongoClient, ObjectId } from 'mongodb';
import { recordSweepActions } from '../../lib/sweep-log.mjs';
import { toStoredLayers, toMeta, fitWindow, LEAN_PROMPT_VERSION, agreesWith } from '../../lib/date-works.mjs';

const [PLAN, RUN_ID, DATED] = process.argv.slice(2, 5);
const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const DRY = process.argv.includes('--dry-run'); const MAX_BATCHES = +arg('--max-batches', 0); const CHECK = arg('--check'); const ONLY = arg('--only');
if (!PLAN || !RUN_ID || !DATED) { console.error('usage: write-dates.mjs <plan.json> <run_id> <dated.jsonl[,more]> [--check f] [--dry-run] [--max-batches N] [--only ids]'); process.exit(2); }
const BATCH = 500; const SWEEP = 'library-dating';
const LEAN = process.argv.includes('--lean'); const EARLIER_RUN = arg('--earlier-run', 'library-dating-2026-10-14b');

const readRows = (f) => fs.existsSync(f) ? fs.readFileSync(f, 'utf8').split('\n').filter(Boolean).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean) : [];
const dated = new Map(); for (const f of DATED.split(',')) for (const r of readRows(f)) dated.set(r.book_id, r);
const check = new Map(); if (CHECK) for (const r of readRows(CHECK)) check.set(r.book_id, r);
const only = ONLY ? new Set(fs.readFileSync(ONLY, 'utf8').split('\n').map((s) => s.trim()).filter(Boolean)) : null;
const plan = JSON.parse(fs.readFileSync(PLAN, 'utf8'));
const editions = new Map(); if (arg('--editions')) for (const f of arg('--editions').split(',')) for (const r of readRows(f)) editions.set(r.book_id, r);
const earlier = new Map(); if (arg('--earlier')) for (const f of arg('--earlier').split(',')) for (const r of readRows(f)) earlier.set(r.book_id, r);

const century = (y) => Math.floor((y - (y > 0 ? 1 : 0)) / 100);
/** Two families agree when each one's year lies in the other's window, or they are within 50 years and the same century. */
export function agreement(a, b) {
  if (!a || !b || a.year == null || b.year == null) return null;
  const inside = a.year >= b.from && a.year <= b.to && b.year >= a.from && b.year <= a.to;
  const close = Math.abs(a.year - b.year) <= 50 && century(a.year) === century(b.year);
  return inside || close;
}

function bookUpdate(member, rep, repRow, ownRow) {
  const work = fitWindow({ ...repRow.work, ...(member.book_id !== rep ? { from_book: rep } : {}) });
  // a volume of the representative's set (same catalogue date string, plan.mjs) shares its edition date
  const modelEd = ownRow?.edition || (member.edition_from_rep && repRow.edition ? { ...repRow.edition, from_book: rep } : null);
  const re = member.rule_edition;
  const edition = re?.basis === 'title_page' ? re
    : modelEd?.basis === 'title_page' ? modelEd
      : re || modelEd;
  if (!edition) return null;
  fitWindow(edition);
  let confidence = repRow.confidence;
  let agree_with = null;
  const other = check.get(rep);
  if (other && other.model !== repRow.model) {
    const ok = agreement(repRow.work, other.work);
    agree_with = { model: other.model, work: { year: other.work.year, from: other.work.from, to: other.work.to }, agrees: ok };
    if (ok === false) confidence = 'low';
  }
  // an edition made before its work was written means one of the two is wrong: keep both, flag the row
  const checks = [];
  if (edition.to != null && work.from != null && edition.to < work.from) { checks.push('edition_before_work'); confidence = 'low'; }
  const r = { work, edition, layers: repRow.layers, catalogue_note: (ownRow || (member.book_id === rep ? repRow : null))?.catalogue_note || '', confidence, reasoning: repRow.reasoning };
  // the edition layer is THIS book's edition, whatever the representative's reply said
  const layers = toStoredLayers({ ...r, layers: [...(repRow.layers || []).filter((l) => l?.type !== 'edition'), { type: 'edition', year: edition.year, date_display: edition.display || String(edition.year), precision: 'exact' }] });
  const meta = toMeta(r, { model: repRow.model, run_id: RUN_ID, dated_at: repRow.dated_at });
  if (repRow.prompt_version) meta.prompt_version = repRow.prompt_version;
  meta.family = /^claude|sonnet|haiku|opus/i.test(repRow.model) ? 'claude' : /gemini/i.test(repRow.model) ? 'gemini' : 'other';
  if (agree_with) meta.agree_with = agree_with;
  if (checks.length) meta.checks = checks;
  if (ownRow && ownRow !== repRow) meta.edition_model = ownRow.model;
  return { source_work_dates: layers, source_work_dates_meta: meta };
}

const PREC = (w) => (w.from === w.to ? 'exact' : w.to - w.from <= 10 ? 'decade' : w.to - w.from <= 150 ? 'century' : 'millennium');
const familyOf = (model) => (model === 'wikidata' ? 'wikidata' : /^claude|sonnet|haiku|opus/i.test(model) ? 'claude' : /gemini/i.test(model) ? 'gemini' : 'other');
/** The lean route's update for one member (see the header), or null when it has no edition date. */
function bookUpdateLean(member, c, repMember) {
  const lw = dated.get(c.rep); const er = earlier.get(c.rep);
  let w; const checks = []; const extra = {};
  if (lw) w = { work: { ...lw.work }, model: lw.model, prompt_version: lw.prompt_version || LEAN_PROMPT_VERSION, dated_at: lw.dated_at, confidence: lw.confidence };
  else if (er) w = { work: { ...er.work }, model: er.model, prompt_version: er.prompt_version, dated_at: er.dated_at, confidence: er.confidence, layers: er.layers, earlier: true };
  else return null;
  if (lw && c.wikidata_work) {
    if (agreesWith(c.wikidata_work, lw.work)) { extra.model_work = lw.work; w.work = { ...c.wikidata_work }; w.confidence = 'high'; }
    else { checks.push('wikidata_disagrees'); extra.wikidata_work = c.wikidata_work; }
  }
  let keptEarlier = false;
  if (lw && er && Math.abs(lw.work.year - er.work.year) > 50 && w.work.basis !== 'wikidata') {
    // two estimates a lifetime apart: the author's Wikidata window breaks the tie when exactly one lies inside it
    // (Boehme's Theosophia revelata: earlier c. 1600–1624 inside 1590–1624, lean 1730 outside → the earlier stays)
    const inside = (x) => c.author_window && x.year >= c.author_window.from && x.year <= c.author_window.to;
    if (inside(er.work) && !inside(lw.work)) {
      keptEarlier = true;
      w = { work: { ...er.work }, model: er.model, prompt_version: er.prompt_version, dated_at: er.dated_at, confidence: 'low', layers: er.layers, earlier: true };
      extra.agree_with = { model: lw.model, work: { year: lw.work.year, from: lw.work.from, to: lw.work.to }, agrees: false };
    } else {
      w.confidence = 'low'; extra.agree_with = { model: er.model, work: { year: er.work.year, from: er.work.from, to: er.work.to }, agrees: false };
    }
  }
  if (c.author_window) {
    extra.author_window = c.author_window;
    if (w.work.year < c.author_window.from || w.work.year > c.author_window.to) checks.push('outside_author_window');
  }
  if (member.book_id !== c.rep && !w.work.from_book) w.work.from_book = c.rep;
  fitWindow(w.work);
  const re = member.rule_edition; const le = editions.get(member.book_id)?.edition; const own = earlier.get(member.book_id);
  const repEd = member.edition_from_rep || (member.book_id !== c.rep && !re && !le)
    ? (repMember?.rule_edition || editions.get(c.rep)?.edition || er?.edition) : null;
  const edition = re?.basis === 'title_page' ? re : le?.basis === 'title_page' ? le : re || le
    || (repEd ? { ...repEd, from_book: c.rep } : null) || own?.edition || null;
  if (!edition) return null;
  fitWindow(edition);
  let confidence = w.confidence;
  if (edition.to != null && w.work.from != null && edition.to < w.work.from) { checks.push('edition_before_work'); confidence = 'low'; }
  const layers = toStoredLayers({ work: w.work, edition, layers: [
    ...(w.layers || [{ type: 'composition', year: w.work.year, date_display: w.work.display, precision: PREC(w.work) }]).filter((l) => l?.type !== 'edition'),
    { type: 'edition', year: edition.year, date_display: edition.display || String(edition.year), precision: PREC(edition) }] });
  const note = (own || (member.book_id === c.rep ? er : null))?.catalogue_note || '';
  const meta = toMeta({ work: w.work, edition, catalogue_note: note, confidence, reasoning: w.earlier ? (er?.reasoning || '') : '' }, { model: w.model, run_id: RUN_ID, dated_at: w.dated_at });
  meta.prompt_version = w.prompt_version; meta.family = familyOf(w.model);
  const edModel = le && edition === le ? editions.get(member.book_id).model : null;
  if (edModel) meta.edition_model = edModel;
  Object.assign(meta, extra);
  if (checks.length) meta.checks = checks;
  return { source_work_dates: layers, source_work_dates_meta: meta, _lean: { sourced: w.work.basis === 'wikidata', lean_year: lw && !keptEarlier ? lw.work.year : null } };
}

// #3307: 1,445 undated EAP Tibetan manuscripts keep an import placeholder `year: 1700` (their `published` is already
// unset, so the model never sees it). Say so in the note; `year` itself is not this writer's to change.
export function placeholderNote(d) {
  const pub = d.published == null || String(d.published).trim() === '' ? null : String(d.published).trim();
  if (Number(d.year) === 1700 && (pub === null || pub === '1700') && /tibet|dzongkha/i.test(String(d.language || ''))) {
    return 'The catalogue year 1700 is an import placeholder, not a date: the source record gives none (#3307).';
  }
  return null;
}

const idFilter = (id) => (/^[0-9a-f]{24}$/i.test(id) ? { $or: [{ id }, { _id: new ObjectId(id) }] } : { $or: [{ id }, { _id: id }] });

// build the write list
const todo = []; const skipped = { no_work_row: 0, no_edition: 0 };
if (LEAN) for (const c of plan) {
  const repMember = c.members.find((m) => m.book_id === c.rep);
  for (const m of c.members) {
    if (only && !only.has(m.book_id)) continue;
    const u = bookUpdateLean(m, c, repMember);
    if (!u) { skipped[dated.get(c.rep) || earlier.get(c.rep) ? 'no_edition' : 'no_work_row']++; continue; }
    todo.push({ book_id: m.book_id, set: u });
  }
}
if (!LEAN) for (const c of plan) {
  const repRow = dated.get(c.rep);
  if (!repRow) { skipped.no_work_row += c.members.length; continue; }
  for (const m of c.members) {
    if (only && !only.has(m.book_id)) continue;
    const u = bookUpdate(m, c.rep, repRow, m.book_id === c.rep ? repRow : dated.get(m.book_id));
    if (!u) { skipped.no_edition++; continue; }
    todo.push({ book_id: m.book_id, set: u });
  }
}
console.log(`${todo.length} books ready to write (run ${RUN_ID}); not ready: ${JSON.stringify(skipped)}${DRY ? ' — DRY RUN' : ''}`);

const client = new MongoClient(process.env.MONGODB_URI); await client.connect();
const db = client.db(process.env.MONGODB_DB || 'bookstore');
const booksOf = (d) => d.collection('books');
const stats = { written: 0, already: 0, human: 0, missing: 0, kept_earlier: 0, rewrote_sourced: 0, rewrote_disagree: 0 }; const diffs = [];
for (let i = 0, nb = 0; i < todo.length && (!MAX_BATCHES || nb < MAX_BATCHES); i += BATCH, nb++) {
  const batch = todo.slice(i, i + BATCH);
  const live = await booksOf(db).find({ $or: batch.flatMap((t) => idFilter(t.book_id).$or) }, { projection: { id: 1, source_work_dates: 1, source_work_dates_meta: 1, published: 1, year: 1, language: 1 } }).toArray();
  const byId = new Map(); for (const d of live) { byId.set(String(d._id), d); if (d.id) byId.set(String(d.id), d); }
  const go = [];
  for (const t of batch) {
    const d = byId.get(t.book_id);
    if (!d) { stats.missing++; continue; }
    if (d.source_work_dates_meta?.edited_by) { stats.human++; continue; }
    // already written by this run AND unchanged: skip. A row this run wrote that the code would now write differently
    // (a fix landed mid-run) is rewritten, and logged again.
    const same = (a, b) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
    if (d.source_work_dates_meta?.run_id === RUN_ID && same(d.source_work_dates_meta.work, t.set.source_work_dates_meta.work)
      && same(d.source_work_dates_meta.edition, t.set.source_work_dates_meta.edition) && same(d.source_work_dates, t.set.source_work_dates)
      && d.source_work_dates_meta.confidence === t.set.source_work_dates_meta.confidence) { stats.already++; continue; }
    // the lean route rewrites a row an earlier run wrote only for a sourced date or a disagreement beyond 50 years
    const { _lean: lean, ...set } = t.set; t.set = set;
    if (lean && d.source_work_dates_meta?.run_id === EARLIER_RUN) {
      const old = d.source_work_dates_meta.work?.year;
      const reason = lean.sourced ? 'sourced' : lean.lean_year != null && old != null && Math.abs(lean.lean_year - old) > 50 ? 'lean_disagrees' : null;
      if (!reason) { stats.kept_earlier++; continue; }
      stats[reason === 'sourced' ? 'rewrote_sourced' : 'rewrote_disagree']++;
      t.set.source_work_dates_meta.rewrote = { from_run: EARLIER_RUN, reason, previous_work: d.source_work_dates_meta.work ?? null };
    }
    const pn = placeholderNote(d);
    if (pn && !t.set.source_work_dates_meta.catalogue_note.includes('#3307')) {
      t.set.source_work_dates_meta.catalogue_note = [pn, t.set.source_work_dates_meta.catalogue_note].filter(Boolean).join(' ').slice(0, 400);
    }
    go.push({ t, d });
  }
  if (DRY) {
    if (nb === 0) for (const { t, d } of go) diffs.push({ book_id: t.book_id, published: d.published ?? null, before: { source_work_dates: d.source_work_dates ?? null, source_work_dates_meta: d.source_work_dates_meta ?? null }, after: t.set });
    stats.written += go.length; continue;
  }
  if (!go.length) continue;
  // log BEFORE the write; a crash between the two leaves a logged, unwritten book that the next run writes
  await recordSweepActions(db, go.map(({ t, d }) => ({ sweep: SWEEP, book_id: t.book_id, action: 'date',
    detail: { run_id: RUN_ID, ...(t.set.source_work_dates_meta.rewrote ? { rewrote: t.set.source_work_dates_meta.rewrote.reason } : {}), previous: { source_work_dates: d.source_work_dates ?? null, source_work_dates_meta: d.source_work_dates_meta ?? null } } })));
  const res = await booksOf(db).bulkWrite(go.map(({ t, d }) => ({ updateOne: {
    filter: { _id: d._id, 'source_work_dates_meta.edited_by': { $exists: false } },
    update: { $set: { source_work_dates: t.set.source_work_dates, source_work_dates_meta: t.set.source_work_dates_meta } } } })), { ordered: false });
  stats.written += res.modifiedCount;
  console.log(`  batch ${nb + 1}: ${res.modifiedCount}/${go.length} written; totals ${JSON.stringify(stats)}`);
}
if (DRY) { const f = path.join(path.dirname(PLAN), 'dry-run-diff.json'); fs.writeFileSync(f, JSON.stringify(diffs, null, 1)); console.log(`dry-run diff of the first batch (${diffs.length} books) → ${f}`); }
await client.close();
console.log(`done ${JSON.stringify(stats)}`);
