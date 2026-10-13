---
stage: pipeline
measure: judged
languages: []
scripts: [Latn, Grek, Hani, Tibt, Deva, Cyrl, Hebr, Arab, Tang]
canons: []
n_books: 200
n_pages: 200
verdict: "One random served page from each of 184 books, read against the image by Opus: a serious error on 62 (34%, 95% CI 27–41%), 22% frame-weighted; whole passages not of the leaf, confirmed by eye, on 10 (5%, 3–10%), all contained. Manuscripts 64% vs print 22%. Ten books per stratum is too few to rank lanes."
status: informational
decision: "10 pages contained (held + withheld, #6691); 200 book_checks rows (served-audit v1)"
superseded_by: null
issue: [6691, 6688, 6056]
---
## 2026-10-13 · What share of the pages readers are served carries a serious error, by lane? (#6691)
<!-- PRIOR ART: 2026-10-13-quality-sprint-round-2-public-frame-6056.md (10 random public books, 3 pages each: 4/30 pages serious) and the fortnightly spot check (_series-fortnightly-spot-check.md). Both draw uniform over books and cannot say which LANE the errors come from; this run stratifies by lane with one page per book. -->

**Question.** Every engine test so far scored engines on test sets. What do readers actually get today, and in which OCR × script × form × translation lane are the errors?

**Design.**
- **Frame.** 23,256 live books (`visible`, `pages_count > 0`) with a translated page.
- **Screen.** `served-draw.mjs`, seed 6691. The first 3,000 books in seeded order, uniform per book. For each, ONE translated page with `page_number > 0`, uniform over the book's translated pages, and its lane:
  - OCR engine family;
  - script family, from `books.language`;
  - form, from a catalogue heuristic (print, manuscript or e-text);
  - translation model family.
- **Strata.** The 20 lane cells with ≥ 10 screened books are strata; the rest is one stratum, `rest`. 10 books per stratum, 210 in all. A stratum's weight is its share of the screen.
- **Not reviewed.** 10 ETCSL Sumerian books: typed corpus text with a published translation and no image. No page in the screen was made by Claude, so no page needed a Gemini reviewer.
- **Review.** `run-reviewers.sh`: Opus via `claude -p`, 3 calls in flight, 22 packets of 9–10 books. The brief is the frozen `REVIEWER.md` plus the new `SERVED-ADDENDUM.md`, which asks for a review-vocabulary `kind` on each serious error, the form seen, a `not_this_leaf` call and a page verdict. 200 pages; $34.46 API-eq on the subscription, $0 billed.
- **Pilot.** The first book of each stratum (20 books) ran first; the full run used the same brief unchanged.
- **Scoring.** `served-score.mjs`: k of n books with Wilson 95% intervals (`kOfNBooks`). The headline is served pages only; exposure was taken at the draw.
- **By-eye checks.** Every `not_this_leaf` call that claimed a passage or more was re-read by the session with the image open.

**Result.** Measured 2026-10-13. 184 served books, 16 withheld. All 10 BDRC Tibetan pages in the sample were already withheld, so that stratum has no served book.

| | served books |
|---|---|
| serious error, unweighted | **62 of 184 (34%, 95% CI 27–41%)** |
| serious error, frame-weighted | 22% (19 strata, 93% of the frame) |
| a passage or the whole text not of this leaf, confirmed by eye | **10 of 184 (5%, 3–10%)**, all contained |
| image and text of different leaves (image fault, text right) | 3 of 184 (2%, 1–5%) |
| reviewer `not_this_leaf` calls, any size | 27 of 184 (15%, 10–21%) |
| page verdict, all 200 | show 74 · caveat 59 · do not show 67 |

- **Kinds** among served books with a serious error (a book can carry more than one): misread 21, confabulation 13, omission 11, mistranslation 10, illegible fill 9, added gloss 7, other 4, wrong leaf 3, carry-over 3, layout 3, show-through 1. Classes: O6 20, T7 19, O1 11, T10 8, T8 6, O5 5.
- **The 27 `not_this_leaf` calls**, sorted:
  - 10 contained (below).
  - 3 are image faults: the text is of the right IA leaf and the served image is not.
  - 1 page was already withheld.
  - 13 are a clause or line, kept as findings. Of these, 4 are seam completions, where the English finishes a sentence the leaf breaks off; 4 are a line or phrase of fill on a hard leaf; 3 are notes or image descriptions (a library stamp named wrongly, a heading, a citation); 1 is an edition-text recitation; 1 is the next page's sentence.
  - So "text not on the leaf" in the vocabulary's sense is 15%, but whole-passage invention is about a third of that.
