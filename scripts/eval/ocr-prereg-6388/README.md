# ocr-prereg-6388 — three OCR routing questions on a random sample of our own books

PRIOR ART: issue #6388 (the binding preregistration; this README writes down only what the issue leaves to the
draw script), `.claude/docs/quality-rubric-and-sampling.md` §6.1 (frame, interior-page rule), `.claude/docs/eval-design.md`
§3 and §7 (one page per book, paired by default, A-vs-A arm), `scripts/eval/latin-cli-pilot-6375.mjs` (the seeded
book-then-page draw shape and the production lite call copied here), `scripts/eval/run-cli-arm.py` (the `agy -p`
runner, reused unchanged), `scripts/eval/lib/metrics.mjs` (the CER kernel and normalisers, reused unchanged),
`scripts/eval/lib/paired-stats.mjs` (`makeRng`, `bootstrapCI`). `lib/sampling.mjs sampleOnePagePerBook` does not
fit: it draws books with Mongo `$sample` (the issue forbids it) and drops pages with under 200 characters of
production OCR (the issue keeps refusals and empty pages in).

Issue: #6388. Method: #6203. Why: #6386.

## What is fixed here, before the draw (commit this file before `draw.mjs` runs)

### Frame
Served books: `visible: true`, `hidden ≠ true`, `pages_count > 0`, `pages_ocr > 0`.

### Strata (catalogue strata; the leaf is not classified by eye before the engines run)
| stratum | language | `books.book_class` (#5768) | year |
|---|---|---|---|
| `latin-print` | `Latin` or `lat` | `class: printed`, `script_family: latin` | 1500 ≤ year ≤ 1800 |
| `zh-manuscript` | `Chinese`, `Classical Chinese`, `zh` or `lzh` | `class: handwritten`, `script_family: cjk` | any |
| `english-print` | `English`, `en` or `eng` | `class: printed`, `script_family: latin` | 1500 ≤ year ≤ 1900 |

Year = numeric `books.year` unless `year_estimated`, else the first 3–4 digit year in `books.published` (the rule of
`quality-strata-inventory.mjs` `periodOfBook`). A book with no year is out of the Latin and English strata.
`book_class` is a model's label per book (#5768), so these are catalogue-side strata (eval-design §3.2 label
`catalogue-stratum`).

### Draw
1. Per stratum, the eligible book `id`s are sorted ascending and shuffled with `makeRng(6386 + k)` (k = 0, 1, 2 in
   the table order): Fisher–Yates over the sorted list. Exact counts, no `$sample`.
2. Books are taken in that order until **30** have a drawn page. Then **5 spares** are drawn the same way. A spare is
   used only if a drawn page's image cannot be fetched (HTTP error or under 1 KB). It replaces that page and the
   swap is logged.
3. **Interior page.** A book's pages are sorted by `page_number`, n of them. The interior is index
   `floor(0.15 n)` to `ceil(0.95 n) − 1`: the first 15% and the last 5% are skipped.
