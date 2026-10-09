---
stage: translation
measure: judged_vs_reference
languages: [la]
scripts: [Latn]
canons: []
n_books: 71
n_pages: 71
verdict: "A Qwen3-8B LoRA student trained on our Latin translations scores 0.83 below flash-lite [-1.06, -0.59] on 71 referenced pages and reverses meaning on 27% of pages vs 6%."
status: rejected
decision: "Preregistered stop: no GEX45 run, no routing change (#5793)"
superseded_by: null
issue: 5793
---
## 2026-10-04 · Can an open 8B model trained on our own Latin translations translate as well as flash-lite? (#5793)
<!-- PRIOR ART: PREREGISTRATION-translation-student-5793.md (written and pushed before training); 2026-10-03-xlref-t1-latin-vs-reference-5695.md (the 71 test pages, their references, the lite arm and its noise floor, reused unchanged); 2026-10-03-open-engine-print-5660.md (the RunPod pattern); #4320 (the August Vertex tune of flash-lite on Greek, scored by chrF against Gemini text, not against human references). -->

**Verdict: FAIL.** The student scores **0.83 lower than flash-lite** [95% CI −1.06, −0.59] on 71 Latin pages judged against published human translations. The gate needed a lower bound of −0.25 or better. Training helped: the student is 0.58 above its own base [+0.41, +0.73]. But it reverses meaning on 27% of pages, against 6% for lite. By the preregistered rule, stop here: no GEX45 run and no routing change.

**Question.** Gemini writes all our translations. Can a LoRA-tuned open model, trained on ~18.6K of our served Latin→English pages, translate Latin as faithfully as `gemini-3.1-flash-lite`? And what would 1,000 pages cost on the GEX45 (RTX PRO 4000 Blackwell, 24 GB)?

**Design** (preregistered; deviations are listed below).
- **Data.** The laptop pre-sample: 20,315 pairs, 4,540 books, 3,240 works. Exclusions:
  - every book in any translation reference set (`xlref-*`, `human-ceiling-5762`) and every `work_id` those books carry: −308 pairs by book, −917 by work;
  - targets with `<note>`/`<gloss>`/`<meta>` removed and other tags unwrapped, then screened again for length and ratio: −37 short, −382 out of ratio;
  - a dev set of 20 books, held out for the base choice.
  - **Train: 18,587 pairs, 4,249 books, 3,139 works, 22.9M tokens**, round-robin across books.
- **Test:** the 71 Latin pages of #5695 T1, one per book, each span-aligned to a public-domain human translation. 0 test books are in train.
- **Arms.** All three outputs went through the same apparatus stripper.
  - (a) **lite**: T1's `prod-A`, `gemini-3.1-flash-lite` in the production call shape (prompt v13 plus the previous page).
  - (b) **base**: Qwen3-8B zero-shot.
  - (c) **student**: Qwen3-8B plus the LoRA.
  - (b) and (c) use one fixed prompt (`student-5793-v1`), vLLM 0.10.2 at temperature 0, thinking off.
- **Base choice** (20 dev pages, one blind Opus judge, source only). Gemma-3-12B-it scored 3.35 and Qwen3-8B 3.20. The difference is 0.15, under the preregistered 0.3 bar, so the choice is **Qwen3-8B**: it fits the 24 GB GEX45 in bf16, and Gemma-12B does not. TranslateGemma is gated, and the box has no Hugging Face token.
- **Training.** TRL 0.24 + PEFT 0.17, LoRA r 16 / α 32 on all linear layers, lr 2e-4 cosine, effective batch 16, 1 epoch, padding-free with flash-attention, loss on the completion only. 1,162 steps in 63 min on one RunPod H100 SXM. Loss went from 1.30 at step 5 to 0.73 (mean of the last 20 logs).
- **Scoring.** The #5702 harness, unchanged: two blind Opus judges (subscription), seed 5793, 3 controls of each type. Both judges passed the gate: 3/3 wrong pages, 3/3 planted negations caught and located, 3/3 duplicates tied. Fidelity agreement: 84% exact, 100% within 1, weighted κ 0.92.

**Result** (n = 71; per page, the mean of the two judges; bootstrap 95% CI).

