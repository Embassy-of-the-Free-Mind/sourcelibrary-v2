---
stage: translation
measure: judged_vs_reference
languages: [pi]
scripts: []
canons: [pali]
n_books: 6
n_pages: 6
verdict: "The translation-vs-reference harness passes its controls with two blind Opus judges on 6 Pali pages (weighted kappa 0.90); an instrument check, not a finding."
status: informational
decision: null
superseded_by: null
issue: 5695
---
<!-- PRIOR ART: 2026-10-02-translation-flash-vs-lite-sanskrit-pali-chinese-5606.md (same Pali references and arm outputs, judged with the #4742 rubric); this record is the instrument check of the new #5695 harness on six of those pages, plus the served arm. -->
## 2026-10-03 · Smoke run of the translation-vs-reference judge harness: do the controls pass on six Pali pages? (#5695 step 0)

- **Question.** Before five tracks rely on `scripts/eval/translation-vs-reference/`, do its built-in controls pass with two blind Opus judges? Does it produce every output the tracks need (CIs, invention by kind, quoted reversals, span, gallery)?
- **Design.**
  - 6 Pali pages from 6 books, taken from the #5606 sample. References are Bhikkhu Sujato's (SuttaCentral bilara-data, **CC0**), style `literal`, `canonical: true`.
  - Three arms: **served** (`pages.translation.data`, read-only, all `gemini-3.1-flash-lite`; same OCR hash as the A/B source on 6/6 pages), and #5606's **flash** and **lite** batch outputs.
  - One control page per type: wrong page, planted meaning change (a negation dropped in flash's p. 179), duplicate pair (served p. 147).
  - Two Opus subagents, each with its own label shuffle and item order (seed 5695). Gate chunk first, then main. $0 API.
- **Controls (gate passed, both judges).**
  - Wrong page: scored 1 by both.
  - Planted change: caught by both. Each quoted the planted sentence ("one does speak of purity through views") against the Pali "No ce kira diṭṭhiyā…" and scored it 3, against 4 for the unplanted flash.
  - Duplicate pair: tied for both.
  - Judge agreement: exact fidelity 16/18 cells, within one point 18/18, weighted κ 0.90.
- **What the run shows (n = 6, an instrument check, not a finding).**
  - Mean fidelity (CI): flash 4.42 (4.08–4.75), lite 4.25 (3.67–4.75), served 3.67 (3.00–4.00). Flash beat served on 6/6 pages (sign test p 0.031).
  - The served lite English differs from the A/B lite run of the same model on the same OCR. It carries next-page text on 2/6 pages (`boundary` 0.33; span `extends_after` on 4 judge-pages), which looks like the chained lane's continuity leak (T5). On p. 179 it has one reversal that both judges quoted independently: "I sought inner peace and saw nothing" for *ajjhattasantim pacinaṃ adassaṃ* ("seeking inner peace, I saw").
  - Two judge-pages call the reference cut `wrong`. On p. 306 the #5606 aligner matched SN 46.3 (seven awakening factors), a parallel formula, where the page is SN 51.25–27. The harness reports a `fit:usable` stratum for this reason. The #5606 Pali reference for that page should not be reused unchanged.
  - Flash's `added_fact` 0.92 (notes, by design) and `gloss` 0.42 are separated from fabrication; `unreadable_fill` is 0 for all arms.
- **Changes after the first pass.** The judge reasons are now decoded from T-labels to arm names. Notes, glosses and term echoes are stripped from gallery quotes. The `fit:usable` stratum was added.
- **Files.** `scripts/eval/results/xlref-harness-smoke-2026-10/` (records, packet + key, verdicts, results.json, gallery.md).
- *Replicated?* No. This is an instrument check on 6 pages.
