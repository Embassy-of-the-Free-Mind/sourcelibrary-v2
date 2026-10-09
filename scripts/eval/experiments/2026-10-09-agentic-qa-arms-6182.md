<!-- PRIOR ART: scripts/eval/experiments/2026-10-08-canon-set-judged-6331.md (same 138 units, judge prompt, gate, by-text bootstrap; this adds two check-and-revise arms and re-judges C38 as the anchor). -->
# Agentic QA translation arms on the 138-unit canon set (#6182, job agentic-qa-6182)

**Question (Derek, 2026-10-09):** "it may be possible to do more quality translations with Claude Sonnet in agentic
flows that incorporate QA than the cheap one-shot Gemini." We measure the quality gain and what it costs in
subscription capacity.

## Preregistration (committed before any judge output exists)

**Units.** The 138 units of #6331 (75 Chinese CBETA/Kanripo passages, 23 Sanskrit pages, 40 Pali pages):
`/root/cli-set-6331/units.jsonl`. Published references never go to an arm and are never committed.

**Arms** (Claude Sonnet 5.5 via `claude -p` on the subscription, one fresh process per step, no tools, no API key):
- **SA, "Sonnet agentic":** a *draft* (SAd) made with the unit's existing prompt, unchanged; then a **check** by a fresh
  Sonnet process that sees only the source text and the draft, and lists reversals, omissions, mistranslations and
  unsupported additions, each with its source span; then a **revise** step (a fresh process with source, draft and
  findings) that applies only the listed fixes. When the check lists nothing, the final is the draft and no revise call
  is made.
- **GQ, "Gemini draft + Sonnet QA":** the stored C38 output (Gemini 3.8 Flash through the CLI, #6331) as the draft,
  then the same check and revise steps.
- **C38** (stored) is the anchor and the comparator.

Every row records calls and input / output / cache-read / cache-write tokens and start/end UTC per step.

**Judging.** The #6182 xl judge prompt verbatim (`/mnt/HC_Volume_105839809/jobs/judge-set-6331/judge/PROMPT.md`), two
blind Opus judges, both on every item. Candidates per item: C38, SAd, SA, GQ, with identical texts merged into one
candidate (a final identical to its draft is one label scored for both arms). Controls as #6331: 8 PLANT (SA final
beside a copy with one planted reversal) and 4 DUP (SA, an identical copy, C38).

**Gate.** Per judge: plants caught (reversal listed or lower fidelity) ≥ 6/8 and duplicates tied ≥ 3/4. Only judges
who pass are scored. **Anchor check:** per language, the re-judged C38 mean fidelity must be within 0.10 of its stored
#6331 score (Chinese 4.31, Sanskrit 4.39, Pali 4.67, from `scripts/eval/results/canon-ref-6331/judge/scores.json`). If
any language fails, the runs are reported as not comparable and no verdict is drawn.

**Primary measures**, per language (Chinese, Sanskrit, Pali) and pooled, for SA and GQ against C38 (and SA against SAd,
descriptively):
1. Paired fidelity difference (arm − C38; the per-page mean of the passing judges), with a by-text (work-clustered)
   bootstrap 95% CI, 2,000 resamples, seed 6182.
2. Reversal + omission pages per 100: a page counts if either judge flags a reversal or an omission on it. Compared by a
   paired exact two-sided sign test over the discordant pages.
3. Fill pages: a page counts if either judge types an invention as `unreadable_fill`. Paired one-sided exact sign test
   for a rise.

**Rule.** An arm **earns its cost** in a stratum only if
(fidelity difference ≥ +0.15 **and** its CI lower bound > 0) **or** (reversal + omission pages fall **and** the sign test
gives p < 0.05), **and** fill pages do not rise (one-sided sign test p ≥ 0.05). Strata with fewer than 10 units are
descriptive only.

**Check precision.** For each finding on a draft that was judged (SAd, and C38 as GQ's draft): a reversal finding is
confirmed if a judge flags a reversal on that draft; an omission finding if a judge flags an omission; a mistranslation
or addition finding if a judge's reversal, defect or invention quote overlaps the finding's draft span (a shared
normalised substring of ≥ 6 characters). Precision = confirmed / findings, by type. Judges miss errors, so this is a
lower bound.

**Capacity.** Per arm: tokens per page by type (input, output, cache read, cache write), calls per page,
API-equivalent $ per 1,000 pages at list price (the CLI's `costUSD`, cost basis "list"), and weekly points per 1,000
pages at $24.8 per point (the `claude-limits` calibration, made on a mostly-Opus mix; the Sonnet meter rate is
unmeasured). GQ's Gemini draft uses the Google subscription and no Claude capacity.

**By eye.** The 15 units where an arm's final differs most from its draft (normalised edit distance), read from text
(no page image) by an Opus reader against the source, judging whether each change was right.

## Results

(pending)
