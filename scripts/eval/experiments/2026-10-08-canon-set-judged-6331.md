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

### Result

(filled after scoring)
