---
stage: ocr
measure: accuracy
languages: [la, en, de, grc, zh]
scripts: [Latn, Grek, Hani]
canons: []
n_books: 288
n_pages: 288
verdict: "Allowing only the conventions the OCR prompt asks for takes early-print CER from 6.6% to 5.5% (Latin) and 6.0% to 5.2% (English); what remains on early English is mostly ſ read as f and refusals, and the long-s retry prompt cuts refusals without adding modernisation."
status: informational
decision: "/quality shows the three numbers per language (this PR); no prompt or routing change"
superseded_by: null
issue: [5939, 5488]
---
## 2026-10-06 · How much of our transcription error is the prompt's own conventions, what is the rest, and does the prompt change it? (#5939)

PRIOR ART: 2026-10-01-what-kinds-of-error-make-up-ocr-cer-5488.md (the classes and the first by-eye check, reused); 2026-10-01-does-a-long-s-prompt-line-fix-early-english-ocr-5488.md (the v16 vs v16 + long-s arms, re-read here from their stored outputs, not re-run); .claude/docs/prompt-history.md (which prompt wrote a page).

**Question.** /quality showed one number per language, a median CER. Split it three ways: raw; after the conventions the live OCR prompt asks for; and the kinds of error that remain. Then split the same three by prompt version, and tag pages that went through the long-s retry.

**What the prompt actually asks (read first, `prompts` v19.1, unchanged on these points since v12).** "ALWAYS expand abbreviations"; punctuation "normalize[d] to standard Unicode"; "Preserve original spelling, capitalization, punctuation"; u/v "Preserve the original form as printed. Do NOT modernize". **No version from v0 to v19.1 says anything about long s.** "Long s written as s" is a habit of the model (v16 never writes ſ) plus the collector's fold after a long-s retry (`scripts/lib/ocr-long-s-retry.mjs` `foldLongS`), not a prompt rule. So the fold here is: abbreviations expanded where the reference keeps them; Unicode NFKC with æ/œ and other ligatures written out; ſ as s (the stored house convention); CJK old/new forms. Not folded: u/v, i/j, capitals, spelling, accents and marks (Greek accents, Hebrew points), ſ read as f, modernisation, refusals, invention.

**Finding about today's number.** The CER /quality shows is not one definition. On Wikisource pages (`lib/metrics.mjs` `SCRIPT_DEFS`) it already folds u/v, i/j, w/uu, æ/œ, & and **every accent, Greek included**, and keeps only a–z (ß and umlauts are dropped). On the sealed strata (`benchmark-score.mjs` `normAlpha`) it folds only case, ſ, punctuation and line-end hyphens. The three numbers below therefore use one scorer for every page (`windowedErrorRate`, letters only), so "raw" here is stricter than the table's existing column.

