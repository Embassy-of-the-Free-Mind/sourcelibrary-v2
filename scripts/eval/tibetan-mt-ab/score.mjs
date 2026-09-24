#!/usr/bin/env node
// PRIOR ART: scripts/eval/translation-batch-shadow-judge.mjs --report — decodes a blinded key,
// reads the A/A pairs first, sign tests; it reports LEFT/RIGHT/TIE on seams, not a 1–5 rubric over
// three engines with two judges, and has no positive control. scripts/eval/ft-reliability-report.ts
// computes judge agreement for the FT ladder over a different row shape.
/** Decode the #4742 judge verdicts against the key: controls first (positive control, same-arm tie rate), per-engine fidelity / omission / invention / inversion per judge, judge agreement, both pre-registered decision rules, cost and latency per engine, one results JSON. */
/**
 *   node scripts/eval/tibetan-mt-ab/score.mjs --packet <dir> --arms <dir> --verdicts opus=<file>,sonnet=<file> --out <results.json>
 * <dir>/key.json from build-judge-packet.mjs; verdict files are the judges' JSONL (one line per page).
 */
import fs from 'node:fs';
import path from 'node:path';

const args = process.argv.slice(2);
const opt = (n, d) => { const i = args.indexOf(`--${n}`); return i >= 0 && args[i + 1] != null ? args[i + 1] : d; };
const PACKET = opt('packet'); const ARMS = opt('arms'); const OUT = opt('out');
const VERDICTS = Object.fromEntries(opt('verdicts', '').split(',').filter(Boolean).map((s) => s.split('=')));
if (!PACKET || !ARMS || !OUT || !Object.keys(VERDICTS).length) { console.error('--packet, --arms, --verdicts, --out required'); process.exit(1); }

const key = JSON.parse(fs.readFileSync(path.join(PACKET, 'key.json'), 'utf8'));
const ENGINES = ['flash', 'lite', 'mitra'];
const MODEL = { flash: 'gemini-3-flash-preview', lite: 'gemini-3.1-flash-lite' };
const pageIds = Object.keys(key.pages);
const testPages = pageIds.filter((id) => id !== key.positive_control_page);

const readJsonl = (f) => fs.readFileSync(f, 'utf8').split('\n').filter((l) => l.trim()).map((l) => JSON.parse(l));
const median = (a) => { const s = [...a].sort((x, y) => x - y); const m = s.length >> 1; return s.length ? (s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2) : null; };
const mean = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : null);
const r3 = (x) => (x == null ? null : Math.round(x * 1000) / 1000);
const rankOf = (ranking, label) => ranking.findIndex((tier) => tier.includes(label));

const out = { generated: new Date().toISOString(), seed: key.seed, pages: pageIds.length, test_pages: testPages.length, judges: {}, controls: {}, engines: {}, rules: {}, agreement: {} };

// ── per judge: decode ────────────────────────────────────────────────────────
const decoded = {}; // judge → id → arm → {fidelity, omission, invention, inversion, rank}
for (const [judge, file] of Object.entries(VERDICTS)) {
  const rows = readJsonl(file);
  decoded[judge] = {};
  const missing = pageIds.filter((id) => !rows.find((r) => r.id === id));
  for (const r of rows) {
    const map = key.pages[r.id];
    if (!map) continue;
    decoded[judge][r.id] = {};
    for (const [label, arm] of Object.entries(map)) {
      const sc = r.scores?.[label];
      if (!sc) continue;
      decoded[judge][r.id][arm] = { ...sc, rank: rankOf(r.ranking || [], label), label };
    }
    decoded[judge][r.id]._reason = r.reason;
    decoded[judge][r.id]._confidence = r.confidence;
  }
  out.judges[judge] = { file, pages_scored: rows.length, missing };
}

