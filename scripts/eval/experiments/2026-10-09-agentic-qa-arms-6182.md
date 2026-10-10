---
stage: translation
measure: judged_vs_reference
languages: [lzh, sa, pi]
scripts: []
canons: [chinese-buddhist, chinese-classics, sanskrit, pali]
n_books: 111
n_pages: 138
verdict: "No verdict: the re-judged C38 anchor moved −0.12, past the 0.10 tolerance. Descriptively a Sonnet check on a Gemini draft adds +0.10 [+0.05, +0.16] fidelity and almost never worsens a page."
status: undecided
decision: null
superseded_by: null
issue: [6182, 6331]
---
## 2026-10-09 · Does a Sonnet check-and-revise flow beat one-shot Gemini 3.8 Flash (CLI) on the canon set, and at what subscription cost? (#6182, job agentic-qa-6182)

PRIOR ART: `2026-10-08-canon-set-judged-6331.md` (the same 138 units, judge prompt, gate and by-text bootstrap; one-shot
Sonnet was never measurably better than C38 there). This adds two check-and-revise arms and re-judges C38 as the anchor.

**Question (Derek, 2026-10-09):** "it may be possible to do more quality translations with Claude Sonnet in agentic
flows that incorporate QA than the cheap one-shot Gemini." We measure the quality gain and what it costs in
subscription capacity.

### Preregistration (committed in 86b864873, before any judge output existed; heading reformatted afterwards, text unchanged)

**Units.** The 138 units of #6331 (75 Chinese CBETA/Kanripo passages, 23 Sanskrit pages, 40 Pali pages):
`/root/cli-set-6331/units.jsonl`. Published references never go to an arm and are never committed.

**Arms** (Claude Sonnet 5.5 via `claude -p` on the subscription, one fresh process per step, no tools, no API key):
- **SA, "Sonnet agentic":** a *draft* (SAd) made with the unit's existing prompt, unchanged; then a **check** by a fresh
  Sonnet process that sees only the source text and the draft, and lists reversals, omissions, mistranslations and
  unsupported additions, each with its source span; then a **revise** step (a fresh process with source, draft and
  findings) that applies only the listed fixes. When the check lists nothing, the final is the draft and no revise call
  is made.
- **GQ, "Gemini draft + Sonnet QA":** the stored C38 output (Gemini 3.8 Flash through the CLI, #6331) as the draft,
  then the same check and revise steps.
- **C38** (stored) is the anchor and the comparator.

Every row records calls and input / output / cache-read / cache-write tokens and start/end UTC per step.

**Judging.** The #6182 xl judge prompt verbatim (`/mnt/HC_Volume_105839809/jobs/judge-set-6331/judge/PROMPT.md`), two
blind Opus judges, both on every item. Candidates per item: C38, SAd, SA, GQ, with identical texts merged into one
candidate (a final identical to its draft is one label scored for both arms). Controls as #6331: 8 PLANT (SA final
beside a copy with one planted reversal) and 4 DUP (SA, an identical copy, C38).

**Gate.** Per judge: plants caught (reversal listed or lower fidelity) ≥ 6/8 and duplicates tied ≥ 3/4. Only judges
who pass are scored. **Anchor check:** per language, the re-judged C38 mean fidelity must be within 0.10 of its stored
#6331 score (Chinese 4.31, Sanskrit 4.39, Pali 4.67, from `scripts/eval/results/canon-ref-6331/judge/scores.json`). If
any language fails, the runs are reported as not comparable and no verdict is drawn.

**Primary measures**, per language (Chinese, Sanskrit, Pali) and pooled, for SA and GQ against C38 (and SA against SAd,
descriptively):
1. Paired fidelity difference (arm − C38; the per-page mean of the passing judges), with a by-text (work-clustered)
   bootstrap 95% CI, 2,000 resamples, seed 6182.
2. Reversal + omission pages per 100: a page counts if either judge flags a reversal or an omission on it. Compared by a
   paired exact two-sided sign test over the discordant pages.
3. Fill pages: a page counts if either judge types an invention as `unreadable_fill`. Paired one-sided exact sign test
   for a rise.

**Rule.** An arm **earns its cost** in a stratum only if
(fidelity difference ≥ +0.15 **and** its CI lower bound > 0) **or** (reversal + omission pages fall **and** the sign test
gives p < 0.05), **and** fill pages do not rise (one-sided sign test p ≥ 0.05). Strata with fewer than 10 units are
descriptive only.

