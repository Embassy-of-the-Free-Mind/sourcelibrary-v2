## 2026-10-02 · Do OCR prompts v18 / v19 stop invented text on white and show-through leaves without declaring real pages blank? Screened, labelled by eye, four arms, Batch, k=3 (#4195, #4149)
<!-- PRIOR ART: 2026-10-ocr-v18-blank-insert run (ocr-v18-ab.mjs, same request and scorer — its stages are imported); prompt-ab.mjs (#4610); blank-page-study.mjs (#3444). None screened on the current model or labelled the strata by eye. -->

**Verdict, by the pre-registered rule: v18.**
- **v18 passes all five clauses.** On white leaves the fabrication rate falls from 0.91 to 0.29. On show-through leaves it falls from 0.68 to 0.55. Real pages are not called blank more often.
- **v19 fails the over-decline guard by 0.009.** Its S3 false-blank rate is 0.381, against a limit of 0.372. That is despite the largest fabrication drop of any arm (W ∪ T 0.78 → 0.35, 36 pages better vs 1 worse).
- **The promote is Derek's call.**

- **Question.** Pre-registered in `PREREGISTRATION-ocr-v19-showthrough.md`, plus Amendment 1, which was written after labelling and before any arm.
  - v19 is v18 plus two sections, **Show-through** and **Document context is not a source**.
  - This run follows up v18's "not established", which was caused by too little signal and S2 labels taken from an OCR claim.
- **Design.** Reference-free outcome rates on W, T and S3, plus windowed CER on S5.
  - **Model:** `gemini-3.1-flash-lite` via Batch, using the production request.
  - **Screen:** one v16 read of 414 pool pages (the #4149 FABRICATED rows plus v0.4 `blank_page`, minus Tibetan/Syriac). 127 pages have > 20 body letters. The screen reads were never reused.
  - **Labels:** 161 images labelled white / show-through / real ink by eye before any arm: 74 / 42 / 45.
  - **Arms:** A = v16, A2 = v16 again (the noise floor), B = v18, C = v19, at k = 3.
  - **Strata:** W 31, T 38, S3 88, S5 38. That is 195 pages and 2,340 requests.
- **Result.** Page means, A / A2 / B / C:
  - **W ∪ T fabricated:** .783 / .780 / .435 / .348. C vs A is 36 better / 1 worse, p 5e-10; B vs A is 29 / 0, p 4e-9.
  - **W fabricated:** .914 / .882 / .290 / .215.
  - **T fabricated:** .675 / .697 / .553 / .456. C vs A is 11 / 1, p .006; B vs A is 7 / 0, p .016.
  - **S3 false blank:** .322 / .318 / .299 / .381. C is worse than B on 11 pages and better on 1 (p .006).
  - **S5 windowed CER:** .102 / .102 / .117 / .137. Median C − A is 0.
  - **Loop rate:** 3.8 / 3.6 / 2.2 / 3.6%.
  - **B vs C on W ∪ T:** 11 / 4, p .12, not significant.
  - **Context echo,** meaning the header or body shares a word with the title or author: 58 / 54 / 28 / 24% of runs. Among runs that still fabricate it stays about 65–72% in every arm. The context section cuts the count of inventions, not their kind.
- **Read against the images (post hoc).**
  - v19's S3 excess is concentrated on leaves where a small right-reading mark (a stamp, a shelfmark, pencil) sits on a mirror-reversed page.
  - There v16 "reads" the mirrored page, which counts as not blank. v19 refuses it and drops the mark, or puts it in `<meta>`.
  - On that subset (20 pages) the false-blank rate is .200 / .217 / .283 / .400. On real-ink pages with no show-through, C is +0.05.
- **Replicated?** No. This is one k=3 run. On the relabelled strata v18 is consistent with its own earlier run: it fixes white leaves, and here it also has a significant effect on show-through leaves.
- **Cost.** $2.72 actual: screen $0.29, arms $2.43. The estimate was $3.29 and the cap $6. One arm-A Batch job came back cancelled with 0 requests processed (cause unknown, $0) and was re-submitted.
- **Next.** v19.1: on a show-through leaf with a stamp or shelfmark, transcribe the mark as text and do not declare the page blank. Re-run on this run's T and S3 pages, which are already labelled.
- **Artifacts.**
  - `scripts/eval/ocr-v19-ab.mjs`
  - `scripts/eval/RESULTS-ocr-v19-showthrough.md`
  - `scripts/eval/results/ocr-v19-ab-2026-10.json`
  - `scripts/eval/results/ocr-v19-ab-2026-10/` (reads, screen reads, pages)
  - `scripts/eval/dataset/ocr-v19-labels.jsonl`
