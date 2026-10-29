---
stage: ocr
measure: [judged]
languages: [bo]
scripts: [Tibt]
canons: []
n_books: 80
n_pages: 80
verdict: "The split-leaf re-read fails its pre-registered OCR bar (paired median span ratio 0.86, bar ≤ 0.5) but removes the seam damage: on the 28 frames served from a whole-page Yigdzin read, bad Opus translations fall from 75% to 21% and no seam line is invented by eye; cutting the stored read without re-reading changes nothing (82%). Re-reading frames that were already read leaf by leaf gains nothing (13% to 13%). The re-read invents text on near-blank title leaves."
status: undecided
decision: "Re-read only the frames whose stored Yigdzin read is a whole-page read (free metadata; sensitivity 0.87, specificity 0.86 for 'bad from the OCR'), behind a per-leaf blank/title guard; no page writes until Derek decides the split migration (#5771)"
superseded_by: null
issue: [5771, 6948, 5320, 6871]
---
## 2026-10-25 · Does splitting multi-leaf Tibetan photos into single leaves fix the seam damage the #6948 gate found? (#5771)

PRIOR ART:
- The #6948 Opus gate harness and its scratch (`scripts/eval/opus-tib-sa-6948/`, the same 80 audited frames, the blind
  image-grounded auditor, the same 15 planted controls; copied from l7a, not redrawn).
