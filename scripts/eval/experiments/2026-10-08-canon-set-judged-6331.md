---
stage: translation
measure: judged_vs_reference
languages: [lzh, sa, pi]
scripts: []
canons: [chinese-buddhist, chinese-classics, sanskrit, pali]
n_books: 111
n_pages: 138
verdict: "Gemini 3.8 Flash via the CLI is the route for Chinese, Sanskrit and Pali and clears the good-enough bar (fidelity 4.31 / 4.39 / 4.67); Sonnet is never shown better."
status: undecided
decision: "Route recommended in the #6331 decision table (PR #6350); running the canon gap on the CLI waits on the subscription-plan decision"
superseded_by: null
issue: 6331
---
## 2026-10-08 · Which subscription route translates the typed Chinese canon, Sanskrit and Pali well enough to run the canon gap on? (#6331 tests 2 and 5)

PRIOR ART: `2026-10-08-canon-reference-set-6331.md` (#6339, the 138-unit reference set this judges),
`2026-10-07-other-languages-pareto-6182.md` and `2026-10-08-cli-arm-tengyur-113-6182.md` (the same judge prompt,
gate and controls on #6182's pages). Nothing here is a new instrument.

### Preregistration (committed before any judge output existed)

**Units.** The 138 units of `/root/cli-set-6331/units.jsonl` (built by job `zh-set-6331`): 75 Chinese typed-canon
passages (CBETA, Kanripo; one per work, 600–2,500 characters), 23 Sanskrit and 40 Pali held pages. All units are
judged; none is dropped after scores are seen.

**Arms.**
- `C38` — Gemini 3.8 Flash (`gemini-3.8-flash-low`) through the Antigravity CLI, subscription. Every row must have
  `turns` = 1; any that does not is reported.
- `CS` — Claude Sonnet, subscription (8 subagents).
- `FP` — stored production English, only on the 47 Sanskrit/Pali pages that have it. **The 75 Chinese passages have
  no stored English: there is no production arm for Chinese**, and none is invented. Chinese is judged C38 against
  CS and the reference.

**Judges.** The #6182 xl judge prompt (`/root/pareto-6182/xljudge/PROMPT.md`, the #5695 prompt), unchanged. Two
blind Opus judges (`claude -p --model opus`, subscription); both judge every item. Candidates shuffled per item.

**Controls and gate** (`score-xl.py`'s): per judge 8 PLANT items (the CS English beside a copy with one planted
reversal, #5829's planter) and 4 DUP items (CS, an identical copy of CS, C38). A judge passes if it catches ≥ 6 of
8 plants (reversal listed or lower fidelity than the twin) and ties ≥ 3 of 4 duplicates. Only passing judges are
scored; if neither passes, the instrument failed and no arm result is reported.

**Primary measure.** Fidelity 1–5 against the published translation, per page the mean of the passing judges.
Reported per arm: mean fidelity with a by-text bootstrap 95% CI (resample works — `book_id` — then units within a
work; 2,000 draws), share of pages with fidelity ≥ 4, and reversal (inversion), omission and invention pages per
100 (a page counts if either judge lists one; invention excludes `added_fact`). Paired difference C38 − CS (and
C38 − FP, CS − FP where FP exists) with the same bootstrap.

**Strata.** Chinese pooled; Chinese per stratum (CBETA sūtra, śāstra, Chan; Kanripo KR1–KR5 — KR5 has 2 units and
is reported, not read); Chinese famous vs not famous; Sanskrit; Pali. Per-stratum results with < 10 units are
descriptive only.

**The question per language: which subscription route, and is it good enough to run the canon gap on.**
- *Route:* C38 unless CS is better with the by-text CI of CS − C38 excluding 0; if C38 is better or the CI covers 0,
  C38 (it is the route the plan decision is about, and it does not compete with the Claude jobs for quota).
- *Good enough to run* (set before scoring): mean fidelity ≥ 4.0, by-text CI lower bound ≥ 3.75, share of pages
  ≥ 4 at least 75%, and reversal pages ≤ 10 per 100. Below that: "not yet".

**By-eye check.** 20 Chinese units, a stratified draw (seed 6331, ≥ 2 per stratum where it has them), read by Opus
subagents against source and reference, labelled **read from text** (typed corpora: there is no page image).
Each reader gives fidelity 1–5 per arm and lists reversals and omissions. Reported: where the readers disagree with
the judges by ≥ 1.5 on an arm, and whether the reader's arm order matches the judges'.

**Limits stated in advance.** The judges and the by-eye readers are AI models (Opus), not scholars. The fit
readers who built the set are also Opus, so a lenient reference fit is possible. The set is not proportional to
the gap (KR4 is ~29% of the gap's Chinese characters but 12% of the set).

### Result (scored 2026-10-08, `python3 scripts/eval/canon-ref-6331/score-set.py`)

**Verdict:** the route is Gemini 3.8 Flash through the CLI (C38) for all three languages. By the preregistered
rule it is good enough to run on the Chinese canon, Sanskrit and Pali. Sonnet (CS) is never shown better.

**Arm check.** C38 has `turns` = 1 on all 138 rows. `cli-arm.sh` ran `agy --model gemini-3.8-flash-low
--output-format json -p` without `--dangerously-skip-permissions` (#6345). 138 of 138 returned, with 0 quota
sleeps and 0 failures, in 3 minutes of wall time (17:02–17:05 UTC) at 8 parallel calls.

**Judge gate: PASS.** J1 caught 7 of 8 planted reversals (it gave a planted "is → is not" 3, the same as its twin)
and tied 4 of 4 duplicates. J2 caught 8 of 8 and tied 4 of 4. Agreement on 323 page × arm pairs: within 1 point
100%, the same grade 80%, Pearson 0.77. Reversal flags: J1 23, J2 18, both 16. C38 − CS by judge: J1 +0.17,
J2 +0.15. No null scores.

| group | n (works) | C38 fid [by-text CI] · ≥4 · rev/om/inv per 100 | CS | FP | C38 − CS | C38 − FP |
|---|---|---|---|---|---|---|
| Chinese | 75 (75) | 4.31 [4.20, 4.42] · 92% · 6.7/9.3/76 | 4.23 [4.07, 4.38] · 84% · 10.7/6.7/43 | none stored | +0.08 [−0.05, +0.22] | — |
| — famous | 35 | 4.40 · 94% · rev 2.9 | 4.49 · 91% · rev 5.7 | — | −0.09 [−0.29, +0.09] | — |
| — not famous | 40 | 4.24 · 90% · rev 10.0 | 4.01 · 78% · rev 15.0 | — | **+0.23 [+0.04, +0.41]** | — |
| Sanskrit | 23 (23) | 4.39 [4.22, 4.59] · 100% · 0/4.3/70 | 3.94 [3.70, 4.15] · 74% · 4.3/13/43 | 3.75 (n=12) · 50% · 16.7/33/33 | **+0.46 [+0.22, +0.72]** | **+0.58 [+0.21, +0.96]** (12) |
| Pali | 40 (13) | 4.67 [4.50, 4.83] · 98% · 2.5/5.0/73 | 4.53 [4.30, 4.72] · 92% · 7.5/5.0/20 | 4.00 (n=35) · 71% · 14.3/46/29 | +0.15 [+0.00, +0.34] | **+0.67 [+0.39, +0.96]** (35) |

Chinese per stratum, C38 / CS fidelity (C38 − CS):
- CBETA sūtra 11: 4.46 / 4.54 (−0.09)
- CBETA śāstra 13: 4.04 / 3.88 (+0.15)
- CBETA Chan 9: 4.56 / 4.50
- KR1 classics 10: 4.20 / 4.25
- KR2 histories 11: 4.46 / 4.00 (+0.46 [+0.18, +0.73])
- KR3 masters 10: 4.20 / 4.35, with C38 reversal pages 2 of 10
- KR4 collections 9: 4.44 / 4.28, C38 reversal pages 1 of 9
- KR5 Daoist 2: 4.00 / 4.00

Only the KR2 difference excludes 0. KR3 misses the good-enough bar on reversals (20 per 100) and share ≥ 4 (80%).
KR4 misses it on reversals with 1 page of 9, which is descriptive only.

**Inventions are mostly glosses.** The judges typed C38's invention entries on Chinese as 115 `added_fact` (not
counted), 81 `gloss` and 1 `unreadable_fill`. CS had 75, 38 and 2. C38 explains more inside the running text. It
fabricates where the source is unreadable no more often than CS.

**By-eye, read from text (20 Chinese units, Opus readers).** The readers score both arms higher than the judges
do: C38 4.65 against 4.35, CS 4.45 against 4.33. The readers prefer C38 on 7 units, CS on 3 and neither on 10. The
judges prefer C38 on 7, CS on 6 and neither on 7. On no unit do the readers and the judges prefer opposite arms,
and no unit differs by 1.5 or more. The readers found reversals on more units than the judges did: C38 4 units
against 2, CS 6 against 1. They flagged CS on KR4h0034 (two lines inverted, the judges flagged one), KR5i0013,
T1586 and T2025. They flagged C38 on KR1b0001 (天罰不極), KR3c0004 (both arms), KR3j0002 (兼而食之, the judges
agree) and T0001.

**Limits.** These are AI judges and AI readers (Opus), not a scholar. Two of the arms' families are judged by one of
them. The Chinese set has no production arm. The set is not proportional to the gap, and KR4 is 12% of the set
against ~29% of the gap. Pali's 40 pages come from 13 works, so its interval is by work. Sanskrit has 23 new pages,
not 60.
