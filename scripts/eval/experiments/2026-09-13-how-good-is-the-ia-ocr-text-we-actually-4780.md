## 2026-09-13 — How good is the IA OCR text we actually WROTE, and where should the cutoff sit? (#4780, #4763)

**Headline: the delivered text in the accepted bands has a median CER of 3.9% (WER 8%)
against a fresh flash-lite read of the same image; 84% of pages are within 10%, and a 10%
tail is above 20%. Quality degrades smoothly with the gate score — there is no cliff at
0.85 — so the cutoff is a policy choice, and it should differ by language: 0.80 for
English and French, 0.85 for Latin/German/Italian, and Greek should not be filled at any
score.** The two proposed refinements from the hand read on #4780 were tested and both
fall: a prose-page-only book score admits books whose delivered pages are mediocre
(median 9.1%), and the column-splice failure is page-local, invisible at book level.

- **Design.** One interior, previously-untranscribed page per BOOK (742 books) across
  agreement band × language — including the bands the gate REJECTS (0.40–0.85, text
  regenerated from the leaves cache exactly as the ingester would write it) — scored by
  CER/WER against a fresh `gemini-3.1-flash-lite` read via the eval-lib runner with the
  production prompt v16, thinking budget 0, the production document-context line. Per
  page also the gate's own sequence ratio, bag-of-words Dice and their gap; per book the
  gate re-scored with the current (#4783) logic as median-over-all, median-over-prose
  pages, and p75. Five hand-read anchor pages from the peer session ride along.
  `scripts/eval/ia-ocr-delivered-quality.mjs`; rows in
  `results/ia-ocr-delivered-quality-2026-09-13.jsonl` (image URL + both texts on every
  row). Cost **$2.49** (742 + 193 re-reads; $3.02/1K pages — realtime lite, not the batch
  rate the $1.20 estimate used).
- **By band, all languages (clean references only):** median CER 0.40–0.60 17.3% ·
  0.60–0.70 13.3% · 0.70–0.75 10.1% · 0.75–0.80 9.3% · 0.80–0.85 7.0% · 0.85–0.90 5.9% ·
  0.90–0.95 3.4% · 0.95+ 1.4%. Share ≤ 5% CER climbs 4% → 11% → 20% → 23% → 33% → 37% →
  71% → 97%. Pre-1800 pages median 12.0% vs 5.8% for 1800+ (Latin pre-1800 11.8%).
- **Per-language cutoff sweep (accepted median CER / share ≤ 5% / share > 20%):**
  English 0.85 → 2.7%/71%/6%, 0.80 → 3.3%/65%/7%, 0.75 → 4.3%/58%/6%; French 0.85 →
  3.2%/69%/8%, 0.80 → 3.4%/68%/8% (rejects below 0.80 hold ONE good page); Latin 0.85 →
  4.5%/61%/11%, 0.80 → 4.7%/52%/12%; German 0.85 → 3.2%/57%/13%, 0.90 still 15% > 20%;
  Greek 0.85 → 6.6%/29%/24% and n=5 at 0.90; Italian n=30, 0.85 → 2.1%/71%/14%.
- **The instrument, calibrated on the anchors.** The 0.95+ band medians 1.4%, so the
  reader-vs-reader floor is ~1–2%. The two pages a human called verbatim (Basil *Letters*
  0.353, Dance of Death 0.890) score **6.0% and 6.1% CER** — so ≤ 5% ≈ verbatim by eye,
  6–10% ≈ a few visible errors; the Latin page the human called garbage (*Oratio pro
  Ligario*, names corrupted) scores 7.8% CER / **23% WER** — word error rate is the
  better proxy for "names are wrong". The column-interleaved Century page scores CER
  1.02 with gap 0.25.
- **Bag-of-words minus sequence isolates 14 of 488 pages (gap ≥ 0.15), median CER 0.735
  vs 0.075 for the rest** — the label works. But every one of those pages sits in a book
  whose reference-page gap median is ≤ 0.04: **the splice is page-local (a spread, a
  two-column page), not a book property. A book-level splice gate would catch none of
  them.** CER already flags them as delivered text.
- **Prose-only book score: rejected.** Median |prose − all| = 0.007 — the statistic
  barely moves for most books. Where it does move (39 rejected books cross 0.85) the
  delivered pages median **9.1% CER**, worse than the 3.9% accepted median. The Basil
  case (facing-page Greek dragging a verbatim English book to 0.35) is real and rare; as a
  policy the prose score admits mediocre books.
- **Delivery errors: 31 of 573 pages (5.4%) show text and image as DIFFERENT pages** — the fresh
  read of the archived image fits leaf k±1 at seq > 0.5 while the delivered leaf scores < 0.3.
  Re-read from the SOURCE leaf the record points at (`pages.photo`, IIIF) and classified, because
  the two causes need OPPOSITE repairs: **24 text-side** (the source leaf matches the NEXT leaf's
  text: the gate's per-book offset was locally wrong — every one is "text one leaf behind", the
  Oxyrhynchus volumes worst; 2 already written), **5 image-side** (the text matches the source
  leaf; the archived R2 image is the neighbouring leaf — the #3368 bulk-JP2 leaf offset,
  `.claude/handoffs/2026-07-27-bulk-jp2-leaf-offset.md`; the TEXT is right; 2 written), 2 unclear.
  Mechanism for the text-side class: the reference pages are the book's FIRST 25 (the preview
  sample), so the offset is calibrated at the front and drifts by the interior; an 86% vote
  (`--min-offset-share` 0.60 passes it) was locally wrong. **A repair must classify first —
  shifting text to match the archived image would corrupt the image-side class.** Peer
  verification of the four written cases on #4790 (against IIIF, by printed page number) agrees.
