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
 *   $N $S run        --out=DIR [--max-joins=N] [--repairer=gemini|opus] [--pack=1|30] [--conc=4] [--verify-rate=0.07]
 *                    [--max-weekly=60] [--apply]                 dry run (no writes) unless --apply
 *   $N $S night      --out=DIR --max-joins=N [--apply]          candidates (topped up to N pending) + run: the cron entry
 *   $N $S report     --out=DIR
 *   $N seam-repair.mjs undo --out=DIR [--apply]                 the pilot's undo reads this DIR's manifest.jsonl
 *
 * A night: (1) stop at once if the box's account is over --max-weekly % of its week, or the poll is stale/unknown;
 * (2) tier 1 — joins whose signal Test A trusts get the rule repair, no model; (3) tier 2 — the rest go to the
 * repairer (Gemini 3.8 Flash low via agy, one join per call; or Opus, 30 per call) with tight windows: the last ~2
 * English sentences of N, the first ~2 of N+1, and the matching share of each source; (4) placement (edgeRefusal, and
 * lostWords: no more than 3 content words may vanish from the join);
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

async function candidates(out, maxJoins, days) {
  fs.mkdirSync(out, { recursive: true });
  const file = path.join(out, 'candidates.jsonl'), booksFile = path.join(out, 'books-done.jsonl');
  // Top up to maxJoins PENDING joins (drawn, not yet sent to a repairer). A book cut off at the cap is resumed.
  const doneBooks = new Set(readJsonl(booksFile).filter(b => b.complete).map(b => b.book));
  const have = new Set(readJsonl(file).map(c => c.id)), processed = new Set(readJsonl(path.join(out, 'repairs.jsonl')).map(r => r.id));
  let got = [...have].filter(id => !processed.has(id)).length;
  // never re-propose a join the pilot (or an earlier night) already wrote
  const pilotManifest = path.join(REPO, 'scripts/eval/results/seam-repair-6742/manifest.jsonl.gz');
  const writtenJoins = new Set([...readJsonl(path.join(out, 'manifest.jsonl')).filter(m => m.written).map(m => m.join),
    ...(fs.existsSync(pilotManifest) ? (await import('zlib')).gunzipSync(fs.readFileSync(pilotManifest)).toString().trim().split('\n').map(l => JSON.parse(l)).filter(m => m.written).map(m => m.join) : [])]);
  const { client, db } = await mongo();
  const books = await readership(db, days);
  fs.writeFileSync(path.join(out, 'readership.json'), JSON.stringify({ built_at: new Date().toISOString(), window_days: days, instrument: 'analytics_pageviews, distinct (ip, day) per book, human-filtered at write (ocr-convergence/driver.mjs frame)', books: books.length, top: books.slice(0, 20).map(b => ({ id: b.id, title: (b.title || '').slice(0, 80), views: b.views })) }, null, 1));
  console.log(`${books.length} live translated books with readers in ${days} days; top ${books[0]?.views} views`);
  let rank = 0;
  for (const b of books) {
    rank++;
    if (got >= maxJoins) break;
    if (doneBooks.has(b.id)) continue;
    const rows = await db.collection('pages').find({ book_id: b.id }, { projection: PROJ }).sort({ page_number: 1 }).toArray();
    const by = new Map(rows.map(r => [r.page_number, r]));
    let joins = 0, tranche = 0, cut = false;
    for (const ra of rows) {
      if (got >= maxJoins) { cut = true; break; }
      const p = ra.page_number, rb = by.get(p + 1);
      if (!eligible(ra) || !eligible(rb)) continue;
      joins++;
      const id = sha(`${b.id}:${p}`).slice(0, 12);
      if (writtenJoins.has(id) || have.has(id)) continue;
      const A = asPage(ra), B = asPage(rb), r0 = by.get(p - 1), r1 = by.get(p + 2);
      const sig = joinSignals({ A0: eligible(r0) ? asPage(r0) : null, A, B, B1: eligible(r1) ? asPage(r1) : null });
      if (sig.skipped || sig.nonProse) continue;
      const fired = TRANCHE.filter(k => sig[k]);
      if (!fired.length) continue;
      tranche++;
      const enA = translationProse(A.tr), enB = translationProse(B.tr), srcA = sourceProse(A.ocr), srcB = sourceProse(B.ocr);
      const it = { id, book: b.id, title: (b.title || '').slice(0, 120), views: b.views, rank, p, idA: A.id, idB: B.id, pB: p + 1, fired, script: sig.script, lang: b.language,
        modelA: ra.translation.model, modelB: rb.translation.model, hashA: sha(A.tr), hashB: sha(B.tr) };
      it.enTailA = enWindow(enA, 'tail'); it.enHeadB = enWindow(enB, 'head');
      it.srcTailA = srcWindow(srcA, enA, it.enTailA, 'tail'); it.srcHeadB = srcWindow(srcB, enB, it.enHeadB, 'head');
      // Rule repairs are computed here, where the full pages are in hand (dupRepair weighs page ratios); `run` uses
      // them only for the signals in TRUSTED_RULES.
      it.rules = {};
      for (const s of fired) if (RULES[s]) { const r = RULES[s]({ ...it, rawA: A.tr, rawB: B.tr, ocrA: A.ocr, ocrB: B.ocr }); it.rules[s] = r.repair ? { repair: r.repair } : { decline: r.decline }; }
      append(file, it); got++;
    }
    append(booksFile, { book: b.id, rank, views: b.views, pages: rows.length, joins, tranche, complete: !cut });
    if (rank % 25 === 0) process.stderr.write(`${rank} books, ${got} joins\n`);
  }
  await client.close();
  console.log(JSON.stringify({ books: rank, joins: got }));
}

