# Preregistration: do Yigdzin and PaddleOCR-VL read from memory of the texts we score them on? (#8182)

Written 2026-11-04, committed before any engine reads a test image. What ran before this file: the provenance
(Step 1, `PROVENANCE.md`, commit 66fe3f348), the page draw (`draw.mjs` → `draw.json`), the BoCorpus overlap of
each drawn Tibetan page's served text (`overlap.py`), and a segmentation pilot on five pages (no engine read; the
pilot pages are part of the draw only where `draw.json` says so). Eval only: nothing is written to pages or books.
$0 API: no Gemini API, no rented GPU; gex45's own card through its queue; agy and `claude -p` on subscriptions.

## Question

We quote Yigdzin's ~0.95 against the Derge Kangyur and PaddleOCR-VL's scores against CBETA and Kanripo. If an engine
reads partly from a remembered text, the score holds for that text and overstates the rest. Test it, don't assume it
(Derek, 2026-11-04: small models may be especially susceptible). Same pixels, different context: if an engine reads
a glyph image the same way whatever surrounds it, it is reading the glyph; if the reading moves with the context,
and moves more inside the texts it may have seen, that accuracy may be quoted only for the measured texts.

## What Step 1 changed

- **Yigdzin**'s synthetic training pages were rendered from **BoCorpus**, which holds the Derge Kangyur (103 texts)
  **and the Derge Tengyur (213)** (model card, BoCorpus card; `PROVENANCE.md`). So Kangyur against Tengyur is
  inside against inside, not the control the brief proposed. The outside group is drawn by **measured** overlap
  instead (below). "In BoCorpus" is not proof of "in Yigdzin's training pages": which BoCorpus texts were rendered
  is not stated. It is the strongest available proxy and is stated as such.
- **PaddleOCR-VL-1.6**: training data "not stated" for CBETA, Siku and Kanripo. The Chinese contrast is therefore
  reference-covered against not, the frame where the score is quoted against where readers mostly are.

## Groups (one page per book, seeded 8182; `draw.json`: ids, page numbers, served engine, no text)

