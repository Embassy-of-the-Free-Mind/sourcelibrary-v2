---
stage: ocr
measure: [accuracy, judged]
languages: [lzh]
scripts: [Hani]
canons: []
n_books: 94
n_pages: 94
verdict: "Text-only AI punctuation (句读) matches CBETA's breaks at F1 0.905 (sentence-final F1 0.857 on modern-style pages), but on 30 Siku pages a blind Opus judge with the image found a sense-changing break on 13/30 pages (rule allows 3), so no punctuation layer is built."
status: rejected
decision: "Do not build a punctuation reader layer from text-only arms (#8140 decision rule 3 fails)"
feeds: [surface]
issue: [8140, 8035]
router_evidence: "none — a punctuation layer over existing text; no OCR or translation route compared"
defect_rates: "none — breaks were judged fine/debatable/harmful, not misleads or wrong_text per 1,000 words"
---
## 2026-11-04 · Can a model punctuate our Chinese text (句读) well enough to serve it as a layer? (#8140)

**Question.** 168 of 169 random Chinese pages we serve have no punctuation. Can a model insert marks, never changing a character, well enough to build a reader layer? And which arm does it better: gemini-3.8-flash-low on `agy -p` or Opus on `claude -p`, both on subscriptions? Prereg: `PREREGISTRATION-zh-punct-8140.md`, committed (418758e9b) before any arm ran. The decision rule is #8140's, unchanged.

**Answer.** **No layer.** Rules 1 and 2 pass. Rule 3 fails: 13 of 30 Siku pages had at least one harmful break, and the rule allows 3.

### Design

- **Frame A (key = CBETA).** One page per book from the 66 `cbeta-xml-p5` books of #6101, seeded at Mulberry32(8140), each with at least 100 Han characters (`zh-punct-8140/draw-A.json`).
  - **The key is punctuated.** It has a median of 0.19 marks per Han character, measured on the draw before any arm ran.
  - **Two styles.** 39 pages use modern punctuation. 25 use only 。 as a generic break; these include all 12 Siku manuscript pages of 五燈會元.
  - **Two exclusions.** Two lineage lists with no marks were excluded by the prereg rule (under 0.02 marks per Han character). That leaves **64 scored pages**.
- **Input.** CBETA's text with every mark, the `（）` around inline notes and all whitespace stripped. The note text stays.
- **Arms.** Same prompt, one page per call.
  - **G:** gemini-3.8-flash-low on `agy -p`, milo pool, no fallback.
  - **O:** Opus on `claude -p`, text only.
  - **G2:** G re-run on 30 pages, as the noise floor.
- **Guard.** Before any repair, the arm's marks are stripped and the result is compared to the input code point for code point. Then one of two policies:
  - **K (primary).** The input is served with only those insertions whose neighbours align on both sides.
  - **R.** Any changed page is rejected outright.
  - Under either policy, the served characters are always the input's.
- **Metrics.**
  - P/R/F1 on break positions (any mark vs none), micro-pooled.
  - P/R/F1 on sentence-final breaks (。？！ vs the rest), on the 39 modern-style pages only. On 。-only pages, 。 is not a sentence end.
  - Intervals use a book-cluster bootstrap (2,000 resamples). With one page per book this is the page bootstrap.
- **Frame B (does it carry over?).**
  - **Pages.** 30 non-Buddhist Siku Quanshu pages with Paddle OCR, one per book, seeded at Mulberry32(81402), no table pages (`draw-B.json`). The draw is the Siku mix as drawn: it includes reference works (說文, 集韻, 佩文韻府 ×3, 淵鑑類函 ×3).
  - **Arm.** G only, the chosen arm, under policy K.
  - **Judge.** A blind Opus judge with the page image rated each of 1,344 breaks as fine, debatable or harmful (changes the sense), and flagged breaks caused by OCR errors.
  - **Controls, mixed in blind.** 6 pages with shuffled breaks and 4 wrong-page pages.
- **Licence.** CBETA is CC BY-NC-SA 4.0. No CBETA text, arm output or excerpt is committed: only scores and page ids (`scripts/eval/results/zh-punct-8140/`).

### Result 1: frame A against CBETA (n = 64 pages, 64 books; policy K)

| measure | G (Flash) | O (Opus) |
|---|---|---|
| sentence-final F1, modern-style pages (n = 39) — **rule 2** | **0.857 [0.834, 0.877]** (P 0.812, R 0.906) | 0.860 [0.832, 0.884] (P 0.838, R 0.883) |
| break F1, all pages (n = 64) | 0.905 [0.888, 0.923] (P 0.862, R 0.953) | 0.904 [0.881, 0.925] |
| break F1, modern-style (n = 39) | 0.929 [0.918, 0.938] | 0.927 [0.899, 0.948] |
| break F1, 。-only (n = 25) | 0.865 [0.836, 0.896] | 0.864 [0.834, 0.895] |
| break F1, Siku 五燈會元 (n = 12) | 0.960 [0.940, 0.975] | 0.946 [0.915, 0.969] |
| break F1, not Siku (n = 52) | 0.899 [0.881, 0.916] | 0.899 [0.873, 0.921] |
| sentence-final F1, modern-style, **policy R** | 0.826 [0.775, 0.865] | 0.857 [0.825, 0.882] |
| pages with a changed character, **before the guard** | **5/64 = 7.8 % [3.4, 17.0]** | 1/64 = 1.6 % [0.3, 8.3] |
| calls / retries | 64 / 0 | 64 / 0 |
| median seconds per page | 6.6 | 8.9 |

- **Paired G − O.**
  - Sentence-final F1 (modern-style pages): Δ −0.003 [−0.019, +0.015].
  - Break F1 (all pages): Δ +0.001 [−0.010, +0.017].
  - This is a tie, so **G was chosen** as the cheaper arm, as preregistered.
