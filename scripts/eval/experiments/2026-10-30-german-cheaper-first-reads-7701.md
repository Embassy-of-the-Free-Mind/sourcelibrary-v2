---
stage: ocr
measure: [judged]
languages: [de]
scripts: [Latn]
canons: []
n_books: 30
n_pages: 30
verdict: "No cheaper route replaces the live German first read (agy Flash-low read@4, 21/24 written pages accepted here, 63/68 over the three #7701 draws, 0 wrong text). On the same 30 pages (18 Fraktur, 12 Antiqua): read@8 18/22, 1 wrong text, paired 0 vs 1 (P 0.757); LightOnOCR-3-1B alone 13/30 with 10 wrong text; PERO-OCR alone 11/29 with 8 wrong text and 3 invented letters from show-through; LightOnOCR > agy@4 20/25 with 2 wrong text; PERO > agy@4 17/22 with 2. On Fraktur the GPU engines alone fail outright (LightOnOCR 2/18, PERO 3/18), and so does UB Mannheim's Fraktur Kraken model (0/18 accepted, wrong text on 17/18). On Antiqua, LightOnOCR alone is the one promising arm: 11/12, 0 wrong text, about $0.0001 per accepted page, but n = 12 is short of the bar (P(acc >= 0.8) = 0.77)."
status: rejected
decision: "Keep the live German first read (cli-ocr-lane.mjs run, read@4, no correction). Nothing switched. Test next: LightOnOCR-3-1B alone on German ANTIQUA pages (n >= 30, about 7% of the frame), and LightOnOCR > agy@4 on Fraktur (11/14, 0 wrong text, about half the cost of read@4, but n is short)."
superseded_by: null
issue: [7701, 6740]
router_evidence: [german-blank, german-blank-fraktur, german-blank-antiqua]
---
PRIOR ART: `2026-10-29-cheap-routes-7701.md` (the same frame and cell; it moved German to read@4 alone, 42/44 written over n = 60;
this test keeps its rule and harness, `cheap-routes-7701/run.mjs`, copied to `german-cheaper-7701/run.mjs`). For the GPU
arms: the #7263 German panel (CHURRO-3B alone 27/49, wrong text 22/49; router table german-gpu-7263), bench-2
(`2026-09-03-bench-2-complete-can-self-hosted-ocr-replace-gemini.md`: the Fraktur Kraken model at 98.5-99.8% on three early
Fraktur pages) and `2026-10-03-open-engine-print-5660.md` (Paddle 5.5% and olmOCR 2.6% CER lost to lite's 0.5% on 21 Fraktur
pages; generic Kraken/CATMuS lost badly). LightOnOCR on Fraktur had never been tested.

## 2026-10-30 · German first reads: three cheaper routes against read@4 (#7701)

