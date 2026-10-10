---
stage: ocr
measure: accuracy
languages: [la]
scripts: [Latn]
canons: []
n_books: 60
n_pages: 60
verdict: "Kraken fine-tuned on EEBO-TCP beats lite on Latin 1500-1699 (median dCER -0.026, 46/13) but only on EEBO microfilm; it ties lite on 21 other-library pages."
status: rejected
decision: "No routing change: the gain does not carry beyond EEBO film and Kraken takes 166-271 s/page on Hetzner (#5730)"
superseded_by: null
issue: 5730
---
## 2026-10-04 · Does a Kraken model fine-tuned on our own corrected early-print pages read Latin 1500–1699 better than flash-lite? (#5730)

**Answer: by the preregistered rule it beats lite, but only on EEBO-microfilm pages like its training data.** On the
sealed 61-page Latin 1500–1699 cell (60 scored), median ΔCER is −0.026 [−0.040, −0.012], 46 W / 13 L / 1 T,
p < 0.001. The grade is **directional**: 39 library pages, under 50. All of the gain is on the 39 EEBO pages
(−0.040). On the 21 Wikisource scans from other libraries it ties lite (−0.001 [−0.013, +0.012]) and adds nothing over
stock CATMuS-Print. About half the EEBO gain is EEBO-TCP keying convention that the model learned from its training
text (`neq;` → `neque`, æ → `ae`). Folding those away post hoc still leaves a win: −0.014 [−0.026, −0.003]. That
remainder is lite writing long s as f. **No routing change.** On today's Hetzner the Kraken arms run at ≈ 170–270 s
per page, so this is no free lane for 14M pages.

**Design.** Preregistered before training: `PREREGISTRATION-kraken-latin-ft-5730.md`, with Amendments 1–2, all
committed before the first training step.
- **Test set.** The #5660 `latin-1500-1699` cell as extended by its Amendment 2 (`cells-r3.json`, job
  `ocr-bakeoff-5660c`): one page per book. 40 library pages carry EEBO-TCP same-edition references on our `bim_`
  microfilm scans; 21 are Wikisource-la pages. Same JPEGs, references and lite outputs as #5660, scored with
  `benchmark-score.mjs` from a `git archive` snapshot of the bake-off branch at `c76f04e97`, which holds the 25 new
  references and their registry.
- **Exclusions.** No page from any of 1,535 books (every benchmark registry, every `ed-*` reference, the bake-off's
  candidates, both cell maps) was used for training.
- **Training data.** Counted by source:
  - **Human-corrected Latin 1500–1699: at most 8 pages in the whole library.** That is 2 `manual` OCR revisions, 6
    pages with `ocr.source` manual or wikisource, and 5 with `ocr.edited_by`; the three sets overlap. Not used.
  - **EEBO-TCP (CC0), keyed on the same microfilm as our scans.** 64 title/author/year candidates; **44 verified**
    against our stored reads (trigram Dice ≥ 0.5 on at least half of ≤ 40 probe pages). The 20 rejected include the
    English translation of a Latin book and a wrong *Summa*. 1,989 pages offered → **1,246 pages, 50,858 lines**
    (page drop 37 %, line drop 47 %).
    - 3 catalogued-Latin books gave 623 pages and 32,258 lines. Morison's *Plantarum historiae* (1680) alone gave
      31,717 lines, **62 % of all training lines**.
    - 41 English books (1587–1698) gave 623 pages and 18,600 lines.
    - Page drops: no TCP page match 215, low line yield 381, too little text 147. Line drops: short 14,113,
      unaligned 6,850, CER > 0.3 3,073, TCP gap 1,661, length ratio 1,333, plus the lines of dropped pages.
  - **CAMENA / Wikisource: 0.** Wikisource folds ſ, and CAMENA is unparsed.
- **Lines.** Kraken's default `blla` segmentation and a CATMuS-Print read of each page. Each page was matched to its
  TCP page side, then aligned globally (edlib), and each line was cut to its TCP span (`kraken-ft-5730/align_lines.py`).
- **Truth.** TCP as keyed, with **ſ folded to s** (Amendment 2: TCP keeps ſ in 24 of the 44 books and folds it in
  20). NFD.
- **Training.** `ketos train` on Kraken 7.1, fine-tuned from `catmus-print-fondue-large` with `--resize union`
  (codec 223 → 231), batch 16, lr 1e-4, augmentation, early stop with lag 5.
  - Ran 25 epochs × ~10 min on one RunPod SECURE A40. The best checkpoint was epoch 20: validation accuracy
    **99.56 %**, against 96.65 % for stock CATMuS on the same 2,388 validation lines.
  - Arms 2 and 3 read the same `blla` lines on every test page.

**Result** (median CER; paired Δ = arm − lite, median with a seeded bootstrap 95 % CI; catastrophic = CER > 0.5).

