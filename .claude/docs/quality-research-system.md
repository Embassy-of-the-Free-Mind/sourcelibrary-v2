<!-- PRIOR ART: .claude/docs/research-agenda-ai-quality.md (WHAT we want to find out, and for whom; this doc is the machinery that finds it), .claude/docs/eval-design.md (the rules one measurement must follow; this doc assumes them), .claude/docs/measurement-validity.md (per-measure validity audit, #6203; feeds the estimator's trust in each measure), .claude/docs/ocr-quality-measurement-loop.md (the OCR-only loop this generalises), scripts/eval/experiments/README.md (the 255-entry experiment index, the seed of the evidence store), .claude/docs/embeddings.md (the Supabase vector stores this reuses). None of them joins evidence, estimation, test planning and production routing into one loop. -->

# The quality research system: one loop from evidence to routing

**Read this when** you are about to design a quality test, choose which model reads or translates a kind of page, or
build anything in the Quality Center. Status: **design, 2026-10-11** (Derek: "conceptualize this as a research system
… its own search and embedding and dedupe … and routing system"). Tracking: #6553. Nothing here is built yet except
what the "exists today" column names.

## Why

Source Library exists to put readable, quotable primary sources in readers' hands, across a library heading for
100K books. Almost all of that text is read and translated by models. So the library depends on choosing, for each
kind of page, which model reads it, which translates it, and when a second model should check. Those choices must
be good, and we must be able to say honestly how good the result is.

Today those choices come from about 255 separate experiments, stitched together by hand in conversation. On
2026-10-11 that failed in a typical way. A test was designed to check whether Opus can translate. A 3 October
experiment had already measured it: Opus 4.88 vs Flash 4.13, though judged by Opus. Nobody found it, because
nothing searches our own evidence. Every test was also designed from scratch, against "every model × every
language", which is far too big a space to test exhaustively.

## The one idea: a research router

The same statistical model decides two things:

- **exploit:** which model handles a kind of page in production (the routing table);
- **explore:** where the next test should run, and how many pages it needs.

A test is the router choosing to explore, with controls attached. A production lane is the router exploiting.
Both feed the same evidence store, so the system learns from production as well as from tests. This is the
explore/exploit structure of a multi-armed bandit, run over a hierarchy of page kinds.

## The loop

**evidence store → (search · dedupe) → estimator → planner → runner → router → canary observations → evidence store**

| part | job | exists today | to build |
|---|---|---|---|
| 1. Evidence store | every observation as one row in one schema | scattered: `scripts/eval/experiments/` (255 entries with front matter), result files in many shapes, `page_revisions`, `sweep_log`, `src/data/*pareto*.json` | one schema in Supabase; the experiment harness writes to it; backfill |
| 2. Search, embeddings, dedupe | "have we tested this?"; page-level dedupe so one page is not counted as many results | the experiment index; the prior-art hook (new files only) | a vector table over write-ups, briefs and issues; page and work identity keys |
| 3. Estimator | Bayesian hierarchical model: quality per cell (model × language/script × page kind × period) with uncertainty, including untested cells | none; each experiment reports alone | fit nightly on Hetzner |
| 4. Planner | value of information: which cell to test next, with how many pages; writes the brief with prior art attached | done by hand in sessions | a ranked "worth testing" list plus a brief generator |
| 5. Runner | run tests safely: CLI readers (sentinels + tool gate, #6523), two-family judges, planted controls, noise floor, staging and stop rules | job wrapper (`claude-job.sh`), translation-vs-reference harness (#5702), `benchmark-score.mjs` | one standard harness that writes evidence rows |
| 6. Router | the routing table as data that lanes read; a background canary sends a few % of pages to a challenger | routing hard-coded per lane; decisions in issues | `routing_rules` table, lane integration, canary |
| Quality Center | the windows onto it: internal (evidence browser, uncertainty map, decisions) and public (honest quality statements per shelf and language) | `/quality/*`, `/platform/admin/ocr-evidence`, `/platform/admin/quality-methods` | views over the store and the posterior |

## How the data is organised: five layers

| layer | holds | rule |
|---|---|---|
| L0 raw | every model reply, prompt as sent, settings, the image or source it saw (by content hash) | immutable; job scratch then R2; any number can be re-derived from it |
| L1 observations | one row per page × engine × instrument (§1) | the only thing the estimator reads |
| L2 instruments | every measuring tool and its measured properties (below) | an instrument without measured properties is marked unvalidated and down-weighted |
| L3 documents | write-ups, preregistrations, briefs, issue bodies, decision rows, embedded (§2) | "have we tested this?"; prior art attached to every new brief |
| L4 derived | dated posterior snapshots, the routing table | regenerated, never hand-edited; a Quality Center page is a view over L1/L4 |

**Past materials become data by backfill:**
- page-level result files (the xlref series, #6182, #6331, the pareto data, the 2026-10-11 replications);
- the 255 experiment write-ups (study-level L1 rows + L3 documents);
- production evidence: `page_revisions` before/after pairs, the #6420 convergence lane's adjudications, the #6361 40-page two-reader check.

Each row keeps its original judge, prompt and route, so the estimator models the differences instead of mixing them.

## Instruments: measuring the measurement tools

Every judge, scorer, detector and human reference is an **instrument** with measured properties. They are stored in
L2 and used by the estimator as noise and bias terms:

- **catch rate** on planted errors (span-level, with no count anchoring in the prompt);
- **test–retest** agreement (an A-vs-A repeat);
- **cross-instrument agreement** (Krippendorff's alpha; pairwise ranking agreement);
- **bias:** self-preference toward its own model family;
- **reference error** for human references (#6552);
- the **validity verdict** from `measurement-validity.md` (#6203).

A noisy judge counts for less, and a biased one is corrected. The Quality Center shows instrument health beside every
result. Sources so far: #6545 (judge catch rates, Fable as third judge), #6552 (reference error), #6203 (validity
audit), #6547 (corrector anchoring on Greif: Opus 0/33 planted errors survived, Pro 2/33).

## 1. Evidence store (Supabase Postgres)

One row per **observation**: one page, read or translated by one engine, scored by one instrument.

- **What and where:** `page_id`, `book_id`, `work_id`, `edition_key` (identity for dedupe), language, script, period,
  page kind (print / manuscript / table / diagram), source collection.
- **Who made it:** stage (ocr / translation / correction / judge), engine model and version, route (api / cli / gpu),
  prompt id and hash, settings, strategy (single / correction / disagreement), draft source (for correction).
- **How it was scored:** instrument (CER against reference X / judge J fidelity / span F1 / planted-control catch),
  reference id and its measured error (#6552), judge model and family, `score`, `scored` (false for a failed read),
  `failure_kind` (refusal / copy filter / empty / timeout), error spans (jsonb).
- **Provenance:** experiment id, job, date, commit, the raw output's location.

Separate small tables: `experiments` (the front matter we already keep, plus hypothesis and decision), `controls`
(planted items and whether each instrument caught them), `judges` (per-judge measured catch rate and bias). Rules from
`eval-design.md` carry over: failed reads are counted, never scored as errors or as zeros (#6523); pages of one work
are not independent.

Backfill order: the pareto data and xlref/translation-vs-reference results first (already page-level), then the
experiment front matter for everything else (study-level rows, flagged as such).

## 2. Search, embeddings, dedupe (reuse the Supabase vector stores)

- **`quality_docs`**: a vector table over experiment write-ups, preregistrations, job briefs, issue bodies and
  decision rows. One row per chunk, with the experiment id and date. RPC `match_quality_docs`.
  - Uses: the planner attaches prior art to every new brief automatically. A session asks "have we tested Opus as
    translator?" and gets xlref-t5. Two briefs that test the same thing are flagged before they run.
  - Model: the existing `gemini-embedding-2-preview` pipeline is on the paid API, and Derek's Gemini rule allows
    only flash-lite there without asking. Backfilling about 255 documents costs well under $0.10. **Decision for
    Derek:** approve that, or run an open embedding model on Hetzner CPU at $0.
- **Page-level dedupe:** by `page_id`, then by `edition_key` / `work_id`. The same leaf scored in five experiments
  is one page with five observations, not five pages. Near-duplicate pages across editions are found by text
  embedding (the existing `page_texts` vectors). This stops benchmark panels from silently over-weighting famous
  texts.
- **Experiment dedupe:** cosine similarity of hypothesis plus arm description. Above a threshold, the planner says
  "already tested: see X" instead of writing a brief.

## 3. Estimator: the Bayesian statistics

Different outcomes need different likelihoods. All of them share one hierarchical structure.

**Outcomes and likelihoods**
- OCR error: characters wrong out of characters in the reference → **beta-binomial** per page (handles
  overdispersion; a page is not a bag of independent characters).
- Failed read (refusal, copy filter, empty) → **Bernoulli**, modelled separately as "did not read". Reported beside
  quality, never mixed into it.
- Translation fidelity 1–5 → **ordered logistic**.
- Meaning errors per page (MQM spans) → **negative binomial** with page length as exposure.

**Linear predictor** (on the outcome's link scale) for page p in language l, read by model m, scored by judge j:

quality = global mean
 + model effect *m* (pooled within model family and version: 3.7 Flash is a priori near 3.8 Flash)
 + language effect *l* nested in script family (Sanskrit borrows from Pali and Tibetan; Latin from Greek and German)
 + page-kind effect (print / manuscript / table) and period
 + model × language-group interaction (shrunk hard toward zero; it moves only with evidence)
 + work effect (pages of one work move together; this replaces our "resample by work" intervals)
 + judge effect *j* + **self-preference term** when the judge and the model share a family
 + reference-error term for CER (the reference's own measured keying error, #6552, so an engine is not blamed for
   the typist).

**Priors:** weakly informative. A new model enters with its family's prior and a wide spread, then narrows as
evidence arrives. Time decay: evidence from an older model version counts less once a new version ships.

**Inference:** start simple. Empirical-Bayes shrinkage per cell, which a script can do in an afternoon. Then the full
model in NumPyro or Stan, nightly on Hetzner (CPU is enough at this scale).

**Outputs per cell:** posterior mean and 90% interval; P(each model is best); expected loss of the current routing
choice (how much quality we give up if we are wrong). Cells we have never tested get an estimate too, honestly wide.

**Checks before the estimator is trusted:** posterior predictive checks against held-out experiments. It must
predict the result of a test before the test reports. A simulation from known effects must recover them.

## 4. Planner: value of information

For each cell, ask whether more data could change the routing decision, and whether that matters at the cell's
volume.

expected value of testing cell c ≈ pages waiting in c × expected quality gain if the decision flips × P(it flips
after n more pages) − cost of n pages (quota, time)

- **Clear cells** (P(best) > 0.9): route, don't test.
- **Low-volume cells:** use the pooled estimate; don't test.
- **Uncertain, high-volume cells** (for example Chinese, with about 1.4M untranslated pages and models close
  together): test, with n chosen by preposterior analysis (the smallest sample that settles it).

The planner writes the brief using the standard runner, the decision it changes, prior art from search,
two-family judges, controls, staging and stop rules. Then a human or session dispatches it. It stays a proposal
generator until it has earned trust.

## 5. Runner

What exists, packaged as one harness:
- readers through the fixed CLI runner (sentinels + tool gate, #6523);
- the translation-vs-reference judge harness (#5702), extended to two families plus Fable on a subsample (#6545);
- planted controls, with no count anchoring in prompts (Yang 2026);
- the A-vs-A noise floor;
- staging: early evidence cuts arms;
- stop rules.

Every run writes evidence rows. The experiment write-up becomes a view over those rows, not a separate artifact.

## 6. Router and canary

- **`routing_rules`** (Supabase): page-kind selector (language, script, page kind, period, collection) → reader,
  translator, check strategy (none / disagreement / correction-on-flag), with the posterior that justifies it and
  the date. Lanes read it instead of hard-coding models. A change goes through a PR on the rules file (reviewable
  diff), not an ad hoc edit.
- **Canary (Thompson sampling):** for each page, sample a model from the posterior "who is best here". Mostly that is
  the incumbent. Where the posterior is uncertain, a challenger gets a few % of pages.
  - Challenger output is judged automatically by two families.
  - It is written only if it passes the same guards as any write: the human-edit guard, chatter, loops, revision
    snapshot.
  - Otherwise it is kept as evidence only.
- **Guardrails:**
  - a canary never runs on held books;
  - a challenger whose judged quality is below the incumbent's interval is stopped at once;
  - spend follows the dial and Derek's Gemini rule (CLI first).

## Quality Center

- **Internal:** evidence browser with search (part 2); uncertainty map (cells × posterior, coloured by how sure we
  are and how much volume waits); decisions log; the methods map.
- **Public:** for each shelf and language, measured quality with n and date, how it was checked, and what readers
  should know (`quality-statements.md` rules). `/quality/pareto` becomes one view of the posterior, not a hand-built
  report.

## Build order

0. **Now:** the 2026-10-11 tests (#6523, #6547, #6545, #6544, #6552). They validate the judges and references the
   estimator will rest on.
1. **Evidence store + search:** schema, backfill (pareto, xlref, experiment front matter), `quality_docs` vectors,
   page and experiment dedupe. Done when a session's question "have we tested X?" returns the right experiment for
   10 known cases, xlref-t5's Opus result among them.
2. **Estimator v0:** empirical-Bayes shrinkage over the store, then the uncertainty map on the admin page. Done when
   it predicts the held-out results of #6545 and #6544 better than "assume the current default".
3. **Planner:** ranked list plus brief generator. Done when its top three recommended tests are ones a person agrees
   are the most useful.
4. **Router:** `routing_rules` read by the OCR and translation lanes, then the canary on one lane. Done when one
   lane's model choice changes because evidence changed, with no code edit.

## Risks

- **Garbage in:** the estimator trusts its inputs. Judge bias and reference error are modelled, but a systematic
  blind spot shared by all judges is invisible. Planted controls and the human-reference measurements (#6552) are
  the only defence; keep them in every run.
- **Goodhart:** routing toward what the judges like can drift from what is right. Cross-family judges, span-level
  checks and a rotating referee limit this.
- **Over-pooling:** a rare script that is genuinely different gets pulled toward its group. Keep the interaction term
  and report pooled cells as pooled.
- **Quota as cost:** "$0" is not free. The planner charges calls against the subscription windows (`climits`, the
  agy meter).
