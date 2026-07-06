#!/usr/bin/env npx tsx
/**
 * Scorer for the #2885(b) Tier-0 alignment gold.  PURE READ — writes only a report.
 *
 * Reads the manifest, the HIDDEN scoring key, and the merged same-work verdicts
 * (J0 metadata auto-judge + J1 independent Claude subagents; J1 takes precedence),
 * and reports, by stratum, with Wilson 95% CIs (reused from
 * src/lib/first-translation/inference.ts):
 *
 *   • LINK precision      — of the Tier-0 catalog links Tier-0 would AUTO-DEMOTE on
 *                           (matcher_tier=demote_candidate), what fraction are truly
 *                           the same work? A `same:false` = a FALSE MERGE = a wrong
 *                           auto-demote. This is the go/no-go the issue asks for.
 *   • guard rejection     — of the needs_review links (a guard fired, so NOT demoted),
 *                           what fraction are truly different? `same:true` here = the
 *                           guard SUPPRESSED a real prior (a miss → risk of false-first).
 *   • cocluster homogeneity — of work_id co-cluster pairs, fraction same-work; sliced
 *                           by work_id_source / confidence. `same:false` = cluster impurity.
 *   • split (recall)      — of title-family cross-work_id pairs, fraction that are
 *                           actually the SAME work (`same:true`) = FALSE SPLIT / recall miss.
 *   • J0↔J1 agreement     — data-quality check on the cheap oracle (pairs judged by both).
 *
 * Usage: npx tsx scripts/eval/ft-alignment-score.ts [--date YYYY-MM-DD]
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { wilsonInterval, Z_95 } from '@/lib/first-translation/inference';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const RESULTS_DIR = path.join(__dirname, 'results');
const dateArg = process.argv.indexOf('--date');
const DATE = dateArg !== -1 && process.argv[dateArg + 1] ? process.argv[dateArg + 1] : new Date().toISOString().slice(0, 10);

type Same = boolean | 'uncertain' | null;
interface Verdict { pair_id: string; same: Same; basis?: string; reason?: string; sources?: string[]; }

const readJson = (p: string): any => JSON.parse(fs.readFileSync(p, 'utf8'));
const results = (name: string) => path.join(RESULTS_DIR, name);

const gold = readJson(results(`ft-alignment-gold-${DATE}.json`));
const key: Record<string, any> = readJson(results(`ft-alignment-scoringkey-${DATE}.json`));
const auto: Verdict[] = readJson(results(`ft-alignment-verdicts-auto-${DATE}.json`));

const j1Path = results(`ft-alignment-verdicts-j1-${DATE}.json`);
const j1: Verdict[] = fs.existsSync(j1Path) ? readJson(j1Path) : [];

const kindOf: Record<string, string> = Object.fromEntries(gold.manifest.map((p: any) => [p.pair_id, p.kind]));
const manifestOf: Record<string, any> = Object.fromEntries(gold.manifest.map((p: any) => [p.pair_id, p]));

// Merge: J1 (independent oracle) takes precedence over J0 (metadata) where both exist.
const autoMap = new Map(auto.map((v) => [v.pair_id, v]));
const j1Map = new Map(j1.map((v) => [v.pair_id, v]));
const merged = new Map<string, { same: Same; source: 'j1' | 'j0' }>();
for (const pid of Object.keys(key)) {
  const a = autoMap.get(pid);
  const b = j1Map.get(pid);
  if (b && (b.same === true || b.same === false || b.same === 'uncertain')) merged.set(pid, { same: b.same, source: 'j1' });
  else if (a) merged.set(pid, { same: a.same, source: 'j0' });
}

const isResolved = (s: Same): s is boolean => s === true || s === false;

/** Precision-style stat over a set of pair_ids using a predicate for "success". */
function stat(pids: string[], success: (same: boolean) => boolean) {
  const judged = pids.map((p) => merged.get(p)).filter(Boolean) as { same: Same; source: string }[];
  const resolved = judged.filter((v) => isResolved(v.same)) as { same: boolean }[];
  const unresolved = judged.length - resolved.length; // uncertain
  const unjudged = pids.length - judged.length;        // hard, no J1 yet
  const succ = resolved.filter((v) => success(v.same)).length;
  const n = resolved.length;
  const [lo, hi] = n > 0 ? wilsonInterval(succ, n, Z_95) : [0, 0];
  return { n_total: pids.length, n_resolved: n, succ, rate: n ? succ / n : NaN, lo, hi, unresolved, unjudged };
}

const pct = (x: number) => (Number.isNaN(x) ? '—' : `${(x * 100).toFixed(1)}%`);
const ci = (s: ReturnType<typeof stat>) => (s.n_resolved ? `${pct(s.rate)} (${s.succ}/${s.n_resolved}) [${pct(s.lo)}–${pct(s.hi)}]` : '— (0 resolved)');

