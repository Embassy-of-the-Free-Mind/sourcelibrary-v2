# Monthly translation corpus audit — runbook (#5301)

PRIOR ART: `../results/translation-corpus-audit-2026-09-30/README.md` (the one-off audit this repeats; its method
section is the design) and `JUDGE-PROMPT.md` (the rubric, unchanged). This file is the monthly procedure, and
**stage 2 below is the literal instruction set the scheduled routine follows** — edit it here, not in the routine.

## Why it exists

The 2026-09-30 audit (PR #5282) measured served translations once: 89% of pages at fidelity ≥ 4, 11% with a major
defect, non-Latin scripts 71%. One point cannot show whether the garble note, the restraint prompt or the leaf
holds move that rate. A monthly draw of ~100 books can, at about ± 6–7 pp on the headline per month and tighter
when months are pooled. Per-language cells of 2–19 books are exploratory every month; read them pooled by quarter.

## Design (fixed — change it only with a note in EXPERIMENTS.md)

| | |
|---|---|
| Unit | one interior text page per book (lesson: pages in a book are one observation) |
| Size | `draw.mjs --scale 0.32` → ~103 books over 15 languages; non-Latin scripts oversampled by the quota table |
| Weights | post-stratified back by live translated pages per language (`score.mjs`); page-weighted sensitivity from `book-weights.json` |
| Model arm | **not** quota-sampled (`--arm-quota off`) — the arm falls where the book draw puts it, so no arm correction is needed |
| Seed | the draw date as `YYYYMMDD`, fresh each month |
| Controls | 15 swap + 15 drop + 15 repeat (`--extra-per-lang 4`), blinded into the packets |
| Judge | Claude Opus, one subagent per 15-item packet, `JUDGE-PROMPT.md` verbatim — the format the 09-30 judge was validated in |
| Gate | `score.mjs --gate`: swap ≥ 14/15 rated ≤ 2, drop ≥ 13/15 flagged omission, repeat ≥ 14/15 within one point, ≥ 10 of each. **A run whose controls fail is not reported.** |
| Measure | `judged` — never "accuracy" |
| Store | `scripts/eval/store/scores/translation-corpus-audit-judge@1/<YYYY-MM>.jsonl` |
| Cost | $0 API: the draw is a Mongo read; the judge runs on the claude.ai subscription (~10 Opus subagents a month) |

## Stage 1 — the draw (Hetzner cron, 1st of the month, 04:30 UTC)

`monthly-draw.sh`: draws, builds packets, commits the run dir to branch `eval/tca-<YYYY-MM>` from its own clone
(`/root/tca-work`) and pushes. Log: `/var/log/sourcelibrary/tca-monthly.log`. On any failure it comments RED on
#5274. It runs on Hetzner because the draw needs Mongo; it makes no model call because the box has no working
Claude credential (the `.env` Anthropic key returned 401 on 2026-09-30) and a subscription judge costs nothing.

## Stage 2 — the judge (claude.ai scheduled routine, 2nd of the month, 06:00 UTC)

You are the routine. You start with a fresh checkout of the repo and no other context. Do exactly this:

1. `MONTH=$(date -u +%Y-%m)`. Fetch `origin eval/tca-$MONTH`. (The routine prompt reads this file from that
   branch, so the instructions always match the code the draw ran with.) **If the branch does not exist** and
   this file is on `origin/main`, the draw failed or did not run: do not draw, do not judge. (If this file is not
   on `origin/main` either, the setup is not merged yet — stop with one line saying so, no alarm.) Try `gh issue comment 5274 --repo Embassy-of-the-Free-Mind/sourcelibrary-v2
   --body "RED — no monthly draw branch eval/tca-$MONTH; stage 2 did not run (MONTHLY.md)"`. If `gh` is unavailable,
   push an empty commit (`git commit --allow-empty -s -m "RED: monthly translation audit draw missing for $MONTH"`)
   to a new branch and open a draft PR with that title. Then stop.
2. Check out the branch. The run dir is `scripts/eval/results/translation-corpus-audit-monthly-$MONTH`; call it
   `$DIR`. It holds `manifest.jsonl`, `items.jsonl`, `draw-log.json`, `book-weights.json`,
   `packets/packet-NN.jsonl` and `packets/index.json`.
3. Judge every packet. For each `packets/packet-NN.jsonl`, launch one subagent with the Agent tool,
   `model: "opus"`, at most five at a time. Its prompt is the full text of
   `scripts/eval/translation-corpus-audit/JUDGE-PROMPT.md` (drop the leading `<!-- … -->` comment) followed by two
   lines: `PACKET_FILE: <absolute path to the packet>` and `OUTPUT_FILE: <absolute path to $DIR/verdicts/opus/packet-NN.jsonl>`.
   Do not add anything else to the prompt — no hints about controls, no summary of the run. Do not read the packets
   or the manifest yourself; the controls are blind to the judge only if the judge's prompt carries nothing about them.
4. Check completeness: every packet has a verdict file with exactly as many valid JSON lines as the packet has
   lines. Re-launch a subagent once for any packet that is missing or short; after that, leave it and say so in
   the PR.
5. Score, gate first: `node scripts/eval/translation-corpus-audit/score.mjs --dir $DIR --primary opus --gate`.
   - **Exit 0 (controls pass):** re-run with `--store` added. Then add one row to the table in
     `scripts/eval/experiments/_series-monthly-translation-corpus-audit.md` (newest first; never edit
     `EXPERIMENTS.md` itself — main regenerates it from that file, #5436), filled from
     `$DIR/report.json`: month, n books, fidelity ≥ 4 with CI, fidelity ≤ 2, any major defect with CI, omission,
     invention, garble pass-through, Latin-script vs non-Latin ≥ 4, controls (swap/drop/repeat as k/n).
   - **Exit 3 (controls fail):** do not add `--store`, do not add an EXPERIMENTS row. The run is not reported.
   - Any other exit: treat as a failed run; report it as such in step 7.
6. Commit `$DIR` (verdicts + report), the store file and the `_series-…` file with `git commit -s`. Push to
   `eval/tca-$MONTH`; if that push is refused, push to `claude/tca-$MONTH` instead.
7. Open a PR to `main`. Title when the gate passed: `eval(translation-corpus-audit): <MONTH> — ≥4 <est>% (<ci>), major <est>% (<ci>), n=<books> (#5301)`.
   When it failed: `eval(translation-corpus-audit): <MONTH> — CONTROLS FAILED, not reported (#5301)`.
   Body: the controls block and corpus-estimate table from `$DIR/report.md` (controls first), the change against
   the previous month's row in the series file in one sentence, any packet left incomplete, and `Refs #5274 #5301`.
   Say "judged", never "accuracy". Then, if `gh` works, comment the same headline and the PR link on #5274.
8. Finish with one line: the PR URL and PASS/FAIL.

## Reading a month

- Compare months on the corpus estimate and its CI, not on per-language cells.
- The draw excludes page ends and non-text pages, so truncation reads zero by construction (#5055 measures it).
- A text-only judge cannot see a wrong leaf (#4790): every rate is conditional on the served image being the
  transcribed leaf. When track tq1 lands a cheap leaf check, add it here as a stage-2 step.
- If a month's controls fail, the judge changed (model, harness) or the packets did. Look at `report.json →
  controls.*.missed` before re-running anything.

## Operating it

- Re-run a draw by hand: `TCA_DATE=2026-11-01 bash scripts/eval/translation-corpus-audit/monthly-draw.sh` on Hetzner
  (refuses if the month's branch exists — delete the remote branch first, deliberately).
- Re-run the judge: run the routine from https://claude.ai/code/routines, or follow stage 2 by hand in any session.
- A second judge (Sonnet) for agreement: judge a few packets into `verdicts/sonnet/` and add `--second sonnet`.
