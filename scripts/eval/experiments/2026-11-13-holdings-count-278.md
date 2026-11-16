---
stage: metadata
measure: [none]
languages: []
scripts: []
canons: []
n_books: 593122
n_pages: 33458793
verdict: "What the library holds on 2026-11-13, by edition language and century: 71,313 live books (visible with pages) hold 17.64M pages, 8.55M with OCR text, 5.57M with English, 14.79M with an archived image (RECORD tier). 82,835 hidden books hold 15.82M fetched pages (1.60M OCR). 413,974 of the 593,122 book records are not-acquired catalogue records whose 88.3M 'pages' are manifest leaf counts with no page documents. Engine provenance: 60% of live OCR pages and 76% of live English carry no engine block (written before the September 2026 provenance writers); not guessed. Totals: 21K page verdicts across book_checks and lane_judge_verdicts (each counted once); 195,081 pages in 4,867 books have their English withheld now; of 8.70M page_revisions rows, 1.98M OCR rows are a labelled re-read with superseded text, and where both reads recorded their image (195,365) 99.0% name the same image URL."
status: informational
feeds: [figure]
supersedes: []
superseded_by: null
issue: [278]
router_evidence: "none — a census of stored counters and provenance; no page judged"
defect_rates: "none — counts what is held, not how good it is"
---
## 2026-11-13 · One count of what the library holds, by language and century, plus judge verdicts, withheld pages and real re-reads (#278)

PRIOR ART: `scripts/audit/model-usage-snapshot.mjs` (exact pages per engine, but a two-hour walk of all 35M page documents, with no language, century or visibility cut); `2026-11-02-stock-by-engine-7933.md` (a one-off `$sample` engine census of live pages); `2026-10-02-corpus-page-profile-5643.md` (one page per book: script and typeface); `scripts/audit/archive-coverage.mjs` (the three archive tiers); `scripts/audit/ocr-revision-provenance.mjs` (page_revisions by source, 2026-08, when the store held 190K rows). None of them prints the table or the three totals in one run. This one is `scripts/audit/holdings-count.mjs`.

