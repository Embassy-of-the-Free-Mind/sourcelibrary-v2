---
stage: ocr
measure: [agreement, accuracy]
languages: [la, grc, de]
scripts: [Latn, Grek]
canons: []
n_books: 148
n_pages: 148
verdict: "On 148 reference pages, disagreement between Flash and Flash-Lite separates pages with over 5% error from clean ones (AUC 0.86 [0.79–0.93]; 23 of 27 bad pages read apart by over 2%). Agreement within 2% left 4 of 94 pages over 5% error: 2 were reference faults, 1 a long s read as f by both models, 1 unresolved."
status: informational
decision: "Results section of the #4916 paper. No lane, route or field changed."
superseded_by: null
issue: [4916, 5313]
---
PRIOR ART: `2026-09-30-does-disagreement-between-two-reads-of-one-page-find-5313.md` scored disagreement against a model judge's label on served pages (rejected as a garble detector, P 0.3–0.45). This entry asks the paper's question against published references instead, on the sealed benchmark's reference tiers.

## 2026-10-30 · Does agreement between two reads predict error against a published reference? (#4916)

**Headline: yes, as a screen, not as a certificate. Disagreement ranks pages by their real error (Spearman 0.69), and
reads that differ by more than 2% catch 23 of 27 pages with over 5% error. Close agreement left 4 of 94 pages wrong; 2
of those are faults in the reference, and the one clear real miss is an error both models share: the long s read as f.**

- **Question.** The paper's core claim is that where no one will check a page, a second independent read is the only
  evidence that the first read the page, and that disagreement finds bad pages while agreement cannot certify good ones.
  Neither half had been measured against ground truth.
- **Design.** The sealed September benchmark's two reference tiers (`ref-ws`, 120 Wikisource-proofread pages, and
  `ref-pinned`, 55 pages), one page per book. Pair: Gemini 3 Flash and Gemini 3.1 Flash-Lite, the two production
  readers, on the identical image (`engine-outputs.jsonl`). Disagreement: whole-page letter Levenshtein between the
  two reads over their mean length, normalised as `benchmark-score.mjs` does. Error: Flash-Lite's reference CER from
  `results/benchmark/*-2026-09-16.json`, aligned pages only. Bad = CER > 5%; agree = disagreement ≤ 2%. Thresholds
  set before the run but not preregistered; the 30 Sept entry's 0.7 token-ratio is a different scale.
- **Result** (`results/agreement-vs-truth-4916-2026-10-30/report.json`).
  - All 148 pages: 27 bad. AUC 0.864 (bootstrap 95% CI 0.79–0.93). Read apart: 23 of 54 bad. Agree: 4 of 94 bad.
  - By language: Latin n=62, 19 bad, AUC 0.85, 4 of 37 agreeing pages bad. Greek n=37, 3 bad, AUC 0.94, 0 of 27.
    German n=34, 1 bad, AUC 0.97, 0 of 29. Armenian, Hebrew, Chinese (ref-pinned) under 10 pages each.
  - The four agree-but-bad pages, read by diff against the reference:
    Kircher, *Turris Babel* p20 and Gauss, *Werke* p21 — **reference faults** (wiki table markup; congruence written as
    LaTeX `\equiv`). *Apocalypsis revelata* p3 — **shared error**: both models read the long s as f in the same words
    (`fed`, `fpiritualis`). *Digeste* p77 — **unresolved**: the misreads are not shared (Flash has `aucta`, `suo`), and
    the rest is headings in the reference that neither read has; they may be marginalia both dropped. Needs the image.
  - Without the two reference faults: n=146, AUC 0.90 (0.85–0.95), agree-but-bad 2 of 92 (Wilson 0.6–7.6%).
  - Dropped: 27 pages where the scorer could not align a read to the reference. On the 10 where one read aligned and the
    other did not, the two reads disagree by over 2% on all 10 (over 50% on 6), so the screen flags every one; leaving
    them out does not flatter it. The 17 where neither aligned have no usable truth (empty outputs, reference mismatch).
  - Chinese stratum excluded: its CBETA references are e-text windows longer than the page, so CER measures window fit.
    On `chinese-15f73d-p10` the two reads are identical and score 35% "error", almost all reference text not on the page.
- **What it does not show.** Flash and Flash-Lite are one model family; the long-s miss is the mechanism by which two
  reads from one family agree on a wrong page, and a cross-family pair should be tested before the claim is generalised.
  Disagreement is over the whole page while error is over the reference passage. Three alphabetic languages carry the
  result; non-Latin scripts beyond Greek are under 10 pages each.
- **Bootstrap.** `makeRng(4916)` from `lib/paired-stats.mjs`. The first run used an inline LCG that #5373 retired; the intervals moved by 0.01 at most.
- **Replicated?** No.
- **Cost.** None (stored outputs).
- **Artifact.** `scripts/eval/agreement-vs-truth-4916.mjs` (run with `--outputs=` the benchmark's `engine-outputs.jsonl`,
  in the paper bundle `sidequests/ocr-quality-paper/data/ocr-benchmark-2026-09/`), results in
  `scripts/eval/results/agreement-vs-truth-4916-2026-10-30/`.
