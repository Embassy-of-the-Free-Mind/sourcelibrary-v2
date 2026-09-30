# What the Internet Archive's OCR gets wrong — an error taxonomy

**Read this when** deciding whether to accept the Archive's text (`ocr.source: ia_djvu`) for a
book or a shelf instead of paying for a flash-lite read, or when a reader reports a wrong date or
name in an Archive-text book.

PRIOR ART: `.claude/docs/page-error-taxonomy.md` (44 defect classes named by eye, for OUR
pipeline's output; this doc measures the ARCHIVE's reading against ours, class by class, with
rates). `scripts/eval/ia-ocr-delivered-quality.mjs` measures how MUCH the Archive text differs
(CER/WER/seq); this measures WHAT KIND. Issue #5186.

Measured 2026-09-30 by `scripts/eval/ia-ocr-error-taxonomy.mjs` (report and verdicts in
`scripts/eval/results/ia-ocr-error-taxonomy-2026-09-30/`).

## The one-paragraph answer

The Archive's words are good. Its numbers are not safe. On prose, 1–3 in 1,000 words differ from a
flash-lite read, and a by-eye check puts most of those on the Archive. Numbers are the problem: in
one book in four, **1 year in 12 to 1 in 20 is wrong**, with no signal in the agreement score (every
book passed the lane's 0.80 gate at 0.977–0.990). The failure depends on the typeface: a flat-topped
3 read as 8, old-style figures read as letters or split in two. So it has to be detected per book,
not per genre. The Archive does have one real advantage over flash-lite: **it never skips lines.**
The model silently dropped a sentence or more on about 0.5% of pages.

## Sample and method

- **Pairs.** `scripts/batch/realtime-ocr.mjs` snapshots the Archive text to `page_revisions`
  (`source: ia_djvu`, `reason: reocr_realtime`) before it overwrites `pages.ocr`. Pair = that row ×
  the current flash-lite reading (`gemini-3.1-flash-lite`). 4,695 pairs; 4,470 usable after dropping
  refusals, collapsed model reads and near-empty pages. The 175 pages Gemini refused as recitation
  in run `PuoR8LUpHxvcLR3OilFMY` still hold Archive text, so they have no pair and are not in the sample.
- **Interior (unbiased).** Every re-read page of four 1890–1919 English reference books (#5186):
  2,132 pages, 1.08 M words, 34.7 K year tokens. Deyo, *History of Barnstable County* 1890
  (`6aa4c8a388a2920a45a88592`, ia-ocr 0.0.21); Wakeley, *Omaha: the Gate City* 1917
  (`6aa4c8b488a2920a45a88e2e`, ia-ocr 0.0.13); *One Thousand New Hampshire Notables* 1919
  (`6aa4c8bb88a2920a45a8921b`, ia-ocr 0.0.14); *The Book of Clevelanders* 1914
  (`6aa4c89788a2920a45a883eb`, ia-ocr 0.0.21).
- **Front matter (biased contrast).** First 25 leaves of 242 lane books (#4815): title pages,
  contents, prefaces. Pooled one page per book (seeded), with the all-pages figure alongside.
- **Alignment.** Our tags and editorial blocks stripped. Running heads and page numbers removed
  from both sides. Token LCS on folded forms, classified on raw forms, and rates reported **per
  opportunity** (year errors ÷ year tokens). A book counts as one observation (interior median of four
  per-book rates). Pages whose word order differs (index columns) or that don't align get page
  classes only, never token classes.
- **The reference is not ground truth.** Every rate below is a *disagreement* attributed to the
  Archive. **Facsimile check:** 15 disagreements were read against the page image (table at the end).
  Of the **10 drawn at random** by `--stage=verify`, **9 were Archive errors and 1 a model error**.
  Of 5 picked by hand (a table, a font-specific R, three that looked like model errors), 2 were Archive
  errors and 3 model errors. Treat the word-class rates as upper bounds, about 90% attributable to the
  Archive. The year classes are close to exact: five of the six year disagreements checked were the
  Archive's; the sixth was a damaged digit the model guessed.
- **Sanity check against the earlier digit count (#5186).** Year-wrong rates: Deyo 4.6% (earlier
  4.5%), Gate City 8.0% (6.6%), NH Notables 1.0% (2.2%), Clevelanders 0.7% (0.8%). The earlier
  count was a bag-of-numbers test on a 25-page sample; this one is the whole book, token-aligned.

## Headline: interior pages, per book

| book (Archive engine) | pages | seq ratio | years wrong | numbers wrong | Capitalised words wrong | glyph misreads /1k words | noise tokens /1k | running heads kept in text |
|---|---|---|---|---|---|---|---|---|
| Deyo, Barnstable 1890 (ia-ocr 0.0.21) | 906 | 0.986 | **4.6%** (621/13,384) | 4.4% | 0.6% | 2.1 | 0.4 | 92% |
| Wakeley, Gate City 1917 (ia-ocr 0.0.13) | 563 | 0.987 | **8.0%** (457/5,698) | 7.6% | 1.9% | 6.7 | 0.5 | 95% |
| NH Notables 1919 (ia-ocr 0.0.14) | 369 | 0.990 | 1.0% (94/9,578) | 0.8% | 0.8% | 4.1 | 4.5 | 78% |
| Clevelanders 1914 (ia-ocr 0.0.21) | 294 | 0.977 | 0.7% (40/6,007) | 0.6% | 3.0% | 17.0 | 1.3 | 87% |

"Glyph misreads" = known letter pairs + other 1–2-character confusions + unrelated words. "seq
ratio" is the lane gate's own measure. It is highest on the book with the second-worst dates.

## The classes

Rates are the interior median across the four books (range in brackets). Front matter (FM) uses
one page per book across 242 books. Examples give the printed text first, then the Archive's
reading. Where it was checked on the image, that is noted.

### 1. Digits — the class that matters

| class | interior | FM | what it is |
|---|---|---|---|
| year wrong (all causes) | **2.8%** (0.7–8.0%) per year | 6.2% | any of the rows below, on a 4-digit year |
| number wrong (≥ 2 digits) | 2.6% (0.6–7.6%) per number | 8.1% | same, on any number |
| digit substitution | 0.11% (0.04–3.6%) per number | 1.4% | same length, a digit differs |
| digit read as letter | 0.36% (0.27–0.45%) per number | 4.4% | `1855 → r855`, `1st → Ist`, `1860 → i860`, `551 → SSI` (#5186 Theosophical Path) |
| year split or fused | 0.31% (0.13–6.2%) per year | 2.0% | `1915 → 191 5`, `1841 → 1 84 1` |
| numeral dropped | 0.05% per number | 4.9% | number absent: in the interior mostly table cells; in FM, page numbers in contents lists |
| letter read as digit | 0.02% per word | 0.07% | `O.` (Ohio) `→ 0`, `Truro → 77uro` |

- **3 → 8 is a typeface defect, not an engine defect.** Of the 643 interior digit substitutions,
  614 are 3→8, and **613 of them are in Deyo**. It is set in a face whose 3 has a flat top.
  Clevelanders, read by the same engine version (0.0.21), has 0.7% of years wrong.
  Checked on the image: `1883 → 1888` on p431 (page `6aa4c8a388a2920a45a88741`) and p1083
  (`…889cd`, "pastor from **1888** to 1886", an impossible range nobody would notice), and `1832 → 1882` on p516.
  Nothing in the text reveals it. The words read at 0.986 agreement.
- **Old-style figures** (Gate City: the 1 is a small-cap I, and 3, 4, 5, 7, 9 descend below the
  line). The Archive reads 1 as `i` (`1860 → i860`, p347 `…88f89`) and **breaks the year where
  the figure dips**: `January 1, 1917 → January i 191 7` (p708 `…890f2`). There are 356 split years in Gate
  City, which is 6.2% of its years, against ≤ 0.3% in the other three. A split year cannot be found by date
  search and is invisible to a bag-of-words check.
- The other substitutions are rare (9→0 ×8, 6→0 ×4). In front matter the mix is wider
  (3→5, 6→0, 9→0, 3→8, 2→3) and spread across many books: display type and small caps.

### 2. Letters and words

| class | interior per word | FM per word | examples (printed → Archive) |
|---|---|---|---|
| known letter pair (li↔h, rn↔m, c↔e, u↔n, l↔i) | 1.2‰ | 2.0‰ | `Erle → Erie` (bold headword, p209 `…884bc`, checked on the image); `son → sou` |
| other 1–2-glyph confusion | 3.1‰ (1.2–12.6‰) | 8.4‰ | `Riding → Eiding` (p26 `…88405`, checked) |
| multi-glyph misread | 0.5‰ | 2.5‰ | `BARBER → BABBEB` |
| unrelated word | 1.1‰ | 5.1‰ | `BARKER → BAEKFiB` |
| Capitalised word wrong | 1.3% (0.6–3.0%) per Capitalised word | 4.4% | proper nouns are 3–5× likelier to be wrong than words overall |
| spacing split/merge | 2.2‰ | 3.3‰ | `Levi Swift → LeviSwift` (p432 `…88742`, checked) |
| noise token (speckle read as text) | 0.9‰ (0.4–4.5‰) | 4.0‰ | stray `s`, `j`, `ii` |
| script confusion | 0 | 0.2‰ | Latin or digits returned as Cyrillic in lists: `1 → А / д / я`, `COPIES → Мг` (a 19th-c. subscriber list) |
| long-s ↔ f | 0 | 0.5‰ | `instructors → inFtructors`. Only 3 pre-1800 books were in the sample, so this is **unmeasured**, not cleared |

- **One typeface can dominate a book.** Clevelanders' capital R is read as E 880 times (`Eotary`,
  `Eeserve`, `Eecreations`), sometimes as K or B. That is 12.6 other-glyph errors per 1,000 words,
  4–10× the other books, and it hits exactly the words a reader searches for: names, clubs,
  institutions.
- **Italic proper nouns** misread worst: `Truro → 77uro` (Deyo p114 `…88604`, checked).
- A misread that produces a real word (`Erle → Erie`) is invisible to spell-check or a dictionary gate.

### 3. Layout, blocks and furniture

| class | interior per page | FM per page | what it is |
|---|---|---|---|
| running heads / page numbers kept inline | 78–95% of tagged items | 77% | The Archive puts the head (`426 HISTORY OF BARNSTABLE COUNTY.`) into the body as its first line. Ingest (`scripts/import/ia-ocr-ingest.mjs`) does not strip it, so it reaches translation and search as prose |
| reading order differs | 2.5% (0–5.4%) | 0.4% | multi-column index and directory pages. The words are right but in a different order |
| table read as noise | 0.14% | 5.4% | dot-leader tables: numbers mostly survive, labels become letter soup (`UETRGTIL EY Ge fon Senco`, Deyo p173 `…8863f`, checked: the model read the table cleanly) |
| drop cap | rare | — | chapter-opening `T` read as `Bass`, and the lines set beside it **moved to the end of the page** (Deyo p105 `…885fb`, checked) |
| superscripts lost | 0.3‰ per word | 0.1‰ | genealogy generation numbers (`Bursley⁹ (William T.⁸ …`) come out as `’` or `*`. **The lineage numbering is gone** (Deyo p516 `…88796`, checked) |
| line-end hyphens | 0 per line | 0.1% | ia-ocr already joins `Bos-\nton`, so no dehyphenation is needed on Archive text |
| punctuation | — | — | The Archive keeps curly quotes (4,904 vs the model's 1,523) and turns every en-dash into a hyphen (0 en-dashes vs 1,225). Convention, not error |

### 4. What flash-lite gets wrong that the Archive gets right

These are the other direction's errors. They matter because this doc treats the model as the
reference.

- **Eye-skips.** **11 of 2,132 interior pages (0.5%)** have a readable run of ≥ 8 words that only the
  Archive has (front matter: 15 of 242 sampled pages). Both cases checked on the image were the model's fault:
  - Gate City p86 (`…88e84`): the model jumped between two occurrences of "Benjamin F. Black" and
    dropped three printed lines (39 words);
  - Gate City p203 (`…88ef9`): the model skipped one clause of a run of parallel "president
    of the … Nebraska;" clauses.
  The Archive's engine reads line by line and does not skip. That makes it a free omission
  detector for model reads.
- **Inference over transcription.** On Clevelanders p42 (`…88415`) the print shows `19?0` with a
  broken third digit. The Archive read `1900`. Flash-lite wrote `1870`, a plausible date for a
  Civil War veteran's marriage that the page does not show.
- **Plain slips**: `They have had eleven children → They have have` (Deyo p520 `…8879a`).

## Decision table

| the book is… | Archive text is… | why |
|---|---|---|
| discursive prose (essays, sermons, travel, philosophy, fiction) with few dates | **acceptable** | ~1–3 errors per 1,000 words, mostly on names; dates are sparse (#5186: 1 digit misread in 204 Theosophical pairs) |
| read for its words and full-text search, not its numbers | **acceptable**, after stripping running heads | the words survive; the heads are the only systematic pollution |
| a genealogy, county history, biographical dictionary, directory, chronology or register (**the numbers are the content**) | **re-read with flash-lite** | 0.7–8% of years wrong in exactly this genre, undetectable from the text |
| set in **old-style figures** | **re-read** | 1 → i and split years (6.2% of Gate City's years). Text-only tell: count `\b1[89]\d \d\b` / `\bi[89]\d\d\b` in the Archive text, 290 + 36 in Gate City against ≤ 5 elsewhere |
| set in a face with a **flat-topped 3** (or any digit ambiguity) | **re-read** | 3→8 on 4.6% of Deyo's years. There is **no text-only tell**: the 3:8 digit-frequency shift (0.18 → 0.14) is too small to gate on. Only a numeric check against a sample re-read finds it |
| a numbered genealogy (superscript generations) | **re-read** | the Archive turns generation numbers into apostrophes |
| full of dot-leader or statistical tables | **re-read those pages** | labels become noise; numbers mostly survive |
| multi-column (indexes, directories) | acceptable for search, **not for reading** | the words are there, but ~2.5% of pages come out in a different order |
| pre-1800 (long-s) | **re-read** (the lane's known failure) | too few pre-1800 books in this sample to measure it here |
| anything, as a check on a model read | **keep the Archive text as a witness** | it catches the model's eye-skips (0.5% of pages) for free |

**The gate that would have caught all four books** is the per-book numeric check proposed in
#5186. Re-read a small sample with flash-lite, compare the numeric tokens only, and reject the
Archive text when more than ~1% of the sample's years disagree. Sequence agreement cannot do this:
every book here passed it at 0.977 or better.

## Facsimile check (15 disagreements)

| page (id) | class | printed / Archive / model | verdict |
|---|---|---|---|
| Deyo p431 (`6aa4c8a388a2920a45a88741`) | digit substitution | 1883 / 1888 / 1883 | Archive wrong |
| Deyo p1083 (`…889cd`) | digit substitution | 1883 / 1888 / 1883 | Archive wrong |
| Deyo p516 (`…88796`) | digit substitution + superscripts | 1832, T.⁸ / 1882, T.* / 1832, T.⁸ | Archive wrong |
| Gate City p347 (`6aa4c8b488a2920a45a88f89`) | digit read as letter | 1860 / i860 / 1860 | Archive wrong |
| Gate City p708 (`…890f2`) | digit read as letter + split | 1, 1917 / i 191 7 / 1 1917 | Archive wrong |
| Deyo p114 (`…88604`) | letter read as digit | *Truro* / 77uro / Truro | Archive wrong |
| Clevelanders p26 (`6aa4c89788a2920a45a88405`) | glyph confusion | Riding / Eiding / Riding | Archive wrong |
| Clevelanders p209 (`…884bc`) | letter confusion | Erle / Erie / Erle | Archive wrong |
| Deyo p432 (`…88742`) | spacing | Levi Swift / LeviSwift / Levi Swift | Archive wrong |
| Deyo p173 (`…8863f`) | table noise | station names / letter soup / names | Archive wrong |
| Deyo p105 (`…885fb`) | drop cap, block moved | THE news … / Bass news … (at page end) / THE news … | Archive wrong |
| Gate City p86 (`…88e84`) | Archive-only block | 3 lines / present / **skipped** | model wrong |
| Gate City p203 (`…88ef9`) | Archive-only block | "president of the Farmers & Merchants Bank…" / present / **skipped** | model wrong |
| Deyo p520 (`…8879a`) | unrelated word | have had / have had / have have | model wrong |
| Clevelanders p42 (`…88415`) | digit substitution | 19?0 (damaged) / 1900 / 1870 | model wrong (inferred) |

Page images: `https://images.sourcelibrary.org/archived/<book_id>/<page_number>.jpg`.

## Re-running

    node --env-file=.env.production.local scripts/eval/ia-ocr-error-taxonomy.mjs --stage=pull   # resumable
    node scripts/eval/ia-ocr-error-taxonomy.mjs --stage=report --verdicts=<verdicts.json>
    node scripts/eval/ia-ocr-error-taxonomy.mjs --stage=verify --n=16                          # draw new disagreements

The pull reads Mongo (it finished from the laptop on 2026-09-30; if the connection drops, run it on
Hetzner and copy `scripts/output/ia-ocr-error-taxonomy/pairs.jsonl` back). Everything else is
offline. Any future `realtime-ocr.mjs` re-read of `ia_djvu` pages adds pairs automatically, so
re-run after the next lane re-read to widen the genre and engine coverage. The engine split
(section D of the report) is still front matter only; ABBYY 8/11 have 20 and 2 books.
