## 2026-10-08 · Translation on subscriptions only: Claude Sonnet (subagents) or Gemini 3.8 Flash (Antigravity CLI)? (#6182) — Gemini, in every pool

PRIOR ART: `scripts/eval/pareto-6182/PREREG-claude-arms.md` (the arms, as amended at 1f8ec8215: subscription
subagents, not OpenRouter), `scripts/eval/results/pareto-6182/claude/README.md` (how the arms ran),
`2026-10-08-cli-arm-tengyur-113-6182.md` (C38 = G38 on the Tengyur), `2026-10-07-other-languages-pareto-6182.md`
(the xl pages). Scorers are #6182's, extended by one round each: `score-ref.py --round claude6182` (Tengyur) and
`--round claude6182xl` → `score-xl.run_claude`. No new scorer.

### What was measured

- **Arms.** CS = `claude-sonnet-5-5`, CH = `claude-haiku-4-5-20251001`, as Claude Code subagents on the subscription,
  the byte-identical one-page prompt from `units.jsonl`, ≤ 10 pages per subagent. $0 billed.
- **Anchors in the same item.** G38 = `gemini-3.8-flash` through the API (#6182's run). Production = the page's own
  engine (FP = Gemini 3 Flash, or L31 = Flash-Lite).
- **Pages.** 171 Tengyur sides (113 against 84000 + 58 against Stcherbatsky / La Vallée Poussin) and 365
  other-language pages (one per book).
- **Judges.** Two blind Opus judges on every item, the prompts and controls #6182 used: 8 planted reversals and
  4 duplicates per packet.
- **CIs.** By-text for the Tengyur (2,000 draws), by-book for the rest.
- **C38 (Gemini 3.8 Flash through the CLI).** Judged only on the 113 Tengyur sides, in #6321's packet. There it
  cannot be told apart from G38: +0.03 [−0.13, +0.18], and +0.04 [−0.08, +0.15] on 171 sides. On the other
  languages, **G38 stands in for C38**. C38's xl judging finished at 17:15 today (#6331) and is not yet scored.
- **No preregistered pass/fail for these arms.** This is a comparison, reported with intervals.

### Judge gate: PASS for all four judge runs

| | plants caught (prereg) | duplicates tied | fidelity within 1 point |
|---|---|---|---|
| Tengyur J1 / J2 | 8/8 / 8/8 | 4/4 / 4/4 | 684/684 pairs |
| xl J1 / J2 | 8/8 / 8/8 | 4/4 / 4/4 | 99.9 % |

The arm means of the two xl judges agree to 0.02 (J1: CS 4.34, G38 4.49; J2: CS 4.33, G38 4.49).

### Tengyur (171 sides, 10 texts)

| arm | fidelity | inversion sides | omission sides | invention sides |
|---|---|---|---|---|
| G38 (API) | 4.84 | 5 | 2 | 18 |
| FP (production) | 4.61 | 11 | 5 | 29 |
| CS (Sonnet) | 4.50 | 12 | 15 | 13 |
| CH (Haiku) | 2.86 | 62 | 74 | 47 |

| difference (by-text 95 % CI) | 171 | 113 (84000) | 58 (round 2) |
|---|---|---|---|
| CS − G38 | **−0.35 [−0.49, −0.21]** | −0.30 [−0.51, −0.16] | −0.43 [−0.61, −0.24] |
| CS − FP | −0.10 [−0.25, +0.03] | −0.09 [−0.31, +0.08] | −0.13 [−0.29, +0.03] |
| CH − G38 | −1.98 [−2.15, −1.81] | −1.88 [−2.02, −1.70] | −2.18 [−2.33, −2.03] |

- **Sonnet against C38, bridged through G38** (113 sides; (CS − G38 here) − (C38 − G38 in #6321)):
  −0.33 [−0.51, −0.20].
- Sonnet is lower than G38 in every text with ≥ 25 sides: −0.22 to −0.50.
- Sonnet is not above production on the Tengyur.
- The judges call Haiku's Tibetan garbled.
- #6304's drops list no Tengyur side.

### Other languages (363 pages with all four arms; 2 lost to refusals: 1 G38, 1 FP)

| pool | n | CS | CH | G38 | prod | CS − G38 | G38 − prod | CS − prod |
|---|---|---|---|---|---|---|---|---|
| Latin | 70 | 4.55 | 3.85 | 4.66 | 4.31 | −0.11 [−0.26, +0.04] | +0.35 [+0.17, +0.54] | +0.24 [+0.06, +0.41] |
| Greek | 69 | 4.08 | 3.11 | 4.22 | 3.95 | −0.14 [−0.31, +0.01] | +0.28 [+0.13, +0.42] | +0.13 [−0.04, +0.30] |
| T3 (de, fr, it, nl, es) | 59 | 4.66 | 4.21 | 4.86 | 4.56 | **−0.20 [−0.36, −0.03]** | +0.30 [+0.14, +0.46] | +0.10 [−0.03, +0.24] |
| T4 (he, arc, ar, fa) | 81 | 4.11 | 2.99 | 4.36 | 4.18 | **−0.25 [−0.38, −0.12]** | +0.18 [+0.07, +0.29] | −0.07 [−0.22, +0.07] |
| T5 (sa, pi, zh) | 84 | 4.28 | 2.85 | 4.36 | 4.12 | −0.08 [−0.23, +0.07] | +0.24 [+0.11, +0.38] | +0.16 [+0.01, +0.30] |
| pooled | 363 | 4.32 | 3.34 | 4.47 | 4.21 | **−0.16 [−0.22, −0.09]** | +0.27 [+0.20, +0.33] | +0.11 [+0.04, +0.18] |

**Pages with a reversal (CS / CH / G38 / prod), pooled:** 34 / 95 / 13 / 34.
- Sonnet has 2.6× G38's reversal pages and 1.4× its omission pages (46 against 34).
- Sonnet has fewer invention pages than G38 (113 against 191). Mostly these are glosses Gemini adds.

**Per language** (n ≥ 20; CS − G38): Arabic −0.17 [−0.38, +0.04], Chinese −0.08 [−0.34, +0.20], German −0.09
[−0.27, +0.09], Hebrew −0.28 [−0.47, −0.09], Pali −0.03 [−0.24, +0.17], Persian −0.39 [−0.72, −0.11], Sanskrit
−0.13 [−0.43, +0.15].
- Sonnet's point estimate is below G38's in every language.
- **French (14 pages) and Persian are the two places where G38 is not shown above production.** French −0.04
  [−0.21, +0.11]; Persian +0.15 [−0.11, +0.41].

**Without #6304's 20 dropped pages** (343 pages): the same picture.
- Pooled CS − G38: −0.15 [−0.22, −0.09].
- T3 −0.20 [−0.36, −0.03], T4 −0.26 [−0.40, −0.13], Latin −0.11, Greek −0.14, T5 −0.07, all CIs as above ±0.02.

### Practical side (measured, not estimated)

| | Gemini 3.8 Flash, CLI (`agy -p`) | Claude Sonnet, subagents | Claude Haiku, subagents |
|---|---|---|---|
| pages per quota window | ~315 one-page calls, then `429 Individual quota reached` (2026-10-08, after ~60 earlier calls) | 536 CS + 529 CH = 1,065 pages, run together 13:47–15:04 UTC 2026-10-07, then the 5-hour session limit (429). The window also carried other sessions' work, so the share for translation is unknown, and Sonnet alone is not separable | (same window) |
| time per page | median 7.9 s per call (p90 13.6 s); 4 at a time ≈ 20 pages/min | 11.1 s of subagent time per page in 10-page batches; ≈ 7 pages/min with ~3 subagents | 18.2 s per page |
| refusals / content-filter stops | 0 of 478 | 1 output content-filter stop in 536 pages (batch CS-027; passed on a one-page re-run) | 0; 2 of 536 outputs carry a remark leaked from the previous page in the batch |
| quota overhead | ~11.6K-token CLI system prompt on every call | ~21–35K tokens of subagent overhead per batch (`cost-summary.json` xcheck); ~8K subagent tokens per page at 10 pages/batch. One page per subagent, the isolation production would want, multiplies that | same |
| who else draws on it | the Google subscription only | the same Claude account that runs every coding session and every Opus judge. On 2026-10-08 the judge driver waited on that account's limit for about 4 hours (11:52–15:53 UTC, 39 LIMIT retries) | same |

### Self-preference

- Both judges are Claude Opus, and two of the arms are Claude.
- **No non-Claude judge read these items.**
  - `judge-fable-6182` died on the account limit before judging any arm (#6182, 14:47).
  - It would have been a Claude judge anyway.
  - A Gemini judge would need the paid API, which this job's $0 rule forbids.
- What it means here: a judge that favours Claude would raise CS and CH, not lower them. Sonnet still scores
  below Gemini 3.8 Flash. A pro-Claude bias could therefore only have shrunk the measured gap, not created it.
- **Open limit:** a judge biased *against* Sonnet relative to Opus has no known mechanism, but it is not ruled out.

### Recommendation per pool (no routing change is made here)

| pool | recommended subscription route | measured gap CS − G38 [95 % CI] |
|---|---|---|
| Tengyur | **Gemini 3.8 Flash CLI** (C38 measured) | −0.35 [−0.49, −0.21]; CS − C38 bridged −0.33 [−0.51, −0.20] |
| Latin | Gemini 3.8 Flash CLI; Sonnet is not shown worse on fidelity, but has 2× the reversal pages and a third of the throughput | −0.11 [−0.26, +0.04] |
| Greek | Gemini 3.8 Flash CLI (same reasoning) | −0.14 [−0.31, +0.01] |
| T3 (German, Italian, Dutch, Spanish) | **Gemini 3.8 Flash CLI** | −0.20 [−0.36, −0.03] |
| French | **production Flash-Lite stays** (no arm beats it; 14 pages) | −0.11 [−0.46, +0.18] |
| T4 (Hebrew, Aramaic, Arabic) | **Gemini 3.8 Flash CLI** | −0.25 [−0.38, −0.12] |
| Persian | production stays; if re-translated, Gemini CLI, not Sonnet | −0.39 [−0.72, −0.11] |
| T5 (Sanskrit, Pali, Chinese) | Gemini 3.8 Flash CLI (either on fidelity; Gemini on throughput and reversals) | −0.08 [−0.23, +0.07] |
| any | **never Haiku** | CH − G38 −0.64 to −1.98, every CI excludes 0 |

### Limits

- **AI judges, not a human reader.** Fidelity is model-judged, not accuracy.
- **G38 stands in for C38 outside the Tengyur.** The two match within ±0.15 on 171 Tengyur sides.
- **Small samples:**
  - xl is one page per book.
  - French has 14 pages and Italian 10.
  - Aramaic, Dutch and Spanish are under 10 and are reported only inside their pools.
- **Batching:** the Claude arms ran ≤ 10 pages per subagent, so later pages had earlier ones in context. The Gemini
  arms ran one page per call.
- **Grade:** 10 Tengyur texts is exploratory; 363 books in xl is decision grade pooled, directional per pool.

### Chart

- `src/data/translation-pareto.json` gets a panel per language with ≥ 10 pages: "Claude Sonnet and Haiku on the
  subscription, 8 Oct 2026 (#6182)". Tibetan uses the 113 84000 sides.
- G38 and production are placed at their billed Batch dollars.
- Sonnet and Haiku are listed under the chart with production's score on the same pages, as Opus is.
- A page is kept only when its production engine is the one the chart labels production. So Latin is 61, German
  18, and French drops below 10 and gets no panel.

Files: `scripts/eval/results/pareto-6182/claude/{tibjudge,xljudge}/scores.json` (numbers only).
Run: `python3 scripts/eval/tengyur-levers/score-ref.py --round claude6182 --exclude scripts/eval/results/pareto-sample-audit-6304/drops.json`
and `--round claude6182xl --exclude …`.

Spend: $0. No Gemini call; arms and judges ran on the Claude subscription. Nothing was written to pages.