// ── run ──────────────────────────────────────────────────────────────────────
async function repairOpus(pk) {
  const r = await claudeCall(`${PACK_HEAD}${PROMPT}\n\n${pk.map(joinText).join('\n')}`, 'opus');
  const arr = r.cls ? null : extractJson(r.text, '[');
  return { byId: new Map((Array.isArray(arr) ? arr : []).filter(Boolean).map(x => [x.id, x])), r };
}

async function run(out, o) {
  const status = (x) => { fs.writeFileSync(path.join(out, 'status.json'), JSON.stringify({ at: new Date().toISOString(), ...x }, null, 1)); return x; };
  const u0 = claudeUsage();
  if (!u0) { console.log(JSON.stringify(status({ stopped: 'claude usage unknown or stale: not starting' }))); return; }
  if (u0.weekly >= o.maxWeekly) { console.log(JSON.stringify(status({ stopped: `weekly ${u0.weekly}% >= ${o.maxWeekly}%: not starting`, usage: u0 }))); return; }
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
  let guardTripped = null, sinceCheck = 0;
  const model = o.repairer === 'opus' ? 'claude-opus-5-5' : GEMINI;
  await pool(packs(t2, o.pack), o.conc, async (pk) => {
    if (guardTripped) return { ok: true };
    if (++sinceCheck % 20 === 0) { const u = claudeUsage(); if (!u || u.weekly >= o.maxWeekly) { guardTripped = u ? `weekly ${u.weekly}%` : 'usage unknown'; return { ok: true }; } }
    if (o.repairer === 'gemini' && !agyOpen(GEMINI)) return { cls: 'usage_limit' };
    const { byId, r } = o.repairer === 'opus' ? await repairOpus(pk) : await geminiPack(pk, GEMINI);
    if (r.cls === 'usage_limit' || r.cls === 'quota') return { cls: 'usage_limit' };
    append(calls, { run: runId, stage: 'repair', arm: o.repairer, n: pk.length, model: r.model || model, cls: r.cls, secs: Math.round(r.secs), usage: o.repairer === 'opus' ? usageOf(r) : (r.usage ? { in: r.usage.input_tokens, out: r.usage.output_tokens, thinking: r.usage.thinking_tokens } : null), at: new Date().toISOString() });
    let ok = 0;
    for (const it of pk) {
      const j = byId.get(it.id), parsed = j && LABELS.includes(j.label) ? j : null;
      if (parsed) ok++;
      append(repFile, { id: it.id, run: runId, tier: 2, arm: o.repairer, parsed: !!parsed, ...(parsed || {}), repairCheck: parsed ? validRepair(it, parsed.repair) : null, model: r.model || model, cls: r.cls || undefined });
      tally.tier2++;
    }
    return { ok: ok > 0, cls: r.cls };
  }, o.repairer === 'gemini' ? { probe: async () => ({ cls: agyOpen(GEMINI) ? null : 'usage_limit' }) } : {});
  if (guardTripped) tally.guard = `stopped mid-run: ${guardTripped}`;

  // placement
  const cands = new Map(todo.map(c => [c.id, c]));
  const reps = readJsonl(repFile).filter(x => x.run === runId);
  const placedRows = [], refusals = {};
  for (const x of reps) {
    const it = cands.get(x.id);
    const why = !x.parsed ? 'reply-not-parsed' : x.label === 'ok' ? 'labelled-ok' : edgeRefusal(it, x.repair) || (lostWords(it, x.repair).length > MAX_LOST ? 'drops-content-words' : null);
    if (why) { refusals[why] = (refusals[why] || 0) + 1; continue; }
    placedRows.push({ id: x.id, it, x, arm: x.arm, fixed: applyRepair(it, x.repair) });
  }
  tally.placed = placedRows.length; tally.placementRefused = refusals;

  // verification sample: seeded 7% (≥ 20) of placed repairs, both orders in different calls, + 2 A/A pairs
  const rand = makeRng(Number(runId.replace(/\D/g, '').slice(-9)));
  const nSample = Math.min(placedRows.length, Math.max(VERIFY_MIN, Math.ceil(placedRows.length * o.verifyRate)));
  const sample = shuffle(placedRows, rand).slice(0, nSample);
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
  const vs = {}; for (const v of readJsonl(verFile).filter(v => v.run === runId)) (vs[v.id] ||= {})[v.order] = v.better;
  const judged = sample.filter(r => vs[r.id]?.['cur-first'] && vs[r.id]?.['rep-first']);
  const prefers = judged.filter(r => vs[r.id]['cur-first'] === 'Q' && vs[r.id]['rep-first'] === 'P');
  const worse = new Set(judged.filter(r => vs[r.id]['cur-first'] === 'P' && vs[r.id]['rep-first'] === 'Q').map(r => r.id));
  const aaVerdicts = aa.length ? [vs[aa[0].id]?.['aa-1'], vs[aa[0].id]?.['aa-2']] : [];
  tally.verify = { sampled: sample.length, judged: judged.length, prefersBothOrders: prefers.length, worseBothOrders: worse.size, rate: judged.length ? +(prefers.length / judged.length).toFixed(3) : null, aa: aaVerdicts };
  if (!judged.length || prefers.length / judged.length < PREFER_FLOOR) {
    tally.stopped = `verification sample: ${prefers.length}/${judged.length} preferred in both orders, below ${PREFER_FLOOR * 100}% — nothing written`;
    tally.decision = `DECISION: seam-repair lean run ${runId} stopped — the blind Opus sample preferred ${prefers.length}/${judged.length} repairs (< ${PREFER_FLOOR * 100}%); inspect ${out}/verify.jsonl before the next night — default: keep the runner paused (#6742)`;
  } else {
    // write: every placed repair except those the sample judged worse (a split verdict is kept: the judge could not separate them)
    const accepted = placedRows.filter(r => !worse.has(r.id)).map(r => ({ ...r, verdict: vs[r.id] ? { sampled: true, ...vs[r.id] } : { sampled: false } }));
    const { client, db } = await mongo();
    tally.write = await writeRepairs(db, accepted, { out, doApply: o.apply, cli: o.repairer === 'opus' ? 'claude' : 'agy', model,
      promptName: `seam-repair-6742 lean: label+minimal edge repair (opus-reference PROMPT, tight windows, ${o.repairer})`, sentHash: sha(o.pack > 1 ? PACK_HEAD + PROMPT : PROMPT),
      accepted: `placement-checked; the night's ${VERIFY_RATE * 100}% blind Opus sample preferred ${prefers.length}/${judged.length} in both orders` });
    await client.close();
  }
  tally.usageEnd = claudeUsage();
  const runCalls = readJsonl(calls).filter(c => c.run === runId);
  tally.calls = runCalls.reduce((a, c) => { const k = `${c.stage}:${c.arm}`; a[k] = (a[k] || 0) + 1; return a; }, {});
  tally.listUsdClaude = +runCalls.reduce((a, c) => a + (c.usage?.list_usd || 0), 0).toFixed(2);
  append(path.join(out, 'runs.jsonl'), tally);
  status(tally);
  console.log(JSON.stringify(tally, null, 1));
  if (tally.decision) console.log(tally.decision);
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
  const o = { maxJoins: Number(arg('max-joins', 2000)), repairer, pack: Number(arg('pack', repairer === 'opus' ? OPUS_PACK : 1)), conc: Number(arg('conc', 4)),
    verifyRate: Number(arg('verify-rate', VERIFY_RATE)), maxWeekly: Number(arg('max-weekly', MAX_WEEKLY)), apply: process.argv.includes('--apply') };
  const go = { candidates: () => candidates(out, o.maxJoins, Number(arg('days', 60))), run: () => run(out, o), report: async () => report(out),
    // the cron entry: top the candidates up to --max-joins pending, then run them (the guard is checked first)
    night: async () => { const u = claudeUsage(); if (!u || u.weekly >= o.maxWeekly) return run(out, o); await candidates(out, o.maxJoins, Number(arg('days', 60))); return run(out, o); } }[cmd];
  if (!go || !out) { console.error('usage: see the header'); process.exit(2); }
  go().catch(e => { console.error(e); process.exit(1); });
}
