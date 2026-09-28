# OCR and translation decisions — the ledger

PRIOR ART: `scripts/eval/EXPERIMENTS.md` — the append-only RUN log (what was measured, newest first); `results/benchmark/decisions/*.json` — machine-readable rule outputs per run. Neither says what we currently DO per stratum, who decided, or when to re-measure. This file does. Design: `.claude/docs/eval-design.md` §10.

**How to read a row.** One row per stratum × question. *Evidence* names the cell (result file or store cell id), its `measure` (only `accuracy` is quality), and the grade in referenced books (exploratory < 30, directional ≥ 30, decision ≥ 50). *Rule output* is what the preregistered rule said. *Decision* is a human's — Derek's comment or merge — with its date; "rule output" alone is not a decision. *Applied in* is the PR that changed routing, a lane or a withholding rule; empty means production is unchanged. *Re-measure when* is the trigger that reopens the row.

**How to add a row.** When a run lands (§9 landing rule), add or update the row in the same PR as the `EXPERIMENTS.md` entry. Never edit a decided row's evidence; add a new row and mark the old one `superseded by <row>`. Current routing constants: `LATIN_SCRIPT_LANGUAGES` in `scripts/lib/translate-core.mjs` (OCR: Latin-script → lite, else flash; translation: lite everywhere since #4762).

## OCR engine per stratum

