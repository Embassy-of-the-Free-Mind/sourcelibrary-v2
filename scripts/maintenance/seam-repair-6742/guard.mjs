#!/usr/bin/env node
// PRIOR ART: lean.mjs (the nightly runner) — its tight windows (enWindow/srcWindow), the content-conservation guard
// (lostWords), the Gemini single-join call (gemini-repair.mjs geminiPack/agyOpen), placement (seam-repair.mjs
// edgeRefusal) and the write (writeRepairs: writePageTranslation, manifest, undo) are imported unchanged. lean.mjs walks
// stored joins in readership order at night; this checks the one or two joins a translation write has just made.
/**
 * The write-time seam guard (#6742, job seam-prevent). OFF unless SEAM_GUARD is set:
 *
 *   SEAM_GUARD=dry     check the joins, log what would be written, write nothing
 *   SEAM_GUARD=apply   write an accepted repair through writePageTranslation, label seam-repair-6742
 *   SEAM_GUARD_OUT     the guard's log + manifest dir (default /mnt/HC_Volume_105839809/seam-guard-6742)
 *
 * translate-core's writePageTranslation calls runSeamGuard() after a translation is committed. For the page just written
 * it checks the join BEFORE it (the previous page) and the join AFTER it (the next page), when the neighbour holds an
 * eligible machine translation that is not marked stale (a stale page is about to be rewritten, and its join is checked
 * then, as that write's "before" join). Each join gets lean.mjs's single-join repair (Gemini 3.8 Flash low via agy,
 * tight windows); a repair is accepted when it places at the edge and loses ≤ 3 content words. There is no per-join Opus
 * check: the nightly runner's 7% sample measured 95.5% preferred, and every guard repair goes to SEAM_GUARD_OUT's
 * manifest so a later blind sample can audit it.
 *
 * It never blocks or undoes the translation write: it runs after the commit, every error is caught, an agy lockout or a
 * quota reply skips the check (fail open), and the whole check is bounded by a timeout. A write it makes itself carries
 * note seam-repair-6742 and is never checked again.
 *
 *   node --env-file=… scripts/maintenance/seam-repair-6742/guard.mjs replay --book=ID [--since=ISO] [--limit=N]
 *     replay a translation run in dry mode: every page of the book whose translation was written since --since, in the
 *     order it was written, as if each write had just happened (a neighbour written later is not yet there).
 */
import fs from 'fs';
import path from 'path';
import { MongoClient } from 'mongodb';
import { joinSignals } from '../../eval/seams-6742/census.mjs';
import { LABELS } from '../../eval/seams-6742/opus-reference.mjs';
import { applyRepair } from '../../eval/seams-6742/judge-repairs.mjs';
import { sourceProse, translationProse } from '../../lib/block-drift.mjs';
import { STALE_FIELD } from '../../lib/stale-translation.mjs';
import { TAG, eligible, sha, edgeRefusal, writeRepairs } from './seam-repair.mjs';
import { enWindow, srcWindow, lostWords, MAX_LOST } from './lean.mjs';
import { geminiPack, agyOpen, DEFAULT_MODEL as GEMINI } from './gemini-repair.mjs';

export const GUARD_TIMEOUT_MS = 8 * 60e3;
export const DEFAULT_OUT = '/mnt/HC_Volume_105839809/seam-guard-6742';
export const guardMode = (env = process.env) => (['dry', 'apply'].includes(env.SEAM_GUARD) ? env.SEAM_GUARD : null);
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
 * `mode` 'dry' | 'apply'; `asOf` (a replay) hides neighbours written after it; `rowsOverride` supplies the page rows.
 */
