# Pre-registration: the standing translation benchmark, v13 vs v20 vs PLAIN on three engines (#7499)

PRIOR ART: `PREREGISTRATION-translation-seam-confirm.md` (non-inferiority form for a prompt fix) and #6728
(`experiments/2026-10-15-plain-vs-notes-translation-6728.md`: PLAIN arm, body rule, cross-family judges, plants). This
file fixes the rule for #7499 rows 1–3. Committed **before any judge call** of this run (the arms were already being
translated; no output had been read or scored).

Written 2026-10-27, job `prompt-bench-7499` (gex45). Harness: `scripts/eval/bench-translation/` (README).

## Question

For each engine × language group: should new translation use **v13** (the live default), **v20** (v13 + four defect
fixes, `prompts/translation/standard-translation-v20-candidate.md`) or **PLAIN** (#6728: the translation only, no
notes, summary, keywords, terms or meta)? This run changes no default, routing row or served page.

## Panel (frozen: `bench-translation/manifest.json`)

365 pages, one per book, every page of the #5695 / #5873 reference tracks with a reference text on this box
(`pareto-6182/load-xl.mjs`). Groups: latin 71, greek 69, vernacular 59 (German 22, French 14, Italian 10, Dutch 7,
Spanish 6), hebrew-aramaic 34, arabic 24, persian 23, sanskrit-pali 60, chinese 25. The #6545 sub-panel (132 pages:
Persian 23, Sanskrit 30, Chinese 25, Greek 25, Hebrew 29) and its 50 noise-floor pages are #6728's.

## Arms × engines

| engine | channel | pages | arms | A-vs-A floor (v13b) |
|---|---|---|---|---|
| lite `gemini-3.1-flash-lite` | paid API, Batch, `pareto-6182/run-arms.mjs` (temperature 1.0, thinking 0: the worker's config) | all 365 | v13, v20, plain | all 365 |
| 3.8 Flash low | `agy -p` only (`plain-6728/run-arm.mjs`, agy-cli `gatedTextCall`) | #6545 132 | v13, v20, plain | 50 floor pages |
| Opus | sealed `claude -p` only (same runner), one page per call | #6545 132 (batch 1); the other 233 (batch 2, rule below) | v13, v20, plain | 50 floor pages |

Every request is built by `build.mjs` exactly as production builds it: `buildTranslationPrompt` with
`PAGE_BREAK_SCOPED`, the stored previous page's English as seed (PLAIN: `plainSeed`), the neighbours' OCR; the CLI
lanes add agy-cli `TRANSLATE_SUFFIX` as `cli-translate.mjs` does. v13b sends v13's request again, byte for byte.

## Judges and controls

- Gemini arms (lite, Flash): **Opus via sealed `claude -p`**. Opus arms: **`gemini-3.8-flash-high` via agy**. If agy is
  locked, Opus judges the Opus arms and the result says "same-family judge".
- One item per page per engine, holding all of that engine's arms for the page (v13, v20, plain, and v13b on floor
  pages), shuffled labels, `pro-translate-6545/JUDGE-PROMPT-PRO.md` word for word, one item per call.
- Candidates are BODIES (`plain-6728/prompts.mjs bodyOf`, the same strip for every arm).
- Controls per engine: a planted meaning error (negation or number, `pro-translate-6545/plant.mjs`) in the v13 body of
  2 pages per group; 4 wrong-page items (another page's v13 body, same group); 4 duplicate items (one v13 body under
  two labels). **Gate:** plants located at their span ≥ 80%; every wrong-page candidate scored ≤ 2; duplicates
  scored equal in ≥ 3 of 4. A failed gate stops that engine's result until the failure is read.

## Amendment 1 (2026-10-27, before any judge call)

