---
stage: ocr
measure: [accuracy, stability]
languages: [sa]
scripts: [Mlym]
canons: [sanskrit]
n_books: 1
n_pages: 6
verdict: "Reading Whish 147 one row at a time does not help: scored row by row against GRETIL, single-row strips give CER 0.60 (Fable 5.1) and 0.65 (Opus 5.5), against 0.51 and 0.54 for the half-leaf reads of the same 9 leaves (noise floor 0.70). Re-scored the same way, the half-leaf reads are clearly above chance but differ from the published text in about half of all characters. A single earlier Fable read at CER 0.09 did not repeat: a fresh read of the same crop scored 0.52."
status: rejected
decision: "Line strips are not adopted; the best-attempt job (#7119) keeps half-leaf crops. Its free-read warning was rewritten to the per-row figure (about half of all characters differ, 7 leaves), replacing both the old 'at chance' sentence and an interim '9 in 100' figure."
superseded_by: null
issue: [7119, 5935]
---
PRIOR ART: 2026-10-21-whish147-malayalam-palm-leaf-opus.md — same manuscript, same models, same GRETIL reference; it measured whole-page, half-leaf and quarter-leaf crops with a whole-read scorer and never cut single rows. Its scorer is the reason for the per-row re-score below.

## 2026-10-22 · Does reading Whish 147 one text row at a time beat the half-leaf read? (#7119)

**Question.** Claude's Read tool downscales an image to about 1,568 px, so a 2,560 px half-leaf loses about 40% of its resolution before the model sees it, and the rows either side of the string hole do not line up (the false omission in #7109). Cutting each row into its own full-resolution image, split at the hole, removes both problems. Does it make the free read (no edition shown) more accurate?

**Design.**
- *Leaves.* The 9 left half-leaves of the verse text that the multi-leaf collation run located in GRETIL (pages 4–9: 4b, 5t, 5b, 6t, 6b, 7t, 8t, 8b, 9t; kārikās 1–58).
- *Strips.* Automatic segmentation (ink projection profile, then a fitted line grid) failed on these leaves: the leaf grain, the scored ruling lines and pale ink put row boundaries mid-line. So the row layout was set by eye from a labelled grid of each leaf (`rows-by-eye.json`: hole x, first and last row centre, row count per side), rows evenly spaced and nudged to the local ink maximum (±12 px), each strip ±66 px around its centre. Every leaf's strips were stacked and checked by eye: one row per strip on all 9 leaves. 162 strips in all, 1,139–1,280 px wide (nothing downscaled), in reading order row by row, left of the hole then right.
- *Arms.* Opus 5.5 and Fable 5.1, each on (a) the 9 strip sets, one call per leaf with its 18–20 strips as p01…pNN, and (b) the 9 half-leaf crops, one call per leaf. All 36 calls ran on the subscription through `claudeCall` (`scripts/batch/claude-ocr.mjs`), sealed folder, live OCR prompt "Standard OCR v19.1" with the Sanskrit language slot. The half-leaf arm uses the lane's own per-call instruction unchanged. The strip arm replaces it with a strip instruction: one row per image, transcribe the middle row only, no carry-over, never from memory, transcription only (`run-arms.mjs`).
- *Score.* `score-lines.py`. Each row of a read (a strip pair, or one line of a half-leaf read) is matched on its own to its best window inside the leaf's located verse span (±1 verse), and CER is pooled over rows of at least 8 characters. The noise floor is built the same way, with the same row lengths and the same span: shuffled letters of a random GRETIL slice, and a reversed real passage. The old whole-read figure (one string against one window, the 2026-10-21 instrument) is kept as `wholeCER` for continuity. The normalisation also maps the dot reph ൎ and the chillu letters to consonant + virama, and the old single e/o signs to e/o. Without that, *dhaൎmmi* stays untransliterated and short *è/ò* count as errors (`scores-v1-normalisation.txt` has the old normalisation; it changes each pooled figure by under 0.01).