const pidsWhere = (pred: (k: any) => boolean) => Object.entries(key).filter(([, v]) => pred(v)).map(([pid]) => pid);
const label = (pid: string) => {
  const m = manifestOf[pid];
  const r = m.right.english_title || m.right.title;
  return `${m.left.title} / ${m.left.author}  ⇔  ${r}`;
};

const L: string[] = [];
L.push(`# Tier-0 Alignment Gold — #2885(b)  (${DATE})`);
L.push('');
L.push(`**MEASURE-ONLY — no badge flips, no DB writes.** Answers: *is Tier-0 precise enough to auto-short-circuit (demote without an LLM), or must each match be verified?*`);
L.push('');
L.push(`Draw: ${gold.summary.n} pairs, seed ${gold.summary.seed}, over ${gold.summary.eligible_books} eligible books / ${gold.summary.catalog_rows} catalog rows.`);
const j1n = [...merged.values()].filter((v) => v.source === 'j1').length;
const unresolved = Object.keys(key).filter((p) => { const v = merged.get(p); return !v || !isResolved(v.same); }).length;
// How many J1 verdicts exist per kind — a metric is "J1-verified" only if its kind has them.
const j1KindCount = (kind: string) => Object.keys(key).filter((p) => key[p].kind === kind && j1Map.has(p) && isResolved(j1Map.get(p)!.same as Same)).length;
L.push(`Verdicts: ${merged.size} merged (${j1n} from J1 independent subagents, ${merged.size - j1n} from J0 metadata). ${unresolved} pairs remain unresolved (J0 deferred, no J1 verdict yet) — excluded from rates and reported as coverage, never silently dropped.`);
L.push('');

// ── LINK precision (the headline) ──────────────────────────────────────────────
L.push('## 1. Link precision — the auto-demote go/no-go');
L.push('');
L.push('A catalog link with `same:false` is a **false merge** — Tier-0 would demote a genuine first. Census of ALL demote_candidate links + a sample of needs_review.');
L.push('');
L.push('| stratum | link precision [Wilson 95%] |');
L.push('|---|---|');
const linkDemote = pidsWhere((k) => k.kind === 'link' && k.matcher_tier === 'demote_candidate');
const sDemote = stat(linkDemote, (same) => same === true);
L.push(`| demote_candidate (ACTED ON) | ${ci(sDemote)} |`);
for (const strat of ['link · generic-namesake', 'link · specific']) {
  const pids = pidsWhere((k) => k.kind === 'link' && k.matcher_tier === 'demote_candidate' && k.stratum === strat);
  if (pids.length) L.push(`| ↳ ${strat} | ${ci(stat(pids, (s) => s === true))} |`);
}
L.push('');
const falseMerges = linkDemote.filter((p) => merged.get(p)?.same === false);
if (falseMerges.length) {
  L.push(`**False merges among acted-on links (${falseMerges.length}):**`);
  for (const p of falseMerges) L.push(`- ${label(p)} — _${(j1Map.get(p) || autoMap.get(p))?.reason ?? ''}_`);
  L.push('');
}
// guard rejection quality on needs_review
const linkReview = pidsWhere((k) => k.kind === 'link' && k.matcher_tier === 'needs_review');
const sReview = stat(linkReview, (same) => same === false); // success = guard correctly rejected a non-same-work
L.push(`**Guard-rejection quality** (needs_review links, guard fired → NOT demoted): correctly-different ${ci(sReview)}. A \`same:true\` here = a guard suppressed a real prior (miss → false-first risk).`);
const guardMisses = linkReview.filter((p) => merged.get(p)?.same === true);
if (guardMisses.length) { L.push(''); L.push(`Guard-suppressed real priors (${guardMisses.length}): ` + guardMisses.map((p) => manifestOf[p].left.title).join('; ')); }
L.push('');

