---
stage: ocr
measure: judged_vs_reference
languages: [mn]
scripts: [Mong]
canons: [mongolian-kanjur]
n_books: 40
n_pages: 50
verdict: "Preregistration only: a Qwen2.5-VL-7B LoRA trained on synthetic Kanjur-style columns (ManchuAI-OCR recipe) is scored by a text-only Opus meaning check on 30 frozen real columns (one per volume) against the Derge Tibetan, with shuffled-parallel controls. No result here."
status: undecided
decision: null
superseded_by: null
issue: [5664, 6871]
---
PRIOR ART: `2026-10-04-mongol-kanjur-ocr-probe-5664.md` and `2026-10-16-mongol-kanjur-argon-opus-probe-5664.md` (the 0/10 baseline: Flash, Argon and Opus read no Kanjur page; their proportional folio→Derge mapping is generalised here to a column); `2026-10-18-mongol-imu-dataset-gate-5664.md` (PR #6902: IMU data gated and unlike the Kanjur; its suggestion 3 is this run); `scripts/eval/mongol-argon-probe-5664.mjs` (the sealed `claude -p` judge, adapted: it read an English translation of a page, this reads the model's Mongolian for one column, as #6813 proposed); ManchuAI-OCR (arXiv 2507.06761) for the recipe. `scripts/eval/INDEX.md` has no Mongolian-script trainer, renderer or segmenter.

## 2026-10-18 · Preregistration: can a reader trained only on synthetic columns read the Mongolian Kanjur? (#5664, #6871 row 6)

Written and committed **before any trained model's output was read**. The untrained base model's reads are taken in the same GPU task, before training, and are also unread at commit time.

**Question.** A LoRA on Qwen2.5-VL-7B-Instruct, trained only on rendered columns of Classical Mongolian Unicode text made to look like the 1720 Beijing red Kanjur, reads real Kanjur columns. Does its Unicode output say what the page says?

### The frozen sets (`scripts/eval/results/mongol-synth-5664/eval/`)

**Meaning set: 30 columns, one per volume.** Volumes 1, 3, 5, 6, 9, 11, 13, 15, 16, 18, 20, 23, 46, 47, 49, 51, 53, 60, 62, 64, 66, 71, 72, 74, 76, 78, 81, 82, 84, 88.
- Texts come from the rKTs catalogue pages (`rkts.org/rktsneu/verif/verif2.php?id=N`, 1,397 crawled, CC BY-SA 4.0). They give each text's Mongolian printed Kanjur location (Mng1, Ligeti) and its Derge location. The rKTs Mng1 handlist page itself now returns a truncated page.
- **Only 57 of the 108 volumes have per-folio spans.** The multi-volume texts (Prajñāpāramitā, Vinaya: volumes 25–44, 54–59, 67–69, 85–86 and 89–108) are listed by volume only, so they cannot be placed by proportion and are not in the set.
- In each volume (`select_eval.py`), the chosen text has a Derge parallel in the Esukhia e-text and a Mongolian span closest to 24 sides (8–60 allowed). The leaf is the text's middle leaf, and the column is the leaf's middle column after segmentation.
- **Every leaf's printed Chinese margin was read by eye** against its stored page label: 49 of 50 agree. n010 is a decorated volume opening with no legible margin.
  - Volumes 8 and 80 were dropped because their middle leaves' labels are duplicated in the stored page labels (`f. 384b, 385a` twice).
  - The check also caught a stale cached image (n052), which was refetched. The fetch cache is now keyed by leaf.
- **The Tibetan window.** The column's position in the text is (side index + column fraction) ÷ sides. That position maps proportionally onto the Derge sides of the same text. The window is that side ± w sides, with w = max(2, min(4, round(8 % of the Derge span))). That gives 3–9 Derge sides (4.3K–15K characters). The window is wide because the column sits mid-text, where proportional drift is largest. A miss makes a correct read score as *no*, so the window errs wide.
- **Control.** The same read is also judged against the window of the item 15 places on, which is always a different text.

**Name set: 10 units.** Volumes 10, 12, 21, 24, 48, 52, 63, 70, 75, 77, none of them in the meaning set.
- Each unit is every column of the two sides on which a text starts. A Kanjur text opens with its title "in the language of India … in Tibetan … in Mongolian". That is 577 columns in all.
- Expected: the Sanskrit (IAST), Tibetan (Wylie) and Mongolian (transliteration) titles from rKTs.
- Control: the titles of the unit 5 places on.

**Files:** `eval/meaning.json` (Tibetan windows, controls, calibration pairs), `eval/names.json`, `eval/columns.jsonl`, `eval/pages.json` (book id, page number, label of every leaf), `rkts.jsonl.gz` (the parsed catalogue). Column images are not committed: the scans' licence is unsettled (#5664). `fetch-pages.mjs` + `freeze_eval.py` rebuild them from the archived masters.

**Synthetic held-out: 400 columns** rendered from held-out text lines (2 % of each pool, never rendered for training). Used for CER, for diagnosis only.

**Training text excludes the evaluated texts.** The rKTs titles and colophons of all 40 texts behind the meaning and name sets are removed from the corpus by rKTs id.

### Segmenter (`segment.py`)

Columns are cut from the full-resolution leaf (5,000 px wide):
- Ink is found from Lab: darker and redder than the local paper (a 51 px median background), with a noise-relative threshold.
- The frame's top and bottom are the strongest ink rows. The side rules are thin dense lines, with a double rule each side (the outer frame, then the inner rule about one pitch in).
- Pitch comes from the ink-profile spectrum. There is one column per profile peak, at least 0.7 pitch apart, cut at the valley between peaks.
- Each column crop is turned 90° counter-clockwise and scaled to 84 px high. Horizontal Mongolian rendering is the vertical column turned counter-clockwise; checked by eye: tails and teeth point the same way.

**By-eye check on 10 leaves (the name units' first sides):**
- 8 are clean, with one box per text column (29–31 per side).
- n070a's left frame was not found, so 3 extra boxes cover the margin strip and rules. Its text columns are intact.
- n010a is a decorated opening, and its illustration panels were boxed as columns.

All 30 meaning crops were checked by eye: each is one complete text column. Contact sheets are in the PR.

### Training (queued as gpu-queue task `10-mongol-synth-train` on gex45; this entry does not depend on it running)

- **Base model:** `unsloth/Qwen2.5-VL-7B-Instruct-unsloth-bnb-4bit`, Unsloth 2026.10.6.
- **LoRA:** r = 16 on the vision and language layers, lr 2e-4 cosine, batch 8 × accumulation 2, up to the time budget.
- **Data:** 80,000 synthetic columns from `render.py`.
  - Font: Noto Sans Mongolian (OFL 1.1), the only open Mongolian font that could be obtained. BabelStone Mongolian (OFL) is listed by its author, but its download now 404s.
  - Woodblock look: dilation 2–10 % of the em, worn-block holes, ink bleed, thin tail swashes, wider word gaps, fragments of the neighbouring columns at the edges, occasional frame rules, warp, toned and stained paper, red ink at 45–95 % opacity, blur, a lower-resolution pass, JPEG 45–92.
  - Calibrated by eye against crops from 5 real leaves (v001, v047, v077, v087, v098).
- **Prompt** (`train.py PROMPT`): transcribe the column in Unicode Mongolian script, output only the transcription. Greedy decoding, at most 192 new tokens.
- **The task reads three times:** the base model on the meaning set and 50 held-out columns, before training; the trained adapter on all frozen sets and the 400 held-out columns, after training. Outputs go to `reads-base.jsonl` and `reads-lora.jsonl`.

### Text and licences

| pool | source | licence | used |
|---|---|---|---|
| Buddhist | rKTs Mongolian titles and colophons (4 Mongolian Kanjurs), from the crawled catalogue pages | CC BY-SA 4.0 (rKTs copyrights page) | yes, minus the 40 evaluated texts |
| Buddhist | CMLI pretrain, Buddhist-keyword slice (`CMLI-NLP/Mongolian-pretrain-dataset`) | CC BY 4.0 (card) | yes |
| general | FLORES-200 traditional-Mongolian translation (`NiuTrans/FLORES-mvf`) | Apache-2.0 on the card; FLORES-200 is CC BY-SA 4.0 | yes |
| general | CMLI pretrain, first 5 MB | CC BY 4.0 | yes |
| general | GlotCC v1 `und-Mong` (CommonCrawl) | card states none; GlotCC is distributed as CC0 data over CommonCrawl (not confirmed on the card) | yes, flagged |
| general | Wikimedia Incubator Wp/mvf | CC BY-SA 4.0 | yes |
| general | PKU cross-lingual-culture cloze (mn) | Apache-2.0 | yes |
| excluded | HMJLT traditional-Mongolian corpus | CC BY-NC 4.0 | no |
| excluded | IMU-MnOCR | application + agreement (#6902) | no |
| excluded | OCR'd Internet Archive scholarly books (Rinchen, Kollmar-Paulenz, Bawden and others, in transliteration) | copyright | no |

Corpus: 3,890 Buddhist lines (402K characters), oversampled 8× so they are about half of what is rendered, and 21,133 general lines (3.34M characters). Most of the general text is modern Inner Mongolian. The rKTs strings use the catalogue's graphemic spelling: o/u, t/d and k/g merged as printed.

### The meaning check (`judge.mjs`)

- **Judge:** a sealed `claude -p --model opus` with no tools, via the subscription ($0).
- **What it sees:** the model's Unicode output as text, never the image, beside the Derge Tibetan window.
- **Batching:** up to 5 pairs per call. Real and control pairs are shuffled together under neutral ids (`q001…`), so the judge cannot tell which is which.
- **Rubric:** verbatim in `judge.mjs` `MEANING_RUBRIC`. Verdicts are match / partial / no / unreadable. Stock canonical phrases never count on their own; a match needs specific content corresponding in order.
- **Judge calibration**, run before the model's reads are judged:
  - The catalogue's own Unicode title of each meaning text, beside its Derge text's first two sides: the title is there, so it must match.
  - The same title beside another text's opening: it must not match.
  - **Run before this commit:** 29/30 real pairs *match* (the 30th, m076, holds a truncated title fragment and got *partial*), 0/30 controls *match* or *partial*. The judge passes its own gate (`judge-calib.jsonl`).
- **Name check:** per unit, whether the Sanskrit, Tibetan and Mongolian titles are each recognisable (yes / partly / no) in the read of the unit's columns, against the real titles and against a control unit's titles.

### Preregistered bar

1. **Judge validity first.** Calibration real-match ≥ 80 % and calibration control-match ≤ 10 %. If this fails, the judge is not trusted and the run is reported as "judge failed", not as a model result.
2. **Primary (the brief's bar):** meaning **match** on ≥ 60 % of the 30 columns (≥ 18), and match on ≤ 10 % of the 30 controls (≤ 3). Baseline: 0/10 pages for every engine tried (#5783, #6813).
3. **Secondary, reported, no bar:**
   - match + partial rate;
   - the untrained base model on the same 30 columns;
   - the name check: Sanskrit recognised (yes or partly) in ≥ 5/10 units with ≤ 1/10 controls would count as "names come out recognisably";
   - CER on the 400 synthetic held-out columns (diagnosis only: it says whether the model learned the renderer, not the Kanjur).

**What the outcomes mean** (decided now):
- **Primary passes:** recommend reading the whole Kanjur (a queued `11-mongol-read` task, inference to files only, nothing written to `pages`). Each page then still needs its own gate before any text is shown.
- **Primary fails, synthetic CER < 10 %:** the model learned the renderer, not the woodblock. That is a domain gap. Train more only with real lines (a Mongolist's ~300 columns, or IMU's Kanjur word images), not with more synthetic data.
- **Primary fails, synthetic CER ≥ 10 %:** under-trained or the renderer is too hard. More steps or simpler degradations would be the next arm.

### Threats, stated in advance
- The meaning check is an LLM reading Classical Mongolian. Leniency is what the controls measure; the calibration rows measure its sensitivity on correct text.
- One column is 4–10 words. A correct read of a column of stock phrasing can score *no* under the rubric. That biases the score down, not up.
- The proportional mapping can miss. The windows are wide for that reason, and a miss also biases down.
- One font. Noto Sans Mongolian is monoline and modern. The Kanjur's calligraphic letterforms are not in any open font found.
- Most training text is modern Inner Mongolian, not 18th-century Buddhist Mongolian.

**Spend:** $0. The rKTs crawl was 1,397 pages at ≤ 3 concurrent requests. The judge and calibration run on the Claude subscription, and the GPU is the owned GEX45. No Gemini. **Nothing written to `pages` or any production store**: the Mongo reads are `books` and `pages` lookups only.
