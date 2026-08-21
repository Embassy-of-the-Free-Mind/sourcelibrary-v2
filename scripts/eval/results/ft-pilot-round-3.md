# FT expanding-pilot — Round 3

*Protocol: #2880. Contract: `.claude/docs/ft-verdict-contract.md` (corrected NA). Audit sibling: #2885. Measure-only — NO public-badge flips.*

> **Invariants honored:** oracle **UNPRIMED** (per-book `r3-assign/<id>.txt` = title/author/language only + the contract; agents forbidden to open sample/scoringkey/manifest); **no badge flips**; corrected-NA rubric; alignment audit (#2885a) extended.

> **Operational note (login interruption):** a mid-round `/login` killed ~27 in-flight oracle subagents (Claude-auth dependent; they returned "Not logged in"). Tier-1 Gemini is API-key-based and resumed cleanly (durable JSONL). All 27 casualties were re-dispatched from their unchanged `r3-assign` files → full 52/52 recovered. One re-dispatch (Atiśa phreng-mo divination) **corrected** its first pass — the second agent found the Nielsen 2019 prior the first missed (`first_no_prior`→`not_first`), an incidental demonstration of independent-pass value.

---

## Round 3 — 2026-06-30

### 1. Config
- **Sample:** increment 52 (4×13), **excludes R1+R2** (104 prior ids), seeded draw `ft-pilot-sample-r3.mjs`; manifest `ft-pilot-sample-r3-2026-06-30.json`. **Cumulative N = 156.** 10 Tier-0 catalog candidates (for #2885a).
- **Tier-1 (Gemini):** `gemini-3-flash-preview`. Cost ≈ **$0.02**. Output `ft-pilot-r3-gemini.json`.
- **Tier-2 oracle:** 52 independent `sonnet` subagents, uniform-minimal prompt, corrected-NA rubric. Files `r3-oracle/<id>.json`; consolidated `ft-pilot-r3-oracle.json`.
- **Sample composition:** R3 deliberately reached deeper into demote-heavy canonical works (Genji, Poetic Edda, Cicero De officiis, Durkheim, Proudhon, Zohar, Eusebius, Bṛhat Saṃhitā, Three Kingdoms, NT/Peshitta) — so the badged stratum carries more genuine `not_first` than R2. This pulls the cumulative badged rate to a **more representative** value.

### 2. Cumulative metrics (R1+R2+R3, n=156), CORRECTED rubric
| Stratum | n | genuine-FIRST [Wilson 95%] | not_first | NA | indet |
|---|---|---|---|---|---|
| badged · western | 39 | **76.9%** (30/39) [61.7–87.4] | 6 | 2 | 1 |
| badged · non-western | 39 | **71.8%** (28/39) [56.2–83.5] | 8 | 0 | 3 |
| unbadged · western | 39 | 46.2% (18/39) [31.6–61.4] | 19 | 2 | 0 |
| unbadged · non-western | 39 | 35.9% (14/39) [22.7–51.6] | 18 | 5 | 2 |
| **overall** | 156 | **57.7%** (90/156) [49.8–65.2] | 51 | 9 | 6 |

- **BADGED genuine-first (cumulative): 58/78 = 74.4% [63.7–82.7].** UNBADGED: 32/78 = 41.0% [30.8–52.1].
- **Trend across rounds (badged genuine-first):** R1 corrected 76.9% → R2 cum 80.8% → **R3 cum 74.4%**. The dip is the demote-heavy R3 draw, not instability — Western (76.9%) and non-Western (71.8%) are within ~5pp of each other, confirming the R2 finding that there is **no real W/non-W quality gap** (the strict-NA artifact is gone). CI tightened from ±11pp (n=52) to **±9.5pp (n=78)**.

### 3. Head-to-head (Gemini vs oracle), corrected mapping
- 4-class agreement **80.1%** (125/156) — stable across rounds.
- **Tier-1 precision(first) 86.2% (75/87) · recall(first) 83.3% (75/90).** Gemini remains a solid cheap first-detector; its errors are split (some fabricated priors, some missed priors). Stable enough to use as the cheap proposer on badged items, with Tier-2 confirming consequential flips.

### 4. #2885a — Tier-0 ALIGNMENT AUDIT (cumulative R2+R3, 23 sampler candidates)
Re-scored through the **production guards** (`ft-catalog-match.mjs`: source-language `==la` + non-generic author), verified vs live records:

| stage | result |
|---|---|
| raw sampler candidates | 23 |
| after production guards | **KEEP 10 / REJECT 13** |
| **production Tier-0 precision** (nominated → real prior) | **10/10 = 100%** |
| **false merges surviving guards** | **0** |
| would-be false demotes blocked by guards | 4 |

- All 10 production-equivalent nominations are correct (Flamsteed/Fludd `first_complete` — partial priors, completeness-guarded from demoting; Valla `needs_review` container; Augustine/Albertus/Ficino-Hermetica×2/Eusebius/Croll/Cicero all real priors). **Zero false demotes across both rounds.**
- **The standing finding is unchanged: Tier-0's precision is fine; its GAP is coverage** — it reaches only Latin/Greek, so every non-Western tradition correctly defers to Tier-2. (Extending it = **#2899**, in progress.)

### 5. Badged sign-off candidates (R3) — measure-only, NOT flipped
9 of 26 R3 badged books read demote/remove (corrected rubric):
| action | work | oracle | claimed prior |
|---|---|---|---|
| REMOVE | Moninckx Atlas vol. 9 | not_applicable | wordless botanical plates (visual art) |
| DEMOTE | Pymander (Ficino Hermetica) ×2 | not_first | Copenhaver 1992 (modern); **NB Everard 1650 is pre-1900 — verify a MODERN complete prior** |
| DEMOTE | Herculaneum Volumina V (Philodemus) | not_first | Hubbell 1920 |
| DEMOTE | Ge'ez Psalter | not_first | Pietersma NETS 2007 (Psalms, source-lang rule) |
| DEMOTE | Atiśa phreng-mo divination | not_first | Nielsen 2019 |
| DEMOTE | Armenian NT (trilingual) | not_first | KJV 1611 + modern (scripture) |
| DEMOTE | Genji Monogatari vol. 1 | not_first | Waley 1933 / Seidensticker 1976 |
| DEMOTE | Poetic Edda (Sæmundar Edda) | not_first | Thorpe 1866 / Bellows 1923 / Larrington 1996 |

→ **These 9 (plus the 6 from R1/R2) require the directional `ft-verify` pass before any flip** (the R1/R2 verify already SAVED 1 of 7 — partial-prior false demotes are real). The Pymander/Everard pre-1900 nuance is exactly the kind the verify catches. Derek sign-off + backup required.

### 6. Low-confidence / needs_review (R3)
`needs_review`: Valla *Opera Omnia* (container; recurs from R2 draw logic), Gikatilla "collection of kabbalistic texts" (manuscript miscellany — verdict turns on which texts it bundles; Sha'are Orah is Englished, the minor works are not). `first_from_source` (2): Béroalde *Tableau* and the Alchimistisch Sieben-Gestirn — distinct French/German intermediaries of works Englished only from the original language.

### 7. Stop check
- **Badged CIs now ±9.5pp (n=78).** A 4th round (n≈104/stratum equivalent) would reach ~±8pp — **diminishing returns**; the badged genuine-first rate has converged to **~74% [64–83]** and the W/non-W gap is closed.
- **No new failure pattern** surfaced in R3 beyond the two known levers (Tier-1 prior-fabrication; Tier-0 Latin-only coverage = #2899). Loop-until-dry on failure modes is satisfied.
- → **RECOMMEND STOP on the badged measurement.** Remaining open work is (a) the `ft-verify` + Derek sign-off on the 15 cumulative badged candidates, (b) #2899 coverage, (c) a corpus-count headline decision (Derek-gated).

### 8. Ledger row
`| 2026-06-30 | pilot round 3 (+cumulative n=156) | Tier-1 gemini-3-flash-preview + oracle sonnet (uniform-minimal, corrected-NA) | 4×13 excl. R1+R2, +10 tier0 | 156 cum | badged genuine-first 74.4% [64–83] (W 76.9 / nW 71.8 — gap closed); Tier-1 prec 86% / recall 83%; Tier-0 alignment 10/10=100%, 0 false merges; survived a /login mass-kill via re-dispatch | scripts/eval/results/ft-pilot-round-3.* | round artifact |`
