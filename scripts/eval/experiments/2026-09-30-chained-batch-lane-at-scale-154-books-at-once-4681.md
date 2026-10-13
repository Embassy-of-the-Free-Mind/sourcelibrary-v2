---
stage: pipeline
measure: none
languages: []
scripts: []
canons: []
n_books: 154
n_pages: 3602
verdict: "154 books at once in shared Batch jobs: $0.00061 per written page, 5.4% of rounds cancelled (vs 16-18% one job per book), about 4,700 pages/hour at full concurrency."
status: adopted
decision: "Shared jobs (#5375), one fallback round (#5381) and auto-enrol (#5385) run in the chained cron; tick faults fixed in #5391, #5392"
superseded_by: null
issue: [4681, 5375, 5381, 5385]
---
## 2026-09-30 — Chained Batch lane at scale (#4681): 154 books at once in shared jobs — $0.00061/page, ~4,700 pages/hour at full concurrency, 5.4% of rounds cancelled

**Question.** Does the chained lane (2026-09-29 entry below) hold its price and guard rates when
it runs 150+ books at once, once one Batch job carries every ready book's round (#5375),
fallback pages go in one round (#5381), and books are enrolled by a selector (#5385)?

**Design.** Load test, not a quality claim (the prompt is production's, pinned byte-for-byte by
the unit tests; the judged quality sample is a separate brief). Cohort = `--enrol-auto --zero-only
--min-pages=25 --exclude-chinese --statuses=complete,images_complete`: visible, not held,
non-English, non-Chinese, OCR ≥ 90% of the book, no page translated (counted on pages), terminal
status only. Terminal only because a book-scoped envelope funds EVERY worker that asks the gate:
on the first cohort's envelope image extraction spent $2.80 against chained translation's $2.52
(fix: lane-restricted envelopes, #5389, hold). 160 selected, 154 enrolled (6 refused: the lane's
estimator priced them above pages × $0.0012), 3,721 pages queued, mostly 25–60-page Latin
pamphlets. Envelope `chained-zero-2026-10`, $6. One loop, under `flock /tmp/sl-translate-chained.lock`.

**Result** (153/154 runs complete at 1.2 h; the last is a tail run):

| | slice A (shared jobs, 154 books) | first cohort (a job per book, 24 runs) | pilot (5 books) |
|---|---|---|---|
| pages written | 3,602 of 3,721 (97%) | 3,207 | 847 |
| cost per written page (meter) | **$0.000609** | $0.00089 | $0.00056 |
| rounds cancelled by the API | **5.4%** (37/684) | 17.6% (184/1,043) | 16% |
| round latency p10 / median / p90 | 2.3 / 2.9 / 5.5 min | 4.4 / 5.0 / 7.0 min | median 2.7 |
| throughput | ~4,700 pp/h in the first 0.74 h; 2,960 pp/h over the whole 1.2 h, tail included | 217 pp/h | — |
| unhealthy (refused at the write) | 0.39% (14) | 0.77% | 6/913 |
| fallback pages (block discarded or short) | 7.8% of queued | 6.8% | — |
| discarded blocks / drifted rounds | 18 / 59 | 35 / 45 | — |
| parked runs | 0 | 0 | 0 |

- **Shared jobs cancel less.** 50-request jobs lost 5.4% of rounds; one-request jobs lost 16–18%.
  The API seems to cancel whole small jobs, not requests. Replicated? No: this is one afternoon.
- **Throughput is set by concurrency**, not by latency: a round takes ~3 minutes whatever the job
  carries, so pages/hour grows with the number of open books. At 150 books the first 45 minutes
  wrote ~3,500 pages. The long tail is books finishing their fallback rounds one at a time.
- **Two operational faults found and fixed during the run.** (1) The scoped spend gate costs about
  3 s per call; asked once per run, a 180-run tick spent about 9 min gating (#5391: once per tick).
  (2) A hand-run tick beside the loop re-submitted ~150 freshly enrolled runs 34 s after the first
  submit, orphaning the first jobs (~150 requests, about $0.5 unmetered: the placeholders stay
  `submitted`); #5392 claims a run atomically before submitting it.
- **The lane's estimator runs about 2× high**, so a per-run approval of pages × $0.0012 stops dense
  books early (7 runs topped up by $0.03). Calibrating it to the measured meter is a follow-up.

**Artifact.** `translate_batch_runs` (mode chained, books of scope `chained-zero-2026-10`), meter rows
`gemini_usage.endpoint = hetzner/translate-batch-chained`; #4681 comment 2026-09-30.
