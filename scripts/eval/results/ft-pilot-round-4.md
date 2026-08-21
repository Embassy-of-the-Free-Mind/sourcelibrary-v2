# FT expanding-pilot — Round 4

*Protocol: #2880. Contract: `.claude/docs/ft-verdict-contract.md` (corrected NA). Audit sibling: #2885. Measure-only — NO public-badge flips.*

> **Invariants honored:** oracle **UNPRIMED** (per-book `r4-assign/<id>.txt` = title/author/language only + the contract); **no badge flips**; corrected-NA rubric; uniform-minimal prompt.

---

## Round 4 — 2026-06-30

### 1. Config
- **Sample:** increment 52 (4×13), **excludes R1+R2+R3** (156 prior ids), seeded draw `ft-pilot-sample-r4.mjs`; manifest `ft-pilot-sample-r4-2026-06-30.json`. **Cumulative N = 208.** 14 Tier-0 catalog candidates.
- **Tier-1 (Gemini):** `gemini-3-flash-preview`. Cost ≈ **$0.02**. Output `ft-pilot-r4-gemini.json`.
- **Tier-2 oracle:** 52 independent `sonnet` subagents, uniform-minimal prompt, corrected-NA rubric. Files `r4-oracle/<id>.json`; consolidated `ft-pilot-r4-oracle.json`. Ran clean — no login interruption this round.
- **Rationale for a 4th round** (after R3 recommended stop): tighten the still-wide **unbadged/recall** strata (±15pp) and push badged toward ±8pp. Confirms convergence rather than re-deriving it.

### 2. Cumulative metrics (R1–R4, n=208), CORRECTED rubric — oracle = ground truth
| Stratum | n | genuine-FIRST [Wilson 95%] | not_first | NA | indet |
|---|---|---|---|---|---|
| badged · western | 52 | **75.0%** (39/52) [61.8–84.8] | 10 | 2 | 1 |
| badged · non-western | 52 | **73.1%** (38/52) [59.7–83.2] | 10 | 1 | 3 |
| unbadged · western | 52 | 44.2% (23/52) [31.6–57.7] | 27 | 2 | 0 |
| unbadged · non-western | 52 | 32.7% (17/52) [21.5–46.2] | 26 | 6 | 3 |
| **overall** | 208 | **56.3%** (117/208) [49.5–62.8] | 73 | 11 | 7 |

- **BADGED genuine-first (cumulative): 77/104 = 74.0% [64.9–81.5].** UNBADGED: 40/104 = 38.5% [29.7–48.1].
- **Convergence confirmed.** Badged genuine-first across rounds: R1corr 76.9% → R2cum 80.8% → R3cum 74.4% → **R4cum 74.0%**. The estimate is stable at **~74% [65–82]** and the Western/non-Western gap is fully closed (75.0% vs 73.1%, within 2pp). CI tightened to **±8.3pp (n=104 badged)**.
- **Unbadged** settled to **38.5% [30–48]** — a meaningful recall signal: roughly 2 in 5 *unbadged* eligible books are genuine firsts we haven't claimed.

### 3. Head-to-head (Gemini vs oracle), corrected mapping
- 4-class agreement **79.8%** (166/208) — rock-stable across all four rounds.
- **Tier-1 precision(first) 85.1% (97/114) · recall(first) 82.9% (97/117).** Gemini is a dependable cheap proposer; Tier-2 confirms consequential flips.