export async function seamGuardAfterWrite(db, { page, book, mode, out = process.env.SEAM_GUARD_OUT || DEFAULT_OUT, asOf = null }) {
  const t0 = Date.now(), log = path.join(out, 'guard.jsonl');
  const tally = { page: page?.id, mode, joins: 0, calls: 0, skipped: null, labelledOk: 0, refused: {}, accepted: 0, write: null };
  try {
    if (!mode || !page?.id || !page.book_id) return { ...tally, skipped: 'off' };
    const b = book?.id ? book : await db.collection('books').findOne({ id: page.book_id }, { projection: { _id: 0, id: 1, language: 1, pipeline_auto: 1 } });
    if (!b || b.pipeline_auto?.hold) return { ...tally, skipped: 'book-held-or-missing' };
    const pn = Number(page.page_number ?? (await db.collection('pages').findOne({ id: page.id }, { projection: { page_number: 1 } }))?.page_number);
    const rows = await db.collection('pages').find({ book_id: page.book_id, page_number: { $gte: pn - 2, $lte: pn + 2 } }, { projection: PROJ }).toArray();
    const items = joinsToCheck(rows, pn, asOf).map(([ra, rb, r0, r1]) => joinItem(b, ra, rb, r0, r1)).filter(Boolean);
    tally.joins = items.length;
    const accepted = [];
    for (const it of items) {
      if (!agyOpen(GEMINI)) { tally.skipped = 'agy-locked'; break; }
      const { byId, r } = await geminiPack([it], GEMINI);
      tally.calls += r.calls || 1;
      if (r.cls === 'quota') { tally.skipped = 'agy-quota'; break; }
      const j = byId.get(it.id), x = j && LABELS.includes(j.label) ? j : null;
      const why = !x ? `reply-not-parsed${r.cls ? `:${r.cls}` : ''}` : x.label === 'ok' ? null : edgeRefusal(it, x.repair) || (lostWords(it, x.repair).length > MAX_LOST ? 'drops-content-words' : null);
      if (x?.label === 'ok') tally.labelledOk++;
      else if (why) tally.refused[why] = (tally.refused[why] || 0) + 1;
      else accepted.push({ id: it.id, it, x: { ...x, model: GEMINI }, arm: 'guard', fixed: applyRepair(it, x.repair), verdict: { sampled: false, guard: true } });
      append(log, { at: new Date().toISOString(), mode, trigger: page.id, book: b.id, join: it.id, p: it.p, label: x?.label ?? null, severity: x?.severity ?? null, refused: x?.label === 'ok' ? null : why, accepted: !why && x?.label !== 'ok', repair: x?.repair ?? null, secs: Math.round(r.secs || 0), cls: r.cls || null });
    }
    tally.accepted = accepted.length;
    if (accepted.length) {
      tally.write = await writeRepairs(db, accepted, { out, doApply: mode === 'apply', cli: 'agy', model: GEMINI, allowHidden: true, throwOnStop: true, callSite: `${TAG}:write-guard`,
        promptName: 'seam-repair-6742 write-time guard: label+minimal edge repair (opus-reference PROMPT, tight windows, gemini)', sentHash: sha('guard:' + GEMINI),
        accepted: 'placement-checked at write time (edgeRefusal + lostWords); no per-join Opus check' });
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
      sum.joins += t.joins; sum.calls += t.calls; sum.labelledOk += t.labelledOk; sum.accepted += t.accepted; sum.secs += t.secs;
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

if (import.meta.url === `file://${process.argv[1]}`) {
  const arg = (k, d) => process.argv.find(a => a.startsWith(`--${k}=`))?.split('=').slice(1).join('=') ?? d;
  if (process.argv[2] !== 'replay' || !arg('book')) { console.error('usage: guard.mjs replay --book=ID [--since=ISO] [--limit=N] [--out=DIR]'); process.exit(2); }
  replay({ bookId: arg('book'), since: new Date(arg('since', new Date(Date.now() - 3 * 86400e3).toISOString())), limit: Number(arg('limit', 200)), out: arg('out', DEFAULT_OUT) })
    .catch(e => { console.error(e); process.exit(1); });
}