- **Corpus-wide sizing, free and deterministic (`scripts/audit/ia-ocr-leaf-drift.mjs`).** IA's
  scandata marks leaves excluded from access formats; BOTH the IIIF page index and the djvu.xml
  OBJECT sequence skip them (access-leaf count == XML object count on 478/478 written books), so
  the correct offset is 0 for every book. The bulk-JP2 archived images (#3368) do NOT skip them,
  and the reference pages were OCR'd from those images — the offset vote fitted the XML to the
  wrong image set. **236 of 893 written books (26%), 51,851 of 152,997 written pages (34%), were
  written at offset −1/−2/−3 and carry the text of the wrong leaf against their own source.** The
  paid sample's "2 of 56" was a wide interval around the wrong quantity: at the front of an
  offset −1 bulk book the text matches the *shifted* image, so only pages past an interior
  excluded leaf were caught. Shown-image mismatch is an upper bound (98 books / 4,544 pages,
  assuming every bulk image set is shifted; Possidius is aligned, Century shift+1 — only the
  #3368 dHash audit can count it). Folio continuity inside the written text was tried first and
  is blind to this: a fixed shift of a continuous sequence (Open Court delivered folios
  355/356/357 vs archived 353/354/355 vs IIIF 356/357/358).
- **The 2×2 and the repair (same evening).** dHash of each bulk-archived written book's images
  against IIIF at the aligned vs the scandata-predicted leaf (`--stage=images`): CLASS A (images
  aligned, text offset ≠ 0 — reader sees the wrong text) **39 books / 940 pages, repaired**: 910
  pages re-pointed to offset 0 from the cache with revisions, 30 held (offset-0 leaf has no words),
  second run 0 changes; 7/7 readable IIIF re-reads confirm (new text 0.90–0.97 vs old 0.11–0.17).
  CLASS B (images shifted, text right) 42 / 2,270 → the #3368 image repair. **CLASS C (images
  shifted, text at a compensating offset) 188 books / 48,006 pages: text and image AGREE on screen
  except 2,062 pages past an interior excluded leaf — HELD**, must be repaired together with the
  images, images first. So the offset search mostly *masked* #3368 rather than breaking pages.
  Ingester now forces offset 0 and refuses a non-zero vote as `REF_SHIFTED`.
- **Refusals are the instrument's big limit.** 193/742 first-pass references (26%) came
  back RECITATION/PROHIBITED_CONTENT because the run omitted production's document-context
  line; adding it recovered only 24, leaving **169 (23%) unscored — concentrated in the
  cleanest, most recitable print (78 of 169 in bands ≥ 0.85)**, so the accepted-band
  figures are, if anything, pessimistic. The production tier-2 retry (flash-preview)
  would cost ≈ $0.80 more and was not run (over the $3 cap). A further 56 references were
  degenerate (40 hit MAX_TOKENS in a loop — flash-lite on dense Latin/German/Greek pages)
  and are excluded. Stored-text check: 70 pages read from `pages.ocr.data` matched the
  regenerated leaf exactly, all 70.
- **Decision:** per-language cutoffs (English/French 0.80; Latin/German/Italian 0.85;
  Greek: do not fill); force offset 0 in the ingester — a non-zero vote means the reference
  pages were read from #3368-shifted images, a tell to refuse on, not a calibration; re-pair the
  236 books' written pages at offset 0 from the cache (no model calls), images FIRST or both per
  book, since at the front the text currently matches the shifted image.
  Issue: #4790.
