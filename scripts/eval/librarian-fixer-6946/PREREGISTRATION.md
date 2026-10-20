# Librarian offline citation fixer, stage 1 — preregistration (#6946)

Committed before the full replay. The prompt (`FIXER_PROMPT`) and the validation rules in
`src/lib/embassy/citation-fixer.ts` are frozen at this commit; the replay runs them unchanged.

## Question

Can a model that reads a FINISHED Librarian answer plus the whole text of every page read that turn, binding each
page link to a verbatim span that code string-matches on the page, cut wrong-page links without breaking
correct ones?

## Fixer contract

One call per answer (`claude -p --model sonnet`, subscription). Per link: `keep` (span on the linked page),
`move` (span on another page read), `drop` (no page states it). Code decides:

- `keep`: at least 6 consecutive words of the span on the linked page (folded; page-break spread counts), else `drop`.
- `move`: the WHOLE span on the target page, and not on the linked page (then `keep`); else `drop`. Never to a page < 1.
- Span under 4 words (under 6 letters for a script without spaces): unjudgeable, link left as written.
- Link whose page was not loaded, or that captions an image embed (on the embed line or the line after): left as written.
- A dropped link becomes the marker `(not from the library's pages)` / `(no procede de las páginas de la biblioteca)`.

## Data

Every recorded answer with page links and stored per-link labels: #6904 A (37) and B (38); #6970 A (38), B (37),
A2 (8); #7021 A (36), B (38), C (38), A2 (8); and the gauge's first run (20 live turns, 2026-10-18), labelled fresh
by the same instrument before the fixer runs. 298 answers, 2,479 page links.

**Dev set** (used to tune the prompt and rules, reported apart, excluded from the gate):
`6904:A:q01,q03,q07,q08,q12,q22,q32,q35`, `7021:B:q01–q04`, `6970:B:q02,q03` (14 answers).

## Instrument

The #6946 Opus judge, unchanged (`librarian-citations-6946/packet.ts`, `JUDGE-PROMPT.md`, `judge-driver.sh`):
`cited` / `other` / `none` / `wrong_fact` / `missing`; wrong-page = `other` + `none`.

- **Pre-fix label**: the run's merged judges (J1 = J2, else J3; `split` when no J3, left out of every rate);
  #6904 A and the gauge: one judge.
- **Post-fix label**: one fresh Opus judge on every answer the fixer changed, same pages, blind (no before/after
  mark). An answer the fixer did not change keeps its pre-fix labels.
- **Noise floor**: links the fixer left as written inside re-judged answers; their pre/post flips are the re-judge
  noise.

## Gate (all on the non-dev replay, pooled)

| | measure | pass |
|---|---|---|
| G1 | wrong-page links among links judged before and after (a dropped link counts as removed) | ≥ 40% fewer, AND the drop exceeds the noise-floor flips |
| G2 | links made wrong by a move (pre-fix `cited`/`wrong_fact`, post-fix `other`/`none`; or `cited` → `wrong_fact`) | ≤ 1% of judged links |
| G3 | correct links dropped (pre-fix `cited`, outcome `drop`) | ≤ 5% of pre-fix `cited` |
| G4 | planted errors caught (outcome `move` or `drop` on the planted link) | ≥ 80% adjacent, ≥ 90% other-book |

The gate passes only if G1–G4 all pass. If it passes, stage 1 builds the worker in DRY-RUN only.

## Planted controls (`plant.ts`)

40 non-dev answers with ≥ 2 links both pre-fix judges call `cited`, seeded draw. 40 links moved to an adjacent
page of the same book (±1 or ±2), 20 to a page of another book read that turn; the planted page and its ±1 loaded,
the original page left among the pages. Reported: catch rate per kind, restored to the original page, kept.

## Arms and secondary readings (descriptive, no gate)

- **Opus as fixer**: the same 40 planted answers with `--model opus`. Compared with Sonnet on planted catch, on
  the pre-fix-labelled links in those answers (correct dropped, wrong caught), and on per-link agreement.
- **Cross-family labeller**: Gemini Pro via `agy -p` on a 100-link sample of post-fix links, agreement with Opus
  (κ on wrong-page). Claude never runs through agy; no Gemini API.

## Budget

≤ ~800 `claude -p` calls in total (subscription). $0 Gemini API.
