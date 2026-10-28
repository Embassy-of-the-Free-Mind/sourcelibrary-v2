---
stage: translation
measure: judged
languages: [bo]
scripts: [Tibt]
canons: []
n_books: 6
n_pages: 50
verdict: "Gate failed translator-side, nothing written. With each leaf attached, Opus read all 1,836 pages of six held Tibetan books; the blind image-grounded audit (11/11 controls caught) passed the 30-page Bardo pilot (1/30 bad) but failed the fresh 20-page check across the six books (2/20 bad, 10%, CI 2.8-30%); pooled 3/50 = 6%. 0 reversals, 0 OCR-side bad pages: every bad page is an addition in a note or summary (an invented quotation frame, a 'forty-two deities' summary over a leaf that says thirty-six, a note on the title). The image fixed OCR errors the 10-24 text-only lane could not see, including an OCR-inserted negation (Bardo p. 286)."
status: rejected
decision: "No write. The 1,836 reads are kept in the job scratch; writing them waits on Derek's decision (a review pass over notes and summaries, then a fresh re-audit) (#6948)"
superseded_by: null
issue: [6948]
---
## 2026-10-27 · Does attaching the leaf image let Opus translate six held Tibetan books at ≤ 5% bad pages? (#6948)

PRIOR ART: `2026-10-24-opus-translate-tibetan-sanskrit-gate-6948.md` (the text-only Opus lane and its audit; it failed
at 35% bad Tibetan pages, 18 of 28 from the OCR); `scripts/eval/opus-tib-sa-6948/` (`audit.mjs` plant/packet/score/
attribute and `read-loop.sh`, reused unchanged except `READ_EXTRA`); `scripts/batch/claude-translate.mjs` (the reader,
which gains `--images-dir`) and `cli-translate.mjs apply` (the writer, dry-run only here). New: `scripts/eval/tib-concept-opus-6948/prep.mjs`.

**Who it was for.** Derek's conceptual histories (soul, mind, magic, mathematics as spiritual), which need these six
held, hidden Tibetan books in English: Bardo Thödol, a *'das log* narrative, Dolpopa's Ratnagotravibhāga commentary
bound with the Kālacakra and Indian Dharma histories, a minor-sciences miscellany, Kongtrul's chöd notes, and a
Mahākāla *gtor bzlog* ritual.

### What changed from 10-24
The translator sees the leaf. `claude-translate.mjs --images-dir=D` copies each page's image into the call's sealed
folder as overlapping full-resolution strips. The pecha leaves are 8704×1824 px, so one reduced image would leave the
lines about 60 px tall; the strips are of aspect ≤ 1.8 and keep them at 100 px or more. The CLI is allowed Read and
nothing else. The prompt tells it to open every strip, to translate what the **leaf** says, and to mark with a
bracketed note any place where the leaf departs from the transcription. The image line is part of the hashed prompt.
Each page's meta lists its images by sha256, and the reads carry their own prompt_variant (`claude-block-6559-unclear-image`).
Calls are 10 pages each.

### Frame (`prep.mjs frame`, read-only)
1,836 pages: Yigdzin text (`bdrc-yigdzin-v1`, pipelines `reocr_bdrc_4523` and `tib_gutter_vllm_6871`), non-empty, with
no English. 0 pages of the six books had English; the frame asserts this.

| book | frame pages |
|---|---|
| Bardo Thödol | 343 |
| 'das log | 277 |
| Dolpopa / Tāranātha | 649 |
| minor sciences | 498 |
| Kongtrul chöd notes | 23 |
| Mahākāla gtor bzlog | 46 |

Left out of the frame:
- Bardo pp. 2–25: their OCR is gemini-flash-lite;
- 112 Bardo pages with no OCR;
- 17 pages in the other books whose OCR is flash-lite, and 11 pages with no OCR.

### Gate (from the brief, fixed before any audit was read)
- At most 5% of audited pages bad, taking the blind auditor's verdict as given. Looking by eye can only add bad pages.
- A meaning reversal on a translator-side page counts double.
- Stage 1: a 30-page Bardo pilot.
- Stage 2: after the full read, a fresh 20-page draw across the six books.
- Nothing is written unless both stages pass.

