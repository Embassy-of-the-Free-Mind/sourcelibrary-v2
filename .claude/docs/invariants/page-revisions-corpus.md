# `page_revisions` is not a clean double-OCR corpus

**Read this when:** Measuring OCR agreement, calibration, or mining pages for difficulty.

*Split out of `CLAUDE.md` on 2026-08-04. The text is unchanged apart from cross-references repointed to their new files. See `.claude/docs/knowledge-layer.md` for why this tier exists.*

---

It is used as one — 109,953 same-page pairs, and `scripts/eval/calibration-scorecard.mjs` fits agreement→accuracy on 32 anchor pages then applies it corpus-wide. **That inference assumes both sides read the same image, and ~40% of the time they did not.** Measured 2026-07-30 (`scripts/audit/revision-image-shift.mjs`, randomized n=3,339 pairs carrying a printed `<page-num>` on both sides): 40.2% report a *different printed page number*, i.e. a different leaf. Of 366 books with ≥3 comparable pairs, 112 shift on >50% of pairs and 88 of those systematically — one offset, almost always exactly **+1**.

**Those are the #3357 e-rara repair, not fresh damage — the live data is correct** (verified against the scans: image `…974800b0/49.jpg` shows printed 5, current OCR says 5, the revision says 4). The tell was **inverted timestamps**: revision created 2026-07-25 while the current `ocr.updated_at` read 2026-04-04, i.e. *older than the text it supposedly replaced*. That is impossible for a re-OCR and diagnostic of a **text shift** — #3357 moved existing `ocr` subdocuments between pages rather than re-transcribing ("323 text-shifted back"), so each page inherited its neighbour's object *and that object's timestamp*, while `page_revisions` snapshotted the displaced text at repair time.

- **Exclude pairs whose printed page numbers disagree before any corpus-wide fit.** One predicate removes both the repair artifact and genuine image swaps. Without it you are partly measuring one administrative event replicated across thousands of pages.
- **This is why agreement is a weak accuracy proxy** — 63 points of agreement range map to ~5 points of accuracy in the anchor fit. Agreement is partly measuring image stability, not legibility.
- **Mining the corpus for "hard to read" pages (#3469) must apply the same filter**, or the hard pages will mostly be re-archived ones. And note it is blind to the *fabrication* class by construction: two passes that both recite the same memorized verse agree perfectly (`/blog/reciting-not-reading`).
- **Any shift-style repair must stamp `ocr.updated_at` on the write.** Leaving the moved object's original timestamp is precisely what made this take a day to diagnose, and the next such sweep will do it again.
- Two further non-legibility causes in the same corpus: **truncation** (one pass transcribed a single column and stopped — 156 words vs 661 on the same page) and **normalization convention** (`nūc`→`nunc`, `q;`→`que`, `&`→`et`), which breaks exact-string alignment and cascades into fake substitutions. The *actual* early-modern glyph confusions — long-s ↔ f, ligatures, tildes — are ~1% of substitutions (`scripts/eval/disagreement-typology.mjs`).
