#!/usr/bin/env node
// PRIOR ART: seam-repair.mjs (#6756, the $0 Opus pilot) — eligible/bookLive/TRANCHE, the packed repair prompt,
// edgeRefusal placement, the blind both-orders judge (pairText + JUDGE), writeRepairs (writePageTranslation, manifest,
// undo) are imported unchanged. The pilot drew ONE join per random book with 1,500-char excerpts and verified EVERY
// repair; this walks the most-read books first, takes every tranche join, sends tight windows, packs 30 joins per Opus
// call, routes the two mechanical signals to rules.mjs when Test A trusts them, and verifies a 7% blind sample.
// Readership: the analytics_pageviews instrument of scripts/batch/ocr-convergence/driver.mjs `frame` (distinct
// ip-days per book, 60 days, human-filtered at write), copied (it is not exported). The weekly-usage guard reads the
// climits poll the way scripts/workers/spare-lane.py account_limits() does.
/**
 * lean — the efficient seam repair runner (#6742). Gemini via agy, Claude via the claude CLI; no paid API.
 *
 *   N="node --env-file=/root/sourcelibrary/.env.production.local"; S=scripts/maintenance/seam-repair-6742/lean.mjs
 *   $N $S candidates --out=DIR [--max-joins=2000] [--days=60]   most-read books first; every tranche join, until N are
 *                    pending (drawn, not yet repaired); Mongo reads
 *                    [--all-joins --top-books=N] every prose join of the N most-read books, not only the rule tranche
 *                    [--per-book=K] a seeded sample of K joins per book; [--skip-manifest=F,...] other runs' writes
 *   $N $S run        --out=DIR [--max-joins=N] [--repairer=gemini|opus|sonnet] [--pack=1|30] [--conc=4] [--verify-rate=0.07]
 *                    [--max-weekly=60] [--fallback=sonnet|opus|none] [--majors-wide] [--apply]   dry run (no writes) unless --apply;
 *                    --fallback (default sonnet): when agy is locked, the joins Gemini did not reach go to that Claude
 *                    arm, 30 per call, instead of the pool waiting out the lock (#7118); --majors-wide (off by default):
 *                    a major the edge bound refuses is placed under MAJORS_WIDE, and EVERY such repair goes to the
 *                    blind Opus judge and is written only if preferred in both orders (#7118)
 *   $N $S night      --out=DIR --max-joins=N [--all-joins --top-books=N] [--apply]   candidates (topped up to N pending)
 *                    + run: the cron entry
 *   $N $S write      --out=DIR --run=ID [--apply]                re-plan / write a finished run's placed repairs, no model call
 *   $N $S report     --out=DIR
 *   $N seam-repair.mjs undo --out=DIR [--apply]                 the pilot's undo reads this DIR's manifest.jsonl
 *
 * A night: (1) stop at once if the box's account is over --max-weekly % of its week, or the poll is stale/unknown;
 * (2) tier 1 — joins whose signal Test A trusts get the rule repair, no model; (3) tier 2 — the rest go to the
 * repairer (Gemini 3.8 Flash low via agy, one join per call; or Opus, 30 per call) with tight windows: the last ~2
 * English sentences of N, the first ~2 of N+1, and the matching share of each source; (4) placement (edgeRefusal, and
 * lostWords: no more than 3 content words may vanish from the join; a join whose only defect is drift is skipped,
 * DRIFT_ONLY);
 * (5) a seeded 7% sample of placed repairs (≥ 20) goes to the blind Opus judge in both orders, with 2 A/A pairs. If
 * fewer than 90% of the sample are preferred in both orders, NOTHING is written and the run ends with a DECISION
 * line; (6) otherwise every placed repair not judged worse is written through writePageTranslation (source label
 * seam-repair-6742), with the manifest that seam-repair.mjs `undo` reads.
 */
import fs from 'fs';
import path from 'path';
import { spawnSync } from 'node:child_process';
import { MongoClient } from 'mongodb';
import { joinSignals } from '../../eval/seams-6742/census.mjs';
import { PROMPT, LABELS, validRepair } from '../../eval/seams-6742/opus-reference.mjs';
import { JUDGE, applyRepair } from '../../eval/seams-6742/judge-repairs.mjs';
import { claudeCall, extractJson, pool, shuffle } from '../../eval/seams-6742/lib.mjs';
import { makeRng } from '../../eval/lib/paired-stats.mjs';
import { sourceProse, translationProse } from '../../lib/block-drift.mjs';
import { TAG, TRANCHE, eligible, bookLive, sha, edgeRefusal, pairText, PACK_HEAD, joinText, packs, usageOf, writeRepairs } from './seam-repair.mjs';
import { RULES } from './rules.mjs';
import { geminiPack, agyOpen, DEFAULT_MODEL as GEMINI } from './gemini-repair.mjs';

const arg = (k, d) => process.argv.find(a => a.startsWith(`--${k}=`))?.split('=').slice(1).join('=') ?? d;
const readJsonl = (f) => fs.existsSync(f) ? fs.readFileSync(f, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l)) : [];
const append = (f, x) => fs.appendFileSync(f, JSON.stringify(x) + '\n');
const HERE = path.dirname(new URL(import.meta.url).pathname);
const REPO = path.resolve(HERE, '../../..');