// ── controls FIRST ───────────────────────────────────────────────────────────
out.controls.positive = {};
out.controls.same_arm = {};
for (const judge of Object.keys(decoded)) {
  const pc = decoded[judge][key.positive_control_page]?.reference;
  out.controls.positive[judge] = pc ? { fidelity: pc.fidelity, invention: pc.invention, omission: pc.omission, rank: pc.rank, pass: pc.fidelity === 5 && !pc.invention } : { pass: false, note: 'not scored' };
  const pairs = [];
  for (const [id, dup] of Object.entries(key.same_arm_pages)) {
    const a = decoded[judge][id]?.[dup], b = decoded[judge][id]?.[`${dup}#dup`];
    if (!a || !b) continue;
    const tie = a.fidelity === b.fidelity && a.rank === b.rank && a.omission === b.omission && a.invention === b.invention;
    pairs.push({ id, engine: dup, fidelity: [a.fidelity, b.fidelity], rank: [a.rank, b.rank], tie });
  }
  out.controls.same_arm[judge] = { pairs, n: pairs.length, ties: pairs.filter((p) => p.tie).length, tie_rate: r3(pairs.length ? pairs.filter((p) => p.tie).length / pairs.length : null) };
}

// ── per engine, per judge (test pages only; the same-arm duplicate label is ignored) ──
for (const arm of ENGINES) {
  out.engines[arm] = { by_judge: {} };
  for (const judge of Object.keys(decoded)) {
    const rows = testPages.map((id) => decoded[judge][id]?.[arm]).filter(Boolean);
    const fid = rows.map((r) => r.fidelity);
    out.engines[arm].by_judge[judge] = {
      n: rows.length,
      fidelity_median: median(fid), fidelity_mean: r3(mean(fid)),
      omission_rate: r3(mean(rows.map((r) => (r.omission ? 1 : 0)))),
      invention_rate: r3(mean(rows.map((r) => (r.invention ? 1 : 0)))),
      inversion_rate: r3(mean(rows.map((r) => (r.inversion ? 1 : 0)))),
      rank_mean: r3(mean(rows.map((r) => r.rank + 1))),
      first_place: rows.filter((r) => r.rank === 0).length,
    };
  }
  // pooled across judges (each judge-page is one row)
  const rows = Object.keys(decoded).flatMap((judge) => testPages.map((id) => decoded[judge][id]?.[arm]).filter(Boolean));
  const fid = rows.map((r) => r.fidelity);
  out.engines[arm].pooled = { n: rows.length, fidelity_median: median(fid), fidelity_mean: r3(mean(fid)), invention_rate: r3(mean(rows.map((r) => (r.invention ? 1 : 0)))), omission_rate: r3(mean(rows.map((r) => (r.omission ? 1 : 0)))), inversion_rate: r3(mean(rows.map((r) => (r.inversion ? 1 : 0)))) };
  // cost + latency from the arm outputs
  const files = testPages.map((id) => (arm === 'mitra' ? path.join(ARMS, 'mitra', `${id}.json`) : path.join(ARMS, 'gemini', MODEL[arm], `${id}.json`))).filter((f) => fs.existsSync(f)).map((f) => JSON.parse(fs.readFileSync(f, 'utf8')));
  if (arm === 'mitra') {
    out.engines[arm].run = { pages: files.length, ms_mean: r3(mean(files.map((f) => f.ms_total))), out_tokens_mean: r3(mean(files.map((f) => f.completion_tokens))), cost_note: 'self-hosted; see engines.mitra.projection' };
  } else {
    out.engines[arm].run = { pages: files.length, ms_mean: r3(mean(files.map((f) => f.ms))), in_tokens_mean: r3(mean(files.map((f) => f.inputTokens))), out_tokens_mean: r3(mean(files.map((f) => f.outputTokens))), usd_per_page_realtime: r3(mean(files.map((f) => f.cost_usd))), usd_per_page_batch: r3(mean(files.map((f) => f.cost_usd)) / 2), finish: Object.fromEntries(files.map((f) => [f.finishReason, files.filter((g) => g.finishReason === f.finishReason).length])) };
  }
}

