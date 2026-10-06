<!-- PRIOR ART: _series-monthly-translation-corpus-audit.md (#5301, one interior page per book, text-only judge) is the monthly series; this is the image-and-book arm on a fortnightly cadence (#5914), so it gets its own table. -->
## Fortnightly spot check (#5914) — what does a reader meet, read against the page images?

One row per fortnight (newest first), written by the review routine (`scripts/eval/spot-check/ROUTINE.md`) from
`scripts/eval/spot-check/score.mjs`. Design: every other Monday, 10 public books drawn uniformly per BOOK (seed = the
draw date), a random run of 3 consecutive translated pages each, read against the images by 2 blind Opus reviewers
with the frozen brief `scripts/eval/spot-check/REVIEWER.md`. A **serious** error misleads a reader about what the
source says or is (sense reversed, text invented or dropped, wrong leaf). An **on-sight defect** is anything an expert
would flag opening the book: a serious error, a wrong shelf, a rights problem, broken structure, or leaked markup.

**The headline is the rolling 8-week window** (about 40 books, 120 pages), with a 95% CI resampled by BOOK, because the
3 pages of one book are one observation. One fortnight's 10 books move by chance; read the window. The window pools
only runs from the same frame.

Not comparable with the monthly audit's "any major" rate (whole corpus, one interior page, translation only, page
ends excluded). This arm counts transcription, wrong-leaf and structure errors too.

| date | frame | books | pages | pages with ≥ 1 serious (%) | books with an on-sight defect | rolling 8-week: pages with a serious error (CI) | rolling 8-week: books with an on-sight defect (CI) | top 3 classes (pages) |
|---|---|---:|---:|---|---:|---|---|---|
| 2026-10-06 (month 0) | canon shelves, any visibility, 30 books | 30 | 91 | 21 (23%) | ≈ 18 | 23% (12–35)¹ — baseline, not pooled | 60% (43–77)² | by books, no classes recorded: reversed sense (7 books), broken structure (6), text not on the page (5) |

¹ Month 0 CI resampled by book from the 25 books whose per-book results survive (ops `rights-screen/2026-10-06-canon-shelves/spot30/result0–4.json`)
plus batch 5's 16 pages and 2 serious pages, assumed spread over two of its five books (the batch's JSON was not written). The 25 books alone give
25% (13–39). Entry: `2026-10-06-random-book-spot-check-canon-shelves-5914.md`.
² Month 0 judged on-sight defects as a count (≈ 18 of 30), not per book; the CI treats it as exactly 18.
