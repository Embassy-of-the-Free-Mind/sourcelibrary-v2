---
stage: translation
measure: [judged]
languages: [zh]
scripts: []
canons: []
n_books: 120
n_pages: 120
verdict: "On 120 live Chinese books (one interior page each), drawn in 10 strata of translation model × transcription engine and weighted back by live translated pages, the Opus judge with the page image rated 63.8% of pages fidelity ≥ 4 [50.8–77.7]. It found a major English defect on 32.5% [19.2–45.9] (0.99 per 1,000 English words [0.64–1.35]). Counting a misread it saw in the image too, 56.0% [44.7–65.8] of pages are wrong for a reader. Reference works (類書, 小學) fare worse than running prose: major 50.7% vs 20.5%. By model, 3 Flash pages carry a major defect on 49.5% and Gemini 3.8 Flash pages on 7.7%; the Opus pages carry none. Gate passed: swap 15/15, drop 15/15, repeat 15/15 within one."
status: informational
decision: "Seven pages whose English is not their leaf's text (six near-blank leaves with invented entries, one transcription of another leaf) are held and withheld (contained, #5274). A predicate for the near-blank-leaf pattern flags 1,069 pages in 173 books; they are listed for a detector PR, not withheld. The monthly audit now carries a 60-book Chinese strata oversample (draw.mjs --zh-strata 60), and score.mjs weights it back so the headline keeps its estimand. No route or prompt changed."
superseded_by: null
issue: [5274, 7968, 7651]
router_evidence: "none — a stratified draw of stored pages; translation models and transcription engines were not randomly assigned to books (the model follows the book's lane and date), so no route k/n is added"
defect_rates: "none — this judge grades English defects minor/major, not misleads/wrong_text; major English defects per 1,000 English words by stratum, model, engine, kind and hand tag are in scripts/eval/results/zh-translation-strata-5274/zh-summary.json"
---
## 2026-11-03 · Chinese translation quality by stratum: model × engine × kind of text × hand (#5274)

