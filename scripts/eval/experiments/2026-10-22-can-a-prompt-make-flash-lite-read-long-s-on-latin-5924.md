---
stage: ocr
measure: agreement
languages: [la]
scripts: [Latn]
canons: []
n_books: 99
n_pages: 99
verdict: "No prompt arm passes the preregistered bar. The live prompt already writes long s as f far less often than the generic prompt PR #6912 measured (413 vs 2,566 in the 1600s). LONG_S_LINE cuts the median CER by only 0.08 points, with a CI ending at 0. Thinking makes it worse. Prompt + the sibling CPU pass clears the bar in both centuries (secondary); the pass alone clears it in the 1600s."
status: undecided
decision: "Recommended: the CPU pass (longs-pass-5924) first, since it fixes stored text with no re-OCR. Leave the default prompt unchanged. Revisit LONG_S_LINE in the default prompt for pre-1800 Latin only together with the pass, as a separate PR and decision."
superseded_by: null
issue: [5924]
---
PRIOR ART: `PREREGISTRATION-longs-prompt-5924.md` (this run's preregistration, commit d5ee80c38, pushed before any call).
`2026-10-18-latin-gex45-bakeoff-5924.md` (same 99 pages, references, fed images and scorer; its lite arm used the
generic prompt). `2026-10-01-does-a-long-s-prompt-line-fix-early-english-ocr-5488.md` (LONG_S_LINE on early English;
adopted for the RECITATION retry only).

## 2026-10-22 · Can a prompt make flash-lite read long s on Latin print? (#5924)

**No, not by the preregistered bar. And the starting point was wrong.** Production's live prompt (v19.1) already
writes ſ as f about one time in ten. The generic prompt used in PR #6912 did it about two times in three. What is left
is small. The long-s line removes some of it but does not move the median beyond its CI. A CPU pass removes nearly all
of it.

**Design.**
- **Pages and images.** The same 99 Latin leaves (59 from the 1600s, 40 from the 1500s), with the same Opus references
  and the same fed images. All 99 sha256 match `inputs.json`.
- **Model.** gemini-3.1-flash-lite, temperature 0, thinking 0, through the metered client.
- **Arms.**
  - L0: production's live OCR prompt, read from Mongo (v19.1).
  - L0b: L0 repeated.
  - L1: L0 + `LONG_S_LINE`.
  - L2: L1 + an explicit rule (crossbar, never word-final, ſſ/ſt/ſp ligatures, Latin examples).
  - L3: L2 + two example crops (roman and italic) with their transcriptions. The crops come from a non-reference book:
    BNC Florence, *Inquisitio in Oracula Sibyllarum*, p. 5 (`longs-examples/`).
  - L4: L2 with a thinking budget of 1,024.
- **Scoring.** `score.mjs` unchanged, with L0 as the baseline. Tags were stripped first with `stripTags` (header, page
  number and margin text kept as page text).
- **Bar, per century.** The paired CI of Δ median N lies below 0; Δ is beyond the noise floor; catastrophic pages ≤ L0's + 1.
- **Noise floor.** L0b came back byte-identical to L0 on all 99 pages (temperature 0 is deterministic here), so the
  floor is 0.

### Results, view N (preregistered). Median page CER %; Δ = arm − L0 in points (95% CI), W/L
| arm | 1600s (n = 59) | Δ vs L0, W/L | cat. | 1500s (n = 40) | Δ vs L0, W/L | cat. | bar |
|---|---|---|---|---|---|---|---|
| **L0** live prompt v19.1 | 1.26 | — | 0 | 2.83 | — | 2 | — |
| L1 + LONG_S_LINE | 1.14 | −0.08 (−0.21, 0.00), 32/21 | 0 | 3.01 | −0.11 (−1.29, 0.00), 21/12 | 1 | no / no (CI touches 0) |
| L2 + rule | 1.13 | −0.08 (−0.24, +0.05), 33/23 | 1 | **2.26** | −0.07 (−0.50, +0.05), 21/14 | 2 | no / no |
| L3 + example crops | 1.22 | −0.07 (−0.20, +0.12), 31/24 | 1 | 3.11 | 0.00 (−0.72, +0.17), 18/17 | 2 | no / no |
| L4 = L2 + thinking 1,024 | 1.87 | **+0.34 (+0.07, +0.78)**, 19/37 | 2 | 2.71 | 0.00 (−0.44, +0.14), 19/17 | 1 | no (worse) / no |
| *Lg: the generic prompt (stored L of PR #6912), not a pair* | 4.21 | +1.96 | 0 | 5.60 | +2.43 | 0 | — |

Pooled over 99 pages: L0 1.78, L1 1.53, **L2 1.51** (best arm by the prereg rule; no arm passes), L3 1.58, L4 2.50.

**Long s.** Reference ſ read as f / s / ſ, and f read as ſ (the overcorrection). The references hold 3,983 ſ (1600s) and
3,229 ſ (1500s).

| arm | 1600s ſ→f / ſ→s / ſ · f→ſ | 1500s ſ→f / ſ→s / ſ · f→ſ |
|---|---|---|
| Lg generic prompt | 2,566 / 1,060 / 287 · 1 | 2,285 / 729 / 125 · 0 |
| **L0 live** | **413** / 3,473 / 0 · 0 | **393** / 2,489 / 214 · 0 |
| L1 | 266 / 917 / 2,754 · 6 | 516 / 722 / 1,921 · 3 |
| L2 | 188 / 518 / 3,202 · 6 | 421 / 557 / 2,170 · 3 |
| L3 | **116** / 190 / 3,344 · 8 | **139** / 461 / 2,563 · 3 |
| L4 | 212 / 404 / 3,256 · 4 | 346 / 724 / 1,849 · 2 |

- **The line flips a page into one mode.** Under L1 and L2, lite on a page either writes ſ almost throughout, or writes
  f almost throughout. On 1500s p207 (mixed roman and italic) it wrote 255 of 263 ſ as f under L1 and 243 under L2,
  against 11 under L0. That is why the 1500s ſ→f count rises. The example crops (L3) fix that page (12) and p108
  (271 → 27), and give the lowest ſ→f counts. They still do not move the median, and 2 of the 99 L3 reads hit the
  token cap.
- **No refusals in any arm.** Every read ended STOP, except the cap hits: L3 2, L4 4.
- **View D (diplomatic, secondary).** The ſ arms gain about 4 points, because the references keep ſ: 1600s L0 6.8 → L1 2.4,
  CI −4.4 to −3.7. This matters only if the house convention (ſ stored as s, `foldLongS`) ever changes.
- **Thinking hurts.** L4's 1600s median is 0.34 points worse, with a CI above 0. It also costs 2.4 times as much.

### Prompt + the CPU pass (secondary, preregistered as conditional)
The sibling job's pass was on disk when scoring:
- `longs-pass-5924`, `scripts/eval/latin-longs-pass-5924/longs-pass.mjs` (sha256 `971194d8…`), uncommitted at the time.
- Its `model.json.gz` (sha256 `63833e87…`).

The pass applied to the stripped reads changes only f → ſ, at 5.5 CPU-ms per page.

| arm | 1600s Δ vs L0 (CI), W/L | ſ→f · f→ſ | 1500s Δ vs L0 (CI), W/L | ſ→f · f→ſ | bar |
|---|---|---|---|---|---|
| L0 + pass | −0.08 (−0.15, −0.04), 37/4 | 38 · 19 | 0.00 (−0.08, 0.00), 19/3 | 16 · 11 | **pass** / no |
| L1 + pass | −0.14 (−0.31, −0.04), 37/15 | 25 · 25 | −0.33 (−1.32, −0.03), 26/12 | 12 · 13 | **pass / pass** |
| L2 + pass | −0.20 (−0.28, −0.10), 40/14 | 25 · 25 | −0.19 (−0.67, 0.00), 25/12 | 11 · 14 | **pass** / no |

The pass alone takes ſ→f from 806 to 54 over both centuries, with almost no losses (W/L 56/7). It is the cheaper half:
it needs no re-OCR and so triggers no retranslation. The prompt adds a further 0.06–0.12 points in the 1600s.

### By eye
One Opus subagent read the image of each page, blind: the 3 largest gains and 3 largest losses of L2 against L0, with
the two reads labelled X/Y at random (`longs-prompt-byeye.json`).
- **L2 better on 3 pages.**
  - 1500s p8: L0 turned the cut-off facing column into a 17-line loop.
  - 1500s p368: L0 made more dosage misreads.
  - 1600s p406: L0 wrote "sefe" for ſeſe three times; L2 had no ſ→f on that page. This was a metric "loss".
- **L0 slightly better on 1.** On 1600s p164 (a metric "gain"), both wrote "ficcô", and L2 misread three side-notes.
- **2 ties.**
  - 1600s p353: each read drops a different block of lines, and L2 reads the ſſ ligature as "ff" ("concepiffe" ×4).
  - 1600s p30: L2 scores CER 1.0 because it repeated the page one word per line as fake `<margin>`/`<unclear>`. L0
    instead invented about 28 side-notes from the facing page's bleed-through. Both main blocks are good.
- The reader's cross-cutting note: **invented text from a neighbouring page at the edge of the image** (p8, p30) is a
  bigger problem on these pages than long s.

### What this does not show
- **Agreement, not accuracy.** The references are Opus ×3 with no human check.
- **The noise floor is 0 by construction.** Temperature 0 gave identical reads. Run-to-run variance at production
  settings is not measured here. The bake-off's temperature-1 floor was 0.22 / 0.27 points, about three times the Δ
  of L1/L2.
- **The pass was mid-development.** It was the sibling job's uncommitted code and model; its own preregistered
  verdict lands separately.
- **Post hoc, not preregistered (`--fold-f`):** with f → s folded, the generic prompt still beats the live prompt:
  - 1600s: 0.66 vs 0.97, CI below 0;
  - 1500s: 1.39 vs 2.79.

  So the live prompt loses ground somewhere other than long s. The by-eye notes point to abbreviation and sign
  expansion, and to invented facing-page margins. Tag-stripping residue may also count. Not chased here. It also means
  the bake-off's lite-vs-engine gaps were measured against a prompt production does not use.
- **Little gothic** (4 of 40 1500s pages), as in the bake-off.

### What changing the live prompt would mean
- **The prompt is a Mongo record** (`prompts`, type `ocr`, v19.1), shared by every language and period.
- **A Latin pre-1800 variant would need two more pieces:**
  - a routing condition (language plus date) the pipeline does not have today;
  - the collector's `foldLongS` on the way in, since the house convention stores ſ as s.
- **Re-OCR would retranslate every page it touches.**
- **The gain is not worth that cost.** It is 0.08–0.11 points of median CER, and it comes with a per-page mode-collapse
  risk (p207). The pass gets most of the same ſ fix on stored text, with no re-OCR.
- **Revisit only as prompt + pass, as its own PR and decision.**

*Replicated?* No.

*Spend:* gemini-3.1-flash-lite, 6 × 99 reads = **$1.85**, logged through `gemini-script-client.mjs`. By arm: L0 $0.23,
L0b $0.23, L1 $0.24, L2 $0.25, L3 $0.35, L4 $0.56. The estimate was $1.25–1.5 for five or six arms; the gap is
L4's thinking tokens. The by-eye read used the Opus subscription.

*Artifacts:* `scripts/eval/latin-bakeoff-5924/`:
- the harness: `longs-prompt-arm.mjs`, `prep-longs-prompt.mjs`;
- `longs-examples/` (the two crops);
- `reads-longs-prompt/*.jsonl.gz` (raw tagged reads, with each arm's run record: prompt sha256, live prompt version);
- `longs-prompt-results*.json.gz`: the per-page scores, plus fold-f and the pass views;
- `longs-prompt-byeye.json`.

No writes to `pages`, `books` or `prompts`.
