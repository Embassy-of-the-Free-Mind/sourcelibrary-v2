---
stage: ocr
measure: [judged, accuracy]
languages: [bo]
scripts: [Tibt]
canons: []
n_books: 26
n_pages: 72
verdict: "No variant passes the pre-registered rule (severe on < 2 of 10 pages, better >= 3x worse, plants >= A, right line removals). The corrector profile (C) cuts introduced mantra normalisation 39 -> 4 spans and tsheg insertion 36 -> 8 at no cost to fixes, but word substitutions and severe pages do not move; a per-hunk Opus QA removes most confirmed severe spans (22 -> 5-7 pages) at ~8 calls a page, costs right fixes and cannot judge removed lines."
status: rejected
decision: "Nothing adopted: the lane keeps its prompt and its line-count refusal; profile C and a line-level (not hunk-level) QA are the next candidates for the lane's own gate (#6740)"
superseded_by: null
issue: [6560, 6740]
---
## 2026-10-27 · Tibetan correction: do error profiles in the prompt help, and can a diff-hunk QA replace the line-count refusal? (#6560, #6740)

**Status: DONE (results below).** Pre-registered in 0afde11a8 (amended in f75925f70) before any judge was run on any arm's output. The
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

## Results (2026-10-27)

**No variant passes the pre-registered rule.** Every one fails at least one of the four rules, so none is recommended.
On this diagnostic set, the full corrector-profile prompt (C) is the clearest improvement over the current prompt. The
diff-hunk QA as built is not a drop-in replacement for the line-count refusal. The results are below.

- **Calls:** agy Flash-low 248 (82 per arm, plus 2 re-reads of replies cut before `<<<END>>>` in C; $0).
- **Opus:** 1,484 sealed calls on this box's subscription: span 191, confirm 110, whole page 446, QA 737. That is
  $177 at API-equivalent prices; nothing was billed. No limit reply was received.
- **Judge controls:** span 366/382 (96%), confirm 208/220 (95%), QA 596 right / 3 wrong / 138 unclear. The QA's
  control is drawn anywhere on the page, so it often falls outside the band tile; hence the unclears.
- **Scores:** `results/.../profiles-diffqa-6560/score.json.gz` and `score.txt`.

### The table (72 pages; plants: 30 planted syllables on 10 folios)

| variant | better / same / worse (pooled) | pages with a severe error introduced | per 10 | plants caught | line-count changes: right / loss / unclear / breaks only | p.128 · p.131 · p.233 | rule |
|---|---|---|---|---|---|---|---|
| **A** current prompt | 45 / 12 / 15 | 31 | 4.3 | 29/30 | 7 / 2 / 1 / 12 | right · right · kept | fails 1, 4 |
| **B** + reader profile | 49 / 14 / 9 | 33 | 4.6 | 27/30 | 6 / 0 / 5 / 11 | right · right · kept | fails 1, 3 |
| **C** + reader + corrector profile | 50 / 7 / 15 | 31 | 4.3 | **30/30** | 6 / 2 / 2 / 13 | unclear · right · +1 line, unclear | fails 1, 4 |
| A + lane guards (today) | 29 / 32 / 11 | 18 | 2.5 | 29/30 | refused | kept · kept · kept | fails 1, 2, 4 |
| B + lane guards | 31 / 35 / 6 | 20 | 2.8 | 27/30 | refused | kept · kept · kept | fails 1, 3, 4 |
| C + lane guards | 30 / 31 / 11 | 19 | 2.6 | 27/30 | refused | kept · kept · kept | fails 1, 2, 3, 4 |
| A + diff QA | 50 / 19 / 3 | 18 | 2.5 | 27/30 | 7 / 0 / 1 / 13 | right · right · kept | fails 1, 3 |
| **B + diff QA** | **52 / 19 / 1** | **13** | **1.8** | 25/30 | 6 / 2 / 0 / 10 | **kept** · right · kept | fails 3, 4 |
| C + diff QA | 51 / 16 / 5 | 17 | 2.4 | 27/30 | 5 / 2 / 3 / 12 | unclear · loss · +1, unclear | fails 1, 3, 4 |

Rules: (1) severe on fewer than 2 of 10 pages, (2) better ≥ 3 × worse, (3) plants ≥ A's 29/30, (4) p.128 and p.131
right and no loss.

**B + diff QA passes the severity rule (13/72) and better ≥ 3 × worse.** It fails the other two:
- it catches 25/30 plants, against A's 29;
- the QA put Yigdzin's duplicated line back on p.128 (8 lines again where the leaf has 7), and 2 line changes are
  losses.

### 1. Do the profiles help? They change WHICH errors Flash makes, not how many pages go wrong

Spans the leaf contradicts (the span judge saw the draft; 60 pages paired, not over the 25% cap):

| arm | errors introduced (spans) | mantra / Sanskrit | tsheg inside a cluster, split, join | another word | errors fixed (spans) |
|---|---|---|---|---|---|
| A | 166 | 39 | 36 | 67 | 966 |
| B | 136 | 37 | **6** | 70 | 1,030 |
| C | **116** | **4** | 8 | 74 | 1,042 |

