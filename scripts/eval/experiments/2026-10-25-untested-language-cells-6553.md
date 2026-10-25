---
stage: ocr
measure: [judged]
languages: [it, ko, es, ru, pt, gmh, yi, ota, tr, smp, nds, enm, frm, fro, pl, tsz, da, cs, roh, hr, non, ur, dum, sl, hi, pra, pa, ae, mr, hu, no, ta, te, lv, haw, mi]
scripts: [Latn, Hang, Hani, Cyrl, Hebr, Arab, Deva, Taml, Telu, Guru, Avst]
canons: []
n_books: 336
n_pages: 336
verdict: "First numbers for 36 untested language cells, one page per book, Opus as the judge (not a human reference). Flash-lite reads Italian, Spanish, Russian, Danish and Polish print at a median CER of 2% or less. It is poor on Korean (classical Chinese woodblock, 11.5%; agy Flash 5.9%, better on 24 of 27 pages), on Ottoman/Arabic-script Turkish (15–18%), and on manuscripts in Middle English, Middle High German and Middle French (about 21%). Russian translation scores a fidelity mean of 4.5 (n=30), Portuguese 3.9 (n=18). Samaritan, Yiddish and Avestan are not measured: the judge could not read most of those pages."
status: informational
decision: null
superseded_by: null
issue: [6553, 7270]
---
## 2026-10-25 · Untested language cells: flash-lite (and agy Flash) OCR and flash-lite translation, judged by Opus against the page image (#6553)

PRIOR ART: #7270 step 6 (vern-7270's evidence inventory and the proposed explore plan this run follows);
`scripts/eval/reocr-lift-5700/pilot.mjs` (the OCR and translation chain, copied into `run-lite.mjs`);
`scripts/batch/cli-ocr.mjs read` (the agy Flash arm, unchanged); `scripts/batch/ocr-convergence/driver.mjs` runSealed and
`JUDGE.md` / `correct.mjs` (the sealed Opus judge, and building a reference from the drafts);
`scripts/eval/translation-corpus-audit/JUDGE-PROMPT.md` (the fidelity rubric). None of these covers these language cells.

