#!/usr/bin/env node
// PRIOR ART: lean.mjs (the nightly runner) — its tight windows (enWindow/srcWindow), the content-conservation guard
// (lostWords), the Gemini single-join call (gemini-repair.mjs geminiPack/agyOpen), placement (seam-repair.mjs
// edgeRefusal) and the write (writeRepairs: writePageTranslation, manifest, undo) are imported unchanged. lean.mjs walks
// stored joins in readership order at night; this checks the one or two joins a translation write has just made.
// The Sonnet fallback (#7118) sends opus-reference's single-join itemPrompt through lib.mjs claudeCall (sealed claude -p),
// and reads the weekly meter with lean.mjs claudeUsage({ pull: false }).
/**
 * The write-time seam guard (#6742, job seam-prevent). OFF unless SEAM_GUARD is set:
 *
 *   SEAM_GUARD=dry     check the joins, log what would be written, write nothing
 *   SEAM_GUARD=apply   write an accepted repair through writePageTranslation, label seam-repair-6742
 *   SEAM_GUARD=off     off for this process, whatever the box file says
 *   /etc/sourcelibrary/seam-guard   the box-wide mode (`dry` or `apply`) when SEAM_GUARD is unset (translate-core
 *                      SEAM_GUARD_FILE): one switch for every lane that writes translations on the box
 *   SEAM_GUARD_OUT     the guard's log + manifest dir (default /mnt/HC_Volume_105839809/seam-guard-6742)
 *   SEAM_GUARD_CLAUDE_DAILY      joins the Sonnet fallback may check per UTC day, box-wide (default 1500)
 *   SEAM_GUARD_MAX_WEEKLY        no Claude call when the box account's weekly meter is at or over this % (default 50)
 *
 * translate-core's writePageTranslation calls runSeamGuard() after a translation is committed. For the page just written
 * it checks the join BEFORE it (the previous page) and the join AFTER it (the next page), when the neighbour holds an
 * eligible machine translation that is not marked stale (a stale page is about to be rewritten, and its join is checked
 * then, as that write's "before" join). Each join gets lean.mjs's single-join repair (Gemini 3.8 Flash low via agy,
 * tight windows); a repair is accepted when it places at the edge and loses ≤ 3 content words. There is no per-join Opus
 * check: the nightly runner's 7% sample measured 95.5% preferred, and every guard repair goes to SEAM_GUARD_OUT's
 * manifest so a later blind sample can audit it.
 *
 * When agy is locked or answers with a quota reply (#7118: locked for days at a time), the join goes to Sonnet instead:
 * the same single-join prompt and windows through a sealed `claude -p`, the same placement + lostWords acceptance. Each
 * Sonnet join counts toward SEAM_GUARD_CLAUDE_DAILY (a file per UTC day in SEAM_GUARD_OUT); past the cap, or with the
 * weekly meter at SEAM_GUARD_MAX_WEEKLY or unknown, the join is skipped and the skip recorded. Every proposal (a join
 * labelled defective, placed or not) goes to proposals.jsonl with its windows, so a dry run can be judged blind later
 * (`sample`). A join already checked in this process with the same two texts is not checked again (a block write of
 * pages N..M asks about each inner join twice).
 *
 * It never blocks or undoes the translation write: it runs after the commit, every error is caught, an agy lockout or a
 * quota reply skips the check (fail open), and the whole check is bounded by a timeout. A write it makes itself carries
 * note seam-repair-6742 and is never checked again.
 *
 *   node --env-file=… scripts/maintenance/seam-repair-6742/guard.mjs replay --book=ID [--since=ISO] [--limit=N]
 *     replay a translation run in dry mode: every page of the book whose translation was written since --since, in the
 *     order it was written, as if each write had just happened (a neighbour written later is not yet there).
 *   node --env-file=… scripts/maintenance/seam-repair-6742/guard.mjs sample --to=DIR [--n=60] [--since=ISO] [--arm=guard]
 *     stage a seeded sample of accepted proposals as a seam-repair out dir (candidates.jsonl + repair-<arm>.jsonl), then
 *     `seam-repair.mjs verify --out=DIR --arm=<arm>` judges them blind in both orders with A/A pairs
 *   node --env-file=… scripts/maintenance/seam-repair-6742/guard.mjs report [--since=ISO]   the guard's numbers, from the logs
 */