| group | frame | n | role |
|---|---|---|---|
| **TK** | Derge Kangyur volumes (title prefix `བཀའ་འགྱུར། སྡེ་དགེ`, 77 in the frame) | 40 | Tibetan **inside** (the scored text) |
| **TO** | printed Tibetan, title not canon-shaped (no Kangyur, Tengyur, rgyud 'bum by title), pecha format (image w/h >= 1.2), **BoCorpus 6-gram share of the served text < 0.2** | 40 | Tibetan **outside** |
| TT | Derge Tengyur volumes | 40 | exploratory: inside, a different text; not in the decision rule |
| **ZB** | #8171's B, by id: 19 CBETA works + the 佩文韻府 page + 20 Kanripo-screened Siku pages | 40 | Chinese **inside** reference corpora |
| **ZC** | #8171's C, by id: obscure non-Siku works (no Kanripo title, not CBETA, web search found no copy) | 40 | Chinese **outside** |

Overlap measured before this file (share of the page's distinct syllable 6-grams found anywhere in BoCorpus): TK
median 1.00 (10th percentile 0.86), TT median 1.00 (0.87), TO candidates median 0.10; 43 of 90 TO candidates pass
both filters, the first 40 in draw order are used. Replacement rule: a page whose segmentation fails is an
**outcome** (reported, counted in the yield), not replaced.

TT and TO are scanned at lower resolution than TK (TT ~2,000 px wide; several TO leaves ~1,500). Legibility is a
confound for any context effect (a blurrier glyph leans more on context in any reader). It is handled in three ways:
the measure is the excess over each page's own layout floor; the line-box height in pixels is reported per group;
and the inside/outside difference is also reported within tertiles of line-box height. If the groups do not overlap
in line-box height, that is said and the difference is not attributed to the corpus.

## Instrument (`compose.py`, `ppseg.py`)

**Units.** Text boxes from PP-OCRv6 medium det (+ its CTC character boxes for Chinese) on the page's leaf (Tibetan:
the tallest leafsplit band, as the served worker cuts it). PP-OCRv6 places units only; its reading is used for one
thing, to keep Chinese units whose character is Han, and never enters a score.
- Chinese: one unit = one character box, cuts snapped to the emptiest row, sides trimmed 6 %.
- Tibetan: **not syllables.** The brief asked for syllables at the tsheg. On the pilot's Derge Kangyur leaf the
  tsheg is not separable from its letters at the scan's resolution (opened by eye, native resolution, 2026-11-04):
  neither a column-gap rule nor a headline-dot rule finds most of them. A unit is therefore a letter stack or a run
  of touching stacks, cut at ink-free columns of the letter-body zone, with runs wider than 0.9 line-box height cut
  at column-profile minima into ~0.6 pieces (about one stack), the same rule on every print so the unit size does
  not differ by group. Scrambling stacks breaks syllables as well as phrases: that is a stronger manipulation than
  the brief's, applied equally inside and outside.

**Images**, all from the same unit crops and one composer:
- **N**: units in the original order (controls for recomposition: never compare S with the raw scan).
- **N2**: N with a different margin and gap: same context, shifted pixels (layout floor).
- **S**: a seeded permutation of every unit across the page, each line keeping its unit count, re-drawn up to 50
  times to minimise the original neighbour pairs kept (reported per page).
- **W**: N with max(3, 5 %) single units replaced by another unit of the same leaf of similar width (+-30 %), more
  than 3 positions away.
- **B**: N with ~10 % of units Gaussian-blurred (sigma 0.22 x unit scale).

**Segmentation yield** (pages ok / drawn, units per page) is reported per group, and a seeded 5 pages per group of
`seg.jpg` and `S.png` are opened by eye and described in the record.

## Engines and calls

- **Yigdzin-v1** as served: `scripts/gpu/yigdzin-vllm/yig_leaf_worker.py` (vLLM 0.29, BDRC/tibetan-ocr @50506eb6,
  production PROMPT, DRY and retry, image downscaled to 2400 px wide), one image = one leaf (`path` rows, `--mode
  whole`). Tibetan groups only.
- **PaddleOCR-VL-1.6** as the print lane serves it: `paddlex_genai_server` (vLLM) + `PaddleOCRVL(use_layout_detection
  =False)`, max side 0 (`scripts/gpu/paddle-print-gpu.sh`), via `read_paddle.py`. Chinese groups only.
- Both read N twice (same-image floor), N2, S, W, B. One gex45 queue task (`gpu-task.sh`), files only.
- **Positive controls**: gemini-3.8-flash-low on `agy -p` with the image (`gatedImageCall`), N, S and W on 20 pages
  per decision group (TK, TO, ZB, ZC; the first 20 ok pages in draw order) = 240 calls, + N again on 10 per group =
  40: 280 planned (cap 600). Pool floor as #8171 (`poolOk`); zh-retranslate-8169 keeps priority; if the pool floor
  stops the run, what ran is reported and the controls are marked partial. **Opus** (`claude -p --model opus`, the
  image as a file it may Read): N and S on 8 pages per group = 64 calls (cap 300). Prompts: Tibetan "Extract all
  Tibetan text. Preserve line breaks." (Yigdzin's own); Chinese "Transcribe all Chinese characters in this image,
  column by column from right to left, one column per line. Output only the characters."

## Measures

Tokens: Han characters; for Tibetan, grapheme clusters (a base letter U+0F40–0F6C or U+0F88–0F8C with its following
marks U+0F71–0F87, U+0F8D–0FBC); tsheg, shad, spaces and other marks are ignored.

- **Primary: context flip, bag form.** F(X, Y) = 1 − |bag(X) ∩ bag(Y)| / max(|bag(X)|, |bag(Y)|) over a page's
  tokens. S holds exactly N's glyph images, so a reader that reads glyphs has F(N, S) at its floor. **Excess flip**
  E = F(N, S) − F(N, N2). Floors reported: F(N, N_again), F(N, N2). Why bag, not per glyph: Tibetan units are not
  syllables (above), so a read cannot be cut back onto units by count; the bag needs no labels and holds for any
  unit size. The brief's caveat stands: the positions are known by construction, what each glyph says is not.
- **Secondary, per glyph (Chinese)**: where a read's Han count equals the page's unit count (N and S both), tokens are
  assigned to units in reading order and the per-glyph flip rate is reported, with the share of pages alignable.
  Not alignable is an outcome, reported, never dropped.
- **W.** Per page, changed tokens per swap: C = (|bag(N) − bag(W)| − |bag(N) − bag(N2)|) / k. A reader of glyphs
  changes ~ one unit's tokens per swap; a reader of the expected text changes fewer (it reverts). W-reversion rate =
  1 − min(1, max(0, C) / c0), c0 = the group's median tokens per unit in N. For Chinese pages alignable per glyph,
  the sharp form: the read at a swapped position equals the ORIGINAL character (reversion), the donor (faithful) or
  neither.
- **Direction** (exploratory, Chinese per-glyph only): when a glyph's S-read differs from its N-read, is the S-read
  a character of the page's own N-read (drawn towards the page's vocabulary) or not.
