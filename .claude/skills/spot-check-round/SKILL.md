---
name: spot-check-round
description: One round of the quality sprint (#6056) — draw 10 random public books, 2 Opus reviewers read 3 pages each against the images, score, register, contain what is invented, then turn each finding into a detector, a fix and a prevention. Use when Derek says "draw 10 books and spot check", "next random 10", "spot check for quality", "another round".
---
<!-- PRIOR ART: scripts/eval/spot-check/ROUTINE.md (the fortnightly series: same draw/brief/scorer, frozen, run by a
routine; it stops at the report) and the shelf-overview skill (a named shelf, 4 books × 4 pages, show/caveat/don't).
Neither covers an ad-hoc random round in a session nor the follow-through — detector, containment, steering running
jobs — that made round 3 (2026-10-23) useful. This skill reuses their scripts unchanged. -->

# Spot-check round

**Who reads it.** Derek, in the terminal, wanting three things: the rate (pages with a serious error, books flagged on
sight, with n), what is wrong in plain words per book, and what we are doing about each class. A round is worth running
only if a finding becomes a detector with a count, a fix, or a contained page.

## 1. Draw (Hetzner, not the laptop)
The laptop's Atlas link resets mid-draw; the job box does not.
- `ssh hetzner 'cd /root/sourcelibrary && nohup node --env-file=.env.production.local scripts/eval/spot-check/draw.mjs --date <YYYY-MM-DD> --seed <YYYYMMDD><round> --frame public --out /root/qa-6056/sprint-<date>-r<N> > /root/qa-6056/r<N>-draw.out 2>&1 &'`
- Wait with an until-loop on the `wrote …` line, then `scp -r` the dir into `scripts/eval/results/spot-check/` of your worktree.
- Frame `public` keeps rates comparable across rounds; `canon` is a different population (never pooled).
- **Alternate with `--frame recent --days 7`**: books whose English was written in the last week, hidden ones
  included, run drawn from those pages only. `public` measures the stock; `recent` measures what the lanes write NOW,
  which is the only frame where a fix can be seen to work. One series can dominate a week's output (round 5: four
  volumes of 儒林外史 of ten) — say so rather than redraw.
- Known blind spots, name them in the report: pages with OCR and no English are never drawn; books are weighted
  equally, not by readers (`read_count` is inflated, #5048).

## 2. Review (2 Opus subagents, in the background)
- Prompt = `REVIEWER.md` verbatim (drop the leading `<!-- -->`) + `PACKET_FILE:` + `OUTPUT_FILE:`. Nothing else.
- **Trap:** the prior-art hook refuses a subagent's new JSON under `scripts/eval/`. Give `OUTPUT_FILE` in the scratchpad
  and copy it into `reviews/` yourself.
- **Trap:** do not `EnterWorktree` while other subagents run Bash in the main checkout — they inherit the isolation and
  every command is refused. Enter the worktree first, then dispatch.

## 2b. Second reader on the serious calls (precision)
Every rate rests on the first reader's serious calls, so check them: build one packet of every serious finding grouped
by page (image URL, OCR, English, the claims) and give it to 1–2 fresh Opus subagents with
`scripts/eval/spot-check/SECOND-READER.md` verbatim + `PACKET_FILE`/`OUTPUT_FILE` (scratchpad). Verdicts: confirmed,
real_not_serious, not_an_error, misclassified (with the right class), cannot_tell. Report the rate with
"serious calls confirmed X/Y; reclassified Z". Rounds 3–4 baseline: reviewers rarely invent errors but over-call
"invented" (O1) where the leaf's text is there and misread (O6) or skipped (O5) — use the second reader's class.

## 3. Score, register, redact
- Merge `reviews/packet-*.json` → `results.json` (sample order). `score.mjs` needs a dated dir: copy the run to
  `<scratch>/scoreN/<date>/` and run `score.mjs --date <date> --root <scratch>/scoreN`; copy `report.*` back.
- Write `forms.json` (`print` | `MS` per book, from the images; Siku copies are MS), then
  `register.mjs --dir <run> --forms <run>/forms.json`. **This writes `book_checks` rows, and the reader shows them as
  warnings (#6199)** — say so in the report. Then `register.mjs --cluster`.
- **Public repo:** `redact-rights.mjs` on results and reviews, then grep the run for `copyright|ProQuest|died` and
  rewrite any rights wording left in a `book_verdict`.

## 4. Contain (same run, no ask — `.claude/docs/invariants/containment-on-finding.md`)
Only text that is **not this leaf's text**. Check it yourself first (the label "invented" is often inflated: Bracton
p205 was a bad read, not an invention). Then `hold-pipeline-books.mjs --ids <file> --reason … --release "…" --apply`,
`withhold-stale-translations.mjs --book=<id> --by-eye-pages=N --evidence="…" --issue=6056 --apply`, one line on #6056.
Read its summary: it also withdraws the page from book quotes (`quotesWithdrawn`) and syncs the search mirror
(`mirrorSynced`). What it does not touch: book-level derived text (summary, keywords, `ai_metadata`) written from the
bad page — check them against `.claude/docs/invariants/derived-metadata-lane.md` and say so if they repeat the error.

## 5. Follow through — this is the point
For every serious finding: name the taxonomy class, then `gh issue list --search` the CONCEPT and read the owner issue.
Most classes already have a detector and a repair tool waiting on a hold-list write — say which, don't rebuild.
For a new class, the order is:
1. **Detector, model-free, on Hetzner.** Prove it with a positive control from the round (it must flag the reviewed
   bad page and pass its good neighbour), then count corpus-wide, then open one flagged page by eye.
2. **Predict the next round** with it before the reviewers report (round 4: vol 411 predicted clean, held).
3. **Steer running jobs** that would write more of the defect: `ssh hetzner '/root/bin/claude-job.sh note <job> "…"'`.
4. **Prevention point**: the writer or router file where a guard belongs; a check beats a sentence.
5. Post the finding on the owner issue (a comment, not a new issue unless none exists); log a measurement as ONE file
   in `scripts/eval/experiments/`.

Detectors that exist (use them): `headword-mark-drop.mjs` (丨 in 韻府/類書), `translation-reasoning-leak.mjs`,
`leaked-markup-census.mjs`, `detect-fabricated-ocr.mjs` + `blank-page-guard` (blank leaves), `scan-title-mismatch.mjs`
(Latin titles; CJK needs title-pair matching inside one import campaign — see #6660), `page-count-audit.mjs`.
Does not work: the English/OCR length ratio as a general screen (experiments/2026-10-23-length-ratio-screen-6056.md).

## 6. Ship and report
- Commit the run dir + `sprint-clusters.json` by path, `git commit -s`; PR body starts `Part of #6056` (the
  `issue-link` check). If pushes time out from the laptop: `git bundle` → scp → push the ref from `/root/sourcelibrary`
  (`git fetch <bundle> <branch>:refs/qa/x && git push origin refs/qa/x:refs/heads/<branch>`), never moving its HEAD.
- One comment on #6056: rates with CIs against earlier rounds (same frame only), second-reader precision, clusters,
  contained pages, new detectors, and **found vs fixed**: for each class seen this round, its owner issue and where
  the repair stands (detector only / repair built, waiting on a hold-list yes / applied, with pages). A class whose
  repair is built but unapplied is the thing to bring to Derek, with a dry-run count.
- Harvest the round's quoted corrections into the regression set (#5913) so later lanes are tested on them.
- To Derek: rate, per-book plain findings, what was contained, what waits on him (hold-list repairs), PR links.
