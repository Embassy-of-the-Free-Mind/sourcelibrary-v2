---
stage: ocr
measure: agreement
languages: [grc]
scripts: [Grek]
canons: []
n_books: 4
n_pages: 388
verdict: "FAIL by the preregistered rule: GLM-OCR + LoRA trained on 619 Grec 1839 pages does not read other Greek manuscripts. On T2 its median page CER is 100 % (189/199 pages catastrophic) against 28.6 % for the served text and 35.7 % for flash-lite, and it loses every page to the served text. Its Greek is fluent invention in Proclus' vocabulary, often looping to the token cap. Not a lane."
status: rejected
decision: null
superseded_by: null
issue: [5730, 6871]
---
## 2026-10-23 · Burst 2 scored: the Greek-manuscript LoRA invents fluent Greek and is not a lane (#5730)
<!-- PRIOR ART: 2026-10-22-greek-ms-lora-prereg-5730.md (the preregistration this scores, superseded by this file);
2026-10-04-kraken-latin-ft-5730.md (burst 1, which won in distribution only); 2026-10-20-latin-print-distill-glm-ocr-6871.md
(row D, the same train.py recipe on Latin print). -->

**Verdict (preregistered rule, T2 decides): FAIL on all four conditions. Not a lane.** Greek manuscripts stay with
Gemini (the #6769 Gemini 4 Argon re-read route). Training waits for more hands, as the prereg said it would.

The trained model (F) does not transcribe. Where it writes Greek, the Greek is fluent and accented but invented: a few
words a page match the manuscript, and the rest is Neoplatonist vocabulary from its one training text. On 67 % of test
pages it then loops until it hits the 6,000-token cap. On the T1 spreads it mostly writes an English *description* of the
manuscript instead of a transcription.

The rule was fixed in `greek-ms-lora-5730/PREREGISTRATION.md` (commit fe5cb4b88). gpu-queue task
`62-greek-ms-lora-5730` ran on gex45 from 03:05 to 06:40 UTC on 2026-10-23 and scored itself with the committed `score.mjs`.

### T2: library and text shift (deciding)

Median page CER on view N (Greek base letters), with a 95 % bootstrap CI.

| arm | median CER, view N | 95 % CI | view A | catastrophic (CER > 0.5) |
|---|---|---|---|---|
| **F** GLM-OCR + LoRA | **100.0 %** | [100.0, 344.3] | 100.0 % | **189 / 199** |
| G stock GLM-OCR | 100.0 % | [100.0, 364.8] | 230.9 % | 199 / 199 |
| S served (3-Flash / lite) | 28.6 % | [26.9, 30.1] | 34.4 % | 5 / 199 |
| L flash-lite, generic prompt | 35.7 % | [34.5, 37.8] | 44.0 % | 9 / 199 |

| pair | median Δ (pt) | 95 % CI | F wins / losses |
|---|---|---|---|
| F − S | +77.2 | [68.2, 306.0] | 0 / 199 |
| F − L | +70.3 | [61.7, 300.0] | 1 / 198 |
| F − G | −18.3 | [−36.9, 0.0] | 108 / 63 |
| G − S | +80.0 | [76.1, 333.2] | 0 / 199 |
| G − L | +71.4 | [67.1, 322.4] | 1 / 198 |

Rule checks:
1. F beats S: **no**.
2. F beats L: **no**.
3. catastrophic(F) ≤ catastrophic(S) + 1: **no** (189 against 6).
4. median F < median G: **no** (both 100.0 %).

F − G is the one sign that training did anything: F wins 108 pages and loses 63. Both arms are still unreadable.

**Per book (reported, does not decide).** The deciding score covers Ars sacra (Laurenziana) only, n = 199: F 100.0,
G 100.0, S 28.6, L 35.7. Marcianus gr. 299 dropped out because arm G ran out of time (see the deviation below). With
G removed, all 307 T2 pages score (`results/results-noG.*`):

| set | n | F | S | L |
|---|---|---|---|---|
| Marcianus gr. 299 | 104 | 330.1 % | 33.2 % | 37.5 % |
| Ars sacra | 203 | 100.0 % | 28.6 % | 35.6 % |
| T2 pooled | 307 | 312.3 % [291.8, 340.1] | 30.4 % [29.0, 31.8] | 36.5 % [35.5, 37.8] |

On the full T2:
- F − S is +276.1 pt [257.5, 306.0], and F wins 0 of 307 pages.
- F − L is +270.3 pt [223.7, 295.1], with W/L 8/299.
- F is catastrophic on 296 of 307 pages (S 7, L 24). On Marcianus it hit the token cap on 97 of 104
pages, so its CER runs above 300 %.

### T1: near distribution (Grec 1841, the same work in another hand; reported only)

| arm | median CER, view N | 95 % CI | view A | catastrophic |
|---|---|---|---|---|
| F | 100.0 % | [100.0, 100.0] | 100.0 % | 81 / 81 |
| G | 100.0 % | [100.0, 100.0] | 100.0 % | 81 / 81 |
| S (Gemini 4 Argon low) | 32.7 % | [31.7, 34.5] | 38.0 % | 4 / 81 |
| L | 205.2 % | [193.8, 229.5] | 214.2 % | 74 / 81 |

| pair | median Δ (pt) | 95 % CI | W / L |
|---|---|---|---|
| F − S | +67.0 | [64.5, 68.1] | 0 / 81 |
| F − L | −108.7 | [−129.5, −96.3] | 62 / 17 |
| F − G | 0.0 | [0.0, 0.0] | 14 / 14 |

Rule on T1: fails conditions 1, 3 and 4. Condition 2 passes only because L runs away on these spreads: 70 L pages over
the whole test hit its 16K cap, almost all of them here.

Even in distribution F reads nothing:
- On **63 of 81** T1 spreads its output holds **no Greek letter**.
- On **54** pages it writes an English description, e.g. "This manuscript is a historical document written in Greek,
  likely from the 1st century B.C., and contains texts in Greek, Latin, and Hebrew…".
- Stock G has no Greek on the same 63 spreads: page numbers, or Latin-letter loops such as "neo waiio waiio".

### Where F's output goes wrong (all 388 test pages)

| book | pages | F hit 6,000-token cap | F output with no Greek letter |
|---|---|---|---|
| Grec 1841 (T1) | 81 | 34 | 63 (54 English descriptions) |
| Ars sacra | 203 | 129 | 33 (loops of Ugaritic or Sinhala glyphs) |
| Marcianus gr. 299 | 104 | 97 | 6 |

Stock G hit the cap on 233 of the 280 pages it read.

### By eye: 3 T2 pages, image open against F and S

1. **Ars sacra p. 259** (`69b4c04d978ca9526eda34fa`): 25 lines of a 16th-century minuscule, with heavy abbreviation.
   - **S** follows the page line by line. Its wrong words are wrong guesses at real words (*λαμπρύνουσαι δέξαν θυσίας*
     where the edition has *λευκαινούσας καὶ ξανθούσας*), and it keeps the line breaks.
   - **F** writes one running line of **fluent invention**. A handful of anchor words track the page (*ὕδατι τοῦ θεοῦ*,
     *βάθει τοῦ*, *ποιότητα*, *φθορ-*). Between them are non-words with full accents (*ὑξεναθούς*, *ὑδηβάτηλοῦσιν*),
     and the Proclus words *οὐρανοῦς, νοῦς, θεῶν* appear where the page has none.
   - **Accents:** F accents everything and gives initial υ a rough breathing by habit, so its accents carry no
     information. There are no dropped lines in the sense of a gap; the whole page is replaced.
2. **Marcianus gr. 299 p. 103** (`6a45298cc6d95bc278fbc92a`): about 30 lines in a small, faint, brown hand.
   - **S** opens where the page does (*ται· τὰ δὲ ἐν πεδίω…*) and holds the passage (*τρυγήσαντα … τῆς θαλάσσης*).
   - **F** catches three or four words of the first lines (*τριγήσαντ-*, *ἐκ τῶν νησ-*, *μηλυμη-*). It then drifts into
     *τὸν ἀρατὸν δημιουργὸν τῆς νοητῆς*, the Timaeus commentary it was trained on, and then loops on *ἡμιν ἀνατῶν τὴν
     τῶν ἐστὶν* to the cap. Everything after line 3 is **dropped**.
3. **Ars sacra p. 413** (`69b4c04d978ca9526eda3594`): a 15-line recipe ending with ":-", and below it a blank page with
   show-through.
   - **S** reads the recipe including its quantities (*νίτρον μέρη β̅ … ἅλατος καππαδοκικοῦ μέρη δ̅*).
   - **F** has a few early anchors (*λουλοῦν ὑδαιος* ≈ *λουτροῦ ὕδατος*; *τὰς ὁδὲς τῆς*; *λαμβάνοντας*), then loops on
     *ὅτι ἄπει γε ὄνους* to the cap. The quantities and the last 10 lines are **dropped**.

S is far from clean on these hands, but it is the page's text. F is not.

### Training (`results/train-log.jsonl`, `results/train-summary.json`)

- **Label tokens:** 619 train labels, median 1,548 tokens, max 2,077; **0 over 4,096**, so the cap cut nothing.
- **Loss, first 5 steps:** 2.542, 2.529, 2.463, 2.391, 2.451 (mean 2.475).
- **Loss, last 5 steps (228–232):** 0.668, 0.621, 0.580, 0.536, 0.549 (mean 0.591).
- **Val loss:** 0.728 on 33 pages; smoke gate passed.
- **Run:** 232 optimizer steps (3 epochs) in 6,563 s (109 min); peak VRAM 7,852 MiB.
- The loss fell four-fold and val followed it. The model learned the *edition's* language, not the scribe's letters,
  which matches what it emits.

### Throughput and GPU

- **F:** 388 pages in 2,999 s, **466 pages/h**, 16 clients. 260 pages hit the cap; 1.66M output tokens.
- **Fval:** 33 pages, 530 pages/h.
- **G:** 280 of 388 pages in the 3,000 s `read_arm` timeout, ≈ 336 pages/h. It wrote no `.run.json`.
- **GPU time:** **≈ 216 GPU-minutes** on the owned gex45 card (03:05–06:40), $0. That is train 109, F 50, Fval 4,
  G 50, plus serve start-up. Within the prereg's 6 GPU-h budget.
- **Spend for the whole burst:** flash-lite ≈ $0.60 (arm L, prereg). Nothing else.

### Deviation from the prereg (stated, not corrected)

Arm G ran out of `read_arm`'s 3,000 s timeout after 280 of 388 pages, because it looped to the cap on most pages. By the
committed scorer's rule ("a page counts only if every arm read it"), 108 pages dropped out: all 104 of Marcianus and 4 of
Ars sacra. **The deciding T2 is therefore Ars sacra alone (n = 199), not the two scribes the prereg fixed.**

The verdict does not depend on it:
- Without G, all 307 T2 pages score, and F loses 307/307 to S and 299/307 to L.
- Condition 4 (F < G) is moot when conditions 1–3 fail.

As the brief required, nothing was re-run or retuned.

### Files (`scripts/eval/greek-ms-lora-5730/`)

- `results/results.{json,txt}`, `results/results-pages.json.gz`: the task's own score, as written on gex45.
- `results/results-noG.{json,txt}`: the same `score.mjs` re-run here on F, S and L only (all 388 pages). A check on the
  deviation, not the verdict.
- `reads/{F,G,Fval}.jsonl.gz` and `F/Fval .run.json`. G has no `.run.json`: its timeout killed it before it wrote one.
- `results/train-log.jsonl`, `results/train-summary.json` (from `run/summary.json`), `results/task-progress.log`.
- **Weights stay on gex45, not in git:** `gex45:/root/jobs/greek-ms-lora-5730/run/adapter/` (LoRA) and
  `run/merged/` (merged GLM-OCR + LoRA).

### What this does and does not show

- **It shows** that ~600 pages of one codex, labelled with an edition's running text, do not teach GLM-OCR 0.9B to read
  Greek minuscule. Not in another hand of the same work (T1), and not in other libraries (T2).
- **It does not separate** the reasons the run cannot tell apart:
  - one running line per page (no line structure);
  - edition text rather than a diplomatic transcription;
  - 619 pages for a script the base model cannot read at all (G is at 100 % too);
  - a 0.9B model;
  - no repetition penalty at read time.
- A further burst would need line-level labels, or a base model that already reads some Greek minuscule, and a new
  prereg.
