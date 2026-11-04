---
stage: ocr
measure: [judged]
languages: [zh]
scripts: [Hani]
canons: []
n_books: 1
n_pages: 271
verdict: "Bulk Opus correction of the Gemini-read Chinese print pages is running on Derek's decision, not on a pass: the pilot missed its bar (51/60 accepted, bar 50; 6 wrong-text, limit 4). After 271 pages, all in the first book (道藏 695924fa1cac2ce31a4a8a33), 211 are written and 60 refused by apply's shared-words guard. There are no CONTAIN answers. The 1,000-page blind check (30 written pages, Opus judge, stop under 24/30) has not run yet; the runner runs it, comments on #7263 and pages ntfy."
status: undecided
decision: "Running on Derek's decision of 2026-11-04 despite the failed pilot. The runner stops itself if the 1,000-page check falls under 24/30, at the 3.44 account-week ceiling, or at 92% of team@'s week. current.json and the routing tables are untouched."
superseded_by: null
issue: [7263]
router_evidence: "none — this run exports no score; the route evidence is zh-gemini-reocr-7263.score.json"
defect_rates: "none — the 1,000-page check scores accepted and wrong-text pages only"
---
## 2026-11-04 · Bulk Opus correction of Chinese print pages, on a failed pilot (#7263)

**The pilot FAILED** (`2026-11-04-zh-print-correct-pilot-7263.md`: 51/60 accepted against a bar of 50, 6 wrong-text against a limit of 4). Derek answered yes to running the bulk anyway, on 2026-11-04. This record covers that run. It is a decision, not a pass.

PRIOR ART:
- `2026-11-04-zh-print-correct-pilot-7263.md` and `scripts/batch/zh-print-correct-7263/` (#8067): the frame, the runner and the writer are reused here, not rebuilt. This record adds what the pilot could not hold: the bulk's guards and the 1,000-page check.

### Setup

- Frame: the pilot's `frame.json.gz`, rebuilt into 20,618 writable owed pages in 180 true print books. Siku pages are out, and no page belongs to a zh-ditto-correct-5274 title. Books readers open first go first.
- Reader and writer: `correct.mjs --model=opus --per-call=1`, then `cli-ocr.mjs apply`. Each overwrite snapshots the page to `page_revisions`. Human-edited OCR is never touched. CONTAIN answers are listed, not written. Corrected pages do not set `translation_stale`, so they queue no paid Batch re-translation (checked in Mongo on the 5-page test wave).
- Spend: `claude -p` Opus on the team@ subscription, with $0 cash. The runner is a detached systemd unit (`sl-zh-print-bulk-7263`) whose ledger survives restarts. It stops at 3.44 account-weeks, which is 3.5 minus what the pilot's login used.

### What happened so far (2026-11-04 ~13:00Z)

| | |
|---|---|
| pages with a final state | 271 (waves 1–5, plus the 5-page test wave) |
| written | 211 |
| refused by apply (shared-words guard, "check by eye") | 60, all in 道藏 `695924fa1cac2ce31a4a8a33` |
| CONTAIN | 0 |
| list value / cash | about $25 over 196 calls / $0 |
| team@ weekly meter | 6% (login shared with other sessions, so this is an upper bound) |

**Breaker, wave 3.** Apply refused 17 of 100 corrections, all of them on one book, 道藏. I compared p.77 against its image by eye: the Opus reading is right, and the stored Gemini text is poor and shares too few words with it for the guard to pass. A refusal leaves the stored text in place, so it does no harm, but the breaker was stopping the whole run because of one book. The breaker now trips only when refusals spread across books. A book on which apply refuses over 40% of at least 20 pages is set aside instead (commit aef0e161f). On 道藏 the refusal rate stays around 20%.

**Pace.** The run started at about 340 pages an hour (3 at once, one page per call, about 30 s per call). By 12:30Z the median Opus call took 79 s and some took 400–730 s. The box load was 9–25 on 16 cores, with about 30 `claude -p` processes running box-wide. Throughput fell to about 20 pages an hour. At that rate the 1,000-page check is about a day away.

### Still to come

The runner runs `check.mjs` itself at 1,000 written pages: 30 written pages, the blind Opus judge from `confirm.mjs`, 4 wrong-page controls. Pass is ≥24/30 accepted with 0 controls accepted. On a pass it comments on #7263 and continues. On a fail it stops, comments and pages ntfy. Its result lands in the run directory as `check-1000/result.json`, and the #7263 comment is the record of it.
