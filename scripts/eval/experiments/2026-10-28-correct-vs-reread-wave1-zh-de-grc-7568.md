---
stage: ocr
measure: judged
languages: [zh, de, grc]
scripts: [Hani, Latf, Grek]
canons: []
n_books: 23
n_pages: 575
verdict: "Opus correction of the stored lite text beat a Flash re-read in all three languages, as it did in Latin. Blind Opus readers, judging all three texts of each page against the image, called these pages misleading. Chinese, 75 pages in 3 printed books: lite 57, correction 5, re-read 37. German, 250 pages in 10 printed books: lite 63, correction 6, re-read 23. Greek, 250 pages in 10 manuscripts: lite 245, correction 87, re-read 221. Head to head, the readers preferred the correction over the re-read 61–7 in Chinese, 167–22 in German and 173–59 in Greek. A second-family judge (agy Flash-low, 30 pages per language) agreed in Chinese (20–10) and on the Greek pages Opus corrected (12–5). In German it split 14–15 where Opus split 21–1, so in German the margin over the re-read may be partly self-preference. On 2 of the 10 Greek manuscripts the corrector answered CONTAIN on every page: the served lite text is invented or a repetition loop."
status: informational
decision: "No production write. Recommended route per language: C (Opus correction of the lite text) for Chinese, German and Greek. This repeats #5924's Latin result in three more languages. Greek manuscripts are the weak case: corrected pages still come out misleading 22 of 185 times. CONTAIN pages (invented lite text) need a fresh read, which neither arm supplies. The strict 'no page worse than lite' bar fails in every language, for every arm, as in Latin. Every C page that failed it was a no-answer or a contain, where C serves the lite text unchanged; no correction made a page worse. Cost per 1K pages for the correction: about 4% of one Claude account-week in German, about 6% in Chinese and about 8% in Greek manuscripts. For the Flash re-read it is about 1.1 agy calls a page."
superseded_by: null
issue: [7568]
---
## 2026-10-28 · Correct the lite text with Opus, or re-read with Flash: Chinese, German, Greek (#7568, wave 1)
<!-- PRIOR ART: 2026-10-24-latin-lite-opus-correct-vs-flash-reread-5924.md (the Latin result repeated here) and 2026-10-27-correct-vs-reread-wave1-prereg-7568.md (this run's preregistration, a766b3241, and amendment 1, 0b6739837). -->

**Question.** On 250 lite-read Latin pages, Opus correcting the stored lite text in place beat a Flash re-read on every measure (#5924). Does that hold for Chinese, German and Greek?

**Design** (preregistered in `2026-10-27-correct-vs-reread-wave1-prereg-7568.md` before any draw or model read; amendment 1 came after the draws, before any read).
- **Sample.** For each language, books in terminal status `complete`, at least 70% lite-read, with the 25-page `spread` rule (`flash-reread-5924/w-draw.mjs`, seeds 75681/2/3) and a format screen by an Opus reader.
  - **Chinese: 3 books.** The terminal frame holds only 5 lite-read Chinese books. The screen dropped a Siku Quanshu hand copy and a Japanese kunten edition. Most Chinese lite pages are in `held` books, which are out of the frame.
  - **German: 10 printed books.**
  - **Greek: 10 manuscripts.** All 14 Greek candidates were manuscripts; per amendment 1, manuscripts stay in.
- **Arms.**
  - L: the stored lite text.
  - C: `correct.mjs --model=opus --per-call=10`, unchanged. C serves the correction, or L where the outcome is unchanged, contain or no-answer.
  - R: `cli-ocr.mjs read --model=gemini-3.8-flash-low`, unchanged, one page per call through agy.
- **Step T.** One blind Opus reader per book saw the image and all three texts as X/Y/Z, in a seeded order. It gave a verdict per text (misleading / flawed / sound, using #5924's `C-TASK.md` words) and the three pairwise preferences (`T-TASK.md`).
  - This differs from Latin, where each pair of arms had its own reader. Here one reader judges every arm under the same conditions.
- **(d) Second-family check.** agy Flash-low judged C vs R blind on 30 seeded pages per language where C ≠ R.

**Outcomes of the correction call.**
- Chinese: 71 corrected, 2 contain, 2 no-answer. Both no-answers were Opus output blocked by a content filter on the Lotus Sutra.
- German: 233 corrected, 16 unchanged, 1 contain.
- Greek: 185 corrected, 65 contain.
- R read every page. Gemini's filter cut the text short on 6 Chinese, 2 German and 32 Greek pages.

**Result** (`flash-reread-5924/results-7568/<lang>/score.json`; Wilson 95%)

| | n | misleading L | misleading **C** | misleading R | C vs R preferred (tie) | worse than L: C / R | agy judge C vs R (Opus, same pages) |
|---|---|---|---|---|---|---|---|
| Chinese (print) | 75 | 57 (65–84%) | **5 (3–15%)** | 37 (38–60%) | **61–7** (7), p < 10⁻¹¹ | 2 / 9 | 20–10 (26–3) |
| German (print) | 250 | 63 (20–31%) | **6 (1–5%)** | 23 (6–13%) | **167–22** (61), p < 10⁻²⁸ | 1 / 11 | **14–15** (21–1) |
| Greek (MSS) | 250 | 245 (95–99%) | **87 (29–41%)** | 221 (84–92%) | **173–59** (18), p < 10⁻¹³ | 65 / 14 | 13–17 (13–13) |
| Greek, the 185 pages C corrected | 185 | 180 | **22** | 157 | **173–4** (8) | 0 / — | 12–5 (13–1) |
| Greek, the 65 pages C contained | 65 | 65 | 65 (serves L) | 64 | 0–55 (10) | 65 by rule / — | 1–12 (0–12) |
| *Latin, #5924 (for reference)* | 250 | 111 | 31 | 20–32 | 131–43 | 1 / 7 | — |

- **Route (preregistered rule): C in all three languages.** Misleading(C) ≤ misleading(R), C is preferred, the sign test gives p < 0.05, and C halves L.
- **Bar (a), halving L:** C passes in all three languages. R passes only in German.
- **Bar (b), no page worse than L:** fails for both arms in every language, as in Latin. Every C page that failed is one where C serves L unchanged:
  - zh: 2 no-answers.
  - de: 1 contain on a blank image (below).
  - el: 65 contains. The prereg's "false contain" test only credits a reader's `not_this_leaf`. Here the readers called L misleading on 65/65 of these pages and named its text invented or looping; the corrector's reasons say the same.
  - **No correction made a page worse than lite.**
  - The R pages that failed bar (b) are misreads, Gemini filter cuts, and one German spread where R read only the right-hand page (by eye, below).
- **Bar (c), C beats R:** passes in all three.
- **Self-preference.**
  - Chinese: agy agrees, 20–10.
  - German: agy splits 14–15, against Opus's 21–1 on the same pages. Both families find few misleading pages there (agy: C 2, R 1 of 30). Read the German margin over R as "both good, C at least as good", not as a 167–22 rout.
  - Greek: agy and Opus agree once the pages are split. On corrected pages both prefer C (agy 12–5). On contained pages, where C serves the invented lite text, both prefer R.
- **Reader-noise check:** where C's text equalled L's, no reader gave the two different verdicts (0 mismatches in all three languages).
- **Facing strip.**
  - de: visible on 38 pages; read in by L on 13, C on 0, R on 0.
  - el: visible on 183; L 8, C 0, R 13.

**By eye** (image open, crops)
- **zh p82 (Lotus Sutra scroll).** C fixes L's 多寶佛塔品 → 分別功德品 and 八生, and keeps 六百八十萬億 where R has 八百.
  - Where the scroll is torn, C restores the lost characters (無生法, 陀羅尼門, most of panel 4) from the canonical sutra and tags them `<unclear>`. R restores them silently.
  - The reader counted L's "omission" of text that is lost from the leaf. On this damaged scroll the reader and C both lean on the known text. This is a caveat for damaged canonical texts.
- **zh p102.** C is sound. L drops two sentences. R has 梵王華 for 宿王華.
- **de 6a20…p15.**
  - C fixes L's invented margin note *Rom. 5.* → *v. 12.*, the initial (*Der Meinunge*) and *jhrer*. One slip: *verunehret* for *vervnehret*.
  - R normalises *außdrückliches* and *jhrer*.
- **de 69c8…p142 (a two-page spread).** R read only the right-hand page and dropped all 18 lines of p. 210. C keeps both pages, and puts one catchword into the body.
- **el 6993…p99 (Homeric cento).** Neither is clean.
  - C has *Ὀτρηρὸς* for *Ὀπτῆρ(ας)* and *Versus perfectus* for *ipfectus*.
  - R invents *φεύξασθαι*.
  - Both drift toward the printed Homer. C is better on layout and glosses.
- **el 69e8…p159 (Sextus).**
  - C rebuilds L's nonsense into the text, confirmed word by word: *ὁ ἄνθρωπος ἐπιβάλλει κρίνειν*, *τοὐναντίον συστηματική*, *ὁ νήπιος καὶ ὁ μεμηνὼς*.
  - R invents whole phrases (*ὁ ἄνεμος*, *ἐκ πλειόνων σύγκειται*).
- **de `69b51cda…` p264, the only German C "worse" page.** The archived image is a 267-byte blank JPEG (so are pp. 263 and 265). C correctly answered CONTAIN ("the leaf cannot be read"). L serves a Latin page that nobody can check against an image.

**Served text that is not the page** (found by the corrector, confirmed by the blind readers; not contained by this job, which writes nothing)
- **Greek, whole books:**
  - Lucian MS `699383a150654cbbe29179f7`: 25/25 pages are invented Greek or repetition loops.
  - Euclid *Elements* MS `6993881574305116d72cef37`: 25/25 pages are invented propositions or loops.
  - Proclus *in Rempublicam* MS `6993898ace15387065947977`: 15/25 pages.
- **Chinese:** Kunqu `69de98851b234a773e438912`, pp. 269 and 341 serve another leaf's text.

**Cost** (Claude subscription, box account dereklomas@gmail.com; $0 billed. agy: plan fee)
- **Corrections (list-price equivalent of the tokens):**

  | Language | Pages | Calls | Output tokens | List price | Per 1K pages |
  |---|---|---|---|---|---|
  | Chinese | 75 | 31 | 219K | $8.98 | $120 |
  | German | 250 | 30 | 377K | $18.53 | $74 |
  | Greek MSS | 250 | 46 | 1.18M | $42.05 | $168 |

  - Latin's $20.28 per 250 pages moved the account-week about 1%. On that scale a correction costs about **4% (de), 6% (zh) and 8% (Greek MSS) of an account-week per 1K pages**.
  - Greek manuscript calls ran 7–25 min each.
- **Whole job, wave 1** (corrections, 3 screens, 23 readers, by-eye): the weekly meter went **26% → 46%** (2026-10-27 21:00Z → 2026-10-28 02:35Z). Treat that as an upper bound, because the account is shared. Per language it was about zh 5, de 5, el 10 points.
  - The pace guard paused the Greek correction once (burn 6%/h, against a budget of 0.4%/h). It resumed after the window.
- **Flash re-read:** 636 agy calls for 575 pages (1.1 a page), about $0.66 per 1K pages at the plan fee.

**Human check** (Derek's addendum, for #7573): `scripts/eval/dataset/judge-human-check-7573/{chinese,german,greek}.jsonl`.
- Each file has one row per judged page: reader URL, image URL, the three arm texts, the Opus verdicts, defects and rationale, and the agy verdicts where drawn.
- 30 rows per language are marked `review: true`: the pages with the widest verdict spread, the C/R ties and the cross-family disagreements (`w-human.mjs`).

**Grade.** Exploratory. The samples are 3 to 10 books, the judge is single-family (with a 30-page cross-family check), and there is no human calibration yet (#7573 is that calibration). Chinese at n = 75 from 3 books is the thinnest.

Files: `scripts/eval/flash-reread-5924/`
- Scripts: `w-draw.mjs`, `w-set.mjs`, `w-packets.mjs`, `w-score.mjs`, `w-judge2.mjs`, `w-byeye.mjs`, `w-human.mjs` and `T-TASK.md`.
- `results-7568/<lang>/`: `sample.json`, `screen.json`, `stored-check.json`, `step-t.json` and `score.json`.
