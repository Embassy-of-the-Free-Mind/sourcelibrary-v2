---
stage: ocr
measure: agreement
languages: [bo]
scripts: [Tibt]
canons: [tibetan]
n_books: 85
n_pages: 294
verdict: "vLLM 0.29 runs Yigdzin on gex45's Blackwell card at 0.48 s/leaf (HF: 211 s) and 0.44 s/guttered page (HF: 235 s). Median character similarity to the HF read is 0.9994 on 64 leaves and 1.000 on 30 pages. The posted line rule fails on one leaf by eye: vLLM repeats a line on 1 of 64 leaves. On the same sets HF drops a line vLLM keeps (1 of 64 leaves) and loses a whole page vLLM reads (1 of 200 T pages). The hang that blocked vLLM here was OMP_NUM_THREADS=8 in the task, not the card."
status: adopted
decision: "Derek's session withdrew the HF fallback (84) at 09:31Z on the medians. The vLLM leaf reads (all 188 crops) are the #5771 arm-3 reads. The gutter remainder (3,835 pages, about 30 GPU-min) and #5771 stage 2 (about 1 GPU-day) are written as plans only. Applying anything is still Derek's call (#6871 row 4, #5771)."
superseded_by: null
issue: [6871, 5771]
---
## 2026-10-26 · Can the production vLLM Yigdzin reader replace the HF reader on gex45? (#6871 row 4, #5771; job yig-vllm-6871)
<!-- PRIOR ART: 2026-10-20-tibetan-guttered-pages-yigdzin-page-mode-6871.md (the HF page-mode lane this replaces; its vLLM arm hung); 2026-10-14-yigdzin-rest-withheld-and-unread-tibetan-4523.md (the same worker on vLLM 0.29.0 on L4s, 0.73–0.97 pages/s); scripts/eval/split-leaf-5771/yig_leaf_read.py on job-split-leaves-5771 (the HF port of the worker that 81-split-leaf-5771 ran). -->

**Speed: yes.** The engine is about 440× faster than HF per leaf and about 530× per guttered page, on the same model, revision and decode settings.

**Parity: on the medians, but not on the line rule.**
- Median character similarity to the HF read is 0.9994 on the leaves and 1.000 on the guttered pages.
- One leaf in 64 has a vLLM-repeated line that the leaf does not show. The bar posted before the run forbids that.
- In the other direction, HF drops a line that vLLM keeps on 1 leaf in 64, and loses a whole page that vLLM reads on 1 of 200 T pages.

At this sample size, the errors look like numerical noise between two kernels running the same model. vLLM does not look worse.

### Why the vLLM path hung (and the fix)
The hang was the parent process's OpenMP pool, not the card or the CUDA build.
- **What happened.** vLLM forks its EngineCore. Task 73 (vLLM 0.31) and run 1 of this task both exported `OMP_NUM_THREADS=8`, so the parent had a live 8-thread libgomp pool when it forked. The child then deadlocked on its first CPU tensor.
- **The stack.** py-spy on the stuck EngineCore, 2026-10-26: `gpu_input_batch.py:134 torch.zeros → at::native::fill_kernel → libgomp`, idle at 224 MiB.
- **The fix.** With the variable unset, vLLM pins torch to 1 thread itself ("Reducing Torch threads from 14 to 1"). The engine then comes up in 39 s, including a 10.6 s torch.compile, with CUDA graphs on.
- **The 0.31 venv.** The same fix probably unblocks `vv` (vLLM 0.31.0) as well, with `VLLM_USE_V2_MODEL_RUNNER=0`. That was not tested.

### Setup
- **Environment.** Venv `/root/jobs/yig-vllm-6871/venv`, built by `scripts/gpu/yigdzin-vllm/setup-venv.sh`.
  - Versions: vllm 0.29.0 · torch 2.13.0+cu132 (its arch list includes sm_120) · transformers 5.20.2 · flashinfer-python 0.6.18 · triton 3.7.1 · seqpos plugin @ 50506eb6 · driver 595.91.07 (CUDA 13.2).
  - Full freeze: `results-vllm029/venv-freeze.txt`.
  - Environment variables: `VLLM_USE_FLASHINFER_SAMPLER=0`, `OCR_VLLM_IMAGE_TOKEN_POSITIONS=sequential`, `--gpu-util 0.6`.
  - vLLM 0.29 falls back to the V1 runner on its own ("Model Runner V2 does not yet support custom logits processors").
- **Worker.** The production `yig_leaf_worker.py` (ops `handoffs/data/2026-09-25-yig-leaf/`) is now committed at `scripts/gpu/yigdzin-vllm/`.
  - The read path is unchanged: 2400-px prep, DRY 0.8/1.75/12, loop retry at T 0.4 with n=2, and the short-read re-decode.
  - The only additions are crop rows, `--gpu-util` and `--enforce-eager`.
- **The bar** was posted on #6871 before any vLLM read existed (comment 6411135905): median character similarity ≥ 0.95 on each set, and no vLLM-added line unless the image shows it.
- **Sets.** gpu-queue task `83a-yig-vllm029-parity-r2`, 2026-10-26 09:25–09:30Z:
  - **L**: all 188 #5771 crops read; 64 have HF reads (81 was stopped at 64/187 by Derek's session).
  - **P**: 30 guttered pages, `pick-parity30.py`, seed 6871, HF read ≥ 100 tokens; `yig_vllm.py` page mode, the HF page reader's recipe.
  - **T**: 200 more guttered pages with HF reads, throughput only.