import fs from 'fs';
import path from 'path';
import { MongoClient } from 'mongodb';
import { joinSignals } from '../../eval/seams-6742/census.mjs';
import { LABELS, itemPrompt } from '../../eval/seams-6742/opus-reference.mjs';
import { applyRepair } from '../../eval/seams-6742/judge-repairs.mjs';
import { claudeCall, extractJson, shuffle } from '../../eval/seams-6742/lib.mjs';
import { makeRng } from '../../eval/lib/paired-stats.mjs';
import { sourceProse, translationProse } from '../../lib/block-drift.mjs';
import { STALE_FIELD } from '../../lib/stale-translation.mjs';
import { SEAM_GUARD_FILE } from '../../lib/translate-core.mjs';
import { TAG, eligible, sha, edgeRefusal, writeRepairs, usageOf } from './seam-repair.mjs';
import { enWindow, srcWindow, lostWords, MAX_LOST, claudeUsage, CLAUDE_MODEL } from './lean.mjs';
import { geminiPack, agyOpen, DEFAULT_MODEL as GEMINI } from './gemini-repair.mjs';

export const GUARD_TIMEOUT_MS = 8 * 60e3;
export const DEFAULT_OUT = '/mnt/HC_Volume_105839809/seam-guard-6742';
export const CLAUDE_DAILY = 1500, CLAUDE_MAX_WEEKLY = 50;
const MODES = ['dry', 'apply'];
const modeFromFile = (file) => { try { return fs.readFileSync(file, 'utf8').trim(); } catch { return null; } };
/** 'dry' | 'apply' | null: SEAM_GUARD when set (any other value, e.g. `off`, is off), else the box file. */
export const guardMode = (env = process.env, file = SEAM_GUARD_FILE) => { const v = env.SEAM_GUARD || modeFromFile(file); return MODES.includes(v) ? v : null; };

/** Why the Sonnet fallback may not be called now, or null. `count` = joins it has checked today (box-wide). */
export function claudeGate({ count, cap, usage, maxWeekly }) {
  if (count >= cap) return `claude-daily-cap:${cap}`;
  if (!usage) return 'claude-usage-unknown';
  if (usage.weekly >= maxWeekly) return `claude-weekly:${usage.weekly}%>=${maxWeekly}%`;
  return null;
}
/** The day's Sonnet join counter: one byte per join in SEAM_GUARD_OUT/claude-calls/<UTC date> (appends are atomic
 *  enough across the box's processes; a race overshoots the cap by a join or two). */
const counterFile = (out, d = new Date()) => path.join(out, 'claude-calls', d.toISOString().slice(0, 10));
export const claudeCountToday = (out) => { try { return fs.statSync(counterFile(out)).size; } catch { return 0; } };
const bumpClaude = (out) => { try { fs.mkdirSync(path.dirname(counterFile(out)), { recursive: true }); fs.appendFileSync(counterFile(out), '.'); } catch { /* best effort */ } };

/** The Sonnet single-join call: the agy prompt (itemPrompt), one join, sealed claude -p. Returns {byId, r} like geminiPack. */
async function sonnetOne(it) {
  const r = await claudeCall(itemPrompt(it), 'sonnet');
  const j = r.cls ? null : extractJson(r.text);
  if (j) j.id = it.id;
  return { byId: new Map(j ? [[it.id, j]] : []), r };
}

// Joins this process has already checked, by join and the two texts (a block write asks about each inner join twice).
const CHECKED = new Set();
const checkedKey = (it) => `${it.id}:${it.hashA}:${it.hashB}`;
const PROJ = { _id: 0, id: 1, book_id: 1, page_number: 1, page_type: 1, ocr: 1, translation: 1, translation_withheld: 1, [STALE_FIELD]: 1 };
const asPage = (r) => ({ id: r.id, p: r.page_number, type: r.page_type, ocr: r.ocr?.data || '', tr: r.translation.data });
const append = (f, x) => { try { fs.mkdirSync(path.dirname(f), { recursive: true }); fs.appendFileSync(f, JSON.stringify(x) + '\n'); } catch { /* the log is best effort */ } };

