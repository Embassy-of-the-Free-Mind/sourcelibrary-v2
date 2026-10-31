---
stage: ocr
measure: [judged, accuracy, agreement]
languages: [de]
scripts: [Latn]
canons: []
n_books: 58
n_pages: 58
verdict: "No open model trained on 15th–19th-century print reads our Fraktur well enough to be a first read, or a better draft than the one we already have. Every arm failed the gate in round 1 (Opus, 6 gate pages each, 2026-10-31): Calamari LSH-4 0/6 accepted, wrong text on 4/6 (4.6 wrong-text defects per 1,000 words); the LSH-4 Fraktur model 1/6; the 19th-century control 0/6; three Kraken models 0/6 with wrong text on 6/6 (20–31 per 1,000 words). Against DTA references on 35 Fraktur pages, LSH-4 is at 9.6% Level-1 CER (median 3.9%), worse than PERO's draft (5.8%; paired +3.8 points, 95% CI 1.5–6.3) and stored Flash-Lite (2.9%). Kraken's 0/18 in #7701 was the model, not segmentation: the pages are single pages, blla's lines match the printed lines, LSH-4 reads the same lines with half the errors, and a second segmenter made Kraken far worse (+44.5 points CER)."
status: rejected
decision: "No open-model draft arm for the german-blank-fraktur cell: none passes the gate, and as a draft for the agy correction LSH-4 is worse than PERO and LightOnOCR, both already tested (#7701). Phase 3 (fine-tuning LSH-4 on DTA lines) is not started; its plan and cost are a DECISION for Derek (recommended: no, for now)."
superseded_by: null
issue: [7845, 7701, 7835, 7824, 5730]
router_evidence: "none — no arm passed the gate; every arm was stopped in round 1 (6 of 15 gate pages judged), so no unbiased accept rate exists to export"
defect_rates: "scripts/eval/route-judge-6740/results/fraktur-models-7845-2026-10-31/defect-rates.json"
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

### Amendment 2 (2026-10-31, after round 1 was judged; Calamari arms only)

- **What went wrong.** Round 1 was judged at 12:10–12:25Z on 42 items. After that I found that the line crops fed to the Calamari arms (a, a2, b2) were wrong for Calamari. `kraken.lib.segmentation.extract_polygons` fills everything outside a line's polygon with black.
  - Kraken models are trained on exactly those crops (ketos cuts training lines the same way), so the Kraken arms read what they expect.
  - Calamari inverts and normalises its input, so the black corners read as heavy ink. On one page LSH-4 gave "gach dea nu dent Liebhaber"; on the same polygons with the outside filled, it gave "nach dem nun der Liebhaber".
  - Round 1's Calamari verdicts (a, a2, b2: 0/6 each) therefore measure the harness, not the models. They are kept in the results and reported as such.
- **The fix.** The same S1 polygons, one extraction, with the outside of each polygon filled with the line's own paper tone (the 90th percentile of the grey values inside it), as OCR-D's `image_from_segment` fills a segment's background (`kraken_arms.py paperlines`). The Calamari arms on these crops are **aw, a2w, b2w**.
- **Judged afresh.** aw, a2w and b2w are judged from round 1 under the unchanged rules, rounds, gate, seeds and controls, in their own packet (4 wrong-page controls, 2 planted on round-1 read@4 texts). Nothing else changes.
- **Kraken arms stay as judged.** Round 1 judged them on their own crops: c1, c2, d and e were each 0/6 with wrong text on all 6. All four stop, as the round rule says.
- **Arm b still does not run** on the filled crops (whole-page drafts 225–1,291 bytes of stray letters), so it stays unjudged (Amendment 1).
- The judge's validity in round 1 (4/4 wrong-page refused, 2/2 plants caught) carries over to this amendment's packet, which has its own controls.

## Results (2026-10-31)

Code: `scripts/eval/route-judge-6740/fraktur-models-7845/` (`kraken_arms.py`, `calamari_arms.py`, `run.mjs`). Results: `route-judge-6740/results/fraktur-models-7845-2026-10-31/` (scores, keys, verdicts; the DTA reference texts are not copied).

**The judge was valid** in both packets.
- Wrong-page controls: 4/4 and 4/4 refused at fidelity ≤ 2.
- Planted errors on read@4 texts: 2/2 and 2/2 caught (kinds B and C, both named).
- Opus calls: 71 (48 in round 1, 23 for Amendment 2), under the 160 budget. No agy call was made for reading. The 40 phase-2 face tags were #7835's tagger, one agy flash-low call a page.

### Phase 1: the 18 #7701 Fraktur pages, round 1 (6 gate pages each)

**No arm passes the gate. Every arm failed at least 5 of its 6 round-1 gate pages and stopped** (round rule). So step 4, the draft > agy correction, was not run.

