#!/usr/bin/env node
/**
 * spend-perimeter — does every unattended Gemini spender ask the dial?
 *
 * WHY THIS EXISTS. The daily budget (`processing_control.daily_budget_usd`)
 * has failed twice, each time for a different reason, and the second reason is
 * the one nobody looks for:
 *
 *   1. INCOMPLETE METER (#3826). The guard summed Mongo `gemini_usage` while
 *      the logger wrote to Supabase. It read $9.00 on a day that billed ~$2.3K
 *      against a $15 dial. Fixed in #3835 — `spend-guard.mjs` now sums BOTH
 *      stores and fails closed on an unreadable one.
 *
 *   2. INCOMPLETE PERIMETER (this script). A meter can be perfect and the
 *      ceiling still leak, because a path that never calls the gate is never
 *      stopped by it. Measured 2026-08-31: four of the orchestrator's seven
 *      spending phases — 1.25 split confirm, 1.5 preview OCR, 1.6 metadata
 *      classification, 3.7 transliteration, 8 image extraction — called Gemini
 *      without ever asking. Phase 1.5 runs every two minutes on the Hetzner
 *      crontab, so the phase that ran most often was outside the ceiling.
 *      Separately, import-time preview OCR spent ~$392 in four days straight
 *      through a *pause* (#4432).
 *
 * A dial you cannot trust is worse than no dial: it converts "I set a limit"
 * into "I believe there is a limit."
 *
 * WHAT IT CHECKS.
 *   A. Every `shouldRun(N)` phase in the orchestrator that reaches a Gemini
 *      call is guarded by `budgetAllowsDispatch`.
 *   B. Every unattended entry point (Hetzner crontab + vercel.json crons) is
 *      CLASSIFIED below. An unclassified one fails the audit — that is the
 *      drift check, and it is the point. A new cron that spends must be an
 *      explicit decision, not a silent addition.
 *   D. THE PAUSE (#5492). Every unattended spender names the pause key it
 *      obeys (`pauseKey`, a word from scripts/lib/pause.mjs), and the functions
 *      on its spending PATH (`pausePath`) call `isPaused(…, '<key>')` — directly,
 *      or through a named brake (BRAKES) that is itself verified to. Every
 *      orchestrator phase that spends is governed by a key through `shouldRun`,
 *      and an OR-condition that would carry a block past its key's pause must
 *      ask for the key itself. Until #5492 the pause had two vocabularies that
 *      did not overlap: `'ocr'` paused nothing, `2` paused one orchestrator
 *      phase and no worker, and the chained batch lane read no pause at all.
 *   E. THE VOCABULARY. Every pause key has at least one reader, and no doc
 *      (pipeline-phases.md, the system map) or the emergency-stop route names a
 *      `paused_phases` entry that no lane reads — a brake keyed by a word no
 *      worker reads is not a brake (spend-controls.md, failure mode 5).
 *
 * WHAT IT DOES NOT CHECK. Traffic-driven Vercel routes (chat, ask, explain,
 * identify, ai-expand, transliterate…) are outside the dial by construction:
 * the guard is a Node ESM module reading Mongo on a long-lived worker, and no
 * live route in src/ consults `processing_control` at all. Their spend scales
 * with visitors and bots, not with the pipeline. That is a real hole and it is
 * named in NOT_GATED_BY_DESIGN below rather than left implicit.
 *
 * Usage:
 *   node scripts/audit/spend-perimeter.mjs          # human report
 *   node scripts/audit/spend-perimeter.mjs --ci     # exit 1 on any finding
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { PAUSE_KEYS, PHASE_PAUSE_KEY, classifyPauseEntry } from '../lib/pause.mjs';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const CI = process.argv.includes('--ci');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

/**
 * Unattended entry points, and why each is or is not inside the dial.
 * `spends` = makes Gemini calls (directly or through a lib that does).
 */
