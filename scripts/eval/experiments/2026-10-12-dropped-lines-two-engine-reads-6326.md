---
stage: ocr
measure: agreement
languages: []
scripts: [Latn, Grek]
canons: []
n_books: 990
n_pages: 120577
verdict: "Comparing two stored reads by different engines flags a run of 5+ words on 12,431 of 120,577 pages (66 of 990 books at one page per book); 12 of 15 flags judged by eye were real dropped text, 10 of them dropped by flash-lite."
status: undecided
decision: null
superseded_by: null
issue: [6326, 5136, 4877]
---
## 2026-10-12 · Can two stored reads of a page by different engines find silently dropped lines? (#6326)

PRIOR ART: `scripts/audit/ocr-negation-flip-candidates.mjs` (#6184) has the same shape (two stored reads, a
worklist, controls that exit 1) but pairs single tokens; PR #5317's `<vocab>`-vs-body screen found 0 of 8
omissions. #4877 (2026-10-08) measured the method on one book. This run builds the detector and takes it to
every stored two-engine pair.

**Question.** Class O5 (#5136) has no working detector. Does a model-free comparison of `pages.ocr` with a
`page_revisions` row from another engine find dropped lines, and how often does it fire?

**Instrument.** `scripts/audit/dropped-line-candidates.mjs`. Both reads are folded (metadata blocks and tags out,
line-end hyphens rejoined, æ/ae, &/et, long s, u/v, i/j, accents) and aligned word by word. A gap is kept when it
is 5+ words on one side only, or 8+ words against a side at least 5 shorter. A gap is dropped when the other read
holds those words elsewhere (40% of its trigrams), when it is letter-spaced type, or when it touches the first or
last three words of the page. Reads count only when `source` is a pipeline read (allow-list; relocation sweeps and
human edits are out) and the two models differ. $0, read-only, 16 minutes for the corpus.

**Controls** (Aldine 1516 Iamblichus, built in, exit 1 if missed): positives pp. 212, 268, 343 all found, each
run missing from the flash-lite read; negatives pp. 179, 191, 215, 227 all clean.

### What the corpus holds
1,112,190 pages have an OCR revision row. **120,577 are judged two-engine pairs, on 990 books.** Not judged, and
not counted as clean:

| reason | pages |
|---|---|
| a script written without word spaces (Tibetan, Japanese, Chinese; mostly the BDRC and Paddle lanes) | 460,910 |
| the revision is by the same engine as the current text | 352,693 |
| the revision is not a pipeline read (relocation sweep, refused read, human edit) | 73,510 |
| the two reads share under half their words (another leaf, or a Syriac lane in another script form) | 40,245 |
| the page has no current text | 31,493 |
| printed page numbers disagree | 23,436 |
| under 40 words | 9,136 |
| the current text is not a pipeline read | 190 |

### Flag rate
Pages (many pages per book, so these are counts, not rates of error):

| pair (previous → current) | judged pages | flagged | share |
|---|---|---|---|
| `gemini-3.1-flash-lite → gemini-3-flash` | 101,491 | 11,380 | 11.2% |
| `ia-ocr → gemini-3.1-flash-lite` | 16,499 | 769 | 4.7% |
| `gemini-3-flash → gemini-3.1-flash-lite` | 1,372 | 159 | 11.6% |
| `gemini-2.5-flash → gemini-3-flash` | 547 | 38 | 6.9% |
| `gemini-3-flash → kraken/omnisyr` | 523 | 57 | 10.9% |
| `gemini-2.5-flash → claude-sonnet-4-6` | 47 | 8 | 17.0% |
| `gemini-3-flash → gemini-3.7-flash-low` | 37 | 7 | 18.9% |
| all pairs | 120,577 | 12,431 | 10.3% |

One page per book, chosen by a hash of the page id: **66 of 990 books flagged (6.7%)**.

| pair | books | flagged | | century | books | flagged |
|---|---|---|---|---|---|---|
| `flash-lite → flash` | 564 | 44 (7.8%) | | 15c | 25 | 3 (12%) |
| `ia-ocr → flash-lite` | 315 | 11 (3.5%) | | 16c | 149 | 22 (14.8%) |
| `flash → flash-lite` | 38 | 3 | | 17c | 73 | 7 (9.6%) |
| `flash → 3.7-flash-low` | 21 | 4 | | 18c | 44 | 3 (6.8%) |
| `flash → kraken/omnisyr` | 21 | 0 | | 19c | 279 | 13 (4.7%) |
| `2.5-flash → flash` | 11 | 1 | | 20c | 228 | 7 (3.1%) |
| | | | | undated | 178 | 11 (6.2%) |

The flagged pages hold 23,605 runs: 7,378 of 5–7 words, 12,861 of 8–20, 2,546 of 21–60, 820 over 60. In the
`flash-lite → flash` pair the run is missing from the lite read on 9,697 pages and from the flash read on 4,041.
**9,948 of the 12,431 flagged pages are in books labelled Greek**, 1,257 Latin,
823 English. 650 pages whose CURRENT text is flash-lite lack a run the earlier read has.

### By eye: 20 flags, one per book
Seeded draw over flagged books (hash of the book id), one page per book, one run per page; read against the page
image by Claude Opus, labelled `read-from-image`. The draw was made on the pass before the last filter change.

| verdict | n | detail |
|---|---|---|
| real: the words are printed and one read lacks them | 12 | 9 dropped by the earlier flash-lite read (current flash text has them); 1 by the Internet Archive read (a masthead epigraph); **2 are holes in the current text** (one flash-lite page lacking 47 words, one flash page lacking a repeated Coptic formula) |
| false | 3 | all one artifact: `&nbsp;` read as the words "et nbsp". Fixed in the script; those three pages no longer flag |
| not judged | 5 | 2 Syriac pages (flash against kraken, similarity 0.50–0.56); 3 where I could not find the run in ligatured 17th-century Greek or a dense citation column |

So **12 of 15 judged flags were real dropped text, and after the entity fix 12 of 12.** n = 15 on 15 books: the
lower bound of a 95% interval on 12 of 12 is about 74%, and the five unjudged flags sit in the hardest material
(low-similarity Syriac and ligatured Greek), where the false-flag rate is probably higher. Among the real ones:
4 are a single whole printed line; 3 are a same-to-same skip inside a line (`primum Discretum … primum Discretum`,
`of energy … of energy`); 2 are several lines (44 and 47 words); 3 are in apparatus, commentary or a gloss column.

### What this does and does not show
- The method works where #5317's screen did not, at $0, on pages that already have two reads.
- **It is not a dropped-line rate for the corpus.** Pages with two engines are the pages someone chose to re-read (80% of flags are in
  Greek-labelled books), so they are not a random draw of the corpus. A flagged page is a candidate:
  the detector cannot say which read is right, and in one of 12 real cases the current flash read was the one
  with the hole.
- It sees nothing on a page with one read, nothing when both engines drop the same line, and nothing in
  scripts written without word spaces.
- Runs over 60 words (820) are truncated or half-read pages rather than dropped lines; they are real omissions
  of a different class.

**Not replicated.** One pass, one reader, 15 judged flags.

**Decision owed (#6326, last box).** Whether to buy a second read for single-read pages, and on which lane. The
evidence here favours starting with early-modern print (15–17c: 32 of 247 books flagged, 13%) and with the 650
pages whose live flash-lite text lacks a run an earlier read has, which need no new read at all.

**Artifacts.** `scripts/eval/results/dropped-line-candidates-6326/`: `summary.json` (every count above),
`worklist.jsonl.gz` (the 12,431 flagged pages: ids, pair, which read lacks each run, position; no page text),
`by-eye-20.json`. Unit test `tests/unit/dropped-line-candidates.test.ts`.
