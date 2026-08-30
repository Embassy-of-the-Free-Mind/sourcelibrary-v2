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

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const CI = process.argv.includes('--ci');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

/**
 * Unattended entry points, and why each is or is not inside the dial.
 * `spends` = makes Gemini calls (directly or through a lib that does).
 */
const UNATTENDED = [
  // ── Hetzner crontab ──
  { match: 'pipeline-orchestrator.mjs', spends: true, gated: true,
    note: 'per-phase budgetAllowsDispatch; verified structurally by check A' },
  { match: 'translate-worker.mjs', spends: true, gated: true,
    note: 'self-dispatch gated (#3835)' },
  { match: 'enrich-worker.mjs', spends: true, gated: true, note: 'gated (#3855)' },
  { match: 'embed-gemini.mjs', spends: true, gated: true, note: 'pause + dial (#3855)' },
  { match: 'batch-collector.mjs', spends: false, gated: false,
    note: 'collects finished batches; writes results, submits nothing' },
  { match: 'archive-bulk.mjs', spends: false, gated: false, note: 'free archiver (#2616)' },
  { match: 'archive-ocr.mjs', spends: false, gated: false,
    note: 'free archiver — deliberately not gated (#2616)' },
  { match: 'sync-worker.mjs', spends: false, gated: false, note: 'Mongo→Supabase sync' },
  { match: 'enrichment-snapshot.mjs', spends: false, gated: false, note: 'reads only' },
  { match: 'suggest-vocabulary-snapshot.mjs', spends: false, gated: false, note: 'reads only' },
  { match: 'stage-coverage-snapshot.mjs', spends: false, gated: false, note: 'reads only' },
  { match: 'pipeline-health-alert.mjs', spends: false, gated: false, note: 'reads control, alerts' },
  { match: 'warm-author-pages.mjs', spends: false, gated: false, note: 'HTTP warm' },
  { match: 'prewarm-browse.mjs', spends: false, gated: false, note: 'HTTP warm' },
  { match: 'catalog-csv-snapshot.mjs', spends: false, gated: false, note: 'reads only' },
  { match: 'cron-caller.mjs', spends: true, gated: false,
    note: 'CALLS VERCEL CRONS — social-post reaches tweet-generator (Gemini). Small and fixed-rate (8/day), but outside the dial.' },
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
for (const s of spenders) {
  console.log(`  ${s.gated ? '[dial]' : '[OPEN]'} ${s.match} — ${s.note}`);
}
console.log(`\nTraffic-driven routes outside the dial by construction: ${NOT_GATED_BY_DESIGN.length}`);
console.log('  (spend scales with visitors and bots; the dial cannot see them)');
for (const r of NOT_GATED_BY_DESIGN) console.log(`  [OPEN] ${r}`);

console.log('');
if (findings.length === 0) {
  console.log('PASS — every spending orchestrator phase asks the dial, and every schedule is classified.');
} else {
  console.log(`FAIL — ${findings.length} finding(s):\n`);
  for (const f of findings) console.log(`  ${f.kind}: ${f.what}\n    ${f.why}`);
}

process.exit(CI && findings.length ? 1 : 0);
