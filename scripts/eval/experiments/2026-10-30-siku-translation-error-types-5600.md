---
stage: translation
measure: [judged, agreement]
languages: [zh]
scripts: [Hani]
canons: []
n_books: 50
n_pages: 50
verdict: "On 30 random served pages of the Siku Quanshu cohort (one per book, the current 1-per-call Gemini 3.8 Flash-low lane), AI reviewers (Opus, page image open) found 2.1 errors per page [1.6–2.7], of which 0.23 per page are high-risk (misleading where a reader cannot tell) [0.07–0.43]; 6 of 30 pages (20%, Wilson 10–37%) carry at least one. Most errors are low-risk: 16 of 30 pages can be shown as they are and 13 with a caveat. 6 of the 7 high-risk errors were made by the translator: meanings reversed, an entry dropped from a numbered list, one invented gloss. On 20 pages from the older Batch lane, reviewers found 5.65 errors per page [3.7–8.0] and 1.75 high-risk [0.85–2.8], with 10 of 20 pages (50%, 30–70%) affected. Those pages come from different books (encyclopaedias and dictionaries, none of the histories), so the gap is lane and genre together. Of those 35 high-risk errors, 12 were carried from OCR misreads and 19 involve the 丨 repeat marks that stand for a headword. A second Opus pass on 10 pages agreed on the page verdict 9 of 10 times (κ 0.84) and on which pages have a high-risk error 10 of 10. 2026-10-30, n = 50 pages / 50 books."
status: informational
decision: "The next fix is in the translator, not the OCR, for the served lane: polarity and attribution checks plus a rule against glosses that add names or dates (6 of 7 HIGH). For the encyclopaedias still on the Batch lane's English (佩文韻府, 子史精華, 駢字類編): expand the 丨 repeat marks to their headword before translating, and prefer the Kanripo witness (#7559) for the dictionary pages, where the OCR misreads rare characters. Two pages with invented terms were contained (withheld by eye)."
superseded_by: null
issue: [5600, 7503]
router_evidence: "none — an error-type characterisation of served English, no routing cell"
---
## 2026-10-30 · Siku translations: which errors, at what risk? (#5600)
<!-- PRIOR ART: scripts/eval/agy-per-call-7503/ (the judge setup, claude -p Opus with the page image; it counts "sense errors" as one bucket); .claude/docs/page-error-taxonomy.md (T7/T8/T10/O1/O6/T6 classes, used for the kinds). -->

**Question.** The #7503 route judge counts "sense errors" as one bucket (17/30 served pages). That bucket mixes wording slips with invented names. Which kinds of error do readers of the Siku English meet, and how many of them mislead?

**Design.** Frame: books held under the Siku lane's `HOLD_REASONS` (`scripts/batch/siku-translate-lane.mjs`). Arm A = the served lane (`translation.engine.call_site` `scripts/batch/cli-translate.mjs`, model `gemini-3.8-flash-low`, 349 books); arm B = the older block Batch lane (`scripts/lib/translate-batch-chained.mjs`, Gemini 3 Flash preview, 292 books). One page per book, seeded draw (mulberry32, seed 5600), AI translation, OCR ≥ 150 characters, translatable page (not furniture-only). Arm B books are disjoint from arm A. Judge: Opus via `claude -p` (l7a subscription, $0), one page per call, blind to arm (packets P01…P52 in seeded order). Each call saw the page image, the OCR, the served English (summary and keywords cut), and the last 2 lines of the previous page's source and English and the first 2 of the next page's source. Every error was returned as a span {source, English, kind, risk, evidence}. Kinds: INVENTED, WRONG-SENSE, OCR-CARRIED, OMITTED, SEAM, JUNK, STYLE. Risk: HIGH (a reader is misled and cannot tell), MEDIUM (misleading but noticeable, or a lost clause), LOW (cosmetic). A second, independent Opus pass read 10 pages (5 per arm, seeded). Intervals: by-book bootstrap (one page per book, so page = book), Wilson for shares.

**Errors per page, by kind** (pages with at least one in brackets):

| kind | A served (n=30) | B Batch (n=20) |
|---|---|---|
| WRONG-SENSE | 0.97 [0.60–1.33] (17) | 2.55 [1.35–4.10] (15) |
| STYLE | 0.37 (11) | 0.40 (7) |
| JUNK (furniture carried) | 0.23 (6) | 0.20 (4) |
| OCR-CARRIED | 0.20 [0.03–0.47] (4) | 1.40 [0.35–2.80] (9) |
| INVENTED | 0.13 [0–0.30] (3) | 0.55 [0.25–0.90] (8) |
| SEAM | 0.13 (4) | 0.25 (5) |
| OMITTED | 0.07 (2) | 0.30 (5) |
| **all** | **2.10 [1.57–2.67]** | **5.65 [3.70–7.95]** |