### Results
| set | n scored | median char sim | median syllable id | ≥ 0.95 | added lines (posted test) | dropped lines | throughput (model load excluded) |
|---|---|---|---|---|---|---|---|
| L leaves | 64 | **0.9994** | 0.9965 | 61/64 | 0 (by eye: **1**, a006-L2) | 1 | **2.10 leaves/s** · 0.48 s/leaf (HF 211 s) |
| P pages | 30 | **1.000** | 1.000 | 30/30 | 0 | 0 | 1.92 pages/s (batch 30) |
| T pages | 190 (+10 blank both) | 1.000 | 1.000 | 189/190 | 18 in 3 pages (2 are line breaks only, 1 = HF empty) | 0 | **2.21 pages/s** · 0.44 s/page (HF 235 s) |

**VRAM.** Peak was 14.7–15.0 GB per process. That is the 0.6 reservation: weights 1.65 GiB, KV cache 11.63 GiB (469K tokens, 57× concurrency at 8,192), CUDA graphs 0.19 GiB. The work itself needs far less KV, so a 0.3 reservation would leave the card shareable. The card was back to 2 MiB after each arm.

**Run 1 hung.** It sat for 6 min at 224 MiB and was stopped by hand. The fix is the OMP section above.

### By eye (8 items where the reads differ most; crop or page image open)
| item | sim | which read matches the image |
|---|---|---|
| L a028-L1 | 0.83 | **vLLM.** The leaf has 7 lines. HF reads 6 and skips the body (ལུས་ཀྱི) clause. |
| L a006-L2 | 0.85 | **HF.** The leaf has 7 lines. vLLM inserts an 8th, a garbled second pass over line 6 (…མི་སྦྱོར་བར་མི་སྦྱོར་རོ…). This is the one vLLM-added line. |
| L a013-L2 | 0.98 | **Neither.** Both skip leaf line 2 (ཀུན་ནས་ཉོན་མོངས་པ… རྣམ་པར་བྱང་བར). The rest is the same text; HF breaks two lines differently. |
| L a018-L1 | 0.92 | **Neither.** A blank leaf with only the margin ཀ. Both write the same Latin junk ("empty paged paget…"). |
| L a019-L1 | 0.96 | **Tie.** The formula is འགོག་པ་ལ་གནས་པ. HF slips on lines 5 and 7, where vLLM is right. vLLM slips elsewhere (དང་དང་, མགོག, རྣམས་པར). |
| P …58ab1 | 0.97 | **Undecidable.** A binarized, degraded woodblock leaf with interlinear gloss. The reads part where the print breaks up. |
| T …5af6a | 0.006 | **vLLM.** A full 6-line page. HF stopped after ༄༅།. vLLM's line 1 (…པ་ལ། །ཕ་མོའི་རྒོལ་བའི་བསམ་ངན་…) matches the print. |
| T …5b44e | 0.99 | **vLLM on layout.** The text is the same. Line 2 ends in a dotted filler, which vLLM writes as a tsheg run with the line break kept. HF merges lines 2 and 3. |

**Tally.** vLLM matches better on 3 items, HF on 1. Two are ties or undecidable, and two have the same error on both.

### The #4523 write rule on these items
The rule is `first-ocr-guard` + ≥ 150 syllables. It was run on both reads of all eight items, plus T …58a16 and …58a9b:
- T …5af6a: the HF read is withheld (0 units); the vLLM read is written (258).
- T …58a16 and …58a9b: both reads are written. The text is identical (similarity 1.000) and only the line breaks differ.
- L a006-L2: **the repeated vLLM line is written** (354 units). The guard and the floor do not catch a duplicated line.
- L a018-L1: **the Latin junk is written on both engines** (261 / 271 units). The guard counts Latin words as units.

### A worker defect both engines share (#5771 must handle it before any apply)
5 of 188 vLLM leaf reads are mostly Latin letters (a018-L1, a051-L3, a072-L1, a045-L2, a078-L1):
- **Blank leaves.** The short-read re-decode (`min_tokens` 300) forces text out of a blank leaf. It is kept because it is longer and loop-free.
- **Retries.** The retry keeps the least repetitive of its candidates. `repetition_score` counts tsheg syllables and Latin junk has none, so the junk wins.

The HF port copies both rules, and its one read in this set (a018-L1) is the same junk. Stage 2 needs a reject: Latin letters > Tibetan letters means the leaf is blank or unread. Without it, about 2.7% of leaves would be written as junk.

### Follow-ups (plans only, not queued)
1. **Gutter remainder on vLLM.** `full/` holds 1,297 of 5,132 HF reads, so 3,835 pages are left.
   - **Run:** `yig_vllm.py --mode page --batch 64 --gpu-util 0.6` (no `OMP_NUM_THREADS`), to a new dir `/root/jobs/tib-gutter-6871/full-vllm`, as a new task such as `86-tib-gutter-vllm-rest`.
   - **Cost:** about 3,835 / 2.2 ≈ 29 GPU-min plus 1 min to load, against about 10 GPU-days on HF. Reading all 5,132 takes 39 min and puts the lane on one engine.
   - **Writes:** files only. The apply (v4 judge + first-ocr-guard + 150-syllable floor) stays Derek's.
2. **#5771 stage 2** (~157K leaves).
   - **Rate:** at 0.48 s/leaf that is about 21 GPU-hours, about 1 GPU-day at `--gpu-util 0.6`, against about 380 GPU-days on HF at 211 s/leaf.
   - **Fetch:** the worker fetches frames itself at 5 req/s from our own host. That is about 4.4 h for about 78K frames, and it overlaps with reading.
   - **Before any apply:** the Latin-junk reject above, and a duplicate-line check. Neither is in the write rule today.