// ── Cocluster homogeneity ──────────────────────────────────────────────────────
L.push('## 2. work_id co-cluster homogeneity');
L.push('');
L.push('Two of our books sharing a `work_id`. `same:false` = cluster impurity (a false merge in clustering).');
if (j1KindCount('cocluster') === 0) {
  L.push('');
  L.push('> ⚠️ **J0 PRE-SCREEN ONLY (preliminary, not independently verified).** These rates come from the cheap metadata oracle, which is blind to volume-level impurity (it cannot see distinctions normalization strips) and is therefore biased toward `same` — treat as an upper bound. To verify: `node scripts/eval/ft-alignment-j1-prompts.mjs --kind cocluster` → run J1 → `ft-alignment-merge-j1.mjs` → re-score.');
}
L.push('');
const cocl = pidsWhere((k) => k.kind === 'cocluster');
L.push(`Overall: ${ci(stat(cocl, (s) => s === true))}`);
L.push('');
L.push('| slice | homogeneity [Wilson 95%] |');
L.push('|---|---|');
const bySource = new Map<string, string[]>();
for (const p of cocl) { const s = key[p].work_id_source ?? 'null'; if (!bySource.has(s)) bySource.set(s, []); bySource.get(s)!.push(p); }
for (const [src, pids] of [...bySource.entries()].sort((a, b) => b[1].length - a[1].length)) {
  L.push(`| source=${src} (n=${pids.length}) | ${ci(stat(pids, (s) => s === true))} |`);
}
for (const strat of ['cocluster · generic-namesake', 'cocluster · specific']) {
  const pids = pidsWhere((k) => k.kind === 'cocluster' && k.stratum === strat);
  if (pids.length) L.push(`| ${strat} | ${ci(stat(pids, (s) => s === true))} |`);
}
L.push('');
const impure = cocl.filter((p) => merged.get(p)?.same === false);
if (impure.length) { L.push(`**Impure co-clusters (${impure.length}):**`); for (const p of impure) L.push(`- [${key[p].work_id}] ${label(p)}`); L.push(''); }

// ── Split / recall ───────────────────────────────────────────────────────────
L.push('## 3. Split candidates — clustering recall (under-merges)');
L.push('');
L.push('Title-family collisions across DIFFERENT `work_id`s (series-guard-cleared). `same:true` = a **false split** — one work scattered across work_ids, so a real prior could go unmatched.');
L.push(j1KindCount('split') > 0 ? '\n_J1-verified (independent judge; J0 defers all split pairs — it is normalization-blind here)._' : '\n> ⚠️ J0 defers all split pairs; run J1 to measure.');
L.push('');
const split = pidsWhere((k) => k.kind === 'split');
const sSplit = stat(split, (same) => same === true); // success = false split found
L.push(`False-split rate among title-family candidates: ${ci(sSplit)} are actually the same work (a recall miss). The complement were correctly separated (distinct volumes/works).`);
L.push('');
const falseSplits = split.filter((p) => merged.get(p)?.same === true);
if (falseSplits.length) { L.push(`**False splits / recall misses (${falseSplits.length}):**`); for (const p of falseSplits) L.push(`- [${key[p].work_id_left} ≠ ${key[p].work_id_right}] ${manifestOf[p].left.title} / ${manifestOf[p].left.author}`); L.push(''); }

// ── J0 vs J1 agreement ─────────────────────────────────────────────────────────
const both = Object.keys(key).filter((p) => autoMap.has(p) && j1Map.has(p) && isResolved(autoMap.get(p)!.same) && isResolved(j1Map.get(p)!.same as Same));
if (both.length) {
  const agree = both.filter((p) => autoMap.get(p)!.same === j1Map.get(p)!.same).length;
  L.push('## 4. J0 ↔ J1 agreement (cheap-oracle data-quality check)');
  L.push('');
  L.push(`Of ${both.length} pairs judged by BOTH J0 and J1, they agree on ${agree} (${pct(agree / both.length)}).`);
  L.push('');
}

// ── Decision line ───────────────────────────────────────────────────────────
L.push('## Decision');
L.push('');
const nsPids = pidsWhere((k) => k.kind === 'link' && k.matcher_tier === 'demote_candidate' && k.stratum === 'link · generic-namesake');
const ns = stat(nsPids, (s) => s === true);
if (sDemote.n_resolved === 0) {
  L.push('- **Blocked: no demote_candidate links have an independent (J1) verdict yet.** Run J1 on the link census before reading a go/no-go — J0 abstains on all links by design (see judge-auto).');
} else {
  L.push(`- Acted-on Tier-0 link precision: **${ci(sDemote)}**.`);
  if (ns.n_resolved) L.push(`- In the generic-namesake stratum (where false merges concentrate): **${ci(ns)}**.`);
  L.push(`- Go/no-go: if the **lower CI bound** in the namesake stratum falls below the tolerated false-demote rate, Tier-0 must NOT auto-short-circuit there — each such match needs a Tier-2 (LLM) check before demoting.`);
}
if (unresolved) L.push(`- Coverage caveat: ${unresolved}/${gold.summary.n} pairs remain unresolved (no J1 verdict yet — chiefly the J0-deferred co-cluster pairs); rates above cover only resolved pairs.`);
L.push('');

const report = L.join('\n');
const outPath = results(`ft-alignment-report-${DATE}.md`);
fs.writeFileSync(outPath, report);
console.log(report);
console.error(`\n[wrote ${outPath}]`);
