# OCR engine routing: what the evidence says, per language

PRIOR ART: `/platform/admin/ocr-evidence` (`src/data/ocr-benchmark-evidence.json`) is the cell-level
evidence table this doc reads from; `.claude/docs/ocr-quality-measurement-loop.md` describes how
the measurements are made; `scripts/eval/EXPERIMENTS.md` is the run log. Neither turns the evidence
into a routing recommendation set beside production, which is what this doc is for.

**Read this when** you are choosing which engine OCRs a language, changing
`scripts/lib/ocr-routing.mjs` / `LATIN_SCRIPT_LANGUAGES`, or deciding which OCR experiment to run
next. The per-language table is GENERATED (see "The table" below); the prose around it is a snapshot of
2026-10-04. Changing routing moves spend and is Derek's decision. This doc recommends, the router decides.

## What production does today

`OCR_LITE_ONLY` defaults ON and is not set to `0` on Hetzner (checked 2026-10-04: `.env*`, crontab).
So **every book OCRs on `gemini-3.1-flash-lite`**, except the families in `FLASH_OCR_FROM`, which read on
`gemini-3-flash-preview` when the book is visible or new: Greek (#5575), then Persian, Sanskrit, Pali,
Arabic and Ge'ez (#5770). Persian's hidden backlog reads on flash too (#5812). The generated table below
is read from those constants and is the current statement; this paragraph is not.
The script-aware carve-outs in `getOcrModelForBook` (BPH, non-Latin scripts, unknown language → flash)
are never reached (#4877). The flag was set on 2026-09-11, when the spend dial was $5/day. The header
comment says it lasts "until the dial is raised", and the dial was $300 on 2026-10-01.

Separate lanes, not Gemini: Syriac → Kraken (`syriac-kraken-lane`), Tibetan → BDRC Yigdzin
(`reocr_bdrc_4523`), cursive pre-1868 Japanese → NDL v3 (`ndl-koten-lane`; pilot run, no standing
lane yet, #5100), Siku Quanshu Chinese → PaddleOCR-VL (#5600, being built).

## Grades

Each cell is graded by the number of books with a reference text: **exploratory** < 30,
**directional** 30–49, **decision** ≥ 50. "CER" is character error rate against a published text.
The agreement study (#4729) measured agreement with flash, not accuracy, so it is labelled `agr`.

## The table (generated)

This section is written by `node scripts/eval/build-routing-table.mjs` from the live routing constants
(`scripts/lib/ocr-routing.mjs`), the evidence JSON, the routing-eval results and `DECISIONS.md`.
`tests/unit/routing-table-fresh.test.ts` fails when it is stale, so re-run the script after changing
any of those. The page counts are a dated snapshot (`--refresh-pages` re-measures them).

<!-- BEGIN GENERATED routing-table: scripts/eval/build-routing-table.mjs writes this section. Do not edit it by hand. -->

Production is read from `getOcrModelForBook` with `OCR_LITE_ONLY` on, the default (lite = `gemini-3.1-flash-lite`, flash = `gemini-3-flash-preview`): "visible" is a visible book, "new" a hidden book created on or after the family's date in `FLASH_OCR_FROM`, "hidden backlog" a hidden book created before it. A specialist lane, where one exists, reads the script instead of Gemini. Pages are `pages_count` by the family of the first `language` (snapshot of 2026-10-04, all books; "owed" = hidden books' pages not yet read). OCR accuracy is median CER against a reference, graded by referenced books (exploratory < 30, directional 30–49, decision ≥ 50); W/L/T is flash against lite on the same pages. Translation fidelity is a judge's 1–5 rating against a published translation (books in brackets), not CER. A routing-eval verdict is a rule's output, not a decision; the ledger column counts the rows of `scripts/eval/DECISIONS.md` that name the language.

| language | pages (hidden, owed) | Gemini router now | specialist lane | OCR accuracy | translation fidelity | routing evals | ledger |
|---|---:|---|---|---|---|---|---|
| Latin (`lat`) | 14.0M (10.5M) | lite | — | lite 6.8% (159 refs, decision); flash 5.6%, 108W 33L 17T | served 4.16 (71); flash − lite +0.22 [+0.06, +0.37] | — | 1 pending, 4 unjudged, 3 no decision recorded (#5090, #5126, #5695, #5660, #5700) |
| Greek (`grc`) | 2.3M (1.8M) | flash (visible, new); lite (hidden backlog) | — | lite 11% (172 refs, decision); flash 6.6%, 139W 16L 16T | served 3.64 (75); flash − lite +0.32 [+0.16, +0.48]; flash re-read of a lite read +1.04 [+0.61, +1.50] (14) | — | 1 decided, 2 pending, 1 unjudged, 3 no decision recorded (#5575, #5660, #5700, #5870) |
| Chinese (`zho`) | 2.1M (105K) | lite | PaddleOCR-VL for Siku Quanshu (being built, #5600) | lite 26% (536 refs, decision); flash 21%, 402W 62L 71T | served 3.75 (22); flash − lite +0.33 [+0.17, +0.50]; flash re-read of a lite read +0.30 [−0.60, +1.30] (5) | — | 2 pending, 1 unjudged, 1 no decision recorded (#4743, #5547, #5700) |
| English (`eng`) | 1.8M (507K) | lite | — | lite 5.3% (57 refs, decision); flash 3.9%, 38W 7L 6T | — | — | 2 decided, 2 pending, 1 no decision recorded (#5182, #5124, #5660) |
| German (`deu`) | 1.6M (677K) | lite | — | lite 0.6% (35 refs, directional); flash 0.2%, 22W 1L 11T | served 4.43 (22); flash − lite +0.39 [+0.18, +0.59] | — | 1 unjudged, 1 no decision recorded (#5090, #5660) |
| Tibetan (`bod`) | 927K (47K) | lite | BDRC Yigdzin (`reocr_bdrc_4523`, #4523) | — | — | — | 1 decided (#4523) |
| French (`fra`) | 466K (98K) | lite | — | — | served 4.54 (14); flash − lite −0.18 [−0.36, −0.04] | — | 1 unjudged (#5090) |
| und / unknown (`und`) | 426K (382K) | lite | — | — | — | — | — |
| Sanskrit (`san`) | 355K (188K) | flash (visible, new); lite (hidden backlog) | — | — | served 3.50 (27); flash − lite +0.38 [+0.11, +0.64]; flash re-read of a lite read +0.75 [+0.30, +1.35] (10) | #5795: relabel (#4884) (every rule) | 1 decided, 3 pending, 1 unjudged (#5700, #5795) |
| Italian (`ita`) | 240K (40K) | lite | — | — | served 4.25 (10); flash − lite +0.35 [−0.05, +0.80] | — | — |
| Dutch (`nld`) | 155K (8.2K) | lite | — | — | served 4.43 (7); flash − lite +0.21 [−0.29, +0.71] | — | 1 unjudged (#5090) |
| Russian (`rus`) | 141K (35K) | lite | — | — | — | — | 1 no decision recorded (#5090) |
| Hebrew (`heb`) | 126K (38K) | lite | — | lite 5.5% (4 refs, exploratory); flash 2.9%, 3W 1L 0T | served 3.80 (15); flash − lite +0.60 [+0.27, +0.93] | — | 1 pending, 1 unjudged (#5700) |
| Arabic (`ara`) | 113K (45K) | flash (visible, new); lite (hidden backlog) | — | — | served 3.50 (20); flash − lite +0.43 [−0.02, +0.80]; flash re-read of a lite read +0.39 [−0.06, +0.78] (9) | #5795: relabel (#4884) (every rule) | 1 decided, 3 pending, 1 unjudged (#5700, #5795) |
| Persian (`fas`) | 89K (59K) | flash (visible, new, hidden backlog) | — | — | served 2.96 (12); flash − lite +0.63 [+0.33, +0.92]; flash re-read of a lite read +1.00 [+0.33, +1.67] (6) | #5795: stay on lite (hidden-flash-5795-registered); route to flash (margin-v1) | 2 decided, 3 pending, 1 unjudged (#5700, #5795) |
| Mongolian (`mon`) | 83K (83K) | lite | — | — | — | — | — |
| Syriac (`syc`) | 73K (18K) | lite | Kraken (`syriac-kraken-lane`, #4883); never Gemini | — | — | — | 1 decided, 1 unjudged (#4883, #6295) |
| Korean (`kor`) | 70K (6.1K) | lite | — | — | — | — | 1 unjudged |
| Spanish (`spa`) | 70K (36K) | lite | — | — | served 4.08 (6); flash − lite +0.25 [−0.17, +0.67] | — | — |
| Javanese (`jav`) | 56K (52K) | lite | — | — | — | — | — |
| Japanese (`jpn`) | 51K (23K) | lite | NDL v3 for cursive pre-1868 (`ndl-koten-lane`, pilot, #5100) | — | — | — | 1 unjudged |
| Armenian (`hye`) | 36K (2.7K) | lite | — | lite 3.4% (9 refs, exploratory); flash 2.1%, 8W 0L 0T | — | — | 1 no decision recorded (#5090) |
| Pali (`pli`) | 21K (3.2K) | flash (visible, new); lite (hidden backlog) | — | — | served 3.67 (15); flash − lite +0.53 [+0.06, +1.16]; flash re-read of a lite read +0.58 [0.00, +1.58] (6) | #5795: relabel (#4884) (every rule) | 1 decided, 2 pending, 1 unjudged (#5700, #5795) |
| Ge'ez (`gez`) | 18K (4.5K) | flash (visible, new); lite (hidden backlog) | — | — | — | #5795: undecided: n too small (every rule) | 1 decided, 1 pending, 1 unjudged (#5700, #5795) |

<!-- END GENERATED routing-table -->

## Reading notes per language (hand-written, 2026-10-04)

What the numbers above mean in words. Production, page counts and grades are in the generated table
and are not repeated here; if a note disagrees with that table, the table is right and the note is old.

| language | evidence says | source |
|---|---|---|
| Greek | Flash for print: 1700s 8.5% vs 10.7% (46W/6L), 1500s 8.8% vs 17%. Kraken cllg matches flash on letters but misses the better-reader bar. Paddle unusable. | #4925 (09-21), #5575, #5660 |
| Chinese | SKQS manuscript: **Paddle** (0.9% catastrophic vs lite 10.6%, 433 books). Woodblock and typeset: unmeasured. Overall CER 19–25% may be the reference edition, not the read. | #5547, #5574 |
| English | Lite. Modern print ties (75 of 92 tied). 1600s: flash 3.8% vs lite 5.3%, but flash refuses more often. | #5216, #5488 |
| German | Lite reads Fraktur well (0.5% CER, 29 refs). The agreement study flagged one invented page. | #4729, #5660 |
| Tibetan | Yigdzin: Kangyur identity 0.947, replicated. Manuscripts outside the Kangyur e-text: unmeasured (#5004). | #4523, #5497 |
| French | `agr` 0.951, under the 0.956 bar. No reference CER. | #4729, #5124 |
| Sanskrit | `agr` 0.38 with 6/20 catastrophic. A flash re-read lifts the English +0.75 [0.30, 1.35] (#5700 A5). **Hidden backlog stays lite** (#5795): 8 of 30 sampled hidden pages are not confirmably Sanskrit (Urdu, Hindi, English, Sharada almanac tables); on Sharada manuscripts lite loops or recites and flash is closer but not translatable. | #4729, #5795 |
| Italian | Never drawn. | #5573 |
| und / unknown | Language unknown, so it can't be routed. | #4884, #5650 |
| Dutch | `agr` 0.921, under the bar. | #4729, #5573 |
| Russian | `agr` 0.996, passes. | #4729 |
| Arabic | `agr` 0.929, flash only. A flash re-read lifts the English +0.39 [−0.06, 0.78], +0.72 with flash translating too (#5700 A5). **Hidden backlog stays lite** (#5795): 7 of 30 sampled hidden pages fail the label (Persian, French, Hebrew-script); both engines invented Hebrew on a Judeo-Arabic leaf. | #4729, #5795 |
| Hebrew | 4 refs. | — |
| Persian | Typeset reads well apart from column order. A flash re-read lifts the English +1.00 [0.33, 1.67] (#5700 A5). **Manuscripts: no engine passes** (0.41 sequence accuracy). **Hidden backlog stays lite** (#5795): label holds (25/27) and flash wins 9–0 by eye on manuscripts, but flash looped on 1 of 30 pages against 0 for lite, which fails the preregistered rule. Derek overrode that on 2026-10-04 (#5812): the hidden Persian backlog reads on flash. Replayed with a margin, the same pages pass (#5828). | #5525, #5559, #5795 |
| Mongolian | Nothing. | #5664 |
| Syriac | Kraken (Sophro MS 19% line CER, 40/0 vs lite). Gemini fabricates. | #4746, #4883 |
| Korean | Nothing. | — |
| Spanish | `agr` 0.972, passes. | #4729, #5573 |
| Javanese | Nothing. | — |
| Japanese | Cursive pre-1868: **NDL v3**; Gemini invents text. Typeset: unmeasured. | #4743, #5100 |
| Armenian | `agr` 0.963, passes; 9 refs. | #4729 |
| Ge'ez | `agr` 0.47, 9/20 catastrophic. Hidden backlog: 2 books not held, 1 page sampled, undecided (#5795). | #4729, #5795 |

## Deciding a new script (Hebrew, Korean, Sharada, …)

One command, run again after each step that needs a person:

```
node --env-file=/root/sourcelibrary/.env.production.local scripts/eval/routing-eval.mjs run --run <script>-<issue> --family <code> --issue <n>
```

It seals one page per book from the script's hidden OCR-owed backlog, writes the label-check packet,
runs the engines on the sealed bytes (only with `--spend-cap`), picks the most-disagreeing pages for a
blind A/B reading, and applies the rule file. The verdict lands in
`scripts/eval/results/<run>/routing-eval.json` and appears in the generated table above. The steps, the
rule files and what a person has to do between them: `scripts/eval/routing-eval/README.md`.
A verdict is a rule's output. Changing `FLASH_OCR_FROM` is still Derek's decision (`eval-design.md` §10).

## Recommendations the evidence already supports

1. **Turn off `OCR_LITE_ONLY` for non-Latin scripts and manuscripts** (#4877). Its premise, the $5 dial, no longer holds. On those scripts lite either fails the agreement bar (Arabic, Sanskrit, Ge'ez,
   Chinese non-SKQS) or loses 11/11 on manuscripts. Spend: roughly 2× per page on those pages only.
2. **Latin and German print stay on lite.** Do not move them to Paddle.
3. **Greek: extend flash to the hidden backlog** once #4884 fixes the language labels (many "Greek" books are Latin on the page).
4. **Build the lanes already adopted:** Paddle for SKQS (#5600) and NDL for cursive Japanese (#5100).
5. **Persian manuscripts:** keep them withheld. No engine passes yet (#5559).

## Experiments still owed, by pages × uncertainty

Each one must change a decision (`feedback_good_reason_not_wasteful`). Gemini cost per run is
cents to a few dollars, since 50–100 books × 2–3 arms is a few hundred pages. **Finding the
references is the real work.** Per `eval-design.md`: one page per book, sealed draw, paired arms, A-vs-A floor first.

| # | experiment | pages it governs | decision it changes | references | issue |
|---|---|---:|---|---|---|
| E1 | ~~OCR error → translation error curve~~ **ANSWERED 2026-10-04** by job reocr-lift-5700 (#5700 A5, PR #5760): fidelity steps down at 5% CER; a flash re-read of a lite-read page lifts the English by +0.75 [0.51, 0.99], while a flash re-read of a flash-read page adds nothing | all | Done. It drives recommendation 1 and the ranked re-OCR backfill (Greek, Persian, Sanskrit first) | — | #5700 |
| E2 | **RUNNING** (job latin-period-5126, 2026-10-04) **Latin by period to decision grade**: ≥ 50 refs each for pre-1500, 1500s, 1600s, 1700s; lite vs flash | 14M | Route early Latin print to flash. This is the largest spend lever in the corpus. | Latin Wikisource, CAMENA, Perseus/DLL, EEBO-TCP Latin | #4925 |
| E3 | **Chinese edition check, then woodblock/typeset arms** (lite / flash / Paddle) | ~1M non-SKQS | Paddle or flash for non-SKQS Chinese. The router holds Chinese out until this lands. | Kanripo, CBETA, ctext; #5574 by-eye check first | #5574 |
| E4 | **Sanskrit against reference** (lite / flash, plus one open Indic engine if a candidate exists) | 0.36M | Agreement is 0.38, so Sanskrit may need its own lane, as Syriac did. | GRETIL, DCS | none |
| E5 | **German Fraktur by period to decision grade** | 1.6M | Confirms lite, or flags early print. Cheap, because DTA is page-aligned. | Deutsches Textarchiv | none |
| E6 | **French, Italian, Dutch, Spanish to ≥ 30 refs each** | 0.9M | Settles the #4729 flags (fr, nl) against accuracy, not agreement. | Wikisource, DBNL, Liber Liber, Gallica e-texts | #5124, #5573 |
| E7 | **Hebrew and Arabic print** | 0.22M | Flash vs lite. Also whether open-text fitting replaces OCR. | Sefaria, OpenITI | #5560 |
| E8 | **Manuscripts with transcriptions** (Latin/German, BPH) | unknown, census first | #4877 found flash 11/11 on manuscripts with no reference n. | Published diplomatic editions | #4877 |
| E9 | **Language labels before routing**: und/unknown and mislabelled bilingual editions | 0.4M + Greek | No routing works on a wrong label. Classification, not an engine test. | — | #4884, #5650 |
| E10 | Small scripts (Korean, Javanese, Mongolian, Ge'ez, Japanese typeset): one exploratory pass each | 0.3M | Shows whether any of them needs a lane. | per script | #5664 |

Typed open editions are the bigger lever wherever they exist (Tengyur, CBETA, Sefaria, Kanripo,
Pali VRI): fitting the text beats any OCR (#5700 A6). Check the canon-gap map (#5513) before paying for an OCR experiment on a canonical corpus.
