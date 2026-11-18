---
stage: ocr
measure: judged
languages: [lzh]
scripts: [Hani]
canons: []
n_books: 85
n_pages: 1053
verdict: "FAIL by the preregistered rule on Chinese print. A layout-on re-read disagrees with the stored layout-off read by >= 5% on 48% of 1,053 print pages, so at stage 1's threshold the flag is too broad: Opus found material errors on 12/40 flagged pages (30%, Wilson 18-45%) against 5/40 unflagged (12.5%). The 2x ratio passes and all 5 planted controls were caught; the 'half of flagged pages are bad' bar fails. Descriptively, at >= 20% disagreement (11% of pages) 5 of 7 judged pages were material; that threshold is not tested."
status: informational
decision: null
superseded_by: null
issue: [6871]
---
## 2026-11-17 · Stage 2: does the layout-flip flag find bad Paddle pages in Chinese print? (#6871)

PRIOR ART: stage 1, `2026-11-17-paddle-self-agree-6871.md` (Siku against Kanripo: PASS, layout off as the flip).
Preregistration `scripts/eval/paddle-self-agree-6871/PREREG-print.md`, committed before the GPU arms ran.
Data: `scripts/eval/results/paddle-self-agree-6871/print/` (flags, judge key, Opus replies, results).

**Design.** 1,053 random interior pages (≤ 3 per book) of the 357 Chinese books of the #6101 print lane, leaves cut as
the lane cut them. Signal d = symmetric Han CER between the stored layout-off read and a layout-on re-read; flagged
= d ≥ 0.05. 40 flagged + 40 unflagged pages (one per book, text still the lane's) and 5 planted controls, judged blind
by Opus against the image (#6388 rubric adapted to print). GPU 30 min on gex45, Opus 85 calls on the subscription, $0.

**Result.**

| | pages | clean | minor | material | unusable | material or worse |
|---|---|---|---|---|---|---|
| flagged (d ≥ 0.05) | 40 | 12 | 16 | 12 | 0 | 30% (18–45%) |
| unflagged | 40 | 17 | 18 | 5 | 0 | 12.5% (5–26%) |
| planted controls | 5 | | | 5 | | 5/5 caught |

- Pass rules: half of flagged bad **FAIL** (30%); ratio ≥ 2x **pass** (2.4x); controls **pass**. Overall **FAIL**.
- **Flag rate: 509 of 1,053 pages (48%).** Median d is 4.8%: on print, layout on and off disagree far more than on Siku
  manuscripts, mostly by reading order and block splitting rather than characters, so 5% is near the median.
- Stack drift is nil: the fresh layout-off read matches the stored read (median 0), and d from fresh reads gives the same flags.
- **Descriptive, not preregistered (small n):** within the flagged pages, material rate by d band: 0.05–0.10, 6/27;
  0.10–0.20, 1/6; ≥ 0.20, 5/7. 121 pages (11.5%) have d ≥ 0.20.

**Reading it.** The layout flip carries some signal on print (flagged pages are 2.4x as often bad), but at the
Siku threshold it flags half the corpus and most flagged pages are fine. It is not a routing flag for print as
preregistered. A higher threshold (≈ 0.20) looks promising but needs its own preregistered test on fresh pages; an
order-insensitive (bag-of-characters) disagreement may separate layout noise from misreads better. Until then a second
engine (Flash-low) remains the flag for print with no reference text, and Kanripo remains the flag for the Siku.

**Also seen.** On print, Opus judged 12% of unflagged and 30% of flagged pages material: about 21% material overall on
this sample, near the Siku random QA's 22% (#6388).
