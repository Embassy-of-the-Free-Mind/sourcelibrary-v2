---
stage: translation
measure: [judged]
languages: []
scripts: []
canons: []
n_books: 82
n_pages: 7557
verdict: "The write-time seam guard finds 23% of new joins defective on replay and 39–52% on the two lanes that wrote during the 48 h window. Its accepted Sonnet repairs on Gemini-translated joins are preferred by the blind Opus judge in both orders 68/75 in replay (0 worse) and 56/60 live (2 worse); majors 28/28, 0 worse. On joins with an Opus-translated page it is preferred only 7/16, so the guard no longer touches them. The apply bar (≥ 90% and 0 worse) is not met: the lanes stay SEAM_GUARD dry. A wider placement bound for majors (lean.mjs --majors-wide) placed 56 of 110 refused majors, 55 preferred, 0 worse. Drift-only joins are now skipped."
status: adopted
decision: "Guard on in every lane as dry (box file /etc/sourcelibrary/seam-guard); not apply. SEAM_GUARD_APPLY=major is built for a majors-only switch. --majors-wide shipped off by default, recommended on in the cron. Drift-only skip merged (#7118)"
superseded_by: null
issue: 7118
---
## 2026-10-24 · Stopping new seams at write time: the guard on Sonnet, majors with bigger edits, drift-only skip (#7118)

PRIOR ART:
- `2026-10-22-seam-claude-tiers-7118.md`: Sonnet as the lane's repairer at 0.4 weekly points per 100 joins; placement refused 120 of 183 majors.
- `2026-10-16-seam-repair-lean-6742.md`: Test B, and the blind both-orders Opus judge.
- The write-time guard of #6742 (`guard.mjs`, Gemini via agy only).

Code:
- #7152: the guard's Sonnet fallback, the box mode file, the translate-worker hook, the opus-translation skip, `SEAM_GUARD_APPLY=major`.
- #7250: the box file is ignored under vitest.
- #7154: `--majors-wide`.
- #7153: the drift-only skip.

Results: `scripts/eval/results/seam-prevent-7118/`. Every Claude call went through the box account's subscription (sealed `claude -p`). Gemini was used only where `guard.mjs` already used it (agy, after it reopened 10-23 22:00 UTC). Nothing was written to Mongo by any measurement here.

### 1. The guard on Sonnet, and where it runs

`guard.mjs` checks the one or two joins a translation write has just made. When agy is locked or answers with a quota reply, the join now goes to Sonnet: the same single-join prompt and windows, the same placement + `lostWords` acceptance.
- Cap: `SEAM_GUARD_CLAUDE_DAILY`, 1,500 joins per UTC day, box-wide.
- No Claude call at ≥ 50% weekly, or when the meter is unknown.
- Fail-open, the 8-min timeout and never-block are unchanged.
- A Sonnet join costs ≈ $0.010–0.014 list and takes 5–10 s.

The lanes on main, measured over 48 h of writes:
- `cli-translate` inside jobs wrote the Opus pages.
- `translate-worker` (scheduler) wrote through its own door, which the guard never saw; it is now hooked.
- The chained `translate-batch-worker` and `realtime-translate` go through translate-core.
- `batch-collector` ran no translation job in 7 days. `paddle-zh-guarded-lane` writes OCR only. `pipeline-orchestrator` only dispatches.

Per-lane env lines would miss `cli-translate` in jobs, so the mode is one box file, `/etc/sourcelibrary/seam-guard` (`dry`). `SEAM_GUARD=off` turns it off for one process.

### 2. Blind Opus sample of the guard's proposals

Method: `seam-repair.mjs verify` (both orders in separate calls, A/A pairs), over `guard.mjs sample`.

