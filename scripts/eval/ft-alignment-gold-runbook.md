# Tier-0 Alignment-Gold Harness — runbook (#2885b)

Measures whether the First-Translation **Tier-0 alignment layer** links correctly:
when Tier-0 links a book to a `translation_catalogs` prior (→ auto-demote) or
co-clusters two editions under one `work_id`, *is that link right?* A wrong link is
an FT error in disguise — a **false merge** → false demote, or a **false split** →
a real prior goes unmatched.

The unit of measurement is a **same-work pair judgment** (`same: y/n`). Three strata:

| kind | pair | `same:false` means | `same:true` means |
|---|---|---|---|
| `link` | book ↔ catalog row (the Tier-0 match) | **false merge** (auto-demote would be wrong) | correct demote (real prior) |
| `cocluster` | book ↔ book, same `work_id` (#2318) | cluster impurity | homogeneous cluster |
| `split` | book ↔ book, DIFFERENT `work_id`, title-family collision | correctly separated | **false split** (recall miss) |

**This is pure measurement — no badge flips, no DB writes.** Everything lands in
`scripts/eval/results/`.

## The scripts (pipeline order)

1. **`ft-catalog-match.mjs`** — the production Tier-0 matcher. #2885 exported
   `matchBookToCatalog(book, bySurname)` + `buildCatalogIndex(catRows)` + the guards
   from it so the draw reuses the *real* guarded matcher (never a re-implementation —
   a simplified re-match is the "sampler-strawman" that faked false-merges in #2880 R2).
   Importing the module does NOT run a catalog scan (guarded by `import.meta.url`).
2. **`ft-alignment-gold-draw.mjs`** — read-only stratified draw (seeded, `--seed 42`).
   Emits `ft-alignment-gold-<date>.json` (judge-visible, neutral metadata only) +
   `ft-alignment-scoringkey-<date>.json` (HIDDEN — stratum/guards/work_id; never shown
   to a judge). LINK demote_candidates are a **census** (only ~22 exist corpus-wide —
   catalog is Latin-only, #2899); cocluster/split are true samples, oversampling the
   generic-title / namesake-prone slice where false merges concentrate.
3. **`ft-alignment-judge-auto.mjs`** — J0, the cheap deterministic metadata oracle.
   **Defers ALL `link` and `split` pairs to J1** (it cannot judge them safely —
   confirming a link is circular; rejecting on a series-key is unreliable because
   catalog/normalized titles hide volume/section distinctions). Auto-resolves only the
   unambiguous `same` on `cocluster` pairs as a pre-screen. Writes
   `ft-alignment-verdicts-auto-<date>.json`.
4. **`ft-alignment-j1-prompts.mjs`** — emits one unprimed same-work prompt per target
   pair (`--kind link|cocluster|split`, `--tier demote_candidate|needs_review`,
   `--hard-only`). J1 = independent Claude subagents, one per pair, shown ONLY the two
   records' metadata. Each returns strict JSON
   `{pair_id, same:true|false|"uncertain", basis, reason, sources}`.
5. **`ft-alignment-merge-j1.mjs`** — unions J1 verdicts (orchestrator-collected
   `-manual-<date>.json` + per-pair files under `alignment-oracle-<date>/`) →
   `ft-alignment-verdicts-j1-<date>.json`.
6. **`ft-alignment-score.ts`** (`npx tsx`) — reads manifest + hidden key + merged
   verdicts (J1 precedence over J0); reports link precision / co-cluster homogeneity /
   split (recall) rate by stratum with Wilson 95% CIs (reused from
   `src/lib/first-translation/inference.ts`). Writes `ft-alignment-report-<date>.md`.
   Labels each metric J1-verified vs J0-preliminary; reports unresolved pairs as
   coverage, never silently dropped.

## Run it end-to-end

```sh
set -a; source .env.local; set +a          # MONGODB_URI (read-only)
node scripts/eval/ft-alignment-gold-draw.mjs --seed 42
node scripts/eval/ft-alignment-judge-auto.mjs
# J1 on the decision-critical link census (spawn one subagent per emitted prompt):
node scripts/eval/ft-alignment-j1-prompts.mjs --kind link --tier demote_candidate
#   → run each prompt as an independent unprimed subagent; collect verdicts into
#     ft-alignment-verdicts-j1-manual-<date>.json, OR have each write its own file into
#     scripts/eval/results/alignment-oracle-<date>/<pair_id>.json
node scripts/eval/ft-alignment-merge-j1.mjs
npx tsx scripts/eval/ft-alignment-score.ts
```

To extend J1 to the co-cluster / split strata (not run in the first pass for cocluster):
`node scripts/eval/ft-alignment-j1-prompts.mjs --kind cocluster` → run → merge → re-score.

## First-run result (2026-07-06, seed 42)

- **Link precision (J1-verified, N=22 acted-on demote_candidate links): 72.7% (16/22)
  [51.8–86.8%]; generic-namesake stratum 66.7% (12/18) [43.7–83.7%].**
- **All 6 false merges are the same signature:** a single numbered volume
  ("Opera Omnia Vol. N") matched to a whole-corpus catalog row ("Opera omnia").
  → **Tier-0 is NOT safe to auto-demote there without a Tier-2 check; the matcher wants
  a volume/container guard** (our item is one volume of a set, the prior is the whole,
  or vice versa).
- Split (recall) false-split rate 40% (12/30): real under-merges are edition/spelling
  variants of one work; the correctly-separated ones are genuinely distinct volumes/works
  (Kant's two Critiques, Aquinas Book I vs II of the Sentences).
- Co-cluster homogeneity is J0-preliminary (100% of 15 confident pairs — an upper bound;
  run J1 to verify).
- Bonus (catalog-quality, orthogonal to alignment): three Pico "Opera Omnia" links are
  correctly *aligned* but the catalog "prior" is a **1969 Latin facsimile reprint, not an
  English translation** — a completeness/kind-of-record issue for the guards, not a merge error.

Full report + numbers: `scripts/eval/results/ft-alignment-report-2026-07-06.md`;
ledger row in `.claude/docs/ft-eval-runs-ledger.md`.
