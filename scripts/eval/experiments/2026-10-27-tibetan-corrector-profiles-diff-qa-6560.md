# Tibetan correction: do error profiles in the prompt help, and can a diff-hunk QA replace the line-count refusal? (#6560, #6740)

**Status: PRE-REGISTERED.** This file was committed and pushed before any judge was run on any arm's output. The
results section is added after the run. Job `tib-corr-profiles-6560`. Eval only: no page was written.

## Decision it changes

What the Yigdzin → agy Gemini 3.8 Flash-low correction lane (#6740, job `tib-flash-correct-vol1-6740`) uses next:
- the current prompt, a prompt with error profiles, or neither;
- with or without a per-hunk leaf check (diff QA) in place of the blanket line-count refusal.

Today the lane refuses every correction that changes the number of text lines. That blocks a dropped line (brGyad stong
p.233, a real loss) and a removed Yigdzin duplicate (Neyphug p.128 and p.131, correct by eye) alike.

## Arms (Stage 1)

The corrector is the same in every arm: `agy` `gemini-3.8-flash-low`, one page a call, through
`scripts/eval/run-cli-arm.py --kind ocr --parallel 2`, with `CANDIDATE_READS=off`. $0.
- **A**: `corr-prompt.txt`, unchanged. The runner appends its marker sentence once more after the prompt, as in every
  earlier #6560 eval arm. That is the same in all three arms.
- **B**: A plus a **reader profile** of Yigdzin: `profiles-diffqa/profiles/reader.yigdzin-v1.tibetan.json`.
- **C**: B plus a **corrector profile** of Flash: `profiles-diffqa/profiles/corrector.gemini-3.8-flash-low.tibetan.json`.

Each profile is a data file, keyed by the reader or corrector model and the script. `arms.mjs` loads it, so another
script or OCR system can get its own file later. The profiles were written from measured counts before any arm ran.
- `profile-counts.py` counted every span a tiled span judge decided in four audits, 128 pages in all: #7477 (40),
  #7479 Neyphug (40), #7479 wave 2 (38) and #7483 router-30 (10).
- The route-judge whole-page defect rates on Yigdzin come from `route-judge-6740/results/*/ocr-defect-observations.jsonl`.
- The duplicate-line findings come from #7483.
- Counts of draft errors that Flash fixed: another word 326, mantra 179, vowel 144, tsheg 141, particle 50, line 6,
  ya-btags 4.
- Counts of errors Flash introduced: another word 76, mantra 42, tsheg 40, particle 16, vowel 8, plus whole lines
  dropped (#7477, brGyad p.233).

## Test set: DIAGNOSTIC, not a random sample of the lane

Built by `build-set.mjs`; the ids are in `results/.../profiles-diffqa-6560/sample.json`. There are 72 pages, each with
its Yigdzin draft resolved from `pages` or `page_revisions`:
- **g7477**, 6 pages: the #7477 gate's pooled-worse pages.
- **g7479**, 10 pages: the Neyphug gate's worse pages.
- **g7483**, 4 pages: router-30 pages with a severe error introduced.
- **brgyad**, 29 pages: every brGyad stong Ka Flash read in R2 (398 reads) whose text-line count differs from its draft.
  The brief said 32. 29 is what the kept reads give with tag lines not counted.
- **lines**, 3 pages: Neyphug p.128, p.131 and p.303.
- **wave2**, 20 pages: one per wave-2 book, seeded.

There are also **10 planted drafts**: `prep.py --reuse-plants`, 30 planted syllables on the 30-folio set's anchor
folios. These are used for the catch rate only and are not judged.

**Leak, stated before the run.** The profiles quote examples from the audits that also chose g7477, g7479 and g7483
(20 pages), for example དབང→དགྲ. Results are therefore also reported per group. brgyad, lines and wave2 (52 pages) are
the groups whose errors the profiles did not see as examples, although some wave2 pages were in the wave-2 audit.

## Judges (blind to arm, sealed Opus, Read only)

`profiles-diffqa/judge.mjs`, run through `replicate-6547/run-claude-arm.py --model opus`.
1. **Tiled span judge with severity.** This is leafcheck's `audit-req --severity` and `tiles-req`, word for word.
   - Every syllable hunk of the arm's output against the draft is one item, the two readings in random order, with
     2 known-answer controls per page, the frame and 4 full-resolution tiles.
   - A page that changes more than 25% of the draft's syllables is not span-judged. Only the whole-page judge reads
     it, and for the arm's own score it counts as worse with a severe error introduced, because the lane refuses it.
2. **Confirm judge** (leafcheck `confirm-req`). A fresh call takes every severe draft-win, and also every line-level
   hunk (one side has 6 or more syllables and the sides differ by 4 or more) whatever the first judge said.
3. **Whole-page judge** (route-judge `judgePrompt`, leafcheck `page-req`). It reads the draft and each distinct text
   once, each on its own.

A hunk is judged once per page. Its verdict is reused by every text that keeps it: the arms that wrote the same hunk,
the +qa texts and the +lane texts. The whole-page judge reads every distinct text.

## Stage 2: diff-hunk QA (on A, B and C)

- **Hunks.** These are syllable alignment hunks from `tibetan-yatags-guard.mjs` `diffSyllables`. A whole added or
  removed line is one hunk. Identical hunks (same draft run, same new syllables, same page) from different arms are
  one call.
- **One sealed Opus call per hunk.** The call gets:
  - the frame, plus a full-resolution band of the frame around the hunk's line;
  - the READOFF wording, with the two readings in random order;
  - one known-answer control item.
  - For a removed passage (a line-level hunk that removes syllables), the judge is also asked how many times the leaf
    shows the passage.
- **Keep or revert.**
  - A hunk is kept only where the judge saw the correction's reading. Revert, unclear, other or no answer puts the
    draft back.
  - For a removed passage, the count decides when it is given: keep the removal if the leaf shows the passage fewer
    times than the draft has it (copies found by syllable alignment at 60% or more identity).
- **Hunks that do not change syllables.** QA cannot revert a pure line-break change (two lines merged with every
  syllable kept). It stays in the +qa text.

**Amendment, 2026-10-27, before any judge was run.** Arm A's outputs came back with 1,154 hunks on 62 pages
(median about 20 a page; brGyad and wave-2 pages are corrected heavily). One call per hunk would be about 1,800 Opus
calls. The QA therefore makes **one sealed call per page line that has hunks**:
- the items are that line's distinct hunks from A, B and C, each with its two readings in random order, plus one
  known-answer control;
- **a removed passage still gets a call of its own**, with the count question;
- the band tile, the keep/revert rule and the dedupe are unchanged.

Nothing about the judges, the measures or the decision rule changed.

## Baseline: the lane as it runs now (+lane)

- A correction that changes the text-line count is refused.
- The 25% cap applies.
- The Latin-letter guard applies.
- Ya-btags changes go back to the draft. This is the guard with no leaf check, which is the same as Opus answering
  unclear.
- **The Derge guard is not reproduced** (there is no e-text index on this box). The baseline is therefore slightly more
  permissive than the lane.

## Measures (per variant: A, B, C, each plus qa and plus lane)

- **better / same / worse**, pooled. This is leafcheck's `gate` pooling of the span verdict (more leaf-shows-draft
  spans than leaf-shows-correction spans means worse) and the whole-page verdict (fidelity down, accept lost or a
  wrong_text defect added means worse).
- **Severe error introduced on a page.** Either a severe span where both the span judge and the confirm judge saw the
  draft on the leaf, or the whole-page judge finding more wrong_text defects in the text than in the draft, or one of a
  new class (leafcheck `severity-gate`). It is reported per 10 pages.
- **Plant catch rate.** A planted syllable is caught if the output does not have it at the aligned position
  (`score.py`'s survival rule). Restored to the original is also reported.
- **Line-count outcomes,** on every page whose text-line count changed:
  - **right**: every removed passage was seen as absent by both the span judge and the confirm judge, and the
    whole-page judge adds no O5 omission;
  - **loss**: both judges saw the passage on the leaf, or the whole-page judge adds an O5;
  - **unclear** otherwise; and line-break-only changes are counted on their own.
- **Anchors:** Neyphug p.128 and p.131 (a removal is right, by eye) and brGyad p.233 (a merge lost a line in the lane's
  read).
- **QA cost:** Opus calls and seconds, cost_usd_equiv as the CLI reports it, and hunks per page.

## Decision rule (fixed before any judge output)

Recommend the **cheapest** variant that passes all four:
1. **Derek's severity rule:** a severe error is introduced on fewer than 2 of 10 pages (under 20% of the 72).
2. **better ≥ 3 × worse**, pooled.
3. **Plant catch rate ≥ arm A's** (A without QA).
4. **Line removals:** p.128 and p.131 come out "right", and no page in the set is a "loss".

- **Cheapest order:** A, B, C, then A+qa, B+qa, C+qa. QA adds Opus calls, and a profile adds only prompt length.
- **The +lane variants** are the comparison. They cannot pass rule 4 by construction, because they refuse every
  line-count change.
- **If none passes,** this file says so, and names which rule each variant fails.
- **What a pass means.** The set was chosen from pages that went wrong before. A pass here is evidence for what to put
  through the lane's own gate on a fresh volume. It is not a write decision.

## Known weaknesses, stated before the run

- **The QA judge and the span judge are both Opus reading the same leaf.** A +qa text keeps exactly the hunks one Opus
  call saw as right, so its span-judge score is inflated by their agreement. The whole-page judge is the less
  correlated check on +qa, and the per-variant whole-page counts are reported beside the pooled ones.
- **The A arm is re-run.** Its outputs are not the lane's stored reads. The same prompt gives a different read on a
  re-run, so the g7477, g7479 and g7483 pages may not repeat their earlier failures.
- **This box's Claude account meter is empty** (`/root/.claude-limits/latest.json` has no limits for
  derek@playpowerlabs.com). The 89% weekly stop can only be honoured as "stop at the first limit reply".
- `/root/agy-quota/status.json` lives on main and is not readable from this box. agy errors stop the runner (exit 3).
