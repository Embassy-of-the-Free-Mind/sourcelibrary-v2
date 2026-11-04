---
stage: translation
measure: [judged]
languages: [zh]
scripts: []
canons: []
n_books: 173
n_pages: 1069
verdict: "On the 1,069 pages in 173 books that the near-blank-leaf predicate flags (≤ 15 Han characters of OCR body text, ≥ 150 English words), an image-grounded Opus screen calls 530 invented (49.6% [46.6–52.6]), 406 fine (38.0%), 65 commentary (6.1%) and 68 ocr_dropped (6.4%). On the 20 by-eye controls, run blind, it called 12/12 invented controls invented and 0/8 of the others. A by-eye check of 15 more pages agrees on 9/10 invented and 5/5 fine. Invention is a 3 Flash failure: 64% [61–68] of its 791 flagged pages, against 9% [6–13] on 3.1 Flash Lite preview and 2% [0–11] on 3.1 Flash Lite. By family: 植物名實圖考 90%, 武備志 71%, 三才圖會 67%, 道德經 and Legge 3%."
status: undecided
decision: "Owed: withhold the 518 Opus-confirmed invented pages not already withheld (137 books; withhold-candidates.tsv) through withhold-stale-translations.mjs by book, with reason by-eye-invented-english-5274? Nothing has been withheld by this run. The 68 ocr_dropped pages (reocr-candidates.tsv) are a re-OCR work list, not priced here."
superseded_by: null
issue: [5274]
router_evidence: "none — a screen of stored pages that one predicate flagged; translation models were not assigned at random, so no route k/n is added"
defect_rates: "none — the verdict is a per-page invented/fine/commentary/ocr_dropped class, not a minor/major defect grade; counts by model and family are in scripts/eval/results/zh-near-blank-screen-5274/summary.json"
---
## 2026-11-03 · Near-blank Chinese leaves: which of the 1,069 flagged pages carry English that is not on the leaf? (#5274)