PRIOR ART:
- `2026-11-02-translation-on-7866-draw-7968.md` (#7968): this judge, prompt and gate, on #7866's frame. Chinese had 14 books and 66 pages: 29% of pages had a major English defect and 58% were wrong end to end. The interval was wide, and that frame was stratified by OCR confidence, not by translation model. This entry draws Chinese on its own and stratifies by the translation side.
- `2026-10-30-siku-translation-error-types-5600.md` and `2026-10-29-siku-lane-sampler-seed-7611.md`: the Siku lane (3.8 Flash on Siku manuscripts, same judge family). The Siku books here fall in the `3.8-flash|paddle` and `3.8-flash|other` strata.
- `2026-10-28-ft-untranslated-sample-7651.md` (#7651): 83% of Chinese books with English are the first English ever. For most of these pages, no other English exists to check against.
- `scripts/eval/translation-corpus-audit/MONTHLY.md`: the monthly audit, which drew ~6 Chinese books a month before this change.

**Question.** Chinese is the largest translated non-European language: 2,904 live books with English, 352,903 translated pages on 2026-11-03. It is also the least checked. Where in it is the English wrong for a reader: which translation model, which transcription engine, reference works or running prose, manuscript or print?

### Method

- **Frame.** These are live books (`visible ≠ false`, `hidden ≠ true`, `pages_count > 0`, `pages_translated > 0`) with `language` Chinese (2,818) or Classical Chinese (86). The draw is draw.mjs's unit: one interior page (15%–95% of the book), `ocr.data` ≥ 200 characters, `translation.data` ≥ 100, `translation.source` ai or batch_api, no `edited_by`, and an excluded page_type list.
- **Strata** (`zh-strata.mjs`, recorded on every item as `zh`):
  - *Translation model* is `translation.model` through arm.mjs: 3 Flash (`gemini-3-flash-preview`), Flash-Lite (`gemini-3.1-flash-lite` and `-preview`), 3.8 Flash (`gemini-3.8-flash-*`) or Opus (`claude-opus-*`).
  - *Transcription engine* is `paddle` (PaddleOCR-VL), `gemini` (any Gemini OCR) or `other` (Claude Opus OCR, CBETA import, unstamped).
  - These two are the design strata. A stratum is non-empty with ≥ 12 books and ≥ 0.1% of pages. 10 strata qualify. Two do not: Flash-Lite|other (72 pages) and Opus|other (2 pages). They are listed, not drawn.
  - *Kind of text* is recorded on each item and post-stratified.
    - A book is a *reference* work when its catalogue class is 類書類 (encyclopedias) or 小學類 (lexicons, character and rhyme dictionaries).
    - With no 類-level class, the title decides: it names a reference genre (類聚, 韻府, 字典, 爾雅, 說文 …), or it is one of 17 well-known Siku 類書 (子史精華, 圖書編, 三才圖會, 玉海 …).
    - Everything else is prose. The full rule is in `zhKindOf`.
  - *Hand* is the page's `script_type` **tag** (handwritten → manuscript, printed → print, mixed, untagged). These are classifier tags, not readings of the hand.
- **Allocation.** 12 books per stratum, 120 in all, seed 20261103 (`draw.mjs --langs Chinese --scale 0 --zh-strata 120 --zh-min 12 --zh-langs "Chinese,Classical Chinese" --zh-extra 48`). Every stratum filled in 12–24 visits. 29 books are reference works and 91 are prose. By hand tag: 55 manuscript, 40 print, 25 untagged.
- **Weights.** An item's weight is its stratum's share of live translated pages divided by the books judged in it. A cut by kind or hand is therefore post-stratified within the strata. Two other weightings are kept as sensitivities. The book-random estimand (`zh-summary-books.json`) gives ≥ 4 67.3%, major 29.4% and wrong end to end 50.4%. Weighting each book by its pages in the stratum gives 67.3%, 28.9% and 56.6%. CI = 95% bootstrap, books resampled within stratum, 4,000 draws.
- **Judge.** `claude -p --model opus` on the box's subscription. The prompt is JUDGE-PROMPT.md + IMAGE-ADDENDUM.md, byte-identical to #7968's prompt. There were 11 packets of ≤ 15 items, 4 running at once. Each item has the served image (`getPageSource`, ≤ 1800 px). 165/165 verdicts parsed and every image was seen. $0 API.
- **Definitions** (analyze-7866-join.mjs's definitions):
  - *major*: a defect of severity major.
  - *misread*: the judge set `ocr_misread` or `ocr_wrong_leaf` from the image.
  - *wrong end to end*: major OR misread.
  - *inherited*: a major defect on a page with a misread.

  No #7866 transcription grade exists for these pages, so the inherited share rests on this judge's own misread flag. #7968 found that flag to be a floor.

### Gate

| control | caught | need |
|---|---:|---:|
| swap (fidelity ≤ 2) | 15/15 (15 flagged wrong_page) | 14/15 |
| drop (omission flagged) | 15/15 | 13/15 |
| repeat (within one point) | 15/15 (11 exact) | 14/15 |

**PASS.** All controls come from the Chinese frame: each swap takes another Chinese page's English. The four non-exact repeats moved by one point (5↔4 three times, 3→4 once).

### Results (weighted to live translated pages, 95% CI)

| measure | value |
|---|---|
| fidelity 1 / 2 / 3 / 4 / 5 (books) | 4 / 6 / 15 / 43 / 52 · weighted 1.8 / 3.3 / 31.1 / 38.7 / 25.0% |
| fidelity ≥ 4 | 63.8% [50.8–77.7] |
| fidelity ≤ 2 | 5.1% [2.7–7.7] |
| pages with a major English defect | 32.5% [19.2–45.9] (24 of 120 books) |
| major English defects per 1,000 English words | 0.99 [0.64–1.35] (45,766 words) |
| the judge saw a misread or wrong leaf | 39.1% [25.4–52.3] |
| **wrong end to end** (major OR misread) | **56.0% [44.7–65.8]** |
| inherited: major pages with a misread | 48.1% [18.9–75.7] |
| P(major \| misread) vs P(major \| no misread) | 40.0% [15.1–66.1] vs 27.8% [12.6–42.0] |
| share of major pages the misread accounts for (attributable fraction) | 14.7%, interval spans zero [−21–54] |

This agrees with #7968's Chinese cell (29% major, 58% wrong end to end) on a frame drawn independently and nearly twice as large. A Chinese page in the library is wrong for a reader about as often as it is right. About half of that comes from a translator-made major error (an invented entry, a mistranslated clause, a dropped line). The rest is a transcription misread the English faithfully carries. The two overlap on half the major pages. The misread raises the major rate only from 28% to 40%. So most major English defects here are the translator's. That differs from #7968, where 16 of 19 Chinese majors sat on a bad #7866 grade. There the comparison was against #7866's stricter grade; here only this judge's floor flag is available.

**By stratum** (unweighted; each stratum is 12 books)

| stratum (model · engine) | % of live pages | 1/2/3/4/5 | ≥ 4 | major | major / 1k words | misread seen | wrong end to end | inherited |
|---|---:|---|---:|---:|---:|---:|---:|---:|
| 3 Flash · Paddle | 44.1 | 0/0/7/5/0 | 42% | 50% | 1.11 | 58% | 83% | 3/6 |
| 3.8 Flash · Paddle | 26.9 | 0/0/1/5/6 | 92% | 8% | 0.25 | 8% | 8% | 1/1 |
| Flash-Lite · Paddle | 7.1 | 0/4/3/5/0 | 42% | 58% | 3.89 | 42% | 83% | 2/7 |
| Flash-Lite · Gemini | 7.0 | 0/0/2/5/5 | 83% | 17% | 0.70 | 67% | 67% | 2/2 |
| 3 Flash · Gemini | 5.5 | 4/2/0/4/2 | 50% | 50% | 1.43 | 17% | 67% | 0/6 |
| Opus · Paddle | 5.2 | 0/0/0/0/12 | 100% | 0% | 0 | 33% | 33% | 0/0 |
| 3.8 Flash · Gemini | 1.9 | 0/0/0/4/8 | 100% | 0% | 0 | 17% | 17% | 0/0 |
| Opus · Gemini | 1.0 | 0/0/0/1/11 | 100% | 0% | 0 | 33% | 33% | 0/0 |
| 3 Flash · other | 0.8 | 0/0/2/7/3 | 83% | 17% | 0.30 | 25% | 42% | 0/2 |
| 3.8 Flash · other | 0.4 | 0/0/0/7/5 | 100% | 0% | 0 | 0% | 0% | 0/0 |

**By model, engine, kind and hand tag** (weighted, post-stratified within stratum)

| cut | books | fidelity ≥ 4 | major | major / 1k words | misread seen | wrong end to end |
|---|---:|---:|---:|---:|---:|---:|
| 3 Flash | 36 | 43.2% [20.6–67.2] | 49.5% [25.5–73.2] | 1.13 | 53.3% | 80.9% [59.6–96.5] |
| 3.8 Flash | 36 | 92.3% [77–100] | 7.7% [0–23] | 0.23 | 8.8% | 8.8% [0–25.2] |
| Flash-Lite | 24 | 62.3% [45.5–79] | 37.7% [21–54.5] | 2.54 | 54.0% | 75.1% [58.3–91.7] |
| Opus | 24 | 100% | 0% | 0 | 33.3% | 33.3% [12.5–56.9] |
| engine Paddle | 48 | 61.4% | 34.2% [18.2–49.8] | 1.02 | 39.2% | 56.0% |
| engine Gemini | 48 | 74.6% | 25.4% [11.9–39.7] | 0.93 | 40.3% | 58.2% |
| engine other | 24 | 88.9% | 11.1% [0–27.7] | 0.21 | 16.6% | 27.7% |
| **reference work** | 29 | **40.1% [15.9–66.5]** | **50.7% [23.7–77.7]** | 1.08 | 47.5% | **70.6% [47.7–90.3]** |
| running prose | 91 | 79.5% [64.7–91.2] | 20.5% [8.8–35.3] | 0.90 | 33.5% | 46.3% [31.3–61.3] |
| hand tag manuscript | 55 | 62.4% | 32.9% | 0.83 | 40.8% | 55.9% |
| hand tag print | 40 | 69.8% | 30.2% | 2.21 | 37.2% | 54.6% |
| untagged | 25 | 67.2% | 32.8% | 1.01 | 27.0% | 59.8% |

- **The model cut is not a model comparison.** The model follows the book. 3.8 Flash and Opus pages are the recent Siku and hard-script lanes. Their books come with fresher transcriptions and a later prompt. 3 Flash pages are the oldest Chinese English. Read it as "where the bad English sits", not as "which model is better".
- **3 Flash on PaddleOCR is the problem stratum.** It holds 44% of live Chinese translated pages, and 83% of its pages are wrong end to end. 8 of its 12 sampled books are Siku reference works (佩文韻府, 駢字類編, 圖書編), whose English predates the Siku lane's re-translation.
- **The hand tag does not separate anything here** (manuscript 32.9% vs print 30.2% major), unlike Latin (#7947). In Chinese "manuscript" is mostly the Siku 寫本: a regular copyist's hand that PaddleOCR reads much like print.

**Major defect kinds** (share of pages carrying one, weighted; one example each)

| kind | pages | weighted % of pages | example (source → English) |
|---|---:|---:|---|
| mistranslation | 9 | 15.2 | 天文圖註祥異賦 p. 300: 發屋折木者糴大貴 ("winds that unroof houses and break trees: grain prices soar") → "indicate a fear of a great uprising", with a note on a non-existent 大首 "rebel leader" **(checked by eye)** |
| omission | 4 | 5.4 | 本草綱目 (vol. 5, 卷八) p. 52: 一百五十年而成磁石二百年而成鐵又二百年…而成銅 → "After 150 years, it becomes magnetite. After another 200 years… it becomes copper". The iron stage, the point of the passage, is gone **(checked by eye)** |
| invention | 10 | 5.1 | 三才圖會 p. 54: the leaf is a woodcut captioned 牽牛子 and nothing else. The English adds a full 威靈仙 (Chinese Clematis) entry: habitat, form, harvest days **(checked by eye, contained)** |
| name | 2 | 4.3 | 佩文韻府 室 entries: 上謂王曰…王頓首謝曰 (the Emperor to King Xiao of Liang) → "the Emperor said to the Prince…" |
| garble_passthrough | 1 | 3.7 | 佩文韻府: the transcription's fragment 李白詩吾亦 遊詩原是人間 (headword marks lost) → a fluent "I am also an inhabitant of the world" |
| inversion | 4 | 2.4 | 思益梵天所問經 卷三 p. 112: 梵天言誰能見法答言不逆諸因緣法者 ("Who can see the Dharma? — Those who do not go against dependent origination") → "Who can go against the dharma of dependent origination?", with the answer dropped **(checked by eye)** |
| number | 1 | 0.6 | 千金要方 p. 60: 以水一升煮取半升 … 合一升半煎取八合 → "using 6 sheng of water … boil in 6 sheng of water"; 芍藥 and the honey dropped |

**What a reader of a reference-work page gets wrong.** 29 reference pages; 10 rated ≤ 3, against 15 of 91 prose pages. Three things, in order of harm:

1. **A whole entry that is not on the leaf.** 4 of the 5 sampled 三才圖會 pages are woodcut leaves with only a caption: 牽牛子, 瓜藤, 狗國, 大功服圖. Their English is a full entry: habitat, uses, ethnography, mourning grades. The model carried it in from the neighbouring page's context. Its own `<meta>` says so ("the descriptive text is a direct continuation of the entry … from the previous page"). A reader sees a confident article under a picture that carries one word. These are the four fidelity 1–2 reference pages.
2. **The headword an entry hangs on.** A 韻府 or 子史精華 entry quotes its headword as ditto marks (丨丨). PaddleOCR drops or mangles them. The English then leaves the headword `<unclear>`, invents a filler, or splits one citation into several fake headings. The reader gets the quotations without knowing which word each one illustrates. That is the purpose of the book. The judge names it on 4 of the 7 sampled 佩文韻府 / 駢字類編 pages on 3 Flash · Paddle, and 6 of the 7 score 3.
3. **A misassigned speaker or source inside a citation** (佩文韻府 室: the King turned into "the Prince"; 駢字類編: a *Shiji* clause rendered as "Below this, it is noted …"). The quotation is attributed and readable, but says something else.

The 3.8 Flash re-translations of the same genre (子史精華 ×8, 佩文韻府 ×2, all on `other`) expand the ditto marks correctly. They score 4–5.

### By eye

The images were opened for these items:

- **The kind rule on 20 drawn pages** (title + image): 19 right. The miss was a 四庫全書薈要 copy of 子史精華, which carries only `子部` and no class. Rule 2 now covers it with a list of well-known Siku 類書 titles, and a re-draw with the same seed gives the identical sample.
- Page shape inside the classes:
  - Two 圖書編 pages (類書) read as running prose: an astrological passage and a memorial on firearms. The kind is right by genre, but the page shape is not.
  - Two "prose" pages are music notation (詩經樂譜, 律呂正義後編), and one is a diagram (武備志).
  - Two 三才圖會 pages are illustration-only. These passed draw.mjs's ≥ 200-character OCR rule only because the transcription carries a `<detected-images>` JSON block. That is a hole in the interior-text rule, noted below.
- **Three defect examples against the image:** mistranslation, omission and inversion, all marked in the table above. In each, the leaf carries the transcribed text, and the defect is the translator's.

### Contained (`.claude/docs/invariants/containment-on-finding.md`)

Seven pages whose English is not their leaf's text were confirmed with the image. Each is held (six were already held under #6388's `paddle-zh-6388-ocr-only`; the seventh, 69af1226…, now has reason `by-eye-invented-english-5274`) and withheld (`withhold-stale-translations.mjs --by-eye-pages`, snapshot in `page_revisions`):

| book | page | finding |
|---|---:|---|
| 三才圖會(九十八) `6992ce7177d26f9321776eb3` | 54 | woodcut captioned 牽牛子; English is a 威靈仙 entry |
| 三才圖會(三十二) `6992cd8043713c66ea636ec0` | 53 | woodcut captioned 狗國; English adds a trade sentence and an ethnographic entry |
| 三才圖會(一百一) `6992ce7c673ee1e40e320b48` | 54 | woodcut captioned 瓜藤; English is a 獨用藤 entry |
| 三才圖會(六十四) `6992cdf281c9d7efb84d0ee0` | 36 | woodcut captioned 大功服圖; English is a page of mourning-grade rules |
| 植物名實圖考(十七) `6992cf3af5b4f75c1a4c8467` | 55 | root woodcut, fold label 石草 卷十二 only; the transcribed labels and the English exposition are not on the leaf |
| 營造法式 卷十~卷十四 `6992c906453c7175dc1bcc1b` | 72 | blank end-of-juan leaf, 營造法式卷十一 only; English adds a body text on scripture cabinets |
| 欽定新曆測驗紀略 `69af1226b8bbede5a0084e63` | 56 | the leaf reads 初一日火星後天二度 … 木星 … 在酉宮; the transcription and English are of another leaf (金星 寅宮, 水星 丑宮). Both stored images show the same leaf |

**Listed, not contained.** The pattern is a long English on a leaf with no text. As a predicate: ≤ 15 Han characters of body text (tags and `<detected-images>` removed) and ≥ 150 English words. It flags **1,069 pages in 173 books**. By translation model: 3 Flash 791, Flash-Lite 278. In this sample, 6 of the 10 pages with ≤ 15 Han characters of body text carried invented English. The other four were rated 4–5. The list is `near-blank-candidates.jsonl.gz`. It is a detector's output, so it goes through a dry run, a by-eye sample and approval before anything is withheld. One page imports part of the next leaf (笠翁一家言 p. 22, fidelity 3). It is not contained, because the page's own text is there.

### Part 2 — the monthly Chinese stratum

- `draw.mjs --zh-strata N` draws N more Chinese books after the main sample, stratified by model × engine with a floor of N/10 a stratum and the rest by page share. Items are kind `zh`, and every Chinese item, main or zh, carries `zh` {model, engine, stratum, hand, kind}. The main sample is drawn first and is unchanged.
  - Checked: the 2026-11-01 seed with and without the flag gives the same 103 main items. Without the flag, items.jsonl is byte-identical to the old draw.mjs's, and every manifest item has the same id, book, page and text hash. The manifest only adds `zh` on Chinese items and carries the served image.
  - Also changed in draw.mjs: control swaps take further passes only when the first falls short (a Chinese-only run), and the item image is now `getPageSource` (the served image), not `display_photo`.
- `monthly-draw.sh` now passes `--zh-strata 60`. A dry run gave 60 zh books in 9 strata (3 Flash|other has fewer than 12 books when Classical Chinese is out of the frame). The draw took 92 s. The shape check refuses a draw with fewer than 45 zh books. **The crontab line does not change** (it calls the script). Hetzner runs the auto-pull checkout, so the 2026-12-01 draw is the first with the stratum. Stage 2 is unchanged: it judges ~14 packets instead of ~10.
- `score.mjs`: when the draw log carries `zh_strata`, the Chinese cell of the corpus estimate (and its bootstrap) is the stratum-weighted mean over main + zh books. Each stratum is weighted by `w_books`, the probability that the book-random main draw lands in it. The language weights do not move, and the Chinese cell keeps the estimand every other language has. The oversample only narrows the cell.
  - `report.md` shows the cell with and without the oversample.
  - With no `zh_strata`, report.json is byte-identical to the old score.mjs on the 2026-09-30 run.
- `analyze-zh-strata.mjs --dir <run> [--weights books]` prints the strata tables (no database). Monthly cells are 6–9 books a stratum: read them pooled by quarter. Stage 2 is text-only, so its "misread seen" and "wrong end to end" columns are empty there. This entry is their baseline.

### Limits

- One judge. Nobody has checked the verdicts beyond the 7 contained pages, the 3 defect examples and the 20 kind checks.
- Strata cells are 12 books. Rates within a stratum are ± ~25 pp, and the weighted headline interval is ± ~13 pp.
- The model and engine strata are observational. The model follows the book's lane and date, so no cell is a controlled effect of a model or an engine.
- The kind rule is catalogue-first. A 類書 page can be running prose, and a prose-class book can carry tables, notation or diagrams.
- The hand cut is a tag, not a reading.
- The inherited share rests on the judge's own misread flag, a floor, so some majors counted translator-made may sit on misreads the judge missed.
- Two strata (Flash-Lite|other, Opus|other: 74 pages, 0.02%) were not drawn.

Artifacts: `scripts/eval/translation-corpus-audit/{zh-strata,analyze-zh-strata}.mjs`; `draw.mjs --zh-strata`; `score.mjs` (Chinese weight-back); `monthly-draw.sh`; `MONTHLY.md`. Results are in `scripts/eval/results/zh-translation-strata-5274/`: `manifest.jsonl`, `items.jsonl.gz`, `draw-log.json`, `book-weights.json`, `images.json`, `verdicts/opus/`, `report.{json,md}`, `zh-summary{,-books}.{json,md}` and `near-blank-candidates.jsonl.gz`.
