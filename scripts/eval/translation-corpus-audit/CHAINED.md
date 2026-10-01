# Chained-lane quality sample — runbook (#4681)

PRIOR ART: `MONTHLY.md` (the two-stage Hetzner-draw + claude.ai-routine-judge procedure this copies) and
`../results/translation-corpus-audit-2026-09-30/README.md` (the method). Same rubric (`JUDGE-PROMPT.md`), same
packets, same scorer. Only the FRAME differs: pages the chained Batch API translation lane wrote.

## Why it exists

The chained lane (`scripts/lib/translate-batch-chained.mjs`, PR #5267 and the #4681 scale-up) now carries Phase 4
of the translation line. Its output has never been judged in absolute terms. The brief (ops repo
`handoffs/2026-09-30-chained-quality-sample.md`) asks for a defect rate on pages the lane wrote, with the seam
pages (first page of a block, translated without a previous-page seed) reported separately, and five pages Derek
can open by eye. The first attempt ran as a laptop background session and died when the laptop slept; this
runbook puts both halves on machines that do not sleep.

## Design

| | |
|---|---|
| Frame | books with a `translate_batch_runs` record in mode `chained`; pages with `translation.engine.call_site = scripts/lib/translate-batch-chained.mjs` |
| Unit | one seeded page per book (`stratum: seeded`, up to 60 books) + up to 15 block-first pages (`stratum: seam`), one per book |
| Weights | the lane's page count per language (`draw-log.json`), so the estimate reads "a page the lane wrote" |
| Controls | 15 swap + 15 drop + 15 repeat, blinded into the packets; `score.mjs --gate` as in MONTHLY.md |
| Judge | Claude Opus, one subagent per 15-item packet, `JUDGE-PROMPT.md` verbatim |
| Measure | `judged` — never "accuracy" |
| Comparison | production's post-#5103 rate on device breaks (38% defective, EXPERIMENTS.md 2026-09-25 round 4) and the 2026-09-30 corpus audit (any major defect 14.4%) — read the seam stratum against the first, the seeded stratum against the second |
| Cost | $0 API: the draw is a Mongo read; the judge runs on the claude.ai subscription |

## Stage 1 — the draw (Hetzner, on demand)

    TCA_REF=main bash /root/sourcelibrary/scripts/eval/translation-corpus-audit/chained-draw.sh

(`TCA_REF=<branch>` before the scripts are merged; `TCA_DATE=YYYY-MM-DD` to name the run.) It commits the run dir
`scripts/eval/results/translation-corpus-audit-chained-<DATE>` to branch `eval/tca-chained-<DATE>` from
`/root/tca-work` and pushes. On failure it comments RED on #4681.

## Stage 2 — the judge (claude.ai routine, fired once after stage 1)

You are the routine. You start with a fresh checkout of the repo and no other context. The routine prompt names
the branch (`eval/tca-chained-<DATE>`); call it `$BRANCH` and the date `$DATE`. Do exactly this:

1. `git fetch origin $BRANCH`. If the branch does not exist, the draw failed or has not run: comment
   `RED — no draw branch $BRANCH; stage 2 did not run (CHAINED.md)` on #4681 with `gh` if it works, and stop.
2. Check out the branch. `$DIR` = `scripts/eval/results/translation-corpus-audit-chained-$DATE`. It holds
   `manifest.jsonl`, `items.jsonl`, `draw-log.json`, `packets/packet-NN.jsonl` and `packets/index.json`.
3. Judge every packet exactly as MONTHLY.md stage 2 step 3 says: one Agent-tool subagent per packet,
   `model: "opus"`, at most five at a time, prompt = the full text of `JUDGE-PROMPT.md` (minus the leading
   `<!-- … -->` comment) followed by `PACKET_FILE: <abs path>` and `OUTPUT_FILE: <abs path to
   $DIR/verdicts/opus/packet-NN.jsonl>`. Nothing else in the prompt. Do not read the packets or the manifest yourself.
4. Completeness: every packet has a verdict file with as many valid JSON lines as the packet has lines. Re-launch
   once for any packet missing or short; after that, leave it and say so in the PR.
5. Score, gate first: `node scripts/eval/translation-corpus-audit/score.mjs --dir $DIR --primary opus --gate --issue 4681`.
   - Exit 0: re-run with `--store` added. Then the seam split, which the scorer does not cell:
     `node -e` over `$DIR/manifest.jsonl` (kind main, field `stratum`) joined to `$DIR/verdicts/opus/*.jsonl` by
     `id`: for `seeded` and `seam` give n, % fidelity ≥ 4, % any major defect (a `defects[]` entry with
     `severity: "major"`), % omission, % invention. Write it to `$DIR/seam-split.json` and into `$DIR/report.md`
     under a heading "Seeded vs seam pages".
   - Exit 3 (controls fail): no `--store`, no EXPERIMENTS row; the run is not reported as a rate.
6. Pick five pages for a by-eye check: the three lowest-fidelity main items and two seam items, with their `url`
   from the manifest. List them in the PR body.
7. Add one entry to `scripts/eval/EXPERIMENTS.md` (newest first, under a heading
   `## <DATE> — Chained Batch lane: random-sample fidelity of pages the lane wrote (#4681)`): n books, n seeded /
   n seam, fidelity ≥ 4 with CI, any major defect with CI, omission, invention, the seam split, controls as k/n,
   `measure: judged`, and the two comparison rates from the Design table with the sentence that says whether the
   seam stratum is inside, below or above the 38% device-break rate.
8. Commit `$DIR` (verdicts, report, seam-split), the store file and `EXPERIMENTS.md` with `git commit -s`. Push to
   `$BRANCH`; if refused, to `claude/tca-chained-$DATE`.
9. Open a PR to `main`. Title when the gate passed:
   `eval(translation-corpus-audit): chained lane <DATE> — ≥4 <est>% (<ci>), major <est>% (<ci>), seam major <x>%, n=<books> (#4681)`;
   when it failed: `eval(translation-corpus-audit): chained lane <DATE> — CONTROLS FAILED, not reported (#4681)`.
   Body: controls first, the corpus-estimate table from `report.md`, the seam split, the five by-eye URLs, any
   incomplete packet, `Refs #4681 #5274`. Say "judged", never "accuracy". Then comment the headline and PR link on #4681.
10. Finish with one line: the PR URL and PASS/FAIL.

## Reading the result

- The seeded stratum is the lane's normal case; compare it with the 2026-09-30 corpus audit (same rubric).
- The seam stratum is the case the chained design exists for; compare it with the 38% device-break defect rate.
- A text-only judge cannot see a wrong leaf (#4790); every rate is conditional on the served image being the right one.