**Who reads this:** whoever decides OCR routing or publication for languages with no evidence yet (#6553, #6557).
**Measure:** `judged`. The CER/WER below is computed with a metric (Levenshtein after script normalisation), but the
reference is Opus's own transcription of the leaf. Opus built it from the image, using the engine reads as drafts. It
is **not** `accuracy`: it shares the judge's blind spots and anchors on the drafts. Treat these numbers as an upper
bound on quality, and as exploratory evidence (n < 30 books in every cell except five).

### Design

- **Draw** (`draw.mjs`, seed `6553-cells-v1`): live books (`visible && pages_count > 0`), assigned to cells by
  `toLanguageCodes(books.language)`. One interior page per book (between 15% and 95% of the page count). Pages with
  ≥ 200 stored OCR characters were preferred as a sign the page has text; 116 of the 336 pages came from books with no
  stored text. n = min(books, 30) for Italian, Korean, Spanish, Russian and Portuguese. The zero-observation cells were
  **capped at 10 books** so that the paid steps would fit under $1 at realtime prices. This differs from the plan's
  "all books"; it affects Middle English (34 live books), Middle High German (26), Ottoman Turkish (23), Old French
  (17), Yiddish (16), Tamil (16), Hindi (14) and Danish (14).
- **OCR:** `gemini-3.1-flash-lite`, realtime, the live production prompt (Standard OCR v19.1) with document context,
  temperature 0.1, thinking off, through `gemini-script-client` under the pseudo book id `cells-6553`. Nothing was
  written to `pages` or `books`. **agy Flash** (`gemini-3.8-flash-low`, `cli-ocr.mjs read`, concurrency 2, $0) read the
  130 pages whose catalogue script is not Latin.
- **Translation:** flash-lite on the live translation prompt (v13), temperature 0, made from the fresh lite read. The
  $1 cap allowed 102 translations: all of Russian (30) and Portuguese (18 usable reads), then 1–2 pages per zero cell,
  in round-robin order. **Italian, Korean and Spanish were not translated.**
- **Judge:** Opus through `claude -p` on the subscription, sealed (`--restricted --tools Read Write`, ANTHROPIC_*
  stripped from the environment), brief `JUDGE-CELLS.md` v1, 4 pages per call, 80 calls. The two reads were labelled
  X and Y in a hashed order. For each page the judge writes its own full-leaf transcription, rates each read
  (text/refusal/wrong-leaf/invented, serious yes/no) and gives the translation a fidelity score of 1–5 **against the
  leaf**. Every page's image-open is in the call transcript (319/319). The script used for scoring was **observed from
  the reference**, not taken from the catalogue (eval-design §3.2). All ten "Turkish" books turned out to be in
  Arabic script.

### Results (n pages; median CER / WER %; Opus-built reference; 2026-10-25)

| cell | n judged | lite CER/WER | agy Flash CER/WER | lite not-text / serious | translation n, fidelity mean (≤2) | judge can't read / partly |
|---|---|---|---|---|---|---|
| Italian | 30 | 1.3 / 4.8 | – | 0 / 9 | – | 0 / 2 |
| Spanish | 28 | 2.0 / 6.9 | – | 2 / 5 | – | 1 / 2 |
| Korean (Hanja woodblock) | 30 | 11.5 | 5.9 (agy better on 24/27 pages) | 2 / 25 | – | 1 / 18 |
| Russian | 30 | 0.1 / 0.8 | 0.0 / 0.0 | 1 / 6 | 30, **4.53** (1) | 1 / 0 |
| Portuguese | 19 | 2.4 / 8.8 | – | 2 / 7 | 18, **3.94** (2) | 1 / 4 |
| Middle English (MSS) | 10 | 20.5 / 31.9 | – | 3 / 6 | 2, 2.0 | 2 / 3 |
| Middle High German | 10 | 22.4 / 39.9 | – | 0 / 9 | 2, 4.0 | 0 / 8 |
| Middle French | 8 | 20.8 / 36.4 | – | 2 / 6 | 2, 3.5 | 0 / 5 |
| Ottoman Turkish | 10 | 17.6 / 32.6 | 14.6 / 39.1 (lite better 7/10) | 0 / 7 | 2, 3.0 | 0 / 8 |
| "Turkish" (all Arabic script) | 10 | 14.9 / 36.6 | – | 0 / 6 | 2, 2.5 | 1 / 8 |
| Tamil | 10 | 3.5 | 2.8 | 0 / 4 | 2, 4.0 | 0 / 5 |
| Hindi | 10 | 2.9 / 8.1 | 0.9 / 3.8 | 0 / 0 | 2, 4.0 | 0 / 3 |
| Danish 10 · Polish 5 · Old Norse 8 · Maori 6 · Low German 7 | | 0.4 · 0.5 · 3.0 · 1.0 · 1.8 | – | | 2 each, 3.5–4.5 | |
| Old French 10 · Middle Dutch 9 | | 6.9 · 8.7 | – | | | |
| Samaritan Hebrew | 10 | not measured (judge could not read 7) | | 7 not-text | 2, 1.5 | 7 / 3 |
| Yiddish | 9 | n=3 only | | 4 not-text | 2, 4.0 | 5 / 2 |
| Avestan | 5 | n=1 only | | 4 not-text | 2, 2.5 | 4 / 0 |
| 1–4-book cells (Urdu, Marathi, Purépecha, Romansh, Prakrit, Croatian, Punjabi, Slovenian, Telugu, Norwegian, Hungarian, Latvian, Hawaiian, Czech) | ≤ 5 each | see `cells-summary.json` | | | | |

WER on Tamil and Telugu depends on how words are segmented, so quote CER for those. Korean is scored per character.

**Refusals and failures:** flash-lite returned RECITATION on 4 pages (Spanish, Maori, Middle English, Portuguese)
and hit MAX_TOKENS on 6 (repetition loops, including one Korean page that looped one phrase hundreds of times). agy
Flash failed on 0 of the 129 pages it was given. 17 pages could not be fetched from this host: e-rara.ch
(16) and Gallica (1) returned HTTP 403. They fall in Polish, Middle French, Low German, Spanish, Romansh, Croatian,
Yiddish, Czech and Slovenian, and were not judged.

**Cells not run:** Quechua and Scots have no live book under that label. Romansh, Croatian, Slovenian and Polish lost
most of their pages to the e-rara 403s.

### Spend

$0.977 on `gemini-3.1-flash-lite`, the only paid model. That is $0.819 for 319 OCR calls and $0.158 for 102
translation calls, measured in `gemini_usage` (book id `cells-6553`, `getScopeSpendUsd`, $0.9774). It matches the
local ledger. agy and claude cost $0. Realtime OCR came to about $0.0026 a page, roughly twice the plan's Batch figure
of $0.00222, so translation had to be cut short at the $1 stop.

### What this does and does not show

- Flash-lite on modern-print Latin-script Romance and Germanic pages, and on Cyrillic, has low error against the
  judge's reference. Error is high on manuscripts, Arabic-script Ottoman and classical-Chinese Korean, where production
  already routes non-Latin scripts to Flash. Korean's numbers support that routing: agy Flash was better on 24 of 27
  pages.
- The judge marked many of its own references "partly" (Korean 18 of 30; Ottoman, Turkish and Middle High German 8 of
  10 each), so the CER in those cells measures disagreement with a reference the judge was not sure of.
- There is still no translation `accuracy` for any of these languages. The fidelity numbers are one judge's ratings,
  α not measured (a single judge).
- **By-eye calibration for Derek (8 pages)**: Italian `6ac52b17ed10b8de509de7c7` p62 (CER 3.3%), `6a08546a15c643eb1af52b34` p53 (0.8%), `69b4c08186a5921d5bc4418f` p112 (1.0%), `6a08589249638a50931c66b7` p288 (26.8%); Russian translation `69af2224f98f6eff774cc0d7` p185 (fidelity 4), `6984e84e018466b0ebaa3653` p60 (5), `69e7926c80b52390feb15d96` p77 (5), `69aff300c83500af1dbf6cfb` p74 (5). The judge's references are in `results/opus-judge-reviews.jsonl`.

Files: `explore/cells-6553/` (`draw.mjs`, `run-lite.mjs`, `judge.mjs`, `JUDGE-CELLS.md`, `results/*.jsonl`).
Reads made by agy were also copied to R2 `candidate-reads/` by `cli-ocr.mjs` (its standing behaviour, #7075). Nothing
was written to `pages`, `books` or `system_config`.