// ── pairwise per page: MITRA vs flash on fidelity (issue rule), per judge ────
out.rules.issue = { rule: 'MITRA wins fidelity on >= 15/20 pages → hold the $430 batch', by_judge: {} };
for (const judge of Object.keys(decoded)) {
  let win = 0, loss = 0, tie = 0;
  for (const id of testPages) {
    const m = decoded[judge][id]?.mitra, f = decoded[judge][id]?.flash;
    if (!m || !f) continue;
    if (m.fidelity > f.fidelity) win++; else if (m.fidelity < f.fidelity) loss++; else tie++;
  }
  out.rules.issue.by_judge[judge] = { mitra_wins: win, flash_wins: loss, ties: tie, n: win + loss + tie, threshold: Math.ceil(0.75 * (win + loss + tie)), met: win >= Math.ceil(0.75 * (win + loss + tie)) };
}
out.rules.issue.met_by_any_judge = Object.values(out.rules.issue.by_judge).some((j) => j.met);

// ── handoff rule: cheapest engine within 0.5 median fidelity of the best AND invention <= best + 5pp ──
const COST_ORDER = ['lite', 'flash', 'mitra']; // by projected $/page, cheapest first (mitra self-hosted ≈ flash-batch order; see report)
out.rules.handoff = { rule: 'cheapest engine whose median fidelity is within 0.5 of the best AND invention rate <= best + 5pp (pooled over judges)', cost_order: COST_ORDER };
const best = ENGINES.reduce((b, a) => (out.engines[a].pooled.fidelity_median > (out.engines[b]?.pooled.fidelity_median ?? -1) ? a : b), null);
const bestInv = Math.min(...ENGINES.map((a) => out.engines[a].pooled.invention_rate));
out.rules.handoff.best_fidelity_engine = best;
out.rules.handoff.eligible = ENGINES.filter((a) => out.engines[a].pooled.fidelity_median >= out.engines[best].pooled.fidelity_median - 0.5 && out.engines[a].pooled.invention_rate <= bestInv + 0.05);
out.rules.handoff.pick = COST_ORDER.find((a) => out.rules.handoff.eligible.includes(a)) || null;
out.rules.handoff.specialist_wins_by_1 = out.engines.mitra.pooled.fidelity_median - Math.max(out.engines.flash.pooled.fidelity_median, out.engines.lite.pooled.fidelity_median) >= 1;

// ── judge agreement ──────────────────────────────────────────────────────────
const judges = Object.keys(decoded);
if (judges.length === 2) {
  const [J1, J2] = judges;
  let same = 0, n = 0, diffs = [], topSame = 0, topN = 0;
  for (const id of testPages) for (const arm of ENGINES) {
    const a = decoded[J1][id]?.[arm], b = decoded[J2][id]?.[arm];
    if (!a || !b) continue;
    n++; if (a.fidelity === b.fidelity) same++; diffs.push(Math.abs(a.fidelity - b.fidelity));
  }
  for (const id of testPages) {
    const t1 = ENGINES.filter((a) => decoded[J1][id]?.[a]?.rank === 0), t2 = ENGINES.filter((a) => decoded[J2][id]?.[a]?.rank === 0);
    if (!t1.length || !t2.length) continue;
    topN++; if (t1.some((a) => t2.includes(a))) topSame++;
  }
  out.agreement = { judges: [J1, J2], fidelity_exact: r3(same / n), fidelity_within_1: r3(diffs.filter((d) => d <= 1).length / n), fidelity_mean_abs_diff: r3(mean(diffs)), top_rank_shared: r3(topSame / topN), n_cells: n, n_pages: topN };
}

// ── per page table ───────────────────────────────────────────────────────────
out.per_page = testPages.map((id) => ({ id, ...Object.fromEntries(judges.map((j) => [j, Object.fromEntries(ENGINES.map((a) => [a, decoded[j][id]?.[a] ? `${decoded[j][id][a].fidelity}${decoded[j][id][a].invention ? 'I' : ''}${decoded[j][id][a].omission ? 'O' : ''}${decoded[j][id][a].inversion ? 'X' : ''}` : null]))])), reasons: Object.fromEntries(judges.map((j) => [j, decoded[j][id]?._reason])) }));

fs.writeFileSync(OUT, JSON.stringify(out, null, 1));
console.log(JSON.stringify({ controls: out.controls, engines: Object.fromEntries(ENGINES.map((a) => [a, out.engines[a].pooled])), rules: { issue: out.rules.issue.by_judge, handoff: { pick: out.rules.handoff.pick, eligible: out.rules.handoff.eligible, best: best } }, agreement: out.agreement }, null, 1));