- The #4523 Yigdzin leaf ledgers (cuts) and `yig_leaf_worker.py` (the production per-leaf reader).
- The #5771 Neyphug split (pair-rule order).
- `yig_page.py` (#6871, the HF recipe on gex45).
- The vLLM 0.29 parity run (job yig-vllm-6871).

Harness: `scripts/eval/split-leaf-5771/`. Results: `scripts/eval/split-leaf-5771/results/`.

**Who it is for.** Readers of the ~1,400 public Tibetan books photographed as two (or more) pecha leaves per frame (EAP Kangyur, Thadrak, Neyphug, Gangtey and similar). A served page is two leaves; the transcription can invent, duplicate or truncate lines where the leaves meet, and the English inherits it.

### What the stored reads are (a finding before any model ran)
Of the 80 audited frames:
- **52 were already read leaf by leaf** (production `partition` crops, runs 09-25 to 10-14).
- **28 serve the 2026-09-15 whole-page read.** These 28 held **21 of the 28 bad pages** in #6948 (75%); the 52 leaf-read frames held 7 (13%).

For the whole-page frames a leaf read already existed. The step-2 run of 2026-10-01 read them per leaf, and its decision pass did not serve that read: decision class `align`, reason **`fewer-syllables`**. The whole-page read was longer *because* it carried the invented and duplicated seam lines (a019: 19 transcribed lines for two 7-line leaves).

Corpus-wide that rule sent 39,283 pages to `align`. Today 50,946 photos in the 1,406 frame books still serve a whole-page read, 10,236 of them without English.

The ledger cuts are also not always right. On the contact sheets, 12 of the 76 frames with a ledger cut had a wrong one:
- a cut through a leaf's text;
- two or three leaves in one crop;
- a third "band" sliced off the bottom of leaf 2.

They were re-cut by eye. Two frames the detector could not cut were cut by eye; one is a single leaf.

### Design (pre-registered on #5771 before any audit reply: [bar](https://github.com/Embassy-of-the-Free-Mind/sourcelibrary-v2/issues/5771#issuecomment-6402728071), [three arms + triage labels](https://github.com/Embassy-of-the-Free-Mind/sourcelibrary-v2/issues/5771#issuecomment-6403372742))
- **Arms:**
  - **SEAM**: the stored read and its #6948 audit.
  - **CUT**: the exact transcription #6948 audited, cut onto leaves at `<leaf-break/>` or at the ledger's line counts, with no re-OCR.
  - **REREAD**: 188 leaf crops cut from the R2 master, each read alone with Yigdzin 1.
- **Engine for REREAD.** The production `yig_leaf_worker.py` on **vLLM 0.29.0** on gex45 (batch 128; job yig-vllm-6871, Derek's note of 10-26 09:10Z).
  - It passed its parity bar against my HF port: median similarity 0.9994, 0 added lines, n=64.
  - The HF port's 64 reads were kept as a cross-check.
- **Translation.** CUT and REREAD were translated by Opus (`claude -p`) per leaf, 1 per call, on the production prompt, with no previous-leaf seed. The leaves on one photo are consecutive rectos, so the leaf before each one is on another frame.
- **Audit.** The #6948 auditor, unchanged: the same frame image and full-resolution tiles, and the leaves joined by `<leaf-break/>`.
  - CUT and REREAD went in one shuffled packet with opaque uids, plus the 15 controls.
  - Bad pages were attributed OCR vs translator by the #6948 text-only pass.
- **Strata, fixed from metadata:** SEAM 28 (whole-page read), RECUT 12 (crop changed by this job), SAME 40.
- **By eye:** 20 leaves.

### Result
**Controls: 15 of 15 caught** (10/10 reversals, 5/5 inventions). The auditor's verdicts count.

**Translation, bad pages (Wilson 95%):**

| | SEAM (stored) | CUT | REREAD |
|---|---|---|---|
| all 80 | 28 (35%, 26–46) | 33 (41%, 31–52) | **17 (21%, 14–31)** |
| SEAM stratum (28) | 21 (75%, 57–87) | 23 (82%, 64–92) | **6 (21%, 10–40)** |
| RECUT (12) | 2 (17%) | 2 (17%) | 6 (50%, 25–75) |
| SAME (40) | 5 (13%) | 8 (20%) | 5 (13%) |
| CANON (40) | 19 (48%) | 21 (53%) | 5 (13%, 6–26) |
| OTHER (40) | 9 (23%) | 12 (30%) | 12 (30%) |
| … OCR-caused / translator-caused | 18 / 10 | 14 / 19 | 5 / 12 |

**OCR, auditor spans where the leaf differs from the transcription (paired, frames legible in both):**

| | n | median before → after | median ratio (95% bootstrap) | fewer / same / more |
|---|---|---|---|---|
| REREAD, SEAM stratum (the bar) | 27 | 21 → 13 | **0.86 (0.68–0.97)** | 19 / 3 / 5 |
| REREAD, SAME | 21 | 4 → 4 | 1.00 | 8 / 7 / 6 |
| CUT, all (test-retest: the same text) | 53 | 10 → 9 | 1.00 (1.00–1.00) | 19 / 17 / 17 |

Spans per leaf (frame spans ÷ leaves), median: SEAM 4 → REREAD 2.7 overall; on the SEAM stratum 10.5 → 6.5.

**Against the bar:**
1. **OCR (median ratio ≤ 0.5): fails.** The ratio is 0.86. The span count weighs a removed copied line the same as one wrong vowel, and the letter-level misreads (the same engine) stay. CUT's ratio of exactly 1 and its 17/53 frames that move either way show the instrument's noise.
2. **By eye, 0 invented or duplicated seam lines: passes.** All six named seam cases (a008, a010, a011, a019, a037, a040) read clean at the seam. But the split read is not clean:
   - 3 of the 20 leaves invent or duplicate a line elsewhere:
     - a045-L2, a near-blank leaf, gets "na na na na na da o";
     - a006-L2 repeats a clause of a formula, and only on vLLM (the HF read of the same crop is right);
     - a034-L2 repeats a formula line.
   - On a040-L1, two lines are merged and dropped.
3. **Controls: pass** (15/15).

**Stage 1 therefore fails as registered.** Re-read, the frames that were damaged give readers about a quarter as many bad translations (SEAM stratum 21/28 → 6/28, CANON 19/40 → 5/40).

**Why the other strata do not improve:**
- **CUT never helps.** It is the same text: SEAM stratum 82%.
- **The re-read gains nothing where the stored read was already per leaf** (SAME 13% → 13%).
- **It loses on RECUT (17% → 50%)** for two reasons, both new failure points of a per-leaf lane:
  - Read alone, a near-blank title leaf makes Yigdzin invent repeated title formulas (a045, a050, a068, a080; a075 in the SEAM stratum), and the translator renders them.
  - Translated alone, a leaf's keywords pick up catalogue facts (a monastery name) from the book's metadata (a045, a066, a068, a076, a080).
- **Translator-caused bad pages rise** when the English is made per leaf without context: SEAM 10, CUT 19, REREAD 12.

**Triage (Derek's B), leave-one-book-out, one frame per book:**
- **L2, "the seam read is bad because of the OCR"** (23 of 80): the fitted rule `whole-page read OR leaf asymmetry ≥ 0.4` reaches sensitivity **0.87 (0.68–0.96)** and specificity **0.79 (0.67–0.88)**.
- **"The stored read is a whole-page read"** alone (free metadata) gives 0.87 and 0.86.
- The text-only features add nothing over it. The best are stored lines ≠ ledger lines (0.57 / 0.81) and a near-copied line pair (0.48 / 0.95).
- **L1, "the re-read halves the spans"**, has 5 positives in 55, too few to fit (0.8 / 0.6).

**Engine and cost:**
- HF transformers port: **~200 s per leaf** alone on gex45's card (2,400 × ~800 px input after the production resize; ~4 tokens/s). Six parallel HF processes made it slower (Derek's note 10-26 07:26Z).
- **vLLM 0.29: 2.10 leaves/s**, about 400× faster. That decides the #6871 gutter fix.
- Claude, list-equivalent:
  - translations: CUT $12.73 (178 calls), REREAD $13.00 (185 calls);
  - audit: $44.65 (175 calls);
  - attribution: 50 pages.
- Accounts: started on team@ (over its weekly cap, so it waited), then dereklomas@ (hit 85%), then milolomas200921@ (15% week).
- $0 paid; no Gemini; 0 flash-lite bbox calls.

### What this means
- **Splitting fixes the seam, and only the seam.** Frames read whole-page should be re-read per leaf. Frames already read per leaf gain nothing from a re-read. Cutting a stored whole-page read at its line counts is worthless: the inventions are inside it.
- **A per-leaf lane needs two guards before it runs at scale.**
  - A blank or title-leaf guard: a leaf under a few syllables, or one whose read repeats one formula, is held, as the Paddle split lane does.
  - Keywords must not take facts from the catalogue.
- **The decision pass that preferred the longer read was the cause.** The fix is "never prefer a whole-photo read over its own leaf reads because it is longer", plus the re-read of the 50,946 whole-page photos (about 117K leaves, about 15 GPU-hours on vLLM, $0).
- **Translation still fails #6948's 5% bar on every arm.** The translator's own share (12 of 80 on REREAD) needs its own fix (#6948).
- **Quality Center:**
  - The k-of-n rows are in `scripts/eval/estimator/ocr/failure-observations.jsonl`: `not_of_leaf` per arm, `bad_translation` (not fitted by `failures_v0.py`), and the controls.
  - The Yigdzin GPU route is in `route-costs.json`; the multi-leaf cell volume is in `planner/cells-tibetan-two-leaf.json`.
  - Not done here:
    - The refits (`failures_v0.py` needs the Pareto `ocr-table.jsonl` on cloudlayer; the fits need numpy/numpyro, absent on main).
    - The translation estimator: its likelihood is 1–5 fidelity and these verdicts are 3-class.
    - A routing row: the OCR router has no Tibetan CER chart and the planner no cell input.

### Artifacts
- `scripts/eval/split-leaf-5771/`:
  - `frames.mjs`, `frames.jsonl` (cuts, with every by-eye recut marked);
  - `yig_leaf_read.py` (HF port; crops);
  - `contact.mjs` and `gaps.mjs`;
  - `cut.mjs`, `leaf-translate.mjs`, `packet.mjs`, `run.sh`;
  - `compare.mjs`, `triage.mjs`, `evidence.mjs`;
  - `results/` (compare, triage, labels, 20 by-eye notes, audit score and key).
- Scratch: `$JOB_SCRATCH` on main (`/mnt/HC_Volume_105839809/jobs/split-leaves-5771`): crops, contact sheets, leaf reads (vLLM and HF), translations, audit replies.
- Nothing was written to `pages` or `books`.
- Replicated? No.
