---
stage: ocr
measure: [accuracy, judged]
languages: [lzh, bo]
scripts: [Hani, Tibt]
canons: [tibetan]
n_books: 130
n_pages: 130
verdict: "gemini-3.1-flash-lite is not a correction route in either language tested. On Paddle's Chinese drafts it makes pages worse with both prompts. On 40 table pages, median CER goes from 6.4% to 50% with the set's prompt (32 worse, 2 better) and to 15% with the production-shaped prompt (28 worse). It rewrites pages as markdown tables, which drops, duplicates and reorders columns. On Yigdzin's Tibetan drafts it gains as much identity to Derge as Pro or Flash low (+0.020 [0.012, 0.027]). But it gains the same with no image at all (+0.019), and with each prompt one folio in 30 gets whole lines invented or duplicated (by eye). The no-image result and that invented text show its gain is recall of the canonical text, not reading."
status: rejected
decision: "No lite corrector cell for Paddle Chinese or Yigdzin Tibetan; routing unchanged (#7263)"
superseded_by: null
issue: [7263, 6561, 6560]
---
## 2026-10-24 · Can gemini-3.1-flash-lite, given a GPU engine's draft and the page image, correct the draft? (#7263)

PRIOR ART: `2026-10-12-paddle-zh-correct-vs-redo-6561.md`, `2026-10-13-sonnet-haiku-correct-vs-opus-6667.md`
(Chinese: Paddle draft, Kanripo CER) and `2026-10-12-tibetan-yigdzin-correct-vs-redo-6560.md`,
`2026-10-13-tibetan-flash38-correct-6560.md` (Tibetan: Yigdzin draft, Derge identity, planted errors). Their pages,
drafts, references, plants and scorers are reused unchanged; only the lite arms are new. Preregistration:
`scripts/eval/lite-correct-gpu-7263/PREREG.md` (13c2f20f3, before any call; amendment 1, a3b681d34, before any P2 call).

**Why.** lite on the paid Batch API is the cheapest corrector there is (about $1–2 per 1,000 pages, no subscription
cap). Derek, 2026-10-24: "it might work on some languages and not others, but let's see; this could be a big leap in
quality for cost."

**Design.**
- **Sets.** Chinese: the #6561 sets, rebuilt with `paddle-correct-6561/rebuild.mjs`. The rebuild reproduces all 494
  committed page CERs exactly. They are 40 withheld table pages (set A), 30 random ordinary pages (B random), 30 pages
  where Paddle and the stored second read disagree (B disagree), and 10 drafts carrying 30 planted errors. Tibetan:
  the 30 Kangyur folios plus 10 drafts carrying 30 planted errors (`prep.py --reuse-plants`). The rescore reproduces
  every committed summary row.
