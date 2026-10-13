---
stage: translation
measure: judged
languages: []
scripts: []
canons: []
n_books: 1000
n_pages: 225583
verdict: "Echo gate flags 166 of 225,583 judged pages (0.07%) after three exemptions, 8 of 11 hand-read real; about 5% of production blocks return short and now go single-page."
status: adopted
decision: "Echo gate and block-shift guard shipped before the page-break flip (PR #5176)"
superseded_by: null
issue: 5103
---
## 2026-09-25 (round 4, guards) — Echo gate sized on the local mirror before shipping: 229 whole-page flags in 225,583 judged pages (0.10%), 8 of 20 hand-read real; three exemptions take it to 166 flags and 8 of 11 real (#5103)

**Why:** round 4 found two production hazards the flip (#5170) would otherwise ride on: a page whose
"translation" is its own source (the realtime health gate checked collapse and runaway only), and a block
that comes back short with every label one page off (the worker's parse accepted 7 of 8). Derek wants
quality, so both guards go in BEFORE the flip. No model spend. Guards branch `worktree-page-break-guards-5103`.

**Echo gate.** `assessTranslationHealth(ocr, tr, { lang })` → reason `echo` via page-integrity's
`echoedSource` at the wholePage tier (the shared source run is at least half the translation's prose),
armed only when the book's language is passed. **False positives sized on `~/sl-corpus`** (mirror of
2026-09-10; 1,000 random visible translated books, seed 5103): 298,726 pages, 267,408 with a translation,
30,845 not judged as English-source, 10,980 as too short, **225,583 judged → 229 whole-page flags (0.10%)
in 69 books**. By language: Latin 84/89,782, German 47/27,805, Syriac 22/5,535, Greek 19/18,567, Italian
17/10,893, a Hebrew/Judeo-Arabic MS 13/226; Chinese, Tibetan, Hebrew, Russian, Persian 0.

**Hand read, 20 flags, one per book, against the source: 8 true echoes** (Plato, Pindar in Greek; Ficino,
Catena aurea, Wyclif Opuscula, Duns Scotus on the Sentences, Macrobius, Ammianus in Latin — pages a reader
would get in the original), **12 not**, in three shapes: (1) the book is English in any form ("Middle
English" was judged; its pages are modernised); (2) the PAGE is in English inside a non-English book — a
modern editor's title page, a bookplate, a colophon, selling agents — the OCR `<language>` tag says so
(5 of 12); (3) a structural page (title page, index, toc, colophon, diagram, table) whose content is
names, numbers or symbols and whose "translation" is the same table with headings rendered (5 of 12).
Now exemptions in the gate (`echoExempt`): flags 229 → **166 (0.07%) in 45 books**; of the 20, 11 remain —
the 8 true echoes and 3 residual false positives (a Mohawk ritual text kept as the object of study, a
Hebrew letter grid typed `text`, a Molière cast list): **precision 8/11**. The detector's own exemptions
held on the run: 621 list-like partial runs and 4,995 English-in-source runs not counted. Cost of a false
refusal: a translation that would have been the source verbatim anyway; text kept in `page_revisions`,
page stamped `health_blocked: 'echo'`, retriable.

**Block-shift guard.** `parseBlockTranslations()` (translate-core) discards a block that returns fewer
entries than pages sent; every page takes the missing-from-batch single-page path. Fixture: the j012
block (Apologia pp. 6–13), seven well-formed entries each one page off. **Rate in production** (Hetzner
worker logs 2026-09-11 → 09-25, all rotations): 75,541 pages in blocks of 8 ≈ 9,400 blocks; 577 came back
with pages missing, 104 of them the #5021 drift drops → **~473 (~5%) returned short**; 1,192 pages fell
back. With the guard those blocks' remaining pages (~2,800 per fortnight, ~3.7% of pages) go single-page
too, and the block call is wasted. A block with NO entries still counts towards parking the book; a short
one does not.
