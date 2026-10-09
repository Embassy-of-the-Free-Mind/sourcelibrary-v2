# Preregistration — #6038 run 2: is "about a third of our works are unknown to AI" true?

PRIOR ART: scripts/eval/PREREGISTRATION-engine-wave1-6011.md — the form this follows. Run 1 of this issue
(PR #6041, `scripts/eval/ai-exposure-6038.mjs`) had no preregistration; this run answers its critiques.

**Committed before any run-2 model call** (2026-10-06, ~22:45 UTC). Nothing below changes after a
result is seen. Any analysis not listed here is labelled *post hoc* in the report.

Code: `scripts/eval/ai-exposure-r2-6038.mjs` (it imports run 1's helpers; run 1's script is unchanged apart
from exports). Results: `scripts/eval/results/ai-exposure-r2-6038/`. Write-up:
`scripts/eval/experiments/2026-10-07-ai-exposure-run2-6038.md`.

## What is being measured

WORK-level knowledge: does a model know a work well enough to name its author from the title
alone? It does not ask whether a model saw our scan or our transcription (#5549: unpowered).
**Knowledge here is a fact test, not self-report.** The claim under test is run 1's working line:
"about a third of the distinct works we hold are not recognised by frontier models" (run 1: 32.7%
[28.7–37.0] recognised by none of four models, self-report).

## Population and sample (fixed by run 1)

The seeded random 500 (`in_sub500`, seed 6038) of run 1's work-uniform main sample of 2,000, drawn
from every book with OCR text (visible and held). Same 500, same packets. No redraw.

## Arms

| arm | prompt | models | items |
|---|---|---|---|
| **neutral** (critique 2) | run 1's prompt minus the one sentence `Be honest: "no" and "unknown" are good answers.` "Never invent a quotation" stays. Same packets, same lines (title, author, year, language). | Gemini 3.1 Pro (thinking 1024, T=0); Claude Haiku (subscription subagents) | 500 + run 1's 86 controls |
| **verify** (critique 1) — PRIMARY | title only, with the catalogue author's surname masked as `[…]` wherever the title prints it; year of the edition; language. Asks `known` (yes/no/unsure), `author` (Latin script), `author_native`, `author_is_guess`, `date`, `about`. | Gemini 3.1 Pro; Claude Opus (subscription subagents, model "opus"); GPT-5.6 Sol (`openai/gpt-5.6-sol`, OpenRouter, reasoning effort low); Claude Haiku (subagents) | 500, controls (below), Nālandā slice |
| **verify, replicate** (critique 8) | identical to verify | Gemini 3.1 Pro, second run, new requests | 500 |
| **verify, one per request** (critique 7) | verify prompt with a single work, no decoys | Gemini 3.1 Pro | seeded 100 of the 500 (`single100-ids.json`) |

Packet rules (as run 1): ≤ 28 items; never two works of one author or one work in a packet; every
sample packet carries 2 invented decoys and 1 canonical work. Subagents: ≤ 8 agents, ≤ 25 packets
each, answer from memory with no tools other than reading the packet and writing the answer; an
agent never sees both a neutral packet (author shown) and a verify packet (author withheld).

## Controls (verify arm)

Run 1's 24 canonical, 22 known-not-canonical and 40 invented decoys, plus a NEW **obscure-known
tier of 25**: works from the 500 that run 1's Pro AND Haiku both recognised, with ≤ 2 editions, a
scorable catalogue author not printed in the title, an identifiable title, distinct authors, seeded
draw (`controls.jsonl`, `control: obscure`). It estimates the verify arm's *sensitivity* on minor
works a model claims to know.

## Scoring (mechanical; no LLM judge)

- **Catalogue author** (`parseCatalogueAuthor`): split on `;`, `|`, ` / `, `&`, `and`; drop
  translators/editors (`(ed.)`, `trans. X`, `, ed.`), dates, institutions ("Monastery Collection",
  "Society", "Church" …) and sentinels (Unknown, Anonymous, Various …). A record with no person
  left is **not author-scorable** and is reported separately ("no catalogue author", "editor/
  translator only", "institution").
- **Match** (`scoreAuthor`), per .claude/docs/invariants/non-latin-text-operations.md: Latin script
  is folded (accents, umlaut digraphs, u/v, i/j/y, ae/oe, k/c, ph/th/sh/ch, doubled letters) and
  Latin endings stripped; the catalogue SURNAME must match a token of the model's author (equal, a
  prefix within 3 letters for stems ≥ 5, or edit distance 1 for stems ≥ 6); a surname under 4
  letters also needs a given-name match. Han, Kana, Tibetan, Hangul compare by containment of the
  name core; Cyrillic, Greek, Hebrew, Arabic, Devanagari by word. Outcomes: `match`, `mismatch`,
  `none` (the model said unknown), `unjudgeable` (the model named someone in a form we cannot
  compare, e.g. romanised only against a Han catalogue name). **Unjudgeable is never counted as a
  match and is reported as its own bucket.**
- **Verified knowledge (V2)** = `match`, whatever `known` and `author_is_guess` say.
  **Verified recognition (V1)** = `match` AND `known = yes`.
  **Hidden knowledge** = `known ∈ {no, unsure}` AND `match`. **Bluff** = `known = yes` AND `mismatch`.
- **Identifiable title** (`identifiability`, rules): not identifiable if a Kanjur/Tengyur or
  Tibetan collection-volume label, a shelfmark or accession record, or a title of only generic
  words / too short to name a work. Checked by eye on a seeded 40 (labelled blind to the rule
  label; `eye-identifiability.jsonl`).

## PRIMARY ESTIMAND

> **P = share of W with no verified knowledge (V2) by ANY of the gated verify-arm models**
> (Pro, Opus, GPT-5.6 Sol, Haiku), where **W = works in the random 500 whose title is identifiable
> (rules) and whose catalogue author is scorable.** 95% Wilson interval.

Also reported, same definition: the **unrestricted** version over all 500 (works without a scorable
author count as "no verified knowledge" — an upper bound, labelled so); P per model; P for the union
of Pro + Opus + GPT (without Haiku).

## Gates (per model, verify arm, on the controls) — decided now

A model enters the union only if, on the verify-arm controls:
1. canonical works with a scorable author: V2 ≥ 85%;
2. invented decoys: `known = yes` ≤ 10%;
3. shuffled-author null (each answer scored against the catalogue author of another work in the same
   language, different author and work, seeded): match rate ≤ 2%. If a model exceeds 2%, P is
   recomputed with an exact-surname matcher (no prefix, no edit distance) and both are reported.
4. ≤ 10% of its sample items missing after 3 attempts per packet.
A model that fails is reported, excluded from the union, and the union is shown with and without it.
**If Pro fails gate 1 or 2, the instrument is broken: no primary is reported.**

The obscure-known tier has no gate. If Pro's V2 on it is < 50%, the report says the fact test misses
most minor works that models claim to know, so P is an upper bound on "unknown".

## Retraction rule for "about a third" — decided now

- **Supported** if P's point estimate is in [27%, 40%].
- **Retracted** if P's 95% CI lies wholly below 27% or wholly above 40%; the report then leads with
  "RETRACT" and the replacement number.
- Otherwise (point estimate outside, CI overlapping the band): **weakened**; quote P, not "a third".

## Secondary analyses (all preregistered)

1. **Prompt bias (neutral vs run 1):** for Pro and Haiku, the share NOT recognised (knows_of ≠ yes,
   self_familiar ≠ yes, no verified opening) on the same 500, run 1 vs neutral; paired difference with
   a 4,000-resample bootstrap CI and the discordant counts. yes / no / unsure reported separately for
   `knows_of`, and "not recognised" computed both as `no` only and as `no or unsure`.
2. **Hidden knowledge and bluff rates** per model (definitions above). By eye: up to 40 seeded Pro
   bluffs and up to 40 Opus bluffs are read to judge whether the model's author is defensibly right
   (alias, praeses vs respondent, catalogue error). The defensible share gives an adjusted P
   (works whose only evidence against knowledge is a defensible bluff are moved to "known"), reported
   as secondary.
3. **Identifiable vs unrestricted**, and rule–eye agreement on the 40 (% and κ).
4. **True Nālandā slice** (`nalanda.jsonl`): 17 works by the Nālandā masters that we hold (any
   language, one edition per work; Kanjur/Tengyur volume records excluded), plus 7 Tibetan
   commentaries on Nālandā works as a labelled second group. Reported with n; verify arm, all models.
5. **Opus / GPT vs Pro:** V2 per model on the 500, pairwise agreement (κ) and discordant counts.
6. **List vs one per request:** Pro on the 100, V2 and `known` in single requests against the same
   works in Pro's list answers; paired difference, κ.
7. **Test–retest:** Pro verify run 1 vs run 2 on the 500: κ and raw agreement on `known` (3 classes)
   and on V2.
8. **Units:** P weighted by volumes (books in the work), by pages (sum of `pages_count` over the
   work's books) and by approximate tokens (pages × characters per OCR page of the sampled edition's
   first ≤ 15 OCR'd pages ÷ 4). Ratio estimates with 4,000-resample percentile bootstrap CIs over works.
   Breakdowns by century (edition year; many records have none → "unknown") and by coarse genre
   from title rules (disputatio/oratio/dissertatio; scripture/commentary; manuscript; other).
9. **Sensitivity, disclosed as written after the eye check:** a strict identifiability rule that also
   drops Latin-script titles of ≤ 4 words of ≥ 3 letters. It is crude (it drops *Sidereus Nuncius*
   too), and is shown only as a bound.

## Cost and stop rules

- Hard cap **$20** for run 2 across Gemini (metered under `gemini_usage` endpoint
  `eval/ai-exposure-refresh`) and OpenRouter (billed `usage.cost`). Calls stop at $19.50.
  OpenRouter's account balance on 2026-10-06 is ~$6; if it runs out, the GPT arm stops where it is.
- If the cap would be hit, arms are dropped in this order: GPT on the 500 (cut to 200), then the
  replication, then the one-per-request arm. The report says which.
- Three attempts per packet; a packet still unparsable leaves its works missing for that model.

## Known limitations, stated in advance

- The catalogue author is the reference. Where it is wrong, or names the praeses where the model
  names the respondent, a true "known" scores as a bluff, which biases P upward (analysis 2 measures it).
- A model may infer an author from a title without knowing the work; `author_is_guess` and the
  decoys bound this, the shuffled null does not.
- Opus runs as Claude Code subagents of the same model as the analyst, from memory, with the tool
  restriction stated in the prompt; GPT runs through OpenRouter with low reasoning effort.
- 253 of the 500 records have no edition year, so the century breakdown is thin.
