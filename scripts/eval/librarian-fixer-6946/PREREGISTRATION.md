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

## Amendment 1 — committed after the registered run, before draw 2 (2026-10-20)

**Registered result** (non-dev replay, prompt and rules as committed in `83483c9aa`): G1 pass (410 → 182 wrong-page
links), G2 pass (4 of 2,294), G3 pass (30 of 1,781), **G4 fail**: adjacent 29/40 = 72.5%, other-book 18/20 = 90%.
**The registered gate is not met.** That result stands and is reported as such.

**Cause.** 8 of the 40 adjacent plants (and 1 other-book) were on image-caption lines, which the caption rule leaves
alone by construction. On the links the fixer judges, adjacent was 29/32.

**Amendment.** The caption rule exists because a caption links *the image's own page*. When the image URL itself
names a page (`archived|enhanced/<book id>/<n>.jpg`, `pages/<book id>/<n>-full.jpg`) and it is not the linked page,
that reason is gone: the link goes through the fixer like any other link. Prompt and every other rule unchanged.

**Test of the amendment.** A FRESH planted draw (`plant.ts --seed=librarian-fixer-6946-planted-v2`, excluding draw 1's
40 answers and the dev set), Sonnet. G4 re-tested on draw 2 with the same thresholds (≥ 80% adjacent, ≥ 90%
other-book). G1–G3 re-checked on the replay under the amended rule (re-validation of the stored verdicts: the model
gave a verdict for every link, captions included, so no new calls). Draw 1 under the amended rule is reported as
exploratory only: the amendment was written after seeing it.

**If draw 2 passes G4 and G1–G3 still pass**, stage 1 proceeds to the dry-run worker under the amended rule.
