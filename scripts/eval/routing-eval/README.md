# Routing eval: which engine should read this script?

PRIOR ART: `scripts/eval/PREREGISTRATION-hidden-flash-5795.md` and `scripts/eval/hidden-flash-5795/*.mjs` — the
method, written for one question and five families; `.claude/docs/eval-design.md` — the house rules every
eval follows (one page per book, sealed draw, paired arms, `measure` named). Neither is a tool you can
point at Hebrew or Korean. This directory is that tool's rule files, run files and instructions (#5828).

## Run a new script's routing eval in one command

```
node --env-file=/root/sourcelibrary/.env.production.local scripts/eval/routing-eval.mjs run \
     --run hebrew-5900 --family heb --issue 5900
```

Run the same command again after each stop. It does every step whose inputs exist and stops where a
person is needed, saying what to do:

| # | step | who | spend | writes |
|---|---|---|---|---|
| 1 | `seal`: one interior page from up to 30 books of the family (hidden, OCR owed, not held), bytes pinned by sha256 | tool, Mongo read-only | $0 | `results/<run>/sealed.json`, images in the work dir |
| 2 | `labels`: packet per family; open every image, record script, language, `label_ok` | **a reader** (by eye, or subagents that open the images) | $0 | `results/<run>/labels-pass1.jsonl` |
| 3 | `arms`: each engine on the sealed bytes, production OCR prompt, hash asserted | tool, **only with `--spend-cap <usd>`** | about $0.006 per page per engine, realtime | work dir `out/<arm>/`, `results/<run>/prompt.json` |
| 4 | `score`: catastrophic per engine (refusal, loop, empty), `agreementChars`, the 10 lowest-agreement pages | tool | $0 | `results/<run>/results.json`, `outputs-<arm>.jsonl` |
| 5 | `adjudicate`: A/B key written, **committed**, then the blinded packets | tool, then **a reader** | $0 | `adjudication-key.json`, then `adjudication.json` |
| 6 | `decide`: the rule files applied mechanically, with a planted-inferior control | tool | $0 | `results/<run>/routing-eval.json` and `.md` |

Before step 3 the tool refuses unless the run file, the seal, the labels and every rule file are
committed: that commit is the preregistration. It also needs a spend envelope named after the run
(`scripts/maintenance/set-scope.mjs`), and it stops at the smaller of the envelope and `--spend-cap`.
Step 3 is the only step that calls a model. Nothing here writes to `books` or `pages`.

Flags for a new run (all optional except `--family` or `--filter`): `--visibility hidden|visible|any`
(default hidden), `--include-read` (drop the OCR-owed condition), `--created-before <date>`, `--n 30`,
`--seed` (default: the issue number), `--arms lite,flash` or `--arms a=<model>,b=<model>`,
`--baseline`, `--candidate`, `--k 10`, `--rule <file>` (repeatable), `--filter '<mongo filter>'` with
`--group <name>` for a population that is not a language family. They are written to
`runs/<run>.json` on the first call; after that the file is the authority and the flags are ignored.
An engine that is not a Gemini model is supplied as files (`out/<arm>/<slug>.json` in the work dir);
`arms` skips files that exist.

After the verdict: `node scripts/eval/build-routing-table.mjs` puts it in the generated table of
`.claude/docs/ocr-engine-routing.md`. Add the `experiments/` entry and the `DECISIONS.md` row
(`eval-design.md` §9). The verdict is a rule's output. A routing constant changes only with Derek's
sign-off (§10).

## Rule files (`rules/*.json`)

A rule file names a candidate, a baseline, a floor on pages with text, and a list of checks from
`scripts/eval/lib/routing-rules.mjs`:

| check | passes when | parameters |
|---|---|---|
| `labelPrecision` | the catalogue label is right on enough pages with text | `min` (0.9), `use`: `point` or `wilson_lower`; `on_fail` names the verdict (relabelling) |
| `countNoWorse` | candidate failures ≤ baseline failures + `slack` | `slack` (0) |
| `rateNonInferior` | count within `slack` AND the upper 95 % bound of (candidate rate − baseline rate), paired by page, ≤ `margin` | `slack` (1), `margin` (0.10), `seed`, `iters` |
| `adjudication` | the candidate wins more pages than it loses by eye, and invented text on no page | `mode`: `majority` or `wilson_lower`; `invention_max` (0) |
| `translationLift` | the lower 95 % bound of mean(candidate − baseline) judge fidelity of the ENGLISH made from each read, paired by page, is ≥ −`margin`. Needs `page.fidelity = { <arm>: score }` in results.json (from `translation-vs-reference/`). Fails with `inconclusive` when the point estimate is inside the margin but the interval is not; a rule's `verdicts.inconclusive` then names the verdict | `margin` (0.25), `min_pairs` (6), `tie` (0.25), `seed`, `iters` |

Reading order: fewer pages with text than `min_text_pages` → `small_n`, the rule is not applied; a
failed check with its own `on_fail` wins; an unanswered check → `pending`; all pass → `pass`; else `fail`.

- `margin-v1.json` is the default for new runs. It differs from #5795's rule only in (b).
- `hidden-flash-5795-registered.json` is #5795's rule as it was registered, kept so that run replays.
- `translation-lift-v1.json` (#5870) scores an engine by the English its read produces, judged blind against a
  published human translation, with the A5 Flash re-read as the bar. Its negative control plants an arm that is
  never better than the baseline and scores 1 on a fifth of the pages. Driver for the first run:
  `scripts/eval/engine-contest-5870/contest.mjs` (it writes a results.json that `decide --results` reads).

Write a new rule file BEFORE the seal and commit it. A rule changed after the arms ran is post hoc and
the write-up says so.

**What a margin can and cannot do at n = 30.** One failure in 30 against none gives an upper bound of
0.10 on the rate difference, so `margin-v1` passes it exactly at the margin; two against none do not
pass. The rule refuses a planted arm that fails 20 % more pages (the negative control `decide` prints),
but it cannot tell a 3 % failure rate from a 10 % one. For a tighter margin draw more books: about 150
pages give ±5 points at a 10 % rate (`benchmark-dashboard-data.mjs`, `N_RATE`).

## Is one run enough? The decision cards

A rule file answers "is the candidate no worse on these pages?". It does not answer "was this run big
enough for the money at stake?". That is `eval-design.md` §10.2, encoded as `DECISION_CARDS` and
`cardVerdict(card, evidence)` in `scripts/eval/lib/routing-rules.mjs` (cards: `routing`, `backfill`,
`prompt`, `gate`). Read the card before the seal: it fixes the books per language, the pooling rule, the
minimum effect and whether a replication is owed. A routing-eval verdict (by eye and failure counts, no
reference) can make a small or medium routing change sufficient, never a large one.

`node scripts/eval/decision-cards-audit.mjs` replays the decisions of 2026-10 through the cards from
stored results ($0); `tests/unit/decision-cards.test.ts` pins them.

## Replaying a stored run ($0)

```
node scripts/eval/routing-eval.mjs decide --run hidden-flash-5795
node scripts/eval/routing-eval.mjs decide --results <results.json> --rule <rule.json> [--rule <rule.json>]
```

No Mongo, no model. `tests/unit/routing-rules.test.ts` pins that the registered rule reproduces every
verdict stored in `results/hidden-flash-5795/results.json`.