- **By the form the reviewer saw (served):** manuscript 28 of 44 (64%, 49–76%); print 25 of 116 (22%, 15–30%); plate 6 of 13; blank 3 of 11.
- **Per stratum** (each n ≈ 10; intervals about ± 25–30 points): `report.md`. Highest rates: Latin manuscript / 3 Flash / lite translation 8 of 10; Greek manuscript 6 of 10; Paddle CJK with lite translation 6 of 10; lite CJK 6 of 10 and 4 of 5. Lowest: Latin print, 1–2 of 10 in each of the four big Latin-print strata; Tibetan Esukhia e-text 0 of 10.
- **Where repair pays most** (share × frame × rate, so volume counts): the two big Latin-print strata, Gemini lite or 3 Flash OCR with lite translation (≈ 940 and ≈ 670 books with a serious page; 1–2 of 10 each), then Latin print with 3 Flash both ways (≈ 580). The high-rate strata are each under 1% of the frame. With n = 10 these ranks are not stable: a stratum's 1/10 and 2/10 overlap almost entirely.

**Contained** (`containment-on-finding.md`: books held for `served-audit-6691`, the named page withheld with a `page_revisions` snapshot; undo `restore-withheld-translation.mjs`):

| book | page | what the leaf shows vs the stored text |
|---|---:|---|
| Year book reports 1332–1337 `69f32f7f876dd827cbc45808` | 201 | about 50 lines of law hand; 16 stored lines that loop stock phrases from line 5 |
| Thucydides, Vat. gr. 126 `6993837f50654cbbe2916cba` | 250 | Thuc. 5.45.4 legible; the top half of the stored text is invented ("περὶ τὴν Κύπρον") |
| Tangut Avatamsaka `69f1341dc8d07a681065333c` | 4 | ~30 varied columns; the transcription loops 4 glyphs; the English calls it a glossary |
| Zohar MS `69b3e677304c1c6b3950b41f` | 547 | Aramaic Zohar (Terumah, fol. 271); the stored text is a Hebrew essay that is not on the leaf |
| Disputatio de aetatibus `6a4f1ddbdd60b16646ccecf3` | 2 | Bregelana / Reusner / Meiovio; the stored text gives Königsberg / Kanter / 1717 |
| 臺灣番社風俗 `6992f412c8c6ac61574e753f` | 10 | plate 収貯; the English adds a 刈禾 reaping scene that is not on the leaf |
| Graha Kaumudi `69906d5364d44bd0a0ef5344` | 3 | 13 lines of verse; the English invents a planet table |
| Fragmenta Herculanensia `6953cc3677f38f6761be156e` | 172 | a drawing only; the English appends another page's apparatus |
| Khunrath, Urim & Thurim `6a267d456c1f37c9c4f391d6` | 21 | the leaf ends "Parentis mul-ti-"; the English goes on for four paragraphs |
| Genji Monogatari Ekotoba `69dfede38d34461cbe7f4db6` | 17 | the English is not a translation of the stored (correct) Japanese |

**Image faults, not contained** (the text is right, so withholding it fixes nothing):
- Galen vol. 8 (`69b0081de8cbd2498149b813`) and Sorel, *Réflexions sur la violence* (`69aeaaf167e6731bc136594f`). Both are `bulk_jp2` archives one leaf behind (#3368). In the Galen volume the shift starts between images 21 and 25: at image 20 image and text agree, from image 26 on the image is one leaf behind.
- 西洋新法曆書 (`69af118e7feb16bd9d149210`). The display images are swapped in pairs (page 3 ↔ 0004, page 4 ↔ 0003, 5 ↔ 6).

**What this teaches about sample size (for the weekly audit, #6688).**
- At 10 books a stratum, a Wilson interval spans about 50 points: 1/10 is 2–40% and 6/10 is 31–83%. Ten books separate only the extremes (Latin print vs manuscripts). To tell a 10% lane from a 25% lane (power 0.8) needs about 100 books per lane; ± 10 points at 30% needs about 80.
- The pooled served rate is already usable at n = 184 (± 7 points). A weekly audit should report the pooled rate and a handful of grouped lanes (print vs manuscript, Latin vs other scripts, lite vs Flash translation), each with ≥ 40 books. Cell-level rates should accumulate across weeks.
- One reviewer's `not_this_leaf` overcounts whole-page invention by about 3× (27 calls, 10 passages confirmed). The audit needs the by-eye step, or a second reader on those calls, before it quotes "invented".
- The lane frame is dominated by Latin print (≈ 70%). Proportional allocation would spend the audit where the rate is lowest, and ten books per cell spends it where the volume is smallest. A Neyman-style allocation (∝ share × √(p(1−p))) puts about 60% of the books in the big Latin-print strata and the rest in manuscripts and non-Latin print.
- Three image faults in 184 books (2%) are invisible to any text-only detector. The weekly audit must keep opening the image.

**Limits.**
- One AI reviewer (Opus) per page. Class and kind labels were unstable across reads in #6174 (Jaccard 0.55–0.67).
- 6 pages were marked low confidence and 68 medium.
- The strata's form is a catalogue heuristic; the reviewer's by-eye form is reported separately.
- The 13 fragment-level `not_this_leaf` calls were not each re-checked by eye.
- One page per book says nothing about a book's other pages.

*Replicated?* No. Data: `scripts/eval/results/spot-check/served-2026-10-13/`: `sample.json` (draw, lanes, exposure), `draw-log.json`, `screen.json.gz`, `reviews/`, `report.md`, `report.json`. The packets are the reviewer view of `sample.json` and are not committed.