| arm | crops | accepted | wrong-text pages | wrong text / 1,000 words | misleads / 1,000 words | agreement with accepted read@4, L1 CER mean (median), 13 pages | CPU s a page: segment + read (threads) | pages / hour, one process |
|---|---|---|---|---|---|---|---|---|
| **aw** LSH-4 | paper-filled S1 | 0/6 | 4/6 | **4.6** | 24.5 | 11.5% (5.6%) | 14.7 + 9.1 (8) | 151 |
| a2w LSH-4 Fraktur | paper-filled S1 | **1/6** | 4/6 | 8.0 | 22.0 | 11.9% (7.0%) | 14.7 + 6.8 (8) | 167 |
| b2w 19th-c. Fraktur | paper-filled S1 | 0/6 | 6/6 | 20.7 | 25.5 | 14.4% (8.2%) | 14.7 + 6.8 (8) | 167 |
| c1 austriannewspapers | S1 | 0/6 | 6/6 | 20.3 | 39.9 | 15.7% (10.2%) | 14.7 + 6.4 (6) | 171 |
| c2 austriannewspapers | **S2** | 0/6 | 6/6 | 57.1 | 6.7 | 69.2% (66.9%) | 4.4 + 3.4 (6) | 459 |
| d McCATMuS | S1 | 0/6 | 6/6 | 30.6 | 38.0 | 30.4% (26.5%) | 14.7 + 4.8 (6) | 184 |
| e CATMuS Gothic Print | S1 | 0/6 | 6/6 | 26.4 | 52.1 | 19.5% (13.8%) | 14.7 + 4.2 (6) | 191 |
| *a, a2, b2 (harness bug, Amendment 2)* | black-filled S1 | 0/6 each | 6/6 each | 38.6, 62.6, 39.3 | | 24.5%, 43.3%, 24.9% | | |
| *b fraktur_historical* | either | not judged (did not run, Amendments 1–2) | | | | 97% | | |
| context: c0 (#7701 Kraken, its own verdicts) | blla via CLI | 0/18 | 17/18 | | | 15.7% (10.2%), identical to c1 | 2.8 (#7701 basis) | |
| context: LightOnOCR / PERO (#7701) | | 2/18 / 3/18 | 10/18 / 7/18 | | | 5.7% (3.4%) / 12.1% (4.6%) | | |

- **Agreement is not accuracy.** It is measured against Flash's accepted read, which expands and normalises some forms, so its floor is above zero. It decides nothing.
- **n is 6 pages an arm.** At 0/6 the one-sided 95% upper bound on the accept rate is 39%; at 1/6 it is 58%. Both are below the gate's 73% (11/15).
- **How the open models fail, in the judge's words.** Single misread letters that make non-words or other words: "genug" read as "gelig", "Fluxionibus … Flüssen foviert" as "Axionihus … Küſſen foriert". Numbers: the section mark "§. 9." as "17", a page number 54 as 34. A word fragment at the top of a page left garbled ("(or)dinari Zeit" as "den ri Ʒeit"). Running-head ornaments ")o(" read as stray lines ("6", "V7").
  - A line recogniser has no page model and no language model, so each of these is a wrong word the judge must count.
  - LSH-4's errors are the fewest of the open arms: 4.6 wrong-text defects per 1,000 words against 20–31 for Kraken. But 4 of its 6 pages still carry wrong text.

### Phase 2: CER against DTA on #7835 T3's 40 pages

The draw was run by me (`frame.mjs t3-draw`, #7835's code and seed, read-only) because #7835's files were not on gex45. It gave the same 40 page ids as #7835's images. Faces from #7835's tagger: 35 Fraktur, 5 Antiqua. Excluded for leaf or edition: 0.

Fraktur, n = 35 pages (one a book). Level-1 (normalised) and Level-2 (diplomatic) CER, mean; page-bootstrap 95% CI on the Level-1 mean:

| arm | L1 mean | L1 95% CI | L1 median | L2 mean |
|---|---|---|---|---|
| stored Flash-Lite | **2.9%** | 1.0–6.1 | 0.8% | 6.9% |
| PERO draft (#7835 arm c's) | 5.8% | 2.6–10.8 | 2.3% | 7.7% |
| **aw** LSH-4 | 9.6% | 5.3–15.4 | 3.9% | 10.9% |
| b2w 19th-c. Fraktur | 10.1% | 5.9–15.6 | 4.9% | 11.4% |
| a2w LSH-4 Fraktur | 10.9% | 6.2–16.9 | 3.9% | 12.2% |
| c1 austriannewspapers (S1) | 11.5% | 7.0–17.2 | 6.7% | 12.7% |
| e CATMuS Gothic Print | 17.3% | 13.5–22.1 | 13.4% | 21.1% |
| d McCATMuS | 27.1% | 23.6–31.4 | 23.7% | 29.3% |
| c2 austriannewspapers (S2) | 56.0% | 48.8–62.9 | 62.3% | 56.5% |

Level 2 sits above Level 1 for the Flash-Lite read (6.9% against 2.9%) because Flash modernises ſ and the e-umlaut. The line recognisers keep ſ, so their two levels are close.

**Paired, Fraktur, Level 1** (difference = first minus second; negative = first better):
- LSH-4 against PERO: +3.8 points (95% CI +1.5 to +6.3); PERO better on 25 of 34 pages.
- LSH-4 against stored Flash-Lite: +6.7 points (+2.3 to +11.9).
- LSH-4 against Kraken c1: −1.9 points (−3.0 to −0.9); LSH-4 better on 25.
- LSH-4 against the 19th-century control b2w: −0.5 points (−1.4 to +0.5).

**By period (Fraktur, L1 mean):**

| pages | n | Flash-Lite | PERO | LSH-4 | 19th-c. control | Kraken c1 |
|---|---|---|---|---|---|---|
| before 1700 | 8 | 4.1% | 8.6% | 10.8% | 14.4% | 16.3% |
| 1700s | 10 | 5.7% | 10.6% | 14.6% | 13.9% | 15.7% |
| 1800s | 17 | 0.7% | 1.7% | 6.1% | 5.8% | 6.8% |
| before 1750 | 10 | 3.3% | 7.4% | 9.3% | 12.7% | 13.9% |

On the 10 pre-1750 Fraktur pages, in-period training helps as the survey predicted: LSH-4 beats the 19th-century model by 3.4 points (95% CI 2.5–4.2). But it is still not better than PERO (+1.9, CI −1.0 to +6.5), and it is 6 points worse than Flash-Lite.

Antiqua (n = 5, too few to rank): LSH-4 6.6%, Kraken c1 7.3%, PERO 2.4%, Flash-Lite 5.6%.

### The segmentation finding

**The Kraken 0/18 in #7701 was the model, not the segmentation.** By the preregistered rule the result is formally "mixed": the coverage clause is 9/13 against the 11/13 it asks for. The 3 pages that miss it are a defect of the proxy, explained below.

1. **No spreads.** The 18 pages are single pages (width/height 0.57–0.80).
2. **bench-2 never showed the model reading early Fraktur well.** The 98.5–99.8% belonged to Surya and CHURRO. Kraken `austriannewspapers` was at 94.8–95.9% on 1618/1645 there.
3. **Same model, other lines.** The legacy segmenter (S2) makes it much worse, not better: 0/6 with 57.1 wrong-text defects per 1,000 words, and +44.5 points Level-1 CER on DTA (95% CI 37.8–51.1, worse on 35/35).
   - Through this pipeline, blla gives exactly #7701's text. Agreement and judge are identical to c0.
   - No segmentation lifted it to ≥ 6 accepted.
4. **Same lines, other models.** On blla's lines, LSH-4 makes a quarter of Kraken's wrong text (4.6 against 20.3 per 1,000 words) and less CER (−1.9 points on DTA). The lines carry the text; this model misreads it.
5. **Line coverage.** blla's line count is within 0.9–1.2 of the accepted read's on 9 of 13 pages.
   - On 3 of the other 4, the read itself wrote 6–8 reflowed lines for 23–35 printed ones. The proxy cannot measure those pages.
   - The fourth is a bloodletting calendar table at 1.23.
   - Where the read keeps line breaks, 9 of 10 are in the window.

### Speed and cost

All on CPU on gex45 (the card was held by production OCR; Amendment 1).
- blla segmentation is the slow step: 14.7 s a page on 8 threads.
- Reading takes 4–9 s.
- One process reads 150–190 pages an hour. Three in parallel on the box's 20 threads would read about 500 an hour, with no API cost.
- That cost advantage does not matter while no arm writes an accepted page.

### What it means

- **No open model trained on early print is a usable first read of our Fraktur today.** The best one (LSH-4) writes wrong words on most pages.
- **As a draft in front of the agy correction it is not the best open draft either.** On DTA it is worse than PERO's draft (+3.8 points), and on agreement worse than LightOnOCR's. Both PERO and LightOnOCR already have measured draft > agy routes in #7701 (9/13 and 11/14 on Fraktur).
- **Kraken's failure is the model's period**, as the survey suspected, not blla.
- **Fine-tuning (phase 3) is not started.** Its plan and cost are below and go to Derek as a DECISION.

### Phase 3, the plan if Derek wants it (not run)

- **Data.**
  - #6012's DTA same-edition books with congruent pages: 87 books, of which ~60 for training and ~25 held out whole.
  - blla lines on each congruent page. DTA's page text is aligned to the lines with the windowed aligner (`metrics.mjs`), keeping lines whose own CER is under 10%.
  - About 500 pages, or 10–20k lines.
- **Training.** LSH-4 fine-tuned with Calamari, as in Reul et al.
  - On this box's CPU (the TF build here has no Blackwell kernels): about 1–2 days of 8 threads.
  - Or 4–8 GPU-hours, after installing a TF build that supports the card.
  - Segmenting the pages: about 2 CPU-hours.
- **Engineering.** 1–2 job-days for the aligner and the training scripts.
- **Evaluation.** About 100 Opus calls on held-out books, the same gate. $0 in API spend.
- **Expected effect.** The literature's 30–50% CER reduction would take LSH-4 from 9.6% to about 5–7% Level 1 on our Fraktur. That is about PERO's draft today, and far above the ~1% at which the judge accepts a page.
- **Recommendation: not now.** Revisit if a self-hosted Fraktur reader is needed for a reason other than first-read cost (e.g. a Gemini outage plan, or #5730's own-model track).
