---
stage: ocr
measure: accuracy
languages: [fa]
scripts: [Arab]
canons: [persian-poetry]
n_books: 20
n_pages: 20
verdict: "On Persian manuscript poetry flash beats served lite (seq 0.70 vs 0.41, loops 1 vs 4); no Kraken model is competitive; still far below the 0.90 gate."
status: adopted
decision: "Persian OCR moved to flash on 2026-10-04 (PR #5760, hidden backlog #5795); the prose-shelf pilot was not run"
superseded_by: null
issue: 5525
---
## 2026-10-01 · Does Gemini flash, or an open-source Kraken model, read Persian manuscripts well enough to OCR the six prose books? (#5525 Stage 1b)

**Question.** Stage 1 (`2026-10-01-persian-ocr-vs-ganjoor-5525.md`) found that served OCR, mostly `gemini-3.1-flash-lite`, reads Persian manuscript poetry at sequence accuracy 0.414 and line accuracy 0.738 against Ganjoor, with 4 of 20 pages degenerate. So the six prose manuscripts (4,698 pages) were not run. Derek asked for both alternatives to be tested: Gemini flash, and Kraken with published Arabic-script models.

**Design.** The same 20 manuscript pages as Stage 1 (16 whose work is in Ganjoor, plus 4 that are not), scored with the same `persian_align.py`, the same Ganjoor dump and the same controls, so every row is comparable with Stage 1. The controls separate on every arm. `measure: accuracy` (against an external reference). The arms are:
- **served**: the Stage 1 text, re-scored. It reproduces 0.414 / 0.738 / 4 loops exactly.
- **flash**: `gemini-3-flash-preview` with the production prompt (DB `Standard OCR v16`) and the `bulk-reocr-local.mjs` generation config (temperature 0.1, thinking 0, 16K cap). Run **realtime** via `ocr_flash.mjs`, because the only Batch OCR path that takes a page list feeds batch-collector, which writes `pages`.
- **flash+couplet**: the same, with one appended instruction: "read column by column per couplet: right hemistich then left hemistich".
- **Kraken 7.1**, CPU (`kraken_ocr.sh`). Kraken's default blla segmentation was run once per page (`-d horizontal-rl`). Every model then read the same stored lines (`--base-dir R`). The models:
  - PP-OCRv6 medium: 10.5281/zenodo.21788410, Apache-2.0. Its training data includes the Persian manuscript sets `hafiz_divan` and `sadi_gulistan`.
  - OpenITI Printed Persian: 10.5281/zenodo.7051644, CC0.
  - OpenITI Printed Arabic-script: 10.5281/zenodo.7050270, CC0.
  - OpenITI AOCP manuscript models `ms_mellon_print_trans` and `ms_pretrained_trans`: github.com/OpenITI/arabic_script_ocr_models @cc3f067. No DOI, and no licence is stated.

  `kraken list` and the Zenodo `ocr_models` community have **no nastaʿlīq or Persian-manuscript recognition model**. The HTR-United/Agapet Christian-Arabic record holds notes only, no weights. The Party page-level model (10.5281/zenodo.20642057, 518 MB) was not tried.

**Degenerate** (`stage1b_table.mjs`): any of three conditions makes a page degenerate:
- `loopVerdict` (the production loop guard) refuses it;
- one word is ≥ 14% of its words;
- the output stopped at MAX_TOKENS.

**Result (folded, 20 pages; line_global over the 16 in Ganjoor, with unlocatable pages kept).**

| arm | seq median (IQR), n located | line_local | line_global (IQR) | wrong-poet floor | degenerate /20 |
|---|---|---|---|---|---|
| served (Stage 1) | 0.414 (0.369–0.625), 9 | 0.738 | 0.644 (0.461–0.757) | 0.435 | 4 |
| **flash, production prompt** | **0.697 (0.625–0.737), 13** | 0.737 | **0.735 (0.639–0.815)** | 0.439 | **1** |
| flash + couplet instruction | 0.674 (0.542–0.712), 12 | 0.736 | 0.729 (0.544–0.792) | 0.433 | 2 |
| Kraken PP-OCRv6 medium | 0.446 (0.431–0.464), 8 | 0.690 | 0.633 (0.537–0.691) | 0.420 | 0 |
| Kraken OpenITI Printed Persian | 1 weak* | — | 0.448 | 0.401 | 0 |
| Kraken OpenITI Arabic-script | 0 | — | 0.452 | 0.402 | 0 |
| Kraken OpenITI MS (mellon) | 1 weak* | — | 0.498 | 0.418 | 0 |
| Kraken OpenITI MS (pretrained) | 1 weak* | — | 0.507 | 0.417 | 0 |

\* The one "located" page covers < 20% of the OCR: a fragment match, not a reading.

