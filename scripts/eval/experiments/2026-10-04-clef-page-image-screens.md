---
stage: image
measure: accuracy
languages: []
scripts: []
canons: []
n_books: 60
n_pages: 60
verdict: "Clef answers text-to-image match well (AUC 0.996, 60/60 next-page texts caught) and beats Gemini flash-lite on real pages; script class, blank and date screens fail."
status: informational
decision: "Clef chosen for the leaf-match screen; it ran the #5803 corpus screen"
superseded_by: null
issue: [5776, 5803]
---
## 2026-10-04 — Which page-image questions can Clef answer well enough to use? — RESULT

PRIOR ART: scripts/eval/experiments/2026-10-04-clef-vs-jev-instruction-page-screen.md — the text-only comparison; this is Clef's image input, scored against labels people made by eye (no new labels).

**Headline: one clear yes (does this text belong to this image?), two maybes (page language, spread), three no's.**
Clef (27B) and Clef-flash (9B) ran on Workers AI, with 1024px JPEG page images (~900 image tokens each).
Total $0.50 for ~2,300 calls. #5776 tracks the follow-ups.

| question | labels | result | verdict |
|---|---|---|---|
| **Text ↔ image match**: does this OCR transcribe this page? | 60 books, one page each; the page's own OCR vs the NEXT page's OCR (same hand/type) vs another book's OCR. Labels are constructed. | AUC match-vs-next: **Clef 0.996**, flash 0.990; match-vs-other: 1.00. At a 0.9 threshold Clef catches **60/60** next-page texts and flags 4/60 matched pages. Flash at 0.5: 34/34 caught with 0 false alarms on Latin-script pages, weaker on other scripts. | **Yes.** ~$0.0002/page (Clef) |
| Page language | 720 pages from #5122 / `benchmark/script-class/` (73% Chinese, 17% Greek) | Clef 95%, flash 92%. The catalogue disagrees with the eye label on 11%; Clef gets 62% of those right. When Clef disagrees with the catalogue at ≥0.5 confidence it is right 45/60. | **Maybe**: the sample is too narrow to generalise |
| Spread vs single page | the same 720 pages; **only 5 spreads** | AUC 0.999 (Clef), 0.996 (flash) | **Maybe**: 5 positives is a hint, not evidence |
| Script class (typeset / manuscript / woodblock) | the same 720 | 25%. 504/526 Chinese manuscripts called woodblock; outside CJK, 161/187 (86%) | **No** |
| White / show-through / real ink | 161 by-eye labels (`ocr-v19-labels.jsonl`) | Clef 76%, but **18/45 real-ink pages called show-through**; AUC for "carries text to OCR" is 0.74 | **No**: it misses real text |
| Produced before/after 1900 | 199 read-from-image labels (`ia-date-check`) | AUC 0.93, but the existing rule is 96% where it decides and Clef 89%; on the 36 the rule leaves unknown, Clef gets 69% | **No**: nothing gained over the rule |

**The four flagged "matched" pages are not obviously false alarms.** All four are Tibetan, Persian, Syriac or
classical-Chinese multi-folio scans. One was opened (read from image): `69e789124a6785cfd60d2a48` p66 holds three
Tibetan folios in one photo. The stored p66 OCR uses the ༔ punctuation of the first folio; p67's OCR opens with the
། punctuation of folios two and three. So the text may cover one folio of three. **Unverified**: Tibetan was not read.