**Check precision.** For each finding on a draft that was judged (SAd, and C38 as GQ's draft): a reversal finding is
confirmed if a judge flags a reversal on that draft; an omission finding if a judge flags an omission; a mistranslation
or addition finding if a judge's reversal, defect or invention quote overlaps the finding's draft span (a shared
normalised substring of ≥ 6 characters). Precision = confirmed / findings, by type. Judges miss errors, so this is a
lower bound.

**Capacity.** Per arm: tokens per page by type (input, output, cache read, cache write), calls per page,
API-equivalent $ per 1,000 pages at list price (the CLI's `costUSD`, cost basis "list"), and weekly points per 1,000
pages at $24.8 per point (the `claude-limits` calibration, made on a mostly-Opus mix; the Sonnet meter rate is
unmeasured). GQ's Gemini draft uses the Google subscription and no Claude capacity.

**By eye.** The 15 units where an arm's final differs most from its draft (normalised edit distance), read from text
(no page image) by an Opus reader against the source, judging whether each change was right.

### Result (2026-10-09, $0)

**Verdict: none drawn. The anchor check failed, so by the prereg these runs are not comparable with #6331.**
- Re-judged C38 against its stored score: Chinese 4.19 vs 4.31 (−0.12), Sanskrit 4.39 vs 4.39 (0.00), Pali 4.55 vs
  4.68 (−0.125).
- The drift is general, not confined to items where a revised twin sat beside C38: −0.09 on the 96 units GQ left
  unchanged, −0.13 on the 42 it changed.
- **Judge gate: PASS.** Both judges caught 8/8 plants and tied 4/4 duplicates. 0 null scores. Judges agree within 1
  point on 100% of 552 pairs, exactly on 82%.
- One judge file (J1-17, 6 items) was missing one closing brace per line, which left `ranking`/`confidence`/`reason`
  inside `scores`; they were moved back to the top level and no value was changed.

**Arm runs.** All 138 units in both arms, 0 unparsable checks, 0 short revisions, 1 content-filter stop (passed on
retry). The check raised findings on 25 of 138 Sonnet drafts (32 findings) and on 42 of 138 Gemini drafts (106
findings; 69 of them mistranslations). Wall clock: 276 unit pipelines in 20 min at 6 parallel.

**Quality table** (descriptive only, because the anchor moved). Within-packet differences are paired and both sides were
judged together, but the prereg withholds the verdict.

| arm | n | fidelity [by-text CI] | pages ≥ 4 | rev / om / fill pages per 100 | − C38 [CI] |
|---|---|---|---|---|---|
| **pooled** C38 | 138 | 4.33 [4.24, 4.42] | 95% | 4.3 / 8.7 / 5.8 | — |
| SAd (Sonnet draft) | 138 | 4.33 [4.20, 4.46] | 88% | 8.0 / 5.1 / 1.4 | +0.00 [−0.12, +0.13] |
| SA | 138 | 4.41 [4.28, 4.54] | 89% | 6.5 / 5.8 / 0.7 | +0.08 [−0.04, +0.20] |
| GQ | 138 | 4.43 [4.34, 4.51] | 96% | 2.9 / 5.8 / 3.6 | +0.10 [+0.05, +0.16] |
| **Chinese** C38 | 75 | 4.19 [4.09, 4.31] | 93% | 6.7 / 8.0 / 4.0 | — |
| SA | 75 | 4.43 [4.26, 4.59] | 92% | 6.7 / 1.3 / 0.0 | +0.23 [+0.05, +0.41] |
| GQ | 75 | 4.33 [4.21, 4.43] | 96% | 4.0 / 4.0 / 2.7 | +0.13 [+0.06, +0.22] |
| **Sanskrit** C38 | 23 | 4.39 [4.20, 4.61] | 96% | 0.0 / 13.0 / 17.4 | — |
| SA | 23 | 4.07 [3.76, 4.37] | 70% | 13.0 / 13.0 / 0.0 | −0.33 [−0.61, −0.04] |
| GQ | 23 | 4.54 [4.33, 4.74] | 96% | 0.0 / 8.7 / 8.7 | +0.15 [+0.02, +0.30] |
| **Pali** C38 | 40 | 4.55 [4.39, 4.73] | 98% | 2.5 / 7.5 / 2.5 | — |
| SA | 40 | 4.59 [4.34, 4.81] | 95% | 2.5 / 10.0 / 2.5 | +0.04 [−0.22, +0.23] |
| GQ | 40 | 4.55 [4.39, 4.74] | 98% | 2.5 / 7.5 / 2.5 | +0.00 [−0.09, +0.08] |

- **Reversal + omission pages**, paired against C38: SA 12 pages worse and 14 better (p = 0.85); GQ 0 worse and 5
  better (p = 0.06). No sign test reaches p < 0.05 in any language. Fill pages never rise.
- **The revise step on its own** (SA − SAd): +0.08 [+0.03, +0.15] pooled. 11 pages higher, 1 lower.
- **GQ is near-monotone.** 18 pages are higher than C38 and 3 lower, and no page gains a reversal or omission.
- **Had the anchor held, the rule would have passed:**
  - SA on Chinese: +0.23, CI above 0.
  - GQ on Sanskrit: +0.152, which clears the +0.15 bar by 0.002.
  - GQ on Chinese misses the size bar (+0.13).
  - Both arms fail on the pooled set and on Pali.
  - SA is *worse* than C38 on Sanskrit, as one-shot Sonnet was in #6331.

**Check precision** (lower bound, by the judges):

| arm (draft checked) | findings | confirmed | precision | reversal | omission | mistranslation | addition |
|---|---|---|---|---|---|---|---|
| SA (Sonnet draft) | 32 | 26 | 81% | 2/3 | 1/2 | 11/12 | 12/15 |
| GQ (Gemini draft) | 106 | 60 | 57% | 4/6 | 1/6 | 35/69 | 20/25 |

**By eye, read from text** (15 units with the largest draft → final change; blind A/B; Opus readers, not scholars):
- The final was preferred on 11 of 15 units: SA 5 of 6, GQ 6 of 9.
- Reader fidelity: SA draft 3.33 → final 4.00; GQ 4.11 → 4.33.
- Of 39 places where the two texts differ in meaning:
  - 25 were right in the final;
  - 4 were right in the draft;
  - 10 were both acceptable.
- **The revise step can break a correct draft.** On SN 7.11 it flipped the negation in the closing verse. The readers
  also preferred the draft on SN 10.3 and SN 3.1 (both GQ) and on Kanripo KR1d0026 (SA, where the revision dropped a
  clause).
- The changes are small: the largest final differs from its draft by under 4% of characters.

**Capacity** (per page = per unit; usage from each `claude -p` result; list price = the CLI's `costUSD`):

| arm | calls / page | uncached input | cache write | cache read | output (of which thinking) | $ list / 1,000 pages | weekly points / 1,000 pages | pages per point |
|---|---|---|---|---|---|---|---|---|
| SA (draft + check + revise) | 2.18 | 4 | 9,402 | 33 | 4,639 (2,156) | $84.0 | 3.39 | **295** |
| of which the draft | 1.00 | | | | 3,040 | $48.0 | 1.93 | 517 |
| of which check + revise | 1.18 | | | | 1,599 | $36.1 | 1.45 | 688 |
| GQ (check + revise; draft on Gemini) | 1.30 | 3 | 5,640 | 0 | 2,054 (1,227) | $43.1 | 1.74 | **575** |
| C38 one-shot | 0 Claude calls | | | | | $0 Claude | 0 | — |

- Points are at $24.8 per point. That is the `claude-limits` calibration, made on a mostly-Opus mix. **The Sonnet meter
  rate is unmeasured.**
- Every prompt is written to the cache once and never re-read (each step is a fresh process). That makes input cost
  1.25× the base rate. A long-lived loop that reuses a cached instruction prefix would cost a little less.
- Median serial time per page: SA 29 s, GQ 11 s.
- **For scale:** the canon gap is ~3.9 M page-equivalents (#6331). At 575 pages a point, GQ needs ~6,800 weekly points.
  SA needs ~13,300.

**Reading.**
- A Sonnet check on a Gemini draft (GQ) is the better shape of the two. It is cheaper (no Claude draft), its revisions
  almost never make a page worse, and within this packet it adds about +0.1 fidelity.
- A Sonnet draft carries one-shot Sonnet's Sanskrit weakness into the agentic flow, and the check does not repair it.
- None of this is a verdict. The anchor moved by −0.12, more than the prereg's tolerance of 0.10. A re-judge in which
  within-packet C38 is the preregistered comparator would settle it.

**Replicated?** No.

**Artifacts:**
- Builders and scorer: `scripts/eval/agentic-qa-6182/`.
- Scores, numbers only: `scripts/eval/results/agentic-qa-6182/judge/scores.json` and `byeye.json`.
- Arm texts, findings and judge packets stay on the box under `/mnt/HC_Volume_105839809/jobs/agentic-qa-6182/`.