German print with no OCR reads 4 pages a call with no correction (#7752). Its $0.0014 per accepted page is all agy quota,
the binding constraint. This test asks whether the GPU, alone or as a draft under a cheaper agy correction, or 8 pages a
call, can take some of that load.

**Design** (rule fixed before any read: `RULE.md`, commit 544a789; amendment 1 (GC reads on the drawn page's 4-page
piece, for the agy budget) and amendment 2 (Derek's Kraken arm) both committed before any verdict on the routes they
touch.)
- **Draw.** `judge.mjs draw --cells=de-cheap` drew 170 new books in the first-read lane's frame, one interior unread page a book, both earlier #7701 draws left out.
- **Faces, labelled by eye from each page image** (`script-faces.json`): 141 Fraktur, 12 Antiqua and 17 other (blank, binding, plate, a bare table, Syriac). Antiqua is 7% of the frame, so the test takes all 12 Antiqua pages and the first 18 Fraktur pages.
- **Paired.** Every route ran on the same pages:

| route | what |
|---|---|
| read@4 (live) | agy gemini-3.8-flash-low, 4 pages a call, inside the page's block of up to 8 unread pages |
| read@8 | the same read, 8 a call (cli-ocr.mjs `--per-call` now allows up to 8) |
| lighton | LightOnOCR-3-1B on gex45 (vLLM, the euro-draft recipe, UTIL 0.6), alone |
| pero | PERO-OCR `pero_eu_cz_print_newspapers_2022-09-26` on the card, alone |
| lighton>agy@4, pero>agy@4 | the draft corrected by agy Flash-low with the image, 4 a call (arm C's shape), written by the GPU-draft apply with the #7695 put-back rule |
| kraken, kraken>agy@4 | Fraktur pages only: `austriannewspapers.mlmodel` (UB Mannheim, doi 10.5281/zenodo.7933402, sha256 376a3aa7…feb069; the 2026-03 version of bench-2's model) after kraken 7.1.1's blla segmenter, CPU |

- **Judge.** Opus (`claude -p`), the route-judge-6740 prompt, blind and shuffled, against the page image.
- **Controls.** 16 wrong-page controls: every route's two were refused. 4 planted errors, 2 a face: 4/4 caught.
- **Budget.** 514 agy calls (A 214, R8 180, the three corrections 37 + 46 + 37), under the brief's 800.

**Result.** Written pages; $ = (agy calls a page × $0.00087 + machine seconds a page × $249 / 30 days) / the share of the
30 DRAWN pages accepted. Score: `route-judge-6740/results/german-cheaper-7701-2026-10-30/score.json`.

| route | all 30: accepted | wrong text | agy calls/page | machine s/page | $/accepted | Fraktur (18) | Antiqua (12) | paired vs read@4 |
|---|---|---|---|---|---|---|---|---|
| **read@4 (live)** | **21/24** | 0 | 0.97 | — | 0.00120 | 13/15, 0 wt | 8/9, 0 wt | — |
| read@8 | 18/22 | 1 | 0.81 | — | 0.00118 | 12/15, 1 wt | 6/7, 0 wt | 0 vs 1 of 21, P 0.757 |
| lighton | 13/30 | **10** | 0 | 0.89 | 0.00020 | **2/18**, 10 wt | **11/12, 0 wt** | 1 vs 12 of 24 |
| pero | 11/29 | **8** (+3 invented) | 0 | 0.32 | 0.00008 | 3/18, 7 wt | 8/11, 1 wt, 3 invented | 2 vs 13 of 23 |
| lighton>agy@4 | 20/25 | 2 | 0.33 | 0.89 | 0.00056 | 11/14, 0 wt | 9/11, 2 wt | 2 vs 4 of 20, P 0.491 |
| pero>agy@4 | 17/22 | 2 | 0.41 | 0.32 | 0.00069 | 9/13, 1 wt | 8/9, 1 wt | 1 vs 5 of 19, P 0.202 |
| kraken (Fraktur) | — | — | 0 | 2.77 | — | **0/18, 17 wt** | — | 0 vs 13 of 15 |
| kraken>agy@4 (Fraktur) | — | — | 0.53 | 2.77 | — | 0/3, 1 wt | — | 0 vs 1 of 2 |

**What failed, and how.**
- **The GPU engines alone cannot read Fraktur.** LightOnOCR misreads words into other real words, which is the dangerous kind: "Sarge" became "Garge", "Hörnin Seyfried" became "Zörnin", "Kotzen" (vomiting) became "Kosen". PERO garbles numbers and recipe signs, reading ℞ as "3" or "12" so that it looks like a quantity.
- **Kraken's Fraktur model reads 19th-century newspaper Fraktur, not these books.** On 15th-17th-century print it loses whole phrases: "zehen gepot halte" became "zelen gexotbalee". Bench-2's 98.5-99.8% was three pages.
- **Corrected drafts mostly do not get written.** Under agy, 12 of 18 Kraken pages were refused by the put-back rule: the corrector's changes are not like-for-like substitutions.
- **Antiqua is the exception.** LightOnOCR alone read 11/12 with no wrong text, at about 1/14 of read@4's cost. PERO on Antiqua invents letters from show-through ("EineH", "speisen,8", a stray "I" line).
- **read@8 saves 16% of calls.** It loses more blocks to cut replies (6 against 4), and it misread "30ten" as "20ten" (wrong text).
- **The corrections on Antiqua missed text.** Both GC routes truncated the same long page and dropped its footnote. LightOnOCR > agy also copied a wrong table value ("1236" where the page prints 1286).

**Rule** (RULE.md): no route is eligible.
- read@4 itself is at P(acc >= 0.8) = 0.77 on these 24 pages (0.91 posterior mean over its 68 pooled), so it stays live and no cheaper route clears the bar that would replace it.
- Pooled pick: read@4. Fraktur: read@4. Antiqua: read@4.
- The router (`router-table/2026-10-30-german-cheaper-7701.md`, cells german-blank, german-blank-fraktur, german-blank-antiqua) agrees. German keeps read@4. The Fraktur face HOLDs on read@4. The Antiqua face HOLDs and names LightOnOCR alone as the next route to test.

**Written.** The 21 pages whose read@4 the judge accepted with no wrong-text, invented or wrong-leaf defect went through the
lane's own apply (first reads only, printed only, stamp agy-first-read-7701; run cli-ocr-20261030184126-1177265). All 21
books stay held `scans-only-publish-7270`, and none of the pages is translated.

**Not tested here:** the 17 blank and plate pages, LightOnOCR alone on n >= 30 Antiqua pages, and LightOnOCR > agy@4 on more Fraktur pages.
