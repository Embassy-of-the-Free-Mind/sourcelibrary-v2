---
stage: ocr
measure: judged
languages: [de, la]
scripts: [Latn]
canons: []
n_books: 242
n_pages: 409
verdict: "Gemini 4 Hydrogen (agy) reading the image fresh is in the same band as the live Opus correction in all three cells, and no cell's gap reaches the 6 of 30 pages this run can resolve. De-lite: Hydrogen low 29/30 accepted, Opus correction of the draft 28/30. De-flash3: 28/29 and 29/29. Latin-flash3: Hydrogen medium 27/29 and Opus correction 28/30. Hydrogen correcting the stored draft is worse than reading fresh in every cell (23/28, 27/30, 24/29). Opus still wins more paired pages in the German cells (10 to 1, 11 to 3). On 199 measured-bad pages, Hydrogen low removed the named serious finding on 130 and added a new serious error on 3. On 12 books' paired-fifths check it halved the serious defects on the two books the stored row failed."
status: informational
decision: "No route moved. The Hydrogen stages are in rules.json as rated, off-menu evidence (build 2026-11-14-hydrogen-218); current.json and ocr-routing-table.json are untouched. No lane may run Hydrogen today: the agy logins allow Flash low only, and this job ran under a one-night exception. De-lite and latin-flash3 are worth a confirmation draw; de-flash3 keeps Opus. #218."
feeds: "route"
supersedes: []
superseded_by: null
issue: [218]
router_evidence: ["german-lite", "german-flash3", "latin-flash3"]
defect_rates: "scripts/eval/route-judge-6740/results/hydrogen-218/defect-rates.json"
---
PRIOR ART: `2026-10-28-router-tests-agy-flash-low-gpu-draft-7263.md` (router-tests-2026-10-26: the same 60 German pages and the
baseline verdicts reused here), `2026-11-12-latin-flash3-live-route-8632.md` (the 30 Latin pages and their verdicts),
`2026-11-12-audit-policy-replay-8632.md` (the repair queue whose kept rows are stage C), `scripts/eval/methods/paired-fifths-check.md`
(stage E's prompt and draw), and `2026-11-13-deepseek-v4-1-flash-vision-ocr-224.md` (the same measured-bad audit on DeepSeek).
The panel half of #218 is `2026-11-14-hydrogen-panels-218.md`.

## 2026-11-14 · Can Gemini 4 Hydrogen on agy read German and Latin print as well as the Opus route? (#218)

**Why.** About 770K German pages are routed to an Opus correction. Hydrogen is new on agy. If it reads these pages as
well as Opus, the work can move to the agy subscription. A 9-page smoke put a low call at 19 s and a medium call at 29 s.

**Account.** Every call ran on `AGY_HOME=/root/.agy-james`, with the Flash-low rule lifted for this job only (Derek,
2026-11-13). The rule was lifted at 2026-11-14 00:21:44 UTC and restored at 02:33:26 UTC, with an `at` restore job as a
backstop. Calls: 1,700 of the 1,700 allowed (A 269, C 351, E 121, panels 959). Estimated weekly quota: 1,161 low calls ×
0.001 + 539 medium × 0.0064 = 4.6 points, under the 5-point cap. `/quota` read 99.7% before and 94% after, but the bulk
Flash-low lanes share this login, so that drop is not Hydrogen's alone. $0 of paid API.

### Tokens and time per page (from each read's `usage`, stages A, C, E)

| tier | input | output | thinking | median seconds |
|---|---|---|---|---|
| low, fresh read | ~10.8K | 1.6–2.4K | 1.0–1.3K | 17–25 |
| low, correction of a draft | ~11.6K | ~1.4K | ~1.0K | 12 |
| medium, fresh read | ~10.8K | 3.9–6.2K | 3.2–5.2K | 42–67 |

There were 0 failed reads in A, C and E. On the panels, 14 low reads and 7 medium reads were tool-denial stubs (see the
panels file).

### A. The judged paired run (router cells)

**Design.** `paired-arm-judge` with `judge.mjs`. The 90 pages are the router tests' sample, one page per book, 30 per cell
(`draw --from`). Four Hydrogen arms: `<draft>>hydrogen-low` (a correction of the stored draft) and `hydrogen-low` /
`hydrogen-medium` (a fresh read of the image, `--fresh`, `CANDIDATE_READS=off`), one page a call. The judge is blind Opus
through `claude -p`: one output per call, image attached, wrong-page controls and repeat pairs included. `paired-arm.mjs
check` exited 0. **The baselines were not re-read.** The stored draft, `<draft>>agy-flash-low` and `<draft>>opus-correct`
keep the verdicts the same judge gave them on the same pages. For the German cells those verdicts were given on **26
October** (`router-tests-2026-10-26`); for Latin, on 12 November (`latin-flash3-live-route-8632`). They pair by page at
score time (`merged/`). Since the draw, 2 de-lite pages have been overwritten by an agy correction (`agy-correct-lite-7558`).
They are left out of the corrector arm. Their fresh reads stay in, because a fresh read never sees the draft. That needed a
3-line fix in `judge.mjs packet`.

**Precision, stated before judging (`recipe.json`).** With 30 pages a cell, a gap under about 6 pages is inside the Wilson
intervals. This run can show that Hydrogen is far better, far worse, or in the same band. It cannot rank two routes that
are two or three pages apart.

| cell | route | accept | Wilson 95% | wrong-text pages | weighted defects /1k words | wrong text /1k | paired vs Opus correction (Hydrogen better / Opus better) |
|---|---|---|---|---|---|---|---|
| de-lite | draft>hydrogen-low | 23/28 | 0.64–0.92 | 2 | 3.27 | 0.27 | 0 / 13 |
| de-lite | **hydrogen-low** | **29/30** | 0.83–0.99 | 1 | 1.79 | 0.13 | 1 / 10 |
| de-lite | hydrogen-medium | 27/30 | 0.74–0.96 | 3 | 2.00 | 0.50 | 1 / 10 |
| de-lite | stored lite draft | 20/30 | 0.49–0.81 | 5 | 8.11 | 1.08 | 0 / 21 |
| de-lite | draft>agy-flash-low | 28/30 | 0.79–0.98 | 2 | 3.78 | 0.54 | 0 / 14 |
| de-lite | draft>opus-correct (live) | 28/30 | 0.79–0.98 | 1 | 1.37 | 0.14 | — |
| de-flash3 | draft>hydrogen-low | 27/30 | 0.74–0.96 | 1 | 1.42 | 0.10 | 2 / 15 |
| de-flash3 | **hydrogen-low** | **28/29** | 0.83–0.99 | 1 | 0.76 | 0.11 | 3 / 11 |
| de-flash3 | hydrogen-medium | 28/29 | 0.83–0.99 | 1 | 0.77 | 0.11 | 4 / 13 |
| de-flash3 | stored 3 Flash draft | 27/30 | 0.74–0.96 | 0 | 1.63 | 0 | 0 / 16 |
| de-flash3 | draft>agy-flash-low | 26/30 | 0.70–0.95 | 1 | 1.72 | 0.10 | 3 / 14 |
| de-flash3 | draft>opus-correct (live) | 29/29 | 0.88–1.00 | 0 | 0 | 0 | — |
| latin-flash3 | draft>hydrogen-low | 24/29 | 0.66–0.92 | 1 | 1.90 | 0.13 | 1 / 8 |
| latin-flash3 | hydrogen-low | 26/29 | 0.74–0.96 | 1 | 1.30 | 0.13 | 6 / 5 |
| latin-flash3 | **hydrogen-medium** | **27/29** | 0.78–0.98 | 0 | 0.51 | 0 | 6 / 6 |
| latin-flash3 | stored 3 Flash draft | 21/30 | 0.52–0.83 | 4 | 8.54 | 1.78 | 0 / 14 |
| latin-flash3 | draft>agy-flash-low | 26/29 | 0.74–0.96 | 2 | 2.41 | 0.38 | 3 / 8 |
| latin-flash3 | draft>opus-correct (HOLD cell's best) | 28/30 | 0.79–0.98 | 1 | 1.29 | 0.12 | — |

All wrong-page controls passed. Repeat flips: de-lite 1 of 3, de-flash3 0 of 3, latin-flash3 0 of 9. The paired column
compares the judge's fidelity scores on the same page. It is the better test of a small gap, and in the German cells it
favours Opus.

**Against §10.3's rule** (wrong text no worse than the live route's, within 0.15 per 1,000 words): Hydrogen low's fresh
read passes in all three cells (0.13 vs 0.14; 0.11 vs 0; 0.13 vs 0.12), and so does Hydrogen medium in de-flash3 and
latin-flash3. Hydrogen medium in de-lite fails it (0.50 vs 0.14). The Hydrogen corrector fails in de-lite (0.27). It passes
in de-flash3 (0.10 vs 0) and latin-flash3 (0.13 vs 0.12), but it is the weakest Hydrogen arm on accepts in every cell. These
rates come from ~30 pages; one wrong-text page moves them by about 0.1.

### C. The measured-bad pages

**Design.** The committed repair-queue snapshot (`scripts/eval/error-zoo/repair-queue-2026-11-12.json`). The labels are not
on a box this job can read, so the snapshot was used rather than a rebuild, and no #7809 German holds were added. From the
snapshot: the kept rows with status `queued`, `needs-second-read` or `not-confirmed` (151 pages). 90 of them had been
re-read since the snapshot; for those, the text served now is one more arm (`served-now`). On top of that, a seeded sample
of 48 pages from the no-route cells of a locally rebuilt queue, one page per book. 199 pages in all. Hydrogen low read all
199. Hydrogen medium read the 151 snapshot pages. The check is the #224 blind audit unchanged (AUDITOR.md, sealed `claude -p
--restricted`, X/Y order drawn by hash), with 20 identical-text controls, plus the finding check (`finding-check.py`).

| arm | finding fixed | new serious error | did not read | identical-text control |
|---|---|---|---|---|
| Hydrogen low | 130 / 199 | 3 / 199 | 0 | — |
| Hydrogen medium | 101 / 151 | 0 / 151 | 0 | — |
| served now (re-read since the finding) | 51 / 90 | 0 / 90 | — | — |
| control (stored vs itself) | — | — | — | 20 / 20 "same" |

The finding check agrees with the audit on most rows: the named finding was gone in 22 of 31 low rows, 22 of 28 medium
rows and 19 of 27 served rows, and was still present in 2 served rows.
The 3 new serious errors under low: `69af0bfaf2e68add0cf2216b` (Latin 1648, an omission),
`69f33bab876dd827cbc590e0` (Korean 1646, jumbled order) and `69942e5cd607f8e57e4b8cd4` (Greek 1561, invented wording). For
comparison, #224's DeepSeek read fixed 17 and added 94 new serious errors on the same 151 pages.

Per router cell (full table, and the one by language and half-century: `scripts/eval/results/hydrogen-panels-218/measured-bad/tables.md`):

| router cell | pages | route today | H-low fixed · new | H-medium fixed · new | served-now fixed |
|---|---|---|---|---|---|
| latin-lite/print | 86 | agy-flash-low@4-read | 66 · 1 | 69 · 0 | 34 of 49 re-read |
| german-lite/print | 36 | lite>opus | 17 · 0 | 17 · 0 | 12 of 29 |
| german-flash3/print | 19 | 3flash>opus | 5 · 0 | 6 · 0 | 4 of 11 |
| french-lite/print | 8 | agy-flash-low@4-read | 8 · 0 | 8 · 0 | 1 of 1 |
| german-lite/unknown | 2 | lite>agy-flash-low | 1 · 0 | 1 · 0 | not re-read |
| 48 sampled pages in 26 no-route cells | 48 | none | 33 · 2 | not read | — |

In the no-route cells, Hydrogen low removed the named finding in 33 of 48 pages, including Greek, Hebrew, Egyptian,
Armenian, Arabic, Ge'ez, Nahuatl, Mixtec and Sanskrit. The 2 new serious errors were the Korean and the Greek pages above.
There are 1–6 pages per cell, so this is a pointer, not a cell result.

By language and half-century, the largest rows: Latin 1450–99, 47 pages: low fixed 41, medium 43, 0 new. German 1600–49, 15
pages: low 5, medium 2. German 1750–99, 14 pages: low 2, medium 3. German pages fix least often; many German findings are
layout (a cut-off facing page, marginalia placement) rather than misreads.

**Pages where Hydrogen beats what is served**: `scripts/eval/results/hydrogen-panels-218/measured-bad/hydrogen-beats-served.json`.
That is 86 pages where low removed the finding and the served text has not (78 unchanged since the finding, 8 re-read
without the fix). Nothing was written; applying them is a separate step.

### E. The same book check, on the same pages

`paired-fifths-check` v2 rows whose 10 pages still hold the judged text: 0 German Flash-Lite books were eligible, so the job
took 6 German 3 Flash and 6 Latin 3 Flash books (seeded, from 15 of 29 eligible among 259 v2 rows). Hydrogen low read each
book's 10 deterministic pages fresh (120 calls), and the unchanged P5 prompt judged each facing pair with Hydrogen's
transcriptions in place of the stored ones. Only the transcription verdicts and break findings are used. Nothing was
written to `book_checks`.

| cell | pages accepted: stored → H-low | serious-defect pages | serious defects | break defects (of 30 breaks) |
|---|---|---|---|---|
| de-flash3 (6 books) | 50 → 55 of 60 | 10 → 5 | 57 → 16 | 2 → 1 |
| latin-flash3 (6 books) | 51 → 54 of 60 | 9 → 6 | 45 → 21 | 1 → 0 |

The whole gain is in the two books the stored row marked `fix`: *Aureum Vellus* went from 0/10 to 5/10 accepted, and the
Guido of Arezzo / *Liber Alchimiae* volume from 1/10 to 5/10. The other 10 books were clean before and after, except
*Fama remissa*, where Hydrogen added one serious defect (10/10 → 9/10). Per book: `scripts/eval/results/hydrogen-panels-218/book-check/tables.md`.

### D. By eye (read by the job session with the page image open, 2026-11-14)

Notes on 12 pages are in `scripts/eval/results/hydrogen-panels-218/by-eye/by-eye.md`. The errors that matter:
- **De-flash3, an eye-skip.** A 1590s fraktur page lost a whole line between two lines that both end in "drauff". The
  judge's wrong_text there is right.
- **Latin, long s.** "ſine agente" was read as "fine agente": a real word, but the wrong sense.
- **Fraktur S read as G** in a catchword.
- **Quiet normalisation.** "stoltze" became "stolze", and the printer's "posthune" became "posthume".

On the other side, Hydrogen keeps abbreviations as printed where the Opus correction expanded them silently, and it reads
only the leaf in front of it where the stored text had invented the cut-off facing column.

### Decision, per cell

- **german-lite: test next.** The fresh read is level with the live Opus correction on accepts (29/30 vs 28/30) and on the
  wrong-text rate (0.13 vs 0.14). Opus wins the paired fidelity comparison 10 to 1. To switch, we need a confirmation draw
  on fresh books that holds Hydrogen low within the margin and narrows the paired gap, and Derek has to allow a
  Hydrogen lane on the agy logins.
- **german-flash3: keep Opus.** Opus is 29/29 with no defects. Hydrogen's 28/29 passes the margin, but Opus wins paired
  11 to 3, and the stored 3 Flash draft already serves 27/30. The case to change would be Opus capacity, not quality.
- **latin-flash3: test next (cell on HOLD).** Hydrogen medium 27/29 with no wrong text is the best measured arm in a cell
  that has no route. Hydrogen low is level with Opus on paired pages (6/5). A confirmation draw is the step that could
  give the cell an agy route, if a Hydrogen lane is allowed.
