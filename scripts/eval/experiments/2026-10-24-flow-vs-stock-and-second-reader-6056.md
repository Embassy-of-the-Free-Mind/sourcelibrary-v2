---
stage: [ocr, translation]
measure: judged
languages: []
scripts: []
canons: []
n_books: 30
n_pages: 90
verdict: "Last week's new output carries a serious error on 1 of 30 pages (3%, CI 0–10) against 27–30% in the library's stock; a second Opus reader confirmed 35 of 35 serious calls from rounds 3–4 as real and serious, reclassifying 6 (mostly 'invented' to misread or omitted)."
status: informational
decision: null
superseded_by: null
issue: 6056
---
## 2026-10-24 · Is the new output better than the stock, and can the spot-check rates be trusted? (#6056)

PRIOR ART: the sprint rounds (`scripts/eval/results/spot-check/sprint-*`) and the fortnightly series measure the STOCK
(the public library as it stands) with one reader per page. `review-agreement.py` compares two full reviews; nothing
checked the serious calls one by one, and no frame sampled what the lanes write now.

**Questions.** (1) Do the lanes running now write better text than the stock they are added to? (2) How often is a
first reader's "serious" call wrong?

**Design.**
- **Flow:** `draw.mjs --frame recent --days 7` (new, PR #7266): books with pages whose English was written in the last
  7 days (293 books on 2026-10-24, hidden included), 10 books uniform per book, a run of 3 from the new pages only,
  seed 2026102405. Same reviewer brief (`REVIEWER.md` v1), 2 Opus readers, same scorer.
- **Precision:** every serious call of rounds 3–4 (35 claims on 17 pages) given to 2 fresh Opus readers with
  `SECOND-READER.md` (refute first, image open). Results in `second-reader-2026-10-24/`.

**Result — flow vs stock.**

| frame | round | pages with a serious error | books with an on-sight defect |
|---|---|---:|---:|
| recent (last 7 days) | r5 | **1/30 (3%, CI 0–10)** | 2/10 (CI 0–50) |
| public (stock) | r3 | 9/30 (30%, CI 7–57) | 7/10 |
| public (stock) | r4 | 8/30 (27%, CI 13–43) | 9/10 |

- The intervals do not overlap. The new pages come mostly from Paddle → gemini-3.8-flash-low (Siku and 儒林外史) and
  one Opus OCR → gemini-4-argon-low (Chilam Balam, cursive Maya: clean).
- The one serious page is *Summa Angelica* (incunable), gemini-3-flash OCR → **gemini-3.1-flash-lite** translation:
  misread abbreviations carried into fluent English — the old lane's signature.
- **Caveat:** the flow is not the stock's mix. 8 of 10 books are Chinese, 4 are volumes of one novel; a lane that is
  good on Chinese print says little about Latin manuscripts. Rotate the frame each round before reading a trend.

**Result — second reader.**

| verdict | claims |
|---|---:|
| confirmed (real, serious, as stated) | 29 |
| misclassified (real and serious, wrong class) | 6 |
| real_not_serious / not_an_error / cannot_tell | 0 |

- Every serious call was real. Five of six reclassifications move "invented" (O1) to "misread" (O6) or "skipped" (O5):
  the leaf's own text is there, badly read. The published rates stand; the O1 counts in the cluster table are inflated.
- The second reader overruled one of the session's own by-eye calls: Bracton p203 and p205 do carry passages not on
  the leaf (an opening line and a date); both pages were contained on 2026-10-24.

**What it means.** The serious-error rate a reader meets is set by the backlog, not the lanes now running: repairing
the stock (re-reading and re-translating old-lane pages) is the lever, and the old flash-lite translation lane is still
writing. Reviewer calls are trustworthy for "serious"; read their taxonomy class through a second reader.

**Not established.** Flow rate outside Chinese; whether the 7-day window is typical; second-reader precision on calls
other than serious.
