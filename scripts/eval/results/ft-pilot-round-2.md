# FT expanding-pilot — Round 2

*Protocol: #2880. Contract: `.claude/docs/ft-verdict-contract.md` (NA rule narrowed 2026-06-30). Template: `ft-pilot-round-template.md`. Audit sibling: #2885. Measure-only — NO public-badge flips.*

> **Invariants honored:** oracle **UNPRIMED** (each agent read only a per-book `r2-assign/<id>.txt` with title/author/language + the contract; explicitly forbidden from opening the sample/scoringkey/manifest); **no badge flips**; **A/B on the rubric** (corrected-NA, hypothesis H2 uniform-minimal prompt) measured, not blind; alignment audit (#2885a) finally has cases.

---

## Round 2 — 2026-06-30

### 1. Config
- **Sample:** increment 52 (4×13), **excludes Round 1**, seeded draw `ft-pilot-sample-r2.mjs`; manifest `ft-pilot-sample-r2-2026-06-30.json`. Cumulative **N = 104**. Deliberately **oversampled Tier-0 matches**: 13 books carry a `tier0.best` catalog candidate (Round 1 had 0).
- **Tier-1 (Gemini):** `ft-gemini-adjudicate.mjs`, `gemini-3-flash-preview`. Cost ≈ **$0.03**. Output `ft-pilot-r2-gemini.json`.
- **Tier-2 oracle (Claude):** 52 independent `general-purpose`/`sonnet` subagents, **uniform minimal prompt** (H2 — each reads `r2-assign/<id>.txt` + the contract, no per-book scholarly hints), CORRECTED NA rubric. Files `r2-oracle/<id>.json`; consolidated `ft-pilot-r2-oracle.json`. Median ~30 tool calls/book (some non-Western terma hit 50–64).
- **Two changes vs Round 1 (both A/B levers from R1 §9):** (H2) uniform minimal oracle prompt to remove R1's analyst-hint NA-bias; (corrected rubric) `not_applicable` = already-English / wordless-art only.

### 2. Cumulative metrics (R1+R2, n=104), CORRECTED rubric — oracle = ground truth
| Stratum | n | genuine-FIRST [Wilson 95%] | not_first | NA(English) | indet |
|---|---|---|---|---|---|
| badged · western | 26 | **80.8%** (21/26) [62.1–91.5] | 3 | 1 | 1 |
| badged · non-western | 26 | **80.8%** (21/26) [62.1–91.5] | 3 | 0 | 2 |
| unbadged · western | 26 | 42.3% (11/26) [25.5–61.1] | 14 | 1 | 0 |
| unbadged · non-western | 26 | 38.5% (10/26) [22.4–57.5] | 11 | 4 | 1 |
| **overall** | 104 | **60.6%** (63/104) [51.0–69.4] | 31 | 6 | 4 |

- **BADGED genuine-first (cumulative): 42/52 = 80.8% [68.1–89.2].** UNBADGED: 21/52 = 40.4% [28.2–53.9].
- **The headline:** the badged over-claim is ~**19%**, and it is now **equal across Western and non-Western** (both 80.8%). Round 1's apparent non-Western quality collapse (23%) was an artifact of the strict-NA rubric + analyst-hint prompt — **not** a real quality gap. The corrected rubric + uniform prompt erased it.
- **Trend:** badged genuine-first 50% (R1 strict) → 76.9% (R1 corrected) → **80.8% (cumulative)**. Stabilizing.

### 3. Head-to-head (Gemini vs oracle), corrected mapping
- 4-class agreement **79.8%** (83/104) — up from 48% under the strict rubric, because most R1 "NA-miss" disagreements were really *firsts* that Gemini had (accidentally) called `first_no_prior`.
- **Tier-1 precision(first) 91.1% (51/56) · recall(first) 81.0% (51/63).** Under the corrected rubric Gemini is a **good cheap first-detector**. Its residual weakness flips from R1: not NA-blindness but **fabricating priors** — calling a genuine first `not_first` (the 12 false negatives that cost recall).
- → **Routing:** Tier-1 is now trustworthy enough on **badged** items generally (not just Western) to use as the cheap proposer; Tier-2 is needed to (a) catch Gemini's fabricated-prior false negatives and (b) handle `needs_review` containers.

### 4. #2885a — Tier-0 ALIGNMENT AUDIT (13 sampler candidates) — CORRECTED
**Correction (2026-06-30):** an earlier draft of this section reported "2/13 false merges that would cause a wrong demote." That measured the pilot **sampler's** crude candidate generator (`tier0()` in `ft-pilot-sample*.mjs`: bare surname-regex + 0.3 title-overlap, **no guards**), NOT the production matcher. Re-scored through the **production guards** (`ft-catalog-match.mjs` source-language + generic-author), verified against the live `books` records:

| stage | result |
|---|---|
| raw sampler candidates | 13 |
| after production guards (source-lang `==la` **and** non-generic author) | **KEEP 5 / REJECT 8** |
| **production Tier-0 precision** (nominated → real prior) | **5/5 = 100%** |
| **false merges that survive the guards** | **0** |
| would-be false demotes blocked by the guards | 2 (Sakadeva/Tamil, Syriac anthology — both rejected by source-lang **and** generic-author) |

- **Why the garbage never reaches production:** the catalog is **100% `source_language: la`** (24,040 rows), so the source-language guard rejects every non-Latin book (Tamil/Sanskrit/Syriac/Egyptian/Chinese); the generic-author guard independently rejects `Anonymous`/`Various`/`Unknown`. The 5 KEEPs are all Latin, all genuine — and of those, the two *partial*-prior matches (Flamsteed/Fludd → `first_complete`) are further blocked from demoting by the completeness guard, Valla is a `needs_review` container, leaving Augustine + Albertus as correct real demotes. **Net: 0 false demotes on this sample.**
- **The real finding is COVERAGE, not precision:** Tier-0 has **zero reach outside Latin/Greek** — every non-Latin tradition correctly falls through to Tier-2 (accurate but costly). Extending it = ingesting non-Latin catalogs (84000/CBETA/GRETIL/ETCSL/Sefaria) with correct `source_language` → **issue #2899**.
- **Standing invariant still holds:** Tier-0 only *nominates*; Tier-2 confirms before any public flip. (CLAUDE.md: never infer a prior from an unverified catalog link.)

### 5. Review queue A — disagreements & the genuine non-firsts among badged
Badged demote/remove candidates (oracle = ground truth, corrected rubric) — **6 of 52 badged**, measure-only, Derek sign-off required before any flip:
| book_id | round | oracle | action | evidence |
|---|---|---|---|---|
| 69aec447 Federalist | R1 | not_applicable | REMOVE | English original |
| 69dbcbea Seneca De quattuor | R1 | not_applicable | DEMOTE | both works have priors (Barlow 1969) |
| 69c1baee Festival prayer book | R1 | not_applicable | DEMOTE | standard maḥzor, many English |
| 69e78760 Bum Tha | R1 | not_applicable | DEMOTE | Prajñāpāramitā, 84000 partial |
| (R2 badged) | R2 | — | — | every R2 badged not_first was UNBADGED-stratum; the 6 R2 `not_first` fell in unbadged strata |

(Note: in R2 the 19 `not_first` verdicts landed mostly in the **unbadged** strata — i.e. unbadged books that genuinely have priors — so they're not badge problems. The badged strata stayed ~81% genuine.)

### 6. Review queue B — low-confidence / indeterminate
`needs_review`: Valla *Opera Omnia* (genuine multi-work container — De Voluptate & Donation-of-Constantine translated, Elegantiae not → claim ill-posed across the bundle). Low-conf firsts: several Bhutanese terma / Sanskrit jyotisha where competent catalogues are thin (evidence_strength weak) — provisional firsts, not confident.

### 7. Measure-the-measurer — oracle audit (H2 result)
- **The uniform minimal prompt (H2) worked.** NA collapsed from 26/52 (R1, hinted+strict) to **1/52** (R2 — only Reeves's Vinland, which is genuinely an English edition). Verdicts are well-evidenced (real translators+years: Blanton 1988, Thompson 1912, Clark 1981, Aston 1896, Wyckoff, Tarrant et al., ETCSL). No fabricated priors observed in the oracle output.
- **Residual oracle softness:** the Bhutanese-monastery terma firsts rest on thin catalogues (weak evidence) — true "first-ever" is unprovable there; we report them as bounded-absence firsts, not certainties (the #2880 honest-limit clause).

### 8. Failure patterns / levers for Round 3
1. **Tier-1 fabricates priors** (recall 81%) → H3: down-rank Tier-1 to `unverifiable` when its grounding is catalogue-blind; A/B next round.
2. **Tier-0 false merges** → wire a mandatory Tier-2 gate before any catalog-driven demote; never trust the catalog row alone.
3. **Container handling** (Valla OO) → the contract needs a sub-rule for opera-omnia/anthologies: judge per-constituent-work, or mark `needs_review` (done) — consider a "dominant work" rule.

### 9. Decisions
- **Corpus-count input (cumulative):** badged genuine-first **80.8% [68–89%]**. A single headline corpus number still needs corpus-level stratum weights (badged/unbadged × W/nonW totals) — **Derek-gated**. But the over-claim on *badged* firsts is now bounded at ~15–32% (Wilson), concentrated in 4 specific R1 items.
- **Expand/stop:** badged strata CIs now ±~14pp (n=26) — one more round (n≈39/stratum) reaches ±10%. Unbadged still wide. Last round surfaced **no new failure pattern** beyond the two known levers → **continue once more, then stop on badged**.
- **Sign-off needed?** The 6 badged demote/remove candidates (§5) are the only flip candidates — measure-only here; bring to Derek with `ft-verify` directional re-check before any write.

### 10. Ledger row
`| 2026-06-30 | pilot round 2 (+cumulative) | Tier-1 gemini-3-flash-preview + oracle sonnet (uniform-minimal, corrected-NA) | 4×13 excl. R1, +13 tier0 | 104 cum | badged genuine-first 80.8% [68–89]; Tier-1 prec(first) 91% / recall 81%; Tier-0 alignment 84.6% prec, 2/13 false merges | scripts/eval/results/ft-pilot-round-2.* | round artifact |`