**Design.** `measure: accuracy`. `ocr-cer-three-ways.mjs` ($0, no model calls). Pages: benchmark arms already on Hetzner (`/root/ocr-bench`, `/root/ocr-bench-5660`): Wikisource same-scan pages (Latin 65, German 30, Greek 24 after the Greek-letter filter), EEBO-TCP same-edition pages (English 58, Latin 15; flash-lite only, flash's outputs are not on the box), Chinese 96 (other editions; CER only). The long-s A/B's six arms (142 pages, 72 books) on windows recut from the public TCP XML (the A/B's own flattener was not committed); the recut reproduces the A/B's refusal pairs exactly (6/4/22, 24/5/4, 23/6/1, 15/9/9) and its v16 long-s word counts within 2 (52, 51, 138). Served text: `pages.ocr` for every one of those pages that is our book, plus latin-period-5126 (82), resolved to its `prompts` row by `prompt_id`, then `prompt_hash` (prompt-history.md lesson 3). Kinds: `ocr-error-classes.py` (now importable; a `--pages` mode with `prompt_rules=True` splits abbreviations, u/v and accents by direction). Not covered: Hebrew and Armenian (passage references only), latin-period-5126's engine arms (outputs not on the box).

**Result 1: per language, flash-lite on the benchmark prompt (the /quality column).**

| language | pages | raw | after the prompt's conventions | ſ→f | refused | modernised | reference wrong | other |
|---|---|---|---|---|---|---|---|---|
| Latin (WS + EEBO) | 80 | 6.6% | 5.5% | 22% | 19% | 1% | 5% | 53% |
| English (EEBO) | 58 | 6.0% | 5.2% | 38% | 40% | 1% | 1% | 20% |
| German (WS) | 30 | 0.7% | 0.7% | 2% | 25% | 4% | 0% | 69% |
| Greek (WS) | 24 | 1.4% | 1.4% | 0% | 22% | 0% | 0% | 78% |
| Chinese (other editions) | 96 | 26.7% | 25.6% | — | — | — | — | — |

Kinds are shares of the classified error weight (characters of the affected words), a ranking, not a CER. Flash: Latin 4.3% → 1.9%, German 0.2%, Greek 0.9%, Chinese 20.9% → 19.4%.

**Result 2: by prompt, the same 142 EEBO pages (long-s A/B arms).**

| arm | prompt | refused | raw | after conventions | after, answered pages |
|---|---|---|---|---|---|
| A / A2 (flash) | v16 | 28 / 26 | 7.9% | 6.5% | 5.3% |
| B (flash) | v16 + long-s line (the refusal retry) | 9 | 8.9% | 5.6% | 5.0% |
| LA (flash-lite) | v16 | 24 | 7.7% | 6.3% | 5.3% |
| LB (flash-lite) | v16 + long-s line | 7 | 8.0% | 5.2% | 4.8% |
| LC (flash-lite) | v16 + "write it as s" | 18 | 7.8% | 5.6% | 5.1% |

- The retry line is visible as a change in two kinds. Refusals fall about 70%, exactly as reported. The raw CER *rises* (B 8.9%, against A's 7.9%) because the arm writes ſ, which the fold removes.
- ſ read as f falls less than the A/B reported on these recut windows. Flash-lite's classified ſ→f weight goes 880 → 760 characters (−14%) on pages both arms answered, and its word count 140 → 117, where the A/B had 138 → 85. Flash goes 379 → 348. The gap is window placement on a few pages: one page (`6a42ec40…:18`) is read in "f-mode" by B, not A.
- **Modernisation does not rise with the long-s line:** 447 → 456 characters on flash-lite, 347 → 370 on flash, against a noise floor of 327 vs 325 (A vs A2).
- **Served text by prompt** (alphabetic pages, each counted once): v12 29 pages, 7.4% → 6.8%; v14 74, 8.4% → 6.8%; v15 46, 8.5% → 7.9%; v16 7, 9.4% → 7.5%; v19.1 1; 124 pages carry only a label no prompt row matches. The ſ→f share falls from v12 (15%) to v15 (0.3%). Modernisation is 4–5% of the error under every version.
  - Version and engine are confounded here: v14 and v15 pages are flash, v16 pages are flash-lite. Read this as what readers are served, not as a prompt comparison.
- **Long-s retry pages: none.** No served page in these sets went through the retry, and only **1** batch job corpus-wide has ever been sent with `prompt_variant: long-s-glyph`. The tag exists (`ocr.prompt_variant`), but there is nothing to show separately yet.

**Hand-check** (`results/ocr-cer-three-ways/hand-check-2026-10-06.md`). 45 examples, one per book, across all kinds, each read against the scan, plus 10 more "misreads" from the benchmark pages.
- **The reference was wrong in 9 of 55**: TCP keying slips, TCP gaps the engine read through, and TCP regularising VV→W and I→J.
- Kinds that held up: ſ→f 4/5, refusals 5/5, modernisation 4/5, reference defects 4/5.
- Kinds that did not: "invented or recited" 0/5 (all printed footnotes, margin notes or turn-overs the engine placed where they are printed); omissions 2/5; misreads 5/15. These three are shown together as "other" on /quality.
- Both checked capital differences were real engine errors, which is why case stays unfolded.

**Implication.**
- On early print the prompt's own conventions are worth about 1 point of CER. What remains is two things the long-s retry already targets (ſ→f and refusals), plus a large "other" that is half layout.
- Two follow-ups: score with one definition everywhere (the table's column folds Greek accents); and teach the classifier that a `<margin>` placed before its paragraph is not an insertion.

**Replicated?** Partly: the A/B's refusal pairs, exactly; its long-s counts on v16 arms within 2. **Artifact:** `scripts/eval/ocr-cer-three-ways.mjs`, `results/ocr-cer-three-ways/three-ways-2026-10-06.json`, `hand-check-2026-10-06.{md,json}`. Cost $0.
