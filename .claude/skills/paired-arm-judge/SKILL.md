---
name: paired-arm-judge
description: Run a test of two or more arms (routes, prompts, models, correctors) on the same pages with a blind judge reading each output against the page image, and score it with the recipe's checks (one page per book, blind arm names, wrong-page controls, noise floor, batch size, neighbouring leaves). Use when a brief or Derek asks "is A better than B", "test route X against the live route", "does the new prompt help", a router cell test, or names `Skill: paired-arm-judge`.
---
<!-- PRIOR ART: scripts/eval/route-judge-6740/judge.mjs (the instrument: draw, packet, judge, score) and
defect-rate.py (defect rates per 1,000 words, the #6740 rule). qa-eval is the older #1329 MCR framework and does not
judge against the image. 94 of 137 paired-arm runs rebuilt their own judge script (2026-11-04-experiment-kinds-6553.md
§6); this skill sends them to judge.mjs's file format and adds paired-arm.mjs for the rules prose cannot enforce. -->

# Paired-arm judge

**Who reads the result.** The router table, the next session deciding a lane, and Derek reading one k/n line. They
need to know which arm is better on the same pages, by how much, and whether the judge could tell.

**When to use it.** Two or more arms read the same pages and the question is which output is better: a route against
the live route, a prompt against the current prompt, a corrector, a model. **Not for:** comparing with a reference text
(that is CER against a reference: `scripts/eval/lib/metrics.mjs`); calibrating a screen or detector (planted positives:
`scripts/eval/lib/plant-ocr-errors`); a random quality read of a shelf (`spot-check-round`, `shelf-overview`).

## Steps

1. **State the design before judging.** `node scripts/eval/route-judge-6740/paired-arm.mjs init --out=DIR` writes
   `DIR/recipe.json`. Fill in the question (`route | prompt | model | leaf`), the arms, the baseline (usually the live
   route, so the result reads as a change), pages per call, the noise floor, `feeds` and `router_evidence`. Read
   `.claude/docs/eval-design.md` and the cell's row in `scripts/eval/estimator/router-table/rules.json` first: an
   earlier test of the same cell is the baseline you are replicating, not a new question.
2. **Draw and build the packet with judge.mjs**, or your own script if it writes the same files:
   `key.json` rows `{ id, judged_as, cell, route, kind: item | wrong_page | repeat | planted, page_id, book_id }`
   and `verdicts-<judge>.jsonl[.gz]` rows `{ id, verdict: { accept, fidelity, defects[] } }`. Keep `packet.json`
   when it is small enough to commit; with it the check sees every field the judge saw and the score adds defect
   rates per 1,000 words.
3. **Check before you spend.** `paired-arm.mjs check --out=DIR` must pass (exit 0) before any judge call:
   - R1: one page per book per arm.
   - R2: arm names blind.
   - R3: a wrong-page control per arm.
   - R4: a noise floor. Either ≥ 5 `repeat` rows (the same arm's output judged twice), or `noise_floor.from` naming an
     earlier measurement of this judge on this kind of page.
   - R5: batch size stated. More than one page a call needs `batch.tested`.
   - R6: for a which-leaf question, the neighbouring scans.

   A rule the run truly cannot meet is waived in `recipe.json` `waive`, with the reason. The skeleton prints the
   waiver, so a reader sees it.
4. **Judge.** Opus through `claude -p`, one output per call, the image attached (judge.mjs `judgePrompt`). When the
   decision rests on it, add a second family (Gemini through agy): a single judge can share a blind spot with an arm.
5. **Score.** `paired-arm.mjs score --out=DIR` writes `DIR/paired-score.json`. For each judge and arm it reports
   accept and wrong-text k/n with Wilson and by-book intervals, the controls, the noise floor, and each arm against the
   baseline on shared pages. An arm whose control failed does not count. A difference inside the noise floor is not a
   difference. For an OCR or translation decision, run `defect-rate.py` too: it holds the #6740 rule.
6. **Write it up.** `paired-arm.mjs skeleton --out=DIR --slug=<slug>` writes `DIR/writeup.md` with a valid header
   (`feeds`, `router_evidence`, `defect_rates`) and the tables. Fill in the TODOs, add the cells' evidence to
   `rules.json`, and commit it as ONE file `scripts/eval/experiments/<date>-<slug>.md`. Commit the results directory
   under `scripts/eval/route-judge-6740/results/<slug>/`.

## Re-scoring a stored test

`paired-arm.mjs score --out=<copy of a results dir> --compare=<its score.json>` re-derives every arm's k/n and exits 1
on any mismatch. Verified on `router-tests-2026-10-28`: 20 of 20 k/n match its `score.json` and its write-up.
Copy the directory to `$JOB_SCRATCH` first, because `score` writes `paired-score.json` next to the inputs.

## Recipes still to write (experiment-kinds-6553 §6)

These are listed, not built:
- cer-vs-reference: a by-eye audit of the reference, normalisation via `lib/metrics.mjs`, shared pages only.
- screen-with-controls: planted positives, known negatives, and a by-eye check of 40 flagged items before any threshold.
- apply-gated-repair: a dry run, a `sweep_log` row, an undo file, and a gate sample read by eye.
- sample-and-review: already covered by `spot-check-round` and `shelf-overview`. Briefs should name them.