**Not shown.** The match test pairs a page with its neighbour's text: a constructed off-by-one, not the real
wrong-leaf population (#3368, #5683). Real defects can be partial (one folio of three), and their rate on a real
suspect list is unmeasured. The next step is the #5309 controls (6 positive / 8 control books) plus a 200-page
random sample, human-read at the top.

**Artifacts.** `scripts/eval/jev/clef-leaf-match.mjs`, `scripts/eval/jev/clef-image-screens.mjs`; summaries
`scripts/eval/results/clef-leaf-match-2026-10-04.json`, `scripts/eval/results/clef-image-screens-2026-10-04.json`.
Rows stayed in the session scratchpad. Gotcha: a 1600px page is refused (~170K estimated tokens against a 64K window);
1024px works.

### Follow-up: a screen of real stored pages (one page per book, 200 books, $0.11)

Each page was scored against its own stored OCR. Clef put **3/199 below 0.5** and 12 below 0.9. The four lowest were opened by eye:
- **0.06, a real whole-book defect (#5782).** *Schutzschrift für die Aechtheit der Rosenkreutzergesellschaft*: a full Clef pass over the book ($0.11) scores 366/367 pages mismatched. Four leaves were read from the image (e.g. leaf 102 shows p.75, its text is p.101).
- **0.28, a harness artifact.** Ovid (Loeb) p48: the harness sent the unsplit spread (`display_photo`) for a split page. Fixed: it now prefers `cropped_photo`.
- 0.37 and 0.56 (a Tibetan compilation, a Greek MS with out-of-order folio numbers): unverified.

**Cost-effectiveness.** One confirmed whole-book defect in 199 random books (95% CI roughly 0.01–2.8% of books). A
first pass of 1–3 pages per book over the visible corpus is on the order of $10–30 (Clef, ~$0.0003/page with
text). A full-book pass on each flagged book costs ~$0.10. Today's alternative is a reader report; this book's
mismatch was unreported.

### Follow-up: a random subset of 1,497 books ($0.59) + a neighbour check ($0.06) → #5803

36 pages scored below 0.5 (2.4%). `scripts/eval/jev/clef-shift-check.mjs` then scored each flagged image against the
texts of N±1, and each text against the images of N±1:
- **11 clean one-page shifts**: a neighbour matches at ≥ 0.95 in both directions. Two were confirmed by eye
  (Century Magazine leaf 113: image p.90 / text p.91; Kant *Critik* leaf 568: image p.548 / text p.547). 6 of the 11
  are IA books (#5683 offset is a candidate cause).
- 7 one-sided neighbour matches: multi-folio Tibetan/Hebrew photos or near-identical layouts; ambiguous.
- 16 match no neighbour: unverified (missing/garbled OCR, compilations, or misses).

**Rate:** ≥ 12 of 1,497 books (≈ 0.8%, counting #5782) carry text from another page on the ONE page sampled, so
this is a lower bound. The screen-plus-neighbour-check pattern costs ~$0.0004 per book and separates shifts from
other mismatches without a person; by-eye checks are then needed only to confirm direction before a repair.

### Follow-up: Gemini 3.1 flash-lite as the same check (`scripts/eval/jev/leaf-match-gemini-arm.mjs`)

**Constructed pairs (the same 60 books):** flash-lite AUC 1.00, 60/60 next-page caught, 0/60 false alarms, $0.00044/call
(Batch ½), median 2.8 s (Clef 0.8 s). It does as well as Clef or better.

**Real flags (36 Clef flags + 64 Clef passes, $0.15):** confounded at first, because the #5803 repair job had already
fixed 7 of the books before Gemini saw them. Gemini correctly called those matched. On the 4 books still broken
at test time (Kant, Esoteric Christianity, Northern Mythology, Boissard), Gemini flagged 3. On Northern Mythology it
said "yes" (1.0) to BOTH the page's own text and the next page's, so it can't separate neighbours. Of 64 Clef passes
it flagged 1: *Theatrum* p58, a genealogy table, which is **a Gemini false alarm** (read from image: image and text
are both p.52). On the 25 unverified Clef flags it agrees on 12. On this harder set its own match-vs-next AUC drops
to 0.865, with 16/100 false alarms.

**Bias:** the positives were found BY Clef, so Clef's recall here is 100% by construction. The 64 passes are the only
probe of Clef misses, and Gemini found no real one.

**Verdict:** Clef for this check. It is as cheap per call, 3× faster, gives graded probabilities, and is more reliable on
real hard pages (neighbour pages, tables, multi-folio scans). flash-lite's answers are nearly binary and it says "yes"
to look-alike neighbours. Corpus cost, corrected: the mirror holds ~71K books, so 1 page/book ≈ $28 and 2 pages ≈ $57 on
Clef (not the earlier $10–30, which assumed ~30K books).