- **C against A:** 65 fewer introduced spans, 95% interval [−143, −3] (bootstrap over pages). Most of the drop is on a
  few pages: 22 pages have fewer, 18 have more.
- **The reader profile alone (B) stops the tsheg insertions.** It does not stop mantra normalisation.
- **The corrector profile (C) stops mantra normalisation.** C against B on mantra: −32, [−78, −1].
- **Neither profile reduces word substitutions** (O6, about 70 spans in every arm), and those are what the severity
  rule mostly counts.
- **The profiles cost no fixes:** fixed spans went up from 966 to 1,042. C caught all 30 plants.
- **At page level:** worse pages were 15 / 9 / 15 for A / B / C, and pages with a severe error introduced were
  31 / 33 / 31. None of the three is under the bar.

### 2. Diff-hunk QA: it removes most confirmed severe spans, at about 8 Opus calls a page, but it is not a line-count judge

- **Confirmed severe spans** (both span judges saw the draft) fall from 22 pages to 5–7, and pooled worse falls from
  15 / 9 / 15 to 3 / 1 / 5.
- **The whole-page judge** still flags 10–14 pages in every +qa variant: more wrong_text defects than the draft, or a
  new class of one. Its "worse" verdicts stay at 4–5.
- **It costs right fixes.** Unclear means revert, so plants caught drop by 2 (A, B) or 3 (C), and pooled "better"
  barely moves.
- **Removed passages: the QA is unreliable at hunk granularity.** The syllable alignment splits a removed Yigdzin
  duplicate into fragments (p.128 had 8 "removal" hunks). The judge's answers and counts on the fragments disagree
  with each other. A partial revert can leave a hybrid line: on p.131, C + qa, the whole-page judge then called a
  restored fragment a near-copy, and the line outcome became a loss.
  - The by-eye truth on p.131 (job tib-opus-translate-6948) is 7 lines, with the anger sentence written twice on the
    leaf.
- **Cost, measured:**
  - 737 calls for 1,890 distinct hunks on 78 pages (three arms pooled), 3.3 hours of call time, $52.6 at API-equivalent
    prices.
  - For one arm alone: about 8 calls a page (A 633 calls on 82 pages), a median of 17 hunks a page, about $0.57 a page
    at API-equivalent prices.
  - On a 500-page volume that is about 4,000 Opus calls.

### 3. The lane's current guards (+lane) do not meet the bar either

On these pages, A + lane is 29 / 32 / 11 with 18 severe pages (2.5 per 10).
- The blanket line-count refusal sends 26 of the 72 pages back to the draft.
- It keeps the Yigdzin duplicate on p.128 and p.131.
- It does not stop word substitutions on the pages it passes.
- The Derge guard is not in this baseline (see above), so the real lane may be a little better.

### Where the severity count comes from (one caution)

- The whole-page judge's "a wrong_text defect of a new class" (leafcheck severity-gate (b)) raises 12–13 of the raw
  arms' 31–33 severe pages, and 10–14 of the +qa variants' 13–18. That is most of the +qa flags, often on pages the
  same judge scores better.
- The judge was not re-run on identical texts, so its noise floor is not measured.
- brGyad stong Ka, the heavily corrected volume, carries 16–20 of its 29 pages' severe flags in the raw arms. Wave-2
  pages carry 3–7 of 20.

### Decision

- **None passes the pre-registered rule.** Nothing here is a write decision.
- **What the evidence supports, for the lane's next gate** (each still needs its own pre-registered gate on a fresh
  volume):
  1. **Use profile C in the correction prompt.** It is free, keeps every fix, catches all plants, and removes the
     measured mantra and tsheg normalisation.
  2. **Keep the line-count refusal.** A per-hunk QA cannot tell a removed duplicate from a lost line. The next try
     should be a **line-level** check: one call per changed line, asking how many times the leaf shows the line. It
     should not use syllable hunks. Its known-answer controls should come from the same band.
  3. **Word substitutions (O6) are what remains.** Neither profile reaches them. The diff QA's leaf check removes most
     confirmed severe spans (22 pages → 5–7), at about 8 Opus calls a page.

### Deviations, all taken before scoring

- **QA calls per page line, not per hunk** (amendment f75925f70). Arm A came back with 1,154 hunks on 62 pages.
- **The count question decides only for a pure removal** (nothing in its place). For a long run replaced by a short
  one, "how often is this passage on the leaf" does not say which reading is right. This was seen on the first QA
  replies, before any scoring.
- **Arm C's 2 replies cut before `<<<END>>>` were read once more**, as `cli-ocr.mjs` does.
- **brGyad:** 29 reads change the line count, not the brief's 32 (R2 holds 398 reads; tag lines are not counted).
- **The Derge guard is not in +lane.** This box's Claude meter has no row for its account, so the 89% weekly stop
  could only be "stop on a limit reply". None came.
