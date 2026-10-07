# Quality census, 2026-10 (#5700 row A1): what a backfill would touch

PRIOR ART: the monthly translation corpus audit (#5301) judges fidelity with a model on ~100 pages; no $0 census of these defect classes existed (scripts/eval/INDEX.md, EXPERIMENTS.md).

**$0, read-only, no model calls.** Drawn 2026-10-03 from `bookstore`.

**Biggest backfill:** the deterministic $0 cleanup (A2) of classes (a) and (c). It touches
**≈ 479K served translated pages, 9.8% (95% CI 452K–505K)**, at no model cost: one write plus one
revision row per page. The paid-looking backfill is (b), failed `original:` notes, at ≈ 173K pages.
It is also $0 if the failing clause is trimmed. Retranslating those pages instead would cost about
$150 at the lite-batch rate (≈ $0.00085/page, EXPERIMENTS.md).

## Population and draw

| | |
|---|---|
| population | every live translated book: `visible: true, pages_count > 0, pages_translated > 0` → **21,411 books, 4,906,211 translated pages** (exact, from `books`) |
| draw | **one page per book**: a seeded (`makeRng(5700)`) random `page_number` in the interior (first 15% and last 5% skipped), then the first page at or after it with non-empty `translation.data`, via the `{book_id, page_number}` index. 20,530 interior; 881 books fell back to a non-interior translated page |
| weighting | each page stands for its book's `pages_translated` (ratio estimator). CIs are a seeded bootstrap over BOOKS (1,000 reps). Book shares carry Wilson CIs. **"pages ≈"** = share × 4,906,211 |
| what "served" means | `translation.data` as stored, which the API, MCP and exports serve, **and** the text the reader actually shows: `NotesRenderer` rendered to static HTML with tags stripped, so the reader's own repairs count |

`$sample` was not used (it is biased toward big documents). `page_number < 0` is never drawn
(soft-hidden spreads).

## Results

| class | pages (share, 95% CI) | ≈ pages | books hit / 21,411 |
|---|---|---|---|
| **(a)** decorative-initial OR scan-condition note | **4.62%** [4.20–5.07] | **226,800** | 1,183 |
|   decorative initial | 4.36% [3.93–4.75] | 213,700 | 1,084 |
|   scan / page-condition warning | 0.28% [0.19–0.39] | 13,800 | 104 |
|   *(not in a)* printer's ornament / headpiece description | 1.57% [1.36–1.82] | 77,200 | 791 |
| **(b)** ≥1 `original:` note whose quote is `absent` from the page's OCR | **3.53%** [3.15–3.94] | **173,400** | 666 |
|   …of pages that carry any `original:` note (23.1% of pages) | 15.3% [13.8–17.1] | | 666 / 4,187 |
| **(c)** raw tag faults (empty, orphan closer, unclosed) | 3.96% [3.59–4.38] | 194,500 | 881 |
|   `<margin></margin>`+text+`</margin>` (opener closed too early) | 1.83% [1.56–2.12] | 89,900 | 415 |
|   unclosed `<note>` | 0.03% [0.01–0.06] | 1,600 | 14 |
|   leaked into what the READER sees (`#`, `->`, `<tag>`, `page-num`) | 0.44% [0.30–0.58] | 21,600 | 71 |
|   placeholder/commentary brackets (`[Blank page — no translatable content]`, `[Page 5]`, `[text continues]`) | 1.25% [1.05–1.46] | 61,600 | 441 |
|   *(context)* any translator `[…]` where the OCR has none | 17.8% [17.0–18.7] | 873,600 | 3,331 |
|   *(context)* `<header>`/`<page-num>` tags inside the English | 30.8% [29.9–31.8] | 1,511,100 | 4,396 |
| **A2 union**: (a) ∪ raw tag faults ∪ placeholder brackets ∪ reader-visible leaks | **9.76%** [9.22–10.29] | **478,700** | |

**Esukhia `#` marks: none found in served English.** Every `#` in the 1,329 sampled Tibetan
translations is a markdown heading. The Esukhia-text books are held and hidden, so they are not in
this population. The reader-visible `#` leaks come from other sources: a heading run into the line
before it (`3 ### expands itself…`), and a closing `####` inside a centred heading (`OF THE SAGES ####`).

The two *context* rows are large but are **not** recommended for backfill. The reader already shows
every `[…]` in italics as "Translator's addition" (`<interp>`). It also strips `<header>`/`<page-num>`
before display; they reach only API, MCP and exports, so the fix belongs in the serializer.

**By period**, the decorative-initial class is an incunabula problem: **20.3% of pre-1500 pages**,
6.5% for the 1500s, 2.8% for the 1600s, under 0.5% after 1800. The raw tag faults follow the same
shape (8.2% pre-1500 vs ≤ 4.5% later).

**(b) by language**, as the share of pages carrying `original:` notes that have a failing one:
Sanskrit 29.5% (n = 173 books), Hebrew 27.7% (55), Tibetan 24.8% (186), Greek 22.4% (231),
Latin 18.6% (1,450), Dutch 14.7%, English 13.4%, Arabic 10.5% (35), Chinese 6.7%, German 6.5%. The
full table with CIs is in `census.json` → `by_language.*.b_given_original`. At note level, 963 of
12,691 `original:` notes are `absent` (7.6%), and 887 more are `script` (uncheckable, never counted).
`absent` is an upper bound: the examples below include English names and other-work citations that
were mislabelled `original:` rather than invented.

### (d) Reading order: books whose printed page markers descend or swap (#5699)

Detector `scripts/eval/page-marker-order.mjs`; precision by eye in `d-precision-review.md`.
It scanned served pages only, every RTL, CJK and multi-language book in full, plus a seeded
1,500-book sample of the rest.

| stratum | books scanned | readable (≥10 markers) | flagged DESC/SWAP | pages in flagged sections |
|---|---|---|---|---|
| right-to-left (Hebrew, Arabic, Persian, Syriac…) | 736 (all) | 237 | **52** | 9,608 |
| CJK | 1,456 (all) | 65 | **8** | 2,910 |
| multi-language label | 180 (all) | 56 | 0 | 0 |
| everything else | 1,500 of 19,039 | 353 | 9 (→ ≈ 114 scaled) | 178 |

**Precision 16/20 (80%, CI 58–92%)** on a fresh sample the final version had never seen. Both
controls flag. Syriac is worst: **21 of 82 books**, mostly the Bedjan volumes, stored back to front.
Then Arabic 19/265, Hebrew 8/227 and Japanese 5/142. **Maqrizi is pair-swapped through the whole
book**, not only at p107/p108.

Recall is unmeasured, and most books cannot be checked: their OCR carries too few readable markers.

### (e) OCR-risk strata

| stratum | size | how measured |
|---|---|---|
| Latin printed before 1550 | **2,475 books, 634,822 translated pages** (12.9%); before 1501: 1,584 books, 344,325 pages | exact, from `books.year` |
| Chinese with interlinear commentary | **≈ 23,900 pages** [19,600–28,500], ≈ 17% of the 137,027 Chinese pages | sample: OCR has inline `<gloss>` with ≥4 Han, Han in parentheses, or 小字 / 雙行 / "interlinear" |
| rotated folios | **≈ 12,400 pages** [7,800–17,700], 62 books | sample: OCR or note says rotated / sideways / upside-down. **No page-level rotation field exists**, so this is what the OCR noticed |
| OCR with >10% garbled tokens | **≈ 21,400 pages** (0.44%). Latin 0.4%, Greek 1.2%, Arabic 1.7%, Cyrillic 0.7%, Hebrew 0, Syriac 0 (n = 29) | sample: rule-based (mixed script or letters+digits in a word, a letter ×4, in-word symbols, vowelless Latin ≥5). **No lexicon**, so this catches gross garbage only (median rate 0). A weak instrument; a per-script lexicon would be the next step |

## Examples (10 each; seeded)

**(a)** notes about the scan, not the text
- https://sourcelibrary.org/book/69dbc9121040d1d5e209f760?page=276 (Latin): "A red decorative initial 'A' begins the final paragraph."
- https://sourcelibrary.org/book/69b631291c1c21a373805807?page=218 (Latin): "A decorative initial 'E' in blue and red ink."
- https://sourcelibrary.org/book/69b51e9647b06ecd58193ed8?page=64 (German): "A decorative initial "D" begins the text."
- https://sourcelibrary.org/book/69b52c993dd6d942302814ea?page=179 (Latin): "Small decorative initial 'C' in blue with red penwork flourishes."
- https://sourcelibrary.org/book/69b525a395677df8153c694c?page=1 (Dutch): "A decorative drop cap 'A' featuring intricate floral scrollwork designs."
- https://sourcelibrary.org/book/6a4cc8016a4444bb55bcbbb0?page=4 (Latin): "The following printed text is a mirrored offset from the facing page…"
- https://sourcelibrary.org/book/6a26be170e247ebad6de6d6f?page=5 (German): "An ornamental decorative initial D begins the paragraph."
- https://sourcelibrary.org/book/6a42494fc1f44d759e6ce3d9?page=3: "Large ornamental drop cap letter F used to begin the first proposition."
- https://sourcelibrary.org/book/69c1bbd28522835be8460a78?page=59 (Hebrew): "A decorative flourish, shaped like a crown, rests above the initial letter…"
- https://sourcelibrary.org/book/69f33d92876dd827cbc5c190?page=217 (Persian): "…a faint, hazy illustration or staining in the background…" (**a false hit**: a border description)

Precision by eye: decorative initials 60/60. Scan warnings were 18/50 under the first rule; after it
was tightened, 3/4 in the review packet (small n). The scan class is small either way.

**(b)** `original:` quotes not on the page
- https://sourcelibrary.org/book/69e788ce4a6785cfd60d1ee9?page=11 (Tibetan): "Mig-dmar"
- https://sourcelibrary.org/book/69e75d11cc48e59ad74eb474?page=27 (Japanese): "え眼へかちふきさうとふと", "あく" (aku)
- https://sourcelibrary.org/book/69b6e791f8a84d859cde1de2?page=422 (Latin): "febri alba"
- https://sourcelibrary.org/book/69a5e660e751f06e74b89c25?page=29 (Arabic): "al-Tajribah"
- https://sourcelibrary.org/book/69907f3aafd715da775bc9e0?page=150 (Sanskrit): "Ju", "abhinava samskara"
- https://sourcelibrary.org/book/69a02790da8b726682c09aae?page=259 (Latin): "Nasturtium" (the page has *Eruca*)
- https://sourcelibrary.org/book/69b51ed4ff09e4fe943b57ee?page=72 (Latin): "Phantas", "Caligavit"
- https://sourcelibrary.org/book/86fe639a-5f3d-4e9e-9d99-128742a10809?page=97 (English): "consanguine relations", "mountebanks". An English book: the label misused for a gloss
- https://sourcelibrary.org/book/69b51dfdcf111105c429498f?page=368 (Latin): "Diss. de peste. (juridica.)"
- https://sourcelibrary.org/book/69b3e67e304c1c6b3950b94a?page=212 (Syriac): "Rabbi Asher ben Jehiel". An English name, not an original

**(c)** leaked markup
- https://sourcelibrary.org/book/4adda30b-b8da-4e16-ad21-9f14bf286a23?page=91: reader shows "…rarified with heat, 3 ### expands itself…"
- https://sourcelibrary.org/book/697a37fae1d81a84b06d2d73?page=147: reader shows "127 OF THE SAGES #### foods so necessary…"
- https://sourcelibrary.org/book/695690a8aeb4b980d9ebdaac?page=250: reader shows "…direct passions.</margin> ### S E C T. III."
- https://sourcelibrary.org/book/6953a93977f38f6761bd58f4?page=446: reader shows "<<The body, therefore, changes…"
- https://sourcelibrary.org/book/695910f5ecb01322b306854d?page=470: reader shows "CHAPTER XIX. ->Of other useful trees…" (dangling centre marker)
- https://sourcelibrary.org/book/69b52591ea48bdf05847e74c?page=1: `<margin></margin>` + text + `</margin>`; the margin prints as body text
- https://sourcelibrary.org/book/69b4cd44d5b6c3815e1a52de?page=145: `<insert></insert>` + text + `</insert>`
- https://sourcelibrary.org/book/69942ca3b2f6748db4abe304?page=235: "[Blank page — no translatable content]" shown as a translator's addition
- https://sourcelibrary.org/book/69f32d50876dd827cbc42cdd?page=5: "[Page 1]", "[Page 2]", "[Page 3]"
- https://sourcelibrary.org/book/6953aeb177f38f6761bd85d1?page=2: "[text continues]"

## The deterministic fix for each class (NOT applied)

Every fix writes one `page_revisions` row per page (source `census-5700-a2`), touches only
`translation.data`, and is sampled by eye before a full run. It is reader-visible text.

- **(a)** Rewrite each `<note>` that `classifyNote()` labels `initial` or `scan` as `<meta>…</meta>`.
  The reader already lifts `<meta>` into the page-information panel, so nothing is lost and the
  reading text stops carrying scan descriptions. Ornament notes can follow by the same rule if wanted.
- **(b)** (A3, waits on the v16 decision, #3825.) For each `original:` whose `verifyQuote()` tier is
  `absent`, delete the `original: "…" (…)` clause from the note. If nothing else remains, delete
  the note. Never touch `script`-tier notes.
- **(c)**, in this order:
  1. `<T></T>(text)</T>` → `<T>text</T>` for margin/insert/gloss/unclear/note/term;
  2. then delete any remaining empty pair and orphan closer;
  3. run the existing `sanitizeTranslationTags()` (`scripts/lib/translate-core.mjs`) for unclosed tags;
  4. put `\n\n` before a `#{1,6} ` that follows text on the same line;
  5. strip trailing `#+` inside `->…<-`;
  6. drop a `->` with no `<-` in its paragraph;
  7. delete `[Page N]` and `[text continues]`; replace `[Blank page — no translatable content]` with an empty translation, which the `page_type` already explains.

  Leave interpolation brackets and the `<header>`/`<page-num>` echoes alone, as above.

## Reproduce

```
node --env-file=/root/sourcelibrary/.env.production.local scripts/eval/quality-census-draw.mjs --out <raw-dir>        # ~1 min
npx tsx scripts/eval/quality-census-score.mjs --draw <raw-dir>/draw.jsonl                                            # ~8 min
node --env-file=… scripts/eval/page-marker-order.mjs --draw <raw-dir>/draw.jsonl --raw <raw-dir>                      # ~2 min
node scripts/eval/page-marker-order.mjs --summarise <raw-dir>/page-order.jsonl --draw <raw-dir>/draw.jsonl --out page-order-summary.json
```

Files:
- `census.json`: every estimate, by language and period, plus examples.
- `pages.jsonl`: the draw manifest; one line per sampled page with the flags that fired.
- `page-order-summary.json`: (d), with every flagged book and section.
- `d-precision-review.md`: the by-eye review.

The raw draw (126 MB of page text) is not committed.