- **Noise floor.** G2 against G on 30 pages:
  - The two runs agree at break F1 0.974 and sentence-final F1 0.953.
  - Against the key, G2 − G is Δ +0.001 [−0.003, +0.005].
  - G2 changed characters on 2/30 pages.
- **Changed characters, by hand from the diffs.**
  - **G's five pages** are variant swaps (個→箇, 楊→揚, 什→甚, 滿→滴) and one doubled 用.
  - **O's one page** is a reply cut off at 167 of 352 characters, plus an inserted 舉.
  - The guard drops all of these, and no changed character is served under K or R. But **a raw arm output is not safe to serve.**
- **Sentence-final F1 on all 64 pages** (G 0.695, O 0.691) is low because on 。-only pages CBETA's 。 marks every break. That number measures the style, not the arm.

### Result 2: frame B, Siku non-Buddhist pages, judged with the image (G, policy K)

- **The judge passed its gate** (40 calls; every call opened the image; median 13 s).
  - **Shuffled breaks:** harmful breaks found on 6/6 pages (median 85 % of breaks called harmful).
  - **Wrong page:** caught 4/4.
  - **Real pages:** none was said to mismatch its image.
- **Real pages (n = 30 pages, 30 books, 1,344 breaks).**
  - **Pages with ≥ 1 harmful break: 13/30 = 43 % [27.4, 60.8] — rule 3 needs ≤ 3/30. FAIL.**
  - **Discounting OCR-caused breaks** still leaves 8/30 pages with a harmful break, which also fails.
  - **Harmful breaks:** 31, or 2.3 per 100 breaks. The judge attributed 19 of them to OCR errors in the input.
  - **Debatable breaks:** 23, or 1.7 per 100.
- **Changed characters.** G changed characters on 8/30 pages before the guard. They were mostly corrections of OCR misreads (聞→闑, 葬→彝, 土→士, 巳→已). The guard drops them, so the layer would keep the OCR error and lose the correction.
- **Opened by eye** (the image and the punctuated text, read by the author of this file):
  - `210933-p131` 喻林. The source notes come after each quotation, and G attached each attribution to the next passage. Every attribution on the page shifts. **Confirmed harmful.**
  - `5e7f4a-p122` 儀禮集釋. 鄭注 runs into the main text. The indented note column is a layout cue that a text-only arm cannot see. **Confirmed.**
  - `0f0b67-p66` 淵鑑類函. A five-character poem line is split (相羣俊，學為名). **Confirmed.**
  - `5cbc46-p137` 周易口義. A 。 after 大正之道. **Borderline:** a comma would be fine.
  - `dfc0fd-p6` 證治準繩. There is no break after 而已, although G itself fixed 巳→已 there. **Confirmed.**

### Decision under the #8140 rule

1. **No changed character after the guard: PASS.** This holds by construction under K and R. Before the guard, characters changed on 7.8 % of frame-A pages (G) and 27 % of frame-B pages.
2. **Sentence-final F1 ≥ 0.85 on CBETA: PASS at the point estimate** (G 0.857). The CI's lower bound is 0.834, and under policy R G scores 0.826.
3. **Harmful breaks on ≤ 3/30 Siku pages: FAIL** (13/30).

**Do not build the layer.** The page-level rule is strict. At about 45 breaks per page, passing it needs a harmful rate below about 0.2 % of breaks, and G runs at 2.3 %. Two failure classes stand out:

- **OCR-caused breaks** (19 of 31). These are not the arm's fault, but a layer would serve them.
- **Layout the text arm cannot see:** note columns, small double-line notes, and source notes placed after quotations.

### Cost (both arms on subscriptions, $0 API)

- **G.**
  - **Calls.** 124 Gemini calls (64 G + 30 G2 + 30 frame B), one per page with no retries. Median 6.6 s per page.
  - **Quota.** The milo pool's weekly quota went from 0.4731 to 0.4694, about 0.003 % per call, or roughly 270 pages per 1 % of a week.
  - **At ~2M pages,** that is ~2M calls, or about 74 pool-weeks of one pool. This is rough: other jobs share the pool, and long pages cost more.
- **O.**
  - **Calls.** 104 Opus calls (64 arm + 40 judge). Median 8.9 s per arm page and 13 s per judge page.
  - **Quota.** The `claude -p` subscription meter is not visible from this box, so its quota cost per page is not measured.

### Not established

- **CBETA's punctuation is one editor's choice among several valid ones.** F1 against it understates any arm whose breaks are defensible but differ.
- **Frame A is Buddhist (Chan) text, and famous.** It is on the web, so memorisation is possible. G's variant "corrections" toward other editions hint at this, and so does its F1 of 0.96 on the Siku 五燈會元 pages. The scores may not carry to Confucian commentary, medicine or reference works, and frame B suggests they do not.
- **Frame B was judged, not keyed.** It has one judge (Opus) rating Gemini's output, and the Opus arm was never run on frame B.
- **An image-aware arm is untested.** It would see note columns and small notes, and it might fix the layout class of harmful breaks. Punctuating after a better OCR is also untested. Both are possible follow-ups; neither is in scope here.
- **n = 30 per page-level rule.** The 13/30 interval is wide [27, 61 %], but even its lower bound is far above 3/30.

### Files

- `scripts/eval/PREREGISTRATION-zh-punct-8140.md`. The prereg.
- `scripts/eval/zh-punct-8140/`. The draw, arm, score, frame-B draw and judge scripts, the prompt, and the page ids.
- `scripts/eval/results/zh-punct-8140/scoreA.json`, `scoreA-pages.jsonl`, `scoreB.json`. The scores, with counts and ids only.