| set | where from | accepted | judged | prefers both orders | worse both orders | A/A |
|---|---|---|---|---|---|---|
| replay 1 | 40 books, 10 recent writes each, as of each write | 42 | 42 | 31 (73.8%) | 0 | 9/9 tie |
| replay 2 | 40 other books, same | 49 | 49 | 44 (89.8%) | 0 | 10/10 tie |
| replay, Gemini-translated joins | | | 75 | **68 (90.7%)** | 0 | |
| replay, a page Opus translated | | | 16 | **7 (44%)**: 2/8 and 5/8 | 0 | |
| live (shadow, after the opus-translation rule) | seeded 60 of 142 | 142 | 60 | **56 (93.3%)** | **2** | 9/9 tie |
| majors, Gemini-translated, replay + live | | | 28 | **28** | 0 | |

- The opus-translation rule was pre-registered on #7118 after the replays and before the live sample, which tests it out of sample.
- Both live "worse" cases are minors on the same German Plotinus commentary. One repair forces German word order into the English; the other drops a rendering of a German gloss.
- Opus judge cost $1.38 + $1.58 + $1.91 list.

### 3. The 48 h dry run (10-22 21:26 → 10-24 21:26 UTC)

| | shadow (#7152 branch, to 10-24 02:21) | merged guard in the lanes (after 02:21) |
|---|---|---|
| writes seen | 3,013 | 3,744 |
| writes skipped: held book | 1,543 | 2,387 |
| writes skipped: Claude session limit | 423 (10-23 00:10–01:00) | 0 |
| joins skipped: Opus translation | 785 | 0 |
| joins skipped: weekly ≥ 50% / daily cap | 0 / 0 | 0 / 0 |
| joins checked | 415 (Sonnet 400, Gemini 15) | 1,064 (all Gemini) |
| defective | 214 (51.6%) | 414 (38.9%) |
| majors | 77 | 133 |
| accepted (placement + lostWords) | 161 | 319 |
| Sonnet list $ / Claude points | $5.88 / ≈ 2 points, all on 10-23 | $0 / 0 |

- The weekly meter went from 31% (10-22) to 76% (10-24), mostly other jobs. The guard's 50% stop never had to fire on a join: once Claude was needed past 49%, there were no checkable writes until agy reopened.
- The two lanes that wrote checkable pages (chained batch + realtime, flash-lite) make broken joins at 39–52%. That is twice the replay's 23%, so their output is where the guard matters.
- The 319 Gemini-arm proposals were not Opus-judged. With the account at 76% weekly (above the guard's own 50% stop and lean's 60%), spending more Opus could not change the decision: the pooled set already holds 2 worse.

### 4. Majors with bigger edits (`--majors-wide`, #7154)

Data: the 120 majors placement refused in seam-tiers-7118's 1,000-join Sonnet dry run, with Sonnet's own repairs.
- Majors-only bound: ≤ 5 sentences / 200 words replaced per side, ≤ 2 sentences / 150 words restored, ≤ 24 content words lost.
- 10 were drift-only and excluded. 56 placed, 36 mapped onto the stored pages.
- Blind Opus, both orders: **55/56 preferred, 0 worse**, A/A 10/10 tie.
- The one split deletes a sentence that is also in page N+1's stored English, beyond the window: a doubling, so the deletion is right.
- Re-planning the run with the flag writes 460 joins instead of 425: +35, all majors.
- In the runner, every wide repair is judged, not sampled, and written only if preferred in both orders.

### 5. Drift-only joins (#7153)

Drift alone reads straight across in the continuous view (#7138), so such a join is now skipped (`skipped: drift-only`) and never written.
- 4.5% of the nightly dir's defective joins were drift-only (198 of 4,400), and 53 of 1,287 written.

### Decision

- **Guard:** on in every lane, `dry`. `apply` waits until a sample clears ≥ 90% with 0 worse.
  - The cleanest next test is majors-only (`SEAM_GUARD_APPLY=major`, 28/28 so far), on a fresh Opus sample of Gemini-arm majors after the weekly reset (10-27 14:00 UTC).
  - To switch: `echo apply > /etc/sourcelibrary/seam-guard` (with `SEAM_GUARD_APPLY=major` in the lanes' env for majors only). Back: `echo dry`, or `rm` the file.
- **`--majors-wide`:** recommended on in the 01:30 lean cron. Crontab is a `tier:hold` file, so it is left for Derek.