/** Signals whose rule repair Test A trusts (≥ 95% equivalent to Opus, ≤ 2% edits on Opus-ok joins). 2026-10-16: none —
 *  catchwordEcho 84/108 = 78%, 8% on ok joins; dup8 9/15 = 60% (scripts/eval/results/seam-lean-6742/rules-vs-opus.json). */
export const TRUSTED_RULES = [];
export const VERIFY_RATE = 0.07, VERIFY_MIN = 20, PREFER_FLOOR = 0.90, MAX_WEEKLY = 60;
export const OPUS_PACK = 30;

/**
 * Content conservation at the join: a seam repair moves words across the turn, removes one copy of a doubled run, or
 * adds missing words — it never makes source content disappear. Content words (≥ 4 letters) the repair removes and
 * that appear nowhere in the repaired join are LOST; more than MAX_LOST refuses the repair. Without it, the 2026-10-16
 * smoke run placed a Gemini repair deleting a whole title page head (Fludd, "SECOND TREATISE … 1624") and one replacing
 * a dedication with "[This page is blank.]"; a 7% sample cannot be relied on to catch those.
 */
export const MAX_LOST = 3;

/**
 * --majors-wide (#7118, off by default). Putting a missing sentence back, or taking out a doubled clause rendered in
 * other words, is usually bigger than the edge bound: on seam-tiers-7118's 1,000-join Sonnet dry run placement refused
 * 120 of 183 majors. For a join labelled severity "major" that the edge bound or lostWords refuses, this bound is tried:
 * up to 5 sentences and 200 words replaced per side, at most 2 sentences / 150 words restored, up to 24 content words
 * lost. Measured on those 120 (Part B, 2026-10-22): 56 placed, the blind Opus judge preferred 55 in both orders, 0 worse.
 * Every repair placed only under it is judged (not the 7% sample) and written only if preferred in both orders.
 * Non-majors keep EDGE_BOUND and MAX_LOST.
 */
export const MAJORS_WIDE = { maxSentences: 5, maxOldWords: 200, maxGrowWords: 150, maxGrowSentences: 2, maxLost: 24 };
export function lostWords(it, rep) {
  const fixed = applyRepair(it, rep);
  if (!fixed) return [];
  const bag = (v) => ((v.enTailA + ' ' + v.enHeadB).toLowerCase().normalize('NFKD').replace(/\p{M}/gu, '').match(/\p{L}{4,}/gu) || []);
  const after = bag(fixed), have = new Set(after), m = new Map();
  for (const w of after) m.set(w, (m.get(w) || 0) + 1);
  const lost = [];
  for (const w of bag(it)) { if (m.get(w)) m.set(w, m.get(w) - 1); else if (!have.has(w)) lost.push(w); }
  return lost;
}

/**
 * Drift (source words rendered on the wrong side of the turn) is the one defect the reader cannot see: the continuous
 * view (/book/[id]/read, #7138) runs the two pages together, so the English reads straight across whichever page holds
 * it. A join whose ONLY defect label is drift gets a repairs.jsonl row marked `skipped` and is never placed or written
 * (#7118): the edit would buy the reader nothing and still carries an edit's risk. Drift with any other label (a
 * doubled clause, a dropped sentence) is repaired as before.
 */
export const DRIFT_ONLY = 'drift-only (invisible in the continuous view)';
export function driftOnly(x) {
  if (!x || x.label === 'ok') return false;
  const ls = new Set([x.label, ...(Array.isArray(x.labels) ? x.labels : [])].filter(l => l && l !== 'ok'));
  return ls.size === 1 && ls.has('drift');
}

async function mongo() { const c = new MongoClient(process.env.MONGODB_URI); await c.connect(); return { client: c, db: c.db('bookstore') }; }

// ── the weekly-usage guard (spare-lane.py account_limits) ────────────────────
/** This box's Claude account usage: { email, weekly, session, checked_at } or null when unknown or stale. */
export function claudeUsage() {
  const LATEST = '/root/.claude-limits/latest.json';
  let latest = null;
  try { latest = JSON.parse(fs.readFileSync(LATEST, 'utf8')); if (Date.now() - Date.parse(latest.checked_at) > 15 * 60e3) latest = null; } catch { latest = null; }
  if (!latest) {
    const r = spawnSync('node', ['--env-file=/root/sourcelibrary/.env.production.local', path.join(REPO, 'scripts/workers/claude-limits-share.mjs'), 'pull'], { encoding: 'utf8', timeout: 90e3 });
    try { latest = JSON.parse(r.stdout); if (Date.now() - Date.parse(latest.checked_at) > 45 * 60e3) return null; } catch { return null; }
  }
  let email = null;
  try { email = (JSON.parse(fs.readFileSync('/root/.claude.json', 'utf8')).oauthAccount?.emailAddress || '').toLowerCase() || null; } catch { /* no login file */ }
  email ||= latest.claude_code_account;
  const acct = (latest.accounts || []).find(a => a.email === email && a.ok);
  if (!acct) return null;
  const lim = Object.fromEntries(acct.limits.filter(l => ['session:all', 'weekly_all:all'].includes(l.key)).map(l => [l.key.split(':')[0], l.percent]));
  return lim.weekly_all == null ? null : { email, weekly: lim.weekly_all, session: lim.session ?? null, checked_at: latest.checked_at };
}

