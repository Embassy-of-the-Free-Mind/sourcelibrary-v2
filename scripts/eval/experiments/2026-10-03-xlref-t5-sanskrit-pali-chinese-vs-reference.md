## 2026-10-03 · How faithful is the served English for Sanskrit, Pali and classical Chinese against published human translations, what causes the bad pages, and which lever helps? (#5695 track T5)

**Question.** Against a published English translation of the same passage: how faithful is what readers see now, is a bad page an OCR error or a translation error, and which cheap lever moves it beyond run-to-run noise? Absorbs #5606 (Flash vs Lite), whose 57 pages, references and three arms are reused here.

**Design.**
- **Reference set: 68 pages from 68 books, one page per book, every reference open** (publishable: 68/68).
  - 57 pages from #5606 (PR #5625). The Pali p. 306 reference was re-cut (it was a parallel sutta). 11 pages were added for T5 from **non-canonical** works: Suśruta, Caraka, Sūrya Siddhānta, Līlāvatī, Hitopadeśa, Pañcatantra, Kāmasūtra; Liaozhai ×2, Honglou meng, Sanguo yanyi.
  - Pali 16 (Sujato / Brahmali, SuttaCentral, CC0). Sanskrit 28 and Chinese 24 (36 translators, 1817–1930, US public domain: Thibaut, Bühler, Legge ×10, Giles, Burgess, Colebrooke, Ryder …).
  - 46 canonical (scripture or a classic whose standard English is everywhere online) / 22 non-canonical. Reference style: 57 literal, 11 free.
  - Excluded: one bilingual page (it prints Legge's English), two books with no locatable page. Recorded in `work/excluded.json`.
  - 64 of the 68 pages have a served translation. Every served translation was made from the OCR the judges saw (`ocr_sha` matches on 64/64).
- **Census** (books' cached counters, 2026-10-03): translated pages Chinese 134,665 · Sanskrit 109,625 · Pali 13,423.
- **Judges.** The shared harness `translation-vs-reference/` (PR #5702): two blind Opus judges, fidelity 1–5 against source + reference, omission, reversal, invention by #5622 kind. **Gate passed for both judges on all three packets** (wrong page 3/3, planted change 3/3 located, duplicate 3/3 tied). Agreement on the main packet: exact 78 %, within one point 99.6 %, weighted κ 0.82 (n = 491 cells).
- **Arms on the same pages** (prompt v13, single-page, the production generationConfig; Gemini metered on the `gemini_usage` ledger through `gemini-script-client`, envelope `xlref-t5`):
  - `served` (what readers see); `lite`, `lite2` (the production model twice = **X1 noise floor**); `flash`; `flash-think` (thinkingBudget 2048); `lite-ctx` (continuity seeded with the served translation of the previous page); `lite-check` (Flash checks Lite's negations, numbers, roles and omissions and fixes them, one pass); `opus` (**X3 ceiling**, 20 pages, the v13 prompt file as the whole instruction).
  - Second packet, **X2 thinking**: `flash` vs `flash-thinkon` (no thinkingConfig = the model's dynamic thinking).
  - Third packet, **corrected OCR** (Addendum 3): `lite-corr`, `flash-corr` translate a by-eye corrected transcription; all arms there are judged against the corrected text.
- **By-eye cause pass.** For the 20 served pages scored ≤ 3 and 10 random others, an Opus reader opened the served page image (cut into overlapping tiles) and typed each judged defect: OCR misread / translation / page seam / reading order / language label, quoting the image reading.
- **Six-dimension pass** (Addendum B): one Opus judge, separate from fidelity, served and reference shown blind as X / Y.

**Result 1 — the served English** (n = 64; fidelity is the mean of two judges).

| stratum | n | fidelity [95 % CI] | pages ≥ 4 | omission | reversal | text from the next/previous page |
|---|---|---|---|---|---|---|
| **all** | 64 | **3.63 [3.42, 3.82]** | 58 % [46, 69] | 52 % | 10.9 % | 18 % |
| Chinese | 22 | 3.75 [3.41, 4.04] | 64 % | 36 % | 13.6 % | 2 % |
| Pali | 15 | 3.67 [3.23, 4.07] | 60 % | 43 % | 13.3 % | 30 % |
| Sanskrit | 27 | 3.50 [3.19, 3.78] | 52 % | **69 %** | 7.4 % | 24 % |
| canonical | 43 | 3.66 [3.41, 3.91] | 58 % | 44 % | 11.6 % | 17 % |
| non-canonical | 21 | 3.55 [3.24, 3.86] | 57 % | 67 % | 9.5 % | 19 % |
| reference literal | 53 | 3.67 [3.45, 3.89] | 60 % | | | |
| reference free | 11 | 3.41 [2.86, 3.96] | 45 % | | | |
| edition 1800–1899 | 22 | 3.64 [3.36, 3.91] | | | | |
| edition 1900–1949 | 14 | 3.57 [3.11, 4.04] | | | | |
| served by Flash (older Sanskrit/Chinese) | 12 | 3.96 [3.62, 4.29] | | | | |
| served by Lite | 52 | 3.55 [3.32, 3.77] | | | | |

- 20 of 64 pages (31 % [21, 43]) score ≤ 3. Editions before 1800 have n < 10 and are not reported.
- Sanskrit's low score is mostly **omission**: on root-plus-commentary pages the English keeps the verses and condenses or drops the printed commentary (Kumārasambhava, Gīta Govinda, Meghadūta).

**Result 2 — levers, against the noise floor** (same 68 pages; paired differences).

| arm | fidelity [CI] | reversals / 100 pages | omission | $ / page (Batch) | paired Δ fidelity | beyond the floor? |
|---|---|---|---|---|---|---|
| lite (production) | 3.74 [3.54, 3.93] | 15.4 [8.1, 23.5] | 40 % | $0.00084 | — | — |
| lite2 (**A-vs-A**) | 3.68 [3.51, 3.86] | 14.0 | 42 % | $0.00083 | −0.05 [−0.20, +0.13] vs lite | **this is the floor** |
| **flash** | **4.13 [3.99, 4.27]** | **5.9 [1.5, 11.8]** | 25 % | $0.00178 | **+0.40 [+0.22, +0.58]** vs lite; +0.45 [+0.30, +0.60] vs lite2 | **yes** (46 wins / 10 ties / 12 losses) |
| flash again (the budget-2048 arm) | 4.21 [4.06, 4.35] | 6.6 | 24 % | $0.00184 | +0.07 [−0.06, +0.21] vs flash | Flash's own A-vs-A |
| lite + previous-page context | 3.75 [3.57, 3.93] | 19.1 | 35 % | $0.00091 | +0.01 [−0.16, +0.22] | no; boundary text +12.5 pp [4, 21] |
| lite + Flash check-and-fix | 3.90 [3.72, 4.05] | 10.4 | 29 % | +$0.00167 | +0.12 [+0.02, +0.22] | no (inside the floor's CI); Flash alone beats it by +0.22 [0.07, 0.37] |
| opus (ceiling, 20 pages) | **4.88 [4.75, 4.98]** | 0 | 0 % | subscription | +0.85 [0.57, 1.12] vs flash; +1.27 vs served and lite, same 20 pages | yes |

- **Flash vs Lite by language.** Sanskrit +0.38 [0.11, 0.64] (floor −0.05 [−0.23, 0.12]), reversals −14 pp [−29, −2]. Chinese +0.33 [0.17, 0.50] vs lite and +0.52 [0.35, 0.71] vs lite2 (floor −0.19 [−0.38, 0.00]), reversals −10 pp [−21, −2]. Pali +0.53 [0.03, 1.16] (floor +0.16 [−0.25, 0.78]): directional, n = 16.
- Flash's cost: more text from the neighbouring page (+7.4 pp [0.7, 14.7]) and more added notes (54 % of pages vs 27 %). Fabricated fill of unreadable source is the same (13 % vs 12 %).
- **X2 thinking.** `thinkingBudget: 2048` billed thinking on 1 of 68 pages (2 tokens): a budget is a ceiling, not a request, so that arm is a second plain Flash run. With the model's dynamic thinking (2,118 thinking tokens per page, all 68 pages): fidelity +0.12 [−0.01, +0.25], reversals 6.6 → 2.9 per 100 pages (−3.7 pp [−10.3, +2.2]), 32 wins / 16 ties / 20 losses (p = 0.13). Cost $0.0050 per page, 2.8× Flash. **Not beyond Flash's A-vs-A.** Chinese alone: +0.23 [0.04, 0.44].
- **X3 ceiling.** Opus with the same v13 prompt and input: 4.88, no omission, no reversal, no fabricated fill on 20 pages. The gap is the model, not the prompt. Same-family caveat below.

**Result 3 — cause of the bad pages (image opened).**

| primary cause | pages ≤ 3 (n = 20) | 10 random others |
|---|---|---|
| translation | 12 (60 % [39, 78]) | 6 |
| OCR misread | 6 (30 % [15, 52]) | 3 |
| page seam | 2 (10 % [3, 30]) | 0 |
| reading order / language label / reference or judge | 0 as primary (≤ 16 %) | 0 |

- Per judged defect on the low pages (n = 98): translation 60 %, OCR 31 %, seam 8 %, reference-or-judge 1 %.
- At least one OCR error verified against the image on 29 of 30 pages; it is the main cause on 9.
- **With the OCR corrected** (27 pages, judged against the corrected text; gate passed, κ 0.85): Lite 3.28 → 3.93 (**+0.65 [0.32, 1.04]**), Flash 3.69 → 4.07 (+0.39 [0.06, 0.76]), reversals −18.5 pp (Lite). On the 9 pages where OCR is the primary cause: Lite +1.28 [0.44, 2.17], Flash +1.17 [0.56, 1.89]. On the other 18: Lite +0.33, Flash 0.00. With a correct transcription Lite and Flash are not separable (+0.15 [−0.17, 0.43]).
- The OCR failures are three strata: a 1492 Gītā manuscript (the English renders an invented refrain), Sinhala-script Pali in an old face (ligatures misresolved the same way each time), and Chinese woodblock with interlinear commentary (眴→眸, 翣→妾; a small-print note spilled into the text).

**Result 4 — more than accuracy** (one judge, 64 pages, 1–5).

| | fidelity | readability | register | terminology | ambiguity | transparency | stance |
|---|---|---|---|---|---|---|---|
| ours — Pali | 3.67 | 3.53 | 3.87 | 3.87 | 3.27 | 3.53 | literal 12, balanced 3 |
| reference — Pali (Sujato) | — | 4.73 | 3.73 | 3.27 | 2.80 | 2.27 | free 11, balanced 4 |
| ours — Sanskrit | 3.50 | 3.78 | 3.52 | 4.00 | 2.93 | 3.59 | balanced 15, literal 11, free 1 |
| reference — Sanskrit | — | 3.74 | 4.41 | 3.41 | 3.07 | 3.04 | free 12, balanced 8, literal 7 |
| ours — Chinese | 3.75 | 3.23 | 3.27 | 3.45 | 3.32 | 3.73 | literal 18, balanced 4 |
| reference — Chinese | — | 4.23 | 3.95 | 2.82 | 2.36 | 2.64 | free 13, balanced 8, literal 1 |

- Ours is a crib: it keeps terms, flags its choices and leaves ambiguity open. The human translations read better and keep the genre's voice, and they resolve ambiguity silently.
- 59 of 64 pages show a different legitimate choice. The two picked for a principles discussion: the Diamond Sūtra with Huineng's comment (ours keeps the bare paradox; Gemmell 1912 turns it into devotional prose) and the Yājñavalkya Smṛti with the Mitākṣarā (ours translates the commentary and keeps nyāsa / nikṣepa beside the English; Mandlik 1880 gives only the root verses with every supplied word bracketed).

**Threats, with numbers.**
- **The reference is one reading.** Where ours and the reference differ in meaning, the dimension judge found the reference right on 29 pages, ours right on 16, both defensible on 17 (n = 64). Fidelity was scored against the source with the reference as a guide, so those 16 are not counted against us by design; the judge is the limit.
- **Recitation.** Canonical pages score 0.1–0.3 higher than non-canonical for every arm (served 3.66 vs 3.55, Lite 3.82 vs 3.57, Flash 4.23 vs 3.93, Opus 4.96 vs 4.75). CIs overlap. One Lite run refused a Mahāsatipaṭṭhāna page with RECITATION (#5606).
- **Reference style.** 11 free references (verse renderings, Giles, Burton, Richard): served 3.41 vs 3.67 against literal ones, CIs overlap.
- **Span.** Judges rated the reference cut exact on 10, wider on 88, narrower on 31, offset on 7 and wrong on 0 of 136 judge-pages. The image pass put 1 of 98 defects down to the reference or the judge.
- **OCR vs translation** is classified above, by a model reading image tiles, not by a person. Six pages were only partly legible. The corrector saw the judges' notes and the reference, so a correction could lean toward the reference; it was told to fix only what it could read.
- **Same family.** Judges, the image reader and the ceiling translator are all Opus. The 4.88 may flatter Opus. The controls bound the judges' error only for wrong pages, planted reversals and duplicates.
- **Generalisation.** 46 of 68 pages are canonical and most editions are 1800–1949 print. The Chinese corpus is mostly 1500–1799 woodblock (64,793 of 134,665 translated pages) and this set has 9 such pages. Read the result as "printed editions of well-known works"; for obscure woodblock and manuscript material it is likely an upper bound, since those are where the OCR failed.
- The served English comes from the chained lane (blocks, continuity context, prompts v10–v13); the lever arms are single-page v13. `lite` vs `served` is +0.12 [−0.08, +0.32]: no measurable difference.

**Decisions proposed (not implemented).**
1. **Route Sanskrit, classical Chinese and Pali translation to Flash.** Measured: fidelity +0.40 [0.22, 0.58], reversals 15.4 → 5.9 per 100 pages, omission 40 % → 25 %; beyond the A-vs-A floor in Sanskrit and Chinese, directional in Pali. Cost at the Batch rate: +$0.94 per 1,000 new pages; re-translating everything already translated is $195 (Sanskrit) + $240 (Chinese) + $24 (Pali) on Flash against $92 + $113 + $11 on Lite. Default: **yes**. No thinking (2.8× the cost, inside the floor) and no check-and-fix pass (same cost as Flash, less gain).
2. **Repair the OCR before re-translating manuscripts, Sinhala-script Pali and Chinese woodblock with interlinear commentary.** Measured: a correct transcription is worth +0.65 for Lite and +0.39 for Flash on the pages checked, +1.2 where OCR is the cause, and it removes the Flash–Lite gap. Cost: an OCR pass on those strata (not priced here; whether the Flash OCR lane actually fixes these pages was not tested). Default: **yes**, as an ordering rule.
3. **Test a "translate the printed commentary in full" rule for root-plus-commentary pages** in the next prompt (#5698). Measured: 69 % of served Sanskrit pages omit something and the worst Sanskrit pages are condensed commentary; Opus under the same prompt omitted nothing. The effect of the rule itself is not measured. Default: **yes to the A/B, no to shipping it unmeasured**.

*Measure:* judged against a human reference (two blind Opus judges; fidelity is not "accuracy" in eval-design §2). *Grade:* exploratory to moderate: n = 64–68 pooled, 15–28 per language. *Replicated?* Partly: Flash > Lite replicates #5606 on a re-judged, enlarged set with a different judge pair (Opus + Opus instead of Opus + Sonnet), and Chinese now clears both Lite runs. The OCR share, the thinking null and the corrected-OCR gain are first measurements.

*Cost:* Gemini **$1.51** metered (envelope `xlref-t5`, cap $8, removed at the end; 373 usage rows), on top of #5606's $0.20. Judges, reference cutting, image reading and the Opus ceiling ran on the subscription. No writes to `pages` or `books`.

*run_id:* `xlref-t5-2026-10`.

*Artifacts:* `results/xlref-t5-2026-10/`: `summary.json` (every number above), `pages.jsonl` (one row per page × arm with reference metadata and licences, 545 rows, ready for #5531), `gallery.md` / `gallery.json` (5 best / 5 median / 5 worst + 2 principles pages), `results.json`, `results-thinking.json`, `results-corrected-ocr.json`, `image-pass.jsonl` (causes, image readings, corrected transcriptions), `dimensions/`, `arms/<arm>.jsonl` (every arm's raw output, one row per page, for the back-translation detector job), `packet*/` (keys, manifests, verdicts; the judge input files rebuild from `work/records-arms.jsonl` with the recorded seeds), `briefs/`, `census.json`.

*Scripts:* `scripts/eval/xlref-t5/` (`assemble.py`, `run-arms.mjs`, `merge-arms.py`, `dump-prompts.mjs`, `image-pass-bundle.mjs`, `analyze.py`, `gallery.py`, `census.mjs`, `DIMENSIONS-PROMPT.md`), on the harness in `translation-vs-reference/`.
