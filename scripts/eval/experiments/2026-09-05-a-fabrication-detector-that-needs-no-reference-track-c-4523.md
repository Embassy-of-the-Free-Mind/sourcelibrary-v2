## 2026-09-05 — A fabrication detector that needs no reference (Track C, #4523)

- **Question.** Every metric we own compares OCR to a reference. A model that has memorised
  the published text scores *well* on that comparison while never reading the page — Bench 1
  E4 caught one folio where Gemini hit 0.790 against the Derge canon while agreeing 0.33 with
  both specialists' reads of the same image. Production has no reference at all. Can the
  failure be detected without one?
- **Design.** A CTC line recogniser carries no language model over the target text, so it
  cannot recite; two independently-trained ones converging is evidence about the ink rather
  than about any edition. `fabrication-detector.mjs` scores three signals per page — specialist
  convergence (`ink`), VLM-to-ink agreement, and unit overrun — and abstains when the
  specialists do not converge. Every agreement is computed order-sensitively *and* order-free
  (multiset Dice over 3-unit shingles); a page is flagged only when both are low.
- **Validated on two sets with known answers, 349 pages.**
  Positive: Bench 1 Derge Kangyur, 313 folios, two BDRC recognisers + production-era Gemini.
  51 pages carry an externally-established label — Gemini below 0.2 against the canon where
  *both* specialists exceed 0.8, which no reading of the image can produce. Negative: the
  Bench 2 print arms in this repo, Kraken + Surya + Gemini on the same 36 pages.

  **51/51 positives flagged, 0/5 false positives**, and the threshold plateau is wide:
  precision and recall are both 100% for every gap threshold from 0.10 to 0.40. The default
  0.35 sits in the middle of that plateau rather than on a cliff, which is the answer to
  "the guard threshold was picked by hand".
- **Order is not failure — and it nearly cost 8 of 11 print pages.** On the Bekker
  *Categories* page Kraken reads across the gutter of a two-column setting while Surya reads
  down the column: order-sensitive agreement **0.01** between two engines that both transcribe
  it well. Gating on the sequence number sent those pages to INCONCLUSIVE for a layout reason.
  Every quantity is now the better of its ordered and order-free form.
- **The blind spot is the highest-risk population, and it is the real finding.** Recitation and
  specialist failure share a cause: a hard image is what makes a CTC engine fail *and* what
  pushes a VLM onto its memory. So "abstain when the ink is unestablished" silently excuses
  exactly the pages that matter — the seven most flagrant Bench 1 cases (Gemini 0.75–0.98
  against the canon while both specialists scored 0.00–0.16 against it, emitting up to 13.5x
  the units on the page) all sat in INCONCLUSIVE. A canon-anchored rule recovers 9 of them as
  a separate `RECITING?` verdict, reported apart from the verified ones because the
  specialists being broken is a live alternative explanation.
- **Overrun is the famous tell and it is not the useful one.** Across the 203 flagged Tibetan
  pages the median overrun is 0.93x, and only 38/203 exceed 1.6x. The agreement gap carries
  the signal; syllable count catches the spectacular cases only.
- **Coverage is the constraint, not accuracy.** Only 56 of 349 pages are both labelled and
  judgeable. On print, 6 of the 11 pages with a VLM arm are gated out because Kraken and Surya
  genuinely disagree — Copernicus 1543, the ~1490 Malleus, Weigel 1618, Zesen 1645, the
  Poemander apparatus page, Bekker. Two specialists that fail together buy nothing.
- **The validation's own weakness, stated plainly:** the positive and negative classes differ
  in script, medium *and* engine set. Perfect separation between conditions that different is
  evidence the statistic orders known-bad above known-good — not that it discriminates *within*
  early modern print. That needs a print corpus with known fabrication, which we do not have.
- **Artifacts.** `scripts/eval/fabrication-detector.mjs`,
  `results/fabrication-detector-2026-09-05.json`. Bench 1 case files are built from ops
  `eval-tibetan/` + `hetzner:/root/tibetan-eval/pages-*.jsonl` and are not committed here.
