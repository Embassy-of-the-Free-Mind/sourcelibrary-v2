# Statuses that lie, and the collector that never ran — 2026-08-08

Started as "how's the e-rara archiving?" and became: **we could not tell which books are
actually finished.** Four instruments all reported the library as more complete than it is.

## Shipped

| PR | What |
|---|---|
| #3707 (merged) | `scripts/audit/volume-gaps.mjs` — 315 multivolume series, 94 with interior holes |
| #3717 (merged) | Gemini batch collection on a Hetzner cron every 30 min + `--abandon-stale` |
| #3760 (open) | `archive-images` route persists `pages_archived` |
| #3765 (open) | Status-output guard at `setPipelineStatus` + `scripts/audit/status-output-drift.mjs` |

Issues filed: **#3708** (books have no volume field), **#3712** (archive route didn't record
its work), **#3740** (statuses ahead of the work; single-book completion is unreachable).

## The findings that matter

**Batch collection was never automated.** `cron/_archived/process-batches` was retired in
`45fb98fb` as "replaced by Hetzner workers" — for this one the replacement was never built.
Zero collector entries in the Hetzner crontab *and* in `crontab.production`. Every batch
submitted since then sat finished on Google's side until a human ran the script. Failure is
silent in the worst direction: a book paid for and OCR'd looks identical to one never
submitted; `pages_ocr` just stops advancing.

**The orchestrator launders failures into success.** Phase 7 writes `chapters_complete` from
three paths — chapters extracted, book under 10 pages, and extraction failed `MAX_RETRIES`
(`// Non-critical — skip`) — and the two skips only increment an in-memory counter. Phase 6
does the same in its `catch`: after `MAX_RETRIES` throws it writes `summary_indexed` and
counts the book as *enriched*. Measured across 58,635 text books: **28,263 past enrichment
with no summary, 27,867 past chapters with no chapters.** A status written ahead of the work
is worse than none — every phase selects on status, so the book is permanently *past* the
phase that would have filled it in, and nothing errors.

**Absence is not failure.** The naive guard (field non-empty) would re-stall ~28K books
permanently — a bigger outage than the bug. A single-work volume legitimately has no
chapters. So a status is satisfied by **output OR a recorded skip**, written at the moment
the phase decides, because that is the only moment the reason exists. #3765 ships in
**observe mode**; `STATUS_GUARD_ENFORCE=1` enforces once the recorded violations look right.

## Bekker Aristotle — done

All five Reimer 1831 volumes were held; two were unfinished, not missing. Vol III archived
762/762 and OCR'd (752pp), Vol V's gap closed (454pp). **$0.95.** Vol III repositioned to
`ocr_complete` with `requeued_from`/`requeued_reason` — its old `chapters_complete` was
fiction. It will not advance while `processing_control.paused: true`.

## Leiden manuscripts — in flight

104 visible books had page images but no text. **All 104 are intact facsimiles** — the
earlier "readers see an empty book" framing was wrong. No skip marker existed and only one
batch job had ever been created, so nobody could tell whether the skip was policy or
accident. That is #3740's argument on a real cohort.

Pilot (3 books, $0.06) verified against page images: Javanese preserved hyphenated
line-breaks; Jawi handled RTL order, `<gloss>`, rubricated `<insert>`; dense Arabic Naskh
matched a marginal line character-for-character including glossator signatures
(جلال, حفناوي). Handwritten Arabic script was expected to be the failure case and was not.

Pass 1: 101/101 books got text, 6,315/8,372 pages. **The 25% gap was my `--pages=200` cap** —
1,939 of 2,057 missing pages sit in the 8 books over it. Javanese looked weak (47%) only
because two of its seven books are 542 and 423 pages. **Pass 2 is running detached**
(41 books, 2,060 pages, ~$1.63, cap raised to 1,200, `--new-only` so nothing is re-billed).
Cohort total ≈ $8.30.

Runner + logs: `<scratchpad>/leiden-run.sh`, `leiden-run.log`, `leiden-done.txt` (resumable —
completed ids are skipped; failures are deliberately left out so they retry).

## Next

1. Verify pass 2 landed; spot-check a long book against page images (pilot only proved short ones).
2. Merge #3760, #3765 when green.
3. #3708 — the volume field. Not started.
4. Repair the 28K behind the budget dial (#3737), visible-first. Not started.
5. Gemini keys: Vercel's `GEMINI_API_KEY` is `type: sensitive` = **write-only**. It cannot be
   read by CLI, API, or dashboard, so removing it destroys the only copy. Keys were rotated
   overnight by another session; all three probe 200.

## Method notes

- Three times an aggregate nearly became a false claim: 25,244 "broken" books were artwork
  records (true: 344); 2,929 stuck jobs were 23 under the collector's real query; a
  `.limit(40)` hid a Bekker volume we hold. **Filter to the population the rule governs, and
  sample before reporting.**
- A clean collector log is not proof text arrived. Verify `pages_ocr` and pages holding real
  `ocr.data`, not the summary line.
