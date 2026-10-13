# Pipeline next step: one function says what happens to a book next

PRIOR ART: `.claude/docs/invariants/pipeline-status-truth.md` covers status claims that run ahead of the work, holds, and the finalize rule. It guards individual writes. It has no derived state, no exits for blocked books, and no lane table. `scripts/lib/finalize-decision.mjs` (`decideFinalize`) is the closest code. It decides one transition, finalize, with its own denominator (`pages_ocr / pages_count`, done at 50%). `scripts/audit/status-output-drift.mjs` checks status against output for five statuses, sampled. `scripts/lib/reenroll-eligibility.mjs` and `requeue-untranslated-complete.mjs` are hand re-entries, one graveyard each. `pipeline-phases.md` and `pipeline-architecture.md` describe the phases as they are written. Sibling design docs: `translation-state.md` (#3402) and `page-counts.md` (#5325). This doc consumes both.

Revision 2 adds the standing driver, budgets, alarms and the quality gate. Their prior art lives outside the repo:
- the hand-built wave drivers `/root/readable-20k/driver.mjs`, `/root/translate300/driver.mjs` and `/root/preview-stubs-4719/driver.mjs`, which are copies of one another
- the per-run envelopes in `set-scope.mjs`
- the spot-check protocol in the `translate-next-5467` job brief

And inside it:
- `scripts/workers/pipeline-health-alert.mjs`, a daily email with no ntfy
- `OCR_TRUST_TABLE` in `scripts/lib/ocr-trust-gate.mjs`, a routing-shaped table already kept as data
- `.claude/docs/ocr-engine-routing.md`, the evidence the routing table would hold

**Read this when:**
- you are writing a phase selector, a lane or a driver
- you are adding a `pipeline_auto.status` value
- you are parking or refusing a book anywhere (`needs_attention`, `failed`, `parked`, a quarantine, a `refused.txt`)
- you are opening a budget envelope for line work, or hand-driving books through the line
- you are changing which OCR engine reads a language
- someone asks "why isn't this book moving?" or "what is the line working on?"

**Status:** design.
- Revision 1 is dated 2026-10-01 (PR #5471).
- Revision 2 is dated 2026-10-04. It was prompted by one day of running translation by hand (the #5469 comment of 2026-10-04).
- Tracking issue is #5469, under the consolidation program #5302.
- Landed: the step 0 fixes (#5484) and steps 1, 2 and 4 (#5493, #5604, #5608). `books.pipeline_next` is stamped every 2 h, and the daily audit has run since 2026-10-02.
- **No lane selects on `pipeline_next` yet.**
- Every number below is measured and dated where it is quoted.

**Owner:** the #5469 tracking issue, which Derek owns. Each migration step names its owner when it is claimed. The doc changes only by PR, and the rule is versioned by `PIPELINE_NEXT_VERSION`.

---

## The ideas in plain words

- **Next step:** for each book, one stored answer to "what happens next". The answer is one of: fetch the images, transcribe, translate, enrich, extract images, nothing, or blocked.
- **Blocked reason:** when nothing can happen, why not. It comes with when the book will be checked again and who owns it.
- **Exit:** the condition that unblocks a book. Every blocked reason has one, so no book is parked forever by default.
- **Lane:** a piece of code that does one step for some books, such as the chained Batch translator. Lanes are listed in `scripts/lib/lanes.mjs`.
- **Driver:** the loop that picks the next books for a lane and hands them over. Today a driver is copied by hand for every run. In this design there is one standing driver per step.
- **Queue rank:** the order in which a driver takes books. It is written down as data, so anyone can read it and change it.
- **Lane budget:** the money one lane may spend per day. It replaces opening a new envelope for every run.
- **Envelope:** a separately funded pot for a named project, such as an eval or a partner cohort. Envelopes survive for projects only.
- **Quality gate:** a standing spot-check by eye every N books. If it fails, new enrolment stops.
- **Audit:** a daily recompute that compares the stored answers with fresh ones and goes red when they disagree.

---

## Who asks "what happens next", and what goes wrong for them

1. **A reader** opens a book that shows 25 of 300 pages. They take it as a curatorial choice ("they hold it but didn't translate it"). In fact the line dropped it. Nothing on the page looks broken, so nobody reports it. This is the costliest failure, and it is invisible.
2. **Derek**, seated, with five minutes. He asks: what is running, what is stuck, what does the rest cost, and do I have to build the next run by hand? On 2026-10-04 the answer to the last question was yes. Each run was a `sed` copy of a driver, an envelope, and a cron that waits for a DONE file.
3. **An operator months from now** asks "why isn't book X moving?" The answer must come from one field, `books.pipeline_next`, and one page, `/admin/pipeline?book=<id>`. It must not take reading five worker files.
4. **The workers themselves.** Every lane should select from the same derived value, so two lanes never disagree about a book. On 10-04 one run refused 10 books because "the realtime lane owns the book", and 36 because "an open run already has it".

## Why this exists

Each phase selects books by `pipeline_auto.status`. More than a dozen writers set that label. It records what a writer decided at some past moment, not what the book is now.

**Measured 2026-10-04 06:45Z** (ops_reports `pipeline-next-2026-10-04`). The denominator is the 96,198 books with `pages_count > 0`. Of those, 42,072 are live (`visible: true`).

| shape | all | live | what it means |
|---|---:|---:|---|
| `terminal_but_actionable` | 35,527 | 26,265 | The status is one no phase selects (`complete`, `needs_attention`, `failed`, `parked`…), but the book has work left. |
| … `complete` → `ocr` | 5,494 | 5,203 | "complete" with most pages never transcribed (#4719) |
| … `complete` → `translate` | 4,044 | 3,835 | "complete" with translation left |
| … `complete` → `images` | 8,626 | 7,710 | Inflated: `images_done_at` has only been stamped since #5493. |
| `needs_attention` → `ocr` | 7,727 | 2,835 | OCR-able books in a graveyard |
| `recheck_overdue` | 10,171 | 4,383 | Blocked books past their re-check, because no re-check scheduler exists yet (#5479). At 16:30Z: held 10,462, `source_unreachable` 1,025. |
| `translate_selector_empty` | 1,934 | 1,758 | The step is `translate`, but by counters every OCR'd page is already translated, so the lane finds nothing. Hidden gap pages live here (see below). |
| stored vs recompute | 25 disagree | | All 25 are fresh (written after the 06:25 stamp pass). 0 are stale. 7 books are unstamped. |

**What the line has left to do**, by step, from the same report. "Pages left" means pages still to do at that step, by counters.

| step | all books | live books | live pages left | reason (live) |
|---|---:|---:|---:|---|
| `ocr` | 43,062 | 12,188 | 1,744,130 | `transcribing` 12,097 · `no_text` 91 |
| `blocked` | 14,661 | 8,624 | n/a | `held` 8,623 · `source_dead` 1 |
| `images` | 9,161 | 7,893 | n/a | inflated (see above) |
| `translate` | 12,354 | 4,995 | 109,930 | `tail` 4,545 · `body` 450 |
| `enrich` | 4,714 | 3,878 | n/a | summary + chapters 2,788 · chapters 823 · summary 267 |
| `archive` | 11,044 | 3,444 | 287,883 | `images_missing` |
| `done` | 1,202 | 1,050 | 0 | `finished` 954 · `not_a_text` 96 |

### New in revision 2: what one day of hand-driving showed (measured 2026-10-04)

**1. Refusals are terminal, and they hide missing inputs.**
- Two drivers kept refusal files: `/root/translate300/refused.txt` (445 rows) and `/root/readable-20k/refused.txt` (187 rows).
- Reasons: `nothing-to-translate` 559, `open-run` 36, `ocr-untrusted` 27, `realtime-lane-owns-book` 10.
- I recomputed the next step today for those 632 books. **523 still read `translate`.** In each case the refusal knew something the function did not.
- The rest have moved on: enrich 70, images 18, done 14, held 7. Their refusal is stale but harmless.
- None of the four codes is a property of the book:

| refusal code | what it actually is |
|---|---|
| `open-run`, `realtime-lane-owns-book` | The book is in flight, but the function does not read `translate_batch_runs`. |
| `ocr-untrusted` | The OCR-trust gate (#5700), which the function does not read. |
| `nothing-to-translate` | The counters disagree with the lane's page selector. In the #5467 diagnosis, 34 of 50 books had *gap pages*: 8–12% of their pages had no usable OCR (`ocr: {}`, empty data) that the counters still counted. |

Gap-filling only the missing pages made **241 books readable for ≈ $6.70** (gapfill-5326b, 2026-10-04).

**2. Gap pages hide in two places.** The table shows live books at `ocr`, by how much is transcribed. Pages left = whole − `pages_ocr`.

| OCR coverage | live books | of which status `complete` | pages left |
|---|---:|---:|---:|
| preview only (≤ 30 pp) | 10,615 | 4,400 | 1,411,824 |
| 30 pp – 50% | 486 | 49 | 197,395 |
| 50–80% | 199 | 79 | 33,026 |
| **80–90% (gap)** | 102 | 51 | 7,358 |

Those 102 books are the visible gap. The **invisible** gap sits inside `translate_selector_empty` (1,758 live books). Their `pages_ocr` counts pages whose OCR is empty, so the ladder reads `transcribed` and the step reads `translate`. `recountBook()` (#5325/#5326) is what makes them visible as `ocr: gap`.

**3. Every run is hand-built, and so is its budget.**
- `processing_control.allow_scopes` holds **40 envelopes**. All 40 carry a budget, and 17 are restricted to a lane.
- **10 are SPENT and still open.** The oldest is 33 days old.
- Envelope spend is attributed by **book id**, not by lane, so one dollar shows up in several envelopes. `stubs4719-ocr-2026-10` and `stubs4719-translate-2026-10` both report **$158.83** on the same 13,015 books.
- `translate300-2026-10` ($182.40 of $300, 1,403 books) overlaps the readable20k envelopes.
- Line-work envelope spend since 2026-10-01 is **≤ $476**: readable20k translate $75.41, readable20k OCR $31.03, stubs4719 $158.83 (counted once), translate300 $182.40, gapfill $3.74, chained-zero $24.17. Because of the overlap, this is an upper bound.
- The global dial is $5/day, so every paid run today is an envelope.

**4. Drained pools are silent.**
- `/root/readable-20k/driver.log` has logged `eligible=0` every 10 min since 2026-10-03, with 210 of its books awaiting OCR.
- `/root/translate300/driver.log` has logged `eligible=0 awaiting_ocr=7` since 15:20Z on 10-04. Its stop rule needed 0 books awaiting OCR, so it would have held the next run until its STOP date, 2026-10-25.
- Nobody was told.

**5. Holds are being used as policy.** Live held books by hold reason at 06:45Z:

| hold reason | live books |
|---|---:|
| `paddle-zh-5600-ocr-only` (SKQS, waiting for the Paddle lane) | 6,225 |
| `tibetan-retranslation-awaits-derek` | 1,433 |
| `ocr-untrusted-5700` | 441 |
| `ia-wrong-leaf-4790` | 150 |
| `syriac-retranslation-awaits-derek` | 81 |
| `ndl-koten-lane-4925` | 77 |
| `ia-free-text-first-4966` | 75 |

Most of these mean "no approved lane yet" or "a gate refuses". Those are blocked reasons with exits, not named books someone remembered.

**6. What the queue holds** (live, 16:30Z):

| step | live books | ≤ 20 pages left | 21–100 | > 100 | first translations | read at least once | priority ≥ 90 |
|---|---:|---:|---:|---:|---:|---:|---:|
| `translate` | 5,039 | 4,648 | 232 | 159 | 1,246 | 2,844 | 315 |
| `ocr` | 11,402 | 1,578 | 2,900 | 6,924 | 364 | 1,124 | n/a |

## The function

```
nextStep(book) → { step, reason, in_flight, recheck_at, owner }

step ∈ archive | ocr | translate | enrich | images | done | blocked
```

**The function is pure.** It reads only stored fields on the book document, so a full-corpus pass is one projection scan and needs no `pages` reads. It lives in `scripts/lib/pipeline-next-step.mjs` and is pinned by `tests/unit/pipeline-next-step.test.ts`. No request path computes it; `/admin` reads the stored field. If a TS twin is ever needed, it gets a parity test.

### Inputs

Rows marked **v2** are new in revision 2. Each one is stamped by its owner, which keeps the function pure.

| input | field | owner |
|---|---|---|
| reading progress | `translation_state.rung`, `.english_original` | `translation-state.md`, sync-worker |
| archive progress | `pages_archived / pages_count` | `page-counts.md`, `recountBook()` (#5325) |
| translatable pages left **v2** | `pages_translatable − pages_translated` | `recountBook()`. sync-worker has written `pages_translatable` since #5486 (2026-10-04). |
| usable OCR **v2** | `pages_ocr`, counting only pages with non-empty OCR text | `recountBook()`. Until the recount counts this way, gap books read `translate`. |
| source health | `pipeline_auto.archive_verdict`, `.archive_confirm` | archiving watchdog (#4611, #5462) |
| hold | `pipeline_auto.hold` | `pipeline-hold.mjs`. **A hold is a named decision about named books.** Policies move to the rows below. |
| OCR route **v2** | `ocr_route: { engine, lane, lane_status, row }`, stamped from the routing table | the routing table (below), stamped by sync-worker |
| OCR trust **v2** | `ocr_trust: { row, ok, reread_share, at }` | `ocr-trust-gate.mjs`. It reads pages, so it stamps the result on the book instead of being called. |
| in flight | the open `jobs` row named by `book.job`, **or (v2) a `translate_batch_runs` row not in a terminal phase** | the lane that dispatched it |
| progress memory | `pipeline_auto.attempts[step] = { n, last_at, last_progress }` | `stampNextStep`, when a step is re-issued without progress |
| refusal **v2** | `pipeline_next.refusal = { step, code, at, fingerprint }` | the lane that refused (below) |
| distill output | `summary`, `chapters`, or `pipeline_auto.<stage>_skipped_reason` | `STATUS_OUTPUT_CLAIMS` predicates, unchanged |
| images output | `pipeline_auto.images_done_at` or `images_skipped_reason` | image collectors (#5493) |

### Rule, first match wins (version 2)

1. `rung = no_pages`, or `content_type = artwork` → **`done`** (`not_a_text`).
2. Hold marker present → **`blocked: held`**. The exit is the hold's issue and its release condition.
3. A job or batch run is open → keep the step that dispatched it, with `in_flight: true`. No lane may select an in-flight book. **v2:** open `translate_batch_runs` count as in flight, which removes the `open-run` and `realtime-lane-owns-book` refusals.
4. Archive below 90% **and** rung below `transcribed` → source health decides:
   - `dead` → `blocked: source_dead`
   - `restricted` → `blocked: source_restricted`
   - unreachable or unconfirmed → `blocked: source_unreachable`
   - otherwise → **`archive`**

   A book that already has its text never waits on its images.
5. Rung below `transcribed`, and the route's lane is not `standing` → **`blocked: ocr_policy`**. The owner is the issue on the routing row. **v2** reads `ocr_route`. Today's policy holds land here: SKQS → Paddle (#5600), cursive Japanese → NDL (#4925), Tibetan → Yigdzin, Syriac → Kraken.
6. Rung `no_text` or `transcribing` → **`ocr`**. The reason says how much is left: `no_text`, `preview` (≤ 30 pages done), `partial`, or **`gap`** (≥ 80% done, so only the missing pages need OCR). If the last two OCR issues added no pages → `blocked: ocr_stalled`.
7. **v2:** not `english_original`, rung `transcribed` or above, and `ocr_trust.ok === false` → **`blocked: ocr_untrusted`**. The exit is the re-read share reaching `RELEASE_SHARE` (0.9). This replaces the `ocr-untrusted-5700` hold.
8. Not `english_original`, and rung is `transcribed`, `translating` or `readable`:
   - **v2:** if no translatable pages are left, the ladder and the lane disagree:
     - pages without usable OCR → **`ocr: gap`**
     - otherwise → **`blocked: translate_refused`**. The pages are excluded by health (collapsed, loop). The exit is a prompt or model change, or else 90 days.
   - otherwise → **`translate`**, `body` (`transcribed`/`translating`) or `tail` (`readable`). Lanes rank tail after body.
9. **v2:** a refusal is recorded for this step and its `fingerprint` still matches the current inputs → **`blocked: refused:<code>`**. The exit is any change in the fingerprinted inputs (see below).
10. No summary or chapters, and no recorded skip → **`enrich`**.
11. No images stamp, and no recorded skip → **`images`**.
12. Otherwise → **`done`**.

Cover selection and finalize are not steps. They are bookkeeping inside `images` and `done`. `done` is recomputed on every pass, so a book cannot be finalized ahead of its OCR. When a re-OCR or a recount changes the inputs, the book leaves `done` by itself. That reopening is deliberate. It is also why cutting a lane over is actuation (see "Spend").

### One denominator

- Finalize, gap-fill and the reader each used a different denominator.
- `nextStep` reads only two things: the rung, which carries the ladder's denominator, and (from v2) the lane's own count of translatable pages left.
- Where those two disagree, rule 8 names the wrong input: `ocr: gap` or `translate_refused`. A lane no longer has to rediscover the problem by refusing.
- **A `complete` status with OCR coverage below the bar becomes impossible.** No writer has to check it. Status simply becomes a cache of `step = done` (migration step 6).

## Blocked reasons: every one has an exit

A blocked book carries `reason`, `recheck_at` and `owner`. The re-check is a cheap, scheduled re-evaluation and never pays for model work. **No reason exists without an exit.** The states `failed`, `parked`, `paused`, `needs_attention` and `loop_quarantine_hold` are retired. Their books land in one of the rows below, or become actionable again.

| reason | where it lives today | re-check | exit | owner |
|---|---|---|---|---|
| `held` | `held` status + marker | daily (`pipeline-hold-drift.mjs`) | the hold's release condition | the issue on the marker |
| `source_unreachable` | `needs_attention`, stalled `archiving` | 24 h, backing off to 7 d | The probe answers → `archive`. 3 confirmed 404/410 answers → `source_dead`. A timeout never confirms a death (#4611, #5462: 709 of 721 "gone" books were alive). | archiving watchdog → `pipeline-recheck` |
| `source_dead` | `archive_verdict: dead` | 30 d | the probe answers, or an alternate scan is imported under the same `work_id` | #5462 |
| `source_restricted` | IA lending / printdisabled | 90 d | access opens, or an alternate edition turns up | #5462 |
| `ocr_policy` | **policy holds** (SKQS 6,225 live, NDL 77, Tibetan, Syriac), `parked` (kuzushiji) | when the routing table changes | a row for that cell gets `lane_status: standing` | the row's issue |
| `ocr_stalled` | `needs_attention` "OCR stalled", `loop_quarantine_hold` | when the engine or prompt version changes, else 90 d | A new engine adds pages. Pages that will never transcribe get an `ocr_refused_reason` and leave `whole`. | OCR lane |
| **`ocr_untrusted`** (v2) | hold `ocr-untrusted-5700` (441 live), refusal `ocr-untrusted` | when a re-read lands or the trust table changes | re-read share ≥ 0.9 by a trusted reader | #5700 |
| `translate_refused` | `failed` after MAX retries, quarantine, `nothing-to-translate` with no gap | when the translation prompt or model changes, else 90 d | the remaining pages are excluded one by one, each with a reason, so the book reaches `readable` honestly | translate lane |
| **`refused:<code>`** (v2) | `refused.txt` files | **when the fingerprint changes** (event-driven), else 7 d | the inputs change, so the refusal no longer applies | the lane that refused |
| `split_review` | `needs_attention` "Split review needed" | when the review queue is worked | a human decision is recorded | review queue |
| `needs_human` | everything else | weekly digest | a human records a reason from this table | ops |
| `unstamped` | (none) | 2 h | sync-worker stamps `translation_state` | sync-worker |

`needs_human` is the only reason without an automatic exit. The audit fails if it holds more than 100 live books.

**A transient error is not a state.** A failed dispatch increments `attempts[step]` and backs off, and the book keeps its step. After N failures with no progress, the book takes the step's `*_stalled` or `*_refused` reason, along with that reason's exit.

### Refusals become recorded reasons that clear themselves

A lane may still refuse a book at enrol time, because it knows things the function does not, such as a page-level check. When it refuses:

1. **It records the refusal on the book, not in a file.** It writes `pipeline_next.refusal = { step, code, at, fingerprint }` through one helper, `recordRefusal(db, bookId, step, code)` in `pipeline-next-step.mjs`. It also logs one `book_events` row per (book, code), the pattern `recordOcrTrustRefusal` already uses. **There is no `refused.txt`.**
2. **The fingerprint is a short hash of the inputs a refusal can depend on:**
   - `pages_ocr`
   - `pages_translatable`
   - `pages_translated`
   - `ocr_trust.reread_share`
   - the translation prompt version
   - the routing row version
3. **On every stamp, rule 9 compares the stored fingerprint with the current inputs.** If any input moved, the refusal is dropped and the book is offered again. Nobody has to notice. If nothing moves, the fallback re-check is 7 d.
4. **A refusal code that recurs is a missing input.** The audit's `refused_unexplained` shape counts refusals by code. Any code with more than 50 live books becomes a rule-change issue. This is "a rule broken twice becomes a check", applied to the function itself. Today's four codes became inputs in v2 exactly this way.

## The lane table

The registry is `scripts/lib/lanes.mjs` (#5480, landed). It holds one descriptor per lane. A coverage test fails when a scheduled script writes `books` or `pages` without being registered. `/admin/pipeline` renders the registry beside the daily step counts. It is not repeated here; the file is the source of truth.

The rules the registry enforces are unchanged from revision 1:
- **One lane per (step, cohort) wins.** `translate` goes to the realtime lane for priority ≥ 90 and to the chained lane otherwise, with tail after body. Gap-fill is `translate` with `tail`, or `ocr` with `gap`. It is not a lane.
- **Every lane declares `respectsHold`, `respectsPause` and `budget`.** A `false` needs a reason. `gap: true` marks a known gap.
- **Budget is a lane property, never a book state.** A closed budget leaves the book's step standing, and the lane idles. `/admin/pipeline` says so.

## The standing driver (new in revision 2)

**One driver per step, always on, never copied.** `scripts/workers/pipeline-driver.mjs --step <step>` runs on the scheduler every 10 min. It replaces the per-run drivers (readable-20k, translate300, preview-stubs-4719), their `DONE` files and their chain scripts.

Each tick:

1. **Read-path check first.**
   - Load the candidates: `pipeline_next.step = S` and not `in_flight`.
   - **Recompute `nextStep` in process** for each candidate (the function is pure and the projection is cheap) and compare it with the stored stamp.
   - Act only where the two agree and the stamp's `version` is current. Log each disagreement as `stale_on_read`; the audit counts them.
   - The driver never acts on a stamp it has not just re-derived. (CLAUDE.md: put the check on the READ side.)
2. **Gates.** The lane's budget must be open, its pause off, and its quality gate not `NO-GO` (below). If any of these fails, the driver writes a tick and idles. It does not fail.
3. **Rank** the candidates by queue rank (below). Take up to `room = lane.max_open − open runs`.
4. **Enrol** through the lane's existing entry point:
   - translate: the chained `--enrol` path
   - OCR: Phase 2 re-entry, or `bulk-reocr-local --page-ids-file` for `gap`

   The driver adds no new writer of pages.
5. **Record refusals** with `recordRefusal`, never in a file.
6. **Write one tick row** to `pipeline_driver_ticks`: `{ step, at, candidates, stale_on_read, eligible, enrolled, refused_by_code, open, budget_left, gate }`. The alarms and `/admin/pipeline` read this row.

**The driver never finishes.** "Done" means an empty queue, which raises an alarm. There is no DONE file. "Start the next run when this one ends" becomes the queue simply continuing.

### Queue rank: priority as data

`scripts/lib/queue-rank.mjs` exports an ordered list of tiers, plus a tiebreak. Each tier is a predicate with a reason string. The driver sorts each book by the first tier it matches, then by the tiebreak. `/admin/pipeline` shows the top 50 with the tier each one matched, so the page can answer "why this book before that one?"

The default order is the one already used and approved for the translate-next-5467 run. Adopting it changes nothing Derek has already seen.

| tier | predicate (stored fields only) | why |
|---|---|---|
| 0. asked for | `processing_priority ≥ 90`, or a reader translation request | Someone is waiting. Today this goes to the realtime lane. |
| 1. mission core | in a core-wing collection (alchemy, Hermetica, Kabbalah, Rosicrucianism, early modern science) | the library's reason to exist |
| 2. reader demand | `read_count > 0`, or linked from a collection page | Someone already opened it (2,844 of 5,039 live `translate` books). |
| 3. cheapest to finish | estimated cost to `readable` (pages left × unit price, `pipeline-unit-prices.mjs`) | Readers gained per dollar: 4,648 live `translate` books have ≤ 20 pages left. |
| 4. first translation | `is_first_translation` (the `first-translation-claims.md` rules apply) | English that does not exist anywhere else |
| tiebreak | body before tail, then fewest pages left | |

A cohort that must go first (a partner collection, a deadline) gets a **queue boost**: a named tier with an expiry, inserted by one versioned config write. It does not get its own envelope or its own driver.

### One budget per lane

The budget is `processing_control.lane_budgets.<step> = { usd_per_day, by, at }`, written with versioning like `set-scope`.
- **The spend guard checks a lane's measured spend against that lane's budget.** Spend is attributed by **gate label**, meaning the lane that asked, not by book id. A dollar therefore counts once, which ends the stubs4719 double count.
- **The global dial stays as the ceiling over the sum.** With every lane budget at 0, behaviour is exactly what it is today.

**Envelopes survive for genuinely separate projects.** An envelope is the right tool when the work is **not the line's next step for those books**. Examples:
- an eval with paired arms (`eternity-ab`, `quality-round-1`)
- a re-translation under a new prompt (`tibetan-retranslation-4523`)
- a specialist lane pilot (`tengyur-full-5497`)

The test: if the driver would do this work for these books anyway, it is a lane-budget raise or a queue boost, not an envelope.

From revision 2, every envelope carries `purpose`, `issue` and `expires_at` (default 30 days). A daily sweep **removes the permission** of any envelope that is SPENT or expired, and keeps its revision record. The 10 SPENT-but-open envelopes are the measured reason for the sweep.

## Alarms (new in revision 2)

`scripts/workers/pipeline-alarms.mjs` runs every 15 min. It reads the driver ticks, the daily snapshot and the spend meter, and pushes to **ntfy topic `sourcelibrary-uptime`**. It pushes **once per state change** (the `traffic-anomaly-alert.mjs` pattern), with a one-line cause and the `/admin/pipeline` link. It spends nothing.

| alarm | fires when | what it would have caught on 2026-10-03/04 |
|---|---|---|
| `queue_drained` | A lane with an open budget had eligible books and now has 0 for 3 consecutive ticks. The message names the top blocked reasons among that step's books. | readable-20k at `eligible=0` for 4+ h, unnoticed |
| `lane_silent` | Eligible books exist, the budget is open, the pause is off and the gate says GO, yet nothing has been enrolled for 3 ticks or no output (pages written by the lane) has appeared for 6 h. | the copied driver's stop rule waiting on 7 un-OCR'd books |
| `batch_unwatched` | A submitted batch (OCR or translation) is older than 36 h with no collection. Gemini expires batches at 48 h. | gapocr-5467's batch, collected three days late |
| `spend_stalled` | The budget is open and the queue non-empty, but the lane's spend over the last 6 h is under 5% of its pro-rata budget. | a lane paying for nothing while books wait |
| `alarm_heartbeat` | The alarm worker's own state row is older than 1 h. **The daily audit reads this one and goes red**, so a dead alarm process cannot hide behind silence. | (new) |

`pipeline-health-alert.mjs` keeps its daily email checks. Its check 5, translation throughput stall, becomes `lane_silent` and leaves the email.

## The standing quality gate (new in revision 2)

Spend happens at enrolment, so the gate stops enrolment, not spend after the fact.

- **Cadence.**
  - For each paid step (`ocr`, `translate`), the driver counts books that crossed a rung through that lane since the last gate.
  - The gate is `due` at **300 books or 7 days**, whichever comes first.
  - The driver keeps enrolling for a grace of 100 more books. After that it idles with `gate: overdue`. **A missing check fails closed.**
- **The check.**
  - A headless session runs the fixed protocol from translate-next-5467 STEP 1. It reads 10 books, drawn with a seed and stratified by language, and a run of 3 consecutive pages from each.
  - For each page it reads the image, the OCR and the English side by side. It labels every claim "read from image" or "read from text".
  - It checks page fidelity, text imported from neighbours, text invented on blank or short pages, names and numbers, and untranslated chunks.
  - It also runs mechanical screens over **every** page in the window: empty, collapsed or looping, wrong output language, length-ratio outliers.
  - The check costs $0 in model spend, because the session runs on the subscription.
- **The record.** One `quality_gates` row: `{ step, window, sample_ids, verdict: GO|NO-GO, failure_classes, by, at }`. Failure classes come from `page-error-taxonomy.md`.
- **NO-GO.**
  - The verdict sets `lane_budgets.<step>.enrol_paused = { gate_id, at }`.
  - In-flight work finishes, but nothing new enrols. ntfy fires.
  - Resuming needs a **human-recorded GO** that names the fix.
  - A NO-GO class that recurs becomes a detector (`measurement-instruments.md`).
- **Limits.** 10 books per window catches common failure classes, not rare ones. The gate is a brake on systematic failure, not a certification. Its sample ids are public in the row, so anyone can re-check them.

## Engine routing as data (new in revision 2)

**Today, routing is code.** The policy lives in `OCR_LITE_ONLY`, `FLASH_OCR_FROM` and the language carve-outs in `scripts/lib/ocr-routing.mjs`, plus the specialist lanes. When GLM-OCR beat lite on English 1600–1699 (#5660), acting on that verdict took a new job with its own writer and guards.

**The routing table becomes one data file,** `scripts/lib/ocr-routes.json`. Each row is one cell:

```
{ language, period, hand, engine, lane, lane_status: standing|pilot|none,
  grade: exploratory|directional|decision, evidence: [issue/PR], since, decided_by, version }
```

- **The router reads the rows.** `ocr-routing.mjs` takes the first matching row. A final catch-all row holds today's default, lite.
- **The scattered settings become rows or references.** `OCR_LITE_ONLY` and `FLASH_OCR_FROM` become rows. `OCR_TRUST_TABLE` names its trusted readers by the same engine names. `.claude/docs/ocr-engine-routing.md` becomes this table's evidence column instead of a parallel list.
- **sync-worker stamps `ocr_route` on each book from the table.** That stamp is the input to rule 5.
- **A bench verdict becomes a one-row PR.**
  - It is still `tier:hold`, because a route moves spend.
  - It needs no new code, job or writer.
  - Bumping the row's `version` changes the fingerprint of every refusal that row governs, so those refused books are re-offered automatically.
- **The migration step changes no behaviour.** A parity test routes a fixed 5,000-book sample through both the old code and the table, and requires identical engines.

## Stored shape and the single writer

```
pipeline_next: {
  step: 'ocr', reason: 'gap', in_flight: false,
  recheck_at: null, owner: null,            // set for blocked
  refusal: null,                            // v2: { step, code, at, fingerprint }
  inputs: { rung, archived, verdict, hold, job, route, trust, left_translatable },
  version: 2,                               // rule version; a bump restamps on the next pass
  computed_at: ISODate
}
```

- **The writer is `stampNextStep(db, book)`.**
  - sync-worker calls it every 2 h.
  - Collectors and dispatchers call it when they open or close a job.
  - `recordRefusal` is the only other writer, and it writes only `refusal`.
- **`pipeline_auto.status` becomes a cache at step 6.** Until then it is written as it is today, and the audit compares it with the step.
- **New fields are registered.** `ocr_route`, `ocr_trust` and `pipeline_next.refusal` go in `books-known-fields.json` with `book-docs.mjs` strings (`field-sprawl.md`). The legacy fields leave at step 7.

## The audit

`scripts/audit/pipeline-next-step-audit.mjs` (#5604) runs daily at 06:45 UTC. Exit 1 means FAIL, which files or updates one issue. The revision 1 shapes, controls and fixed denominator are unchanged. Revision 2 adds:

| shape | definition | FAIL when |
|---|---|---|
| `refused_unexplained` | live books with `refusal` set, counted by code | any code above 50 live books for 7 days (a missing input) |
| `refusal_stale` | `refusal.fingerprint` no longer matches the inputs, yet the stamp still says blocked | > 0 after one stamp pass |
| `inflight_run_unseen` | an open `translate_batch_runs` row exists, but `in_flight: false` | > 0 |
| `gap_hidden` | step `translate`, translatable pages left ≤ 0, and pages without usable OCR > 0 | informational until #5326 lands, then > 0 |
| `policy_as_hold` | held books whose hold reason names a lane or a gate | informational; tracks the move from holds to reasons |
| `step_with_no_lane` | live books at a step where `lanes.mjs` has no unpaused lane for their cohort | any live book (the registry now exists) |
| `stale_on_read` | driver ticks in the last 24 h where the stored stamp disagreed with the in-process recompute | above 1% of candidates |
| `envelope_spent_open` | envelopes that are SPENT or past `expires_at` but still grant permission | > 0 once the expiry sweep lands |
| `alarm_heartbeat` | the alarm worker's state row is older than 1 h | always |

The positive control (perturb one stamp in memory) runs on every audit. The negative control (stamp a wrong step on a hidden test book and watch the audit go red) is recorded once per new shape, in that shape's PR.

## Spend: cutting a lane over is actuation

The graveyards hold tens of thousands of books that *should* get OCR or translation, and today's selectors cannot see them. A driver that selects on `pipeline_next.step` sees them all at once.

**So each cutover is a decision to spend.** It needs an estimate, and Derek's yes when the estimate is above the floor.
- The lane budget paces the spending.
- The cutover decides *what the budget spends on*.
- The estimate is pages left × the unit price for the step's cohort (`pipeline-unit-prices.mjs`, `/admin/pipeline`).

## Migration, ranked

The order runs from smallest risk to largest:
1. read-only computation and audits
2. selector moves
3. spend
4. deletion

**Hold** marks a step that writes data from a cron or moves spend. Its decision row goes to Derek. Steps 0–7 come from revision 1. R1–R8 are new in revision 2 and slot in before the cutovers.

| # | step | issue | state | risk / hold |
|---|---|---|---|---|
| 0 | enrich-worker field mismatch; per-phase pause ids | #5472 | landed (#5484) | n/a |
| 1 | `nextStep()` + `stampNextStep()`, observe only | #5477 | landed (#5493) | n/a |
| 2 | daily audit + flow snapshot | #5478 | landed (#5604) | n/a |
| 4 | lane registry, `/admin/pipeline` | #5480 | landed (#5608) | n/a |
| **R1** | **Rule v2.** `ocr` reasons (`preview`/`partial`/`gap`); in-flight from `translate_batch_runs`; `ocr_trust` → `ocr_untrusted`; `translate_refused` / `ocr: gap` from translatable pages left; refusal read (rule 9). Observe only. | #5820 | | A cron writes data, but to an **observe-only** field that sync-worker already writes and no selector reads. Not hold. |
| **R2** | **Audit v2 + "why" row.** The new shapes; `step_with_no_lane` measured; `/admin/pipeline?book=<id>` shows the step, reason, inputs, refusal, re-check and owner, the lane that serves the book, and that lane's budget, pause and gate state. | #5821 | | read-only |
| **R3** | **Routing table as data.** `ocr-routes.json`, read by `ocr-routing.mjs`; parity test (no behaviour change); `ocr_route` stamp. | #5822 | | No spend change by construction. It touches routing code, so expect `tier:hold`. |
| **R4** | **Alarms to ntfy.** `queue_drained`, `lane_silent`, `batch_unwatched`, `spend_stalled`, heartbeat. Until R6 they read today's hand drivers' logs. | #5823 | | read-only + ntfy |
| **R5** | **Refusal ledger.** `recordRefusal()`, written from the chained `--enrol` path; fingerprints. | #5824 | | **Hold:** lanes write a book field from crons (`pipeline_next.refusal` only). |
| 3 | **Exits.** `pipeline-recheck.mjs` handles source probes, stalls, policy, and refusal fallbacks. | #5479 | open | Writes only `pipeline_next` and probe records, never a paid step. |
| **R6** | **Standing driver, dry run.** Ranks the queue and writes a tick every 10 min, but enrols nothing. Logs what it would have taken beside what the hand drivers took. | #5825 | | read-only (writes tick rows) |
| **R7** | **Quality gate.** `quality_gates` rows; `enrol_paused`; the first gate run by hand over the translate-300 window. | #5826 | | **Hold:** a control flag that pauses enrolment. |
| **R8** | **Lane budgets + envelope expiry.** `lane_budgets`; spend-guard attribution by gate label; `expires_at`; the sweep that closes SPENT or expired envelopes. | #5827 | | **Hold: spend** |
| 5a | **Translate cutover.** The driver goes live for `translate`. The readable-20k, translate300 and preview-stubs drivers retire, along with their DONE files and chain scripts. | #5481 | open | **Hold: spend** |
| 5b–e | Enrich → archive → OCR (with `gap` first: 7,358 live pages) → images | #5481 | open | **Hold: spend**, each with its own estimate |
| 6 | Status becomes a cache; graveyard statuses retire; policy holds become reasons. | #5482 | open | **Hold:** bulk data write |
| 7 | Delete the hand re-entries and legacy fields. | #5483 | open | **Hold:** field deletion |

**Why this order:**
- R1 and R2 make every friction from 10-04 visible as a named shape, without moving a single book.
- R3 and R4 are useful before any cutover. An alarm on today's hand drivers would have caught the 10-03 drain.
- R5 needs R1's inputs, or its fingerprint has nothing to compare. #5479 needs R5's refusals before it can re-check them.
- R6 proves the queue against the hand runs before it controls any money.
- R7 must exist before R8 and 5a. A standing driver without a standing gate is an unwatched spender.
- Only after all of that do the budgets and the translate cutover move money.

## Decisions Derek owns (defaults in bold)

Unchanged from revision 1:
1. **Archive before OCR** (≥ 90% of images on R2). The exception is a book whose source is dead or restricted and whose text we already hold.
2. **The tail is part of `translate`**, ranked after the body.
3. **Cutover order: translate → enrich → archive → OCR → images.** Each paid cutover comes with its own estimate.
4. **No mass status rewrite** before step 6.
5. **The `needs_human` ceiling is 100 live books.**

New in revision 2. None of these binds before R7.

6. **Lane budgets replace per-run envelopes for line work.**
   - **Decided 2026-10-10 (Derek): No** to the proposed default (fund the first month from the unspent balance of the readable20k, translate300 and stubs4719 envelopes, ≈ $39/day translate and ≈ $65/day OCR). **Each lane budget comes back to Derek as its own decision** when R8 is built (#5827). Until then every lane budget is 0, which is today's behaviour.
7. **Queue rank order: asked for → mission core → reader demand → cheapest to finish → first translation.** This is the translate-next-5467 order. Alternative: cheapest to finish first, which maximises readers per dollar.
8. **Quality gate every 300 books or 7 days, 10 books × 3 pages each. A NO-GO pauses enrolment until a human records a GO.** Decided 2026-10-10 (Derek): yes, as written (#5826). It pauses enrolment only, never reader access.
9. **Policy holds become blocked reasons** (`ocr_policy`, `ocr_untrusted`) at R1, in observe mode. The hold markers stay untouched until step 6.
10. **Envelopes are for projects only, with a 30-day default expiry. SPENT envelopes close automatically.**

## Do not

- Do not add a status. A new state is a `blocked` reason with an exit, or it is not a state.
- Do not select on `pipeline_auto.status` in a new lane or driver. Select on `pipeline_next.step`, and re-derive it on read.
- Do not park a book without a `recheck_at`. "A human should look" is `needs_human`, and it has a ceiling.
- **Do not keep a `refused.txt`.** A refusal goes through `recordRefusal()`. A refusal code that recurs is an input the function is missing: file it.
- **Do not copy a driver.** A new cohort is a queue boost. A new kind of work is a lane with a registry entry.
- **Do not open an envelope for line work.** Raise the lane budget or add a queue boost. Envelopes are for projects, and they expire.
- **Do not change routing in code.** Edit a row of `ocr-routes.json`.
- Do not use a hold for a policy. "No lane yet" is `ocr_policy`. "The gate refuses" is `ocr_untrusted`.
- Do not compute a rung or a coverage ratio inside a selector. Read `translation_state` and `pipeline_next`.
- Do not treat a closed budget as a property of the book. The book keeps its step, and the lane idles.