- **Question.** How many books and pages does the library hold, in which edition languages and centuries, with OCR text, an English translation and an archived image, live and hidden? How many page-level judge verdicts are recorded, how many pages have their English withheld, and how many `page_revisions` rows are a real second read of the same image?
- **Design.** Read-only, production `bookstore`, secondary-preferred, every aggregation under `maxTimeMS` (exit 2 rather than a partial table). The table sums the stored visible-page counters (`pages_count`, `pages_ocr`, `pages_translated`, `pages_archived`; `page-counts.md`) per book, grouped by `books.language` (the edition's language) and the century of the numeric `books.year` ("unknown" when there is none; `published` is never parsed). Groups: **live** = `visible: true && pages_count > 0`; **hidden** = not live, with pages, not a not-acquired record; **not acquired** = held `manifest-only-lazy-pages` / `acquisition-wave-2026-10b`. "Archived" is the RECORD tier only (an `archived_photo` on the page doc), never FILE or MASTER. The engine split is a seeded page-uniform sample (6,000 OCR pages), because a full walk takes about two hours; families come from the `engine` block or the Archive's `ocr.ia` record, and anything else is "no engine block", never inferred from `ocr.model`. Run time 9 minutes.
- **Positive controls** (`--control`, all passed). One book, *Miscellaneorum Centuria Prima* (`2950c384-…`, Latin, 1400s, live), recounted from its page documents with the `page-counts.mjs` predicates: pages 198 = 198, OCR 198 = 198, English 185 = 185, archived 198 = 198, canonical recount 198 = 198; book_checks rows 1 = 1 and pages read 10 = 10; withheld now 1 = 1, record only 0 = 0; revision rows 263 = 263, READ-labelled 24 = 24. Lane-judge rows were checked on a book that has them (`6a05f0bf…`): 17 = 17, item rows 17 = 17. Cross-checks: the live book count (71,313) equals `homepage_stats.totalBooks` written at 13:35Z the same day; live + hidden pages held (33.46M) sit 1.7M under the 35.17M page documents, a difference that includes soft-hidden and repeat-capture pages, which no counter counts.
- **Findings.**
  1. **The record count is not the library.** 593,122 book records, but 413,974 are catalogue records from the October acquisition waves with no pages fetched: their 88.3M "pages" are manifest leaf counts. The library a reader can open is 71,313 books and 17.64M pages; another 82,835 hidden books hold 15.82M fetched pages.
  2. **About half the live pages have text.** 8.55M of 17.64M live pages carry OCR text and 5.57M carry English. Latin books without a numeric year (23,773 live books, 5.31M pages) are the largest untranscribed block: 4% of their pages have OCR.
  3. **Most text has no engine record.** 60.2% of sampled live OCR pages and 76.2% of live English pages carry no engine block: they were written before the September 2026 provenance writers. Where an engine block exists, PaddleOCR (Chinese) dominates OCR (19.3% of live pages).
  4. **Verdicts.** book_checks holds 2,660 rows covering 10,873 page reads (October and November 2026, all by a model reader); lane_judge_verdicts holds 10,990 page verdicts plus 370 controls. 537 lane-judge test rows are copies of book_checks reads, so the two stores hold **21,326 distinct page verdicts**. The 9,370 test rows carry `judged_at: null`, so their month is not recorded.
  5. **Withheld English.** 195,081 pages in 4,867 books have a withheld record and no English now. Another 246,065 pages carry the record with English restored (an archive, not a state). 2,257 of the withholding books are under no pipeline hold. Decision holds cover 75,868 books, 42,428 of them live.
  6. **Re-reads.** Of 8.70M `page_revisions` rows, 3.67M are notes-layer translation backfill. On OCR, 2.27M rows carry a READ label (1.98M with the superseded text), 89K a MOVE label (shift repairs) and 804K a cleanup or guard label (`longs-pass-5924` alone is 485K f→ſ rewrites). Where both the old and the current read recorded their image (195,365 rows), 99.0% name the same image URL. The "about 40% read different images" of 2026-07-30 describes the store as it was then, dominated by the erara shift repair.
- **What it does not say.** The page counters are what is stored. Their drift is measured by `page-count-audit.mjs`; on the control book they were exact. Engine shares are a sample with the n per row printed. The image check compares URLs, and a different URL can still be the same leaf.
- **Corrected figures in the repo (same PR):** `.claude/docs/invariants/visibility-and-stats.md` § Corpus counts (2026-09-17: 114,695 docs / 41,919 readable); `.claude/docs/paper-corpus-certification-4916.md` §4 and evidence row C1 (2026-09-18: 114,745 / 41,919 / 21.6M / 6.77M / 5.07M); `.claude/docs/invariants/page-revisions-corpus.md` (109,953 pairs, now one dated re-measurement line).
- *Replicated?* Run twice the same afternoon (16:53Z and 17:24Z). Live figures were identical; hidden books grew by 630 while an importer ran.
- **Artifact.** The full output is below. JSON with every cell: `node --env-file=… scripts/audit/holdings-count.mjs --json=<path>`.

## Output (2026-11-13T17:24Z run)

# holdings-count (#278) — production bookstore, read 2026-11-13T17:24:24.208Z → 2026-11-13T17:33:21.217Z (537 s; table 40 s)
Filters: live = visible: true && pages_count > 0 · hidden = not live, pages_count > 0, hold reason not in [manifest-only-lazy-pages, acquisition-wave-2026-10b] · not acquired = those hold reasons · language = books.language (edition) · century = numeric books.year, "unknown" if none.
Page counts are the stored visible-page counters (page_number > 0, not a repeat capture): pages_count, pages_ocr, pages_translated (blank leaves out), pages_archived (RECORD tier: archived_photo present).

## Totals by group
| group | books | pages held | books w/ OCR | OCR pages | books w/ English | English pages | books w/ archived | archived pages (RECORD) |
|---|--:|--:|--:|--:|--:|--:|--:|--:|
| live | 71,313 | 17,642,341 | 50,182 | 8,549,263 | 26,510 | 5,571,818 | 68,234 | 14,791,120 |
| hidden | 82,835 | 15,816,452 | 28,664 | 1,601,253 | 2,501 | 318,219 | 68,088 | 10,518,346 |
| not acquired | 413,974 | 88,308,254 | 34 | 486 | 8 | 397 | 1,904 | 170,802 |
| no pages | 25,000 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| **all** | 593,122 | 121,767,047 | 78,880 | 10,151,002 | 29,019 | 5,890,434 | 138,226 | 25,480,268 |
Cross-check: live + hidden pages held = 33,458,793 against 35,172,591 page documents (estimatedDocumentCount). The difference includes soft-hidden (page_number ≤ 0) and repeat-capture pages, which no counter counts, and pages of not-acquired records; it is not broken down here.

## Language × century — live beside hidden (not-acquired catalogue records excluded; languages under 200,000 live+hidden pages folded into one row)
| language | century | live books | live pages | live OCR | live English | live archived | hidden books | hidden pages | hidden OCR | hidden English | hidden archived |
|---|---|--:|--:|--:|--:|--:|--:|--:|--:|--:|--:|
| Latin | 0100s | 1 | 32 | 25 | 25 | 32 | 0 | 0 | 0 | 0 | 0 |
| Latin | 0400s | 1 | 162 | 162 | 155 | 162 | 0 | 0 | 0 | 0 | 0 |
| Latin | 0700s | 0 | 0 | 0 | 0 | 0 | 1 | 6 | 0 | 0 | 6 |
| Latin | 0800s | 9 | 1,809 | 1,797 | 1,649 | 1,809 | 0 | 0 | 0 | 0 | 0 |
| Latin | 0900s | 5 | 988 | 988 | 942 | 988 | 0 | 0 | 0 | 0 | 0 |
| Latin | 1000s | 19 | 3,304 | 3,123 | 3,002 | 3,304 | 1 | 16 | 0 | 0 | 16 |
| Latin | 1100s | 47 | 8,567 | 8,044 | 7,766 | 8,567 | 1 | 286 | 91 | 0 | 286 |
| Latin | 1200s | 68 | 12,952 | 12,616 | 11,977 | 12,944 | 9 | 3,110 | 844 | 414 | 3,100 |
| Latin | 1300s | 82 | 19,427 | 18,647 | 17,512 | 19,427 | 4 | 990 | 312 | 1 | 990 |
| Latin | 1400s | 1,365 | 323,959 | 301,662 | 289,069 | 323,292 | 602 | 204,626 | 46,743 | 5,534 | 202,194 |
| Latin | 1500s | 2,901 | 934,922 | 699,323 | 663,996 | 911,745 | 3,139 | 824,276 | 109,328 | 39,382 | 777,436 |
| Latin | 1600s | 2,474 | 737,941 | 520,751 | 480,541 | 735,589 | 4,300 | 1,140,686 | 149,154 | 28,656 | 1,058,139 |
| Latin | 1700s | 806 | 271,980 | 193,735 | 171,758 | 269,822 | 1,308 | 302,573 | 48,300 | 8,866 | 272,436 |
| Latin | 1800s | 320 | 155,926 | 140,520 | 134,162 | 155,884 | 125 | 54,462 | 11,880 | 2,255 | 53,916 |
| Latin | 1900s | 96 | 41,846 | 38,581 | 37,555 | 41,829 | 64 | 26,362 | 10,835 | 7,098 | 25,048 |
| Latin | 2000s | 1 | 466 | 466 | 434 | 466 | 0 | 0 | 0 | 0 | 0 |
| Latin | unknown | 23,773 | 5,309,460 | 231,303 | 93,575 | 3,277,488 | 12,531 | 4,510,652 | 228,526 | 2,431 | 3,682,319 |
| Chinese | 0100s | 1 | 188 | 188 | 188 | 188 | 0 | 0 | 0 | 0 | 0 |
| Chinese | 0200s | 1 | 100 | 100 | 90 | 100 | 0 | 0 | 0 | 0 | 0 |
| Chinese | 0300s | 1 | 116 | 116 | 115 | 116 | 0 | 0 | 0 | 0 | 0 |
| Chinese | 0400s | 1 | 86 | 86 | 86 | 86 | 1 | 30 | 25 | 0 | 30 |
| Chinese | 0500s | 2 | 257 | 257 | 257 | 257 | 0 | 0 | 0 | 0 | 0 |
| Chinese | 0600s | 4 | 145 | 145 | 142 | 145 | 2 | 1,010 | 998 | 25 | 1,010 |
| Chinese | 0800s | 7 | 385 | 383 | 364 | 385 | 1 | 1 | 1 | 0 | 1 |
| Chinese | 0900s | 16 | 739 | 739 | 733 | 739 | 0 | 0 | 0 | 0 | 0 |
| Chinese | 1000s | 9 | 1,305 | 1,265 | 822 | 1,305 | 0 | 0 | 0 | 0 | 0 |
| Chinese | 1100s | 21 | 4,967 | 4,851 | 2,622 | 4,967 | 1 | 467 | 464 | 0 | 467 |
| Chinese | 1200s | 12 | 1,170 | 1,170 | 1,162 | 1,170 | 4 | 433 | 425 | 104 | 432 |
| Chinese | 1300s | 16 | 2,087 | 2,051 | 1,195 | 2,087 | 0 | 0 | 0 | 0 | 0 |
| Chinese | 1400s | 14 | 3,788 | 2,814 | 1,803 | 3,788 | 1 | 124 | 123 | 0 | 124 |
| Chinese | 1500s | 131 | 26,500 | 25,246 | 17,581 | 26,024 | 4 | 6,259 | 3,795 | 249 | 6,259 |
| Chinese | 1600s | 361 | 42,246 | 36,436 | 31,786 | 42,194 | 21 | 26,540 | 9,170 | 788 | 25,502 |
| Chinese | 1700s | 804 | 126,835 | 115,369 | 51,188 | 126,835 | 18,074 | 2,655,997 | 106,944 | 244 | 2,035,692 |
| Chinese | 1800s | 158 | 23,006 | 18,971 | 17,622 | 23,006 | 2 | 102 | 0 | 0 | 0 |
| Chinese | 1900s | 15 | 5,451 | 5,018 | 4,724 | 5,451 | 18 | 7,003 | 1,753 | 1,521 | 4,532 |
| Chinese | 2000s | 0 | 0 | 0 | 0 | 0 | 2 | 701 | 25 | 25 | 341 |
| Chinese | BCE | 1 | 98 | 98 | 98 | 98 | 0 | 0 | 0 | 0 | 0 |
| Chinese | unknown | 11,578 | 1,756,441 | 1,565,519 | 231,897 | 1,755,635 | 64 | 22,319 | 11,725 | 384 | 17,279 |
| German | 1300s | 3 | 552 | 408 | 326 | 552 | 2 | 83 | 83 | 79 | 83 |
| German | 1400s | 356 | 109,747 | 17,078 | 12,614 | 105,161 | 149 | 6,223 | 3,068 | 1,963 | 6,124 |
| German | 1500s | 2,776 | 589,727 | 145,326 | 55,773 | 405,110 | 753 | 27,828 | 4,706 | 3,550 | 22,386 |
| German | 1600s | 1,461 | 321,245 | 152,034 | 118,890 | 290,046 | 583 | 35,926 | 10,371 | 3,839 | 34,220 |
| German | 1700s | 2,617 | 822,276 | 392,783 | 280,570 | 723,267 | 738 | 64,771 | 27,588 | 17,710 | 60,880 |
| German | 1800s | 381 | 137,870 | 103,530 | 85,613 | 133,883 | 513 | 65,607 | 42,043 | 26,154 | 61,327 |
| German | 1900s | 155 | 50,901 | 36,902 | 29,926 | 50,901 | 28 | 9,015 | 3,634 | 3,199 | 6,739 |
| German | 2000s | 0 | 0 | 0 | 0 | 0 | 1 | 114 | 0 | 0 | 0 |
| German | unknown | 978 | 228,426 | 61,296 | 8,585 | 198,376 | 494 | 131,223 | 8,628 | 360 | 109,619 |
| Greek | 0100s | 2 | 888 | 846 | 801 | 888 | 0 | 0 | 0 | 0 | 0 |
| Greek | 0300s | 0 | 0 | 0 | 0 | 0 | 2 | 2,249 | 574 | 507 | 2,249 |
| Greek | 0500s | 1 | 5 | 5 | 5 | 5 | 0 | 0 | 0 | 0 | 0 |
| Greek | 0600s | 1 | 470 | 470 | 459 | 470 | 0 | 0 | 0 | 0 | 0 |
| Greek | 0800s | 9 | 4,301 | 3,523 | 3,069 | 4,301 | 0 | 0 | 0 | 0 | 0 |
| Greek | 0900s | 27 | 10,871 | 10,017 | 8,703 | 10,871 | 1 | 348 | 348 | 348 | 348 |
| Greek | 1000s | 22 | 6,729 | 6,671 | 6,134 | 6,729 | 0 | 0 | 0 | 0 | 0 |
| Greek | 1100s | 20 | 7,015 | 6,488 | 6,230 | 7,015 | 1 | 61 | 61 | 0 | 61 |
| Greek | 1200s | 21 | 10,814 | 10,557 | 9,828 | 10,814 | 1 | 113 | 112 | 0 | 113 |
| Greek | 1300s | 62 | 22,946 | 22,025 | 20,275 | 22,946 | 1 | 237 | 25 | 0 | 237 |
| Greek | 1400s | 125 | 52,969 | 50,090 | 46,861 | 52,969 | 7 | 3,270 | 530 | 7 | 3,270 |
| Greek | 1500s | 236 | 111,139 | 103,234 | 98,387 | 111,134 | 76 | 29,482 | 6,152 | 5,032 | 21,994 |
| Greek | 1600s | 67 | 34,717 | 33,749 | 32,462 | 34,717 | 33 | 15,206 | 384 | 0 | 12,364 |
| Greek | 1700s | 43 | 20,573 | 8,033 | 7,280 | 20,573 | 3 | 43 | 43 | 0 | 38 |
| Greek | 1800s | 272 | 149,525 | 126,332 | 115,845 | 149,525 | 16 | 8,909 | 4,827 | 4,365 | 8,909 |
| Greek | 1900s | 193 | 82,905 | 71,842 | 68,107 | 82,905 | 36 | 15,041 | 9,953 | 8,816 | 13,391 |
| Greek | 2000s | 0 | 0 | 0 | 0 | 0 | 5 | 1,225 | 1,209 | 1,158 | 1,225 |
| Greek | BCE | 5 | 2,364 | 2,324 | 2,260 | 2,364 | 2 | 3 | 3 | 1 | 3 |
| Greek | unknown | 380 | 153,206 | 7,689 | 5,818 | 44,467 | 2,902 | 1,473,121 | 8,098 | 412 | 250,464 |
| English | 0100s | 1 | 400 | 400 | 0 | 400 | 0 | 0 | 0 | 0 | 0 |
| English | 0200s | 2 | 941 | 940 | 940 | 941 | 0 | 0 | 0 | 0 | 0 |
| English | 0400s | 1 | 320 | 289 | 192 | 320 | 0 | 0 | 0 | 0 | 0 |
| English | 0800s | 1 | 417 | 417 | 417 | 417 | 1 | 259 | 25 | 25 | 259 |
| English | 0900s | 2 | 692 | 692 | 642 | 692 | 0 | 0 | 0 | 0 | 0 |
| English | 1000s | 1 | 302 | 302 | 274 | 302 | 0 | 0 | 0 | 0 | 0 |
| English | 1100s | 1 | 262 | 262 | 233 | 262 | 1 | 183 | 168 | 0 | 183 |
| English | 1200s | 1 | 140 | 140 | 140 | 140 | 0 | 0 | 0 | 0 | 0 |
| English | 1300s | 0 | 0 | 0 | 0 | 0 | 1 | 205 | 198 | 196 | 205 |
| English | 1400s | 10 | 1,709 | 1,705 | 1,526 | 1,709 | 3 | 1,043 | 51 | 26 | 1,043 |
| English | 1500s | 88 | 32,916 | 17,387 | 14,346 | 29,387 | 27 | 6,687 | 397 | 301 | 6,679 |
| English | 1600s | 326 | 107,459 | 90,635 | 77,201 | 107,215 | 16 | 4,740 | 4,150 | 2,872 | 4,740 |
| English | 1700s | 293 | 106,788 | 92,047 | 73,436 | 105,030 | 10 | 2,190 | 185 | 38 | 2,188 |
| English | 1800s | 1,586 | 522,507 | 493,513 | 280,419 | 517,566 | 241 | 87,348 | 14,700 | 4,464 | 23,012 |
| English | 1900s | 1,907 | 507,800 | 462,395 | 208,448 | 507,190 | 362 | 122,054 | 43,267 | 28,881 | 70,633 |
| English | 2000s | 0 | 0 | 0 | 0 | 0 | 20 | 6,547 | 5,021 | 4,679 | 6,041 |
| English | BCE | 1 | 40 | 40 | 40 | 40 | 2 | 248 | 232 | 0 | 248 |
| English | unknown | 1,009 | 401,208 | 169,375 | 25,552 | 398,743 | 247 | 90,140 | 32,418 | 2,378 | 70,702 |
| Sanskrit | 0000s | 1 | 64 | 64 | 64 | 64 | 0 | 0 | 0 | 0 | 0 |
| Sanskrit | 0100s | 0 | 0 | 0 | 0 | 0 | 1 | 4 | 4 | 0 | 4 |
| Sanskrit | 0400s | 0 | 0 | 0 | 0 | 0 | 1 | 330 | 0 | 0 | 330 |
| Sanskrit | 0500s | 3 | 164 | 164 | 164 | 164 | 0 | 0 | 0 | 0 | 0 |
| Sanskrit | 0600s | 3 | 2,548 | 66 | 42 | 2,548 | 1 | 432 | 24 | 0 | 432 |
| Sanskrit | 0700s | 0 | 0 | 0 | 0 | 0 | 1 | 11 | 11 | 0 | 11 |
| Sanskrit | 0800s | 3 | 406 | 406 | 397 | 406 | 2 | 549 | 51 | 26 | 549 |
| Sanskrit | 0900s | 3 | 979 | 979 | 786 | 979 | 2 | 819 | 510 | 486 | 819 |
| Sanskrit | 1000s | 3 | 565 | 565 | 418 | 565 | 1 | 100 | 100 | 100 | 100 |
| Sanskrit | 1100s | 4 | 1,923 | 1,918 | 1,632 | 1,923 | 5 | 1,792 | 278 | 55 | 1,792 |
| Sanskrit | 1200s | 0 | 0 | 0 | 0 | 0 | 7 | 2,916 | 2,571 | 696 | 2,916 |
| Sanskrit | 1300s | 3 | 575 | 574 | 574 | 575 | 2 | 8 | 0 | 0 | 8 |
| Sanskrit | 1400s | 6 | 495 | 495 | 489 | 495 | 8 | 1,628 | 839 | 722 | 1,527 |
| Sanskrit | 1500s | 20 | 2,616 | 2,613 | 2,465 | 2,616 | 11 | 218 | 9 | 0 | 17 |
| Sanskrit | 1600s | 16 | 2,575 | 2,575 | 2,568 | 2,575 | 11 | 1,548 | 345 | 250 | 784 |
| Sanskrit | 1700s | 14 | 1,734 | 1,734 | 1,732 | 1,734 | 19 | 1,681 | 423 | 228 | 765 |
| Sanskrit | 1800s | 203 | 62,333 | 38,182 | 35,712 | 40,588 | 850 | 313,440 | 1,880 | 930 | 4,629 |
| Sanskrit | 1900s | 121 | 39,596 | 34,727 | 33,475 | 37,795 | 1,489 | 479,609 | 25,764 | 22,419 | 45,591 |
| Sanskrit | 2000s | 0 | 0 | 0 | 0 | 0 | 41 | 13,486 | 1,972 | 970 | 13,486 |
| Sanskrit | BCE | 0 | 0 | 0 | 0 | 0 | 3 | 1,467 | 95 | 0 | 1,467 |
| Sanskrit | unknown | 106 | 10,417 | 2,385 | 2,161 | 7,351 | 8,381 | 241,888 | 46,146 | 2,099 | 177,909 |
| Tibetan | 0700s | 1 | 236 | 226 | 226 | 236 | 0 | 0 | 0 | 0 | 0 |
| Tibetan | 1100s | 1 | 170 | 166 | 160 | 170 | 0 | 0 | 0 | 0 | 0 |
| Tibetan | 1200s | 5 | 1,462 | 1,326 | 1,213 | 1,462 | 1 | 402 | 0 | 0 | 0 |
| Tibetan | 1300s | 0 | 0 | 0 | 0 | 0 | 1 | 208 | 205 | 0 | 208 |
| Tibetan | 1400s | 4 | 2,536 | 2,258 | 2,239 | 2,536 | 0 | 0 | 0 | 0 | 0 |
| Tibetan | 1500s | 3 | 2,391 | 2,169 | 2,142 | 2,391 | 2 | 1,338 | 1,249 | 1,241 | 1,338 |
| Tibetan | 1600s | 2 | 1,092 | 1,034 | 1,016 | 1,092 | 0 | 0 | 0 | 0 | 0 |
| Tibetan | 1700s | 1,547 | 344,920 | 332,707 | 235,657 | 344,920 | 3 | 993 | 917 | 909 | 993 |
| Tibetan | 1800s | 3 | 2,365 | 2,335 | 2,299 | 2,365 | 1 | 128 | 120 | 0 | 128 |
| Tibetan | 1900s | 216 | 129,581 | 129,150 | 128,763 | 129,581 | 10 | 14,056 | 11,780 | 1,420 | 13,558 |
| Tibetan | 2000s | 0 | 0 | 0 | 0 | 0 | 3 | 23,865 | 22,726 | 0 | 23,322 |
| Tibetan | unknown | 4 | 502 | 57 | 51 | 502 | 528 | 401,273 | 367,567 | 0 | 400,191 |
| French | 1100s | 1 | 193 | 193 | 183 | 193 | 0 | 0 | 0 | 0 | 0 |
| French | 1200s | 1 | 75 | 75 | 68 | 75 | 0 | 0 | 0 | 0 | 0 |
| French | 1300s | 10 | 2,206 | 1,841 | 1,704 | 2,206 | 1 | 10 | 0 | 0 | 10 |
| French | 1400s | 45 | 10,096 | 7,395 | 6,747 | 8,835 | 2 | 245 | 53 | 47 | 245 |
| French | 1500s | 809 | 339,470 | 57,088 | 30,604 | 192,508 | 104 | 31,159 | 4,548 | 328 | 21,085 |
| French | 1600s | 265 | 99,936 | 68,829 | 65,525 | 99,538 | 23 | 5,773 | 2,410 | 1,125 | 4,415 |
| French | 1700s | 454 | 159,741 | 99,646 | 84,242 | 157,024 | 283 | 13,700 | 7,355 | 4,955 | 13,634 |
| French | 1800s | 253 | 108,264 | 81,065 | 70,016 | 107,349 | 290 | 19,902 | 9,994 | 6,874 | 18,574 |
| French | 1900s | 79 | 33,690 | 30,952 | 28,415 | 33,690 | 23 | 9,189 | 4,334 | 4,142 | 8,921 |
| French | unknown | 102 | 38,112 | 7,478 | 3,246 | 35,958 | 100 | 25,532 | 1,227 | 492 | 18,333 |
| Tamil | 1600s | 0 | 0 | 0 | 0 | 0 | 1 | 16 | 0 | 0 | 0 |
| Tamil | 1700s | 0 | 0 | 0 | 0 | 0 | 5 | 1,827 | 0 | 0 | 0 |
| Tamil | 1800s | 10 | 3,465 | 3,257 | 3,165 | 3,273 | 889 | 185,858 | 0 | 0 | 3,112 |
| Tamil | 1900s | 6 | 1,175 | 296 | 294 | 1,175 | 1,770 | 382,865 | 1,990 | 1,990 | 22,744 |
| Tamil | unknown | 0 | 0 | 0 | 0 | 0 | 2 | 561 | 0 | 0 | 334 |
| Unknown | 0400s | 0 | 0 | 0 | 0 | 0 | 176 | 352 | 0 | 0 | 352 |
| Unknown | 0800s | 0 | 0 | 0 | 0 | 0 | 1 | 64 | 62 | 0 | 64 |
| Unknown | 0900s | 0 | 0 | 0 | 0 | 0 | 1 | 7 | 7 | 0 | 7 |
| Unknown | 1200s | 0 | 0 | 0 | 0 | 0 | 25 | 977 | 4 | 0 | 555 |
| Unknown | 1300s | 0 | 0 | 0 | 0 | 0 | 6 | 686 | 42 | 0 | 552 |
| Unknown | 1400s | 0 | 0 | 0 | 0 | 0 | 64 | 36,696 | 38 | 0 | 2,484 |
| Unknown | 1500s | 1 | 342 | 0 | 0 | 342 | 457 | 300,080 | 75 | 0 | 11,000 |
| Unknown | 1600s | 8 | 840 | 154 | 139 | 840 | 51 | 4,997 | 245 | 135 | 4,732 |
| Unknown | 1700s | 22 | 3,084 | 196 | 174 | 3,084 | 125 | 2,283 | 358 | 86 | 2,267 |
| Unknown | 1800s | 16 | 4,217 | 5 | 5 | 4,217 | 121 | 2,614 | 300 | 0 | 2,013 |
| Unknown | 1900s | 1 | 43 | 0 | 0 | 43 | 227 | 3,901 | 776 | 574 | 3,302 |
| Unknown | 2000s | 0 | 0 | 0 | 0 | 0 | 1 | 194 | 41 | 0 | 194 |
| Unknown | BCE | 0 | 0 | 0 | 0 | 0 | 2 | 5 | 5 | 0 | 5 |
| Unknown | unknown | 7 | 523 | 21 | 19 | 523 | 4,126 | 133,770 | 10,997 | 0 | 102,448 |
| Italian | 1200s | 1 | 1,118 | 1,118 | 1,095 | 1,118 | 0 | 0 | 0 | 0 | 0 |
| Italian | 1300s | 7 | 2,194 | 2,189 | 2,117 | 2,194 | 0 | 0 | 0 | 0 | 0 |
| Italian | 1400s | 61 | 17,447 | 15,488 | 14,402 | 17,221 | 5 | 1,675 | 609 | 569 | 1,111 |
| Italian | 1500s | 561 | 191,807 | 95,570 | 90,690 | 159,563 | 115 | 39,712 | 5,262 | 5,005 | 36,739 |
| Italian | 1600s | 152 | 44,799 | 18,930 | 16,961 | 44,697 | 7 | 1,406 | 321 | 213 | 1,090 |
| Italian | 1700s | 101 | 28,341 | 8,439 | 6,794 | 28,247 | 6 | 1,510 | 93 | 15 | 1,510 |
| Italian | 1800s | 66 | 21,700 | 16,472 | 13,416 | 20,280 | 7 | 2,507 | 296 | 26 | 751 |
| Italian | 1900s | 22 | 6,702 | 6,069 | 4,485 | 6,702 | 6 | 2,136 | 1,813 | 1,801 | 2,014 |
| Italian | unknown | 73 | 23,720 | 3,310 | 1,005 | 22,456 | 31 | 9,126 | 281 | 32 | 6,861 |
| und | 1400s | 0 | 0 | 0 | 0 | 0 | 4 | 1,114 | 0 | 0 | 16 |
| und | 1500s | 11 | 256 | 222 | 214 | 240 | 23 | 6,991 | 391 | 309 | 752 |
| und | 1600s | 23 | 496 | 437 | 352 | 432 | 43 | 13,562 | 1,347 | 456 | 5,361 |
| und | 1700s | 0 | 0 | 0 | 0 | 0 | 137 | 19,038 | 4,383 | 0 | 15,315 |
| und | unknown | 0 | 0 | 0 | 0 | 0 | 1,019 | 303,961 | 0 | 0 | 82,320 |
| Hebrew | 1000s | 2 | 352 | 2 | 2 | 352 | 0 | 0 | 0 | 0 | 0 |
| Hebrew | 1100s | 3 | 586 | 569 | 557 | 586 | 0 | 0 | 0 | 0 | 0 |
| Hebrew | 1200s | 6 | 4,245 | 158 | 152 | 2,373 | 1 | 165 | 73 | 0 | 165 |
| Hebrew | 1300s | 70 | 27,945 | 4,210 | 3,919 | 17,739 | 0 | 0 | 0 | 0 | 0 |
| Hebrew | 1400s | 114 | 44,454 | 5,124 | 4,361 | 32,296 | 1 | 41 | 41 | 0 | 41 |
| Hebrew | 1500s | 124 | 47,192 | 11,699 | 10,589 | 31,700 | 3 | 461 | 92 | 0 | 453 |
| Hebrew | 1600s | 79 | 21,643 | 10,733 | 9,777 | 20,951 | 1 | 29 | 29 | 16 | 29 |
| Hebrew | 1700s | 62 | 15,383 | 9,598 | 8,070 | 14,774 | 1 | 88 | 49 | 0 | 88 |
| Hebrew | 1800s | 59 | 19,719 | 16,858 | 12,750 | 19,279 | 1 | 324 | 48 | 0 | 324 |
| Hebrew | 1900s | 12 | 5,249 | 4,756 | 4,367 | 5,249 | 3 | 3,262 | 2,748 | 2,710 | 2,752 |
| Hebrew | unknown | 387 | 129,148 | 1,821 | 340 | 98,543 | 70 | 12,115 | 298 | 0 | 1,427 |
| Arabic | 0500s | 0 | 0 | 0 | 0 | 0 | 1 | 493 | 492 | 491 | 493 |
| Arabic | 0600s | 1 | 64 | 64 | 64 | 64 | 3 | 18 | 18 | 0 | 18 |
| Arabic | 0700s | 3 | 149 | 149 | 138 | 149 | 1 | 3 | 3 | 0 | 3 |
| Arabic | 0800s | 2 | 517 | 517 | 513 | 517 | 9 | 56 | 53 | 0 | 56 |
| Arabic | 0900s | 12 | 1,583 | 1,203 | 1,073 | 1,583 | 30 | 1,985 | 1,173 | 915 | 1,985 |
| Arabic | 1000s | 14 | 4,866 | 3,790 | 3,701 | 4,864 | 47 | 236 | 232 | 0 | 236 |
| Arabic | 1100s | 8 | 1,736 | 1,157 | 1,105 | 1,736 | 68 | 629 | 489 | 184 | 629 |
| Arabic | 1200s | 17 | 4,719 | 3,010 | 2,925 | 4,719 | 94 | 2,000 | 1,308 | 567 | 1,600 |
| Arabic | 1300s | 15 | 4,471 | 2,837 | 2,724 | 4,471 | 15 | 399 | 397 | 357 | 399 |
| Arabic | 1400s | 24 | 7,335 | 3,335 | 3,041 | 7,334 | 1 | 61 | 61 | 60 | 61 |
| Arabic | 1500s | 25 | 11,637 | 4,172 | 4,050 | 11,637 | 1 | 4 | 3 | 0 | 4 |
| Arabic | 1600s | 39 | 14,368 | 3,367 | 2,902 | 14,368 | 0 | 0 | 0 | 0 | 0 |
| Arabic | 1700s | 42 | 12,668 | 3,651 | 3,527 | 12,666 | 2 | 10 | 7 | 0 | 10 |
| Arabic | 1800s | 113 | 23,596 | 21,324 | 19,612 | 23,088 | 12 | 3,936 | 83 | 0 | 1,354 |
| Arabic | 1900s | 26 | 6,522 | 5,712 | 5,535 | 6,522 | 15 | 5,251 | 3,858 | 3,633 | 4,669 |
| Arabic | 2000s | 0 | 0 | 0 | 0 | 0 | 5 | 1,737 | 1,725 | 1,664 | 1,737 |
| Arabic | unknown | 78 | 22,130 | 3,590 | 3,061 | 22,124 | 2,511 | 83,448 | 11,461 | 643 | 46,708 |
| (other languages: 605 values) | 0100s | 1 | 1 | 0 | 0 | 1 | 0 | 0 | 0 | 0 | 0 |
| (other languages: 605 values) | 0300s | 4 | 490 | 469 | 94 | 490 | 13 | 1,119 | 429 | 0 | 1,119 |
| (other languages: 605 values) | 0500s | 6 | 2,037 | 2,037 | 213 | 2,037 | 5 | 2,402 | 2,000 | 1,278 | 2,402 |
| (other languages: 605 values) | 0600s | 2 | 192 | 192 | 190 | 192 | 3 | 1,173 | 1,170 | 0 | 1,173 |
| (other languages: 605 values) | 0700s | 11 | 1,303 | 1,303 | 613 | 1,303 | 13 | 587 | 143 | 0 | 587 |
| (other languages: 605 values) | 0800s | 2 | 788 | 788 | 24 | 788 | 13 | 485 | 446 | 0 | 485 |
| (other languages: 605 values) | 0900s | 7 | 1,505 | 1,505 | 967 | 1,505 | 30 | 135 | 58 | 25 | 135 |
| (other languages: 605 values) | 1000s | 13 | 2,516 | 2,044 | 1,289 | 2,516 | 160 | 709 | 68 | 43 | 610 |
| (other languages: 605 values) | 1100s | 28 | 5,578 | 4,181 | 3,249 | 5,525 | 184 | 967 | 69 | 67 | 745 |
| (other languages: 605 values) | 1200s | 36 | 11,218 | 4,834 | 2,131 | 10,530 | 327 | 1,500 | 196 | 138 | 1,500 |
| (other languages: 605 values) | 1300s | 60 | 17,656 | 14,466 | 10,473 | 17,656 | 58 | 1,189 | 50 | 0 | 1,189 |
| (other languages: 605 values) | 1400s | 97 | 28,746 | 20,968 | 17,962 | 27,846 | 22 | 7,844 | 256 | 19 | 7,844 |
| (other languages: 605 values) | 1500s | 248 | 82,879 | 34,622 | 29,642 | 68,428 | 231 | 60,610 | 1,300 | 874 | 48,993 |
| (other languages: 605 values) | 1600s | 640 | 165,849 | 113,974 | 104,770 | 165,594 | 90 | 14,788 | 2,496 | 1,269 | 14,589 |
| (other languages: 605 values) | 1700s | 531 | 128,253 | 89,871 | 78,277 | 127,600 | 205 | 103,632 | 3,418 | 1,615 | 102,447 |
| (other languages: 605 values) | 1800s | 796 | 266,264 | 213,643 | 179,357 | 265,751 | 367 | 69,191 | 8,324 | 2,864 | 26,481 |
| (other languages: 605 values) | 1900s | 419 | 146,850 | 126,685 | 103,116 | 146,252 | 259 | 65,174 | 21,380 | 15,105 | 31,376 |
| (other languages: 605 values) | 2000s | 0 | 0 | 0 | 0 | 0 | 15 | 4,682 | 2,700 | 1,725 | 3,970 |
| (other languages: 605 values) | BCE | 513 | 6,348 | 6,148 | 6,134 | 456 | 7 | 14 | 11 | 0 | 14 |
| (other languages: 605 values) | unknown | 535 | 149,561 | 46,161 | 34,720 | 149,043 | 8,715 | 292,537 | 12,042 | 895 | 149,818 |

Engine frame: 78,882 books with pages_count > 0 and OCR or English, 18,976,378 pages_count; 11,264 page draws.

## OCR text by engine family (sample)
Seeded page-uniform sample (seed 278): 6,000 pages. Share of sampled pages; "≈ pages" = share × the exact counter of that row. 95% margin on a share p is about ±1.3 points at the top line, wider per row (n shown).
| rows | n | no engine block | paddleocr | bdrc (tibetan) | gemini flash-lite | gemini 3.7+/4 | internet archive | lightonocr | gemini flash/pro (≤3) | claude | kraken | ndlkotenocr | typed e-text |
|---|--:|--:|--:|--:|--:|--:|--:|--:|--:|--:|--:|--:|--:|
| group: hidden | 907 | 48.8% (≈ 782,089) | 6.5% (≈ 104,161) | 26.6% (≈ 425,471) | 13.6% (≈ 217,149) | 1.3% (≈ 21,185) | 1.5% (≈ 24,716) | 0.2% (≈ 3,531) | 0.4% (≈ 7,062) | 0.7% (≈ 10,593) | 0.1% (≈ 1,765) | 0.2% (≈ 3,531) | – |
| group: live | 5,093 | 60.2% (≈ 5,143,323) | 19.3% (≈ 1,651,772) | 2.9% (≈ 250,116) | 4.2% (≈ 362,584) | 5.8% (≈ 498,553) | 3.6% (≈ 308,868) | 1.4% (≈ 115,825) | 1.2% (≈ 99,039) | 0.8% (≈ 72,181) | 0.4% (≈ 36,930) | 0.0% (≈ 3,357) | 0.1% (≈ 6,715) |
| live · Latin | 1,342 | 84.6% (≈ 1,836,757) | – | – | 5.1% (≈ 111,662) | 9.3% (≈ 202,286) | – | – | 0.5% (≈ 11,328) | 0.4% (≈ 9,710) | – | – | – |
| live · Chinese | 1,051 | 4.9% (≈ 88,109) | 93.0% (≈ 1,655,436) | – | 0.5% (≈ 8,472) | 0.1% (≈ 1,694) | – | – | – | 1.5% (≈ 27,111) | – | – | – |
| live · English | 786 | 62.7% (≈ 834,549) | – | – | 4.7% (≈ 62,634) | 0.1% (≈ 1,693) | 23.0% (≈ 306,396) | 8.8% (≈ 116,803) | 0.3% (≈ 3,386) | 0.4% (≈ 5,078) | – | – | – |
| live · German | 528 | 67.4% (≈ 613,127) | – | – | 8.1% (≈ 74,057) | 23.9% (≈ 217,006) | 0.4% (≈ 3,445) | – | – | 0.2% (≈ 1,722) | – | – | – |
| live · Greek | 268 | 79.5% (≈ 368,693) | – | – | 2.2% (≈ 10,386) | 0.4% (≈ 1,731) | – | – | 17.5% (≈ 81,355) | 0.4% (≈ 1,731) | – | – | – |
| live · Tibetan | 267 | 40.4% (≈ 190,690) | – | 55.8% (≈ 263,082) | – | 3.7% (≈ 17,656) | – | – | – | – | – | – | – |
| live · French | 208 | 83.2% (≈ 294,900) | – | – | 7.7% (≈ 27,274) | 9.1% (≈ 32,388) | – | – | – | – | – | – | – |
| live · Italian | 86 | 90.7% (≈ 151,996) | – | – | 3.5% (≈ 5,846) | 5.8% (≈ 9,743) | – | – | – | – | – | – | – |
| live · Dutch | 73 | 95.9% (≈ 130,809) | – | – | 4.1% (≈ 5,606) | – | – | – | – | – | – | – | – |
| live · Russian | 63 | 93.7% (≈ 97,782) | – | – | 3.2% (≈ 3,315) | 3.2% (≈ 3,315) | – | – | – | – | – | – | – |
| live · Sanskrit | 57 | 89.5% (≈ 78,242) | – | – | 7.0% (≈ 6,137) | – | – | – | 3.5% (≈ 3,068) | – | – | – | – |
| live · Hebrew | 48 | 97.9% (≈ 64,163) | – | – | 2.1% (≈ 1,365) | – | – | – | – | – | – | – | – |
| live · Arabic | 44 | 88.6% (≈ 51,301) | – | – | 2.3% (≈ 1,315) | 4.5% (≈ 2,631) | – | – | – | 4.5% (≈ 2,631) | – | – | – |
| live · 1400s | 246 | 87.0% (≈ 372,684) | 0.8% (≈ 3,483) | – | 1.6% (≈ 6,966) | 10.2% (≈ 43,538) | – | – | – | 0.4% (≈ 1,742) | – | – | – |
| live · 1500s | 718 | 79.2% (≈ 949,922) | 1.4% (≈ 16,695) | 0.3% (≈ 3,339) | 2.6% (≈ 31,720) | 14.1% (≈ 168,615) | – | – | 1.8% (≈ 21,703) | 0.6% (≈ 6,678) | – | – | – |
| live · 1600s | 638 | 80.9% (≈ 852,159) | 3.1% (≈ 33,029) | – | 6.9% (≈ 72,665) | 7.5% (≈ 79,271) | – | – | 0.9% (≈ 9,909) | 0.5% (≈ 4,954) | – | – | 0.2% (≈ 1,651) |
| live · 1700s | 783 | 60.0% (≈ 809,030) | 6.8% (≈ 91,231) | 18.8% (≈ 253,037) | 5.5% (≈ 74,018) | 8.0% (≈ 108,444) | 0.3% (≈ 3,443) | – | 0.5% (≈ 6,885) | 0.1% (≈ 1,721) | – | – | – |
| live · 1800s | 782 | 74.3% (≈ 948,031) | 1.2% (≈ 14,686) | – | 7.2% (≈ 91,376) | 2.4% (≈ 31,003) | 5.6% (≈ 71,796) | 4.5% (≈ 57,110) | 3.3% (≈ 42,425) | 0.3% (≈ 3,263) | 1.0% (≈ 13,054) | 0.3% (≈ 3,263) | – |
| live · 1900s | 544 | 74.1% (≈ 706,054) | 0.2% (≈ 1,752) | – | 5.1% (≈ 49,056) | 1.5% (≈ 14,016) | 9.6% (≈ 91,104) | 6.3% (≈ 59,568) | 1.7% (≈ 15,768) | 0.2% (≈ 1,752) | 1.5% (≈ 14,016) | – | – |
| live · unknown | 1,268 | 17.6% (≈ 369,323) | 69.4% (≈ 1,457,417) | – | 1.4% (≈ 29,811) | 2.4% (≈ 51,341) | 6.8% (≈ 142,429) | – | 0.1% (≈ 1,656) | 2.3% (≈ 48,029) | – | – | – |

## English translation by engine family (same sampled pages)
Seeded page-uniform sample (seed 278): 3,485 pages. Share of sampled pages; "≈ pages" = share × the exact counter of that row. 95% margin on a share p is about ±1.7 points at the top line, wider per row (n shown).
| rows | n | no engine block | gemini 3.7+/4 | gemini flash/pro (≤3) | gemini flash-lite | claude | same-language-copy/1 |
|---|--:|--:|--:|--:|--:|--:|--:|
| group: live | 3,330 | 76.1% (≈ 4,241,609) | 7.7% (≈ 430,017) | 7.4% (≈ 411,612) | 7.1% (≈ 398,226) | 1.4% (≈ 78,641) | 0.2% (≈ 11,713) |
| group: hidden | 155 | 95.5% (≈ 303,848) | – | 1.3% (≈ 4,106) | 2.6% (≈ 8,212) | – | 0.6% (≈ 2,053) |
| live · Latin | 1,170 | 81.6% (≈ 1,562,378) | 7.7% (≈ 147,240) | 0.1% (≈ 1,636) | 10.3% (≈ 197,956) | 0.2% (≈ 3,272) | 0.1% (≈ 1,636) |
| live · English | 412 | 97.6% (≈ 667,209) | 0.2% (≈ 1,660) | – | 0.5% (≈ 3,319) | 0.2% (≈ 1,660) | 1.5% (≈ 9,958) |
| live · German | 352 | 84.7% (≈ 501,433) | 1.4% (≈ 8,413) | 0.6% (≈ 3,365) | 12.2% (≈ 72,354) | 1.1% (≈ 6,731) | – |
| live · Greek | 251 | 92.0% (≈ 398,060) | 1.6% (≈ 6,893) | 2.8% (≈ 12,062) | 3.6% (≈ 15,509) | – | – |
| live · Chinese | 221 | 10.9% (≈ 39,581) | 39.8% (≈ 145,130) | 37.1% (≈ 135,235) | 4.5% (≈ 16,492) | 7.7% (≈ 28,037) | – |
| live · Tibetan | 204 | – | 20.6% (≈ 76,952) | 72.5% (≈ 271,164) | – | 6.9% (≈ 25,651) | – |
| live · French | 172 | 87.8% (≈ 255,251) | 4.7% (≈ 13,523) | – | 7.0% (≈ 20,285) | 0.6% (≈ 1,690) | – |
| live · Italian | 78 | 96.2% (≈ 145,159) | 2.6% (≈ 3,871) | – | 1.3% (≈ 1,935) | – | – |
| live · Dutch | 72 | 91.7% (≈ 117,614) | 4.2% (≈ 5,346) | – | 4.2% (≈ 5,346) | – | – |
| live · Russian | 58 | 87.9% (≈ 86,662) | 6.9% (≈ 6,797) | – | 5.2% (≈ 5,098) | – | – |
| live · Sanskrit | 52 | 82.7% (≈ 68,369) | – | 3.8% (≈ 3,180) | 13.5% (≈ 11,130) | – | – |
| live · Arabic | 42 | 92.9% (≈ 50,116) | 4.8% (≈ 2,570) | – | – | 2.4% (≈ 1,285) | – |
| live · 1400s | 234 | 93.2% (≈ 373,687) | 6.0% (≈ 23,998) | – | 0.9% (≈ 3,428) | – | – |
| live · 1500s | 621 | 87.6% (≈ 893,946) | 5.6% (≈ 57,515) | 0.5% (≈ 4,930) | 6.0% (≈ 60,801) | 0.3% (≈ 3,287) | – |
| live · 1600s | 574 | 84.1% (≈ 795,090) | 6.4% (≈ 60,908) | 1.0% (≈ 9,877) | 8.2% (≈ 77,369) | 0.2% (≈ 1,646) | – |
| live · 1700s | 561 | 64.2% (≈ 643,447) | 9.8% (≈ 98,304) | 15.9% (≈ 159,074) | 7.3% (≈ 73,281) | 2.9% (≈ 28,598) | – |
| live · 1800s | 600 | 88.3% (≈ 856,827) | 3.3% (≈ 32,333) | 0.7% (≈ 6,467) | 6.8% (≈ 66,283) | – | 0.8% (≈ 8,083) |
| live · 1900s | 377 | 76.1% (≈ 500,316) | 3.2% (≈ 20,919) | 15.4% (≈ 101,109) | 5.0% (≈ 33,122) | – | 0.3% (≈ 1,743) |
| live · unknown | 271 | 13.3% (≈ 54,469) | 28.4% (≈ 116,503) | 30.6% (≈ 125,581) | 17.3% (≈ 71,112) | 10.0% (≈ 40,852) | 0.4% (≈ 1,513) |

## Total 1 — judge verdicts recorded per page
book_checks: 2,660 book-level rows covering 10,873 page reads (one row = one book read by one method in one run; pages_read listed per row).
| method | rows | pages read | 2026-10 | 2026-11 |
|---|--:|--:|--:|--:|
| ocr-convergence | 412 | 3,820 | 3,820 | 0 |
| paired-fifths-check | 303 | 2,976 | 0 | 2,976 |
| judged-pages | 255 | 1,070 | 1,070 | 0 |
| shelf-overview | 212 | 848 | 656 | 192 |
| lane-spot-check | 281 | 393 | 50 | 343 |
| fortnightly-spot-check | 95 | 285 | 255 | 30 |
| leak-off-leaf-5309 | 213 | 233 | 0 | 233 |
| leak-repair-5026 | 170 | 220 | 0 | 220 |
| fix-feed-8255 | 50 | 210 | 0 | 210 |
| served-audit | 200 | 200 | 200 | 0 |
| euro-gpu-agy-cell-6871 | 181 | 181 | 0 | 181 |
| curation-check | 107 | 125 | 125 | 0 |
| hide-broken-text | 22 | 78 | 78 | 0 |
| lane-paired-retranslation-check | 60 | 60 | 0 | 60 |
| plate-reread-check | 10 | 47 | 0 | 47 |
| gpu-print-6871 | 12 | 30 | 0 | 30 |
| leak-strip-5026 | 30 | 30 | 0 | 30 |
| stub-books-8181-by-eye | 29 | 30 | 0 | 30 |
| retranslation-gate | 7 | 21 | 21 | 0 |
| seam-fr-it-104-by-eye | 5 | 10 | 0 | 10 |
| kangyur-finish-8482-by-eye | 6 | 6 | 0 | 6 |
Pages read by reader kind: model 10,873

lane_judge_verdicts: 11,360 rows (one row = one judged page or control). Page verdicts (kind = item): 10,990; controls (wrong_page / planted / draft): 370.
Of the page verdicts, 537 are test rows whose instrument is `book_checks:<method>`: copies of book_checks reads, already counted above. **Page verdicts across both stores, each counted once: 21,326** (book_checks pages read + lane_judge item rows − the copies). Test rows carry judged_at: null, so their month is "not recorded".
| origin · instrument · kind | 2026-10 | 2026-11 | not recorded | total |
|---|--:|--:|--:|--:|
| test · route-judge-6740 judgePrompt · item | 0 | 0 | 4,994 | 4,994 |
| test · step-t-7568 (flash-reread-5924/T-TASK.md, blind X/Y/Z with the image) · item | 0 | 0 | 3,225 | 3,225 |
| live · route-judge-6740 judgePrompt · item | 1,139 | 383 | 0 | 1,522 |
| test · route-judge-6740 judgePrompt (translation, scan and no transcription: zh-ocr-gap-translation-5274 prompt) · item | 0 | 0 | 360 | 360 |
| live · route-judge-6740 judgePrompt (judgeAbsolute through confirm.mjs judge) · item | 0 | 352 | 0 | 352 |
| test · route-judge-6740 judgePrompt · wrong_page | 0 | 0 | 234 | 234 |
| test · book_checks:leak-off-leaf-5309@1 · item | 0 | 0 | 233 | 233 |
| test · book_checks:euro-gpu-agy-cell-6871@1 · item | 0 | 0 | 181 | 181 |
| test · book_checks:lane-paired-retranslation-check@1 · item | 0 | 0 | 60 | 60 |
| live · route-judge-6740 judgePrompt · wrong_page | 28 | 16 | 0 | 44 |
| live · route-judge-6740 judgePrompt · draft | 38 | 0 | 0 | 38 |
| test · book_checks:gpu-print-6871@1 · item | 0 | 0 | 30 | 30 |
| test · book_checks:stub-books-8181-by-eye@1 · item | 0 | 0 | 30 | 30 |
| live · route-judge-6740 judgePrompt · planted | 18 | 4 | 0 | 22 |
| test · route-judge-6740 judgePrompt · planted | 0 | 0 | 20 | 20 |
| live · route-judge-6740 judgePrompt (judgeAbsolute through confirm.mjs judge) · wrong_page | 0 | 12 | 0 | 12 |
| test · book_checks:kangyur-finish-8482-by-eye@1 · item | 0 | 0 | 3 | 3 |

## Total 2 — English withheld, and books held
Withheld now (translation_withheld record AND no English text on the page): **195,081 pages in 4,867 books**. Record only (English repaired and back): 246,065 pages. 2,257 of the withholding books are not under a pipeline hold.
| reason | withheld now | record only |
|---|--:|--:|
| unverified_script_ocr | 89,381 | 85,690 |
| stale_after_reocr | 57,056 | 126,923 |
| source_loop | 35,501 | 18,035 |
| ocr_unreadable | 7,196 | 14,922 |
| invented_by_eye | 3,960 | 381 |
| blank_source | 867 | 0 |
| leaked-reasoning-6117 | 660 | 9 |
| gemini-ocr-tibetan-4523 | 460 | 0 |
| shifted-block-5426 | 0 | 1 |
| echo_shift_block | 0 | 104 |

Pipeline holds: 76,126 books held by decision (42,428 of them live) across 133 reasons; 413,976 not-acquired catalogue records (manifest-only-lazy-pages 408,981, acquisition-wave-2026-10b 4,995). Top decision reasons: zh-shi-ji-8053 17,907 · acquisition-wave-2026-10-images-only 13,822 · scans-only-publish-7176 13,394 · paddle-zh-5600-ocr-only 6,254 · scans-only-publish-7270 5,619 · gpu-backlog-5660 3,185 · indic-print-2026-11 2,772 · warehouse-promotion-5470 2,435.
The `contained` label is on GitHub issues: `gh issue list --label contained --state all`.

## Total 3 — page_revisions: which rows are a real second read
All rows: 8,701,598. Field `ocr`: READ 2,274,540 (with superseded text 1,982,513) · MOVE 89,180 · OTHER 804,166. Field `translation`: READ-labelled 968,560 · MOVE 82,221 · OTHER 812,154. Other fields: 3,670,777.
READ = batch_api, ai, pipeline_preview, realtime_api_sequential, batch_api_recovery, mineru, paddle, kraken, ia_djvu, bdrc, ndl-koten, reocr_cli, lightonocr. MOVE = /^(shift-repair|text-permutation|revert-|spread-split|ia-ocr-repair|ai-repair-sync|reocr-contamination-repair)|-undo$/.
| field | source | class | rows | with superseded text |
|---|---|---|--:|--:|
| translation.text | notes-layer-backfill-5942 | other | 3,669,685 | 11,014 |
| translation | ai | read | 958,101 | 958,075 |
| ocr | batch_api | read | 923,150 | 923,149 |
| ocr | reocr_cli | read | 566,436 | 274,410 |
| ocr | longs-pass-5924 | other | 485,475 | 485,475 |
| ocr | ai | read | 336,513 | 336,513 |
| translation | cleanup-a2-5700 | other | 277,833 | 277,833 |
| translation | empty | other | 212,593 | 0 |
| translation | cleanup-termdef-5901 | other | 207,380 | 207,380 |
| ocr | empty | other | 194,356 | 0 |
| ocr | bdrc | read | 186,361 | 186,361 |
| ocr | ia_djvu | read | 166,713 | 166,713 |
| ocr | pipeline_preview | read | 83,529 | 83,529 |
| translation | cleanup-markup-5700 | other | 72,880 | 72,880 |
| ocr | shift-repair-erara-2026-07 | move | 56,413 | 56,413 |
| translation | shift-repair-erara-2026-07 | move | 55,272 | 55,272 |
| ocr | loop-guard-refused-2026-09 | other | 37,601 | 37,601 |
| ocr | blank-guard-refused-2026-08 | other | 29,691 | 29,691 |
| ocr | paddle-zh-guarded-6871 | other | 23,953 | 0 |
| translation | tengyur-draft-repairs-5497 | other | 17,556 | 17,556 |
| ocr | shift-repair-segments-7949 | move | 13,320 | 13,320 |
| ocr | shift-repair-clef-5803 | move | 12,533 | 12,533 |
| translation | health-gate-refused | other | 11,580 | 11,579 |
| translation | shift-repair-clef-5803 | move | 11,550 | 11,550 |
| ocr | withhold-gemini-ocr-tibetan-4523 | other | 11,104 | 11,104 |
| translation | batch_api | read | 10,446 | 10,367 |
| ocr | paddle | read | 10,240 | 10,240 |
| ocr | unknown | other | 9,785 | 2,067 |
| translation | shift-repair-segments-7949 | move | 9,501 | 9,501 |
| ocr | strip-proquest-6056 | other | 7,485 | 7,485 |
| ocr | shift-repair-bulkjp2-2026-08 | move | 2,638 | 2,638 |
| translation | fix-stray-hangul-5734 | other | 2,618 | 2,618 |
| translation | shift-repair-bulkjp2-2026-08 | move | 2,386 | 2,386 |
| translation | maintenance | other | 2,224 | 2,224 |
| ocr | cbeta-xml-p5 | other | 1,585 | 1,585 |
| translation | unknown | other | 1,460 | 160 |
| ocr | label-skqs-margin-garble-8053 | other | 1,360 | 1,360 |
| ocr | null | other | 1,263 | 1,263 |
| translation | skip | other | 1,260 | 1,260 |
| ocr | text-permutation-5803 | move | 1,136 | 1,136 |
| translation | text-permutation-5803 | move | 1,127 | 1,127 |
| null | null | other | 1,092 | 0 |
| translation | null | other | 1,026 | 1,026 |
(54 smaller field × source rows in the JSON.)

Same image? OCR READ rows whose superseded read recorded its image (engine.input.image_url), against the image the page's current read recorded:
| source | same image URL | different image URL | current read records no image | page missing |
|---|--:|--:|--:|--:|
| pipeline_preview | 4,524 | 0 | 489 | 0 |
| batch_api | 91,088 | 1,016 | 47 | 0 |
| paddle | 10,100 | 0 | 140 | 0 |
| reocr_cli | 84,266 | 949 | 1 | 0 |
| ai | 2,575 | 11 | 1,141 | 0 |
| lightonocr | 836 | 0 | 90 | 0 |

