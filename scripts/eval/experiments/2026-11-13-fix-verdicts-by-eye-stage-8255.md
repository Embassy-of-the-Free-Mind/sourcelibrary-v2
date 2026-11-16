---
stage: ocr
measure: judged
languages: [he, hy, ja, ko]
scripts: [Hebr, Armn, Jpan, Hang]
canons: []
n_books: 50
n_pages: 210
status: informational
feeds: [repair]
superseded_by: null
issue: [8255, 8518]
router_evidence: "none — no route was compared; the pages are stored text in cells that bind no repair route (repair-queue: 78 no-route, 73 deferred, 0 queued)"
defect_rates: "none — pages were picked because an earlier check flagged them, so no rate per 1,000 words describes a route"
verdict: "Of 50 visible books with a stored `fix` verdict (Hebrew 24, Japanese 10, Armenian 5, Korean 11), an Opus reader with the image open confirmed the earlier finding on a flagged page in 46; in 3 the flagged page was repaired since or not found but another page was serious; 1 is no longer a fix. 69 of the 97 pages the earlier check had not read were also serious. No page sits in a cell with a bound repair route."
decision: "No agy work queued and no feed script built (inbox redirect, 2026-11-13). 50 book_checks rows recorded (method fix-feed-8255); 32 pages in 17 books contained by eye (9 new holds, reason by-eye-off-leaf-pages, release on v2#8255). repair-queue.mjs already reads these rows through labels.mjs, so no code change was needed there."
---

PRIOR ART: v2#8518 step 3 (by-eye check of the first 50 P5 `fix` books: 46 confirmed, 4 wrong, comment of 2026-11-10);
`scripts/eval/error-zoo/repair-queue.mjs` (#8632: findings to a queue per router cell); `scripts/eval/methods/fix-feed-8255.md`.

## 2026-11-13 · Are the stored `fix` verdicts right, and at which stage do the defects enter? (v2#8255, v2#8518)

**Who reads this.** Whoever decides the repair route for Hebrew, Armenian, Japanese and Korean, and whoever next asks
whether a `fix` verdict can be acted on without a second look.

**Frame.** 469 visible books whose latest image-opened `book_checks` verdict was `fix` on 2026-11-13 (157 already held).
Read in the order of fix share by language; this entry covers the first 50. The books come from 9 check methods
(paired-fifths-check 12, curation-check 11, served-audit 11, shelf-overview 6, and five others), so this is a check of
`fix` verdicts in general, not of one method.

**Method.** `scripts/eval/fix-feed-8255/packet.mjs` builds a packet per book: up to 4 pages the earlier check flagged
and 2 pages it had not read (ordered by a hash, so unselected), each with the image, the stored transcription and the
stored English. An Opus subagent follows `READER.md`: open every image, confirm or reject the earlier finding, and name
the stage of each serious error. Selection is `picked`. The flagged pages are biased toward defects by construction;
the 2 extra pages a book are the only unselected ones. One reader, not calibrated against a second family.

### Result

| | books | confirmed | flagged page not confirmed, another page serious | no longer a fix |
|---|---|---|---|---|
| all | 50 | 46 | 3 | 1 |

By flagged page (113): 107 confirmed (104 serious, 3 minor), 5 repaired since the check, 1 not found. A `fix` verdict
was wrong about the book in at most 4 of 50 (8%), and in 3 of those 4 the cause is a repair made after the check, not
a wrong reading. The #8518 stop bar was 20%.

| language | books | pages read | serious | extra pages serious | book stage (reader) |
|---|---|---|---|---|---|
| Hebrew | 24 | 105 | 92 | 40 of 47 | OCR 9, mixed 8, invented 7 |
| Japanese | 10 | 36 | 27 | 10 of 18 | OCR 3, mixed 3, translation 3, none 1 |
| Armenian | 5 | 24 | 19 | 5 of 10 | OCR 2, mixed 1, invented 1, wrong leaf 1 |
| Korean | 11 | 45 | 36 | 14 of 22 | OCR 5, mixed 4, invented 2 |

Serious errors by stage: OCR 281, translation 85, page unit 4. By kind: misread 129, text with no basis on the leaf
(confabulation, recitation, illegible fill, show-through) 105, omission 51, mistranslation 33, layout 20. The extra
pages are the finding that matters for repair: 69 of 97 unselected pages (71%) were serious, so in these books the
defect is the read, not the page. 2 extra pages a book is too few for a book rate.

### Where the findings went

- `book_checks`: 50 rows, method `fix-feed-8255`, run `fix-feed-8255-2026-11-13`; evidence `scripts/eval/fix-feed-8255/results/verdicts.jsonl.gz`.
- Containment (`containment-on-finding.md`): 32 pages in 17 books whose stored text or English is not the leaf's, where
  the reader was confident with the image open. English withheld; 9 books newly held. Pages the reader marked with
  medium confidence (16) are findings only; 6 more were already withheld.
- Repair queue: `repair-queue.mjs` over these labels gives 151 pages with a serious OCR finding: 78 `no-route`, 73
  `deferred` (book held), 0 `queued`. Cells: `hebrew-flash3/unknown` 49, `korean-lite/manuscript` 26, `hebrew-lite/print`
  13, `armenian-lite/manuscript` 10, and 10 smaller ones
  (`scripts/eval/fix-feed-8255/results/repair-queue-fixfeed-2026-11-13.json`). None binds a route in
  `2026-11-01-validated-7263`.

### Limits

- One model family read these pages. `repair-queue.mjs` asks for two families before `queued`; none of these has a Gemini read.
- The reader rated its own reading of the script `partly` for most Hebrew cursive, Armenian erkatagir and old Korean.
  Its confident findings are of the visible kind (a blank leaf with text, a loop, a known verse where the leaf has
  another text), which is why only those were contained.
- The full repair queue was not rebuilt here: the weekly spare-audit labels live on gex45-1, and a queue built on this
  box would drop them.

### Next

419 `fix` books are not read (Sanskrit, Arabic, Persian, Greek, Chinese, Russian, Dutch, Italian, Latin, English,
French, Spanish, German, Tibetan). The repair for the four languages here waits on a route decision for
their cells, not on more diagnosis.
