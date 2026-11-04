---
stage: ocr
measure: [stability, agreement]
languages: [bo, lzh]
scripts: [Tibt, Hani]
canons: [derge-kangyur, derge-tengyur, cbeta]
n_books: 200
n_pages: 200
verdict: "Same pixels, different context. PaddleOCR-VL-1.6 reads glyphs: 0 of 175 single swapped characters reverted to the original (20 alignable pages, faithful 95%), excess flip under scrambling 5.1 points [2.9, 8.9] and equal inside CBETA/Siku and outside (+0.3 [−5.0, +7.2]; clean pages −0.5 [−1.5, +0.5], could see 1.4); Flash shows the same excess on the same pages (−0.3 [−4.8, +3.8]), so the 5 points is most likely the recomposition, not language-model recall. Yigdzin: its stated training corpus (BoCorpus) holds the Derge Kangyur, which triggers the rule's provenance clause on its own; in behaviour no inside/outside gap in excess flip (clean +1.8 [−2.2, +5.9], could see 5.9), but no positive control can read the Tibetan print, so the behavioural half is not validated for Tibetan."
status: informational
decision: "Yigdzin: quote ~0.95 only for the Derge Kangyur (provenance clause; DECISION on #8182 for the wording and an image-grounded non-Kangyur check). PaddleOCR-VL: rule branch 3 at the instrument's floor — no corpus-specific claim; keep the CBETA/Kanripo scores (#8182)"
feeds: [reference]
superseded_by: null
issue: [8182]
router_evidence: "none — a memorisation probe on composed test images; no route compared"
defect_rates: "none — scored as bag flip and per-glyph outcomes, not page defects"
---
## 2026-11-04 · Do Yigdzin and PaddleOCR-VL read from memory? Same pixels, different context (#8182)

PRIOR ART: `.claude/docs/ocr-memorization-paper.md` (frontier models, text input); `2026-11-04-zh-planted-edits-
memorisation-8171.md` (Flash on text: memorises famous works, no extra recall on CBETA/Kanripo pages; its B and C
frames are this run's ZB and ZC, by id); `2026-10-01-fingerprint-test-…-5549.md` (no power: this run states its MDE
and reports a null as a bound); `2026-10-12-tibetan-yigdzin-correct-vs-redo-6560.md` and `…-paddle-zh-correct-vs-
redo-6561.md` (the planted-error and recitation read-offs that raised the question). New code:
`scripts/eval/ocr-context-8182/` (draw, overlap, segmentation `ppseg.py`, composer `compose.py`, `tojpeg.py`, GPU
task, `controls.mjs`, `score.mjs`).

Provenance (Step 1): `scripts/eval/ocr-context-8182/PROVENANCE.md`, commit 66fe3f348, posted on #8182 first.
Preregistered: `scripts/eval/ocr-context-8182/PREREGISTRATION.md`, commit 52bd11ad8, before any engine read a test
image. The decision rule is the brief's, verbatim. Results: `scripts/eval/results/ocr-context-8182/scores.json`
(per page: stems, counts, scores; no page text). No CBETA, Kanripo, Derge/BoCorpus or engine text is committed.

### What Step 1 found (short)

- **Yigdzin 1** (`BDRC/tibetan-ocr` @50506eb6) has a language decoder (PaddleOCR-VL-1.6 base, 26-layer decoder) and
  its synthetic training pages were "BoCorpus-rendered"; BoCorpus holds the **Derge Kangyur (103) and Derge Tengyur
  (213)**. Which collections were rendered: not stated. The tokenizer is "BoCorpus-warmed". So the frame we quote
  (~0.95 against the Derge e-text) is in the stated training source. The rule's second clause fires on this alone.
- **PaddleOCR-VL-1.6**: ERNIE-4.5-0.3B decoder; "ancient books" from undisclosed web and in-house sources. CBETA,
  Siku, Kanripo: not stated either way.
