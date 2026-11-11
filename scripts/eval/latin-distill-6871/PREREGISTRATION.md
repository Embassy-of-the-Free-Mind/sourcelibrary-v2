# Preregistration — distil Flash into GLM-OCR for Latin print (#6871, Derek 2026-10-20 item 2)

Written 2026-10-20 before any training or reading. PRIOR ART: `2026-10-18-latin-gex45-bakeoff-5924.md` (the 99 frozen
references, the scorer, the bar and every arm this compares with); `2026-10-06-latin-print-r4-by-book-5924.md` (round 4:
stored gemini-3-flash-preview reads Latin print level with 3.8-flash); `2026-10-19-mongol-real-pilot-score-5664.md`
(a LoRA on real labels on this box: 56.8 → 23.6 % CER).

## Question and the decision it changes

Can GLM-OCR 0.9B, fine-tuned on a Flash model's reads of OTHER Latin pages, read the 99 #5924 reference leaves well
enough to beat production flash-lite? Yes → Latin print gets a standing $0 lane on the GEX45 (next: a backlog pilot and
a gothic check). No → Latin stays on the Gemini side (the ſ fix of #5924), and distillation needs a bigger teacher set.

## Teacher (a deviation from the brief, and why)

The brief says 3.8 Flash reads from agy. agy's quota was exhausted on 2026-10-20 ("resets in 84 h" on both cloudlayer and
gex45). So the teacher is the **stored production read by gemini-3-flash-preview**. Round 4 measured it level with
3.8-flash on Latin print: best in all 20 by-eye runs between the two, and ſ→f words 1,577 vs 1,531 on 291 pages, against
lite's 6,896. It costs $0 and exists now. A 3.8-Flash-teacher round can follow after the quota resets.

## Training set (`build-train.mjs`, seed 6871)

- **Books:** Latin, printed, year 1500–1699.
- **Excluded:** the 99 reference books and every book sharing a work_id with one (0 leaks).
- **Pages:** page ≥ 5, not human-edited, cleaned label 300–5,000 chars, at most 3 per book.
- **Long s:** the teacher kept ſ on the page (≥ 5 ſ: "keep long s"). Production flash-preview writes ſ as s on most pages;
  only ~8 % of its pages keep it, so the filter teaches the student the diplomatic habit.
- **Labels:** production markup removed by `clean-teacher.mjs`. Metadata tags go; running head and marginal text stay.
- **Size:** 2,000 train pages (966 books; 1500s 909, 1600s 1,091) and 100 val pages (48 other books).

## Student and training (fixed now)

- **Model:** zai-org/GLM-OCR, bf16, its own prompt `Text Recognition:` (the bake-off's G arm).
- **LoRA:** r 16, α 32, dropout 0.05, on the language model's linear layers only; the vision tower is frozen.
- **Schedule:** lr 1e-4, cosine, warm-up 30 steps, effective batch 8, **2 epochs (500 optimizer steps)**.
- **Images:** long side ≤ 2,400 px, as the bake-off fed them.
- **Loss:** on the label tokens only.
- **Smoke gate:** every loss finite, and the mean train loss of optimizer steps 21–25 below that of steps 1–5, or the task stops.
- **Merge:** the adapter is merged into the weights.

## Reading the 99 (the bake-off harness, unchanged)

The merged model is served by the same vLLM 0.31 command as arm G (`drive.sh` flags) minus speculative decoding (the merged checkpoint has no MTP draft layer; greedy speculative decoding does not change the output) and read with `read.py glm`
(6,000-token cap) on the same fed images. Arm **D** = the student. Arm **G2** = stock GLM-OCR read again in the same
task, with the same flags as D: the determinism control. If G2 differs from G by more than the noise floor, D is compared with G2.

## Scoring (`latin-bakeoff-5924/score.mjs`, unchanged)

- **View N (preregistered #5924 primary).** D is scored against lite (L), per century, with the #5924 bar. All three must
  hold:
  1. paired bootstrap CI of Δ median page CER below 0;
  2. |Δ| above the noise floor;
  3. catastrophic pages no more than lite's + 1.
- **View N with `--fold-f`.** Must also hold: D's median ≤ lite's median + 0.3 points, in BOTH centuries. #5924 showed
  that an ſ-only win is not better reading; this stops it counting as one.

## Rule (fixed now)

- **PASS (lane-worthy) requires:**
  - view N passes the #5924 bar in **both** centuries;
  - the fold-f condition holds in both;
  - and D beats G (or G2) in median view-N CER in both centuries, so the training did something.
- **PASS in one century only:** reported as such. That century becomes the pilot candidate.
- **Otherwise FAIL.**

Reported alongside, none of it deciding:
- diplomatic view D medians, and ſ kept / ſ→f counts;
- student-vs-teacher CER on the 100 val pages;
- pages/h on the card.

`measure: agreement`: the references are three Opus reads, not a human transcription. Little gothic (4 of 40 1500s
pages), so no verdict carries over to blackletter.
