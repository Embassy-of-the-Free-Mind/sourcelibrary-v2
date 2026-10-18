---
stage: ocr
measure: agreement
languages: [lzh, mnc]
scripts: [Hant, Mong]
canons: []
n_books: 91
n_pages: 100
verdict: "Reference set for the 47,420 held Chinese residue pages (recount exact: mixed 17,784, table 15,280, seal 5,878, reverted 372, unclassed 8,106). Two independent Opus reads, with a third resolving disagreements, give credible references for the Chinese text in table (2.0% order-insensitive disagreement), seal (3.2%), mixed (3.3% without 清文鑑) and reverted (3.8% without 清文鑑). There is no credible model reference for 清文鑑 Manchu-Chinese pages (20% disagreement) or for any Manchu/Mongolian script (21/98 transliteration tokens agree). 19/20 unclassed pages are textless."
status: informational
issue: [6871, 5660]
---

PRIOR ART: `scripts/audit/gpu-queue-5660.mjs` (the total, not split by class), and the class holds made by jobs
gpu-resume-5660 / zh-paddle-resume (#5660). Full method and per-class table: `scripts/eval/zh-residue-refs-6871/README.md`.

## 2026-10-17 · Can Opus make reference pages for the Chinese pages Paddle could not read?

**Question.** #6871 item 3 needs ≥ 20 reference pages per failure class before an engine bake-off on GEX45. Can two
independent Opus reads agree to within ~10% on each class?

**Design.** Exact recount from Mongo, split by the hold lists. A seeded draw (6871) of 20 pages per class, one page
per book, from the body window. Pass A and pass B were independent Opus subagents with the image opened, 10 pages
per call, in shuffled batches. Pass C, a blinded resolver, ran on the 65 pages where A and B differed.

**Result.** Disagreement between the two reads, on Han characters, character-weighted:

| class | A/B (order) | A/B (bag) | resolver overruled an agreed reading |
|---|---:|---:|---:|
| table | 14.0% | 2.0% | 2 |
| mixed | 7.5% | 5.5% | 3 |
| seal | 3.2% | 3.2% | 13 |
| reverted | 8.0% | 4.6% | 8 |
| 清文鑑 pages | 20.0% | 11.3% | 3 |

Table disagreement is reading order, plus tablature glyphs that have no Unicode character. Seal agreement is
inflated: the readers named the head glyphs from the gloss beneath them. The unclassed 8,106 pages are 19/20
textless (CI 76–99%), so Paddle's empty output on them was correct.

**Consequence.** The bake-off can be scored on table, seal, mixed and reverted pages. Use an order-insensitive
metric on tables, score seal heads separately, and exclude 清文鑑 pages and all non-Chinese script. 清文鑑 needs a
Manchu reader or an aligned digital edition first.
