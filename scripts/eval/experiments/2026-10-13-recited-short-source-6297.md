---
stage: translation
measure: none
languages: []
scripts: []
canons: [derge-tengyur]
n_books: 349
n_pages: 537
verdict: "A short source with a long English body marks text that is not on the leaf: the rule fires on 7 of 7 Tengyur title leaves withheld by eye, on 5 of 208 short-source pages in a random draw (all 5 wrong by text), and on 537 of 9,474 short-source title pages (20 of 20 sampled wrong by text, 5 of 5 opened wrong by eye)."
status: adopted
decision: "assessTranslationHealth refuses such a page as `recited` (#6297)"
superseded_by: null
issue: [6297, 6048]
---
## 2026-10-13 · Does "short source, long English" find title leaves that were given a chapter? (#6297)

PRIOR ART: `isExcess` in `scripts/lib/translate-core.mjs` (the `runaway` tier) does not judge a source under 300
characters; `scripts/lib/illegible-source-gate.mjs` refuses a page nobody could read, and a title leaf is legible.
#6297 proposed the raw signal "source under 200 characters, English over 600" and named 14 Tengyur pages.

**Design.** Rule (`isRecited`): source weight under 300 and English body over max(600, 3 × weight). Source weight
is the transcription with tags removed and their contents kept, a Han, kana or Hangul character counted 16. English
body is `bodyLen`, which leaves out notes, summaries and keywords. Read-only, $0, no model call. Detector:
`scripts/audit/recited-short-source.mjs`.

**Result.**

| set | pages | fired | what the fires are |
|---|---:|---:|---|
| Tengyur title leaves withheld by eye (4 on #6048, 3 here), text from `page_revisions` | 7 | 7 | positive controls |
| The other 11 of the 14 pages #6297 named, read from image | 11 | 0 | a translated title with a summary and keywords; 3 are four-line ornate leaves with a short verse |
| 213 Tengyur volumes, after the withholds | 128,329 translated, 35 short | 0 | |
| Random draw of 60,000 pages, 34,335 translated | 208 short | 5 | all 5 wrong by text: English for an empty or `[RECITATION_BLOCKED]` source, or a heading followed by a page of prose |
| Every `page_type: title-page` with English | 52,477, 9,474 short | 537 (349 books; 442 pages on public books) | see below |

Of the 537, a seeded random 20 were read as text: on all 20 the English carries paragraphs the transcription does not
hold. Most open with a continuity note and then give the previous or next page's text under the half-title
("PRECEPTS", "LUCULLUS", "BOOK III"). Five of the 20 were opened as images; all five leaves hold one line. So the
class is wider than recitation from memory: the same shape is produced when a neighbouring page's text lands on a
half-title. The reader meets it the same way, as English that is not on the page.

The raw signal over-counts. It measured the whole English string, so a one-line title with a `<summary>` and
`<keywords>` passed 600 characters: 11 of its 14 Tengyur pages were that.

**What this does not show.** The 203 short pages the rule did not fire on were not opened, so this gives no recall
figure outside the 7 controls. "Wrong by text" assumes the transcription is complete: a leaf whose transcription
missed most of the page would also fire, and the English would still not have come from that leaf's reading.

*Replicated?* No. One run, one reader.
