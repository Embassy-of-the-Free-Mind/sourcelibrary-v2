---
stage: metadata
measure: [judged]
languages: []
scripts: []
canons: []
n_books: 291
n_pages: null
verdict: "About one live book in six has an edition, copy or translation that we hold under a different work_id: 49–55 of 291 uniformly drawn books, 16.8% [13.0–21.6] to 18.9% [14.8–23.8], about 12,000–13,400 of 70,968 live books. Among single-book works the judged rate is 24% (45/187). Outside catalogues agree on the size of the problem: of the USTC works where we hold two or more directly linked books, we split 111 of 344, and a judge finds 45% of those splits [36–54] are one work; of Open Library works we hold twice or more, we split 61 of 105, 34% of them one work and another 33% volumes of one set. Precision of the links we do make was not re-measured here."
status: informational
decision: "The missed links are real and mostly easy: same title, later printing; duplicate scans; Latin original against its English translation. Next lever: feed the judged frame + USTC/OL splits into work_merge_queue for the existing llm-verify lane, then re-run this frame to measure the gain."
superseded_by: null
issue: [7761, 7528, 3887, 7751]
router_evidence: "none — a catalogue-identity measurement, no OCR or translation route"
---
## 2026-10-29 · How many links does the works system miss? (#7761)
<!-- PRIOR ART: scripts/eval/build-work-gold-set.mjs + score-work-gold-set.mjs (pair precision, human labels; its header says it cannot measure recall); scripts/eval/work-resolver-probe.mjs (lower bound from our own titles); #7751 / PR #7758 (book -> USTC cluster matches, reused as input). -->

**Question.** 46,939 of 51,409 live works (91%) hold one book. How many of those, and of the books in larger works, have a sibling (another edition, a copy, a translation) we hold under a *different* `work_id`?

**Design.** Three instruments, $0: the dumps were already on disk, and the judge is `claude -p --model sonnet` on the team@ subscription with no tools and no project settings (`scripts/eval/work-recall/`). The judge sees title, author, year, language and page count only, never an image, so every call is a catalogue judgement. Relations follow `work-identity-gold-rubric.md`, with volume and part-of kept separate from same work.

1. **Uniform frame.** 300 live books (`visible`, `pages_count > 0`) in a fixed hash order. For each, up to 22 candidates under other work_ids: same `author_id` or surname, rare title tokens (IDF ≥ 6; CJK as character bigrams), plus up to 6 same-author books in another language, because translations share no title words. **Positive control:** the same retrieval run on 200 books whose siblings we already link returns a known sibling for **180/200 (90%)**. A "no sibling" result is therefore informative, and the rate below is a floor by about a tenth. 291 of 300 targets came back (9 were dropped from batch replies).
2. **USTC.** Book → `work_cluster_id` (author + USTC standard title) from the #7751 output: 3,303 direct links (our `ustc_id`), 114,819 title matches (all books, hidden included; 24,671 live books mapped).
3. **Open Library.** `ia_identifier` = `ocaid` in the 2026-04-30 OL editions dump on Hetzner (55.96M records). **Only 4,904 of 26,817 IA-sourced live books have an OL edition** (18%), so OL is a narrow instrument here.

For 2 and 3, one pair was judged per outside group that we split across work_ids. The reverse direction (one of our clusters, two outside keys) was not scored. Read by hand, it is mostly the catalogues over-splitting: USTC keys Kepler's *Prodromus* 1596 and 1621 apart, and Grataroli's *Verae alchemiae* 1561 and *Alchemiae… doctrina* 1572.

**Result.**

| instrument | groups we split / groups held ≥2 | judged one work (edition, copy, translation) | judged volume of one set | judged different |
|---|---|---|---|---|
| USTC direct | 111 / 344 | 50/111 = 45.0% [36.1–54.3] | 8 | 27 |
| USTC title-matched (sample) | 2,040 / 3,041 (150 judged) | 68/150 = 45.3% [37.6–53.3] | 6 | 55 |
| Open Library | 61 / 105 | 21/61 = 34.4% [23.7–47.0] | 20 | 8 |

**Uniform frame, 291 books:** the judge links 59 (same work 44, translation 8, same edition 7); 14 more have an unlinked volume of the same set (4.8% [2.9–7.9]). **All 59 read by hand:** 3 are wrong (Commynes's Charles VIII chronicle against a German Burgundian-war history; a 1525 German Galatians against a French doctrinal tract; one call on a candidate id that is not in the list). 1 is doubtful (Latin against German Psalter prayers, 1552). 6 are part against whole rather than edition against edition (a Gorresio *Rāmāyaṇa* volume against the Schlegel text; one juan of 婦人大全良方 against the whole; overlapping Aristophanes collections). Hence a strict and a lenient count:

| | books | share | live books (×70,968) |
|---|---|---|---|
| strict (49) | 49/291 | 16.8% [13.0–21.6] | ~11,950 |
| lenient (55) | 55/291 | 18.9% [14.8–23.8] | ~13,400 |
| judge as called (59), single-book works only | 45/187 | 24.1% [18.5–30.7] | |
| judge as called, books already in a multi-book work | 14/104 | 13.5% [8.2–21.3] | |

By tradition (judge as called): Latin 26/126, German 8/28, French 6/9, English 4/25, other languages 12/42, **Chinese (Kanripo ids) 1/57**. The Kanripo catalogue does this job well, and the local minter does not.

**What the misses look like.** Mostly not hard cases: *Sessanta salmi di David* 1560 and 1585; Ovid's *Metamorphosis* 1613 and 1619; *The Mahatma Letters* 1923 and 1926; two 1503 scans of *Opera Dionysii*; Schöner's *Opera mathematica* 1551 and 1561 under respelt titles; *Musaeum Hermeticum* 1678 against Waite's *Hermetic Museum* 1893. The common cause is the local mint: `local:a:<author>:<title slug>` takes the slug from whichever title or English gloss the record carried, so one respelling or a longer title yields a second work.

**Not established.** Precision of existing links on today's corpus (the June sampled audit found no false distinct-work fusions, n small). Agreement of this judge with a person or a second model (κ). How many of the "different" outside pairs are wrong links on OUR side: in USTC-direct at least one is (a Tacitus *Opera* carrying an Agrippa `ustc_id`).
