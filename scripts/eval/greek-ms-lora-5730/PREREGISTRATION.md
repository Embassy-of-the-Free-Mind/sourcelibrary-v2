# Preregistration — burst 2: train a Greek-manuscript reader on edition-fitted pages (#5730)

Written 2026-10-22, before any training and before any arm is read or scored. PRIOR ART:
`2026-10-06-greek-manuscripts-full-kraken-fit-5619.md` (the fit of Schneider 1847 and Berthelot–Ruelle to these codices:
the source of every label here); `2026-10-20-latin-print-distill-glm-ocr-6871.md` (row D: GLM-OCR + LoRA on this card,
the training script used unchanged); `2026-10-04-kraken-latin-ft-5730` (burst 1: won only on scans like its training
data, hence the shift test below decides); `2026-10-18-gex45-capability-card-6871.md` (engine choice).

## Question and the decision it changes

Can an open model fine-tuned on ~600 pages of ONE Greek manuscript, labelled with a public-domain edition's text, read
OTHER Greek manuscripts better than what readers are served today and than flash-lite? Yes → the 385 Greek manuscripts
(149,476 pp, census on #5730) get a $0 lane candidate on the GEX45 (next: a pilot with by-eye checks). No → Greek
manuscripts stay with Gemini (the Gemini 4 Argon re-read route, #6769), and training waits for more hands.

## Cell (census, #5730 comment 2026-10-22)

Greek manuscripts: the only candidate with ≥ 300 image-aligned pages AND a backlog no open engine reads. Not chosen:
Tibetan (Yigdzin wins), SKQS (Paddle wins), Syriac (Kraken lane served), Persian / Hebrew / Greek print (< 300 aligned pages),
Latin (burst 1 and row D ran; the D re-run is the steward's).

## Data (`build.mjs`, committed with this file; seed 5730)

- **Labels.** The #5619 fit, re-run on the stored read of each page: located in order with its neighbours, both edges
  confident at FIT_RULES v2 (identity ≥ 0.45, ≥ 0.12 above chance), read/span letter ratio 0.6–1.6. The label is the
  edition text between the edges (`spanText`), apparatus removed (`---` and below), footnote calls / section and folio
  marks / LaTeX residue removed, one running line, Greek letters and punctuation only. **It is the editor's text, not a
  diplomatic transcription**: Schneider's accents, word division and readings. Edition text = our OCR of the print.
- **Train: Grec 1839 (BnF, *Procli Opera*) → Schneider 1847.** 954 usable pages. Grec 1841 covers almost every passage
  1839 does, so a passage-disjoint split by book is impossible; the edition's letter stream is cut at **70 %**: training
  takes 1839 pages ending ≥ 3,000 letters before the cut. **619 train + 33 val** (val = loss only; never scored).
- **T1 — near distribution: Grec 1841 (BnF, same work, another codex and hand),** pages starting ≥ 3,000 letters AFTER the
  cut: **81 pages** (spreads), none of whose text was trained on.
- **T2 — library and text shift (DECIDES): Marcianus gr. 299 (Venice, 104 pp) and Ars sacra, Laurenziana (Florence,
  203 pp) → Berthelot–Ruelle 1887.** Other libraries, other scribes, other texts (alchemy), another edition: **307 pages**.
- Reference edges come from fitting the SERVED read. That biases the test pages towards pages whose served text starts
  and ends right: conservative against the trained model.

## Model and training (fixed now)

- Base **zai-org/GLM-OCR 0.9B**, its own prompt `Text Recognition:`. Chosen by the #6896 card: it fits the card
  alone with room for training, a LoRA recipe already ran on this box (row D), and Kraken would need line-level labels
  we do not have (the fit is page-level); Paddle-VL has no LoRA recipe here.
- `scripts/eval/latin-distill-6871/train.py` **unchanged**: LoRA r 16 / α 32 / dropout 0.05 on the language model's linear
  layers, vision tower frozen, bf16, lr 1e-4 cosine, warm-up 30, effective batch 8, loss on label tokens only, the same
  smoke gate (finite loss; mean of steps 21–25 below steps 1–5, or stop), adapter merged. Changed by flag only:
  **`--epochs 3` (≈ 232 optimizer steps), `--max-label 4096`** (Greek labels are longer in tokens than Latin; the task
  logs how many labels exceed 4,096 tokens before training).
- Images: long side ≤ 2,400 px (`latin-distill-6871/fetch.py`).
- Budget: ≤ 6 GPU-h for the whole task (timeout 5 h): training ≈ 1.5 h, reads ≈ 0.5 h.

## Arms (the same 388 test images)

| arm | what |
|---|---|
| **F** | GLM-OCR + this LoRA, merged, served by vLLM 0.31 with row D's flags (no speculative decoding), `read.py glm`, 6,000-token cap, temperature 0 |
| **G** | stock GLM-OCR, same flags, same task: did the training do anything |
| **S** | the text served today (`pages.ocr.data` at build time, tags stripped with `bodyText`): gemini-4-argon-low on all 81 T1 pages (the #6769 pilot wrote them); gemini-3-flash-preview on 268 and flash-lite-preview on 39 of T2 |
| **L** | gemini-3.1-flash-lite, the GENERIC prompt of `latin-bakeoff-5924/gemini-arm.mjs`, temperature 0, on the same fed images (run from l7a after this file is committed; ≈ $0.2) |

S keeps one advantage: its margins and running heads sit in tags that `bodyText` removes, while F/G/L write them as text,
which the edition does not hold. Conservative against F.

## Scoring (`score.mjs`, committed with this file)

- **View N (deciding):** page CER on Greek base letters only (accents, breathings, case, punctuation, spacing and any
  non-Greek dropped; σ/ς/ϲ folded) = Levenshtein(hyp, ref) / |ref|. The edition and the scribe differ in accentuation
  and orthography; view N measures whether the letters are read.
- View A (reported only): the same with diacritics kept.
- Per page Δ = CER(F) − CER(X); median Δ with a 10,000-resample bootstrap 95 % CI (seed 5730); wins / losses.
- Catastrophic = page CER > 0.5. A page counts only if every arm read it.

## Rule (fixed now)

**PASS (a lane candidate) iff, on T2 pooled:**
1. F − S: CI of the median Δ entirely below 0, and |median Δ| ≥ 0.5 points;
2. F − L: the same;
3. catastrophic(F) ≤ catastrophic(S) + 1;
4. median CER(F) < median CER(G).

T1 is scored with the same rule and reported. **Passing T1 and failing T2 = in-distribution only, not a lane** (burst 1's
result). Per-book T2 numbers are reported and do not decide. A PASS still needs a by-eye pilot before any write;
nothing in this task writes to Mongo.

## What this cannot show

- Accuracy against a diplomatic reading: the references are edition text with Flash-fitted edges (agreement with an
  editor, not a transcription).
- Hands beyond the four codices; T2 is two scribes.
- Whether the Gemini 4 Argon route (agy) is better on T2: it has no stored reads there.
