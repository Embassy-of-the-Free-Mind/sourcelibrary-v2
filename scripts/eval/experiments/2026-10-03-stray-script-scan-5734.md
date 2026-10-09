---
stage: translation
measure: none
languages: []
scripts: []
canons: []
n_books: null
n_pages: 5395496
verdict: "4,913 of 5.4M English pages carry a stray script; Hangul (mostly a 그 for 'that') on 2,689, 2,677 of them from gemini-3-flash-preview, across all source languages."
status: adopted
decision: "2,083 pages repaired; write-time stray-script guard added at every translation writer (Derek, 2026-10-03)"
superseded_by: null
issue: 5734
---
<!-- PRIOR ART: scripts/audit/translation-bridging.mjs counts CJK left untranslated in the English (the source's own script, a different defect); no earlier walk asked which scripts in the English belong to neither the source nor the book. -->
## 2026-10-03 · Which English translations carry a script that belongs to neither the source nor the book? (#5734 part 3)

- **Question.** The Tibetan run wrote Korean 그 ("that") and Chinese tokens into its English (#5734). Is that the run, the model, or the corpus? Where else does it happen, and by which model, lane and source language?
- **Design.**
  - Walk of every `pages` doc with a translation, read-only. 1,362 windows: string `_id`s, then 12-hour ObjectId windows, each checkpointed. One server-side aggregation per window counted pages by book × model × call site and kept the ids that a PCRE prefilter flagged.
  - Each flagged page was then read with its OCR through `strayScripts()` (`scripts/lib/stray-script.mjs`). A letter counts as stray when all three hold:
    - its script is not Latin, Common or Inherited;
    - that script is not in the page's OCR and does not belong to the book's language;
    - it sits outside `<note>`, `<term>`, `<gloss>`, `<unclear>` and the other carrier tags.
  - English translations only. $0, no model calls.
- **Result.**
  - **5,395,496** English pages scanned; **4,913** carry a stray script (9.1 per 10k). Of these, the write-time guard would refuse **3,470**: every script except Greek and Hebrew.
  - **Hangul: 2,689 pages, almost all from one model.** `gemini-3-flash-preview` accounts for 2,677. The other models together have 12: `gemini-3.1-flash-lite(-preview)` 11, `gemini-2.5-flash` 1.
  - The 그-for-"that" defect is not specific to Tibetan. Among the **2,089** pages whose only stray is the 그 pattern, the source languages are Latin 841, English 389, German 246, Dutch 198, Italian 97, Greek 82, and others.
  - **Other strays are mostly real.** In the samples read:
    - Persian سپس ("then") in Latin, German and Greek translations;
    - Russian так, лишь, его, Но;
    - Hebrew כך ("thus");
    - Bengali তাঁর and শ্রেষ্ঠ in Tibetan translations;
    - Han 探究;
    - a katakana ョ for "yo".
  - **Greek (1,032) and Hebrew (425) are mostly legitimate outside tags.** They are variables in mathematical texts (β, γ, Δ), manuscript sigla (א for Sinaiticus), and quotations the OCR transliterated. The write-time guard therefore reports them and does not refuse.
  - **By model (stray per 10k):** `gemini-3-flash-preview` 18.4, `gemini-3.1-flash-lite-preview` 3.6, `gemini-3.1-flash-lite` 2.8, `gemini-2.5-flash` 44.3 (39 of 8,802 pages, mostly Cyrillic and Greek).
  - **By lane (per 10k):**

    | Lane | Stray per 10k | Pages |
    |---|---:|---:|
    | pre-#4613 `source: ai` | 9.2 | 4.7M |
    | `translate-batch-chained.mjs` | 7.7 | 425K |
    | pre-#4613 `batch_api` | 21.2 | 94K |
    | `translate-worker.mjs` | 10.6 | 30K |
- **Decision taken.** Derek approved the work on 2026-10-03.
  - The 그 pattern was repaired mechanically on **2,083** corpus pages. 6 pages went to review.
  - Earlier, the Tibetan envelope got 491 repairs plus a 44-page correction, and the Han/kana hand list fixed 27 pages.
  - A write-time guard was added at every production translation writer. It repairs 그 and refuses any other stray script except Greek and Hebrew.
- **Artifacts.** `scripts/eval/results/stray-script-2026-10-03-5734/` (summary, lane table, review list, applied diffs). Re-run with `scripts/audit/stray-script-scan.mjs`.
- *Replicated?* No; a full-corpus census, not a sample.
