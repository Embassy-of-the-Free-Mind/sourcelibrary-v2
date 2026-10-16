---
stage: pipeline
measure: judged
languages: [la, it, de, pi, ru, lzh, en, bo]
scripts: [Latn, Cyrl, Hani, Tibt]
canons: []
n_books: 10
n_pages: 30
verdict: "Public frame, 10 random books: 4 of 30 pages carry a serious error (3 of 9 served books); nothing invented, no wrong leaf. Misread-carried-into-English (O6) is the one class in 3 or more books across rounds 1 and 2."
status: informational
decision: null
superseded_by: null
issue: [6056, 5914, 5137]
---
## 2026-10-13 · Quality sprint round 2: what does a random draw of the public library look like, and which defect classes repeat across rounds? (#6056)
<!-- PRIOR ART: round 1, `scripts/eval/results/spot-check/sprint-2026-10-07-r1/` (canon frame, PR #6059; it has no entry here), and the month-0 entry `2026-10-06-random-book-spot-check-canon-shelves-5914.md`. Same draw, brief and scorer; this is the first sprint round on the public frame. -->

**Question.** Round 1 drew from the canon shelves, which lean to manuscripts and non-Latin scripts (15 of 30 pages serious). What does the same instrument find in a uniform draw of the public library, and which classes now appear in 3 or more distinct books?

**Design.**
- **Draw.** `draw.mjs --frame public --seed 2026101302 --n 10`: 10 books uniform per book from 22,820 public books with 3 or more translated pages, then one run of 3 consecutive reader-reachable pages each. No book was rejected. All 30 images returned 200.
- **Review.** 2 Claude Opus subagents, 5 books each, `REVIEWER.md` with nothing added, every page read against its image. Verdicts are not edited. $0 API.
- **Register and cluster.** `register.mjs --dir … --forms forms.json` gives one row per moderate or serious finding (`findings.json`, 60 rows, 7 serious). `register.mjs --cluster` pools rounds 1 and 2 by distinct book (`sprint-clusters.json`). Frames are counted apart, never pooled into one rate.

**Result.** Measured 2026-10-13.

| | round 2 (public) | round 1 (canon) |
|---|---:|---:|
| pages with a serious error | 4 of 30 | 15 of 30 |
| books with a serious error on a read page | 4 of 10 | not tabulated |
| books with an on-sight defect | 7 of 10 | 10 of 10 |
| wrong leaf | 0 of 30 | not tabulated |

- **Served text only.** One drawn book (the Tibetan fragments, `69e78f6213e67bd16d4e6bc2`) has its English withheld, so a reader does not see its one serious finding. Among the 9 served books, 3 have a serious error on a read page. The scorer's own headline counts the first page of each run only: 0 of 9 served books (95% CI 0–30%).
- **The serious findings** (4 pages, 7 errors):
  - Law disputation, Jena 1635 (`6a42fb76feb36226e8f0c975` p5): long s read as f about ten times, so the tract's key term *sors* (the principal of a loan) is transcribed *fors, fortis, forte*. The English still follows the argument.
  - Caccini, *Le nuove musiche* (`69dea1ce4d19ec2e9ba75548` p22): *soave* read as "for ue" and translated "fiercely"; Love and the heart swap roles twice.
  - Münster, *Cosmographey* 1578 (`6a26bd05d6b178e5aad87607` p8): an eye-skip drops the clause in which Münster says nobody before him wrote such a book in German. It is absent from the English too.
  - Tibetan fragments p57 (withheld): two ritual measures mistranslated. The reviewer marks its reading of the cursive as low confidence.
- **Clean on the pages read:** Dostoevsky's *Podrostok* (1911, pre-reform Russian), a 1690 medical dissertation, the Leonardo facsimile (blank leaves and one label).
- **Clusters across rounds 1 and 2** (serious only, by distinct book): O6 misread carried into the English, 4 books (2 canon, 2 public; all four are print). It is the only class at 3 or more books. Next: T7, O3, T10, O5, O1, T8, O15 at 2 books each.
- **Record-level findings, not page errors:** an English pamphlet catalogued as Latin and so served with an English "translation" that rewrites its titles of office (Westcott, *Dreams*, `69c8a2246c6f3cc53c85e367`); a 1,558-page book with text on 25 pages; two books served as unsplit openings or two leaves to a photograph; apparatus handled three different ways on three adjacent pages of a PTS edition.

**A detector that does not work.** Both long-s misreads in this round land on real words (*sorte* → *forte*, *sors* → *fors*) or on a split token ("for ue"). A list of f-for-s non-words (*funt, eft, effe, ipfe, caufa* …) run over the 9 Latin and Italian pages of the three early-print books finds none of the misreads: the engine errs toward words that exist. A non-word list is therefore not a detector for this class, and none of the 9 pages keeps a literal ſ.

**Conclusion.** The public library reads far better than the canon shelves under the same instrument, and what goes wrong is different: no invented text and no wrong leaf in 30 pages, but single misread words and one dropped clause that the English then carries. O6 is the one general candidate so far and already has an owner (#5137). Two rounds are 20 books; the sprint's target is 50.

**Limits.**
- 10 books. A round's own rate swings by about ± 15 points by chance, and the two rounds are different frames.
- Reviewers are AI reading at stored image resolution. The Tibetan pages are marked low confidence by the reviewer.
- `forms.json` (print or MS) was assigned from the reviewers' structure notes and the catalogue, not by a separate look at the images.

*Replicated?* No. Data: `scripts/eval/results/spot-check/sprint-2026-10-13-r2/` (sample, packets, reviews, results, findings, report) and `scripts/eval/results/spot-check/sprint-clusters.json`.
