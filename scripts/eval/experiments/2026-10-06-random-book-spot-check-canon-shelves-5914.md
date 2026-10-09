---
stage: translation
measure: judged
languages: []
scripts: []
canons: []
n_books: 30
n_pages: 91
verdict: "On 30 random canon-shelf books, 23% of pages (21/91) carry a serious error, driven by unreadable inputs, broken or misfiled books and modern editions rather than translation of clean prints."
status: informational
decision: "55 books hidden; arm added to the monthly audit; issues #5913, #5915, #5916, #5917 filed (#5914)"
superseded_by: null
issue: 5914
---
## 2026-10-06 · What does an uncurated sample of the canon shelves look like, read against the page images? (#5914)
<!-- PRIOR ART: _series-monthly-translation-corpus-audit.md (#5301) is the standing random audit: one interior page per book, text-only judge, page ends and non-text pages excluded. This run is the complement it names as missing (wrong leaf, page runs, book-level defects); #5914 folds it into that series as an arm. -->

**Question.** The canon-gap page (`/research/canon-gap`) quotes 3–5 reversed statements per 100 pages for the Tengyur draft. That figure comes from passages that 84000 has also translated. What does a reader meet on a book drawn at random from the canon shelves?

**Design.**
- **Draw.** 30 books, uniform per book, seeded (seed 1791290001), from the 1,661 canon-gap books with ≥ 3 translated pages (`canon-gap-status-2026-10.json` traditions, any visibility). Then a random run of 3 consecutive translated pages per book: 91 pages, since one page had two records.
- **Readers.** Six blind Opus subagents, 5 books each. Each opened every page image and judged:
  - whether the image is the right page;
  - transcription accuracy (1–5) and fidelity (1–5);
  - serious errors, quoted with source and English;
  - shelf fit, rights, and book structure.
- **Pilot.** A 3-book run earlier the same day, read by the session itself, gave the shape.
- **Cost.** No paid API calls; the reviewers ran as subscription subagents.
- **Data.** Draw script, per-book results and reviewer notes are in the private ops repo, `rights-screen/2026-10-06-canon-shelves/spot30/`. It is private because it names rights suspects.

**Result.**

| measure | value |
|---|---|
| pages with ≥ 1 serious error | **21 / 91 (23%)**; 30 serious errors in all |
| books with ≥ 1 serious error | 13 / 30 |
| books with something an expert would flag on sight | ≈ 18 / 30 |
| text not on the page (invented) | 5 books: an unreadable 2000×121 px scroll strip "transcribed" into ~1,400 characters; an invented preface and colophon; fluent rules over manuscript syllable soup; invented apparatus facts; an invented margin note |
| reversed sense | 7 books (the *Iḥyāʾ* page translated by flash-lite alone carries four reversals) |
| broken book structure | 6 books: scan splices, duplicated images, negative page numbers, a duplicate page record, the wrong work under a title |
| wrong tradition shelf | ≈ 9 books (e.g. the *Bhagavad Gita* and the Upanishads on the Sufi shelf; a grimoire on the Kabbalah shelf) |
| modern in-copyright editions | 3 by eye. The follow-up title-page screen of 1,571 visible canon-shelf books found 49; all are now hidden (#4809) |
| strong | printed critical editions: the Schlegel Ramayana, the PTS Pali texts, the Tantrāloka, the Brihat Samhita, Pico, the Mengxi Bitan |

**Conclusion.** On a clean printed edition the English is mostly faithful, as the curated sets say. The errors a reader meets come from inputs and objects the curated sets never sample:
- unreadable images and manuscripts translated anyway;
- non-prose pages (rime tables) translated as prose;
- broken or misidentified books;
- modern editions;
- misfiled shelves.

The curated 3–5 per 100 is a diagnostic, not the headline. The not-comparable caveat: this draw is the canon shelves and 3 consecutive pages, and it counts transcription and structure errors. The monthly audit is the whole corpus, one interior page, translation only (2026-09: 14.3% of pages with a major error).

**What it changed.**
- 55 books hidden: 7 from this sample, 48 from the rights screen.
- Issues filed: #5913 (prompt regression set), #5915 (pre-translation gate), #5916 (shelf membership), #5917 (burned-in licence stamp).
- #5914 adds this arm to the monthly audit.
- Comments on #5059 (page-order flags never acted on), #5795 (flash-lite on Arabic) and #5700.

**Limits.** n = 30 books, about 3 pages each. The pages in a book are one observation, so the CI is wide; no per-tradition rates. Reviewers are AI, not scholars. The by-eye claims about Tibetan were low-confidence at the stored image resolution.