- **Kraken** (served Syriac): CTC, no autoregressive decoder; `sophro-mhiro` trained on "mostly Biblical texts".

### Design (the prereg has it all)

One page per book, seeded 8182. **TK** Derge Kangyur (40, inside), **TO** printed Tibetan whose served text has a
BoCorpus 6-gram share < 0.2 (40, outside), **TT** Derge Tengyur (40, exploratory: inside, a different text), **ZB**
#8171's CBETA + Siku pages (40, inside), **ZC** #8171's obscure non-Siku pages (40, outside). From each leaf, units
are cut (Chinese: one character box; Tibetan: a letter stack or a run of touching stacks, because the tsheg is not
separable at the scan's resolution) and one composer draws: **N** units in their original order, **N2** the same with
shifted margins and gaps (layout floor), **S** every unit permuted across the page with line lengths kept, **W** N
with max(3, 5 %) units swapped for others of the same leaf, **B** N with ~10 % of units blurred. S kept **0**
original neighbour pairs on every page. Engines as served on gex45's own card through its queue: Yigdzin (production
vLLM worker) on Tibetan, PaddleOCR-VL-1.6 (print-lane genai server, layout off) on Chinese, each reading N twice,
N2, S, W, B. Controls on subscriptions: gemini-3.8-flash-low (agy) and Opus (`claude -p`).

Primary measure: **excess flip** E = F(N, S) − F(N, N2), F the bag-of-tokens distance (Han characters; Tibetan
grapheme clusters). Secondary: per-glyph flip and a sharp W read (reverted to the original character / faithful to
the donor / neither) on Chinese pages where a read's character count equals the unit count. Book-cluster bootstrap,
10,000 resamples.

### Segmentation yield (an outcome, nothing dropped)

| group | ok / drawn | units per page, median (p10–p90) | line-box height px, median (p10–p90) |
|---|---|---|---|
| TK | 40 / 40 | 459 (228–517) | 75 (69–87) |
| TO | 38 / 40 (1 segmentation failed, 1 too few units) | 287 (117–368) | 91 (43–124) |
| TT | 36 / 40 (4 segmentation failed) | 382 (94–478) | 51 (43–59) |
| ZB | 40 / 40 | 268 (143–428) | — |
| ZC | 40 / 40 | 255 (136–384) | — |

**Opened by eye** (seeded 5 per group, `seg.jpg` and `S.png` contact sheets; TK also N and W at full size): units sit
on the text lines on most pages; S shows real glyphs in an order that never existed. Failures seen: one faded TK
leaf with half its lines missed (235 units); one TT leaf where a single box spans all 7 lines, so its units are
column slices, not stacks; one small-print TO leaf with only ~3 lines boxed. In Chinese, the large main-text characters
and the small interlinear commentary both become units, so S mixes sizes within a column (N does too); on a recipe
page many units are two-character fragments of small print. These pages stay in (same units in N and S, so the
comparison stays fair).

### Instrument checks (preregistered, before any conclusion)

| check | Yigdzin | PaddleOCR-VL |
|---|---|---|
| 3. same-image floor F(N, N again) | 0.005 TK, 0.000 TO, TT (deterministic) | 0.000 (deterministic) |
| 1. blur responds: F(N, B) − floor | TK 0.171 [0.067, 0.289], TO 0.078 [0.045, 0.114]: **passes** | 0.100 [0.072, 0.141]: **passes** |
| 2. a control fires (E > 0) | **no control can read the Tibetan print** (below) | Flash on Chinese E 0.057 [0.029, 0.086], n 35: **passes** |