| Stratum | Question | Evidence | Rule output / proposal | Decision | Applied in | Re-measure when |
|---|---|---|---|---|---|---|
| English print 1800–1930 | lite adequate, or flash? | #5182 · PR #5248 · `en-flash-5182-2026-09` vs `en-ocr-ref-5124-2026-09` · accuracy · **decision (114 books)** · flash 14 / lite 3 / tie 75, median Δ 0.00 pp; refusals lite 14.9 %, flash 17.5 % (14 of 16 shared); A-vs-A floor: 3/20 pages flip text↔refusal | Both fail the ≤ 2 % catastrophic bar on RECITATION refusals; switching models fixes nothing → **keep lite; add a refusal-fallback lane** | PENDING Derek (2026-09-28) | — | the lite or flash model version changes; a refusal fallback ships |
| English IA imports (Archive text vs lite) | may the Archive's own OCR replace a paid lite read? | #5124 / #5186 · PR #5216 · accuracy · 122 books, S3/S4 directional · lite 57 / Archive 5 / tie 43 (p < 0.001); Archive misreads ≈ 1.5 % of printed numbers, lite 0 of 750 | Archive earns no cohort; lite stays default; Archive text = provisional at import + fallback on a lite refusal | DECIDED Derek 2026-09-26 (#5186) | verify: import-time hold + fallback lane status on #5186 | a date-dense Archive cohort is proposed; Archive OCR engine changes |
| German, French, Dutch (Latin script, routed lite) | may they stay on lite? | #5090 · `per-language-suitability` · **agreement** with flash 0.972 / 0.951 / 0.921 · not accuracy | Agreement cannot settle it; accuracy cells needed (#5124 French, German refs exist externally only) | UNJUDGED (routing unchanged: lite) | — | French/German accuracy cells reach directional |
| Latin 1500–1799 | does lite degrade on early print / long-s (#4877)? | sealed `latin-pre1700`, `latin-1700s` have **no reference** (proxy only); external Wikisource pages: flash ≈ 0.7 % vs lite 3–5 % CER (not library pages) | Directional at best; references first (#5126) | UNJUDGED (routing unchanged: lite) | — | #5126 lands ≥ 30 referenced books per century |
| Russian, Armenian (non-Latin, routed flash) | correct on flash? | #5090 · agreement with flash 0.996 / 0.963 | consistent with flash; no accuracy cell | no change | — | an accuracy cell exists |
| Chinese manuscript-regular | PaddleOCR-VL-1.6 as cost lane? | #4743 / #4925 · `results/benchmark/decisions/cost-lane-chinese-2026-09-18.json` · accuracy (Kanripo/CBETA) · **decision (69 books)** | cost lane ADOPTED (within margin of lite; not a "better reader") | rule output 2026-09-18; Derek's application decision: verify on #4743 | verify (#4743) | Paddle version changes; woodblock reaches 50 |
| Chinese woodblock, typeset | same | same file · woodblock 14, typeset 6 referenced | directional only — no lane decision | UNJUDGED | — | references reach 50 (#4925 step 1) |
| Greek 1450–1699 | lite / flash / Kraken per period (#4744) | `results/benchmark/decisions/greek-period-*-2026-09-21.json` · accuracy (Perseus/First1K, canonical-dependent) · **decision (56 books)** | Kraken passes the cost-lane rule and reads better than lite; flash passes | rule output 2026-09-21; no routing change (Greek is on flash) | — | non-canonical Greek references exist; Kraken model changes |
| Greek 1700–1799 | same | same · decision (53 books) | Kraken REJECTED; lite-b (repeat) and flash pass | no change (flash) | — | as above |
| Greek 1800–1899 | same | same · 5 referenced | directional only | UNJUDGED | — | references reach 30 |
| Syriac (print and MS) | Gemini or the Kraken lane? | #4883 / #5093 · `syriac-vs-published` · accuracy vs published editions (canonical, recitation-risk high) · 1905 NT: 19 % of pages hit the right passage at ≤ 10 % CER; Gemini recites | **Never re-OCR Syriac with Gemini**; Kraken lane on Hetzner | DECIDED Derek (#4883, 2026-09) | PR #5081 (apply un-held 2026-09-25); 72 % read 2026-09-28 | Kraken model changes; the mixed-page withholding line (6,234 withheld / 1,313 shown) is a separate pending decision |
| Tibetan (dbu-can print, MS) | lite OCR trustworthy? | #4523 · Kanjur ground-truth pilot 2026-09-01: BDRC 0.88 vs Gemini 0.41 median identity vs Derge e-text; lite fails ≈ ⅓ of the corpus (loops, wrong script, recitation passing e-text checks at 96 %) | lite unusable as a reader; Yigdzin per-leaf re-read | DECIDED Derek 2026-09 (#4523) | Yigdzin apply wave 1 + per-leaf re-read (2026-09-27); 1,439 books HELD pending retranslation | remainder 17,843 pages (DECISIONS-PENDING) |
| Japanese pre-1868 (kuzushiji), Meiji+ | NDL lane size (#4745)? | sealed `japanese`, `japanese-ext` · 155 pages run · **0 references** | UNJUDGED | — | — | references exist (#4925 step 3) |
| Hebrew Rashi script | is Rashi OCR usable (#350 closed unmeasured)? | 4 Hebrew references, all square script | UNJUDGED | — | — | #5125 lands ≥ 30 referenced pages |
| Sanskrit, Arabic, Korean, Persian, Ge'ez, Pali | — | 0 references each | UNJUDGED | — | — | gap table (`eval-design.md` §11) |

## Translation

| Stratum | Question | Evidence | Rule output / proposal | Decision | Applied in | Re-measure when |
|---|---|---|---|---|---|---|
| All non-Latin-script books | translation on lite instead of flash? | #4759 · observational 137 books, 303 paired pages + blind judge on 30 · **preference/agreement**, not accuracy · no comprehension failure on lite; 0 lite fabrications vs 5 flash (confounded by looped OCR input) | route translation to lite (≈ $12K/yr) | DECIDED Derek 2026-09 (#4759) | PR #4762 (commit 6edf9b4c) | a source-grounded fidelity judge (#5104 method) is run on this split |
| Tibetan retranslation (1,439 held books) | worth ≈ $430, and which engine? | #4742 · engine flash chosen 2026-09-25 (PR #5094 live for non-held books) · A/B vs 84000 human translations never ran | teed up; not approved | PENDING Derek (LOW priority per Derek) | — | the 84000-referenced A/B runs (#4925 step 7) |
| Prompt v15 (verified notes) | flip v13 → v15? | #4767 · PREREGISTRATION-translation-prompt-v15 · verified-note rate 67 → 96 % but interpretive notes −36 %, body −26 % (2 loop outliers) | DO NOT FLIP; v16 next | DECIDED (rule) 2026-09-12 | — | v16 A/B; #4777's fixed verifier re-scores v15 |
| Batch API lane (#4681) | move translation to Batch (50 % cheaper)? | PR #5086 / #5104 · fluency judge tie 19–18 but source-grounded fidelity: production ahead 25–18; repair echoes source, drops carried text | no flip | DECIDED (rule) 2026-09-25 | echo + short gates PR #5089 | page-break fix (#5103) lands, then re-judge |
| Page-break fix F0 (#5103) | ship the device-break repair? | 2 rounds, $0.94 · F0 halves device-break defects 71 % → 42 %, dup at production level | flip candidate; option default OFF in code (#5111) | PENDING Derek: chain #5169 ← #5171 ← #5170 review-gated | #5111 (code, OFF) | measured in 8-page block shape |

## Other lanes

| Lane | Question | Evidence | Rule output / proposal | Decision | Applied in | Re-measure when |
|---|---|---|---|---|---|---|
| Image extraction model (#4747) | lite instead of flash (rests on 5 pages from 2026-03)? | none yet · proposed 400-page test, ≈ $2 | rule pre-stated (recall ≥ 95 %, IoU ≥ 0.7 on ≥ 90 %) | PENDING Derek's yes to spend | — | the test runs |
