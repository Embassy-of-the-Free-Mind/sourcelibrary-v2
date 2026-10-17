# latin-refs-5924 — Latin print reference set, one leaf per book (#5924)

PRIOR ART: `scripts/eval/benchmark/latin-r4-acc.json` (round 4: e-text references, books limited to those with a
CAMENA / EEBO-TCP / la.wikisource transcription, so it had no gothic type); `scripts/eval/kraken-refused-4686`
(single-read Opus same-leaf references). This set draws from all holdings and reads the leaf three times.

The reference set that gates #5924 (does an open OCR engine beat flash-lite on Latin print, by century). Built
2026-10-17 by job `latin-refs-5924` (#6871 row 2). **No OCR engine was run, and nothing was written to `pages` or `books`.**

| cell | books (= pages) | hidden books | year range | characters | A/B word agreement, median (min) |
|---|---|---|---|---|---|
| 1600s | **59** | 51 | 1601–1698 | 119,826 | 0.956 (0.451) |
| 1500s | **40** | 33 | 1502–1599 | 89,494 | 0.935 (0.622) |

That is ≥ 50 and ≥ 30 by the issue's bar. The 1700s and incunabula were not drawn: this job's brief covered only the two
decision cells.

## Files

- `scripts/eval/benchmark/latin-refs-5924.json` is the manifest. Its `pages[]` uses `slug, book_id, page_number, substratum` in
  the `latin-r4-acc.json` shape, and it also holds the draw rule, the frame sizes and the post-adjudication exclusions.
- `scripts/eval/benchmark/refs/lr-<book_id>-p<page>.txt` holds the reference text (NFC). Each has a `.json` sidecar
  (`reference_kind: same-leaf-transcription`) recording the image URL, the `pages.photo` field it came from, the
  **sha256 of the leaf bytes** read, the readers and pass dates, `prompt_hash`, A/B agreement, the C choice counts and the
  typeface.
- `passes/<slug>.A.txt` and `.B.txt` are the two blind reads. `passes/<slug>.C.json` holds every adjudicated hunk with both
  readings and C's verdict (`A` / `B` / `other`).
- `draw-log.json` lists every drawn book in seeded order with its outcome and each rejected leaf with the reader's reason.
- `prompt-transcribe.md` is the A/B prompt and the convention. `prompt-adjudicate.md` is the C prompt.
- `../latin-refs-5924.mjs` runs `draw`, `fetch`, `diff` and `finalize`. `draw-status.cjs` does the draw bookkeeping.

## How the books were drawn (exact enumeration, no `$sample`)

1. **Frame.** Every `books` row with `language` matching `/latin|^lat$|^la$/i` (round 4's regex) and `pages_count > 0` was
   enumerated in full: 54,254 rows. The century is the first `1[4-7]xx` in `published` (#5924's queue definition).
   Excluded from the frame: no 1500s/1600s year (22,887), `duplicate_of` set (1,186), and fewer than 12 pages (1,800,
   mostly single-leaf EEBO broadsides that have no body). Frame: **1600s 16,427 books, 1500s 11,954**. Hidden books are
   included, so the frame is our holdings and the OCR backlog, not just the reading room.
2. **Order.** Per century, the frame was sorted by `book_id` and shuffled by Mulberry32(5924 + 1600 or 1500). Books were
   taken in that order: the first 72 (1600s) and 48 (1500s). The first 56/36 were drawn, then the draw was extended
   once along the same order (prefix verified identical) to cover rejects.
3. **Leaf.** Per book, `pages` were sorted by `page_number`. The body window is index [0.15·n, 0.90·n), which skips front
   matter and back matter. The window was shuffled by Mulberry32(5924 ^ fnv1a(book_id)). Candidates are the first 4
   leaves that have a provider URL and no split `crop`. Reader A looked at candidate 1 and REJECTED it if it was blank,
   a plate, a title page, an index, a numeric table, mostly not Latin, handwriting, or too damaged. A leaf with more than
   five `[?]` counts as rejected (obscured edge). On a reject the next candidate was read.
4. **Outcome of the 120 books taken:** 100 accepted; 10 unreachable (Gallica IIIF answers 403 to the job host for 9, and one
   archive.org leaf gave 400/504); 6 dropped as mislabelled (two not-Latin or handwriting rejects: German vernacular,
   Greek, Greek/Latin parallel, a manuscript); 4 with no usable leaf among 4 candidates (plates, numeric tables, obscured
   gutters). One accepted page was excluded after adjudication (`lr-6a906d71…-p227`: 17 cut-off words → `[?]`).
   Leaf rejects, all books: not Latin 12, index 7, numeric table 7, obscured 4, plate 3, blank 2, handwriting 2, runic 1.
5. **Same edition, same leaf.** The image is the URL in `pages.photo` itself. In all 99 pages that is the provider's IIIF or
   archive leaf (e-rara 47, archive.org 30, BSB 19, Heidelberg 3). It is never an R2 copy: a leaf whose `photo` and
   `photo_original` both point at our own buckets was not a candidate. The sha256 of the bytes read is in each sidecar.
   An engine scored on this set must be given that same URL; check the hash.

## How the text was made (no human hours, no Gemini)

All three readers are `claude-opus-5-5` subagents on the subscription. Each opened the leaf as a full view plus 3–4
overlapping horizontal bands, which were cut from the original bytes at ≤ 1,800 px wide.
- **A and B** are independent blind diplomatic transcriptions, at up to 5 pages per call. They were run in different
  groupings, and neither could see the other.
- **diff** is a word-level LCS of A vs B after NFC. A hunk that differs only in spacing (`ord.reg.` / `ord. reg.`)
  keeps A's spacing and is not adjudicated, because the letters-only scorer cannot see it: 1,090 such hunks.
- **C** is a third reader. C opened the image and decided each of the remaining **355 hunks** from the leaf, choosing A, B,
  or its own reading (`other`). C saw only the hunks and their context, never A's or B's full text. Verdicts:
  1600s A 70 / B 72 / other 11; 1500s A 106 / B 51 / other 27. The final text is A with C's readings spliced in.

## Convention `latin-refs-5924@1` (full text in `prompt-transcribe.md`)

The text is diplomatic. It keeps ſ, u/v and i/j as printed, æ/œ, and abbreviations as printed: a combining macron or tilde,
`ꝑ ꝓ ꝗ ꝯ ꝰ ꝫ ꝝ`, `q;`, `&`, `⁊`. Accents (`q́;`, `à`, `ę`) and printer's errors are kept as printed, and line-end hyphens
are written as `-`. The italic ß-shaped ligature is written `ſs`. One output line per printed line.
**Order on the leaf:** running head and folio, body, footnotes, then the marginal notes top to bottom, then
signature/catchword. Two columns go left then right. The facing-leaf edge strip and show-through are omitted. Small
caps are written as capitals.

Using it with `latin-norm@1` (`latin-r4-report-5924.mjs norm`), the round-4 primary score: that fold handles ſ, the
ligatures and the abbreviations. Two things are left for the scorer:
- **Marginalia placement.** An engine that interleaves side-notes with the body pays a reordering cost under plain CER. Use
  an order-tolerant view (bag-of-lines or windowed) as a secondary score, or strip the marginal block from both sides.
  The A/B passes show the block's boundaries.
- **`[?]`.** It appears 2 times in the whole set (both in `lr-69b641d0…-p29`). Treat it as a wildcard or drop it.

## Typeface (by the readers' metadata)

- 1500s: mixed roman/italic 18, roman 8, italic 6, **gothic 3 (rotunda 2, schwabacher 1) + 1 mixed gothic/roman**, readers
  disagreed 4.
- 1600s: mixed roman/italic 48, roman 7, mixed gothic/roman 1, disagreed 3. Three pages carry Fraktur passages inside Latin
  roman text.

## Known limits

- **The model judges the model.** All three readers are the same model. Errors that are correlated (the same plausible
  misreading of a worn letter, a learned spelling where the printer erred) survive the A/B check. Agreement is not
  accuracy, and no human has spot-checked this set (Derek's rule: no human hours). The references may lean toward
  readings that Claude-family models find likely. That does not favour any arm in #5924, which is open engines vs Gemini,
  but it would favour a Claude arm if one were ever added.
- **C was not fully image-blind-proof.** One C call lost image access ("request limit") and answered 3 pages (12 hunks) without
  the leaf. Those were set aside (`pass/C-blind`, not committed) and redone with the image. The blind answers matched the
  redo on 11 of 12 hunks, so many hunks can be decided from the text alone and C's verdicts are not purely visual.
  Another C call wrote p353 before its images loaded, then checked all 14 hunks against crops (no change). Two C
  calls briefly shared a `/tmp` crop folder; one noticed a foreign crop and re-read from the bands. Every leaf's sha256
  was re-verified afterwards: no mismatch.
- **Gothic is thin.** 4 of 40 1500s pages are gothic and none of the 1600s main texts are. A uniform draw *by book* finds far
  less blackletter than round 4's by-eye population read (30% of pages, which included the 1400s and undated books). The
  queue is page-weighted, and this set is book-weighted. **There is no gothic cell here.** One would need a stratified
  draw.
- **Gallica is missing.** BnF leaves return 403 to this host, so 9 Gallica books were skipped in draw order. The set
  under-represents BnF holdings.
- **Low-resolution leaves.** 49 of the 99 leaves are at most 1,100 px wide (mostly e-rara and BSB). The readers saw the same pixels an engine gets.
  Some abbreviation strokes (macron vs tilde) and Greek accents are best readings, noted in the C files.
- **Greek and Hebrew inside Latin pages** were transcribed best effort, with print ligatures spelled out. They make up a small
  share of the characters, but they are the least reliable part of the set.
- **Rejected candidates are not random.** Index, table and plate leaves were skipped by rule. The set measures running Latin
  text, not the whole book.
