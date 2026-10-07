#!/usr/bin/env node
// Audit of the week's quality decisions against the decision cards (eval-design §10.2, #5873).
// Builds each decision's evidence from STORED result files and applies the card presets in
// lib/routing-rules.mjs. $0: no model call, no database.
//
// PRIOR ART: scripts/eval/routing-eval.mjs `decide` — replays ONE stored run through a rule file
// (is the candidate no worse on these pages?); it does not ask whether a run was enough for the
// money at stake. scripts/eval/results/xlref-synthesis-2026-10/build.mjs — recomputes the #5695
// tracks' figures, with no sufficiency rule. Neither audits a decision against a card.
//
// Usage: node scripts/eval/decision-cards-audit.mjs [--write]
//   --write   also write results/decision-cards-5873/audit.json and audit.md

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { cardVerdict, heterogeneity } from './lib/routing-rules.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const json = (f) => JSON.parse(fs.readFileSync(path.join(HERE, 'results', f), 'utf8'));
const jsonl = (f) => fs.readFileSync(path.join(HERE, 'results', f), 'utf8').trim().split('\n').map((l) => JSON.parse(l));
const r2 = (x) => Math.round(x * 100) / 100;

// The #5695 judge: gate passed in every packet, duplicates may tie, two blind Opus judges; never
// checked against readers (translation-corpus-audit/HUMAN-CALIBRATION.md: nothing sent yet).
const XLREF_JUDGE = { controls_pass: true, ties_allowed: true, blind_judges: 2, human_calibrated: false, absolute_threshold: false, same_family_as_candidate: false };

// A-vs-A floors (production Lite twice) are in each track's write-up, not in summary.json:
// experiments/2026-10-04-translation-vs-reference-synthesis-5695.md, Result 3, row X1.
const XLREF_FLOOR = {
  T1: { delta: -0.02, ci: [-0.16, 0.13] }, T2: { delta: 0, ci: [0, 0] }, T3: { delta: -0.03, ci: [-0.15, 0.09] },
  T4: { delta: 0.07, ci: [-0.08, 0.21] }, T5: { delta: -0.05, ci: [-0.20, 0.13] },
};
// Incremental Batch spend over the untranslated backlog, PR #5740: ≈ $0.0010 a page (Flash
// $0.0039 vs Lite $0.0019 realtime, Batch halves both); Greek 1.87M pp, Chinese 1.91M, Sanskrit
// 0.25M, each other language under 0.1M.
const XLREF_STAKE_USD = { T2: 1870, T4: 300, T5: 2260 };

/** #5740, one track at a time: Flash instead of Lite for translation. */
export function flashTranslationEvidence(track) {
  const s = json('xlref-synthesis-2026-10/summary.json');
  const langs = s.languages.filter((l) => l.track === track).map((l) => ({ lang: l.lang, n: l.flash_minus_lite.n, delta: l.flash_minus_lite.delta, ci: l.flash_minus_lite.ci }));
  const t = s.tracks.find((x) => x.track === track).flash_minus_lite;
  return {
    proposes_change: true, measure: 'judged_vs_reference', metric: 'fidelity',
    stake: { usd: XLREF_STAKE_USD[track] ?? 0, reversible: true },
    preregistered: false, // no PREREGISTRATION file for #5695; "beyond the floor" was first written post hoc in #5606
    floor: XLREF_FLOOR[track], languages: langs,
    pool: langs.length > 1 ? { name: track, n: t.n, delta: t.delta, ci: t.ci, registered: true } : null,
    judge: XLREF_JUDGE, replication: null,
  };
}

/** #5700 A5: re-OCR Lite-read served pages on Flash, then retranslate. */
export function reocrBackfillEvidence() {
  const L = json('reocr-lift-2026-10/lift.json');
  const langs = Object.entries(L.by_script_and_engine).filter(([k, v]) => k.endsWith('| served lite') && v.n >= 5)
    .map(([k, v]) => ({ lang: k.split(' | ')[0], n: v.n, delta: v.lift_lite.mean, ci: v.lift_lite.ci }));
  return {
    proposes_change: true, measure: 'judged_vs_reference', metric: 'fidelity',
    // Greek alone: $476 (Lite retranslation) to $618 (Flash); all six scripts $996–$1,293.
    stake: { usd: 618, reversible: true, changes_served_text: true, undo_proven: false },
    preregistered: false, floor: { delta: L.a_vs_a.lite.mean, ci: L.a_vs_a.lite.ci }, languages: langs, pool: null,
    judge: { ...XLREF_JUDGE, controls_pass: !L.gate.forced }, // main gate: planted 2/3, written with --force
    replication: null, sample: 'selected', usd_per_page_point: null,
  };
}

/** #5678: folio markers ON in the chained lane (B vs A, seam defects per 100 mid-sentence breaks). */
export function markersEvidence() {
  const R = json('seam-markers-confirm-5678/report.json'), pb = R.strata.pagebreak, n = pb.n;
  // Paired difference in defects per 100 breaks, Wald interval on the discordant breaks.
  const diff = (x, y) => { const d = (x - y) / n, se = Math.sqrt(x + y - (x - y) ** 2 / n) / n; return { delta: r2(100 * d), ci: [r2(100 * (d - 1.96 * se)), r2(100 * (d + 1.96 * se))] }; };
  const ba = pb.paired.both.B_vs_A, aa = pb.paired.both.A2_vs_A;
  const group = (g) => ({ lang: g, n: pb.arms.A.by_script_class[g].n, delta: r2(100 * (pb.arms.B.by_script_class[g].real_both - pb.arms.A.by_script_class[g].real_both) / pb.arms.A.by_script_class[g].n), ci: null });
  return {
    proposes_change: true, measure: 'judged', metric: 'rate_per_100', higher_is_better: false,
    stake: { usd: 0, reversible: true }, preregistered: true,
    floor: diff(aa.A2_only, aa.A_only), languages: [group('latin'), group('non_latin')],
    pool: { name: 'chained lane, mid-sentence breaks', n, ...diff(ba.B_only, ba.A_only), registered: true },
    judge: { controls_pass: R.plants.caught === R.plants.n, ties_allowed: true, blind_judges: 2, human_calibrated: false, absolute_threshold: false, same_family_as_candidate: false },
    guards_hold: R.decision.guards_hold_B,
    replication: { fresh_books: 100, passed_alone: false, pooled_registered: false }, // #5701: 15 vs 21, p 0.105, read post hoc
  };
}