**Controls, honestly.** Flash on Tibetan is not a reader: two reads of the same image differ by 0.45, as much as two
different pages (0.40); it composes sutra text, and Gemini's filters blocked 32 of 81 N reads (TK 9, TO 20 of 20, ZC 3).
Opus could not read the red Derge print at all in a test read (nearly every syllable "?"), so Opus was moved to
Chinese only (TAKEN). Check 2 as preregistered (Flash or Opus pooled over their pages) passes, E 0.045 [0.015, 0.079],
n 43, but the Tibetan pages in it are not a control. **For Tibetan the instrument is validated by the blur check
only.** On Chinese the control fires, but weakly, and no more than PaddleOCR-VL: Flash minus Paddle on the same 35
pages, E −0.003 [−0.048, +0.038]. The positive control was expected to depend on context more; it does not. Opus read
N and S only (no floor; prereg), so it has no E: its raw F(N, S) exceeds Paddle's on the same 29 pages by 0.038
[0.017, 0.058], and its per-glyph flip is 0.19 (8 alignable pages) against Paddle's 0.09 (16): suggestive, not a
measured excess. The sharp W read does not fire for Flash either (1 reversion in 71 swapped characters, 8 pages).

### Results

**PaddleOCR-VL-1.6 (Chinese)**

| | ZB inside | ZC outside | inside − outside |
|---|---|---|---|
| E, all ok pages (n 40 / 40) | 0.052 [0.025, 0.107] | 0.050 [0.027, 0.086] | **+0.003 [−0.050, +0.072]**, MDE 0.083 |
| E, clean pages (no read failure on N, N2, S, W; n 39 / 39) | 0.028 [0.023, 0.034] | 0.033 [0.025, 0.042] | **−0.005 [−0.015, +0.005]**, MDE 0.014 |
| W, sharp (pages with N and W alignable: 9 / 11) | faithful 0.964 [0.902, 1.000], reverted 0 | faithful 0.946 [0.870, 1.000], reverted 0 | — |
| per-glyph flip N→S (alignable: 9 / 7 pages) | 0.125 [0.013, 0.331] | 0.040 [0.021, 0.061] | too few pages |
| flipped reads that land on a character of the page's own N read | 0.37 (7 pages) | 0.17 (7) | exploratory |

**0 of 175 swapped characters were read as the original** (167 as the donor, 8 as neither) across 20 pages. Where a
single glyph contradicts its context, PaddleOCR-VL reads the glyph. Alignment (a read's character count equal to the
unit count) held on only 20–29 % of pages per image: an outcome, reported; the bag measures cover every page.

**Yigdzin (Tibetan)**

