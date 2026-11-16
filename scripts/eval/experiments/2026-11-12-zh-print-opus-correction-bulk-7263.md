---
stage: ocr
measure: none
languages: [zh]
scripts: [Hani]
canons: []
n_books: null
n_pages: null
verdict: "Decision record, no new measurement. The Opus correction of first-read printed Chinese (one page a call) is the adopted route for the print part of the 2026-11-03 frame. Derek released the bulk on 2026-11-04 although the pilot missed its bar (51/60 accepted, 6 wrong-text against 4); the runner's own blind check at 1,000 written pages is the gate that stands. Restarted 2026-11-12 22:00Z after a stop at its per-wave breaker (#90)."
status: adopted
decision: "Print: adopted, running as systemd unit sl-zh-print-bulk-7263 (stop: touch its run/STOP). The Siku part of the 2026-11-03 frame is not decided here: that question is carried by 2026-11-04-zh-siku-route-matrix-7263.md, which stays undecided. current.json and the routing tables are untouched."
feeds: route
landed: scripts/batch/zh-print-correct-7263/runner.mjs
supersedes: [2026-11-03-zh-gemini-reocr-cell-7263.md, 2026-11-04-zh-print-correct-pilot-7263.md]
superseded_by: null
issue: [7263, 90]
router_evidence: "none — a decision record; no route was judged in it"
defect_rates: "none — nothing was judged in this entry; the pilot's rates are in 2026-11-04-zh-print-correct-pilot-7263.md"
---
## 2026-11-12 · Printed Chinese read by Gemini: the Opus correction is the route (decision record, #7263)

PRIOR ART: `2026-11-03-zh-gemini-reocr-cell-7263.md` (recommended gemini>opus over a Paddle re-read, print first) and `2026-11-04-zh-print-correct-pilot-7263.md` (the pilot, which missed its bar). Both were left `undecided`; this entry records what was decided after them. The Siku question that the 11-03 file also raised is carried by `2026-11-04-zh-siku-route-matrix-7263.md`, not here.

**What was decided.** On 2026-11-04 Derek released the bulk run on printed Chinese at one page a call, on the pilot's evidence (on written pages 47/52 accepted, 2/52 wrong-text; the 6 wrong-text pages of the full 60 include 4 where the stored Gemini text was left in place). It runs as `scripts/batch/zh-print-correct-7263/runner.mjs` under the systemd unit `sl-zh-print-bulk-7263`, with a per-wave breaker on apply refusals and a blind Opus check at 1,000 written pages (30 pages, stops under 24/30).

**What happened since.** The runner stopped at its breaker on 2026-11-04 15:14Z (wave 8, apply refused 45 of 100: 37 pages refused by the shared-words guard, 8 by the script guard; 606 pages finished, 340 written). Three of those refused pages were opened against their images on 2026-11-12: the corrections were right and the guard over-fired (two pages), and the "letters outside the book's scripts" were a Hangul scanner footer inside `<warning>` (one page). So the guard kept stored text, it did not let wrong text through. The runner was restarted 2026-11-12 22:00:45Z (job dec-lanes-90, #90); waves 9 and 10 wrote 77 and 91 of 100.

**How to stop:** `touch /mnt/HC_Volume_105839809/jobs/zh-print-bulk-7263/run/STOP` on main.
