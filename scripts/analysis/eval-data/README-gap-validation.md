# Translation-gap validation (n=1000) — dataset & runbook

The released dataset and reproducible pipeline behind the validated Latin
translation-gap figure (issue #2684, scaling the #2626 pilot). Plain-language
write-up: `.claude/docs/translation-gap-methodology.md`. Full method + results:
`.claude/docs/translation-gap-paper.md`. Architecture context:
`.claude/docs/translation-works-architecture.md`.

## The validated headline

Of genuinely **Renaissance-composed** Latin works, **~93% [91–95]** have no prior
English translation (debiased, n=1000, Gemini primary + independent Claude cross-check
on a 294-work overlap κ=0.82; fully-dual n=250 core κ=0.88). For the
**all-print** USTC denominator the gap is **~85% [82–87]** — *lower* than the raw
97%, because translated ancient/medieval classics reprinted in the window hide in
the "gap". **The denominator is the story; never quote the bare 97%.**

## Files in this directory

| file | what it is |
|---|---|
| `gap-validation-n250-frame.json` | answer key: the 250 sampled clusters with pipeline label + matched sources + era |
| `gap-validation-n250-blind.json` | the same 250, labels stripped + reshuffled — the adjudicator input |
| `gap-validation-claude-verdicts.jsonl` | primary instrument verdicts (Claude tool-agent) w/ queries + source URLs |
| `gap-validation-gemini-verdicts.jsonl` | 2nd-model verdicts (Gemini grounded search) w/ queries + sources |
| `gap-validation-tiebreak-verdicts.jsonl` | third strict-completeness pass on the 10 disagreements |
| `gap-validation-n250-results.json` | per-work joined table + precision / gap-by-era / Wilson CIs / κ |
| `gap-validation-n250-estimate.json` | debiased population estimate (era post-stratified, bootstrap CIs) |
| `gap-validation-gold-subset.json` + `-gold-review.html` | the 40-work human-gold subset + offline review page |
| `translation-gap-validation-2026-06-21.json` | the original n=30 pilot artifact (superseded) |

## Reproduce

Scripts live in `scripts/analysis/`. Steps 0a/0b need
`set -a; source .env.production.local; set +a` (Supabase + Gemini keys).

```bash
# 0a. Rebuild the sampling frame (denominator + external-prior layer) — see
#     scripts/translation-layer/README.md (phases 01→03).
# 0b. Draw the blind stratified sample (reproducible seed):
node scripts/analysis/gap-validation-sample.mjs

# 1. Primary instrument — Claude grounded agents (run via the Workflow tool, NOT node):
#    Workflow({scriptPath: ".../gap-validation-claude-workflow.mjs", args: <blind works array>})
#    then collect its on-disk result:
node scripts/analysis/gap-validation-collect-claude.mjs <task-output.json>

# 2. 2nd model — Gemini grounded search (resumable; ~$3 for 250):
node scripts/analysis/gap-validation-gemini-adjudicate.mjs --concurrency 5

# 3. Tie-break the dual-adjudicator disagreements (Workflow tool):
#    gap-validation-tiebreak-workflow.mjs  (then write its result to
#    gap-validation-tiebreak-verdicts.jsonl)

# 4. Score + debias:
node scripts/analysis/gap-validation-score.mjs
node scripts/analysis/gap-validation-estimate.mjs

# 5. Human gold standard (the binding step):
node scripts/analysis/gap-validation-gold-export.mjs 40      # writes the review HTML
#    open gap-validation-gold-review.html, label, export gap-validation-gold-labels.json here, then:
node scripts/analysis/gap-validation-gold-score.mjs          # → human sens/spec
node scripts/analysis/gap-validation-estimate.mjs            # Rogan–Gladen now applies
```

## Notes / gotchas

- **Grounding is load-bearing.** Do NOT set Gemini `thinkingConfig` — `thinkingBudget:-1`
  silently suppresses Google-Search grounding and the model answers "no prior" from
  memory (the FT audit's failure mode). The script flags `_grounded:false` so you can
  catch and re-run ungrounded verdicts.
- **Gemini key pool:** `GEMINI_API_KEY`/`_TIER3` are quota-throttled on v3 grounding;
  the script rotates `GEMINI_API_KEY_2,_3` and fails over on 429 (`--keys` to override).
- **Workflow results** are written to the task-output file on disk — collect from there,
  don't round-trip the 250-verdict blob through context.
- **Containers** (multi-work *Opera*/anthologies) are ill-posed for a single
  translation claim and excluded from the rates (reported separately).
- `scripts/output/*.jsonl` (the frame inputs) are gitignored/regenerable; the files
  in THIS directory are the durable, committed dataset.