/** The join item lean.mjs builds, for pages ra (N) and rb (N+1); null when the join is not prose. */
export function joinItem(book, ra, rb, r0, r1) {
  const A = asPage(ra), B = asPage(rb);
  const sig = joinSignals({ A0: r0 && eligible(r0) ? asPage(r0) : null, A, B, B1: r1 && eligible(r1) ? asPage(r1) : null });
  if (sig.skipped || sig.nonProse) return null;
  const enA = translationProse(A.tr), enB = translationProse(B.tr), srcA = sourceProse(A.ocr), srcB = sourceProse(B.ocr);
  const it = { id: sha(`${book.id}:${A.p}`).slice(0, 12), book: book.id, p: A.p, idA: A.id, idB: B.id, pB: B.p, script: sig.script, lang: book.language,
    modelA: ra.translation.model, modelB: rb.translation.model, hashA: sha(A.tr), hashB: sha(B.tr) };
  it.enTailA = enWindow(enA, 'tail'); it.enHeadB = enWindow(enB, 'head');
  it.srcTailA = srcWindow(srcA, enA, it.enTailA, 'tail'); it.srcHeadB = srcWindow(srcB, enB, it.enHeadB, 'head');
  return it;
}

/** Which joins a write of `page` makes: [prev, page] and [page, next], for neighbours that are eligible, not stale and
 *  (in a replay) already written at `asOf`. */
export function joinsToCheck(rows, pageNumber, asOf = null) {
  const by = new Map(rows.map(r => [r.page_number, r]));
  const there = (r) => r && eligible(r) && !r[STALE_FIELD] && (!asOf || !r.translation.updated_at || new Date(r.translation.updated_at) <= asOf);
  const me = by.get(pageNumber), out = [];
  if (!me || !eligible(me)) return out;
  if (there(by.get(pageNumber - 1))) out.push([by.get(pageNumber - 1), me, by.get(pageNumber - 2), by.get(pageNumber + 1)]);
  if (there(by.get(pageNumber + 1))) out.push([me, by.get(pageNumber + 1), by.get(pageNumber - 1), by.get(pageNumber + 2)]);
  return out;
}

/**
 * Check the joins a write of `page` made. Returns a tally; never throws (the caller's write is already committed).
 * `mode` 'dry' | 'apply'; `asOf` (a replay) hides neighbours written after it. The model calls and the meter are
 * injectable (`geminiFn`, `agyOpenFn`, `sonnetFn`, `usageFn`) for the tests.
 */