// ── readership (ocr-convergence/driver.mjs frame) ────────────────────────────
async function readership(db, days) {
  const since = new Date(Date.now() - days * 86400e3);
  const views = await db.collection('analytics_pageviews').aggregate([
    { $match: { timestamp: { $gte: since }, path: /^\/book\// } },
    { $project: { slug: { $arrayElemAt: [{ $split: ['$path', '/'] }, 2] }, ip: 1, d: { $dateToString: { format: '%Y-%m-%d', date: '$timestamp' } } } },
    { $group: { _id: { s: '$slug', ip: '$ip', d: '$d' } } },
    { $group: { _id: '$_id.s', v: { $sum: 1 } } },
    { $sort: { v: -1 } }, { $limit: 20000 },
  ], { allowDiskUse: true }).toArray();
  const bySlug = new Map(views.map(r => [r._id, r.v]));
  const books = await db.collection('books').find(
    { visible: true, pages_count: { $gt: 0 }, pages_translated: { $gt: 1 }, $or: [{ slug: { $in: [...bySlug.keys()] } }, { id: { $in: [...bySlug.keys()] } }] },
    { projection: { _id: 0, id: 1, slug: 1, title: 1, language: 1, visible: 1, pages_count: 1, pipeline_auto: 1 } }).toArray();
  return books.filter(bookLive).map(b => ({ ...b, views: (bySlug.get(b.slug) || 0) + (bySlug.get(b.id) || 0) })).sort((a, b) => b.views - a.views);
}

// ── tight windows ────────────────────────────────────────────────────────────
const BOUNDARY = /(?<=[.!?。！？][»”"'’)\]]*)\s+(?=[\p{Lu}"“‘'(\[\p{Lo}])/gu;
export const WIN = { sentences: 2, minChars: 200, maxChars: 900 };
/** The last (side 'tail') or first ('head') ~2 sentences of an English page, verbatim, with "…" on the cut side. */
export function enWindow(text, side) {
  const t = text.trim();
  const cuts = [...t.matchAll(BOUNDARY)].map(m => side === 'tail' ? m.index + m[0].length : m.index);
  let w;
  if (side === 'tail') {
    let k = WIN.sentences; w = t;
    for (; k <= cuts.length; k++) { w = t.slice(cuts[cuts.length - k]); if (w.length >= WIN.minChars) break; }
    if (k > cuts.length) w = t;
    if (w.length > WIN.maxChars) w = w.slice(-WIN.maxChars);
    return w.length < t.length ? '…' + w : w;
  }
  let k = WIN.sentences; w = t;
  for (; k <= cuts.length; k++) { w = t.slice(0, cuts[k - 1]); if (w.length >= WIN.minChars) break; }
  if (k > cuts.length) w = t;
  if (w.length > WIN.maxChars) w = w.slice(0, WIN.maxChars);
  return w.length < t.length ? w + '…' : w;
}
/** The share of the source that matches an English window: same fraction of the page, ×1.3, cut at a word. */
export function srcWindow(src, en, enWin, side) {
  const s = src.trim();
  const n = Math.max(120, Math.min(1000, Math.round(enWin.length / Math.max(1, en.length) * s.length * 1.3)));
  if (n >= s.length) return s;
  if (side === 'tail') { let a = s.length - n; while (a > 0 && !/\s/.test(s[a - 1])) a--; return '…' + s.slice(a); }
  let b = n; while (b < s.length && !/\s/.test(s[b])) b++;
  return s.slice(0, b) + '…';
}

// ── candidates ───────────────────────────────────────────────────────────────
const PROJ = { _id: 0, id: 1, book_id: 1, page_number: 1, page_type: 1, 'ocr.data': 1, 'translation.data': 1, 'translation.model': 1, 'translation.source': 1,
  'translation.edited_by': 1, 'translation.edited_at': 1, translation_withheld: 1 };
const asPage = (r) => ({ id: r.id, p: r.page_number, type: r.page_type, ocr: r.ocr?.data || '', tr: r.translation.data });

/**
 * "Every join" mode (#6742 job seam-prevent): the rule tranche finds 16 of 35 Opus-defective joins on the uniform random
 * stratum, so for the most-read books every eligible prose join goes to the repairer, which labels "ok" itself (an ok
 * label is never placed). `allJoins` takes every join, `topBooks` stops after the N most-read books, `perBook` keeps a
 * seeded sample of K joins per book (a dry run's estimate), and `skipManifests` adds other runs' manifests to the joins
 * never re-proposed. Joins that fire a tranche signal keep their `fired` list; the others carry `fired: []`.
 */
export const ALL_JOINS_SEED = 6742;
/** The seeded per-book sample of join page numbers (N of each join N, N+1); the same book rank gives the same sample. */
export const perBookSample = (pageNumbers, perBook, rank) => new Set(shuffle(pageNumbers, makeRng(ALL_JOINS_SEED + rank)).slice(0, perBook));
async function candidates(out, maxJoins, days, { allJoins = false, topBooks = Infinity, perBook = Infinity, skipManifests = [] } = {}) {
  fs.mkdirSync(out, { recursive: true });
  const file = path.join(out, 'candidates.jsonl'), booksFile = path.join(out, 'books-done.jsonl');
  // Top up to maxJoins PENDING joins (drawn, not yet sent to a repairer). A book cut off at the cap is resumed.
  // A book walked in tranche mode is not done for every-join mode (the nightly dir holds both; rows before the mode
  // field are tranche walks).
  const doneBooks = new Set(readJsonl(booksFile).filter(b => b.complete && (!allJoins || b.mode === 'all-joins')).map(b => b.book));
  const have = new Set(readJsonl(file).map(c => c.id)), processed = new Set(readJsonl(path.join(out, 'repairs.jsonl')).map(r => r.id));
  let got = [...have].filter(id => !processed.has(id)).length;
  // never re-propose a join the pilot (or an earlier night, or a run named in skipManifests) already wrote
  const pilotManifest = path.join(REPO, 'scripts/eval/results/seam-repair-6742/manifest.jsonl.gz');
  const writtenJoins = new Set([...[path.join(out, 'manifest.jsonl'), ...skipManifests].flatMap(f => readJsonl(f)).filter(m => m.written).map(m => m.join),
    ...(fs.existsSync(pilotManifest) ? (await import('zlib')).gunzipSync(fs.readFileSync(pilotManifest)).toString().trim().split('\n').map(l => JSON.parse(l)).filter(m => m.written).map(m => m.join) : [])]);
  const { client, db } = await mongo();
  const books = (await readership(db, days)).slice(0, topBooks);
  fs.writeFileSync(path.join(out, 'readership.json'), JSON.stringify({ built_at: new Date().toISOString(), window_days: days, instrument: 'analytics_pageviews, distinct (ip, day) per book, human-filtered at write (ocr-convergence/driver.mjs frame)', books: books.length, top: books.slice(0, 20).map(b => ({ id: b.id, title: (b.title || '').slice(0, 80), views: b.views })) }, null, 1));
  console.log(`${books.length} live translated books with readers in ${days} days; top ${books[0]?.views} views`);
  let rank = 0;
  for (const b of books) {
    rank++;
    if (got >= maxJoins) break;
    if (doneBooks.has(b.id)) continue;
    const rows = await db.collection('pages').find({ book_id: b.id }, { projection: PROJ }).sort({ page_number: 1 }).toArray();
    const by = new Map(rows.map(r => [r.page_number, r]));
    // perBook: a seeded sample of the book's eligible joins, kept in page order
    const keep = Number.isFinite(perBook) ? perBookSample(rows.filter(r => eligible(r) && eligible(by.get(r.page_number + 1))).map(r => r.page_number), perBook, rank) : null;
    let joins = 0, tranche = 0, prose = 0, cut = false;
    for (const ra of rows) {
      if (got >= maxJoins) { cut = true; break; }
      const p = ra.page_number, rb = by.get(p + 1);
      if (!eligible(ra) || !eligible(rb)) continue;
      joins++;
      if (keep && !keep.has(p)) continue;
      const id = sha(`${b.id}:${p}`).slice(0, 12);
      if (writtenJoins.has(id) || have.has(id)) continue;
      const A = asPage(ra), B = asPage(rb), r0 = by.get(p - 1), r1 = by.get(p + 2);
      const sig = joinSignals({ A0: eligible(r0) ? asPage(r0) : null, A, B, B1: eligible(r1) ? asPage(r1) : null });
      if (sig.skipped || sig.nonProse) continue;
      prose++;
      const fired = TRANCHE.filter(k => sig[k]);
      if (!fired.length && !allJoins) continue;
      if (fired.length) tranche++;
      const enA = translationProse(A.tr), enB = translationProse(B.tr), srcA = sourceProse(A.ocr), srcB = sourceProse(B.ocr);
      const it = { id, book: b.id, title: (b.title || '').slice(0, 120), views: b.views, rank, p, idA: A.id, idB: B.id, pB: p + 1, fired, ...(allJoins ? { mode: 'all-joins' } : {}), script: sig.script, lang: b.language,
        modelA: ra.translation.model, modelB: rb.translation.model, hashA: sha(A.tr), hashB: sha(B.tr) };
      it.enTailA = enWindow(enA, 'tail'); it.enHeadB = enWindow(enB, 'head');
      it.srcTailA = srcWindow(srcA, enA, it.enTailA, 'tail'); it.srcHeadB = srcWindow(srcB, enB, it.enHeadB, 'head');
      // Rule repairs are computed here, where the full pages are in hand (dupRepair weighs page ratios); `run` uses
      // them only for the signals in TRUSTED_RULES.
      it.rules = {};
      for (const s of fired) if (RULES[s]) { const r = RULES[s]({ ...it, rawA: A.tr, rawB: B.tr, ocrA: A.ocr, ocrB: B.ocr }); it.rules[s] = r.repair ? { repair: r.repair } : { decline: r.decline }; }
      append(file, it); got++;
    }
    append(booksFile, { book: b.id, rank, views: b.views, pages: rows.length, joins, prose, tranche, mode: allJoins ? 'all-joins' : 'tranche', ...(keep ? { sampled: keep.size } : {}), complete: !cut && !keep });
    if (rank % 25 === 0) process.stderr.write(`${rank} books, ${got} joins\n`);
  }
  await client.close();
  console.log(JSON.stringify({ books: rank, joins: got }));
}

// ── run ──────────────────────────────────────────────────────────────────────
/** The Claude repairers, by arm: the same packed PROMPT through claude -p. */
export const CLAUDE_MODEL = { opus: 'claude-opus-5-5', sonnet: 'claude-sonnet-5-5' };
async function repairClaude(pk, arm) {
  const r = await claudeCall(`${PACK_HEAD}${PROMPT}\n\n${pk.map(joinText).join('\n')}`, arm);
  const arr = r.cls ? null : extractJson(r.text, '[');
  return { byId: new Map((Array.isArray(arr) ? arr : []).filter(Boolean).map(x => [x.id, x])), r };
}

/** When agy reopens, by the meter: the latest lock time, or null. */
function agyLockedUntil() {
  try { return JSON.parse(fs.readFileSync('/root/agy-quota/status.json', 'utf8')).locked_until_max || null; } catch { return null; }
}

async function run(out, o) {
  const status = (x) => { fs.writeFileSync(path.join(out, 'status.json'), JSON.stringify({ at: new Date().toISOString(), ...x }, null, 1)); return x; };
  // A night that does not start is still a night: it goes in runs.jsonl, so it cannot vanish from the record (#7118:
  // 10-19 and 10-20 left no row).
  const skip = (x) => { const row = { run: `lean-${new Date().toISOString().replace(/[-:.TZ]/g, '').slice(0, 14)}`, skipped: true, ...x }; append(path.join(out, 'runs.jsonl'), row); console.log(JSON.stringify(status(row))); };
  const u0 = claudeUsage();
  if (!u0) return skip({ stopped: 'claude usage unknown or stale: not starting' });
  if (u0.weekly >= o.maxWeekly) return skip({ stopped: `weekly ${u0.weekly}% >= ${o.maxWeekly}%: not starting`, usage: u0 });
  const runId = `lean-${new Date().toISOString().replace(/[-:.TZ]/g, '').slice(0, 14)}`;
  const repFile = path.join(out, 'repairs.jsonl'), calls = path.join(out, 'calls.jsonl'), verFile = path.join(out, 'verify.jsonl');
  const done = new Set(readJsonl(repFile).map(x => x.id));
  const todo = readJsonl(path.join(out, 'candidates.jsonl')).filter(c => !done.has(c.id)).slice(0, o.maxJoins);
  const tally = { run: runId, joins: todo.length, tier1: 0, tier2: 0, usageStart: u0 };
  console.log(`${runId}: ${todo.length} joins; weekly ${u0.weekly}%, session ${u0.session}%; repairer ${o.repairer}`);

  // tier 1: trusted rule repairs, no model
  const t2 = [];
  for (const it of todo) {
    const s = TRUSTED_RULES.find(k => it.rules?.[k]?.repair);
    if (s) { append(repFile, { id: it.id, run: runId, tier: 1, arm: `rule:${s}`, parsed: true, label: s === 'dup8' ? 'duplication' : 'catchword', repair: it.rules[s].repair, model: null }); tally.tier1++; }
    else t2.push(it);
  }
  // tier 2: the repairer, tight windows
  // With a --fallback Claude arm, a Gemini quota lock (at the start or mid-run) does not wait: the joins Gemini did not
  // reach go to the fallback in packs, under the same placement and the same blind Opus sample. Without one, the pool
  // waits out the lock as before (#7118: two nights sat 6 h in "usage limit — waiting 15 min" with Claude at 7%).
  let guardTripped = null, sinceCheck = 0, agyLock = null;
  const tier2 = async (items, arm, pack) => {
    const model = arm === 'gemini' ? GEMINI : CLAUDE_MODEL[arm];
    const fallsBack = arm === 'gemini' && o.fallback;
    const checkEvery = pack > 1 ? 3 : 20;
    return pool(packs(items, pack), o.conc, async (pk) => {
      if (guardTripped || (arm === 'gemini' && agyLock)) return { ok: true };
      if (++sinceCheck % checkEvery === 0) { const u = claudeUsage(); if (!u || u.weekly >= o.maxWeekly) { guardTripped = u ? `weekly ${u.weekly}%` : 'usage unknown'; return { ok: true }; } }
      if (arm === 'gemini' && !agyOpen(GEMINI)) { if (fallsBack) { agyLock = agyLockedUntil() || 'locked'; return { ok: true }; } return { cls: 'usage_limit' }; }
      const { byId, r } = arm === 'gemini' ? await geminiPack(pk, GEMINI) : await repairClaude(pk, arm);
      if (r.cls === 'usage_limit' || r.cls === 'quota') { if (fallsBack) { agyLock = agyLockedUntil() || `agy reply ${r.cls}`; return { ok: true }; } return { cls: 'usage_limit' }; }
      append(calls, { run: runId, stage: 'repair', arm, n: pk.length, model: r.model || model, cls: r.cls, secs: Math.round(r.secs), usage: arm === 'gemini' ? (r.usage ? { in: r.usage.input_tokens, out: r.usage.output_tokens, thinking: r.usage.thinking_tokens } : null) : usageOf(r), at: new Date().toISOString() });
      let ok = 0;
      for (const it of pk) {
        const j = byId.get(it.id), parsed = j && LABELS.includes(j.label) ? j : null;
        if (parsed) ok++;
        append(repFile, { id: it.id, run: runId, tier: 2, arm, parsed: !!parsed, ...(parsed || {}), repairCheck: parsed ? validRepair(it, parsed.repair) : null, model: r.model || model, cls: r.cls || undefined,
          ...(driftOnly(parsed) ? { skipped: DRIFT_ONLY } : {}) });
        tally.tier2++;
      }
      return { ok: ok > 0, cls: r.cls };
    }, arm === 'gemini' && !fallsBack ? { probe: async () => ({ cls: agyOpen(GEMINI) ? null : 'usage_limit' }) } : {});
  };
  await tier2(t2, o.repairer, o.pack);
  if (agyLock && !guardTripped) {
    const reached = new Set(readJsonl(repFile).filter(x => x.run === runId).map(x => x.id));
    const rest = t2.filter(it => !reached.has(it.id));
    tally.fallback = { arm: o.fallback, joins: rest.length, why: `agy locked until ${agyLock}` };
    console.log(`agy locked until ${agyLock}: ${rest.length} joins to the ${o.fallback} fallback`);
    await tier2(rest, o.fallback, OPUS_PACK);
  }
  if (guardTripped) tally.guard = `stopped mid-run: ${guardTripped}`;

  // placement
  const { placedRows, refusals } = placeRun(out, runId, { majorsWide: o.majorsWide });
  tally.placed = placedRows.length; tally.placementRefused = refusals;
  tally.skippedDriftOnly = refusals['skipped-drift-only'] || 0;
  const wideRows = placedRows.filter(r => r.wide), normalRows = placedRows.filter(r => !r.wide);

  // verification sample: seeded 7% (≥ 20) of placed repairs, both orders in different calls, + 2 A/A pairs
  const rand = makeRng(Number(runId.replace(/\D/g, '').slice(-9)));
  // the 7% sample is drawn from the repairs the edge bound placed; every --majors-wide repair is judged on top of it
  const nSample = Math.min(normalRows.length, Math.max(VERIFY_MIN, Math.ceil(normalRows.length * o.verifyRate)));
  const sample = [...shuffle(normalRows, rand).slice(0, nSample), ...wideRows];
  const mk = (r, order) => { const cur = { enTailA: r.it.enTailA, enHeadB: r.it.enHeadB };
    return { pair: `${runId}-${r.id}-${order}`, id: r.id, order, srcTailA: r.it.srcTailA, srcHeadB: r.it.srcHeadB, P: order === 'cur-first' ? cur : order === 'rep-first' ? r.fixed : cur, Q: order === 'cur-first' ? r.fixed : cur }; };
  const aa = sample.slice(0, 1).flatMap(r => ['aa-1', 'aa-2'].map(order => mk(r, order)));
  const firstOrder = shuffle([...sample.map(r => mk(r, 'cur-first')), aa[0]].filter(Boolean), rand), secondOrder = shuffle([...sample.map(r => mk(r, 'rep-first')), aa[1]].filter(Boolean), rand);
  await pool([...packs(firstOrder, 10), ...packs(secondOrder, 10)], o.conc, async (pk) => {
    const r = await claudeCall(`${JUDGE}\n\n${pk.map(pairText).join('\n\n')}\n`, 'opus');
    if (r.cls === 'usage_limit') return { cls: r.cls };
    append(calls, { run: runId, stage: 'verify', arm: 'opus-judge', n: pk.length, model: r.model, cls: r.cls, secs: Math.round(r.secs), usage: usageOf(r), at: new Date().toISOString() });
    const arr = r.cls ? null : extractJson(r.text, '[');
    const byPair = new Map((Array.isArray(arr) ? arr : []).map(v => [v?.pair, v]));
    for (const p of pk) { const v = byPair.get(p.pair); append(verFile, { run: runId, pair: p.pair, id: p.id, order: p.order, better: v?.better ?? null, note: v?.note }); }
    return { ok: byPair.size > 0, cls: r.cls };
  });
  const sv = sampleVerdicts(out, runId, new Set(wideRows.map(r => r.id)));
  const aaVerdicts = aa.length ? [sv.vs[aa[0].id]?.['aa-1'], sv.vs[aa[0].id]?.['aa-2']] : [];
  tally.verify = { sampled: sample.length - wideRows.length, ...sv.summary, aa: aaVerdicts };
  if (o.majorsWide) tally.majorsWide = { placed: wideRows.length, ...sv.wide };
  const arms = [...new Set(sample.map(r => r.arm))];
  if (arms.length > 1) tally.verify.byArm = Object.fromEntries(arms.map(a => { const ids = sample.filter(r => r.arm === a).map(r => r.id).filter(id => sv.vs[id]?.['cur-first'] && sv.vs[id]?.['rep-first']);
    return [a, { judged: ids.length, prefersBothOrders: ids.filter(id => sv.vs[id]['cur-first'] === 'Q' && sv.vs[id]['rep-first'] === 'P').length }]; }));
  if (!sv.summary.judged) {
    // Nothing to judge is not a quality verdict: name what stopped the run, and ask for no pause.
    const lock = agyLockedUntil();
    tally.stopped = `nothing judged (${tally.tier2} joins repaired, ${placedRows.length} placed) — ${guardTripped ? `Claude usage guard: ${guardTripped}` : !tally.tier2 && o.repairer === 'gemini' && !agyOpen(GEMINI) ? `agy locked until ${lock || 'unknown'}${o.fallback ? '' : ', no --fallback'}` : !placedRows.length ? 'no repair placed' : 'the Opus judge returned no verdicts'}; nothing written`;
  } else if (sv.belowFloor) {
    tally.stopped = `verification sample: ${sv.summary.prefersBothOrders}/${sv.summary.judged} preferred in both orders, below ${PREFER_FLOOR * 100}% — nothing written`;
    tally.decision = `DECISION: seam-repair lean run ${runId} stopped — the blind Opus sample preferred ${sv.summary.prefersBothOrders}/${sv.summary.judged} repairs (< ${PREFER_FLOOR * 100}%); inspect ${out}/verify.jsonl before the next night — default: keep the runner paused (#6742)`;
  } else tally.write = await writeRun(out, runId, o, placedRows, sv);
  tally.usageEnd = claudeUsage();
  const runCalls = readJsonl(calls).filter(c => c.run === runId);
  tally.calls = runCalls.reduce((a, c) => { const k = `${c.stage}:${c.arm}`; a[k] = (a[k] || 0) + 1; return a; }, {});
  tally.listUsdClaude = +runCalls.reduce((a, c) => a + (c.usage?.list_usd || 0), 0).toFixed(2);
  append(path.join(out, 'runs.jsonl'), tally);
  status(tally);
  console.log(JSON.stringify(tally, null, 1));
  if (tally.decision) {
    console.log(tally.decision);
    // a cron run has no wrapper to collect it: put it where the morning digest reads DECISION lines
    if (fs.existsSync('/root/claude-jobs')) fs.appendFileSync('/root/claude-jobs/decisions.txt', `${new Date().toISOString().slice(0, 10)} | seam-lean-6742-cron | ${tally.decision}\n`);
  }
}

/** Placement for one run's repairs: edgeRefusal + the content-conservation guard; with `majorsWide`, a major they
 *  refuse is tried under MAJORS_WIDE and placed with `wide: true`. */
export function placeRun(out, runId, { majorsWide = false } = {}) {
  const cands = new Map(readJsonl(path.join(out, 'candidates.jsonl')).map(c => [c.id, c]));
  const placedRows = [], refusals = {};
  for (const x of readJsonl(path.join(out, 'repairs.jsonl')).filter(r => r.run === runId)) {
    const it = cands.get(x.id);
    const why = !x.parsed ? 'reply-not-parsed' : x.label === 'ok' ? 'labelled-ok' : x.skipped === DRIFT_ONLY || driftOnly(x) ? 'skipped-drift-only' : edgeRefusal(it, x.repair) || (lostWords(it, x.repair).length > MAX_LOST ? 'drops-content-words' : null);
    const wide = why && majorsWide && x.severity === 'major' && !['reply-not-parsed', 'labelled-ok', 'skipped-drift-only'].includes(why)
      && !(edgeRefusal(it, x.repair, MAJORS_WIDE) || lostWords(it, x.repair).length > MAJORS_WIDE.maxLost);
    if (why && !wide) { refusals[why] = (refusals[why] || 0) + 1; continue; }
    placedRows.push({ id: x.id, it, x, arm: x.arm, fixed: applyRepair(it, x.repair), ...(wide ? { wide: true, normalRefusal: why } : {}) });
  }
  return { placedRows, refusals };
}
/** The run's verification sample, from verify.jsonl: per-join verdicts, the both-orders tallies, and the floor test. */
function sampleVerdicts(out, runId, wideIds = new Set()) {
  const vs = {}; for (const v of readJsonl(path.join(out, 'verify.jsonl')).filter(v => v.run === runId)) (vs[v.id] ||= {})[v.order] = v.better;
  const both = Object.keys(vs).filter(id => vs[id]['cur-first'] && vs[id]['rep-first']);
  const isPref = (id) => vs[id]['cur-first'] === 'Q' && vs[id]['rep-first'] === 'P';
  const worse = new Set(both.filter(id => vs[id]['cur-first'] === 'P' && vs[id]['rep-first'] === 'Q'));
  // the floor is the 7% sample of edge-bound repairs; the --majors-wide repairs are tallied apart and gated one by one
  const ids = both.filter(id => !wideIds.has(id)), prefers = ids.filter(isPref), wide = both.filter(id => wideIds.has(id));
  const summary = { judged: ids.length, prefersBothOrders: prefers.length, worseBothOrders: ids.filter(id => worse.has(id)).length, rate: ids.length ? +(prefers.length / ids.length).toFixed(3) : null };
  return { vs, worse, preferred: new Set(both.filter(isPref)), summary, wide: { judged: wide.length, prefersBothOrders: wide.filter(isPref).length, worseBothOrders: wide.filter(id => worse.has(id)).length },
    belowFloor: !ids.length || prefers.length / ids.length < PREFER_FLOOR };
}
/** Write (or, without --apply, plan) every placed repair of a run except those the sample judged worse. A split verdict
 *  is kept: the judge could not separate the two. */
async function writeRun(out, runId, o, placedRows, sv) {
  // a --majors-wide repair is written only when the judge preferred it in both orders
  const accepted = placedRows.filter(r => !sv.worse.has(r.id) && (!r.wide || sv.preferred.has(r.id))).map(r => ({ ...r, verdict: sv.vs[r.id] ? { sampled: true, ...sv.vs[r.id] } : { sampled: false } }));
  // One write per arm: a night that fell back from Gemini to a Claude arm records each repairer's own provenance.
  const byArm = {}; for (const r of accepted) (byArm[r.arm] ||= []).push(r);
  const { client, db } = await mongo();
  try {
    const tallies = {};
    for (const [arm, rows] of Object.entries(byArm)) {
      const claude = arm !== 'gemini';
      tallies[arm] = await writeRepairs(db, rows, { out, doApply: o.apply, cli: claude ? 'claude' : 'agy', model: claude ? CLAUDE_MODEL[arm] : GEMINI,
        promptName: `seam-repair-6742 lean: label+minimal edge repair (opus-reference PROMPT, tight windows, ${arm})`, sentHash: sha(claude ? PACK_HEAD + PROMPT : PROMPT),
        accepted: `placement-checked; the night's ${VERIFY_RATE * 100}% blind Opus sample preferred ${sv.summary.prefersBothOrders}/${sv.summary.judged} in both orders` });
    }
    const arms = Object.keys(tallies);
    return arms.length === 1 ? tallies[arms[0]] : { byArm: tallies, written: arms.reduce((a, k) => a + tallies[k].written, 0), pagesWritten: arms.reduce((a, k) => a + tallies[k].pagesWritten, 0) };
  } finally { await client.close(); }
}
/** Re-plan (or with --apply, write) a finished run's placed repairs — no model calls. Refuses a run below the floor. */
async function writeOnly(out, runId, o) {
  const { placedRows, refusals } = placeRun(out, runId, { majorsWide: o.majorsWide });
  const sv = sampleVerdicts(out, runId, new Set(placedRows.filter(r => r.wide).map(r => r.id)));
  if (sv.belowFloor) { console.log(JSON.stringify({ run: runId, refused: `sample below the ${PREFER_FLOOR * 100}% floor`, ...sv.summary })); return; }
  const write = await writeRun(out, runId, o, placedRows, sv);
  const row = { run: runId, rewrite: true, at: new Date().toISOString(), placed: placedRows.length, placementRefused: refusals, verify: sv.summary, write };
  append(path.join(out, 'writes.jsonl'), row);
  console.log(JSON.stringify(row, null, 1));
}

// ── report ───────────────────────────────────────────────────────────────────
function report(out) {
  const runs = readJsonl(path.join(out, 'runs.jsonl')), cands = readJsonl(path.join(out, 'candidates.jsonl')), books = readJsonl(path.join(out, 'books-done.jsonl'));
  const fired = {}; for (const c of cands) for (const f of c.fired) fired[f] = (fired[f] || 0) + 1;
  const ruleReady = {}; for (const c of cands) for (const [s, r] of Object.entries(c.rules || {})) { ruleReady[s] ||= { repair: 0, decline: 0 }; ruleReady[s][r.repair ? 'repair' : 'decline']++; }
  const rep = { candidates: cands.length, books: books.length, viewsRange: [books[0]?.views, books[books.length - 1]?.views], fired, ruleRepairsAvailable: ruleReady, trustedRules: TRUSTED_RULES, runs };
  fs.writeFileSync(path.join(out, 'report.json'), JSON.stringify(rep, null, 1) + '\n');
  console.log(JSON.stringify(rep, null, 1).slice(0, 5000));
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const cmd = process.argv[2], out = arg('out');
  const repairer = arg('repairer', 'gemini');
  if (repairer !== 'gemini' && !CLAUDE_MODEL[repairer]) { console.error(`--repairer=${repairer}: gemini, ${Object.keys(CLAUDE_MODEL).join(' or ')}`); process.exit(2); }
  const fallback = repairer === 'gemini' && arg('fallback', 'sonnet') !== 'none' ? arg('fallback', 'sonnet') : null;
  if (fallback && !CLAUDE_MODEL[fallback]) { console.error(`--fallback=${fallback}: ${Object.keys(CLAUDE_MODEL).join(', ')} or none`); process.exit(2); }
  const o = { maxJoins: Number(arg('max-joins', 2000)), repairer, fallback, pack: Number(arg('pack', repairer === 'gemini' ? 1 : OPUS_PACK)), conc: Number(arg('conc', 4)),
    verifyRate: Number(arg('verify-rate', VERIFY_RATE)), maxWeekly: Number(arg('max-weekly', MAX_WEEKLY)), apply: process.argv.includes('--apply'), majorsWide: process.argv.includes('--majors-wide') };
  const allJoins = process.argv.includes('--all-joins');
  if (allJoins && !arg('top-books')) { console.error('--all-joins needs --top-books=N: every join goes to the repairer, so it is for the most-read books only'); process.exit(2); }
  const co = { allJoins, topBooks: Number(arg('top-books', Infinity)), perBook: Number(arg('per-book', Infinity)), skipManifests: (arg('skip-manifest', '') || '').split(',').filter(Boolean) };
  const go = { candidates: () => candidates(out, o.maxJoins, Number(arg('days', 60)), co), run: () => run(out, o), report: async () => report(out), write: () => writeOnly(out, arg('run'), o),
    // the cron entry: top the candidates up to --max-joins pending, then run them (the guard is checked first)
    night: async () => { const u = claudeUsage(); if (!u || u.weekly >= o.maxWeekly) return run(out, o); await candidates(out, o.maxJoins, Number(arg('days', 60)), co); return run(out, o); } }[cmd];
  if (!go || !out) { console.error('usage: see the header'); process.exit(2); }
  go().catch(e => { console.error(e); process.exit(1); });
}