/** #5795 / #5812: Persian hidden backlog to Flash OCR, decided by override; replayed with margin-v1 (#5828). */
export function persianHiddenEvidence() {
  const R = json('hidden-flash-5795/routing-eval.json');
  const g = R.groups.fas['margin-v1'];
  return {
    proposes_change: true, measure: 'routing_eval',
    stake: { usd: 80, reversible: true }, // 55.6K pages × ≈ $0.0015 (Flash $0.00283 Batch, A5, vs Lite $0.0013–$0.00225)
    preregistered: false, // margin-v1 was written after #5795's pages were seen
    negative_control_held: true, // experiments/2026-10-04-routing-eval-tool-replay-5828.md
    languages: [{ lang: 'Persian', n: g.n_text, rule_pass: g.verdict === 'route to flash' }], pool: null, replication: null,
  };
}

/** #5761: the OCR-trust gate holds four strata out of NEW translation work. */
export function ocrTrustGateEvidence() {
  const rows = jsonl('xlref-synthesis-2026-10/served-pages.jsonl');
  const T = { 10: 2.262, 11: 2.228, 12: 2.201, 13: 2.179, 14: 2.160, 15: 2.145 }; // t, 97.5 %, n − 1 df
  const cell = (stratum, f) => {
    const v = rows.filter(f).map((r) => r.fidelity), n = v.length, m = v.reduce((a, b) => a + b, 0) / n;
    const h = (T[n] ?? 1.96) * Math.sqrt(v.reduce((a, b) => a + (b - m) ** 2, 0) / (n - 1) / n);
    return { stratum, n, mean: r2(m), ci: [r2(m - h), r2(m + h)] };
  };
  return {
    kind: 'hold', preregistered: false, image_opened: true, release_rule: true, counter: true, removes_served: false,
    strata: [
      cell('Greek manuscripts', (r) => r.lang === 'Greek' && r.stratum === 'manuscript'),
      cell('Greek print 1450–1599', (r) => r.lang === 'Greek' && r.stratum === 'print 1450-1599'),
      cell('Persian', (r) => r.lang === 'Persian'),
      cell('Latin incunabula', (r) => r.lang === 'Latin' && r.stratum === '1450-1499'),
    ],
  };
}

/** Would pooling the vernaculars have been allowed (T3)? German and French point opposite ways. */
export function vernacularPooling() {
  const e = flashTranslationEvidence('T3');
  return heterogeneity(e.languages, e.pool);
}

export function audit() {
  return {
    'flash-translation-5740': { T2: cardVerdict('routing', flashTranslationEvidence('T2')), T4: cardVerdict('routing', flashTranslationEvidence('T4')), T5: cardVerdict('routing', flashTranslationEvidence('T5')) },
    'reocr-backfill-a5-5700': cardVerdict('backfill', reocrBackfillEvidence()),
    'folio-markers-5678': cardVerdict('prompt', markersEvidence()),
    'persian-hidden-flash-5795': cardVerdict('routing', persianHiddenEvidence()),
    'ocr-trust-gate-5761': cardVerdict('gate', ocrTrustGateEvidence()),
    'vernacular-pooling-t3': vernacularPooling(),
  };
}

function markdown(A) {
  const out = ['# Decision-card audit (#5873), replayed from stored results', ''];
  for (const [k, v] of Object.entries(A)) {
    for (const [sub, r] of 'sufficient' in v || 'pass' in v ? [['', v]] : Object.entries(v)) {
      out.push(`## ${k}${sub ? ` · ${sub}` : ''}`);
      if ('pass' in r) { out.push(`- pooling allowed: ${r.pass}; differ from the pool: ${r.offenders.join(', ') || 'none'}`, ''); continue; }
      out.push(`- card: ${r.card}${r.tier ? ` · tier: ${r.tier}` : ''}${r.kind ? ` · ${r.kind}` : ''} · sufficient: **${r.sufficient}**`);
      for (const [l, x] of Object.entries(r.languages ?? {})) out.push(`  - ${l}: n ${x.n}, ${x.grade}, cleared ${x.cleared}${x.short_by ? `, short by ${x.short_by}` : ''}`);
      for (const [s, x] of Object.entries(r.strata ?? {})) out.push(`  - ${s}: n ${x.n}, ${x.mean} [${x.ci.join(', ')}], ${x.status}${x.short_by ? `, ${x.short_by} books to a standing gate` : ''}`);
      for (const m of r.missing) out.push(`  - missing — ${m}`);
      out.push('');
    }
  }
  return out.join('\n');
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const A = audit(), md = markdown(A);
  if (process.argv.includes('--write')) {
    const dir = path.join(HERE, 'results', 'decision-cards-5873');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'audit.json'), JSON.stringify(A, null, 1) + '\n');
    fs.writeFileSync(path.join(dir, 'audit.md'), md + '\n');
  }
  console.log(md);
}
