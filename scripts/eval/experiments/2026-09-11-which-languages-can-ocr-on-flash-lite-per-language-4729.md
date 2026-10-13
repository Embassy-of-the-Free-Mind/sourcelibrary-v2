---
stage: ocr
measure: agreement
languages: []
scripts: []
canons: []
n_books: null
n_pages: null
verdict: "Of 14 languages with a verdict, German, French and Dutch (routed lite) did not pass and Russian and Armenian (routed flash) did; Latin and Italian were never sampled."
status: undecided
decision: "Routing unchanged (ledger: UNJUDGED); editing the allowlist awaits Derek (#5090)"
superseded_by: null
issue: [4729, 4735]
---
## 2026-09-11 (logged 2026-09-25) — Which languages can OCR on flash-lite? Per-language suitability vs the script-family allowlist (#4729, #4735)

*Logged two weeks late.* The run finished on 2026-09-11 in a worktree whose session died
before committing; the result never reached an issue, this log, or main, while the allowlist
it tests kept routing production. Landed as found, with the disclosed post-run metric
amendment (PREREGISTRATION, Amendment 6).

- **Question.** `LATIN_SCRIPT_LANGUAGES` (translate-core.mjs) sends a language's OCR to
  flash-lite by script family. Is each listed language actually safe on lite?
- **Design.** Preregistered (`PREREGISTRATION-per-language-ocr-suitability.md`). One page per
  book, up to 20 books per language, lite and Cloud Vision each scored against production
  flash on the same page. Rule, fixed before the run: lite allowed iff median character
  agreement with flash >= **0.956** (letters+marks; calibrated so 0.956 = 1 pp CER on the
  pinned set), catastrophic (loop/empty) <= 10%, **zero** invented pages (judge), coverage >= 80%.
  Spend: Gemini $4.35, judge $0.07, Vision 206 units.
- **Post-run amendment (disclosed).** First scoring used `agreementPrimary()`, whose word
  tokenizer shreds combining marks and read Devanagari/Syriac/Ethiopic as ~0 (the
  non-latin-text-operations failure shape). Primary metric switched to character agreement and
  the threshold re-derived by the same pre-declared procedure. Both metrics are stored per page.
- **Result (lite verdict).**

  | language | n | lite agr | catastrophic | verdict | allowlist today |
  |---|---:|---:|---:|---|---|
  | English | 17 | 0.996 | 1 | allowed | lite |
  | Russian | 19 | 0.996 | 0 | allowed | **flash** |
  | Portuguese | 18 | 0.994 | 1 | allowed | lite |
  | Spanish | 18 | 0.972 | 0 | allowed | lite |
  | Armenian | 17 | 0.963 | 0 | allowed | **flash** |
  | German | 19 | 0.972 | 1 | flash only: 1 invented page (veto) | **lite** |
  | French | 20 | 0.951 | 0 | flash only: agreement < 0.956 | **lite** |
  | Dutch | 17 | 0.921 | 0 | flash only: agreement < 0.956 | **lite** |
  | Chinese | 19 | 0.932 | 4 | flash only | flash |
  | Arabic | 15 | 0.929 | 0 | flash only | flash |
  | Greek | 19 | 0.918 | 0 | flash only | flash |
  | Ge'ez / Sanskrit / Syriac / Tibetan | 19-20 | 0.47 / 0.38 / 0.25 / 0.22 | 9 / 6 / 8 / 11 | flash only | flash |
  | **Latin, Italian** | 0 | - | - | **undecided: sampler drew no scorable page** | lite |

  Cloud Vision passed no language (consistent with the 2026-09-11 Vision entry below).
- **What it says about production.** Three languages on the lite lane today did not pass
  (German, French, Dutch); two on flash did (Russian, Armenian). **Latin, the bulk of the lite
  lane, was never measured** here; the sampler returned no scorable Latin or Italian page,
  which is itself a defect to fix before any re-run.
- **Caveats.** n = 15-20 pages per language, one run. French missed the bar by 0.005; German
  failed on a single judge-flagged page. Agreement with flash is not accuracy: where flash is
  itself weak (Greek, see 2026-09-21) a language can "fail" by disagreeing with a wrong
  reference. Treat the verdicts as the case for a decision, not the decision.
- **No routing change made.** Editing `LATIN_SCRIPT_LANGUAGES` moves pages between the
  $0.86/1K and $3.50/1K lanes; that call belongs to Derek.
- *Replicated?* No. *Artifact:* `results/per-language-suitability-2026-09-11.{md,json}`,
  raw outputs `...-raw-2026-09-11.jsonl`, judge calls `...-judge-2026-09-11.jsonl`, sample
  `...-sample-2026-09-11.json`, calibrations `...-calibration{,-charM}-2026-09-11.json`, Tibetan
  sub-run `...-tibetan-2026-09-11.jsonl`; runner `per-language-suitability.mjs`.