**Result** (per-row CER; lower is better, noise floor ≈ 0.70):

| arm | leaves scored | chars | pooled CER | by-leaf range | floor (shuffled / reversed) | whole-read CER, median |
|---|---|---|---|---|---|---|
| Fable 5.1, half-leaf | 7 of 9 (declined 7t, 8t) | 2,080 | **0.51** | 0.45–0.58 | 0.71 / 0.70 | 0.73 |
| Opus 5.5, half-leaf | 7 of 9, two of them under 75 chars (declined 8t, 9t) | 1,516 | 0.54 | 0.36–0.62 | 0.70 / 0.68 | 0.76 |
| Fable 5.1, single-row strips | 9 of 9 | 2,740 | 0.60 | 0.48–0.66 | 0.72 / 0.71 | 0.74 |
| Opus 5.5, single-row strips | 9 of 9 | 2,882 | 0.65 | 0.60–0.68 | 0.72 / 0.71 | 0.76 |

- **Strips are worse, not better.** Pooled, both models lose about 0.08–0.11 of CER going from the half-leaf to single rows. Paired by leaf, the strip read is worse on every leaf both arms scored: Fable 7 of 7 (by +0.03 to +0.14), Opus 5 of 5 (by +0.02 to +0.19). The strips do remove declines: neither model declined a strip set, while each declined two half-leaves. But what they read on strips is mostly guessed: Opus's strip reads are almost entirely `<unclear>` akṣaras. A reading model seems to need the whole leaf's context (the run of the verse, recurring letter shapes) more than it needs the pixels.
- **The half-leaf reads are above chance, not at it.** Scored row by row, every half-leaf read of at least 75 characters sits below its floor: Fable by 0.13–0.24, Opus by 0.07–0.22. The 2026-10-21 file put them at chance, but its whole-read scorer compares a read of a half-leaf (each row only the first part of a leaf line, the rest on the other half) with one contiguous stretch of the edition, so even a perfect read scores badly. The whole-read column above stays at 0.73–0.76 for every arm, near its floor, whatever the read is like. Row by row, the reads still differ from the published text in about half of all characters: rough guides to the words, not transcriptions.
- **Unstable across reads.** Yesterday's Fable read of the 5b crop (`rescore-2026-10-21/`) scores **0.09** per row. Its meta named the text ("Sāṅkhyakārikā verses 11–16"), and its rows read almost word for word as the edition. Today's Fable read of the identical crop, same prompt, scores **0.52**, and no read today named the passage. So one read in two on that leaf recognised a famous text and probably wrote it partly from memory. That is useful where the text is known, and risky on the commentary pages, where a remembered text could replace the leaf. Opus on the same crop: 0.56 yesterday, 0.43 today.

**Not run.** The optional third arm (strips plus a glyph key cut from verified rows of another leaf): with strips behind the half-leaf on both models, it would not change the decision. Gemini: its CLI quota resets about 2026-10-23.

**What it changed.** The best-attempt job for this book (Hetzner `whish147-best`, #7119) keeps its half-leaf crops. It got two notes during the run:
- The first corrected the "at chance (CER 0.64–0.75)" sentence in its free-read warning, from the single 0.09 read.
- The second superseded that with the 9-leaf figure above (about half of all characters differ, 7 leaves), once the fresh read showed the 0.09 did not repeat.

That second note is the wording readers see.

- *Replicated?* One manuscript, 9 leaves, one read per arm per leaf; the 5b leaf has two Fable reads (0.09, 0.52) and two Opus reads (0.56, 0.43). The instability itself is the replicated finding.
- **Artifact.** `scripts/eval/results/whish147-line-strips-2026-10-22/` holds `rows-by-eye.json`, `cut-strips.py`, `strips.json`, `run-arms.mjs`, `score-lines.py`, all 36 reads with their meta (model, prompt hash, timing), `scores.json`, `scores.txt`, and `rescore-2026-10-21/` (the two 2026-10-21 reads of 5b, re-scored the same way).