- **Paired against served**, flash wins sequence on 7 of 8 pages located by both (median +0.27) and line_global on 14 of 16 (median +0.09). The couplet instruction is no better than the production prompt: 7/8 and 15/16, but a lower median and one more loop. Kraken PP-OCRv6 wins line_global on only 7 of 16 (median −0.02).
- **Loops are stochastic.** Flash looped on a page that flash-lite had read at 0.857 (`69c1b8d6…_27`, a 16K-token runaway), and did not loop on any of flash-lite's four loop pages (it read three of them at seq 0.70–0.79). Every arm's seq n except the couplet arm's includes one weak location (coverage < 0.2), as Stage 1's did; it is kept so the rows stay comparable. The production `loopVerdict` refuses this kind of runaway at write time.
- **The Ganjoor ceiling is far below the 0.90 gate.** Ganjoor's Ḥadīqa recension has two couplets the leaf lacks, and a different couplet order. A by-eye-correct transcription of the Ḥadīqa leaf (`69c1ba2e…_34`, read from image, `by-eye-hadiqa-69c1ba2e_34.txt`) scores **seq 0.766, line 0.933**; flash+couplet scores 0.744 / 0.913 on that page. On manuscripts, this metric measures recension distance as well as OCR error. The 0.90 seq bar cannot be met even by a perfect reading. This is one page (n = 1), so it is the scale of the problem, not a correction factor.
- **The OpenITI Kraken models do not read these hands.** They score at the wrong-poet floor: they are trained on print or naskh, and the hands here are mostly nastaʿlīq. PP-OCRv6 reads them and never loops, but at served-flash-lite quality. A Kraken lane would need fine-tuning on Persian manuscript lines. Ganjoor alignment could supply those lines, but its text licence is `unknown` (Stage 1).

**By-eye reads (flash, production prompt; read from image).**
1. **Ḥadīqa, Manchester 1283** (`69c1ba2e…_34`, clear early naskh). Couplets are now paired row by row; Stage 1's column-split defect is gone. Errors:
   - production prompt: ~8 of 36 hemistichs, e.g. "پیلی بزرگ" became "پیلی پیرزال" and "چند کور" became "چند کس";
   - couplet arm: ~4 of 36 hemistichs, mostly one garbled couplet: "وانکرا بد ز پیل ملموسش | دست و پای ستبر پر بوسش" became "و آنکه بد زیر ملمس پایش | دست و پای ستم بر پایش".

   The `<warning>` header misattributes the poem to Rumi's Masnavī; it is Sanāʾī. Near-usable as a draft.
2. **Masnavī, Manchester 1633–35** (`69c1b8db…_27`: 4 columns, with diagonal marginalia). This is better than Stage 1: "عقبه زین صعب‌تر در راه نیست" is now right; Stage 1 had "پنجه زین صعب رود راه". But:
   - one couplet is duplicated ("سایهٔ یزدان بود بندهٔ خدا…"), and one is dropped ("وا رهاند از خیال و سایه‌اش");
   - about half the hemistichs are garbled, e.g. "ور حسد گیرد ترا در ره گلو" became "در نرسیدی در ادره دره";
   - the marginalia are summarised in `<unclear>`, not transcribed.

   Not usable.
3. **Dīvān-i Shams, Manchester 1859** (`69c1b9d1…_33`; no Ganjoor reference). Rows are now read as couplets; Stage 1 served had merged them. About 9 of 24 hemistichs have errors, and about 5 change the sense:
   - "مالک دینار" became "مالک دین" (Stage 1's error persists);
   - "شبلی و معروف" (Shiblī and Maʿrūf) became "شب پره و نور" ("bat and light");
   - "معنی الفاظ نبی" became "معنی انفاس هدی";
   - "مفخر ابرار" became "محرم اسرار".

   Readable, not citable.

**Decision.** Recommend **flash** as the Persian-manuscript OCR model over flash-lite. It is clearly better on every measure: loops 4 → 1, sequence accuracy +0.27, line accuracy +0.09 paired. No Kraken model is competitive without fine-tuning. **No lane yet makes the six prose books worth translating as citable text.** Flash's line accuracy (0.735) is well below the one-page ceiling (0.933). By eye it is near-usable only on a clear naskh hand, and it has a sense-changing error every couple of couplets in nastaʿlīq. The prose books are mostly nastaʿlīq.

If Derek wants them as *draft* readings, the step that needs his go is a pilot:
- flash Batch re-OCR of the 300 prose pages already sampled (50 per book; about $1.2);
- by-eye reads on prose, which has no external reference;
- then the shelf.

Projected cost on the shelf (4,698 pages; ~4,400 net of the pilot):
- flash Batch OCR: $9–18. The lower figure is the corpus meter ($1.83 per 1K pages). The upper uses this run's per-page tokens (3.5K in, 1.6–2K out) at Batch rates.
- translation: $8–15 (corpus meter $1.78 per 1K pages, up to 2× for dense prose).
- total about **$17–33**, against the $30 Stage 2 approval.

**Not measured.**
- Prose: no reference exists, so it was not scored.
- A second ceiling page.
- `gemini-3-pro`, and flash with thinking on.
- Kraken fine-tuning, and the Party model.
- Repeat runs: flash loops are stochastic, so the degenerate count of 1 vs 4 is n = 20, one run.

*Replicated?* No; n = 20 pages, 16 in reference, `exploratory`. *Artifacts:*
- `scripts/eval/persian-ganjoor/`: `ocr_flash.mjs`, `kraken_ocr.sh`, `kraken_rows.py`, `stage1b_table.mjs`. `persian_align.py` now tolerates an arm with zero located pages.
- `scripts/eval/results/persian-ganjoor-2026-10-01-stage1b/`: per-arm scores (no page text), `table.json`, Gemini run metadata, the by-eye ceiling transcription.

Spend: about $0.30 Gemini realtime (flash 70K in / 31K out tokens; flash+couplet 72K / 45K); Kraken $0 (Hetzner CPU). Pages written: 0. Comment on #5525.