### Results
| stage | n | bad | 95% CI | reversals | controls caught | OCR spans per page (mean) |
|---|---|---|---|---|---|---|
| Pilot: Bardo, 3 blocks of 10 (pp. 166–175, 206–215, 399–408) | 30 | **1 (3.3%)** ✓ | 0.6–16.7% | 0 | 6/6 | 1.6 |
| Fresh: 20 pages across the six books (seed 69484) | 20 | **2 (10%)** ✗ | 2.8–30.1% | 0 | 5/5 | 2.1 |
| pooled | 50 | 3 (6%) | 2.1–16.2% | 0 | 11/11 | |

**All three bad pages are translator-side. None is OCR-side, and none is a reversal.** Each one is something Opus
added in a note or summary, not a misreading of the body text:
- **Bardo p. 170.** The leaf breaks off mid-quotation, and Opus opened the quotation with "As the root verse says". The
  next leaf does close it with ཞེས་གསུངས་པ, "thus it is said", but neither leaf says "root verse".
- **Bardo p. 249.** The body correctly says "thirty-six peaceful buddhas". The summary says "forty-two peaceful
  deities", the stock number of the Bardo cycle, which this leaf contradicts.
- **Mahākāla p. 46.** The note "the title of the work speaks of ten Wrathful Ones" is true: the book's title is *khro bo
  bcu'i gtor bzlog*, "ten wrathful ones", and the auditor was not shown the title. The page also completes a sentence
  the leaf edge cuts ("after directly seeing") and silently drops an OCR-garbled ordinal ("sixteenth"). Under the
  pre-registered rule it stays bad.

Caveat pages (pilot 16/30, fresh 11/20) are mostly small omissions of a phrase and editorial notes about interlinear
insertions.

**What the image bought.** The OCR on these printed and blockprint books is far cleaner than on the 10-24 Kangyur
frames: 1.6–2.1 spans per page differ from the leaf, against 16.6 there. Where the OCR was wrong, Opus usually saw it:
140 of 1,836 pages carry a leaf note, 164 notes in all. Three were checked by eye:
- **Bardo p. 286.** The OCR inserts a negating མ into a five-fold refrain: "the bodhisattva who does **not** work for
  beings". The leaf reads བྱང་ཆུབ་སེམས་དཔའ་འགྲོ་བའི་དོན་མཛད་པའི, with no མ; checked by eye. Opus translated the leaf.
  A text-only reader would have made a reversal.
- **Bardo p. 45**, the brief's known error: the leaf has སྣང་བ་མཐའ་ཡས "Boundless Light" where the OCR has
  སྣང་བ་ཐམས་ཅད་ཡས. Opus noted and followed the leaf, here and on p. 42.
- **'das log p. 116:** "turned into poison" (*dug tu*) where the OCR's *drug du* would give "into six".

One note was wrong. On the re-read of Bardo p. 170, Opus said the leaf's last syllable is "rna"; by eye it is རུ, as
transcribed.

### Cost and pacing
- **Reads:** 290 calls (38 refused by the strict splitter and retried; mostly a preamble or a single block-level
  summary outside the page tags), $210.86 list-equivalent, about $11.5 per 100 pages.
- **Audits:** about 75 calls in all (61 audit replies, plus plants and attribution).
- **Meter:** the week on dereklomas@gmail.com went 1% → 27%. The 5-hour window capped the run at 80% twice, and
  read-loop waited each time.
- **Pacing:** Derek's pacing note (15:23Z) halved concurrency from 4 calls to 2.
- **Paid spend:** $0; no Gemini.
- **Prompt fix:** one sentence in the image suffix put each page's `<summary>` inside its own tag. The base prompt's
  "END with <summary>" was read as once per reply on 5 of the first 8 calls.

### What this means
- **Attaching the leaf works for the OCR side.** No bad page came from the transcription, and the reader corrected OCR
  errors that would otherwise become reversals.
- **The remaining errors are additions.** Opus adds notes and summaries from what it knows about the text (the stock 42
  deities, a "root verse" frame) rather than from the leaf. A check aimed only at `<note>` and `<summary>` content,
  against the leaf, would target exactly the observed failure.
- **The reads are kept** (`$JOB_SCRATCH/run/*`, `pilot/read`; R2 candidate-reads keep refused on a precondition). If a
  review pass fixes notes and summaries, a new fresh draw at the same bar decides the write.

**Replicated?** No: one pilot and one fresh draw, n = 50 pooled.
