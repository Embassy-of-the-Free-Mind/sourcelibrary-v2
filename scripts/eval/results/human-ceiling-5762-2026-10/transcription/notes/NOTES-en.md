# English human pairs — #5762 track 2

Output: `pairs.jsonl` 88 pages from 33 books (84 same-edition pages / 31 books, 4 edition-mismatch pages / 2 books);
`rejected.jsonl` 29 entries (28 candidates ruled out, 1 page dropped from an accepted book). 71 pages carry our
served OCR; 9 pages were edition-checked by eye. All numbers are the scorer's to compute; none are quoted here.

## What was searched
- **#5124 draw** (`scripts/eval/results/en-ocr-ref-5124/draw.jsonl`): its 126 Wikisource-matched books were matched
  against the Gutenberg catalogue (`pg_catalog.csv`, title words + author surname; gutendex returns 403 from this
  host). 44 had a plausible Gutenberg text; 7 pre-1700 ones had an EEBO-TCP text (ids from the TCP catalogue
  `TCP.csv`).
- **EEBO-TCP × Gutenberg** for pre-1700 books we hold: the draw's `gutenberg` rows and the 80 books in
  `scripts/eval/results/edition-refs/` with a TCP id, matched against the Gutenberg catalogue.
- Three pair types came out: EEBO-TCP × Gutenberg (5 books, 15 pages), Wikisource × Gutenberg (24 books, 62 pages),
  Wikisource × EEBO-TCP (3 books, 7 pages; Wilkins' *Discovery* 1638 exists in all three and is used once per page).

## How a page was cut (`lib.mjs`, `run.mjs`)
- Each side is cut at its own page marker where it has one (Wikisource `Page:`, Gutenberg `pagenum`, TCP `<pb>`);
  the matching page on the second side is found by word overlap. Where the second side has no usable marker
  (Gutenberg #15491, #51034, #13476, #46976 whose page segments carry the footnotes, and the two mismatch books) it
  is cut to the first side's page by word-level fitting alignment with no pad; `cut_method` says which.
- Left out on both sides: running heads, page numbers, catchwords, signatures, footnotes (Wikisource `<ref>`,
  Gutenberg footnote blocks and anchors, TCP `<note>`), marginal notes (Wikisource sidenote templates, Gutenberg
  `sidenote`, TCP `<note place="margin">`), TCP `<gap>` descriptions and end-of-line hyphen marks. Long-s and
  drop-initial templates/images are turned back into the letter. Nothing is respelled.
- A word broken across the page edge is treated differently by each source, so both cuts are trimmed to the first
  and last run of three shared words (at most a word or two; recorded per row in `cut_method`).
- Pages dropped for a cut defect, not for their score: boundaries that do not meet, wiki table/image markup left in
  the text, fewer than 100 words.

## Independence: what was checked, and its limit
A page with no letter difference is common here (49 of the 84 same-edition pages), so each Wikisource book was
checked for a shared ancestor on evidence other than the score (`summary.mjs`, `rawdiff.mjs`, `evidence.mjs`):
the page's first revision (author, comment, how far it was from the final text and from the other source), whether
its line breaks follow the printed lines or Gutenberg's wrapped text, release dates, and differences in what the
letter-only scorer ignores (punctuation, capitals, hyphens). For books whose sampled pages were identical, up to 8
more proofread pages of the same Index were compared.
- **Proven copies, rejected:** Leviathan 1651 (Wikisource pasted from EEBO-TCP: first revision identical to TCP to
  the punctuation on a 1651 page), Iamblichus and Jung (Phe-bot match-and-split).
- **Nothing separates the two, rejected:** Westervelt, Poetic Edda, Fairy Tales from Brazil, Diamond Sutra. These
  are not proven copies. **Removing them removes only zero-difference pages**, so the Wikisource × Gutenberg floor
  from the accepted set is biased upward by that much; with them in, it would be lower.
- **Accepted on thin evidence** (stated in each row's `independence`): Isis Very Much Unveiled (one interior comma
  over 3,108 further words) and The Tale of Genji (ellipsis character and one punctuation mark over 2,691 words).
  Dropping these two books is the conservative reading.
- EEBO-TCP × Gutenberg pages are also often letter-identical; there the raw texts differ in punctuation, ligatures
  and occasional misreadings on nearly every page, which a copy would not.

## Edition
- Same edition = title pages agree AND, where both sides have page markers, both break the page at the same words.
  9 pages checked against the page image (Boyle 168, Stone-Heng 50, Grew 138, Micrographia 112, Wilkins *Discovery*
  152, Wilkins *Essay* 372, Agrippa 2, Lea 125, Chuang Tzu 276): first and last line confirmed on both cuts.
- Two caveats recorded on the rows: the Elder Edda (Gutenberg title page 1906, our scan the 1907 issue, page
  breaks coincide) and Tylor vol. 2 (Gutenberg title page 1920; our record says 1871; page breaks coincide).
  Tesla is `unchecked` (Gutenberg gives only "New York: 1892").
- Kept as flagged mismatches: Saducismus Triumphatus (our scan is the 1700 edition, TCP the 1681) and Swinburne's
  Poems and Ballads (Gutenberg follows the collected edition).
- Gutenberg often transcribes a later reprint: Scot, Sinclair, Potts, Williams, Jonson, Aubrey, and several
  nineteenth-century books were rejected for that (see `rejected.jsonl`).

## Things found in our own data along the way
- **Stone-Heng 1655 (`69ee2b70…`): served OCR and image are off by one.** The OCR stored on page 65 is printed
  p.50, whose image is `0064.jpg`; `0065.jpg` shows p.51. The pair rows use the page whose OCR matches.
- Saducismus Triumphatus (`6952db24…`) is recorded as 1681 but the scan's title pages say 1700.
- The #5124 draw matches The Jew of Malta (`6a08fd63…`) to the Wikisource Index of Tamburlaine.
- No served OCR on the pages used from: Elder Edda, Isis Very Much Unveiled, Anabasis of Alexander, Ford's Essays,
  two Wilkins *Discovery* pages, one Geronimo page; The Yellow Book record holds one page. Those rows have
  `ours: null`.
- De Vinne p.395: our OCR is far from both transcriptions (two-column page with shoulder notes); left as served.

## How many pages exist in principle, and what blocked more
- The accepted books alone hold thousands of pairable pages (every proofread Wikisource page of the 24 books, and
  every page of the 5 TCP × Gutenberg books); the cap here is the brief's 3 pages per book.
- More books: the search covered only our books already matched to Wikisource or TCP. A catalogue-wide join of
  TCP ids to Gutenberg would add pre-1700 titles we do not hold (`ours: null`).
- Blockers: Gutenberg texts without page markers or without a stated source edition (Walden, Malay Archipelago,
  Dickinson, Science of Breath); Wikisource Indexes with one or no proofread body page (Burton 1621, Fairy-Faith);
  gutendex 403; Wikimedia rate limiting (requests are throttled in `lib.mjs`).

## Files
`make-candidates.mjs` → `candidates.json`; `run.mjs` → `work/cands.jsonl` (cuts + diagnostics); `summary.mjs`,
`rawdiff.mjs`, `evidence.mjs` (independence evidence, `work/evidence.jsonl`); `eye.mjs` + `eye/*.jpg` (page images
checked); `finalize.mjs` (decisions → `pairs.jsonl`, `rejected.jsonl`); `src/` downloads.
`work/score-sanity/` is a sanity run of the shared scorer, not a result.
