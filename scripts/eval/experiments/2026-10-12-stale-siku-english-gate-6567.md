---
stage: translation
measure: judged
languages: [lzh]
scripts: [Hani]
canons: []
n_books: 40
n_pages: 40
verdict: "Below an old-vs-new CER of 0.1, the new Paddle reading is usually right (2 of 16 pages have a material OCR error), and a fresh 3.8 Flash translation beats the stored English on every judged page where they differ, under both judges (Opus 1.68 → 0.00 material errors per page, Gemini 3.1 Pro 4.16 → 1.05, n = 19). At CER ≥ 0.1 the Paddle reading itself has a material error on 19 of 24 pages, so retranslating from it would carry those errors into the English. Diff-scoped correction fixed much less than retranslation (Opus 0.95, Pro 2.74), because most errors in the stored English come from the translation, not from the old reading. Both judges caught 16 of 16 planted errors."
status: undecided
decision: null
superseded_by: null
issue: [6567, 6388, 6553]
---
## 2026-10-12 · Stale Siku English: check the new Paddle reading, then retranslate or diff-correct? (#6567)

PRIOR ART: `2026-10-11-paddle-stale-english-retranslate-6388.md` (#6518) decided that the stale English should be
repaired, and its pre-registered rule said to retranslate all of it. This gate asks the two questions that come first:
is the Paddle reading right, and is a diff-scoped correction as good as a fresh translation? Code, prompts, reads and
the pre-registration are in `scripts/eval/stale-gate-6567/`. The README was committed (`8ff393c84`) before any
reviewer ran. The plants were committed (`52025fa15`) before step 2 ran. Every number below comes from `results.json`,
`results.md` and `ocr-final.json` (`gate.mjs`). The cost was $0: every call went through a subscription CLI
(`claude -p`, `agy -p`) and no paid API was called. Nothing was written to `pages` or `books`.

**Frame (census, 2026-10-12).** 75,543 pages still carry `translation_stale.lane = paddle-zh-2026-10`. That is 158
fewer than #6518 counted.
- 30 pages have fewer than 8 Han characters and were left out.
- The #6516 table detector flags **0** of the stale pages, so none were excluded. 44 pages trip its loop gate, but
  none of them has the table shape.
- Eligible pages by CER bin: 0–.05: 34,721 · .05–.1: 15,955 · .1–.2: 9,933 · .2–.5: 5,552 · .5–1: 9,352 (total 75,513).

**Draw.** 8 pages per bin, one page per book across all 40 books, seeded.

### Step 1: is the Paddle reading right?

Opus and Gemini 3.8 Flash High each read the Paddle text against the image, independently. They split on 12 pages,
and every split was a material claim that only Gemini made. Opus refereed those claims and confirmed 4 of the 12 pages.
There were no failed reads.

| CER bin | material OCR error | Wilson 95% |
|---|---|---|
| 0–.05 | 2 / 8 | 7–59% |
| .05–.1 | 0 / 8 | 0–32% |
| .1–.2 | 7 / 8 | 53–98% |
| .2–.5 | 7 / 8 | 53–98% |
| .5–1 | 5 / 8 | 31–86% |
| **< .1 pooled** | **2 / 16** | 3.5–36% |
| **≥ .1 pooled** | **19 / 24** | 60–91% |

**What the errors are.** Mostly a single character misread into a different word: 熱 read as 熟, 不 as 下 (a negation
lost), 堯 as 克 (a name), and place names in maps. On map and diagram pages, labels are dropped or scattered.

**Where the errors come from.** A heuristic check looked for each error's characters, with their context, in the OLD
reading:
- In the ≥ .1 bins almost all the errors are new: only 6 of 63 claims also appear in the old reading.
- On the two material pages under .1, 5 of 6 claims appear in the old reading as well. So the stored English already
  carries them, and a retranslation would not add them.

**Who finds the errors.** Opus alone flagged 17 of the 21 material pages. Gemini alone flagged 29, and 21 of them held up.
- The two material pages under CER .1 were both raised only by Gemini.
- So a check run by Opus alone would have missed both of them.

### Step 2: retranslate vs diff-correct, on the 19 pages that passed step 1

**The two arms.**
- **RETRANSLATE**: 3.8 Flash (CLI), with the production single-page prompt.
- **DIFF-CORRECT**: 3.8 Flash (CLI), given the image, the new reading, the old→new hunks and the stored English. It
  returns replacements, and those replacements are held to an edit contract.

**Judging.** Opus and Gemini 3.1 Pro judged blind against the image and the new reading, in MQM. A **material error**
is an accuracy error of major or critical severity. Plants are excluded from these counts.

| CER bin | pages | stored O / P | retranslate O / P | diff-correct O / P | edit size, median word-level (RT / DC) | s per call (RT / DC) |
|---|---|---|---|---|---|---|
| 0–.05 | 6 | 1.33 / 3.17 | 0.00 / 0.50 | 1.33 / 3.00 | 0.93 / 0.00 | 12 / 15 |
| .05–.1 | 8 | 0.63 / 3.25 | 0.00 / 1.00 | 0.38 / 2.50 | 0.79 / 0.01 | 20 / 39 |
| .1–.2 | 1 | 1.00 / 2.00 | 0.00 / 0.00 | 0.00 / 0.00 | 0.73 / 0.04 | 21 / 12 |
| .2–.5 | 1 | 11.0 / 18.0 | 0.00 / 1.00 | 0.00 / 0.00 | 0.78 / 0.30 | 16 / 14 |
| .5–1 | 3 | 2.33 / 4.67 | 0.00 / 2.67 | 2.33 / 4.67 | 0.94 / 0.00 | 15 / 18 |
| **all 19** | 19 | **1.68 / 4.16** | **0.00 / 1.05** | **0.95 / 2.74** | | 16 / 26 |

**Retranslation against the stored English.** Retranslation was never worse than the stored English on any page,
under either judge:
- under Opus, it was better on 11 pages and equal on 8;
- under Pro, it was better on 16 and equal on 3.

**Diff-correct.** It was better than the stored English on 4 pages under Opus and on 8 under Pro, and worse on none.
- It made 24 edits in total, and no edit at all on 9 of the 19 pages.
- Retranslation beat it on 9 pages under Opus and on 12 under Pro. Diff-correct won on 1 page, under Pro.

**Style errors per page** (Opus / Pro): stored 0.79 / 0.42, retranslate 0.53 / 0.16, diff-correct 0.79 / 0.42.

**The two judges.**
- The cross-family judge (Opus) found no material error in any retranslation.
- The same-family judge (Pro) found more errors in every arm. That includes the Gemini retranslation (1.05 per page),
  so Pro shows no sign of favouring its own family's output here.

**The edit contract.** The contract rejected 0 of 19 replies, but it is weaker than its name.
- It checks that each edit cites a real hunk, quotes a unique span, and stays small. It cannot check that the edit
  actually renders the hunk it cites.
- 1 of the 24 edits went outside its tie. On p17 the model changed the planted "seventy" back to "fifty" while citing
  an unrelated nearby change (今→令).
- 1 other edit was legitimate. On p08 the planted "Volume 9" sat in English that renders a changed hunk (山草卷之七), so
  correcting it was allowed.

**Planted errors.** There were 16 plants on 8 pages: numbers, names, negations and senses.
- Opus caught 16 of 16 in the stored English, and Pro caught 16 of 16.
- In the diff-corrected English, which still carried 14 of them, each judge caught 14 of 14.

**Calls and time per page.** No read failed. There were no retries, no nudges, and no output left outside the sentinels.

| step | calls per page | s per call |
|---|---|---|
| OCR check | 1 Opus + 1 Gemini 3.8 Flash High, plus 0.3 Opus referee | Opus 16, Flash High 119, referee 14 |
| retranslate | 1 agy (3.8 Flash Low) | 16 |
| diff-correct | 1 agy (3.8 Flash Low) | 26 |
| judges | 1 Opus + 1 Gemini 3.1 Pro High | Opus 21, Pro 127 |

### The pre-registered rule, as written

Per bin, pick the arm with fewer material errors averaged over the two judges (a tie within 0.25 goes to
diff-correct). Any bin with an OCR-error rate of 15% or more gets a per-page OCR check first. Applied to these results:

| bin | repair | OCR check first? |
|---|---|---|
| 0–.05 | retranslate | yes (25%) |
| .05–.1 | retranslate | no |
| .1–.2 | diff-correct (tie at 0, n = 1) | yes |
| .2–.5 | diff-correct (0 vs 0.5, n = 1) | yes |
| .5–1 | retranslate | yes |

The pre-registered GO test passes. Both judges caught 16/16 plants, and the chosen repair beats the stored English in
every bin under both judges.

**What the literal rule would cost.** It needs an OCR check on 59,558 pages: 59,558 Flash High calls at about 2 minutes
each, plus about 77K Opus calls. That alone is about 980 hours at 2 calls in flight. It would also choose diff-correct in
two bins on one page each, which is not evidence.

### Proposed rule

1. **CER < 0.1 (50,676 pages): retranslate with 3.8 Flash and the production prompt, with no OCR check.**
   - On these pages the Paddle reading had a material error on 2 of 16 pages, and those errors were mostly already in
     the old reading.
   - A check that would catch them needs Flash High, at 119 s a page, because Opus alone missed both.
   - Quota: 50,676 agy calls. That is about 56 h at #6518's box rate of about 900 calls an hour, or about 115 h at 2
     in flight and 16 s a call.
2. **CER ≥ 0.1 (24,837 pages): hold.** Do not retranslate from this Paddle reading. 19 of 24 pages have a material
   Paddle error, and most of those errors are new.
   - These pages go to the OCR fix first (R2, #6561: correction of flagged pages or an Opus re-read), then to
     retranslation.
   - Until then the stored English stays. It is what readers see today, so holding makes nothing worse.
3. **Diff-scoped correction: do not use it for this repair.** The stored English's errors are mostly
   translation-caused, and diff-correct cannot touch those.
   - Retranslation beat it on 9 of 19 pages (Opus) and 12 of 19 (Pro), and lost on 1.
   - Its contract also cannot fully enforce the tie between an edit and its hunk.

**GO** for retranslating the 50,676 pages under CER 0.1 (3.8 Flash CLI, about 50.7K calls). **NO-GO** for the 24,837 pages at CER ≥ 0.1 until their Paddle reading is fixed.

**Limits.**
- n is 8 per bin for step 1 and 1 to 8 per bin for step 2. The .1–.5 bins have one step-2 page each.
- The "< .1: 2/16" rate has a Wilson upper bound of 36%.
- One pass only.
- The judges differ by about 2.5 material errors per page on the stored English, so the absolute levels depend on the
  judge. The ranking stored > diff-correct > retranslate holds under both.
- The heuristic that attributes OCR errors to the old or new reading is a string match on context, not an alignment.