Collecting lite showed v13 reads whose WHOLE translation sits inside `<meta>continues from previous page: …</meta>`
(4 of 365 v13, 6 of 365 v13b, 0 v20, 0 PLAIN): the #7085 continuity leak, which v20 fix (a) targets. Their body is
empty, so a reader sees no translation. Rule: a read whose body is empty because its text is inside hidden tags is
**scored fidelity 1 with an omission**, not dropped (dropping it would remove exactly the failure a fix removes).
A read with no text at all (a failed call) is dropped and counted. The page is still judged on its other arms. The
headline is also reported with these pages left out, as a sensitivity line. No judgment had been seen when this was
written; the mechanical counts above had.

## Measures

Primary: body fidelity 1–5, `judged_vs_reference`, **paired** per page (arm − v13, same judge item).
Secondary: pages with an omission / a reversal / an invention (by kind), accuracy spans per page, output tokens per
page (thinking included where reported), body characters.

Intervals: 95% percentile bootstrap, 2,000 draws, resampling pages (= works; one page per work), seed 7499.

## Decision rule (per engine × group cell, and pooled per engine)

v20 is a **fix** and PLAIN a **simplification**, so both are tested for **non-inferiority**, margin **δ = 0.15**:

1. **Pass (non-inferior):** the lower 95% bound of (arm − v13) fidelity > −0.15, **and** the arm's reversal pages
   exceed v13's by no more than the floor allows: `rev(arm) − rev(v13) ≤ max(1, round(n_cell × d_floor))`, where
   `d_floor` = |reversal-page rate of v13b − that of v13| on the engine's floor pages.
2. **Inferior:** the upper 95% bound < 0, or the reversal rule fails with the fidelity point estimate ≤ 0.
3. **Inconclusive:** anything else.
4. **Superior** (reported, never required): lower bound > 0 **and** the point estimate is outside the engine's A-vs-A
   interval (v13b − v13) **and** ≥ 0.25 (eval-design §10.2).

**Recommendation per cell:**
- PLAIN passes → **switch to PLAIN** (deployment waits on a separate notes pass, #5942, as #6728 concluded).
- else v20 passes → **switch to v20**.
- else either is inconclusive → **test-next** (with the n that would resolve it).
- else → **keep v13**.
v20's verdict is also reported on its own as "the notes-keeping default: v13 → v20?", since v20 is what any lane that
keeps notes would run.

Grade per cell (eval-design §10.2): books < 30 exploratory, ≥ 30 directional, ≥ 50 decision. Card 3 (prompt): ≥ 50
overall and ≥ 30 per script group; tier never below medium. A cell below 30 books is reported, and decides nothing
alone. Pools named now: per engine, **all groups**; and **Latin script** (latin + vernacular) vs **non-Latin** (the
rest). A pool needs the §10.2 heterogeneity check.

Persian is its own group for every arm (#6728: 3.8 Flash PLAIN reversed on 5 of 23 Persian pages against 1).

## Sequential batches and the stopping rule

- **Look 1:** all three engines on the #6545 panel (132); lite also on the other 233 in the same Batch (one look for
  lite). A cell decided at look 1 under **99%** intervals is final.
- **Batch 2 (Opus only):** the 233 non-#6545 pages, arms v13 / v20 / plain, no new floor. Run only if this account's
  Claude weekly meter is < 70% after look 1's judging; otherwise stop and report the uncovered cells as test-next.
  Final look on those cells at **95%**. Two looks with 99% / 95% (Haybittle–Peto style) keep the overall error close
  to 5%.
- **3.8 Flash:** no batch 2 (agy is shared and near its ceiling). Stop, never fall back, if agy locks.
- Lite: budget $8 total for this job (estimate $1.53 for 4 × 365 Batch requests).

## Reuse (#7075)

#6728's CUR / CUR2 / PLAIN reads are on main's volume, not in the kept-reads bucket, and main refused a mesh job to
archive them (root disk 7 GB free). Their engine state also differs: today's 3.8 Flash low reports 0 thinking tokens a
page where #6728 measured a mean of 2,475. They are therefore not "the same engine", and are re-read fresh so each
comparison is within one engine state.

## What is out of scope

Changing `is_default`, any routing row or any served page. A notes pass (#5942). OCR (#7263, #6056).