export async function seamGuardAfterWrite(db, { page, book, mode, out = process.env.SEAM_GUARD_OUT || DEFAULT_OUT, asOf = null, env = process.env,
  usageFn = () => claudeUsage({ pull: false }), sonnetFn = sonnetOne, geminiFn = geminiPack, agyOpenFn = agyOpen }) {
  const t0 = Date.now(), log = path.join(out, 'guard.jsonl');
  const tally = { page: page?.id, mode, joins: 0, calls: 0, skipped: null, labelledOk: 0, refused: {}, accepted: 0, write: null };
  try {
    const bookId = page?.book_id || book?.id;
    if (!mode || !page?.id || !bookId) return { ...tally, skipped: 'off' };
    // the caller's book object may lack language or the hold (translate-worker's does): read the two fields fresh
    const b = book?.id && 'language' in book && 'pipeline_auto' in book ? book : await db.collection('books').findOne({ id: bookId }, { projection: { _id: 0, id: 1, language: 1, pipeline_auto: 1 } });
    if (!b || b.pipeline_auto?.hold) tally.skipped = 'book-held-or-missing';   // recorded below, as a write seen
    else {
      const pn = Number(page.page_number ?? (await db.collection('pages').findOne({ id: page.id }, { projection: { page_number: 1 } }))?.page_number);
      const rows = await db.collection('pages').find({ book_id: bookId, page_number: { $gte: pn - 2, $lte: pn + 2 } }, { projection: PROJ }).toArray();
      const all = joinsToCheck(rows, pn, asOf).map(([ra, rb, r0, r1]) => joinItem(b, ra, rb, r0, r1)).filter(Boolean);
      const items = all.filter(it => !CHECKED.has(checkedKey(it)));
      tally.joins = items.length;
      if (items.length < all.length) tally.alreadyChecked = all.length - items.length;
      const accepted = [];
      const cap = Number(env.SEAM_GUARD_CLAUDE_DAILY || CLAUDE_DAILY), maxWeekly = Number(env.SEAM_GUARD_MAX_WEEKLY || CLAUDE_MAX_WEEKLY);
      let agyShut = !agyOpenFn(GEMINI) ? 'agy-locked' : null;
      for (const it of items) {
        // Gemini while agy is open; the join a lock or a quota reply leaves goes to Sonnet, inside the cap and the meter.
        let arm = 'gemini', res = null;
        if (!agyShut) {
          res = await geminiFn([it], GEMINI);
          tally.calls += res.r.calls || 1;
          if (res.r.cls === 'quota') { agyShut = 'agy-quota'; res = null; }
        }
        if (!res) {
          const gate = claudeGate({ count: claudeCountToday(out), cap, usage: usageFn(), maxWeekly });
          if (gate) { tally.skipped = `${agyShut}+${gate}`; append(log, { at: new Date().toISOString(), mode, trigger: page.id, book: b.id, join: it.id, p: it.p, skipped: tally.skipped }); break; }
          arm = 'sonnet'; bumpClaude(out);
          res = await sonnetFn(it);
          tally.claudeCalls = (tally.claudeCalls || 0) + 1;
          // a spent account is a skip, not a check: the join stays unchecked for the next write
          if (res.r.cls === 'usage_limit') { tally.skipped = `${agyShut}+claude-usage-limit`; append(log, { at: new Date().toISOString(), mode, trigger: page.id, book: b.id, join: it.id, p: it.p, skipped: tally.skipped }); break; }
        }
        const { byId, r } = res;
        CHECKED.add(checkedKey(it)); if (CHECKED.size > 5000) CHECKED.delete(CHECKED.values().next().value);
        const model = arm === 'gemini' ? GEMINI : CLAUDE_MODEL.sonnet;
        const j = byId.get(it.id), x = j && LABELS.includes(j.label) ? j : null;
        const why = !x ? `reply-not-parsed${r.cls ? `:${r.cls}` : ''}` : x.label === 'ok' ? null : edgeRefusal(it, x.repair) || (lostWords(it, x.repair).length > MAX_LOST ? 'drops-content-words' : null);
        if (x?.label === 'ok') tally.labelledOk++;
        else if (why) tally.refused[why] = (tally.refused[why] || 0) + 1;
        else accepted.push({ id: it.id, it, x: { ...x, model }, arm, fixed: applyRepair(it, x.repair), verdict: { sampled: false, guard: true } });
        (tally.arms ||= {})[arm] = (tally.arms[arm] || 0) + 1;
        const row = { at: new Date().toISOString(), mode, arm, trigger: page.id, book: b.id, join: it.id, p: it.p, label: x?.label ?? null, labels: x?.labels ?? null, severity: x?.severity ?? null,
          refused: x?.label === 'ok' ? null : why, accepted: !why && x?.label !== 'ok', repair: x?.repair ?? null, secs: Math.round(r.secs || 0), cls: r.cls || null, ...(arm === 'sonnet' ? { usage: usageOf(r) } : {}) };
        append(log, row);
        if (x && x.label !== 'ok') append(path.join(out, 'proposals.jsonl'), { ...row, it, x: { ...x, model } });
      }
      tally.accepted = accepted.length;
      // One write per arm, so each repair carries its own repairer's provenance.
      for (const arm of [...new Set(accepted.map(a => a.arm))]) {
        const rows = accepted.filter(a => a.arm === arm), claude = arm !== 'gemini', model = claude ? CLAUDE_MODEL[arm] : GEMINI;
        const w = await writeRepairs(db, rows, { out, doApply: mode === 'apply', cli: claude ? 'claude' : 'agy', model, allowHidden: true, throwOnStop: true, callSite: `${TAG}:write-guard`,
          promptName: `seam-repair-6742 write-time guard: label+minimal edge repair (opus-reference PROMPT, tight windows, ${arm})`, sentHash: sha(`guard:${model}`),
          accepted: 'placement-checked at write time (edgeRefusal + lostWords); no per-join Opus check' });
        tally.write = tally.write ? { ...tally.write, written: tally.write.written + w.written, pagesWritten: tally.write.pagesWritten + w.pagesWritten, refused: { ...tally.write.refused, ...w.refused } } : w;
      }
    }
  } catch (e) {
    tally.error = String(e?.message || e).slice(0, 300);
  }
  tally.secs = Math.round((Date.now() - t0) / 1000);
  append(path.join(out, 'guard-writes.jsonl'), { at: new Date().toISOString(), ...tally });
  return tally;
}

