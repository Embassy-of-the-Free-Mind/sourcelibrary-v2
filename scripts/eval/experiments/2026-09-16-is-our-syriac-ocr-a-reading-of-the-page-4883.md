---
stage: ocr
measure: accuracy
languages: [syc]
scripts: [Syrc]
canons: []
n_books: null
n_pages: 350
verdict: "Gemini Syriac OCR recites rather than reads: 19% of 350 NT 1905 pages carry the right passage at <=10% CER; Isaac and Narsai have no page under 20% CER"
status: superseded
decision: "Withdraw-by-book recommendation replaced the same day by a Kraken lane + withhold by page (#4883, PR #4901)"
superseded_by: "2026-09-16-syriac-retest-do-the-beth-mardutho-kraken-models-read-4746.md"
issue: 4883
---
## 2026-09-16 (logged 2026-09-25) — Is our Syriac OCR a reading of the page? Against published Syriac and published English (#4883)

*Logged late.* The headline was posted on #4883 the same day and drove the Syriac decision;
the report, scripts and per-page artefacts stayed in an uncommitted worktree, and the report's
own "logged in EXPERIMENTS.md" line was never true until now.

- **Question.** The 2026-09-15 benchmark had no Syriac reference and could not tell recitation
  from reading. Does the Gemini OCR of our Syriac books read the scan in front of it?
- **Design.** $0 in model calls, text-vs-text. References are same-edition electronic texts:
  ETCBC `syrnt` (the 1905 BFBS NT exactly), ETCBC `peshitta` (Leiden OT, edition differs from
  our 1913 TBS reprint), Digital Syriac Corpus TEI page-exact for Isaac of Nineveh (Bedjan 1909)
  and Narsai (Mingana 1905), text-exact for Aphrahat (Parisot 1894). Consonantal Syriac only.
  Bible pages classified right / wrong passage / invented by longest increasing subsequence
  over canonical verse order. English for five narrative works scored against public-domain
  published translations with a control work as the null.
- **Result.** NT 1905 (100% `gemini-3-flash-preview`, 0 pages looped): of 350 pages with Syriac,
  **19%** carry the right passage at <= 10% CER; **47%** are wrong passage (14%), text not in the
  Bible at all (17%), or right passage > 50% wrong. Hand-read six against the image, classifier
  right on all six. Isaac, Narsai: median page ~70% CER, **no page under 20%**. English for five
  narrative works: indistinguishable from random alignment with the published translations.
  Loop score flags 0/372 NT and 13/410 Isaac pages: it measures the model (flash 2.2% looped,
  lite 12.4%), not invention. Flash loops less and invents just as much.
- **Recommendation at the time:** withdraw all Syriac-OCR-derived text from "readable" by book.
- **Superseded.** The same day #4883 changed course (retest of the specialist engines, #4746,
  PR #4901): re-transcribe Syriac with Kraken and withhold only looped or unreadable pages
  meanwhile. The Kraken lane has run on Hetzner since 2026-09-18. What still stands from this
  entry: Gemini re-OCR is not a fix for Syriac (it removes loops, not invention), and no
  page-level signal we have separates a recited page from a read one.
- *Replicated?* No; hand checks are one reader's. Reruns in minutes (README). *Artifact:*
  `results/syriac-vs-published-2026-09-16.md`, per-page classes and alignments in
  `results/syriac-vs-published-2026-09-16/`, scripts in `syriac-vs-published/`.