- **Arms, all `gemini-3.1-flash-lite` with production lite OCR settings.** Settings: temperature 0.1, thinking
  budget 0, 16,384 max output tokens, BLOCK_NONE, through `gemini-script-client.mjs`. Realtime API, one read per page.
  - **P1 lite-correct:** image + draft, with the set's own correction prompt. For Chinese that is the #6561 Gemini
    arms' prompt byte for byte (hash-checked); for Tibetan it is `prep.py` CORR.
  - **lite-noimg:** the same prompt and draft with no image attached. This is a control: does lite use the image?
  - **P2 (amendment 1):** the production shape. It is the live OCR prompt (v19.1) + `correctInstruction` from
    `ocr-convergence/correct.mjs`, adapted to one inline page, + the Siku v2 rule (keep the page's forms, no notes).
    `UNCHANGED` is scored as the draft and `CONTAIN` as not read.
  - **r2:** a repeat of P1 on 10 pages per language, for the noise floor.
- **Bars (preregistered, per language, never pooled).** A route candidate must pass all three. **(a)** It beats the
  draft, with a paired 95% interval that excludes 0. **(b)** Pages made worse are no more than Opus-correct's on that
  set: Chinese A ≤ 1/40, B random ≤ 2/30; Tibetan ≤ 0/30. **(c)** No damage: planted errors kept no more than Opus's,
  and no wrecked pages. A wreck is a loop, a duplication, a scrambled table, or invented lines. **P2 must pass**,
  because P2 is what production would write.

### Chinese: Paddle drafts (#6561 sets)

**Set A: 40 withheld table pages** (committed scorer; CER vs the Kanripo leaf, Han only)

| arm | scored | median CER | mean CER | Δ mean vs Paddle [95%] | better / worse (> 0.5 pt) | over-count (pages ≥ 3) | wrecked: CER ≥ 50% / Han > 125% of draft / markdown table | $ / 1K pages, Batch |
|---|---|---|---|---|---|---|---|---|
| Paddle (draft) | 40 | 6.4% | 9.8% | — | — | 177 (13) | — | — |
| Opus correct (#6561) | 40 | 4.0% | 5.1% | −4.7 pt [−6.8, −3.0] | 31 / 1 | 51 (7) | 0 / 0 / 0 | subscription |
| 3.8 Flash high correct (#6561) | 40 | 5.5% | 6.7% | −3.1 pt [−5.5, −1.2] | 24 / 2 | 100 (10) | 0 / 0 / 0 | subscription |
| Haiku correct (#6667) | 40 | 14.3% | 35.1% | +25.3 pt [+14.8, +36.7] | 1 / 26 | 1,460 (19) | 11 / 10 / 9 | subscription |
| **lite P1** | 38 (2 not read) | **49.9%** | 55.0% | **+46.1 pt [+32.2, +59.5]** | 2 / 32 | 19,956 (20) | 19 / 19 / 22 | 1.23 |
| **lite P2 (production shape)** | 40 | **14.8%** | 41.9% | **+32.1 pt [+19.9, +44.7]** | 1 / 28 | 6,029 (21) | 15 / 15 / 17 | 0.97 |
| lite no image (P1 prompt) | 40 | 17.9% | 24.6% | +14.8 pt [+9.1, +21.6] | 2 / 30 | 421 (17) | 4 / 3 / 5 | 0.81 |

**Set B random: 30 ordinary pages**

| arm | median CER | mean CER | Δ mean vs Paddle [95%] | better / worse | wrecked (≥ 50% / long / table) |
|---|---|---|---|---|---|
| Paddle (draft) | 3.1% | 6.7% | — | — | — |
| Opus correct (#6561) | 3.0% | 5.7% | −1.0 pt [−2.0, −0.3] | 12 / 2 | 0 / 0 / 0 |
| 3.8 Flash high correct (#6561) | 2.8% | 5.8% | −0.9 pt [−1.8, −0.3] | 10 / 0 | 0 / 0 / 0 |
| **lite P1** | 6.2% | 25.7% | +19.0 pt [+7.8, +31.1] | 5 / 14 | 7 / 4 / 8 |
| **lite P2** | 3.7% | 18.6% | +11.8 pt [+2.2, +23.7] | 5 / 9 | 4 / 4 / 5 |
| lite no image | 3.2% | 10.2% | +3.5 pt [+0.5, +6.9] | 4 / 8 | 0 / 2 / 3 |

**Set B disagree (29 scored):** Paddle 2.9% median. lite P1 9.2% (+30.9 pt [+17.0, +46.1], 1 better / 18 worse).
lite P2 7.2% (+25.1 pt [+12.1, +39.5], 2 / 14). Opus correct 2.7% (−0.4 pt, 7 / 3).

- **Scorer side check, markdown pipes removed** (`zh-pipes-side.mjs`). The live OCR prompt asks for markdown tables,
  and the committed scorer reads a `|` as the ditto mark 丨. With table syntax deleted, lite still loses everywhere.
  Set A: P1 15.9% median, +38.0 pt [+24.8, +51.1], 33 worse; P2 11.7%, +21.8 pt [+11.5, +32.7], 24 worse. B random,
  P2: +7.4 pt [−0.0, +17.0], 7 worse vs 5 better. The pipes are not the problem; the reordering is.
- **Not read (P1):** 2 table pages ran to MAX_TOKENS (one with no body, one cut), and 1 stopped on RECITATION. P2
  read every page and answered `UNCHANGED` on none.
- **Anchoring (30 plants):** P1 kept 4 and fixed 23 (3 unresolved). P2 kept 5 and fixed 25. No image: kept 10, fixed
  18. Opus kept 1 and Flash high kept 0.
- **Noise floor (r2, 10 pages):** 9 of 10 pages came back with the same CER. On one table page (A-pil004) the first
  read was a good correction (4.2% → 3.6%) and the repeat was a markdown-table wreck (CER 100%). So the wreck is a
  per-call event at temperature 0.1, not a property of the page.
- **By eye (sealed Opus, image + draft + lite P1), the 3 worst pages:** all **WORSE**.
  - **B025** (ordinary prose, 16 columns): one character per cell in a 4-column table. 13 of 16 columns dropped, the
    first column written twice, columns 2 and 3 swapped.
  - **A-pil020** (double small-character lines): the paired lines interleaved character by character. A whole column
    left empty, text duplicated, a second 莊子 invented.
  - **A-pil059** (a music-note table): 應鐘全 invented where the page prints 應 with a small 全, 終宫 duplicated,
    headings moved out of reading order.

  In each case the draft was complete and in order.
- **Why the image makes it worse:** the no-image control does less damage than P1 (+14.8 vs +46.1 pt on tables).
  With the image, lite re-lays the page as the table it sees, and that layout pass is where text is lost and
  reordered.

**Verdict, Chinese: not a route candidate.** It fails (a) on every set with both prompts (the interval sits above 0),
fails (b) (28–32 worse pages on tables against Opus's 1), and fails (c) (15–19 wrecked table pages).

### Tibetan: Yigdzin drafts (#6560 set)

| arm | read | identity vs Derge [95%] | Δ vs draft [95%] | folios better / worse | recall | planted errors left | wrecked folios | s / folio | $ / 1K pages, Batch |
|---|---|---|---|---|---|---|---|---|---|
| Yigdzin (draft) | 30 | 0.945 [0.939, 0.951] | — | — | 0.930 | — | — | — | — |
| Opus correct (#6560) | 30 | 0.960 [0.952, 0.967] | +0.015 [+0.008, +0.022] | 23 / 0 | 0.926 | 14 / 30 | 0 | 32 | subscription |
| 3.8 Flash low correct (#6560) | 30 | 0.968 [0.962, 0.974] | +0.023 [+0.016, +0.030] | 30 / 0 | 0.923 | 3 / 30 | 0 | 23 | subscription |
| 3.1 Pro correct (#6560) | 30 | 0.965 [0.957, 0.972] | +0.020 [+0.011, +0.029] | 25 / 5 | 0.936 | 3 / 30 | 0 | 135 | subscription |
| **lite P1** | 30 | 0.965 [0.958, 0.971] | **+0.020 [+0.012, +0.027]** | 26 / **2** | 0.937 | 4 / 30 | **1** (seq 28) | 5 | 1.48 |
| **lite P2 (production shape)** | 29 (1 not read) | 0.965 [0.959, 0.970] | **+0.020 [+0.014, +0.026]** | 26 / 0 | 0.930 | 7 / 27 | **1** (seq 17) | 5 | 1.93 |
| lite no image (P1 prompt) | 30 | 0.964 [0.959, 0.969] | +0.019 [+0.014, +0.025] | 27 / 0 | 0.937 | 5 / 30 | 0 | 3 | 1.33 |

- **lite does not use the image.** lite P1 minus lite no-image: +0.0007 [−0.0048, +0.0050], 9 folios better and 8
  worse. Without the image it also fixes 25 of 30 planted errors: they are look-alike letters and vowel swaps that
  the language alone gives away. Its toward-Derge edits split the same way with or without the image (P1: 347 spans,
  81 of them a restored tsheg; no image: 332, 76). That is the same volume as 3.8 Flash low (344), but no image
  read-off was run on lite's spans.
- **Invented and duplicated lines, by eye** (sealed Opus with the image):
  - **seq 28, P1:** the folio has 14 lines on two leaves. lite kept all 14, then added a `<leaf-break/>` and 7 more
    lines that repeat the lower leaf with invented wording (སློབ་དཔོན for བློན་པོ, and more): 494 → 742 syllables.
  - **seq 17, P2:** both leaves run into one paragraph, about two lines of leaf 2 dropped, and several lines of sūtra
    text that are not on the page invented in their place and after the last line. Because the invented text is the
    canonical wording, the Derge identity of this folio *rose* from 0.953 to 0.982. The scorer rewards the recitation.
  - **seq 15, P1** (the other worse folio): two edits, both wrong. It misread the first syllable (མེར for དམར) and
    put a leaf break in the wrong place.
- **The P2 folio not read (seq 16)** answered `UNCHANGED` followed by metadata tags. `correct.mjs` `parseAnswer` only
  accepts `UNCHANGED` alone. A reply like this passes `ocrReadProblem` (it has a `<page-type>`) and would come back as
  a "corrected" page with no body text. Here it is scored as not read.
- **Noise floor (r2, 10 folios):** r2 minus r1 is +0.0009 [−0.0005, +0.0033], 1 folio better and 1 worse.

**Verdict, Tibetan: not a route candidate.** On the averages lite sits level with Pro and Flash low. It still
fails (c) with both prompts: one folio in 30 gets whole lines invented or duplicated, which is Haiku's failure. P1
also fails (b) (2 worse against Opus's 0). P2 passes (b) on 29 folios, but its wrecked folio scores as *better*,
because the identity measure cannot see recited text. The no-image control matches the image arm. So the gain is
lite recalling Kangyur wording, not reading the leaf. Where the manuscript differs from Derge, recalled wording is
exactly the wrong correction.

### Format compliance (amendment 1, `p2-post.mjs`)

| | pages | exactly one `<page-type>` | chatter / duplicate (`ocrReadProblem`) | extra headers | added `<note>` | added `<vocab>` / `<warning>` | compliant, strict | compliant, ignoring hidden `<vocab>`/`<warning>` |
|---|---|---|---|---|---|---|---|---|
| Chinese P2 | 110 | 110 | 0 | 14 | 13 | 110 / 4 | 0 | 84 |
| Chinese P1 | 110 | 110 | 3 duplicated replies | 16 | 5 | 107 / 0 | 0 | 85 |
| Tibetan P2 | 30 (+10 plants) | 40 | 0 | 0 | 1 | 40 / 38 | 0 | 39 / 40 |
| Tibetan P1 | 30 | n/a (the prompt asks for no tags) | 0 | 0 | 0 | 0 / 0 | 30 | 30 |

Under the owner's rule (no `<vocab>` or `<warning>` the draft does not carry), no lite reply complies. The live OCR
prompt itself asks for `<vocab>` and invites `<warning>`, so the last column leaves those two hidden tags out. Even
then, 1 Chinese page in 4 adds headers or notes.

### Spend
- **lite:** 470 calls (320 for P1, no-image and r2; 150 for P2). 2.11M input and 0.38M output tokens.
  **$1.09 at the realtime price actually paid**, against an estimate of $0.9 + $0.4. That is $0.55 at the Batch
  price. Metered in `gemini_usage` under endpoint `scripts/eval/lite-correct-gpu-7263/run-lite.mjs`.
- **Opus:** 6 by-eye calls on the subscription (`claude -p`), $0 cash.
- Nothing was written to `pages`, `books` or any other collection.

### Router
No cell is proposed. Neither language passes. Corrections of Paddle Chinese stay with Opus (#6561), and Yigdzin
Tibetan stays with Flash low or Opus, which the image read-off checked (#6560).

### Artifacts
- Code: `scripts/eval/lite-correct-gpu-7263/`: `run-lite.mjs`, `mkreq-p2.mjs`, `p2-post.mjs`, `draw-r2.mjs`,
  `zh-pipes-side.mjs` and `byeye-req.mjs`.
- Scorers: the lite arms, a paired-vs-draft interval and wreck counts were added to `paddle-correct-6561/score.mjs`
  and `tibetan-correct-6560/score.py`. Committed outputs reproduce unchanged.
- Outputs: `paddle-correct-6561/results/out-lite-*.jsonl.gz` and `score-7263.json.gz`;
  `results/tibetan-correct-6560/out/lite-*.jsonl.gz` and `scores-7263.json.gz`;
  `lite-correct-gpu-7263/results/` (format compliance, the pipes side check, the by-eye replies, the P2 prompt hashes
  and the r2 draw).
- **Third language:** none run. No Syriac Kraken correction set exists. The stale-Siku set
  (`stale-correct-6561`) is Paddle Chinese print against Kanripo, which set B random already covers. lite fails
  there too, so it was not built into a third set.

*Confidence:* high for Chinese (100 pages, both prompts, failure confirmed by eye and robust to the pipe scoring).
Moderate-to-high for Tibetan: the wreck rate is 2 in 60 folio-reads (P1 + P2), and the no-image control is the
decisive evidence. Replicated? r2 only (10 pages per language).
