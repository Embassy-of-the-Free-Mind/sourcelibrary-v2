---
stage: translation
measure: [judged, agreement]
languages: [lzh, zh]
scripts: [Hani]
canons: []
n_books: 48
n_pages: 192
verdict: "Held 史記, 漢書, 後漢書 and 三國志 Siku volumes (Paddle OCR 2026-10-28, gemini-3.8-flash-low English 2026-10-29, all written before the #7914 stop) were read against the image by Opus reviewers, 8 books × 4 pages per stratum. Serious-page rates: 13% [3–22], 13% [0–25], 6% [0–19] and 6% [0–16]. Live Siku control: 19% [3–38]. Printed OCR-only books under hold paddle-print-6101: 13% [3–22]. Every interval overlaps the control's. Wrong leaf 0 of 192 pages. Reread κ is 0.65 (below 0.7). The second reader confirmed 33 of 35 serious calls and reclassified none. Model-free over all 24,602 pages: the 表 (table) volumes are where low witness agreement and numeral garbage concentrate, and 674 pages carry the 欽定四庫全書 margin title garbled into body text. 2026-11-04."
status: adopted
landed: "scripts/maintenance/publish-held-chinese-8053.mjs"
decision: "Recommendation to Derek on #8053: release the four histories with the English labelled draft (B), but keep the 表 volumes held (C), and publish without lifting the pipeline hold so that nothing paid is queued. Release the printed OCR-only books as facsimile + OCR (A). One page was contained (史記 vol 9 p24)."
feeds: [surface, detector]
supersedes: []
superseded_by: null
issue: [8053, 7546, 6056, 5142]
router_evidence: "none — one route per stage (one OCR lane, one translation lane); compares held shelves with a live shelf, not routes"
defect_rates: "none — shelf-overview reports serious-page rates per stratum with by-book CIs, not per-1,000-word rates by route; no route was compared"
---
## 2026-11-04 · Can the held Chinese histories be released? (#8053)
<!-- PRIOR ART: .claude/skills/shelf-overview/SKILL.md (the procedure, followed as is); 2026-10-30-siku-translation-error-types-5600.md (the Siku lane diagnosis behind the #7914 stop; its arm B is the same encyclopaedias that dominate this run's control); scripts/lib/paddle-zh-lane.mjs (the Dice screen, whose stored ocr.qa_screen is read here, not recomputed). -->

**Question.** About 24,602 pages of 史記, 漢書, 後漢書 and 三國志 sit hidden under hold `zh-histories-7546`, with OCR and English done. Are they worse than the Siku volumes readers can already open? Which can go live, and in what form?

**Validity first.** `.claude/docs/measurement-validity.md` rates shelf-overview **unvalidated**: no planted controls were run in this round either. The absolute rates below are therefore not the evidence. The evidence is the comparison with a live control, read by the same reviewers with the same method, on the same day. Method `scripts/eval/methods/shelf-overview.md` v2 (8 books per stratum, plus an OCR-only stratum). Do not pool these rates with v1 or with other methods.

### What is on the pages (provenance, Mongo, 2026-11-04)
- **OCR, one route.** PaddleOCR-VL-1.6-0.9B, lane `paddle-zh-2026-10`, 2026-10-28 13:45–15:09Z: 23,853 pages. 749 pages have no OCR (史記 268, 漢書 292, 後漢書 108, 三國志 81).
- **English, one route.** `gemini-3.8-flash-low` via `scripts/batch/cli-translate.mjs`, run by the Siku lane (`zh-histories-7546` is in `SIKU_LANE_HOLDS`), 2026-10-29 01:33–17:08Z: 22,072 pages. **All of them were written before the #7914 stop (2026-10-30 14:06Z); none after.** Note: the hold's release text says translation "is Derek's decision", yet the Siku lane translated these books while they were held.
- Because each stage has only one route, the review is not broken down by route.

### Sample and readers
Seed 2026110401, `overview-draw.mjs --books 8 --bins 4`: 6 strata × 32 pages = 192 pages from 48 books. Stratum 5 needed an OCR-page draw, so `overview-draw.mjs` gained a narrow `pages: "ocr"` option (in this PR). The 史部 and 集部 volumes being imported under hold `zh-shi-ji-8053` are excluded from every frame. Readers: one Opus reviewer per stratum with the image open, no hints, verdicts unedited. Reread: a second full pass over 三國志. Second reader: every serious call went to a fresh Opus reader (`scripts/eval/spot-check/SECOND-READER.md`). Cost: $18.16 API-equivalent ($0.081/page) on the subscription; $0 cash.

### Results (2026-11-04, n = 32 pages / 8 books per stratum; CIs by book bootstrap)

| stratum | frame (books) | serious pages | wrong leaf | OCR / EN mean (1–5) | show / caveat / don't | serious calls confirmed by 2nd reader |
|---|---|---|---|---|---|---|
| 史記 KR2a0001 | 44 | 13% [3–22] | 0 | 4.53 / 4.47 | 2 / 6 / 0 | 7 of 7 |
| 漢書 KR2a0007 | 57 | 13% [0–25] | 0 | 4.25 / 3.94 | 0 / 8 / 0 | 6 of 7 (1 real, not serious) |
| 後漢書 KR2a0009 | 43 | 6% [0–19] | 0 | 4.09 / 4.16 | 0 / 8 / 0 | 4 of 4 |
| 三國志 KR2a0012 | 23 | 6% [0–16] | 0 | 4.47 / 4.28 | 2 / 6 / 0 | 2 of 2 |
| print OCR-only (paddle-print-6101) | 159 | 13% [3–22] | 0 | 3.94 / — | 2 / 6 / 0 | 4 of 4 |
| **control: live Siku** | 1,965 | **19% [3–38]** | 0 | 4.00 / 3.69 | 2 / 2 / **4** | 10 of 11 (1 real, not serious) |

Reclassified by the second reader: 0 in every stratum. **Reread κ (serious, 三國志) = 0.65 [0.00–1.00], below 0.7.** Raw agreement was 31 of 32 pages, OCR ρ 0.64, EN ρ 0.71, and the book verdict agreed 8 of 8. With so few serious pages, κ is fragile, so the per-stratum rates carry reader noise on top of sampling noise.

**Serious errors by kind** (counts of errors, page-error-taxonomy classes):

| stratum | serious | all errors (top) |
|---|---|---|
| 史記 | O11 furniture ×6, T8 sense inverted ×1 | O11 15, D1 7, T8 5, T5 3, O1 3, O6 3 |
| 漢書 | O11 ×2, T10 invented note ×2, T7 fluent-over-garble ×2, T6 seam ×1 | O11 26, D1 17, T7 5, O6 4, T10 4 |
| 後漢書 | T10 ×2, T7 ×2 | O11 33, O6 5, T10 4, D1 4 |
| 三國志 | T10 ×1, T6 ×1 | O11 14, D1 8, T10 5, O6 3 |
| print OCR-only | O5 omission, O6 misread (明→非), O7 dose dropped, O1 invented line (遠鏡說) | O6 19, O4 6, O5 5 |
| control | T7 ×5, O4 ×3, T10, O5, O7 | T7 21, O6 15, O11 10, T10 6, O4 6 |

The held histories have one recurring serious class that the control lacks. The margin title 欽定四庫全書 is read as a garbled body line (次定曰事全焉…), and the English then sometimes makes it into a commentator ("Ci Ding"), a lacuna, or a marginal note. This happened in 7 sampled pages across 6 books. The control's serious errors are of a different kind: invented poets and headwords translated from shredded OCR in 駢字類編 and 佩文韻府 (5 of the 8 control books are these encyclopaedias, as in #5600 arm B). This makes the control a hard bar in one respect and an easy one in another. It is not a like-for-like genre match.

### Model-free, all 24,602 pages ($0, no sampling)
- **Witness agreement.** These are Dice scores stored by the lane against the Kanripo WYG witness, not recomputed.
  - 漢書: 7,561 pages screened, median 0.939, 769 below 0.6 (10.2%). Bins 0–.2:717 · .2–.5:31 · .5–.6:21 · .6–.8:58 · .8–.9:727 · .9–1:6,007. The low scores sit in the 表 volumes (6–11, plus some of 5).
  - 後漢書: 6,188 screened, median 0.944, 89 below 0.6 (1.4%).
  - 三國志: 3,598 screened, median 0.822, 1,662 below 0.6 (46%). This figure is an artefact. Kanripo KR2a0012 holds only 魏志 (files 000–030), so all 15 蜀志/吳志 volumes have no witness and score "low". 魏志 alone has about 150 pages below 0.6. **蜀志 and 吳志 are unscreened.**
  - Unscreened (fewer than 20 Han characters): 104, 72 and 38 pages.
  - 史記 has no WYG witness. It was screened against `master` (the TLS edition, Zhonghua 1959 base, **without** the 三家注 commentaries), so this is a different witness. 6,174 pages: median 0.43, IQR 0.20–0.67. Commentary that the witness lacks pulls the score down.
- **What low Dice means here.** I opened the five lowest pages (≥100 Han characters, one per volume) by eye:
  - 史記 vol 8 p188: a table. The OCR is a numeral loop that is not on the leaf; there is no English.
  - vol 9 p24: a table. The OCR is a numeral grid that is not on the leaf, and the English translates it. **Contained.**
  - vol 10 p23: a table. The OCR is the leaf's text with every line reversed.
  - vol 44 p106: the 正義論例 phonetic glossary. The OCR is right; the TLS witness lacks this section.
  - vol 1 p46: Qing editors' front matter. The OCR is right; the witness lacks it.
  - So low Dice here means a table page, or content the witness does not carry. These five are not prose misreads.
- **Coverage.**
  - 749 pages have no OCR.
  - 2,530 have no English. Of those, 1,781 are OCR'd but untranslated: 327 have under 20 Han characters, 718 have 20–99, and 736 have 100 or more. Almost all of the 736 are 表 volumes with no English at all: 史記 vols 8, 10, 11, 12 and 漢書 vols 6, 8, 9, 10, 11.
  - English length is 3.83 / 7.74 / 10.61 Latin characters per source Han at p5 / p50 / p95. Only 2 pages are under 1×.
- **Loop tells.** The lane's guard (`gpuLoopVerdict`) fires on 41 stored pages: tail_runaway 35, repetition_loop 2, repeated_lines 4. Character runs over 40: 0. Pages whose OCR is more than 60% numerals: 110, of which 106 are in 史記 vols 8, 9, 10.
- **欽定四庫全書 margin garble** (counted per #5142, O11): 674 OCR'd pages (2.8%), of which 636 are translated. The English names "Ci Ding" or "Jin Ding" on 61 pages. The rule caught 6 of 7 positive controls, and 15 of 15 random hits were real, so 674 is a lower bound. Script: `model-free/garble-count.mjs`.

### Juan questions (from the OCR text)
- **漢書 juan 36–37 (#7546).** Volume 25 is labelled 33–35 but holds juan 36, leaves 1a–36a only; WYG 036 has 52 leaves. **Juan 36 leaves 36b–52b and all of juan 37 are missing from the set.**
- **Other 漢書 mislabels.** vol 24, labelled 31–32, is 33–35. vol 26 is 38–40. vol 8 "15下" is juan 16. vol 12 "20上~下" is 21 (律曆志). vol 17 "二十五六" is 26.
- **史記 vol 40** (6ae0bd884adf2ffb52f72549), labelled "卷一百七", is **juan 117**: p2 heads 史記卷一百十七 司馬相如列傳第五十七, and 50 page-centre headers read 卷一百十七.

### Showcase pages (25 candidates, each opened by eye, 2026-11-04)
I opened 5 candidates per releasable work and rejected none. Pages marked ✓ are clean enough to show. Pages marked ~ are fine to read but carry one small issue (named).
- **史記:** ✓ [6ae0bca94adf2ffb52f71e1b p44](https://sourcelibrary.org/book/6ae0bca94adf2ffb52f71e1b?page=44) (Laozi biography) · ✓ [6ae0bd3d4adf2ffb52f72384 p85](https://sourcelibrary.org/book/6ae0bd3d4adf2ffb52f72384?page=85) · ✓ [6ae0bd8d4adf2ffb52f725c5 p108](https://sourcelibrary.org/book/6ae0bd8d4adf2ffb52f725c5?page=108) · ~ 6ae0bc1f4adf2ffb52f71a90 p37 (the folio number is rendered "Volume 18") · ~ 6ae0bd3a4adf2ffb52f722f9 p126 (garbled margin line in the OCR; the English drops it)
- **漢書:** no clean page among the 5. ~ 6ae0c1554adf2ffb52f74035 p30 (以杖 read 以救) · ~ 6ae0c1f34adf2ffb52f74449 p11 (a Song Qi collation note is garbled in the English) · ~ 6ae0bdda4adf2ffb52f72939 p55, 6ae0be184adf2ffb52f729b9 p16 and 6ae0c1e14adf2ffb52f74326 p99 (garbled margin line; p99 also has 鋋殺 → "iron hammer")
- **後漢書:** ✓ [6ae0c5b74adf2ffb52f75c45 p103](https://sourcelibrary.org/book/6ae0c5b74adf2ffb52f75c45?page=103) (Yuan Shao defies Dong Zhuo) · ✓ [6ae0c5bc4adf2ffb52f75cea p72](https://sourcelibrary.org/book/6ae0c5bc4adf2ffb52f75cea?page=72) · ~ 6ae0c2834adf2ffb52f747e5 p132 (a clause cut at the page end is completed wrongly) · ~ 6ae0c2ce4adf2ffb52f74a6e p76 (梁竦 and 梁松 are both rendered "Liang Song") · ~ 6ae0c4394adf2ffb52f75327 p27
- **三國志:** ✓ [6ae0c6cf4adf2ffb52f76830 p121](https://sourcelibrary.org/book/6ae0c6cf4adf2ffb52f76830?page=121) (Hu Zhi) · ✓ [6ae0c71d4adf2ffb52f76b10 p145](https://sourcelibrary.org/book/6ae0c71d4adf2ffb52f76b10?page=145) (Xi Zheng's rhapsody) · ~ 6ae0c7164adf2ffb52f76a64 p27 (Jieting; 愀 read 慠, the English is right) · ~ 6ae0c7ef4adf2ffb52f76f4d p127 (突 read 災, the English is right) · ~ 6ae0c6694adf2ffb52f76286 p46
- **Printed, OCR only:** ✓ [6a3c6bdfc4e8626320db2395 p21](https://sourcelibrary.org/book/6a3c6bdfc4e8626320db2395?page=21) · ✓ 6a3c6bf4c4e8626320db3a11 p45 (one character unconfirmed at this resolution) · ~ 69aebb3a39a43078777732aa p138 (有恃即戎 read 有時即我) · ~ 69aebb5e39a4307877774064 p229 · ~ 6a3c6cf8c4e8626320dbdace p39
- Of the 20 manuscript candidates, 5 carry the margin garble in the OCR. In all 5 the English dropped it rather than inventing from it.

### What the sample cannot rule out
- **Rates:** with 8 books per stratum, any held stratum's true serious-page rate could be as high as about 25% (漢書's upper bound). It could also be as low as the control's lower bound.
- **Wrong leaf:** 0 of 192 pages, so by the rule of three the true wrong-leaf rate could still be up to about 1.6%. A rare invented page, such as the one #7914 found in 1 of 10 pages, could be missed at that size.
- **κ 0.65:** reader noise is not small.
- **Coverage gaps:** 蜀志 and 吳志 have no model-free screen, and the table volumes were only lightly sampled.

### Containment
史記 vol 9 (6ae0bb3a4adf2ffb52f7136a) p24: a numeral grid that is not on the leaf, with English translating it. I withheld it by eye, with `--issue=8053`, and labelled #8053 `contained`. The 7 "Ci Ding" pages are an invented note on a page whose body is the leaf. Following #5600, these count as findings, not containment, and are counted on #5142.

### Recommendation (Derek's decision; nothing was released)
- **史記, 漢書, 後漢書, 三國志 → B (release with the English labelled draft), except the 表 volumes.** Every interval overlaps the control's. The don't-show count is 0 against the control's 4. The reader already labels AI English "AI translation, not yet reviewed by a scholar", and shows book_checks warnings (#6199).
- **表 (table) volumes → C (keep held).** These are 史記 vols 8–12 (juan 13–22) and 漢書 vols 5–11 (the 表 juan). There, OCR is numeral loops, reversed lines or grids not on the leaf, most pages have no English, and 1 page was contained. Smallest fix: a table-aware read, or serving the Kanripo text for these juan.
- **Printed OCR-only books → A (facsimile + OCR; there is no English to withhold).** 13% [3–22] against the control's 19% [3–38], OCR mean 3.94 against 4.00.
- **Before any release:** fix the 漢書 and 史記 vol 40 juan labels, and add a catalogue note that 漢書 juan 36 (from 36b) and 37 are not held.
- **How to release, whatever is chosen: publish, and keep the pipeline hold.**
  - Do **not** use `hold-pipeline-books.mjs --release-held --to ocr_complete` as the release. I checked this in code (`scripts/workers/pipeline-orchestrator.mjs`). Once a book's status is `ocr_complete`:
    - Phase 3.7 runs paid Gemini transliteration on non-Latin books.
    - The translate phase sends Chinese to the `flash-measured` row on the Batch channel (paid API), which would translate the 1,781 OCR'd but untranslated pages, table garbage included.
    - Finalize (around line 6139) auto-unhides any book that is `hidden: true` with no `hidden_reason`. These books have no `hidden_reason`.
  - Use `setPublicationMany(db, ids, { state: 'public', by, issue: 8053, note })` from `scripts/lib/publication.mjs`, the one publication writer, over an id file that excludes the 表 volumes. `pipeline_auto.status` stays `held`, which no phase selects, so nothing is queued.
  - **Residual risk:** `src/app/api/admin/bulk-ocr-new/route.ts` selects any non-deleted book with un-OCR'd pages. Its hold check only observes (#5480), so once the books are visible, the 749 un-OCR'd pages could be sent to a paid read. Make that guard refuse held books before release, or accept the risk explicitly.