PRIOR ART:
- `2026-11-03-chinese-translation-strata-5274.md` (PR #8006): found the pattern, defined the predicate and wrote `near-blank-candidates.jsonl.gz`. A by-eye sample there (20 books, one page each) gave 12 invented, 5 fine, 2 commentary and 1 ocr_dropped. That is 60% precision, which makes the predicate a work list, not a withhold list.
- `scripts/audit/detect-fabricated-translation.mjs` (#4584) needs an OCR declination to fire. Here the OCR is correct and short, so it cannot fire.
- `scripts/audit/leaf-shift-confirm-5021.mjs`: the image-grounded `claude -p` confirmer whose call and env handling the screen copies.

**Question.** Which of the 1,069 flagged pages show readers English that is not their leaf's text?

### Method

- **Script:** `scripts/eval/zh-near-blank-screen-5274.mjs`. Each call carries 4 pages from the candidate list, sorted by book. Each page gets its own image: `getPageSource(page)`, resized to ≤ 1,100 px. It also gets its stored OCR and its stored English (`translation.data`, or `translation_withheld.text` for the 12 pages withheld on 2026-11-03). The prompt does not say which pages are controls or carry withheld English.
- **Judge:** Opus 5.5 via `claude -p --model opus` on this box's subscription, with the Read tool only. Every call logged at least (pages + 1) turns, so each image was opened: 1,024 calls at 5 turns, 44 at 6, and 1 one-page call at 2. 268 calls in all. No API, no Gemini.
- **Verdicts:** `invented`, `fine`, `commentary` and `ocr_dropped`, as defined in the brief, each with a one-line reason. The prompt is `buildPrompt()` in the script.

### Gate (blind, 20 controls)

| run | invented controls called invented | other controls called invented | pass? |
|---|---|---|---|
| gate 1 | 12/12 [76–100] | 0/8 [0–32] | yes |
| gate 2 (prompt used) | 12/12 [76–100] | 0/8 [0–32] | yes |

Gate 1 passed. On the single `ocr_dropped` control (`6992f40ec8c6ac61574e74c4` p103, 卜居傳), its verdict was `fine`. I made `ocr_dropped` take precedence over `fine`, reran, and that call still came back `fine`. The judge is right. The stored OCR of that page holds the whole 卜居傳 preface, 187 Han characters, and it has not changed since 2026-03-21. The predicate recorded 14. So the predicate under-counts some pages; it is not reading the whole `ocr.data`. Re-counting Han characters on the whole stored OCR (`ocr_han` in the checkpoint), 40 of the 1,069 flagged pages have more than 30. The by-eye `ocr_dropped` label assumed the OCR was what the predicate measured. In the full run the controls agree 19/20, and this page is the one disagreement. The two `commentary` controls were called `fine` in both gates and `commentary` in the full run. That class boundary does not change the withhold list.

### Result

| verdict | pages | rate (95% CI) |
|---|---|---|
| invented | 530 | 49.6% (46.6–52.6) |
| fine | 406 | 38.0% (35.1–40.9) |
| commentary | 65 | 6.1% (4.8–7.7) |
| ocr_dropped | 68 | 6.4% (5.0–8.0) |

The 530 invented pages include the 12 already withheld, which leaves **518 withhold candidates in 137 books**.

| translation model | pages | books | invented | fine | commentary | ocr_dropped | invented rate (95% CI) |
|---|---|---|---|---|---|---|---|
| gemini-3-flash-preview | 791 | 152 | 509 | 206 | 65 | 11 | 64% (61–68) |
| gemini-3.1-flash-lite-preview | 231 | 19 | 20 | 171 | 0 | 40 | 9% (6–13) |
| gemini-3.1-flash-lite | 47 | 6 | 1 | 29 | 0 | 17 | 2% (0–11) |

| family | pages | books | invented | fine | commentary | ocr_dropped | invented rate (95% CI) |
|---|---|---|---|---|---|---|---|
| 三才圖會 | 450 | 60 | 303 | 95 | 46 | 6 | 67% (63–72) |
| 道德經 (Julien) | 172 | 1 | 5 | 129 | 0 | 38 | 3% (1–7) |
| other | 168 | 63 | 86 | 78 | 1 | 3 | 51% (44–59) |
| 武備志 | 118 | 23 | 84 | 28 | 5 | 1 | 71% (62–79) |
| Legge Chinese Classics | 62 | 6 | 2 | 40 | 0 | 20 | 3% (1–11) |
| 植物名實圖考 | 40 | 11 | 36 | 4 | 0 | 0 | 90% (77–96) |
| 名山圖 | 31 | 1 | 6 | 25 | 0 | 0 | 19% (9–36) |
| 本草綱目 (incl. Siku juan openings) | 28 | 8 | 8 | 7 | 13 | 0 | 29% (15–47) |

Three readings:
- **Invention follows the picture encyclopedias on 3 Flash.** Where a 三才圖會, 武備志 or 植物名實圖考 leaf carries a woodcut and a caption, 3 Flash writes the entry it expects: another plant's description, the next stance, a biography with a poem.
- **Most "fine" pages are bilingual editions, not near-blank leaves.** The predicate also flags European-language editions such as Julien's 道德經 and Legge's prolegomena, because their OCR carries few Han characters. On those pages the English is the printed text. On 58 of them the OCR kept only the footnotes, and those pages make up most of `ocr_dropped`.
- **The other `ocr_dropped` pages are maps and diagrams** (三才圖會 Na Jia circles, battle formations, 武備志 river maps) whose dozens of labels the OCR skipped.

### By-eye check (15 pages, image opened; `results/zh-near-blank-screen-5274/byeye-check.jsonl`)

The sample is seeded, excludes the controls, and has 10 `invented` and 5 `fine`.

- **invented: 9/10 agree [60–98].** The one disagreement is `6992cd5c43713c66ea63600f` p13, the 漢明帝 portrait. Its English describes the portrait and then gives a biography (Buddhism, Ban Chao) in an explanatory voice, not presented as the leaf's text. By eye I would call it `commentary`. It is borderline: a reader may still take it for the page. Every other invented page carries entry text that is not on its leaf: the flatfish entry, the Gongshu Ban door-knocker passage, the Spirit Drum's six faces, the Xu Xuanping biography and poem, a second staff stance, and an album caption on a blank flyleaf.
- **fine: 5/5 agree [57–100].** Three are caption-plus-picture descriptions. The other two are a typed English note and a Legge prolegomena page reproduced as printed.

### Limits

- The by-eye check suggests up to ~1 in 10 `invented` calls is commentary, not invention. Withholding those pages hides English that is not wrong but is unsupported by the leaf. That is the conservative error for a reader.
- The screen only covers what the predicate flags. Because the predicate under-counts some OCR (see Gate), it may also miss pages, so its recall is unknown.
- Each page was judged once. Agreement between two calls was not measured.

### Outputs (`scripts/eval/results/zh-near-blank-screen-5274/`)

- `verdicts.jsonl`: book_id, page_number, verdict, reason, translation model, OCR model, `withheld_before`, family
- `withhold-candidates.tsv`: 518 invented pages not already withheld
- `reocr-candidates.tsv`: 68 ocr_dropped pages
- `summary.json`: counts, intervals, tables and controls in place
- `byeye-check.jsonl`

Nothing was written to `pages` or `books`.
