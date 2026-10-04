# OCR engine routing: what the evidence says, per language

PRIOR ART: `/platform/admin/ocr-evidence` (`src/data/ocr-benchmark-evidence.json`) is the cell-level
evidence table this doc reads from; `.claude/docs/ocr-quality-measurement-loop.md` describes how
the measurements are made; `scripts/eval/EXPERIMENTS.md` is the run log. Neither turns the evidence
into a routing recommendation set beside production, which is what this doc is for.

**Read this when** you are choosing which engine OCRs a language, changing
`scripts/lib/ocr-routing.mjs` / `LATIN_SCRIPT_LANGUAGES`, or deciding which OCR experiment to run
next. Snapshot of 2026-10-04; regenerate the evidence column from the dashboard JSON, not from
memory. Changing routing moves spend and is Derek's decision. This doc recommends, the router decides.

## What production does today

`OCR_LITE_ONLY` defaults ON and is not set to `0` on Hetzner (checked 2026-10-04: `.env*`, crontab).
So **every book OCRs on `gemini-3.1-flash-lite`**. The single exception is Greek, which reads on
`gemini-3-flash-preview` for visible books and for books created after 2026-10-02 (#5575).
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

## The table

Pages = `pages_count` summed over books whose first `language` is that language (2026-10-04, all
books, visible or not). Ordered by pages.

| language | pages | production | evidence says | grade | source |
|---|---:|---|---|---|---|
| Latin | 14.0M | lite | Pooled: lite is fine (1800s 0.4% vs flash 0.3%). Pre-1700 print: flash better (1600s lite 3–5% vs flash 0.7%). Paddle loses every cell. | decision pooled (77); **every period cell exploratory**; pre-1600 has 6 refs | #4925, #5660 |
| Greek | 2.3M | flash (visible/new), lite (hidden backlog) | Flash for print: 1700s 8.5% vs 10.7% (46W/6L), 1500s 8.8% vs 17%. Kraken cllg matches flash on letters but misses the better-reader bar. Paddle unusable. | decision (1500s, 1700s); others exploratory | #4925 (09-21), #5575, #5660 |
| Chinese | 2.0M | lite (SKQS held for Paddle) | SKQS manuscript: **Paddle** (0.9% catastrophic vs lite 10.6%, 433 books). Woodblock and typeset: unmeasured. Overall CER 19–25% may be the reference edition, not the read. | decision (SKQS); exploratory (woodblock 4–12 refs) | #5547, #5574 |
| English | 1.8M | lite | Lite. Modern print ties (75 of 92 tied). 1600s: flash 3.8% vs lite 5.3%, but flash refuses more often. | decision | #5216, #5488 |
| German | 1.6M | lite | Lite reads Fraktur well (0.5% CER, 29 refs). The agreement study flagged one invented page. | directional (35); periods exploratory | #4729, #5660 |
| Tibetan | 0.93M | Yigdzin lane | Yigdzin: Kangyur identity 0.947, replicated. Manuscripts outside the Kangyur e-text: unmeasured (#5004). | decision (Kangyur) | #4523, #5497 |
| French | 0.45M | lite | `agr` 0.951, under the 0.956 bar. No reference CER. | exploratory (0 refs) | #4729, #5124 |
| Sanskrit | 0.36M | lite → flash for visible/new (this PR) | `agr` 0.38 with 6/20 catastrophic. A flash re-read lifts the English +0.75 [0.30, 1.35] (#5700 A5). **Hidden backlog stays lite** (#5795): 8 of 30 sampled hidden pages are not confirmably Sanskrit (Urdu, Hindi, English, Sharada almanac tables); on Sharada manuscripts lite loops or recites and flash is closer but not translatable. | none | #4729, #5795 |
| Italian | 0.24M | lite | Never drawn. | none | #5573 |
| und / unknown | 0.40M | lite | Language unknown, so it can't be routed. | — | #4884, #5650 |
| Dutch | 0.15M | lite | `agr` 0.921, under the bar. | none | #4729, #5573 |
| Russian | 0.14M | lite | `agr` 0.996, passes. | exploratory | #4729 |
| Arabic | 0.11M | lite → flash for visible/new (this PR) | `agr` 0.929, flash only. A flash re-read lifts the English +0.39 [−0.06, 0.78], +0.72 with flash translating too (#5700 A5). **Hidden backlog stays lite** (#5795): 7 of 30 sampled hidden pages fail the label (Persian, French, Hebrew-script); both engines invented Hebrew on a Judeo-Arabic leaf. | none | #4729, #5795 |
| Hebrew | 0.11M | lite | 4 refs. | exploratory | — |
| Persian | 0.09M | lite → flash for visible/new (this PR) | Typeset reads well apart from column order. A flash re-read lifts the English +1.00 [0.33, 1.67] (#5700 A5). **Manuscripts: no engine passes** (0.41 sequence accuracy). **Hidden backlog stays lite** (#5795): label holds (25/27) and flash wins 9–0 by eye on manuscripts, but flash looped on 1 of 30 pages against 0 for lite, which fails the preregistered rule. | exploratory (21) | #5525, #5559, #5795 |
| Mongolian | 0.08M | lite | Nothing. | none | #5664 |
| Syriac | 0.07M | Kraken lane | Kraken (Sophro MS 19% line CER, 40/0 vs lite). Gemini fabricates. | directional | #4746, #4883 |
| Korean | 0.07M | lite | Nothing. | none | — |
| Spanish | 0.07M | lite | `agr` 0.972, passes. | none | #4729, #5573 |
| Javanese | 0.06M | lite | Nothing. | none | — |
| Japanese | 0.05M | lite (+ NDL pilot) | Cursive pre-1868: **NDL v3**; Gemini invents text. Typeset: unmeasured. | exploratory (0 refs; by-eye checks) | #4743, #5100 |
| Armenian | 0.03M | lite | `agr` 0.963, passes; 9 refs. | exploratory | #4729 |
| Ge'ez | 0.02M | lite → flash for visible/new (this PR) | `agr` 0.47, 9/20 catastrophic. Hidden backlog: 2 books not held, 1 page sampled, undecided (#5795). | none | #4729, #5795 |

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