- **Accuracy, bag form** (secondary): precision of N- and S-read tokens against the bag of the page's served text
  (an image-grounded production reading; CBETA/Kanripo for some ZB pages, Yigdzin's own served read for TO). Called
  agreement with served, not accuracy, except where the served text is the reference corpus.

Statistics: one page per book, so the book is the cluster; group means over pages; 95 % percentile bootstrap,
10,000 resamples of pages within group, for each group mean and the inside − outside difference.

**Smallest detectable gap.** Two groups of 40 clusters, two-sided alpha 0.05, power 0.8: MDE = 2.8 x sigma x
sqrt(2/40) = 0.63 sigma, sigma the between-page sd of E. Assumed sigma 6 points → MDE 3.8; 8 → 5.0. The observed
sigma and MDE are reported. If the observed MDE is above 5 points, a null is reported as "could not see a gap smaller
than X", and n is not raised in this run (both frames are used up to the drawn 40: TO had 43 eligible).

## Instrument checks (before any conclusion)

1. **Blur responds**: per engine, F(N, B) − F(N, N2) > 0, page-paired bootstrap CI excluding 0. If not, the flip
   measure does not respond to what it should: no conclusion for that engine.
2. **Controls fire**: Flash or Opus E > 0 with CI excluding 0 (pooled over their pages). If neither fires, the
   instrument cannot fire: no conclusion about the small engines.
3. **Floor**: F(N, N_again) reported per engine; if Yigdzin or Paddle is not deterministic, its floor is the
   larger of the two floors.

## Decision rule (verbatim from the brief, unchanged)

- Instrument does not fire: no conclusion.
- Inside-corpus flip or W-reversion rate exceeds outside-corpus by at least 5 points with the interval excluding 0,
  or Step 1 confirms overlap between training data and a scored frame: that accuracy may be quoted only for the
  measured texts. Post a DECISION line on #8182 proposing the wording and a separate independent, image-grounded
  check of non-Kangyur Tibetan, priced.
- Engine shows context dependence equal inside and outside: it uses context generally. Report the size; no
  corpus-specific claim.
- No effect, instrument fires: keep the scores, state the gap this could have detected.

Applied per engine: inside = TK for Yigdzin, ZB for Paddle; outside = TO, ZC. "Flip rate" = E (primary). Note on
the second clause: Step 1 already documents that Yigdzin's training text source (BoCorpus) contains the Derge
Kangyur, the scored frame. Under the rule as written that clause alone triggers "quote only for the measured texts"
for Yigdzin; the experiment still runs and says whether the overlap shows in behaviour.

## Not done, by design

No write to pages or books, no UI, no field. CBETA, Kanripo and Derge/BoCorpus text is never committed: ids,
offsets, counts and scores only (BoCorpus is CC0, but its Derge e-text's own licence is not stated, so it is
treated like CBETA). Reads and images stay on gex45 and in `$JOB_SCRATCH`.