/** What translate-core calls: bounded, fail-open, a no-op unless SEAM_GUARD is set, and never for the guard's own writes. */
export async function runSeamGuard(db, { page, book, note, jobId }) {
  const mode = guardMode();
  if (!mode || note === TAG || String(jobId || '').startsWith(TAG)) return null;
  let timer;
  const timeout = new Promise((res) => { timer = setTimeout(() => res({ page: page?.id, mode, skipped: 'timeout' }), GUARD_TIMEOUT_MS); });
  try { return await Promise.race([seamGuardAfterWrite(db, { page, book, mode }), timeout]); } catch (e) { return { error: String(e?.message || e) }; } finally { clearTimeout(timer); }
}

// ── replay: a finished translation run, page by page in write order, dry ──────
async function replay({ bookId, since, limit, out }) {
  const c = new MongoClient(process.env.MONGODB_URI); await c.connect(); const db = c.db('bookstore');
  try {
    const book = await db.collection('books').findOne({ id: bookId }, { projection: { _id: 0, id: 1, title: 1, language: 1, visible: 1, pipeline_auto: 1 } });
    const pages = await db.collection('pages').find({ book_id: bookId, 'translation.updated_at': { $gte: since } }, { projection: { _id: 0, id: 1, book_id: 1, page_number: 1, 'translation.updated_at': 1 } })
      .sort({ 'translation.updated_at': 1 }).limit(limit).toArray();
    console.log(`${book?.title?.slice(0, 80)} (${bookId}): ${pages.length} pages written since ${since.toISOString()}; dry replay → ${out}`);
    const sum = { pages: pages.length, joins: 0, calls: 0, labelledOk: 0, accepted: 0, wouldWrite: 0, wouldWritePages: 0, refused: {}, skipped: {}, errors: 0, secs: 0 };
    for (const p of pages) {
      const t = await seamGuardAfterWrite(db, { page: p, book, mode: 'dry', out, asOf: new Date(p.translation.updated_at) });
      sum.joins += t.joins; sum.calls += t.calls; sum.labelledOk += t.labelledOk; sum.accepted += t.accepted; sum.secs += t.secs; sum.claudeCalls = (sum.claudeCalls || 0) + (t.claudeCalls || 0);
      sum.wouldWrite += t.write?.written || 0; sum.wouldWritePages += t.write?.pagesWritten || 0;
      for (const [k, v] of Object.entries(t.refused)) sum.refused[k] = (sum.refused[k] || 0) + v;
      for (const [k, v] of Object.entries(t.write?.refused || {})) sum.refused[`store:${k}`] = (sum.refused[`store:${k}`] || 0) + v;
      if (t.skipped) sum.skipped[t.skipped] = (sum.skipped[t.skipped] || 0) + 1;
      if (t.error) sum.errors++;
      process.stderr.write(`p${p.page_number}: joins ${t.joins} calls ${t.calls} ok ${t.labelledOk} accepted ${t.accepted}${t.error ? ` ERROR ${t.error}` : ''} ${t.secs}s\n`);
    }
    fs.writeFileSync(path.join(out, `replay-${bookId}.json`), JSON.stringify({ book: { id: bookId, title: book?.title, language: book?.language }, since, at: new Date().toISOString(), ...sum }, null, 1) + '\n');
    console.log(JSON.stringify(sum, null, 1));
  } finally { await c.close(); }
}

// ── sample / report: the dry run's audit, from the logs ──────────────────────
const readJsonl = (f) => fs.existsSync(f) ? fs.readFileSync(f, 'utf8').split('\n').filter(Boolean).map(l => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean) : [];
/** Stage a seeded sample of accepted proposals as a seam-repair out dir; `seam-repair.mjs verify --out=TO --arm=ARM`
 *  then judges each repair blind in both orders, with A/A pairs. One proposal per join (the latest). */