| arm | fidelity mean [CI] | median | pages ≥ 4 | omission | reversal pages | invented / added content |
|---|---|---:|---:|---:|---:|---:|
| **lite** (gemini-3.1-flash-lite) | **4.16** [3.94, 4.36] | 4 | 83% | 25% | 5.6% | 27% as scored; ≈ 4 pages once the summary artefact is removed (below) |
| base (Qwen3-8B, zero-shot) | 2.75 [2.59, 2.92] | 3 | 8% | 62% | 49% | 10% |
| **student** (Qwen3-8B + LoRA) | **3.32** [3.17, 3.48] | 3 | 35% | 37% | 27% | 7% |

| paired | Δ fidelity [CI] | W / L / T (pages) | sign test |
|---|---|---|---|
| student − lite | **−0.83 [−1.06, −0.59]** | 8 / 54 / 9 | p < 0.001 |
| student − base | +0.58 [+0.41, +0.73] | 48 / 3 / 20 | p < 0.001 |
| base − lite | −1.41 [−1.65, −1.15] | 5 / 65 / 1 | p < 0.001 |

- **The gap is the same in every stratum.** Student − lite by period: 1450–99 −0.55 (n 10), 1500s −0.93 (23), 1600s −0.92 (31), 1700s −0.50 (7). Canonical pages −0.77 (n 22), non-canonical −0.86 (49).
  - **Recitation (#5523):** none visible. The base and the student score no higher on canonical pages (2.64 / 3.27) than on the rest (2.80 / 3.35).
- **Noise floor.** Lite run twice on these pages differs by −0.02 [−0.16, +0.13] (T1 X1). The student's deficit is five times that.
- **Lite here matches T1.** Lite scores 4.16 here and 4.08 in T1, with the same pages and the same harness, which is a check on the instrument.

**Three pages read by eye**, side by side with the human reference:
- **Heptameron, 1559, p. 67** (Turner 1655). It is a list: "first the name of the hour, secondly the Angel of the hour …". The student and lite both get it essentially right. The student slips on *qui distent … palmum unum* ("that differ by one palm" for "a palm apart"); lite has it right. This is the student at its best: formulaic prose with a clear structure.
- **Sendivogius, *Novum lumen chymicum*, 1644, p. 178** (French 1650). The student did not translate: it **copied the Latin page back**, line-breaks and all, and then translated only the OCR's vocabulary line. Lite's translation follows French closely. The base model echoes the source on 3 pages and the student on 2. 129 of the 18,587 training targets (0.7%) already echo their source, which may be where the student learned it.
- **Geber, *Alchemiae*, 1545, p. 86** (Russell 1678). This is where the student wins. Lite's production output is a summary and a keyword list, with no translation, so it scores 1. The student translates the whole passage on Jupiter's (tin's) calx and vitrification correctly against Russell. One slip: "reduced to the glass of the prior disposition" garbles *prioris dispositionis aut in vitrum redactam* ("in its former condition, or turned into glass").
- **The student's typical failure is a reversed or blurred clause in otherwise fluent prose.** The judges quoted:
  - "But the learned and the nature itself" for *Verum indocti …* (the unlearned);
  - "which is **not** counted among the works of excellent perfection" for *… inter opera perfectionis eximiae numerantur* (which *are* counted);
  - "the poison itself … passes through it" for *ipsumque venenum sibi simile pertransire*.

  These are the reversals the #5695 synthesis names as costing a scholar most: negation, number, and who does what.

**Throughput and cost** (vLLM 0.10.2 on a RunPod RTX PRO 4000 Blackwell 24 GB, the GEX45's GPU).
- **Workload:** 364 pages, the 91 dev+test sources ×4, averaging 889 prompt and ~600 output tokens per page.
- **Merged weights:** a merged LoRA costs per token exactly what the base costs, so Qwen3-8B stands in for the merged student. The unmerged student wrote 9% fewer tokens than the base on the H100.

| config | output tok/s | pages / hour | € per 1,000 pages on the GEX45 (€214/mo, 720 h, fully used) | $ per 1,000 pages at RunPod $0.57/h | the 6.3M-page Latin backlog |
|---|---:|---:|---:|---:|---|
| bf16 (fits 24 GB, ~4 GB KV cache) | 336 | 1,989 | €0.15 | $0.29 | 3,170 GPU-hours ≈ 4.4 months of one GEX45 |
| FP8 dynamic (vLLM `quantization=fp8`) | 911 | 5,591 | €0.05 | $0.10 | 1,130 GPU-hours ≈ 1.6 months |
| *for scale: flash-lite Batch (T1 cost column)* | — | — | — | ≈ $1.00 | ≈ $6,300 |

- **The FP8 row is throughput only.** Its translation quality was not judged, and quantisation could lower it further.
- **On an H100,** the student with an unmerged LoRA ran 91 pages at 11,800 pages/hour (a small batch, not saturated).
- **The cost is not the problem.** At roughly a tenth of lite's price per page, the open model would make the backlog affordable. It is not good enough to serve.

**Deviations and instrument notes** (read these before reusing the code).
- **Lite's `<summary>`/`<keywords>` were left in.** All 71 lite outputs carry these blocks, and `cleanTranslation()` *unwrapped* them instead of removing them, so the judges saw a summary paragraph and a keyword line appended to lite's English.
  - 35 of lite's 41 "added fact / unreadable fill" flags quote that block. Only 4 pages carry a flag that does not.
  - Lite's raw 27% invention rate is therefore an artefact. Its real rate is about the student's 7%, so the invention half of the gate is effectively a tie.
  - The artefact can only have hurt lite, and lite still scores 4.16. The verdict rests on fidelity and stands.
  - Training targets carry no `<summary>` blocks, so the student is unaffected. Anyone reusing `cleanTranslation()` on served English must add `summary|keywords` to the removed set.
- **Lite and the student did not see the same input.** Lite had the previous page as context and its production prompt; the student and base had neither. T1 measured dropping the context as within the floor (+0.11 [−0.05, +0.28]).
- **First flash-attn attempt failed.** flash-attn 2.8.3 breaks xformers' import in vLLM's Gemma-3 path, which allows ≤ 2.8.2 and has no 2.8.2 wheel for this image. `XFORMERS_IGNORE_FLASH_VERSION_CHECK=1` fixed it. The setup also needed `pip --break-system-packages` on `runpod/pytorch:1.1.0-cu1281-torch280-ubuntu2404` (PEP 668). About 10 minutes of H100 time were lost to these two.

**Threats.**
- **One judge family.** Both judges are Opus, and they read the transcription, not the image.
- **Teacher ceiling.** The student learned from Gemini's served English, mostly from flash and flash-lite, so lite is a ceiling it can approach but hardly pass. A stronger teacher (Opus or Flash on corrected OCR) or more data might move it.
- **Small scale.** This is one 8B model, one epoch, ~9% of the pairs. A larger base (Gemma-3-27B, or Qwen3-32B quantised) or the full 1.38M pairs would need a larger budget and a GEX45 that cannot hold them in bf16.
- **Terms of use.** Gemini API terms restrict using outputs to develop competing models (#4320, 2026-08-28). This run does not resolve that; it is Derek's call before any next step.

**Cost.** RunPod: H100 SXM about 1 h 38 min, ≈ $5.67; RTX PRO 4000 about 20 min, ≈ $0.20. **Total ≈ $5.87 of the $10 cap.** Gemini: $0. Judges ran on the subscription (26 harness chunks plus 1 base-choice judge). Both pods were terminated, and RunPod confirmed both gone.

**Artifacts.**
- `scripts/eval/results/translation-student-5793/`: counts, the base choice, records, verdicts, `results.json`, `summary.json`, gallery, raw outputs, throughput, training logs.
- Code: `scripts/eval/translation-student-5793/`.
- **The adapter** (Qwen3-8B LoRA, 166 MB tarball, sha256 `5f4cfb68…`) is in R2 at `sourcelibrary/private/models/translation-student-5793/<unlisted>/`. The bucket's public host serves any key, so the object's name is not published. List the prefix with the R2 keys.
- Training pairs are private and are not in git.

*Replicated?* No. This is one training run, one seed, n = 71.
