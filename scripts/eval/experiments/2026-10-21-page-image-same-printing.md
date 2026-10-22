---
stage: metadata
measure: count
languages: []
scripts: []
canons: []
n_books: 46
n_pages: null
verdict: "Keypoint matching on page images separates same printing (median inliers 56-1,400) from different edition, printing or volume (6-16) on 25 control pairs, with no OCR; whole-page dHash does not (both ~30 of 256 bits)."
status: informational
decision: null
superseded_by: null
issue: [4285, 6019]
---
## 2026-10-21 · Can page images tell two copies of one printing from two editions, before anything is read? (#4285, pre-OCR side)
<!-- PRIOR ART: scripts/clip-find-duplicates.mjs (CLIP over illustrations; editions share woodblocks, so it cannot separate them); scripts/lib/page-alignment.mjs dHash (tested here, rejected); scripts/README-dedup.md (9x8 dHash over-grouped text pages); #4285 page-text comparator (needs OCR on both sides). -->

**Question.** Derek asked whether embeddings could find duplicates. Book embeddings are built from title, author, summary and entities; an unread book has only title and author, the same evidence the import keys already use, and the costly duplicates are the unread ones. So the screen before paid OCR has to read the page images. Does it work, and on what evidence?

**Controls (25 pairs).** 11 copies claimed by `checkHoldings()` on the harmony shelf; 6 random `duplicate_of` pairs with OCR on both sides; 8 known different: Kircher *Magnes* 1643 vs 1654, Gerbert *Scriptores* vol. I vs II and I vs III (vol. III title page read from OCR), Müller *Staatskunst* Teil 1 vs 2, Cellarius *Harmonia macrocosmica* 1661 vs 1708, and three 1670s printings of Spinoza's *Tractatus theologico-politicus* (the #4285 hard negatives). Sampling: 8 interior leaves of A (12%..94%), each against a window of B (same relative leaf ±8 and same absolute leaf ±8). Cost $0; images from R2 or the provider's IIIF.

**1. Whole-page dHash fails** (count). 256-bit dHash on the central crop: claimed copies 18-42 bits, known-different 19-42 bits. Only Kepler's *Prodromus* (1-5 bits) matched: the same scan stored twice. Photographs of one printing by two libraries differ in crop, lighting and skew more than two editions differ in layout.

**2. Keypoint matching separates them** (count). ORB keypoints, ratio-test matches, RANSAC homography; score = inliers of the best window page; verdict on the median over samples.

| group | pairs | median inliers |
|---|---:|---|
| different edition / printing / volume | 8 | 6, 8, 9, 9, 10, 10, 12, 16 |
| claimed copies, `duplicate_of` copies | 15 | 56 to 1,400 |
| low despite being recorded as copies | 4 | see 3 |

Single-page outliers exist: Cellarius 1661 vs 1708 scored 265 on one leaf (a copper plate reused across editions) with a median of 6. The median is what keeps a shared plate or woodcut from deciding.

**3. The four low pairs** (wide window ±(|nA-nB|+10)):
- *Lexicon alchemiae* 1612 (584 vs 641 leaves): 42-57 with the wide window. The narrow window had missed the matching leaf; the copies differ by 57 leaves. Same printing.
- *Philosophia Moysaica* 1638 (304 vs 338): 23, 72, 26. Unclear.
- *Amphitheatrum sapientiae* 1609 (332 vs 337): 8-12, and the page text also does not match (5-gram containment 0-0.05). A `duplicate_of` link that is probably wrong; for review.
- *Nosologia harmonica* 1615, two records both "Tomus primus": 9-10. **Read from the image:** the title pages are two typesettings ("QUINQUAGINTA" vs "QUIN-QUAGINTA"; "Apud Paulum Egenolphum … cIↄ Iↄ CXV" vs "Typis Pauli Egenolphi … M.DC.XV."). The metadata keys called them one edition; the images were right.

**Rule** (in `scripts/audit/page-image-same-printing.py`): median ≥ 40 same printing; ≤ 15 different; otherwise unclear; fewer than 4 scorable samples unclear. Run `--wide` when page counts differ by more than ~15.

**Limits.** 25 pairs, mostly Latin early-modern prints from e-rara, MDZ and IA; manuscripts, photographs of modern books and very short items are untested. "Different" at ≤ 15 can also mean the two copies are bound or scanned so differently that no sampled leaf falls in the window; it is evidence against a merge, never a reason to delete. Text containment as ground truth only existed where both sides were OCR'd (5 pairs).

**Use.** A hold before paid OCR (`hold-pipeline-books.mjs --ids … --reason same-edition-copy-unread`) needs `same_printing` from this script; a merge or `duplicate_of` still needs the review the edition-identity invariant asks for.
