---
stage: ocr
measure: [judged, accuracy, agreement]
languages: [de]
scripts: [Latn]
canons: []
n_books: 58
n_pages: 58
verdict: "Preregistered 2026-10-31, before any open-model read was scored, judged or looked at. Results are not in yet."
status: undecided
decision: "None yet. Whether to add an open-model draft arm to the german-blank-fraktur cell, and whether to fine-tune (phase 3), are Derek's (#7845); this test gives the measured defaults."
superseded_by: null
issue: [7845, 7701, 7835, 7824, 5730]
router_evidence: "none — preregistration only"
defect_rates: "none — preregistration only: nothing judged yet"
---
## 2026-10-31 · Fraktur: can an open OCR model trained on 1500–1750 print read our Fraktur, and was Kraken's 0/18 a segmentation failure? (#7845)

PRIOR ART:
- `2026-10-30-german-cheaper-first-reads-7701.md` and `scripts/eval/route-judge-6740/german-cheaper-7701/run.mjs`: the 18 Fraktur pages, their read@4 / LightOnOCR / PERO / Kraken texts and Opus verdicts, `gpuAloneWritten` (what a GPU-alone route would write), the wrong-page and planted controls, the score. Reused; the new harness is a copy cut to these arms.
- `scripts/eval/route-judge-6740/judge.mjs`: `judgePrompt` and the `judge` stage, unchanged (Opus `claude -p`, page image, blind, one text a call, paced by `claudeBlocked`).
- `scripts/eval/route-judge-6740/defect-rate.mjs` `words()`: the #7824 word count for wrong text per 1,000 words.
- `2026-10-31-fraktur-paired-7835.md` and `scripts/eval/fraktur-paired-7835/lib.mjs`: the T3 DTA page draw (seed 78353), its references (`tei-pages-v1`), `levelCers` (Level 2 diplomatic, Level 1 normalised) and the fold-WER leaf guard, unchanged. Its PERO draft of each T3 page (arm c's draft) is the phase-2 comparator.
- `2026-09-03-bench-2-complete-can-self-hosted-ocr-replace-gemini.md`: the source of the "segmentation" lead (read again below).

Code: `scripts/eval/route-judge-6740/fraktur-models-7845/` (lands with the results; nothing in it decides anything this file does not fix here).

### Why

German print with no OCR is read by agy Flash-low, 4 pages a call (#7752). About 83% of it is Fraktur (141/170 by eye, #7701). Open engines failed on these pages: LightOnOCR 2/18, PERO 3/18, Kraken `austriannewspapers` 0/18 accepted (wrong text on 17/18). But both trained models came from the wrong period (19th-century newspapers; Czech newspaper microfilm). The survey on #7845 names models trained on 15th–19th-century print. If one reads our Fraktur well, the first read of about 140K pages could be nearly free, or a cheap draft in front of the Flash correction.

### What bench-2 actually measured (read before this test, not a result of it)

The issue's lead says the same Kraken model scored 98.5–99.8% on three early Fraktur pages in bench-2. The bench-2 file says otherwise. The 98.5–99.8% on 1618/1645/1772 belongs to **Surya and CHURRO**. Kraken `austriannewspapers` got 95–99% "on 1618/1645, decaying with era distance". Its per-page rows (`observations/ocr-observations-2026-09-03.jsonl`):

| page | year | Kraken austriannewspapers |
|---|---|---|
| Weigel | 1618 | 95.9% raw, not aligned (word guard 0.45) |
| Zesen | 1645 | 94.8% (CER 5.2%) |
| Herder | 1772 | 84.3% raw, not aligned |
| Hegel, Logik | 1812 | 99.0% |
| Humboldt | 1845 | 98.1% |

So on early print the model was already at about 5% CER in bench-2. On a 300-word page that is about 15 wrong words, which the judge does not accept. The two results do not conflict, and the lead needs no segmentation failure to explain it. It is still tested below, because the same rows cannot rule it out.

Also checked before any scoring: the 18 #7701 Fraktur pages are **single pages, not spreads** (width/height 0.57–0.80, by the stored image sizes). So "blla on whole spreads" cannot be what happened. Whether blla cut the lines badly on single pages remains open.

### Pages

- **Phase 1.** The 18 Fraktur pages of the #7701 frame (`results/german-cheaper-7701-2026-10-30/sample.json`, `script_face: fraktur`), the same image bytes the judge saw there. The **gate set** is the 15 of them that read@4 wrote (13 accepted there, 0 wrong text).
- **Phase 2.** #7835 T3's DTA-matched pages (`frame.mjs t3-draw`, seed 78353; 40 pages, 16th c. 1, 17th 8, 18th 10, 19th 21) with their typed-page references. I wait for #7835's T3 files rather than build references myself. If they are not on the box when phase 1 ends, I run #7835's own `t3-draw` (its code and seed, read-only) into this job's scratch and check that it yields the same 40 page ids whose images #7835 already holds on gex45. Face comes from #7835's T3 tags. The primary stratum is Fraktur; Antiqua pages are reported apart.

### Arms (all zero-shot, CPU on gex45, nothing trained)

The card is held by another tenant's vLLM (20.7 of 24.5 GB, 100% busy at 10:54Z), so every arm runs on CPU, 8 threads.

**One segmenter (S1)** for every arm except the segmentation test: kraken 7.1.1 `blla` with its default model (`blla.mlmodel` shipped in kraken 7.1.1), on the stored page image, no split. The same baseline segmentation and the same dewarped line crops (`kraken.lib.segmentation.extract_polygons`) go to every recogniser, in blla's reading order. A page's text is its lines joined by newlines.

**The second segmenter (S2)** for the segmentation test: kraken 7.1.1's legacy box segmenter (`kraken.binarization.nlbin`, then `kraken.pageseg.segment`, defaults), which shares no model and no code path with blla.

| arm | recogniser | weights (sha256 of the file downloaded 2026-10-31) | source | licence as found |
|---|---|---|---|---|
| **a** | Calamari 2.3.1, `deep3_lsh4`, 5 checkpoints voting | `deep3_lsh4.tar.gz` e68d22e41d1d33ee7681e7199ff4f0221f5bd862b4bb1f4c7341d39495fd15e7 | github.com/Calamari-OCR/calamari_models_experimental release v0.0.3; Reul et al. 2021, doi 10.1145/3476887.3476910 | MIT (repo) |
| **a2** | Calamari 2.3.1, `deep3_fraktur-hist`, 5 voting | `deep3_fraktur-hist.tar.gz` 0be64a5189563de44c39bedc02a0b1b422de63790b4e4d7d5c815cad56ede52e | same release; refined from LSH-4 on historical Fraktur (README) | MIT (repo) |
| **b** | Calamari 2.3.1, `fraktur_historical` (GT4HistOCR Fraktur parts), 5 voting | `fraktur_historical.tar.gz` 49ac046b40fa3c97fdd973055caa2f2b2332010bd08f0bccb2aaa599c4730111 | github.com/Calamari-OCR/calamari_models release 2.2 (listed by OCR-D); GT4HistOCR doi 10.5281/zenodo.1344132 | MIT (repo); data CC BY 4.0 |
| **c1** | Kraken 7.1.1, `austriannewspapers.mlmodel` v2 on S1 | 376a3aa7af40161913bfbf25a799943ca1497cb9360f2cc18e6f3ea0e7feb069 (md5 = Zenodo's) | doi 10.5281/zenodo.7933402 (UB Mannheim) | CC BY-SA 4.0 |
| **c2** | the same model on **S2** | same | same | same |
| **d** | Kraken 7.1.1, `McCATMuS_nfd_nofix_V1.mlmodel` on S1 | dfb911ba25fd11f93efc1b0c340957162981ecfdaac0ee1e26793d491f770244 (md5 = Zenodo's) | doi 10.5281/zenodo.13788177 | CC BY 4.0 |
| **e** | Kraken 7.1.1, `CATMuS-Gothic-Print-1.0.0.mlmodel` on S1 | f088ab5322840273bee686c5275b9b30ea5d6cb188f428af15ea47d0618452e1 (md5 = Zenodo's) | doi 10.5281/zenodo.10599911 | CC BY 4.0 |

Two departures from the issue, both decided before any read:
- **Arm b is not "GT4HistOCR 1.0".** The OCR-D resource `qurator-gt4histocr-1.0` lives only at qurator-data.de. On 2026-10-31 that host failed TLS on this box (a Let's Encrypt "Root YE" chain the box does not trust). With a verified chain it returned HTTP/2 protocol errors, then empty replies. It is also a Calamari 1.x model (OCR-D: `version_range >= 1.0.0, < 2.0.0`). The control is the Calamari-2 GT4HistOCR Fraktur model that OCR-D lists for Calamari ≥ 2.0. It keeps the question the control asks: does LSH-4's in-period training add anything over a GT4HistOCR model?
- **Arm a2 is added.** The same release ships a Fraktur model refined from LSH-4. It costs one more pass on the same lines.

The #7701 Kraken run (blla through the `kraken` CLI, same model and version) stays in the tables as **c0**, with its verdicts as judged there. Nothing is re-judged.

### Outcomes

**Phase 1 (the 18 pages).**
- **Written.** What a GPU-alone route would write: `gpuAloneWritten` from #7701, unchanged (≥ 30 word characters, no 4× repeated line).
- **Judge.** Opus blind accept against the image (`judgePrompt`, task ocr, German, unchanged), with its defects. The outcome is wrong text per 1,000 words (#7824 `words()`), pooled per arm.
- **Agreement (screening, not accuracy).** On the 13 pages where #7701's read@4 was accepted with no wrong text: each arm's Level-1 CER against that accepted read (`levelCers`, #7835). It is labelled "agreement with an accepted Flash read". It decides nothing.
- **Speed.** Seconds a page on 8 CPU threads, for segmentation and for each recogniser, and pages an hour.

**Phase 2 (T3 DTA pages).**
- Per arm: mean Level-2 (diplomatic) and Level-1 (normalised) CER, median Level-1 CER, with a page-bootstrap 95% CI (one page a book, 4,000 resamples).
- Paired against the stored Flash-Lite text and against #7835's PERO draft of the same image (the draft #7701's pero>agy@4 route corrected: 9/13 Fraktur accepted).
- A page where nothing aligns (stored lite and every arm over the fold-WER 0.35 guard) is excluded and counted.

### Judging, rounds and controls

- **Budget.** At most 160 Opus calls, counted from the verdict file. Pace: stop at weekly ≥ 85% or 5-hour ≥ 95%; never probe after a limit.
- **Rounds.** Round 1 judges every arm on the first 6 gate pages (seeded shuffle of the 15, `makeRng(78451)`). An arm continues to round 2 (the other 9 gate pages) only while it can still reach the gate, i.e. fewer than 5 gate pages not accepted or with wrong text. Round 3 (the 3 non-gate pages) runs only for arms that pass the gate. An arm stopped early is reported as "failed the gate in round r at k/n", not as an accept rate over 18.
- **Controls.**
  - Wrong-page: 4 in round 1 (this page's image, another book's text from a seeded arm, `makeRng(78452)`), then 2 for each arm that enters round 2.
  - Planted: 2 on #7701's accepted read@4 texts of the round-1 pages (kinds B and C, `plantError`, `makeRng(78453)`), and 2 on any arm's accepted text if one exists.
  - The judge is valid here when every wrong-page control is refused at fidelity ≤ 2 and at least 3 of 4 plants (or 2 of 2) are caught.

### Gate and what follows

- **Gate (the issue's).** An arm passes when it is accepted on ≥ 11 of the 15 gate pages with no wrong text on any of them, and its controls pass.
- **A passing arm** gets the draft > agy-flash-low correction on the 18 pages. That is #7567 arm C's shape through `cli-ocr.mjs read --gpu-draft` and the GPU-draft apply with `--diff-guard=gpu-draft`, dry. It is judged blind the same way and compared paired with read@4 and lighton>agy@4 (11/14).
- **If no arm passes,** no correction arm runs. Phase 3 (fine-tuning) is not started. Its plan, with GPU hours and engineering days, goes to Derek as a DECISION.

### The segmentation finding (rule fixed here)

Three measurements, reported together:
1. **Line coverage.** On the 13 accepted pages: lines found by S1 and S2 against the body lines of the accepted read@4 text. A ratio under 0.9 or over 1.2 on a page marks that page as mis-segmented.
2. **Same lines, other models.** c1 against a, a2, b, d and e on S1 (judge, and phase-2 CER). If a different model on the same lines reads much better, the lines were not the failure.
3. **Same model, other lines.** c1 (S1) against c2 (S2) and c0.

- **Segmentation was the failure** if c2 (or c1, through this pipeline's crops) lifts austriannewspapers from c0's 0/18 to ≥ 6 accepted, or halves its phase-2 mean Level-1 CER relative to c1.
- **The model was the failure** if neither happens and the line coverage of S1 is within 0.9–1.2 on ≥ 11 of the 13 pages.
- Anything else is reported as mixed, with the numbers.

### Write-back

None. Read-only throughout: no page, revision or route is written, no cron or routing change. Every quality figure is given with its n, interval and date.

### Seeds

| purpose | seed |
|---|---|
| gate-page order (rounds) | 78451 |
| wrong-page controls | 78452 |
| planted controls | 78453 |
| bootstrap | 78454 |

### Amendment 1 (2026-10-31, before any judge call or CER score)

- **Arm b would not run.** On every one of its 5 checkpoints, Calamari 2.3.1 with `fraktur_historical` (calamari_models 2.2) returns blanks and stray marks: one checkpoint on 3 lines gave `'    '`, `'ũ'`, `'DT¶¶ n'`.
  - It does the same on crops cut from the nlbin image (same S1 polygons). So it is not the input form the model card names ("normalized grayscale").
  - Its whole-page drafts are 45–296 bytes, against 574–2,869 for LSH-4 on the same lines.
  - Its codec has 131 symbols, of which the only digits are 3 and 4. That suggests a checkpoint for a narrower subcorpus than the OCR-D description says.
  - b is **not judged**. Its phase-2 CER is computed and reported as "did not run", not as a reading.
- **Arm b2 replaces it as the period control.** `deep3_fraktur19` is from the same release as LSH-4 (calamari_models_experimental v0.0.3, MIT), with the same deep3 network and 5 voting checkpoints. It is trained on 19th-century Fraktur. sha256 of `deep3_fraktur19.tar.gz`: eb933c4ee5ea85435edf1e18abfb2c5ef97cab8abcbcd6f193a775e6a603d7aa. It reads the same S1 crops.
  - The question the control asks stays the same: does in-period training (a, a2) beat a model of the 19th-century bulk?
  - b2 enters the judging rounds like every other arm.
- **CPU, not the GPU queue.** Derek's note (11:27Z) asks for GPU work to go through `/root/gpu-queue` ahead of the OCR filler, with CPU only where that is not possible. All arms stay on CPU:
  - The Calamari venv is TensorFlow 2.15 CPU (no build here has kernels for this Blackwell card).
  - The Kraken arms read a page in about 4 s on 6 threads and the Calamari arms in about 7 s on 8, so both phases together take under an hour of CPU.
  - Pausing production OCR on the card for that would cost more card time than it saves.
  - Speed is therefore reported as CPU pages an hour, with the thread count.
