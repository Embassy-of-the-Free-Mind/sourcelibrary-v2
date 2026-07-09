# First-Translation Gold Standard — Annotator Brief

*One page. Read before you start. Companion to `scripts/output/ft-gold-annotator.html`.*

## Why this exists

Source Library's AI pipeline has flagged ~5,700 books as **"first English
translation"** — a public badge on the book page. A "first translation" is a
*negative-existence* claim ("no prior English translation of this work exists"),
which is exactly the kind of claim an automated pipeline gets wrong in
predictable ways. We are measuring how often the badge is actually correct.

Your hand-labelled verdicts on a **150-book stratified random sample** are the
*gold standard*: they (a) give us a defensible corpus number ("~N ± M genuine
firsts, not 5,700") and (b) calibrate the cheap AI adjudicators so they can scale
to the rest. Machine and heuristic labels were ~21% wrong in the pilot — that is
why a human pass is the binding step. **You are the ground truth.**

## The one question

For each book: **does a prior *English* translation of *this work* already exist?**

- "This work" = the specific text, not a related or parent work. A translation
  of a *different* work by the same author does not count. A translation from a
  *different source language* does not count (the **source-language rule**:
  Ficino's Latin Plato ≠ an English-from-Greek Plato).
- The book we hold may itself be the **original-language facsimile** (a Latin /
  Greek / Tibetan / Chinese scan). That is still a valid first-translation
  *candidate* — judge whether an English translation of that work exists, not
  whether the book in hand is in English.

## The seven verdicts

| Verdict | Use when |
|---|---|
| `first_no_prior` | No prior English translation found anywhere — a genuine first. |
| `first_from_source` | English of the work exists, but from a **different source language**; this specific text/version was not previously Englished. |
| `first_complete` | Only **partial / excerpt** English exists → this is the first *complete* one. |
| `first_modern` | Only an **antiquated (pre-1900)** English exists → this is the first *modern* one. |
| `not_first` | A complete modern English translation of this text **already exists**. |
| `not_applicable` | **Not a translatable single work**: visual art / plates / maps, a pure reference list (sales catalogue, library index), a work already written in English, or a multi-work container/anthology (*Opera Omnia*, *Theatrum Chemicum*). |
| `unverifiable` | You genuinely **cannot determine** it from competent sources (common for catalogue-blind traditions). Don't guess — this is a valid, expected answer. |

The first four all count as "genuine first" in the analysis; `not_first` and
`not_applicable` are the false positives; `unverifiable` is carried as its own
honest category (bounds, not a point estimate).

## How to use the tool

1. Open `ft-gold-annotator.html` in a browser. Type your name at the top (it
   tags your export).
2. For each book: read the title/author/language, then click the **search
   links** — WorldCat, Google Books, Internet Archive, Scholar, plus
   tradition-specific catalogues that appear for the language (84000 / BDRC /
   Lotsawa House for Tibetan; CTEXT / CBETA for Chinese; GRETIL for Sanskrit;
   Perseus for Greek/Latin). The book title links to its Source Library page so
   you can confirm what the held text actually is.
3. Pick a verdict. **Record the prior** (translator, year, title) when you found
   one — that evidence is as valuable as the verdict. Set your **confidence** and
   jot the **sources you checked** in Notes. "Searched WorldCat + 84000, nothing"
   is a real, citable result.
4. **Anti-anchoring:** the AI's guess stays hidden until *after* you commit a
   verdict, then you may reveal it (reference only — don't change your answer to
   match it). This keeps your labels independent so we can measure human↔model
   agreement honestly.
5. Verdicts auto-save in the browser. When done (or at a good stopping point),
   click **Export labels** → it downloads `ft-gold-labels-<yourname>.json`.
   **Email that file back** (or drop it in `scripts/eval/results/`).

## Two practical notes

- **Pace / honesty over speed.** ~150 books; budget a few minutes each. A
  confident `unverifiable` beats a guessed `first_no_prior`. If a book is a
  container or art, `not_applicable` is a 5-second call — don't over-search it.
- **Non-Western strata need a specialist.** The Tibetan (15), Chinese (12),
  Sanskrit/Indic (12), Semitic/Near-East (12) cells are where Western catalogues
  go blind and where the pilot's error was worst. If you are not comfortable
  judging those traditions, **label the Western cells (87 books) and leave the
  non-Western ones for a tradition specialist** (Tibetanist / sinologist) — the
  tool lets a second annotator export their own file and we merge them.

## After you export

Run `node scripts/eval/score-gold-standard.mjs ft-gold-labels-<name>.json`
→ stratified base rate + Wilson CI, corpus projection, and (with a second
annotator's file) Cohen's κ. A **second annotator on a ~40-book overlap** gives
us the agreement number the paper needs — worth doing even if only on the
Western cells.

---
*Sample: 150 books, 7 strata (Western-sparse 55, Western-dense 32, Tibetan 15,
CJK 12, Semitic/NearEast 12, Indic 12, Other 12), drawn from a population of
5,696 flagged-first books. Tooling: PR #2614. Analysis trail: issue #2564.*