export function stageSample({ out = DEFAULT_OUT, to, n = 60, since = null, arm = 'guard', seed = 7118 }) {
  const latest = new Map();
  for (const p of readJsonl(path.join(out, 'proposals.jsonl'))) if (p.accepted && (!since || new Date(p.at) >= since)) latest.set(p.join, p);
  const pick = shuffle([...latest.values()], makeRng(seed)).slice(0, n);
  fs.mkdirSync(to, { recursive: true });
  fs.writeFileSync(path.join(to, 'candidates.jsonl'), pick.map(p => JSON.stringify({ join: true, ...p.it })).join('\n') + '\n');
  fs.writeFileSync(path.join(to, `repair-${arm}.jsonl`), pick.map(p => JSON.stringify({ id: p.it.id, parsed: true, ...p.x, guardArm: p.arm })).join('\n') + '\n');
  return { accepted: latest.size, sampled: pick.length, byArm: pick.reduce((a, p) => { a[p.arm] = (a[p.arm] || 0) + 1; return a; }, {}) };
}
/** The guard's numbers since `since`: writes seen, joins checked, share defective, accepted, arm split, Claude calls a day. */
export function guardReport({ out = DEFAULT_OUT, since = null }) {
  const keep = (r) => !since || new Date(r.at) >= since;
  const writes = readJsonl(path.join(out, 'guard-writes.jsonl')).filter(keep), joins = readJsonl(path.join(out, 'guard.jsonl')).filter(keep);
  const judged = joins.filter(j => !j.skipped), labelled = judged.filter(j => j.label);
  const count = (xs, f) => xs.reduce((a, x) => { const k = f(x); if (k != null) a[k] = (a[k] || 0) + 1; return a; }, {});
  const byDay = count(judged.filter(j => j.arm === 'sonnet'), j => j.at.slice(0, 10));
  const usd = judged.filter(j => j.arm === 'sonnet').reduce((a, j) => a + (j.usage?.list_usd || 0), 0);
  return { since: since?.toISOString() ?? null, writesSeen: writes.length, writesByMode: count(writes, w => w.mode), writeSkips: count(writes, w => w.skipped), errors: writes.filter(w => w.error).length,
    joinsChecked: judged.length, labelled: labelled.length, notParsed: judged.length - labelled.length, defective: labelled.filter(j => j.label !== 'ok').length,
    shareDefective: labelled.length ? +(labelled.filter(j => j.label !== 'ok').length / labelled.length).toFixed(3) : null,
    majors: labelled.filter(j => j.severity === 'major').length, labels: count(labelled, j => j.label), accepted: judged.filter(j => j.accepted).length,
    refused: count(judged.filter(j => j.refused), j => j.refused), arms: count(judged, j => j.arm), joinSkips: count(joins.filter(j => j.skipped), j => j.skipped),
    sonnetJoinsByDay: byDay, sonnetListUsd: +usd.toFixed(2), wouldWrite: writes.reduce((a, w) => a + (w.write?.written || 0), 0), wouldWritePages: writes.reduce((a, w) => a + (w.write?.pagesWritten || 0), 0) };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const arg = (k, d) => process.argv.find(a => a.startsWith(`--${k}=`))?.split('=').slice(1).join('=') ?? d;
  const cmd = process.argv[2], since = arg('since') ? new Date(arg('since')) : null, out = arg('out', process.env.SEAM_GUARD_OUT || DEFAULT_OUT);
  if (cmd === 'sample' && arg('to')) console.log(JSON.stringify(stageSample({ out, to: arg('to'), n: Number(arg('n', 60)), since, arm: arg('arm', 'guard') }), null, 1));
  else if (cmd === 'report') console.log(JSON.stringify(guardReport({ out, since }), null, 1));
  else if (cmd === 'replay' && arg('book')) replay({ bookId: arg('book'), since: since || new Date(Date.now() - 3 * 86400e3), limit: Number(arg('limit', 200)), out })
    .catch(e => { console.error(e); process.exit(1); });
  else { console.error('usage: guard.mjs replay --book=ID [--since=ISO] [--limit=N] [--out=DIR] | sample --to=DIR [--n=60] [--since=ISO] | report [--since=ISO]'); process.exit(2); }
}
