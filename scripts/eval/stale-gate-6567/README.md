# #6567 Stale Siku English: check the new Paddle reading, then retranslate vs diff-scoped correction

PRIOR ART: `scripts/eval/paddle-stale-english-6388/` (#6518: the census, old-vs-new CER, the decision to retranslate
all stale pages). This gate asks the two questions that come before that run: is the new Paddle reading right, and
does a diff-scoped correction of the stored English do as well as a fresh translation?

Committed **before any reviewer, translator or judge ran** (job stale-gate-6567, 2026-10-12). Two one-page smoke
calls (Opus and 3.8 Flash High on p01 with the OCR-check prompt) ran first to test the runners; they are not used.

## Frame and draw (`draw.mjs` → `census.json`, `draw.json`)

Pages with `translation_stale.lane = paddle-zh-2026-10`, English present, `ocr.source = paddle`, the lane's
`page_revisions` snapshot present, ≥ 8 Han characters. Old-vs-new CER as #6518 (Levenshtein over folded Han characters
of the body, / |Paddle|, capped at 1). Excluded: pages `paddleTableRisk` (#6516) flags; census.json counts them.

Draw: 8 pages per CER bin (0–.05, .05–.1, .1–.2, .2–.5, .5–1), one page per book across all 40, seeded (6567 + bin
index). Opaque ids `p01`…`p40` in a seeded order (6568), `packet-map.json`.

The **old→new character diff** is that Levenshtein alignment's backtrace, cut into hunks (runs of changed characters,
merged across one unchanged character), each with 4 characters of the new reading on either side.

## Step 1: OCR check (`prompt-ocr-check.txt`)

Opus (`claude -p --model opus`, `opus.mjs`) and Gemini 3.8 Flash High (`agy -p`, `run-cli-arm.py`) each read the
Paddle text against the image, independently, one page per call, and list invented / dropped / misread / order spans
with severity `material` or `minor` (definitions in the prompt).

- Both flag a material error, or neither: that is final.
- They split: the **rotating referee** settles the claims (`prompt-ocr-referee.txt`). Gemini-only material claims go
  to Opus; Opus-only material claims go to Gemini 3.1 Pro High. The page is material if the referee confirms any claim
  as material.
- A failed read is counted, not scored: with one read left, that read decides; with none, the page is unresolved.

Pages with a material OCR error stop here and are counted per bin. The rest go on to step 2.

## Step 2: two arms on the remaining pages

- **RETRANSLATE**: 3.8 Flash (`gemini-3.8-flash-low`, the CLI translation lane's default), the production single-page
  prompt from `translate-core.mjs` `buildTranslationPrompt` (snapshotted by `draw.mjs`, with the previous page's stored
  English as context and the scoped page-break rule, as `scripts/batch/cli-translate.mjs` builds it), the
  `cli-translate.mjs` CLI suffix, and the #6523 sentinels. No image (production translates from text).
- **DIFF-CORRECT** (`prompt-diff-correct.txt`): the same model gets the image, the new reading, the hunks and the stored
  English, and returns replacements `{changes, from, to}`. The **edit contract** (`gate.mjs` `applyContract`) applies
  them and rejects the whole reply if any edit cites no real hunk, quotes a span not found exactly once, overlaps another,
  or replaces more than 25 words + 6 per Han character of its cited hunks. Text outside the edits is byte-identical by
  construction. A rejected reply is counted, not scored.

Both arms: the fixed runner from #6523 (`run-cli-arm.py`, copied from branch job-cli-ocr-fix-6523c: sentinels + tool
gate; the gate's denial reason is task-neutral here). One page per call, at most 2 `agy` and 2 `claude` calls in flight.

**Planted errors:** after step 1, 8 of the step-2 pages are drawn (seed 6570). On each I write 2 meaning errors by hand
into the stored English (`plants.json`, committed before step 2 runs): number, name, negation or sense. The planted
English is THE stored English for that page: the diff-correct arm and the judges see it. No prompt mentions plants or
an expected number of errors.

## Judging (`prompt-judge.txt`)

Opus and Gemini 3.1 Pro High, each blind, one call per page, against the image and the new reading. The page's
candidate Englishes (stored, retranslated, diff-corrected; identical texts shown once) are labelled A/B/C in a seeded
random order per page (`judge-map.json`). MQM spans; accuracy (mistranslation, omission, addition, untranslated) is
scored apart from style (fluency, terminology, style, markup). **Material** = an accuracy error of severity major or
critical. A judge error that overlaps a planted span is a catch, and is not counted against the arm. One pass only.
Failed reads are counted, not scored.

## Reported per bin

Material-OCR-error rate; material accuracy errors per page for stored, retranslated and diff-corrected English under
each judge (and on the pages where all three were scored); edit size (word-level edit distance from the stored English,
over its words); calls and seconds per page; planted-error catch rate per judge.

## Pre-registered rule

Per bin, over the step-2 pages, averaged over the two judges:
- the repair is the arm with fewer material errors per page; if the two arms are within 0.25 of each other, the
  diff-correct arm (smaller edits, stable citations);
- if neither arm beats the stored English by ≥ 0.25 material errors per page, keep the stored English in that bin;
- if a bin's material-OCR-error rate is ≥ 15% (2 of 8 or more), that bin's repair needs a per-page OCR check first
  (two reads + referee, as step 1), and the pages it flags are held for an OCR fix; its quota is counted.

Projected quota: the bin's page count from the census × (calls per page for the repair + the OCR check where needed),
from the measured calls and seconds per page.

**GO** if both judges catch ≥ 12 of the 16 plants (in the stored English) and the rule's repair beats the stored
English in every bin it is applied to under both judges. Otherwise **NO-GO**, with the reason.

## As run (2026-10-12, job stale-gate-6567)

- Step 1: 40/40 Opus and 40/40 Flash High reads parsed; 12 splits (all Gemini-only material claims), refereed by Opus
  (12 calls, 4 pages confirmed material); no Pro referee call was needed. 21 of 40 pages material, 19 went to step 2.
- `plants-pick.mjs` drew p08, p09, p17, p22, p27, p37, p39, p40; `plants.json` committed before step 2. After step 2 a
  `key` (the planted words) was added to each plant for scoring only: an arm carries a plant while its text contains the
  key (the first version matched the whole planted span, which a diff-correct edit inside the span hid on p39).
- Step 2: 19/19 retranslations, 19/19 diff-corrections (0 rejected by the contract). Judges: 19/19 Opus, 19/19 Pro.
- Write-up: `scripts/eval/experiments/2026-10-12-stale-siku-english-gate-6567.md`.
