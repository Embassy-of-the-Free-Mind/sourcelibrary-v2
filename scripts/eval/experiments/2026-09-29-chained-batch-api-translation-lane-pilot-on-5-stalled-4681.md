## 2026-09-29 — Chained Batch API translation lane, pilot on 5 stalled books (#4681): production's prompt one block per round, 847 pages written at $0.00056/pg (4.3× under realtime), median round 2.7 min, 16% of rounds cancelled and all recovered

**Question.** Can the Batch API run production's translation loop — the chained seed, the
page-break device, the parse and health guards — rather than the unseeded-blocks-plus-seam-repair
design that lost on fidelity (2026-09-25, PR #5104; #5085)? A single job cannot chain, but the
27 shadow runs of 2026-09-24 round-tripped in 3–10 min, so the chain can run ACROSS jobs.

**Design.** `scripts/lib/translate-batch-chained.mjs` (branch `worktree-batch-chained-rounds`):
each round submits one block per book — the worker's `planBlocks` partition, seeded with the stored
translation of the page before it, built by `buildBlockTranslationPrompt` / `buildTranslationPrompt`
with `PAGE_BREAK_SCOPED` and the adjacent OCR. The unit tests pin the prompt byte-for-byte to what
the realtime builders return for the same inputs, so no judged A/B was run: this is an operational
pilot, not a quality claim. Pages a block did not return (short-block discard, drift, 15% truncation)
go single-page one per round, each seeded by the last. Dead job / errored request / block parsed 0 =
strike, same plan next round, 3 strikes park. Guards at the write: OCR hash, translated meanwhile,
`isTranslatablePage`, the health gate through `writePageTranslation`.

**Books (envelope chained-pilot-2026-09-29, $3, closed same day).** Five from the stalled cohort
(translation started, under 90%, not held, not English): Proclus *In Timaeum* (Latin, 121 pages
queued), Hasidic discourses (Hebrew, 61), Papus *Traité élémentaire de magie pratique* (French, 71),
Garcia de Orta *Aromatum* (Latin, 300 = the per-run cap), Theophrastus *Enquiry into Plants* (Loeb,
Greek with facing English, 300). Two other candidates (Avicenna *Canon*, *Glossa ordinaria*) were
refused at planning: every remaining page is `ocr-loop` — those are re-OCR work, not translation.

**Result.**
| book | written | rounds | strikes | short-block | drift | refused | round median |
|---|---|---|---|---|---|---|---|
| Proclus | 121/121 | 26 | 4 | 0 | 3 | 0 | 2.7 min |
| Hasidic | 61/61 | 17 | 4 | 0 | 0 | 0 | 2.9 |
| Papus | 71/71 | 12 | 2 | 0 | 0 | 0 | 2.9 |
| Garcia de Orta | 300/300 | 66 | 10 | 1 | 4 | 0 | 2.5 |
| Theophrastus | 294/300 | 83 | 12 | 3 | 1 | 6 | 2.7 |

172 successful rounds, 32 cancelled by the Batch API (16%; both shapes — `JOB_STATE_CANCELLED`
and `{error: "The operation was cancelled."}` inside a SUCCEEDED job; they cluster by submission
minute; $0 billed for them; every one recovered on the next round, no run parked). Latency over
all 172 rounds: median 2.7, p90 4.3, max 6.0 min. Measured from the Supabase meter rows
(endpoint `hetzner/translate-batch-chained`): 1,094,201 input + 454,525 output tokens,
**$0.4777 for 913 payload pages** ($0.00052/payload page; $0.00056 per written page) against the
realtime line's $0.00241/pg measured 2026-09-04 — 4.3×. Every written page carries the full
provenance block (api batch, call site, round, batch job, seeded context). The 6 refusals are the
production gates doing their job on a bilingual edition: 2 English facing pages collapsed to a
wrapper, 4 Greek pages caught by the echo gate. Hand-read seam (Proclus 524|525, the join between
a March 2026 realtime translation and the lane's first page): catchword consumed once, no
duplication. A crude alignment proxy flagged 70 odd pages of the Loeb — the facing-page structure
(the Greek page's translation matches the printed English opposite), zero flags on the other four.

**Not measured.** Fidelity against production on the same pages (by construction the prompt is the
same; a paired judge would measure model noise, see the A/A floors of 2026-09-25). Behaviour above
~100 books in flight: one job per book per round meets the 100-concurrent-jobs cap per key, shared
with the OCR lanes (keys 0 and 4 refused every submit with 429 during the pilot and rotation
absorbed it); grouping books into one job per round needs composite meter keys.

**Decision.** The seam-repair design (#4912/#4973 arm Et) is superseded; do not re-propose it. Next:
the stalled cohort (105 books / 13,970 pages) and the fully-OCR'd zero-translation cohort (280 books /
56,317 pages) through this lane under an envelope, ≈$40 at the measured rate; then the default-flip
question for the whole line.
