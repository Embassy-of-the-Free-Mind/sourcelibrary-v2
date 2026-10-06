---
stage: ocr
measure: agreement
languages: [grc]
scripts: [Grek]
canons: []
n_books: 3
n_pages: null
verdict: "90 of 316 Greek manuscripts locate in an open edition, but no pilot book reaches the 80% write bar: Grec 1841 76.5% located (only Kraken verifies spans), Marcianus 46.5%."
status: superseded
decision: "No write proposed; next step a full Kraken read of Grec 1841 (#5619)"
superseded_by: "2026-10-06-greek-manuscripts-full-kraken-fit-5619.md"
issue: 5619
---
## 2026-10-02 · Greek manuscripts: can an open published edition be fitted to the scans instead of re-OCR? (#5619)
<!-- PRIOR ART: sefaria-fit (#5560) is the method reused here; Kanripo alignment (#5568) is the metric template (located / drift / boundaries); the Greek specialist-OCR benchmark is #4744 (out of scope). -->

**Question.** Flash garbles the Greek manuscript hands, and the translation then smooths the garble into invented prose (#5575). Can an open edition be located page by page in a manuscript instead? Steps: (1) a census of the Greek manuscripts we hold; (2) open editions for them; (3) a pilot on Marcianus gr. 299, Grec 1841 (Proclus *In Timaeum*) and Vat.gr.12.

**Design.** Read-only. Nothing was written to `pages`/`books`/`page_translations`.
- **Census** (`greek-ms-census-5619.mjs`): Greek-tagged books with a manuscript signal (MS-holding provider, shelfmark-shaped title, a pre-1460 or "century" date). A book is classed by its own OCR envelope (`<script>` on ≥ 3 of 5 interior pages). Where the envelope is silent, one interior image is classed by flash-lite (metered, $0.28).
- **Edition match** (`greek-ms-fit-5619.mjs search`): 3 interior pages per manuscript, 9-grams of the folded Flash reading, searched against all 1,898 flattened First1KGreek + Perseus canonical-greekLit editions (commits 03776b3 / bcc5df0) and two PD prints we hold. Plain gram share picks big editions by chance (the Suda "won" 135 of Vat.gr.12's 257 pages and sits at chance in the fit). So the score is the **window share**, the most of a page's grams inside one 6,000-letter stretch. A book matches edition E when ≥ 2 of 3 pages put E first at ≥ 0.03 and ≥ 1.5× the runner-up. Chance is about 0.01–0.02.
- **Fit** (`greek-ms-fit-5619.mjs fit`): #5560's code unchanged (`locate`, `anchorAt`, `fitEnd`, `gramBag`, `FIT_RULES` v1, `fitClass`), with a Greek fold in place of the Hebrew normaliser. *Located* uses #5560's definition: the page's coarse position is in order with its neighbours. The chance level is the same run with a WRONG book's pages. *Boundary* = start(N+1) − end(N) between consecutive pages whose own first and last 150 letters fit confidently. *Neighbour method* = #5560 exactly: span [end(N−1), start(N+1)], scored against the page's own reading with shift and far controls. *Drift* = a page's start predicted from an anchor k pages back.
- **Independent reader**: Kraken greek-cllg (CPU, non-generative) on 10 sampled neighbour-fitted pages, scored against the same span with the same controls.

**Result — census.** **385 Greek manuscript books, 149,476 pages** (126,268 OCR'd, 118,208 translated). **355 visible (137,189 pages), 30 hidden (12,287).** By provider: Bodleian 134, Laurenziana 59, Vatican 46, Gallica 42, Cambridge 36, e-codices 15. On 46 of them the sampled text is mostly Latin (bilinguals, Latin translations). Every book has a `work_id`, but 295 are `local:` ids. Another 248 hidden, un-OCR'd books (BSB/Gallica) could not be classed because their source images returned 429. The count includes 5 photographic facsimiles of the Sinaiticus and Alexandrinus.

**Result — edition match.** Of the 316 manuscripts with ≥ 2 sampled text pages, **90 (40,483 of 139,943 pages) locate in an open edition**:
- 85 in First1K/Perseus, all **CC BY-SA 4.0** (64 by the file's TEI `<licence>`, 21 by Perseus's repository licence);
- 5 in PD prints we hold: Schneider's 1847 *In Timaeum* for Grec 1841, Grec 1839 and the Cambridge Psellos; Berthelot–Ruelle vols 2–3 for Marcianus 299 and the Laurenziana *Ars sacra*.

The most common works are Plotinus, Homer, Herodotus, John, Plato *Laws*, Thucydides, Euclid, Strabo, Galen and the Septuagint. On 60 of the 90, Flash's reading already matches the edition at window share ≥ 0.3: either a clean read or recitation, and this measure cannot tell the two apart. A miscellany whose 3 sampled pages fall in 3 different works is not counted, so 90 is a floor.

**Result — pilot.**

| book | edition | located in order (wrong-book chance) | boundaries within 1 line (median gap) | neighbour method, Flash reading as verifier | Kraken as verifier | drift, k=1 / 5 / 20 pages, share within ½ page |
|---|---|---|---|---|---|---|
| Grec 1841 (Proclus, spreads) | Schneider 1847 (PD, held) | **267/349 = 76.5 %** (14 %; strict-share variant 21.5 %) | 39/50 = 78 % (4 letters) | verified 0/46 by 4-grams, 5/46 by 6-grams: Flash's reading is too poor to confirm a span | **5/5 verified** (F1 0.68–0.73 vs control ≤ 0.37) | 94 % / 75 % / 26 % |
| Grec 1841 | Diehl 1903–06 (PD, held) | 177/349 = 50.7 % | 78 % | 6/36 (6-gram) | — | 75 % / 46 % / 8 % |
| Marcianus gr. 299 | Berthelot–Ruelle vols 2–3 (PD, held) | **180/387 = 46.5 %** (11 %) | 93/118 = 79 % (2 letters); 25 gaps | **83/104 = 80 % verified** | 4/5 verified, 1 uninformative (p259, likewise for Flash) | 86 % / 40 % / 22 % |
| Vat.gr.12 (lexical miscellany) | none found; the Suda is at chance | 13.2 % (11.7 %) | — | — | — | — |

- **Grec 1841: the fit works and Flash is the weak link.** Pages 5–220 locate about 95 % in order. The tail beyond p. 300 falls off. On the same five spreads, the print-trained Kraken model matches Schneider's span at F1 ≈ 0.70, and Flash's own reading reaches only ≈ 0.38. That independently confirms #5575: the text Flash gives readers for this manuscript is mostly not what the page says.
- **Marcianus: located by treatise.** Located pages come in runs. Berthelot–Ruelle arranges the treatises in a different order, hence the 25 gaps and the poor 20-page drift. Where a page locates, the span verifies.
- **Diehl locates worse than Schneider**, because our OCR of Diehl carries the apparatus and the Greek/Latin notes.

**Decision rule (issue): propose a write if a pilot book aligns ≥ 80 %. No book does.** Grec 1841 is at 76.5 % located, but only Kraken verifies the spans. Marcianus is at 46.5 %, and Vat.gr.12 has no edition. **No DECISIONS-PENDING row is proposed.** Two cautions for any later write:
- An edition's text is not the manuscript's text: variants, abbreviations, order. A fitted span is "the edition's text for this page", a layer beside `ocr.data`, not a transcription.
- CC BY-SA 4.0 conflicts with the "bulk and AI-training use is reserved" line, as for Kanripo in #5568. That is Derek's call.

The cheapest next step that could cross 80 % is Grec 1841 alone: Kraken-read all 349 spreads (CPU, about 15 h at current box load, $0), re-locate on the Kraken reads, verify per page. Not run.

*Grade.* Pilot: exploratory (3 books). Census edition match: a screen, 3 pages per book. *Replicated?* No. *Cost:* Gemini $0.28 (census image check, metered under `scripts/eval/greek-ms-census-5619.mjs`); Kraken CPU about 40 min. *Artifacts:* `scripts/eval/greek-ms-census-5619.mjs`, `scripts/eval/greek-ms-fit-5619.mjs`, `scripts/eval/results/greek-ms-align-5619/` (census summary, per-book edition match, fit summaries incl. null runs, Kraken scores). Editions and reads: `hetzner:/mnt/HC_Volume_105839809/greek-ms-align-5619/`.