| | TK inside | TO outside | TT (exploratory) | TK − TO |
|---|---|---|---|---|
| E, all ok pages (n 38 / 38 / 36) | 0.179 [0.044, 0.310] | 0.138 [0.099, 0.183] | 0.058 [−0.006, 0.095] | +0.041 [−0.099, +0.188], MDE 0.197 |
| E, clean pages (n 20 / 36 / 35) | 0.134 [0.107, 0.164] | 0.117 [0.089, 0.145] | 0.085 | **+0.018 [−0.022, +0.059]**, MDE 0.059 |
| W, bag-form reversion (all ok) | 0.80 [0.72, 0.88] | 0.48 [0.38, 0.58] | 0.62 | +0.32 [+0.18, +0.45] |
| read failures on S (under 0.5× / over 2× the page's count, or hit the length limit) | 12 / 38 | 1 / 38 | 0 / 36 | +0.29 [+0.13, +0.45] |

Three things qualify these numbers.
1. **The bag-form W reversion is not a reversion measure.** PaddleOCR-VL scores 0.38 on it while the sharp read on
   the same engine finds 0 reversions in 175. The bag form counts tokens a swap fails to change; donor and target share
   letters (Tibetan stacks) or fall inside the layout noise, and it has no calibration to "read the expected text".
   The +32-point Yigdzin gap is reported and **not interpreted**.
2. **TK pages fail under any perturbation, not just S.** TK reads hit failures on B (blur, same context as N) 17/38,
   S 12, N2 6, N 4; TO and TT almost never. Blur leaves the context intact and fails more than scrambling does, so the
   TK failures are a property of those images (the largest and most crowded leaves: median 459 units, red print), not
   evidence of context use. The design cannot separate Kangyur text from Kangyur print.
3. **Legibility.** Line-box heights barely overlap between TK (69–86 px) and TO (43–124). Within tertiles the
   difference is +0.15 [−0.17, +0.44] (11 vs 13 pages), +0.06 [−0.10, +0.20] (23 vs 3), −0.14 [−0.50, +0.08]
   (4 vs 22): no tertile has both groups in numbers.

Yigdzin does use context in general: excess flip 12–13 points on clean pages, inside and outside alike, against a
deterministic floor (TT 8.5).

### Decision (rule as preregistered)

- **Yigdzin: clause 2, by provenance.** "Step 1 confirms overlap between training data and a scored frame": the
  card's stated source corpus contains the Derge Kangyur we score against. So ~0.95 may be quoted only for the Derge
  Kangyur. The behavioural test does not add to or subtract from that: no inside/outside gap in excess flip (clean
  +1.8 points, could see 5.9), but with no Tibetan positive control the behavioural half is "instrument not
  validated: no conclusion". DECISION on #8182: the wording, and an image-grounded check of non-Kangyur Tibetan.
- **PaddleOCR-VL-1.6: branch 3 ("context dependence equal inside and outside"), at the instrument's floor.** Excess
  flip 5.1 points [2.9, 8.9], the same inside and outside, and the same as Flash on the same pages, so most likely an
  effect of the recomposition on any reader rather than language-model recall. No corpus-specific claim; keep the
  CBETA/Kanripo scores. The gap this could have seen: 8.3 points on all pages, 1.4 on clean pages.

### Not established

- Whether Yigdzin's training pages include Kangyur renders (the card says the source corpus holds it; not which parts
  were rendered). Whether PaddleOCR-VL saw CBETA, Siku or Kanripo (not stated).
- Anything behavioural about Yigdzin that a positive control could vouch for. TT (Tengyur, also in BoCorpus) behaves
  like TO, not TK, which points at the TK images rather than the text, but TT is exploratory.
- Recall of **famous** text by either small engine: neither frame here is famous (#8171 found Flash's memorisation in
  famous works only). A small-engine test on #8171's A frame would be the next probe.
- Accuracy against a reference: not scored here (bag agreement with served text only, not reported as accuracy).
- Unit size differs by script and print: Tibetan units are stacks, not syllables; scrambling them breaks syllables too.

### Proposed addition to `ocr-memorization-paper.md` (proposed, not edited)

> **Small OCR engines, image input (#8182).** Using the same glyph images in their original order, scrambled, and
> with single glyphs swapped, PaddleOCR-VL-1.6 read swapped characters faithfully (0 reversions in 175) and showed an
> excess flip under scrambling of ~5 points, equal on CBETA/Siku-covered pages and on obscure ones, and equal to
> Flash's on the same pages. Yigdzin's training source (BoCorpus) contains the Derge Kangyur it is scored against, so
> its ~0.95 is reported for that text only; its excess flip (~13 points) showed no Kangyur-specific excess, but no
> available control could read the Tibetan print, so that null is not validated. A composed-image test separates
> reading from recall only where some reader of the script can serve as a positive control.

### Calls and cost

agy 362 (cap 600), `claude -p` 66 (cap 300), $0 API. GPU: two gex45 queue tasks, Yigdzin 13 min (684 reads),
PaddleOCR-VL ~15 min (480 reads). No rented GPU, no Gemini API, no writes to pages or books.

Not preregistered (stated): the clean-page robustness pass (read failures inflate the layout floor); the control floor
for pages without their own repeat read is the group's mean same-image floor (first written as the arm's mean, which
put Flash's Tibetan floor under its Chinese pages; fixed before this record); Opus on Chinese only, 16 pages per group.
