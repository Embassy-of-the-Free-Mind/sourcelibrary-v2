---
stage: translation
measure: judged
languages: []
scripts: []
canons: []
n_books: 16
n_pages: 64
verdict: "Frame-weighted, 16% of pages on four Nalanda-Java-Tibet shelves carry a serious error (4 books per shelf); OCR-dropped negations reverse the English in 5 books."
status: informational
decision: "Filed #6184 with a negation-flip detector; Or. 1332 hidden and held; one date corrected"
superseded_by: null
issue: 6184
---
<!-- PRIOR ART: scripts/eval/experiments/2026-10-06-eternity-shelf-review.md — the hand-picked curation check (no rates); this is a random-draw overview of different shelves. -->
## 2026-10-07 · Shelf overview: the Nalanda–Indonesia–Tibet thread

**Question.** How often does a page carry a serious error on the four shelves a reader following
Nālandā → Sumatra/Java → Tibet would open, and what can we show?

**Method.** `shelf-overview` skill, random draw (seed 2026100703), 4 books × 4 pages per stratum, one Opus reviewer per
stratum reading every page against its image (REVIEWER.md + OVERVIEW-ADDENDUM.md, unedited). Frames exclude books in
the earlier Tengyur and Nālandā overview frames. Results: `scripts/eval/results/spot-check/overview-2026-10-07-nalanda-thread/`.

| stratum | frame | serious pages (95% CI by book) | OCR | EN | show / caveat / don't |
|---|---|---|---|---|---|
| Vajrayana (excl. Tengyur) | 503 | 13% (0–38%) | 3.88 | 4.06 | 2 / 2 / 0 |
| Old Javanese + Hindu-Buddhist Java | 11 | 25% (25–25%) | 4.56 | 4.06 | 0 / 4 / 0 |
| Javanese + Indonesian MSS | 138 | 25% (6–44%) | 3.94 | 4.13 | 1 / 2 / 1 |
| Indian Buddhist & Jain | 42 | 19% (0–38%) | 4.44 | 3.44 | 0 / 4 / 0 |

Frame-weighted: 16% of pages carry a serious error (weights = books per frame; n = 4 books per stratum, so quote the CIs).

**Findings.**
- **OCR drops a negation and the English reverses the claim** — 5 distinct books, 3 scripts (Sanskrit, Dutch, Tibetan).
  Filed #6184 with a model-free detector, `scripts/audit/ocr-negation-flip-candidates.mjs` (positive controls built in).
- **English-language editions get an AI "translation" pane that adds and drops material** (invented headings, finished
  footnotes, an inserted verse, a dropped paragraph) while the transcription is near-perfect — all 4 Indian
  Buddhist & Jain books. Fits #5913 (refuse what the reading can't support) and the T-class register.
- **Arabic MSS are normalised to the vulgate** (spelling, a variant reading, 25 recited Qur'an verses stored as a
  continuation note) — the recitation class.
- **Large Tibetan numbers off by 10×** (bye ba → "million") on the Bhadrakalpika Buddha lists.
- **Shelf drift:** "Buddhist & Jain Texts" holds Vedānta and Bhakti books (2 of 4 drawn); the Vajrayana shelf is mostly
  Mahāyāna sūtra Kanjur volumes.

**Actions taken.** Or. 1332 hidden + held (`broken_text_6142`); Thibaut SBE 38 date 1879 → 1896 (title page p7);
rights hunches (Stcherbatsky scan with a later edition bound in; Sutasoma 1994 typescript) to ops `rights-screen/`, not acted on.
