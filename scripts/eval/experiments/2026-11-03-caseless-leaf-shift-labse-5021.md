---
stage: translation
measure: [judged]
languages: [zh, bo]
scripts: [Hani, Tibt]
canons: []
n_books: 3048
n_pages: 41544
verdict: "Served Chinese and Tibetan English shows no excess of wrong-leaf pages: with LaBSE (local, gex45) scoring each page's English against its own source and its neighbours' (head and tail windows), block-written pages flag at 0.12% (Han) and 0.57% (Tibetan), under the 1% false-alarm rate set on single-page-written pages; Opus with the scans confirms 0 of 10 Han and 1 of 10 Tibetan candidates. Estimated shifted books: Tibetan about 10 of 1,349 (upper about 45), Han about 0 among what the test sees (upper about 20, recall 39%)."
status: adopted
decision: "The 1 confirmed Tibetan page (69e7ab01 p.40) withheld under the contain-on-finding rule; no library-wide caseless sweep is warranted at this rate. The windowed LaBSE score is kept as a Tibetan screen (recall 99% at 1% false alarms on synthetic slides); for Han it is weak (39%) and the write-time anchor (#8009) is the protection."
superseded_by: null
issue: [5021]
router_evidence: "none — a detector's calibration on stored English, not a comparison of routes"
defect_rates: "none — the unit is a page on the wrong leaf"
---
## 2026-11-03 · Wrong-leaf English in Chinese and Tibetan, by cross-lingual embedding (#5021 Part B)

PRIOR ART: `scripts/audit/translation-leaf-shift.mjs` (number vote, absorption; silent on 91% of Han and 99% of
Tibetan pages), `scripts/eval/caseless-drift-7503/` (a clause moved across one Han boundary; the floor idea is its).

**Design.** `extract.mjs`: every visible Chinese and Tibetan book with 6+ translated pages, up to 80 evenly spaced
translated pages per book, each with its source and both neighbours' sources; a page is *block-written* when its
English was written within 2 s of a neighbour's (one call), else *alone* (the floor: a one-page call cannot slide).
Sample: Han 20,000 block + 6,000 alone; Tibetan 12,000 block + 3,544 alone (all). `labse_sims.py` (LaBSE,
`sentence-transformers/LaBSE` pooler output, fp16, gex45 GPU queue): margin m = s(EN, SRC n) - max(s(EN, SRC n-1),
s(EN, SRC n+1)). Threshold: the 1% quantile of m on the floor. Recall on synthetic slides: a floor page's English
set on its neighbour scores s_next - s_own there. `analyse.py`.

**Whole page vs windows.** Whole pages (512-token cut) do not separate: floor median margin 0.09 (Han) / 0.03
(Tibetan), synthetic recall 8% / 25% at 1% false alarms. The cut sets one window of a dense Han page against English
covering a different share of the text. With head and tail windows (600 English characters against the same share of
each source, by the page's own length ratio), floor median margins 0.18 / 0.12 and **synthetic recall 39% (Han) and
98.8% (Tibetan)**.

**Served.** Block-written pages under the threshold: Han 24 of 20,000 (0.12%, 19 books), Tibetan 69 of 12,000 (0.57%,
52 books), both under the floor's 1%: no excess. Opus (`leaf-shift-confirm-5021.mjs`, blind, scans of n-1, n, n+1) on a
seeded 10 per script, one per book: Han 10 own; Tibetan 9 own, 1 mixed: 69e7ab01 p.40's English omits its first
leaf and carries p.41's second ("forgetful, possessed of broken wisdom, as mute as sheep"). Withheld the same day.

**Estimate.** Tibetan: 52 candidate books × 1/10 ≈ 5 in the 713 sampled, ≈ 10 of 1,349 (95% upper on precision 0.45:
≈ 45). Han: 0/10 (upper 0.31): ≈ 0, upper ≈ 7 books among those the windows can see, ≈ 20 allowing for 39% recall.
The library run's corroborated absorptions add 73 Han pages in 29 books (`absorbed-outside-runs.jsonl.gz`), already
in that run's Opus frame. Results: `scripts/eval/results/caseless-shift-5021/2026-11-03/`.