const UNATTENDED = [
  // ── Hetzner crontab ──
  { match: 'climits check', spends: false, gated: false,
    note: 'reads the four Claude accounts\' usage meters (subscription quota, no paid API) (#6360)' },
  { match: 'box.sh push-limits', spends: false, gated: false,
    note: 'copies the climits meter file to the other job boxes over the mesh; no model call (#6360)' },
  { match: 'pipeline-orchestrator.mjs', spends: true, gated: true,
    note: 'per-phase budgetAllowsDispatch; verified structurally by check A' },
  { match: 'translate-worker.mjs', spends: true, gated: true,
    note: 'whole run gated in main(), not just selfDispatch — see check C',
    mainGate: 'scripts/workers/translate-worker.mjs',
    // Drain (main, and processBook mid-run — a run lasts 45 min) and self-dispatch.
    pauseKey: 'translate',
    pausePath: [
      { file: 'scripts/workers/translate-worker.mjs', fn: 'main' },
      { file: 'scripts/workers/translate-worker.mjs', fn: 'selfDispatch' },
      { file: 'scripts/workers/translate-worker.mjs', fn: 'processBook' },
    ] },
  { match: 'translate-batch-worker.mjs', spends: true, gated: true,
    note: 'chained Batch lane (#4681): every round, queued runs included, asks budgetAllowsDispatchScoped at submit (prepareRound)',
    mainGate: 'scripts/workers/translate-batch-worker.mjs',
    // Every submit: the chained lane's shared jobs, the seam lane's translate and repair jobs,
    // and enrolment (stored spend).
    pauseKey: 'translate',
    pausePath: [
      { file: 'scripts/lib/translate-batch-chained.mjs', fn: 'submitRounds' },
      { file: 'scripts/lib/translate-batch-seam.mjs', fn: 'startRun' },
      { file: 'scripts/lib/translate-batch-seam.mjs', fn: 'advanceRun' },
      { file: 'scripts/workers/translate-batch-worker.mjs', fn: 'chained' },
    ] },
  { match: 'enrich-worker.mjs', spends: true, gated: true, note: 'gated (#3855)',
    pauseKey: 'enrich', pausePath: [{ file: 'scripts/workers/enrich-worker.mjs', fn: 'main' }] },
  { match: 'embed-gemini.mjs', spends: true, gated: true, note: 'pause + dial (#3855)',
    // No main(): the gate is a top-level block, and the work follows it.
    pauseKey: 'embeddings', pausePath: [{ file: 'scripts/workers/embed-gemini.mjs', block: '// Pause + dial gate' }] },
  // Spawned by scheduler.mjs, and on crontab.production: not on infrastructure/hetzner-crontab,
  // so check B never matches them, but they spend and the pause must reach them.
  { match: 'image-extract-worker.mjs', spends: true, gated: true, note: 'scheduler-spawned; scoped dial in main()',
    pauseKey: 'images', pausePath: [{ file: 'scripts/workers/image-extract-worker.mjs', fn: 'main' }] },
  { match: 'image-embeddings-cron.mjs', spends: true, gated: true, note: 'crontab.production; pause + scoped dial (#3826)',
    pauseKey: 'embeddings', pausePath: [{ file: 'scripts/workers/image-embeddings-cron.mjs', fn: 'main' }] },
  { match: 'embed-site-pages.mjs', spends: true, gated: true, note: 'dial via budgetAllowsDispatchScoped; daily, hash-diffed, fractions of a cent (#1180, #5945)',
    pauseKey: 'embeddings', pausePath: [{ file: 'scripts/workers/embed-site-pages.mjs', fn: 'main' }] },
  { match: 'batch-collector.mjs', spends: false, gated: false,
    note: 'collects finished batches; writes results, submits nothing' },
  // Free, so outside the dial — but `archive` is a pause key, and a key nothing reads is the
  // failure this audit's check E exists for.
  { match: 'archive-bulk.mjs', spends: false, gated: false, note: 'free archiver (#2616)',
    pauseKey: 'archive', pausePath: [{ file: 'scripts/workers/archive-bulk.mjs', fn: 'main' }] },
  { match: 'archive-ocr.mjs', spends: false, gated: false,
    note: 'free archiver — deliberately not gated (#2616)',
    pauseKey: 'archive', pausePath: [{ file: 'scripts/workers/archive-ocr.mjs', fn: 'main' }] },
  { match: 'sync-worker.mjs', spends: false, gated: false, note: 'Mongo→Supabase sync' },
  { match: 'enrichment-snapshot.mjs', spends: false, gated: false, note: 'reads only' },
  { match: 'suggest-vocabulary-snapshot.mjs', spends: false, gated: false, note: 'reads only' },
  { match: 'allmaps-sync.mjs', spends: false, gated: false,
    note: 'reads annotations.allmaps.org, writes gallery_images.allmaps — no Gemini (#5076)' },
  { match: 'stage-coverage-snapshot.mjs', spends: false, gated: false, note: 'reads only' },
  { match: 'pipeline-health-alert.mjs', spends: false, gated: false, note: 'reads control, alerts' },
  { match: 'status-output-drift.mjs', spends: false, gated: false,
    note: 'read-only counts over books; no model call, no write (#4890)' },
  { match: 'backfill-printed-page-4291.mjs', spends: false, gated: false,
    note: 'daily refit of pages.printed_page from stored OCR text; Mongo only, no model call (#4291)' },
  { match: 'clip-index-integrity.mjs', spends: false, gated: false,
    note: 'read-only join of clip_embeddings to gallery_images; no model call, no write (#5195)' },
  { match: 'quality-dashboard/build.mjs', spends: false, gated: false,
    note: '/admin/quality daily rebuild + trend history: reads pages/books/ops_reports, writes ops_reports only; no model call (#6429)' },
  { match: 'paid-vs-got.mjs', spends: false, gated: false,
    note: 'daily paid-vs-got ledger: reads usage stores, batch_jobs, pages and the billing export; writes one ops_reports row; no model call (#5499)' },
  { match: 'spend-daily.mjs', spends: false, gated: false,
    note: 'daily spend check: reads ops_reports, usage stores, pages, envelopes, the billing export and RunPod/Scaleway/Vercel billing APIs; writes one ops_reports row, emails on FAIL; no model call (#5743)' },
  { match: 'spend-weekly-brief.md', spends: false, gated: false,
    note: 'weekly cut list: a headless claude job (Claude subscription, no Gemini/API spend) that runs spend-daily.mjs --week and posts one issue comment; changes nothing (#5743)' },
  { match: 'vercel-prod-watch.mjs', spends: false, gated: false,
    note: 'production-deploy watch: reads the Vercel REST API + origin/main; files/closes one GitHub issue, pages ntfy; no model call, no Vercel function invocation (#5708)' },
  { match: 'ntfy-morning-digest.mjs', spends: false, gated: false,
    note: 'morning ntfy digest: reads the ntfy topic history, usage stores, the spend-daily row, decisions.txt, claude-job status and gh; sends one ntfy message; no model call (#6181)' },
  { match: 'model-usage-snapshot.mjs', spends: false, gated: false,
    note: '/about/models counts: checkpointed walk over pages + gallery_images, Supabase count estimates; writes one ops_reports row; no model call (#5601)' },
  { match: 'daily-digest.mjs', spends: false, gated: false,
    note: 'reads both usage stores, logs and gh; sends one Telegram/GitHub message; no model call (#5441)' },
  { match: 'decision-answers-drain.mjs', spends: false, gated: false,
    note: 'decision queue drainer: reads decision_answers, runs safe-merge.sh / gh pr comment for answers Derek gave on /platform/admin/decisions; no model call (#6258)' },
  { match: 'warm-author-pages.mjs', spends: false, gated: false, note: 'HTTP warm' },
  { match: 'prewarm-browse.mjs', spends: false, gated: false, note: 'HTTP warm' },
  { match: 'catalog-csv-snapshot.mjs', spends: false, gated: false, note: 'reads only' },
  { match: 'build-gallery-subject-index.mjs', spends: false, gated: false,
    note: 'counts over gallery_images, writes one system_config doc; no model call (#4856)' },
  { match: 'cron-caller.mjs', spends: true, gated: false,
    note: 'CALLS VERCEL CRONS — social-post reaches tweet-generator (Gemini). Small and fixed-rate (8/day), but outside the dial.',
    pauseKey: null, pauseWhy: 'outside the pause as it is outside the dial: a Vercel route, and no live src/ route reads processing_control' },
  // Non-sourcelibrary lines on the same box.
  { match: 'moltbook', spends: false, gated: false, note: 'not this project' },
  { match: 'oura', spends: false, gated: false, note: 'not this project' },
  { match: 'sl-gitpull', spends: false, gated: false, note: 'git pull' },

  // ── vercel.json crons ──
  { match: '/api/cron/warm', spends: false, gated: false, note: 'cache warm' },
  { match: '/api/cron/collection-health', spends: false, gated: false, note: 'reads only' },
  { match: '/api/cron/sync-bph-sl-book-ids', spends: false, gated: false, note: 'id sync' },
  { match: '/api/cron/sync-catalog-sl-book-ids', spends: false, gated: false, note: 'id sync' },
  { match: '/api/cron/enrich-entities', spends: false, gated: false,
    note: 'Wikidata, not Gemini — verified 2026-08-31' },
  { match: '/api/cron/storage-stats', spends: false, gated: false, note: 'reads only' },
  { match: '/api/cron/dashboard-snapshot', spends: false, gated: false, note: 'reads only' },
];