4. **Exclusion rule (front matter, plates, blanks).** An interior page is ineligible if any of the following holds:
   - its `page_type` matches
     `/blank|title|cover|plate|illustrat|frontis|endpaper|end-paper|binding|colou?r[- ]?(chart|card|bar)|front[- ]?matter|dedicat|imprimatur|approbat|privilege|^image$|^figure$|^map$|^photo/i`;
   - it has no usable image (`scripts/lib/page-image-url.mjs getPageSource` returns null);
   - it has no `ocr` sub-document at all (never OCR'd; production cannot be scored).

   `page_type` is the OCR model's own tag (taxonomy O16), so the rule inherits its errors. That is accepted:
   the alternative is opening every page by eye before the draw. **Not excluded:** pages whose OCR is empty, a
   refusal, or very short. Refusals and empty pages stay in.
5. One eligible page per book is taken with `makeRng((6386 ^ fnv1a(book_id)) >>> 0)`, one call: index
   `floor(r() × eligible.length)`. A book with no eligible page is skipped and logged, and the next book is taken.
6. The draw list (`draw.json`: book id, page id, page number, image URL, seed) is committed before any engine runs.

### Hand-key control set (step 5 of the brief)
The 90 drawn pages, in draw order, are shuffled with `makeRng(6386 + 10)`; the first 10 are the hand-key control
set. A human keys them fully, by eye, later. Listed in `control-set.json`.

## Readers
| arm | what | route | cost |
|---|---|---|---|
| `G` | Gemini 3.x Flash (`gemini-3.8-flash-low`) on the live OCR prompt | `agy -p` through `run-cli-arm.py` (subscription) | $0 |
| `S` | Claude Sonnet on the live OCR prompt | `claude -p --model sonnet` (subscription) | $0 |
| `O` | open model: Kraken + CATMuS (`/root/bench2-kraken`, CPU) for Latin and English; PaddleOCR for Chinese if it runs at $0 here | local | $0 |
| `P` | production: the page's stored `pages.ocr.data` | Mongo read | $0 |
| `P2` | the A-vs-A arm: `gemini-3.1-flash-lite`, live prompt, realtime-ocr.mjs generationConfig (temperature 0.1, thinking 0, 16,384 tokens) | paid API, metered in `gemini_usage` | ≤ $1 cap |
| `IA` | Archive OCR (`_djvu.xml` leaf) where the book is from the Internet Archive, Latin and English only | download | $0 |

No Tesseract. Nothing is written to `pages` or `books`.

## Scoring (fixed here)
- **Normalisation.** Latin and English: `normalizeForScript(text, 'latin')` (wrappers and tags stripped, ſ→s, u/v,
  i/j, case folded: OCR-D Level 1 plus case), spaces removed for the CER. Chinese: `normalizeCJK`.
- **Key.** For a pair (engine X, production P), the key is built from the non-production readers other than X
  (`{G, S, O} \ {X}`). P and P2 are never in a key; IA is never in a key (its leaf mapping can shift, #4790).
  A key reader whose output is empty or a refusal on a page where another key reader has ≥ 20 characters is
  dropped from that page's key.
- **Key form.** The key readers are aligned character by character (pairwise Levenshtein, a third reader aligned
  to the column profile). Each column accepts its plurality reading; a tie accepts every tied reading (with two
  key readers every disagreement is a tie). An engine's error on a page = the edit distance from its text to the
  key (a column's accepted readings cost 0, a gap is accepted where a key reader has a gap) divided by the mean
  normalised length of the key readers, **capped at 1.0**.
- **Refusal or empty output** from the engine being scored = 1.0. A page where every key reader is empty is a
  blank-key page: empty output scores 0, any text 1.0.
- **Paired gap.** Per page (= per work), d = CER(P) − CER(X). Mean d with a bootstrap 95% CI over works
  (10,000 resamples, `bootstrapCI`, seed 6386). Positive d means X is better.
- **AA band.** d_AA = CER(P) − CER(P2) on the same key. The band is the larger absolute end of its 95% CI. Where
  the stored OCR was made by another model (not `gemini-3.1-flash-lite`), that is reported, and the band is also
  shown on the pages whose stored model is flash-lite.
- **Switch rule (from #6388).** Switch only if X's paired-gap CI lies wholly above max(AA band, 1.0 pt) and X is ≤ 2×
  production's cost per page or $0 on a subscription CLI. CI wholly below the margin and above −margin, or below:
  no change. CI straddling the margin: cannot be told apart. All labelled **provisional (AI-consensus key)**.
- **Adjudication spans.** All non-production readers (`G`, `S`, `O`) aligned together, on the normalised text with
  spaces kept; a span is a maximal run of non-unanimous columns, with runs separated by ≤ 2 agreeing characters
  merged. Each span lists every reader's reading, P's reading at the same place where it aligns, 30 characters of
  context, and the image URL.

## Files
- `draw.mjs` → `draw.json` (committed before reads), `control-set.json`
- `reads/<arm>.jsonl.gz`: one row per page per arm (text, outcome, model, seconds). Images stay on the box under
  `$JOB_SCRATCH`. These are served books, whose OCR is already public; none is in the #3499 reserve.
- `score.mjs` → `results.json`, `adjudication-<stratum>.jsonl`