### 4. #2885a — Tier-0 ALIGNMENT AUDIT (cumulative R2–R4) — full production guard set
Re-scored through **all three load-bearing production guards** (`ft-catalog-match.mjs`: source-language `==la` + non-generic author + **title-coverage ≥0.6**). Round 4 surfaced one candidate (Johannes Andreae's *Summa de sponsalibus*, matched to a music-theory "Summa" row at title-overlap 0.33) that survived the first two guards but is **correctly rejected by the 0.6 title-coverage threshold** — confirming that gate is also load-bearing.

| stage | result |
|---|---|
| raw sampler candidates | 37 |
| after all production guards | **KEEP 7 / REJECT 30** |
| **production Tier-0 precision** (nominated → real prior) | **7/7 = 100%** |
| **false merges surviving guards** | **0** |
| would-be false demotes blocked by guards | 8 |

- **The 0.6 title-coverage threshold trades recall for precision by design:** Tier-0 nominates only **7 of 37** high-confidence matches and **defers the other 30 — including real priors like the Hermetica/Pymander and Origen (title-overlap 0.3–0.5) — to Tier-2.** So Tier-0 is *never wrong on what it claims* (100% precision, 4 rounds, 0 false merges) but deliberately conservative. This is the correct nominate-then-verify design.
- **Standing finding unchanged:** Tier-0's gap is **coverage** (Latin-only, 24,040 rows all `src=la`) → #2899 (in progress). Every non-Latin tradition correctly defers to Tier-2.

### 5. Badged sign-off candidates (R4) — measure-only, NOT flipped
7 of 26 R4 badged read demote/remove (corrected rubric):
| action | work | oracle | prior |
|---|---|---|---|
| REMOVE | Wycliffe Bible Vol. 2 | not_applicable | Middle English (already English) |
| DEMOTE | Boethius, Consolation of Philosophy | not_first | Watts 1969 / Relihan 2001 (Chaucer cited but modern exists) |
| DEMOTE | van Helmont, Adumbratio Kabbalae Christianae | not_first | Spector 2012 (Brill) |
| DEMOTE | (pseudo-)Tauler, Exercitia | not_first | Cruikshank 1875/1906 |
| DEMOTE | Galen, jeu de la paume (French) | not_first | Singer 1997 / Johnston 2018 (source-lang rule) |
| DEMOTE | Codex Vaticanus Syriacus 160 (Life of Symeon) | not_first | Lent 1915 / Doran 1992 |
| DEMOTE | Yemenite Hebrew Bible (incomplete) | not_first | KJV 1611 + modern (scripture) |

→ These 7 (plus 6 R1/R2 + 9 R3 = **22 cumulative**) require the directional `ft-verify` pass + Derek sign-off before any flip. (Watch: Boethius cites Chaucer as a prior but a modern Watts/Relihan exists, so the demote holds; the verify confirms a complete + modern prior.)

### 6. Notable verdicts (instrument quality)
The oracle drew careful `first_complete` lines on partial-prior containers: **Aretino** (sonnets translated, *Dubbj amorosi* not), **Huygens Oeuvres T12** (one paper in *Pi: A Source Book*, rest untranslated), **Ephrem Opera Omnia v3** (only the Paradise hymns Englished), **Bredero** (only *Spaanschen Brabander*), **Sancai Tuhui v25** (Goodall's 120 plates ≪ the volume). `first_modern` for **Comenius Lux in Tenebris** (Codrington 1664, pre-1900). `first_from_source` for the **Armenian Andrew+Arethas Apocalypse** recension. These are exactly the distinctions a single Tier-1 pass misses.

### 7. Stop check — STOP CONFIRMED
- Badged CI now **±8.3pp (n=104)**; estimate stable at **74% [65–82]** for two consecutive cumulative rounds. A 5th round would gain ~1pp.
- **No new failure pattern** in R4 beyond the two known levers (Tier-1 prior-fabrication; Tier-0 Latin-only coverage = #2899). Loop-until-dry on failure modes satisfied across 4 rounds.
- → **STOP the measurement.** The defensible headline input is locked: **badged genuine-first ≈ 74% [65–82]**.

### 8. Ledger row
`| 2026-06-30 | pilot round 4 (+cumulative n=208) — STOP | Tier-1 gemini-3-flash-preview + oracle sonnet (uniform-minimal, corrected-NA) | 4×13 excl. R1-R3, +14 tier0 | 208 cum | badged genuine-first STABLE 74.0% [65–82] (W 75.0 / nW 73.1); unbadged 38.5% [30–48]; T1 prec 85% / recall 83%; Tier-0 full-guard 7/7=100%, 0 false merges (0.6 title gate is load-bearing); convergence confirmed → STOP | scripts/eval/results/ft-pilot-round-4.* | round artifact |`