/** Known-ungated, traffic-driven. Listed so the hole is named, not hidden. */
const NOT_GATED_BY_DESIGN = [
  'src/app/api/books/[id]/chat/route.ts',
  'src/app/api/pages/[id]/ask/route.ts',
  'src/app/api/explain/route.ts',
  'src/app/api/identify/route.ts',
  'src/app/api/search/ai-expand/route.ts',
  'src/app/api/pages/[id]/transliterate/route.ts',
  'src/app/api/pages/[id]/detect-split/route.ts',
  'src/app/api/contribute/process/route.ts',
];

const findings = [];

// ── Check A: orchestrator phases that spend must be gated ──────────────────
const orch = read('scripts/workers/pipeline-orchestrator.mjs');
const lines = orch.split('\n');

/** Line indices where a phase block opens, with its condition text. */
const phaseOpens = [];
lines.forEach((l, i) => {
  const m = l.match(/^\s*if \((.*shouldRun\([\d.]+\).*)\) \{/);
  if (!m) return;
  // A condition may name several phases (`shouldRun(3.7) || shouldRun(3)`).
  // Label with all of them — taking the first read as "Phase 3" for a block
  // that is really 3.7, which sends a reader to the wrong place.
  const phases = [...m[1].matchAll(/shouldRun\(([\d.]+)\)/g)].map((x) => x[1]);
  phaseOpens.push({ idx: i, cond: m[1], phase: phases.join('/') });
});

// Gemini spend markers inside the orchestrator.
const SPEND_RE = /GEMINI_API_BASE\}\/models\/|submitCrossBookOcrBatches\(|submitOcrDirectly\(|submitImageExtractionBatch\(|submitCrossBookImageBatches\(|transliteratePage\(|dispatchTranslation/;

for (let n = 0; n < phaseOpens.length; n++) {
  const { idx, cond, phase } = phaseOpens[n];
  const end = n + 1 < phaseOpens.length ? phaseOpens[n + 1].idx : lines.length;
  const body = lines.slice(idx, end).join('\n');
  if (!SPEND_RE.test(body)) continue;
  // Gated either in the condition, or by a guard variable computed in-body
  // (Phase 1.25 keeps its free screen running and gates only the paid call).
  const gatedInCond = /budgetAllowsDispatch/.test(cond);
  const gatedInBody = /budgetAllowsDispatch/.test(body);
  if (!gatedInCond && !gatedInBody) {
    findings.push({
      kind: 'UNGATED_PHASE',
      what: `orchestrator Phase ${phase} (line ${idx + 1})`,
      why: 'reaches a Gemini call but never calls budgetAllowsDispatch',
    });
  }
}

// ── Check C: a worker's MAIN flow must gate, not merely a helper ───────────
// This check exists because the first version of this audit passed
// translate-worker on the strength of the file mentioning budgetAllowsDispatch
// at all. It did — inside selfDispatch(). Its main() separately picked up
// already-queued work and asked nothing, and on the 2026-08-30 relight that
// drained 5,011 orphaned jobs through a $5 ceiling. Presence of a guard is not
// coverage by it; the absence of a marker is not the absence of a path.
for (const u of UNATTENDED.filter((x) => x.mainGate)) {
  const src = read(u.mainGate);
  const mainIdx = src.search(/async function main\s*\(/);
  if (mainIdx < 0) {
    findings.push({ kind: 'NO_MAIN', what: u.mainGate, why: 'expected an async main() to check' });
    continue;
  }
  if (!/budgetAllowsDispatch/.test(src.slice(mainIdx))) {
    findings.push({
      kind: 'MAIN_UNGATED',
      what: u.mainGate,
      why: 'main() reaches paid work without calling budgetAllowsDispatch — a helper-only gate leaves queued work ungoverned',
    });
  }
}

// ── Check D: the pause reaches every spender's spending path (#5492) ───────
/**
 * Named brakes: helpers a spending path may call instead of `isPaused` itself. Each is
 * verified here to call `isPaused(…, '<key>')`, so a brake that stops asking fails too.
 */
const BRAKES = [
  { file: 'scripts/lib/translate-batch-seam.mjs', fn: 'translateSubmitBrake', key: 'translate' },
  { file: 'scripts/workers/translate-worker.mjs', fn: 'translatePausedMidRun', key: 'translate' },
  // Under a pause the --batch run still collects (already paid) and submits nothing (#5496 B2).
  { file: 'scripts/workers/lib/enrich-batch-lane.mjs', fn: 'enrichPauseMode', key: 'enrich' },
];

/** The body of `function NAME(...) { … }` in a source text, or null. Brace-counted. */
function functionBody(src, name) {
  const m = new RegExp(`(?:async\\s+)?function\\s+${name}\\s*\\(`).exec(src);
  if (!m) return null;
  let i = m.index + m[0].length;
  for (let depth = 1; i < src.length && depth > 0; i++) {
    if (src[i] === '(') depth++;
    else if (src[i] === ')') depth--;
  }
  const open = src.indexOf('{', i);
  if (open < 0) return null;
  let depth = 0;
  for (let j = open; j < src.length; j++) {
    if (src[j] === '{') depth++;
    else if (src[j] === '}' && --depth === 0) return src.slice(open, j + 1);
  }
  return null;
}
/** A top-level `{ … }` block that opens right after an anchor comment (embed-gemini has no main). */
function anchoredBlock(src, anchor) {
  const at = src.indexOf(anchor);
  if (at < 0) return null;
  const end = src.indexOf('\n}\n', at);
  return end < 0 ? null : src.slice(at, end + 2);
}
const asksKey = (body, key) => new RegExp(`isPaused\\([^)]*['"\`]${key}['"\`]\\s*\\)`).test(body);

const verifiedBrakes = new Map(); // fn name → key
for (const b of BRAKES) {
  const body = functionBody(read(b.file), b.fn);
  if (!body) {
    findings.push({ kind: 'BRAKE_MISSING', what: `${b.file} ${b.fn}()`, why: 'listed in BRAKES but not found' });
  } else if (!asksKey(body, b.key)) {
    findings.push({ kind: 'BRAKE_UNKEYED', what: `${b.file} ${b.fn}()`, why: `never calls isPaused(…, '${b.key}')` });
  } else {
    verifiedBrakes.set(b.fn, b.key);
  }
}
const pathAsks = (body, key) =>
  asksKey(body, key) || [...verifiedBrakes].some(([fn, k]) => k === key && new RegExp(`\\b${fn}\\(`).test(body));

for (const u of UNATTENDED.filter((x) => x.spends || x.pauseKey)) {
  if (u.match === 'pipeline-orchestrator.mjs') continue; // per phase, below
  if (u.pauseKey === undefined || (u.pauseKey === null && !u.pauseWhy)) {
    findings.push({ kind: 'NO_PAUSE_KEY', what: u.match, why: 'spends but names no pauseKey (or pauseKey: null with a pauseWhy)' });
    continue;
  }
  if (u.pauseKey === null) continue;
  if (!PAUSE_KEYS.includes(u.pauseKey)) {
    findings.push({ kind: 'UNKNOWN_PAUSE_KEY', what: `${u.match} pauseKey '${u.pauseKey}'`, why: `not in scripts/lib/pause.mjs PAUSE_KEYS (${PAUSE_KEYS.join(', ')})` });
    continue;
  }
  if (!u.pausePath?.length) {
    findings.push({ kind: 'NO_PAUSE_PATH', what: u.match, why: 'names a pauseKey but no pausePath to check it on' });
    continue;
  }
  for (const p of u.pausePath) {
    const src = read(p.file);
    const body = p.fn ? functionBody(src, p.fn) : anchoredBlock(src, p.block);
    const where = `${p.file} ${p.fn ? `${p.fn}()` : `block "${p.block}"`}`;
    if (!body) {
      findings.push({ kind: 'PAUSE_PATH_MISSING', what: where, why: 'the spending path named in pausePath was not found' });
    } else if (!pathAsks(body, u.pauseKey)) {
      findings.push({
        kind: 'PAUSE_UNCHECKED',
        what: where,
        why: `on the spending path of ${u.match}, but never asks isPaused(…, '${u.pauseKey}') — a pause would return success while this keeps spending`,
      });
    }
  }
}

// Orchestrator: shouldRun must consult the key, and every spending phase must have one.
const shouldRunBody = functionBody(orch, 'shouldRun') || '';
if (!/isPaused\(/.test(shouldRunBody) || !/PHASE_PAUSE_KEY/.test(shouldRunBody)) {
  findings.push({ kind: 'SHOULDRUN_UNKEYED', what: 'pipeline-orchestrator.mjs shouldRun()', why: 'does not ask isPaused for the PHASE_PAUSE_KEY of the phase' });
}
for (let n = 0; n < phaseOpens.length; n++) {
  const { idx, cond, phase } = phaseOpens[n];
  const end = n + 1 < phaseOpens.length ? phaseOpens[n + 1].idx : lines.length;
  if (!SPEND_RE.test(lines.slice(idx, end).join('\n'))) continue;
  const phases = phase.split('/').map(Number);
  const key = PHASE_PAUSE_KEY[phases[0]];
  if (!key) {
    findings.push({ kind: 'UNKEYED_PHASE', what: `orchestrator Phase ${phase} (line ${idx + 1})`, why: 'spends, but PHASE_PAUSE_KEY in scripts/lib/pause.mjs names no pause key for it' });
    continue;
  }
  // `shouldRun(3.7) || shouldRun(3)`: shouldRun(3) is true under an ocr pause (3 is bookkeeping,
  // no key), so the OR carries the block through. Such a block must ask for its key itself.
  const allKeyed = phases.every((ph) => PHASE_PAUSE_KEY[ph] === key);
  if (!allKeyed && !asksKey(cond, key)) {
    findings.push({
      kind: 'PAUSE_BYPASSED_BY_OR',
      what: `orchestrator Phase ${phase} (line ${idx + 1})`,
      why: `its condition ORs in a phase not governed by '${key}', so a '${key}' pause does not stop it — add isPaused(PAUSE_CONTROL, '${key}') to the condition`,
    });
  }
}

// ── Check E: every key has a reader; no doc or route names a word nobody reads ──
const readers = new Set([
  ...UNATTENDED.map((u) => u.pauseKey).filter(Boolean),
  ...Object.values(PHASE_PAUSE_KEY),
]);
for (const k of PAUSE_KEYS) {
  if (!readers.has(k)) findings.push({ kind: 'KEY_WITH_NO_READER', what: `pause key '${k}'`, why: 'no unattended lane or orchestrator phase reads it — a brake keyed by a word no worker reads' });
}
const VOCAB_SITES = [
  '.claude/docs/pipeline-phases.md',
  '.claude/docs/pipeline.md',
  '.claude/docs/system-map.md',
  'src/app/admin/system-map/page.tsx',
  'src/app/api/admin/emergency-stop/route.ts',
];
for (const file of VOCAB_SITES) {
  const text = read(file);
  text.split('\n').forEach((line, i) => {
    const at = line.indexOf('paused_phases');
    if (at < 0) return;
    const rest = line.slice(at);
    // Every [...] or (...) list after the field name on its line; quoted words always, bare
    // numbers inside [...] (a JS/JSON array literal).
    for (const m of rest.matchAll(/\[([^\]]*)\]|\(([^)]*)\)/g)) {
      const inside = m[1] ?? m[2];
      const tokens = [...inside.matchAll(/(['"`])([^'"`]*)\1/g)].map((x) => x[2]);
      if (m[1] !== undefined) tokens.push(...[...inside.replace(/(['"`])[^'"`]*\1/g, '').matchAll(/(?<![\w.])(\d+(?:\.\d+)?)(?![\w.])/g)].map((x) => Number(x[1])));
      for (const t of tokens) {
        if (classifyPauseEntry(t).kind === 'unknown') {
          findings.push({ kind: 'UNKNOWN_KEY_IN_DOC', what: `${file}:${i + 1} names ${JSON.stringify(t)}`, why: `no lane reads it (valid: ${PAUSE_KEYS.join(', ')}, plus the legacy aliases in scripts/lib/pause.mjs)` });
        }
      }
    }
  });
}
if (!/validatePauseKeys\(/.test(read('src/app/api/admin/emergency-stop/route.ts'))) {
  findings.push({ kind: 'ROUTE_UNVALIDATED', what: 'src/app/api/admin/emergency-stop/route.ts', why: 'writes paused_phases without validatePauseKeys — it would accept a key no worker reads' });
}

// ── Check B: every unattended entry point is classified ────────────────────
const cronLines = read('infrastructure/hetzner-crontab')
  .split('\n')
  .map((l) => l.trim())
  .filter((l) => l && !l.startsWith('#'));

const vercelCrons = (JSON.parse(read('vercel.json')).crons || []).map((c) => c.path);

for (const entry of [...cronLines, ...vercelCrons]) {
  if (!UNATTENDED.some((u) => entry.includes(u.match))) {
    findings.push({
      kind: 'UNCLASSIFIED_SCHEDULE',
      what: entry.slice(0, 110),
      why: 'scheduled but not classified in UNATTENDED — decide if it spends, then add it',
    });
  }
}

// ── Report ─────────────────────────────────────────────────────────────────
const spenders = UNATTENDED.filter((u) => u.spends);
console.log('SPEND PERIMETER\n');
console.log(`Unattended entry points classified : ${UNATTENDED.length}`);
console.log(`  of which spend Gemini            : ${spenders.length}`);
console.log(`  of those, inside the dial        : ${spenders.filter((s) => s.gated).length}`);
console.log('');
const pauseCol = (s) => (s.match === 'pipeline-orchestrator.mjs' ? '[pause:per-phase]' : s.pauseKey ? `[pause:${s.pauseKey}]` : '[pause:NONE]');
for (const s of spenders) {
  console.log(`  ${s.gated ? '[dial]' : '[OPEN]'} ${pauseCol(s).padEnd(18)} ${s.match} — ${s.note}`);
}
console.log('\nPause keys and their readers (scripts/lib/pause.mjs):');
for (const k of PAUSE_KEYS) {
  const lanes = UNATTENDED.filter((u) => u.pauseKey === k).map((u) => u.match);
  const phases = Object.entries(PHASE_PAUSE_KEY).filter(([, v]) => v === k).map(([ph]) => ph);
  console.log(`  ${k.padEnd(11)} ${[...lanes, ...(phases.length ? [`orchestrator phases ${phases.join(', ')}`] : [])].join('; ') || 'NO READER'}`);
}
console.log(`\nTraffic-driven routes outside the dial by construction: ${NOT_GATED_BY_DESIGN.length}`);
console.log('  (spend scales with visitors and bots; the dial cannot see them)');
for (const r of NOT_GATED_BY_DESIGN) console.log(`  [OPEN] ${r}`);

console.log('');
if (findings.length === 0) {
  console.log('PASS — every spending orchestrator phase asks the dial, every spender asks its pause key on its spending path, and every schedule is classified.');
} else {
  console.log(`FAIL — ${findings.length} finding(s):\n`);
  for (const f of findings) console.log(`  ${f.kind}: ${f.what}\n    ${f.why}`);
}

process.exit(CI && findings.length ? 1 : 0);
