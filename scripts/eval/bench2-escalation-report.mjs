#!/usr/bin/env node
// PRIOR ART: stats-cross-model.mjs does PAIRED significance (is engine A ≠ B?);
// report-arms.mjs summarises arms. Neither answers the routing question this
// bench was run for — "if a specialist goes first, what fraction of pages still
// need a Gemini call?" — which needs a per-page gate and a per-segment cost roll-up.
/**
 * bench2-escalation-report.mjs — decision rule 3 of PREREGISTRATION-bench2-print.md.
 *
 * For each language segment, take the best specialist arm, and count pages that
 * CLEAR the quality gate (specialist accuracy within GATE pp of Gemini's accuracy
 * on the same page). Pages that fail the gate are the escalation set — the ones a
 * cheap-first pipeline would still send to Gemini.
 *
 * Escalation is measured with the guard, not the reference: in production there is
 * no ground truth, so the routable signal is the alignment guard the specialist
 * itself exposes (loud failures are visible; that is the whole premise). We report
 * BOTH — gate-by-accuracy (what we could achieve with an oracle) and gate-by-guard
 * (what an actual pipeline can detect) — because the gap between them is the cost
 * of not having ground truth.
 *
 *   node scripts/eval/bench2-escalation-report.mjs [--gate=2] [--date=2026-09-03]
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { scoreAgainstReference } from './lib/metrics.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const argOf = (n) => process.argv.find(a => a.startsWith(`--${n}=`))?.slice(n.length + 3);
const GATE = parseFloat(argOf('gate') || '2');
const DATE = argOf('date') || new Date().toISOString().slice(0, 10);
const GUARD_MAX = parseFloat(argOf('guard') || '0.35');

// Gemini cost per page, measured on this bench's own scorecard run (11 pages, $0.05).
const GEMINI_USD_PER_PAGE = 0.0045;
const ENGINE_COST = {           // measured on this bench; see EXPERIMENTS.md
  'kraken-catmus-cpu': 0,       // Hetzner CPU, already paid for
  'kraken-austriannewspapers-cpu': 0,
  'surya2-l4': 0.00094,         // 4.3s/page @ EUR0.79/hr
  'churro3b-l4': 0.01435,       // 65.4s/page @ EUR0.79/hr
};

const gtDir = path.join(__dirname, 'ground-truth');
const jsonl = path.join(__dirname, 'results', `scorecard-outputs-${DATE}.jsonl`);
if (!fs.existsSync(jsonl)) { console.error(`no ${jsonl}`); process.exit(1); }

// ── load every arm's text per (work, model) ──
const byWork = new Map();
for (const line of fs.readFileSync(jsonl, 'utf8').split('\n').filter(Boolean)) {
  let r; try { r = JSON.parse(line); } catch { continue; }
  if (!r.work || !r.model || !r.text) continue;
  if (!byWork.has(r.work)) byWork.set(r.work, new Map());
  const m = byWork.get(r.work);
  // keep the best run per model (best-of-k, matching the scorecard convention)
  if (!m.has(r.model)) m.set(r.model, []);
  m.get(r.model).push(r.text);
}

// ── score every arm against its pinned reference ──
const rows = [];
for (const f of fs.readdirSync(gtDir).filter(f => f.endsWith('.json'))) {
  const gt = JSON.parse(fs.readFileSync(path.join(gtDir, f), 'utf8'));
  if (!gt.ocr_ground_truth) continue;
  const arms = byWork.get(gt.work);
  if (!arms) continue;
  const scored = {};
  for (const [model, texts] of arms) {
    let best = null;
    for (const t of texts) {
      const s = scoreAgainstReference(gt.ocr_ground_truth, t, gt.script || 'cjk');
      const acc = s.aligned ? (1 - s.cer) * 100 : null;
      if (best === null || (acc !== null && acc > best.acc)) best = { acc, guard: s.guard.value, aligned: s.aligned };
    }
    scored[model] = best;
  }
  rows.push({ slug: f.replace(/\.json$/, ''), work: gt.work, language: gt.language, scored,
    diplomatic: /(-la-|-el-|-de-)/.test(f) });
}

const SEGMENTS = {
  Latin: { engines: ['kraken-catmus-cpu', 'surya2-l4', 'churro3b-l4'], filter: r => r.language === 'Latin' },
  Greek: { engines: ['kraken-catmus-cpu', 'surya2-l4', 'churro3b-l4'], filter: r => r.language === 'Greek' },
  German: { engines: ['kraken-austriannewspapers-cpu', 'surya2-l4', 'churro3b-l4'], filter: r => r.language === 'German' },
};
const GEMINI = 'gemini-3.1-flash-lite';

console.log(`\nBench 2 — escalation analysis (gate: specialist within ${GATE}pp of Gemini; guard-gate: ≤${GUARD_MAX})\n`);
const summary = [];
for (const [seg, cfg] of Object.entries(SEGMENTS)) {
  const segRows = rows.filter(cfg.filter).filter(r => r.scored[GEMINI]);
  if (!segRows.length) continue;
  console.log(`── ${seg} (${segRows.length} pages with a Gemini score)`);
  let bestEngine = null;
  for (const eng of cfg.engines) {
    const have = segRows.filter(r => r.scored[eng]);
    if (!have.length) continue;
    const pairs = have.filter(r => r.scored[eng].acc !== null && r.scored[GEMINI].acc !== null);
    const meanDelta = pairs.length
      ? pairs.reduce((a, r) => a + (r.scored[eng].acc - r.scored[GEMINI].acc), 0) / pairs.length : null;
    // accuracy gate (oracle) and guard gate (what production can see)
    const clearAcc = pairs.filter(r => r.scored[eng].acc >= r.scored[GEMINI].acc - GATE).length;
    const clearGuard = have.filter(r => r.scored[eng].aligned && r.scored[eng].guard <= GUARD_MAX).length;
    const line = {
      seg, engine: eng, n: have.length,
      meanDeltaPp: meanDelta === null ? null : +meanDelta.toFixed(2),
      clearAccPct: pairs.length ? Math.round((clearAcc / pairs.length) * 100) : null,
      clearGuardPct: Math.round((clearGuard / have.length) * 100),
    };
    summary.push(line);
    console.log(`   ${eng.padEnd(30)} n=${String(have.length).padStart(2)}  Δ=${line.meanDeltaPp === null ? '  n/a' : (line.meanDeltaPp > 0 ? '+' : '') + line.meanDeltaPp + 'pp'}  clears-acc-gate ${String(line.clearAccPct).padStart(3)}%  clears-guard-gate ${String(line.clearGuardPct).padStart(3)}%`);
    if (!bestEngine || (line.clearGuardPct > bestEngine.clearGuardPct)) bestEngine = line;
  }
  if (bestEngine) {
    const esc = 1 - bestEngine.clearGuardPct / 100;
    const cost = ENGINE_COST[bestEngine.engine] ?? 0;
    const blended = cost + esc * GEMINI_USD_PER_PAGE;
    const saving = (1 - blended / GEMINI_USD_PER_PAGE) * 100;
    console.log(`   → cheap-first with ${bestEngine.engine}: escalate ${Math.round(esc * 100)}% of pages`);
    console.log(`     blended $${blended.toFixed(5)}/page vs Gemini $${GEMINI_USD_PER_PAGE.toFixed(5)} = ${saving.toFixed(0)}% cheaper`);
    console.log(`     ${bestEngine.clearGuardPct >= 70 ? 'PASSES' : 'FAILS'} preregistered rule 3 (≥70% clear the gate)\n`);
  }
}
fs.writeFileSync(path.join(__dirname, 'results', `bench2-escalation-${DATE}.json`),
  JSON.stringify({ date: DATE, gate_pp: GATE, guard_max: GUARD_MAX, gemini_usd_per_page: GEMINI_USD_PER_PAGE, engine_cost: ENGINE_COST, summary }, null, 2));
console.log(`Written: results/bench2-escalation-${DATE}.json`);