| arm | all (n = 60) | EEBO library (39) | Wikisource (21) | catastrophic | ſ read as f | abbreviation marks (refs: 37) | s/page, Hetzner CPU |
|---|---|---|---|---|---|---|---|
| `gemini-3.1-flash-lite` (#5660 outputs) | 0.084 | 0.091 | 0.055 | 2 | **1,156** | 102 | API |
| `kraken-catmus` (stock CATMuS-Print) | 0.090 | 0.102 | 0.051 | 2 | 23 | 155 | 271 (n = 10, load ≈ 39) |
| `kraken-ft-5730` (fine-tuned) | **0.057** | **0.063** | **0.041** | 1 | 16 | 109 | 166 (n = 10, load ≈ 37) |

| comparison | all | EEBO library | Wikisource |
|---|---|---|---|
| ft − lite | **−0.026 [−0.040, −0.012]**, 46/13/1, p < 0.001 → **beats** | −0.040 [−0.047, −0.025], 35/4/0 → beats | −0.001 [−0.013, +0.012], 11/9/1 → **ties** |
| ft − lite, prereg fold (marks, ſ, u/v, i/j) | −0.028 [−0.038, −0.014] | −0.038 [−0.046, −0.025] | −0.001 [−0.013, +0.013] |
| ft − lite, post-hoc fold (+ æ/œ, `q;`→que, ß) | −0.014 [−0.026, −0.003], 39/20 | −0.023 [−0.028, −0.008], 30/9 | +0.001 [−0.013, +0.009] |
| ft − CATMuS | −0.017 [−0.023, −0.011], 50/9/1 → beats | −0.031 [−0.053, −0.022], 39/0/0 | −0.001 [−0.003, +0.001] → ties |
| ft − CATMuS, post-hoc fold | −0.006 [−0.008, −0.003], 48/10 | −0.007 [−0.034, −0.005] | −0.001 [−0.003, +0.001] |
| CATMuS − lite | +0.002 [−0.003, +0.010] → ties | +0.002 [−0.016, +0.011] | +0.002 [−0.001, +0.010] |

The #5660 cost-lane rule (`benchmark-cost-lane.mjs --cells`, unchanged) says: directional (39 library < 50), no lane
decision. Invention: fine-tune 0.083 vs lite 0.25. Loops: 0 vs 0.

**Read by eye** (read-from-image):
1. **The fine-tune's biggest win**, `ed-6a9057a0…-p10` (1662): ft 0.074 vs lite 0.168. Lite writes every long s as
   f: "fubmitte … eft … fcripfit … Epifcopatum". The fine-tune reads s throughout. It also writes `ne que` for the
   printed `neq;` and `Ecclesiae` for `Ecclesiæ`. That is TCP's keying, which the reference shares, so it is
   convention and not reading.
2. **The fine-tune's worst loss**, `ed-6a9437f6…-p10` (1656, *Gemma*): ft 0.285, CATMuS 0.542, lite 0.082. This is
   ink-heavy, show-through microfilm. Lite reads it almost clean and even restores the Greek words. Both Kraken
   models garble the bold italic display lines ("Stt ITonbe Do os n Travn") and the dark lines ("Sanctof appefrar").
   Kraken fails visibly on degraded film; lite does not.

**What this says.**
- The fine-tune **does** learn to stop misreading ſ on the film it was trained on. Lite's ſ → f habit (#4877 class 3)
  is the biggest single difference on these pages.
- It does **not** carry that over to other libraries' scans. The 21 Wikisource pages are the only non-EEBO evidence
  here, and they show no change.
- Our Latin backlog is mostly continental scans (BSB, e-rara, Google), not EEBO film. So this run cannot support a
  Latin lane.
- A real test needs training lines from non-EEBO Latin print, which we do not hold corrected, and ≥ 50 non-EEBO
  library reference pages.
- The ſ → f problem is cheaper to fix on the Gemini side (#5521's ſ-aware retry, #4877).

**Speed.**
- On the pod, Kraken's CLI was CPU-bound: 7 readers on a 7.65-core quota did ≈ 25 pages/min with the A40 at ≈ 40 %.
- On Hetzner (8 cores shared with the pipeline workers, load 36–39) one page took 271 s with CATMuS and 166 s with
  the fine-tune. The network size is the same, so the gap is load noise.
- Even with the whole box free, 14M pages is years of CPU.

**Cost.** RunPod SECURE A40, 01:58–08:10Z, ≈ **$3.04**; pod terminated and confirmed gone, under the `sl-5600-`
deadline watchdog throughout. Gemini $0. Lite outputs reused.

**Deviations.**
- Amendment 1: 20 English pages per book (reading on the pod was CPU-bound).
- Amendment 2: ſ folded in the truth.
- The image host returns Cloudflare 1010 to Python's default User-Agent, so the fetch sends its own.
- The post-hoc convention fold is labelled post hoc. It was added after reading the largest win by eye.
- The training `.arrow` files died with the pod. The lines can be rebuilt from `training-books.json` and
  `train-pages.tsv` with `align_lines.py`.

*Replicated?* No.

**Artifacts.**
- Model, kept on the box and not in git: Hetzner `/root/models/kraken/catmus-ft-latin-5730/catmus-print-ft-eebo-5730.safetensors`,
  sha256 `4e4ead34…5ae5f5`. Its README is beside it. Licence CC-BY-4.0 (from CATMuS-Print).
- In this repo, `results/kraken-ft-5730/`:
  - `verdict.json`: every comparison plus a per-page table.
  - `scored/`
  - `cost-lane-*.json`
  - `align-stats/`
  - `training-books.json`, `train-pages.tsv`, `test-set.json`, `exclusions.json`
- Scripts: `kraken-ft-5730/`.