**By risk**

| risk | A | B |
|---|---|---|
| HIGH per page | 0.23 [0.07–0.43] (7 errors) | 1.75 [0.85–2.80] (35) |
| MEDIUM per page | 0.77 [0.40–1.20] | 2.20 [1.25–3.25] |
| LOW per page | 1.10 [0.83–1.40] | 1.70 [1.20–2.25] |
| pages with ≥ 1 HIGH | 6/30, 20% [10–37] | 10/20, 50% [30–70] |
| page verdict show / caveat / don't | 16 / 13 / 1 | 3 / 9 / 8 |

**Where the HIGH errors come from**
- **Arm A (7):** 6 made by the translator (4 WRONG-SENSE: a gloss reversed, 'Crown Prince' for the Son of Heaven, an edict's meaning reversed, a numbered list shifted by one; 1 OMITTED entry in that list; 1 INVENTED gloss giving 召南 a wrong surname and dates). 1 OCR-carried (希 for 帣). None at the seam. The served lane's risk is in translation: polarity, attribution, and glosses that add names or dates.
- **Arm B (35):** 20 translator-made (15 WRONG-SENSE, 5 INVENTED), 12 OCR-carried, 2 seam, 1 margin furniture read as a quotation. 25 of the 35 are on the 10 pages from the repeat-mark encyclopaedias (佩文韻府, 子史精華, 駢字類編), and 19 of the 35 involve the 丨 marks that repeat a headword: the translator invents a term for them or files a quotation under the wrong headword. The 12 OCR-carried errors are rare characters in dictionary and lexicon entries (康熙字典 headwords, rhyme-group words). Arm B drew no histories or classics and arm A drew 27 of 30, so **the A–B gap (1.52 more HIGH per page, [0.58–2.62]) measures lane and genre together, not the lane alone.**

**The two named seam pages, read by eye with the previous page and both images open.** 圖書編 vol 22 p33: 為正 completes p32's sentence (the year begins in the Yin month, taken as the first month), and the English instead makes the Zi and Chou months 'correct'. That is a HIGH seam error, and the page also carries the margin title as '<unclear>Shu Shu Bian</unclear>'. 圖書編 vol 77 p30: 王之 completes p29's 欲以火德王之 ('wished to rule by the Virtue of Fire'), and the English reads it as 'King Wen of Han'. The 宣室受釐 allusion does refer to Emperor Wen, so the name is an inference with the wrong title, not text from nowhere. The judge rated it MEDIUM. Neither page meets the containment bar: in both, the rest of the English is this leaf's text.

**Judge agreement (10 pages, two independent Opus passes).** Page verdict 9/10 (κ 0.84). Whether a page has a HIGH error: 10/10 (κ 1.0), and the HIGH count was identical on all 10 pages. Presence of each kind on a page: 64/70 page×kind cells (κ 0.79). STYLE was the least stable (7/10, κ 0.44), and INVENTED and WRONG-SENSE agreed 10/10. Risk presence: 28/30 cells (κ 0.86). Error totals per page differ by 0–4 (mostly STYLE and LOW).

**Contained (by eye, image open, `withhold-stale-translations.mjs --by-eye-pages`, #5600).** 御定佩文韻府 vol 719 p47: the 丨丨 marks for 拂拭 are rendered 11 times as an invented term 'shanghui' ('producing brilliance'). 御定子史精華 vol 71 p70: 因丨丨丨丨而丨丨丨丨 (斟酌前史 / 譏正得失) is rendered as invented terms 'Zheng Qi Ci Ju' and 'Shen Qi Tan Lun'. Both books were already held. The other INVENTED findings are notes or glosses on pages whose body is the leaf's text (前漢書 vol 33 p47; 子史精華 vol 129 p4 and vol 70 p39). They are recorded as findings, not contained.

**Not checked.** No human reader of classical Chinese. One AI judge family (Opus) for both passes. 50 pages, so a kind seen on 2–4 pages has a wide interval. Arm B's books are a different genre mix from arm A's. The served lane was not measured on the encyclopaedias, so this does not show that it fixes the 丨 problem.

Artifacts: `scripts/eval/siku-error-types-5600/` (`draw.mjs`, `draw.json`, `prep.mjs`, `judge.mjs`, `score.mjs`, `results.json` with every HIGH finding and its page URL, `eye.mjs`). Packets, images and raw replies are in the job's scratch directory.
