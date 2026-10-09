---
stage: ocr
measure: accuracy
languages: [ja]
scripts: [Jpan]
canons: []
n_books: 356
n_pages: 1068
verdict: "116 of 356 pre-1868 Japanese books are cursive (about 8,210 pages); the flash classifier agrees with eye labels on 57 of 60 fresh pages, catching all 28 cursive ones."
status: adopted
decision: "The census classifier is the NDL koten lane's per-book router (scripts/lib/ndl-koten-lane.mjs; 20-book pilot #4925)"
superseded_by: null
issue: [5100, 4925]
---
## 2026-09-30 · Cursive census of pre-1868 Japanese + the router checked by eye (#5100, #4925)

- **Question.** How many pre-1868 Japanese books are kuzushiji (the class NDL reads and Gemini does not, #4745), and is
  the flash-preview script classifier good enough to route a GPU lane?
- **Design.** Every Japanese book with a catalogue year before 1868 or none (356, from the local mirror); 3 seeded interior
  pages per book (skip the first 10 %), the #4745 six-class prompt on gemini-3-flash-preview through the metered client,
  thinking off; a book is cursive when ≥ 2 of its 3 pages are. Then 60 FRESH census pages, one per book (seed 59250,
  30 the classifier called cursive, 30 regular text), shuffled, renamed, and labelled by eye BEFORE the labels were joined.
- **Result.** Control (the 10 #4745 eye-reads) 10/10 on the cursive axis. **116 of 356 books cursive (CI 108–118),
  ≈ 8,210 pages (7,620–8,590)**: 93 woodblock, 23 manuscript; 77 visible. 13 more books have one cursive page of three.
  Eye check: **57/60 agree on the cursive axis; 28/28 eye-cursive pages caught (recall 1.0), 2 regular pages called
  cursive** (a large-hiragana herbal, a kaisho-katakana manuscript) — the error runs toward over-routing, which costs
  NDL GPU seconds, not readings. 3 pages the classifier called cursive are regular kanji with running hentaigana kana;
  scored cursive (hentaigana is kuzushiji); scored regular, agreement is 54/60. 3 no-text pages (blank, show-through, a
  cover) were given a text class — irrelevant to routing, relevant to anyone reusing the classes. Spend $0.87.
- **Replicated?** The control is the #4745 set; the 60-page eye check is the replication on fresh books.
- **Artifact.** `scripts/eval/results/cursive-census/` (summary.json, pages.jsonl, eyecheck/{draw,eye,score}.json);
  scripts `cursive-census-{draw,classify,eyecheck}.mjs`.
