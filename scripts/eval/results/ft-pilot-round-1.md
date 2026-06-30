# FT expanding-pilot — Round 1

*Protocol: #2880. Contract: `.claude/docs/ft-verdict-contract.md`. Template: `.claude/docs/ft-pilot-round-template.md`. Audit sibling: #2885. Measure-only — NO public-badge flips.*

> **Invariants honored:** oracle **UNPRIMED** (fed only title/author/language — never the badge, `disposition`, `tier0`, or stratum); **no badge flips** (this file records measurements + sign-off candidates only); the random spot-check is recorded in §6; the oracle audit in §7.

---

## Round 1 — 2026-06-30

### 1. Config
- **Sample:** increment 52 (strata: 4×13, badged-vs-unbadged × Western-vs-non-Western) · cumulative **N = 52**. Source manifest: `scripts/eval/results/ft-pilot-sample-2026-06-29.json` (PR #2887). Unprimed worklist: `ft-pilot-r1-worklist.json`; scoring key (badge/stratum/tier0, never shown to a model): `ft-pilot-r1-scoringkey.json`.
- **Tier-1 (Gemini):** `ft-gemini-adjudicate.mjs`, model `gemini-3-flash-preview` (Google-Search grounded), temp 0.1. Output: `ft-pilot-r1-gemini.json` (+ `.jsonl`). **Run cost ≈ $0.03.**
- **Tier-2 oracle (Claude):** 52 **independent** `general-purpose` subagents (model `sonnet`), one per book, refute-framed, real `WebSearch`/`WebFetch`, §2 unified prompt → §1 contract. Per-book files: `scripts/eval/results/r1-oracle/<id>.json`; consolidated: `ft-pilot-r1-oracle.json`. Subscription compute (no API $); ~5–68 tool calls/book (median ~25).
- **Escalation this round:** oracle run on **all 52** (the comment on #2880 directs "run both over manifest" for the first real round; selective escalation begins Round 2). 
- **A/B arms tested:** none (Round 1 establishes the baseline instrument).
- **Scorer:** `scripts/eval/ft-pilot-score.mjs` (Wilson 95% + 4-class Cohen's κ; pure read, no writes).

### 2. Metrics (this round = cumulative), by stratum
Oracle = ground truth. "T1" = Tier-1 Gemini. FIRST family = {first_no_prior, first_from_source, first_complete, first_modern}.

| Stratum | n | T1 precision(first) | T1 recall(first) | T1 fabrication | oracle genuine-FIRST rate [Wilson 95%] |
|---|---|---|---|---|---|
| badged · western | 13 | **90.0%** (9/10) | 90.0% (9/10) | 33.3% (1/3) | 10/13 = **76.9%** [49.7–91.8] |
| badged · non-western | 13 | **30.0%** (3/10) | 100% (3/3) | 0% (0/2) | 3/13 = 23.1% [8.2–50.3] |
| unbadged · western | 13 | 40.0% (2/5) | 100% (2/2) | 0% (0/6) | 2/13 = 15.4% [4.3–42.2] |
| unbadged · non-western | 13 | 33.3% (1/3) | 50.0% (1/2) | 14.3% (1/7) | 2/13 = 15.4% [4.3–42.2] |
| **overall** | 52 | **53.6%** (15/28) | 88.2% (15/17) | 11.1% (2/18) | 17/52 = 32.7% [21.5–46.2] |

- **Trend vs prior rounds:** first quantified round (Round 0 was a 7-book smoke test). Baseline set.
- **Corpus count (cumulative):** deferred — a single headline needs corpus-level stratum weights (Derek-gated per #2880). Inputs below.

### 3. Head-to-head (Gemini vs oracle)
- **Verdict tallies:** Oracle → FIRST 17 (`first_no_prior` 14, `first_complete` 3) · NOT_FIRST 6 · **NA 26** · INDET 3. Gemini → FIRST 28 (`first_no_prior` 26, `first_complete` 2) · NOT_FIRST 18 · **NA 4** · INDET 2.
- **Agreement:** exact 8-way **46.2%** (24/52); 4-class (FIRST/NOT_FIRST/NA/INDET) **48.1%** (25/52); **Cohen's κ = 0.301** (fair).
- **THE divergence — `not_applicable` detection:** the oracle calls **26/52** ill-posed (multi-work containers, single Kanjur/Prajñāpāramitā scripture volumes, English-original works, anonymous ritual/correspondence miscellanies); Tier-1 Gemini calls only **4**. Gemini instead splits these into `first_no_prior` (over-claiming a first on an ill-posed item) and `not_first`. **This single blind spot drives most of the disagreement and most of the badged over-claim.**
- **Where they agree (cheap path is safe):** **badged · western** — T1 precision 90%, recall 90%; on well-catalogued Western texts with a real bibliographic identity Gemini tracks the oracle closely.
- **Where the oracle earns its cost:** (a) **`not_applicable` recognition** everywhere, esp. non-Western containers/scripture volumes; (b) the **thoroughness floor on non-Western texts** (BDRC/84000/CTEXT/ETCSL/Sefaria) — e.g. Sulgi V → `not_first` (ETCSL), Liaozhai → `not_first` (Sondergard complete), bla-ma-nor-bu → `first_complete` (Harding 2003 covered only the history/dialogues, not the sādhana), Pomponazzi → `first_complete` (Thorndike's 24-pp excerpt ≠ a complete translation).
- → **Routing implication:** **Tier-1-only is defensible for badged · western.** Everything else — and any item that smells like a container/scripture-volume/English-original — must hit Tier-2 (or at minimum an NA-classifier) before any claim.

### 4. Review queue A — DISAGREEMENTS (27 of 52; read all)
Pattern codes: **[NA-miss]** Gemini missed an ill-posed item the oracle caught (21 cases — the dominant pattern); **[fab]** Gemini claimed a prior the oracle judged genuine-first (2); **[INDET]** one side hedged (4).

| book_id | Gemini | Oracle | who's right (+evidence) | pattern |
|---|---|---|---|---|
| 69aec447… Federalist | not_first | not_applicable (high) | Oracle — English-original political essays, no translation involved | NA-miss |
| 69dbcbea… Seneca De quattuor virt. | not_first | not_applicable (high) | Oracle — two-work bound volume; both parts have priors (Barlow 1969) → ill-posed | NA-miss |
| 69b525c1… Barros voyages | first_no_prior | not_applicable (med) | Oracle — our item is itself a Portuguese→Dutch translation (van der Aa 1707) | NA-miss |
| 69c1baee… Festival prayer book | not_first | not_applicable (high) | Oracle — standard Sephardi maḥzor liturgy | NA-miss |
| 69c1bbf7… Hebrew prayers/poems | needs_review | not_applicable (high) | Oracle — anonymous liturgical miscellany (container) | NA-miss |
| 69c1bb27… Hebrew account book | first_no_prior | not_applicable (high) | Oracle — administrative ledger, no work identity | NA-miss |
| 6992cdc6… Wubei Zhi vol 27 | first_no_prior | not_applicable (med) | Oracle — single juan of a 240-juan encyclopedia | NA-miss |
| 6a14e17f… Thor bu Gro mgon | first_no_prior | not_applicable (med) | Oracle — "thor bu" miscellany of assembly teachings | NA-miss |
| 6a14e1d7… Thor bu Vajravārāhī | first_no_prior | not_applicable (med) | Oracle — multi-text miscellany volume | NA-miss |
| 69e78a82… smon lam compilation | first_no_prior | not_applicable (high) | Oracle — compilation of aspiration prayers | NA-miss |
| 69e78760… Bum Tha | not_first | not_applicable (high) | Oracle — Śatasāhasrikā Prajñāpāramitā scripture volume | NA-miss |
| 69c26fab… French craft-grade cahiers | needs_review | not_applicable (high) | Oracle — generic anonymous ritual cahier, no stable work | NA-miss |
| 69c261e6… Ehrmann letters | first_no_prior | not_applicable (high) | Oracle — 20 private unpublished letters (container) | NA-miss |
| 69dbcb14… Perotti Cornucopiae | first_no_prior | not_applicable (high) | Oracle — encyclopedic Latin lexicon; claim ill-posed | NA-miss |
| 69c28def… Gold- u. Rosenkreutzer | first_no_prior | not_applicable (med) | Oracle — correspondence + admission docs (container) | NA-miss |
| 69c26d65… Grand Inspecteur Général | not_first | not_applicable (med) | Oracle — generic 33° ritual manuscript variant | NA-miss |
| 69c25169… Meistergrad Strikte Obs. | not_first | not_applicable (med) | Oracle — multi-component ritual ms, no work identity | NA-miss |
| 69b3e686… ME magic & fortune | first_complete | not_applicable (high) | Oracle — Middle English (already English) miscellany | NA-miss |
| 69e7ab9e… Neyphug Kanjur | not_first | not_applicable (high) | Oracle — single Kangyur sūtra-section volume | NA-miss |
| 69de982f… Yuanqu xuan vol 46 | not_first | not_applicable (high) | Oracle — fragment of a 100-play anthology | NA-miss |
| 69e75d1c… Kanze Utaibon vol 18 | not_first | not_applicable (high) | Oracle — multi-play libretto container | NA-miss |
| 69b52fab… Budge Egyptian Dict. | not_first | not_applicable (high) | Oracle — Budge's own English reference work | NA-miss |
| 69c85205… Neu-verm. Helden-Schatz | not_first | first_no_prior (med) | **Oracle (likely)** — Gemini found no real complete prior | **fab** |
| 69906467… Grahalāghava+commentary | not_first | first_complete (med) | **Oracle (likely)** — root translated (Rao 2006), but our with-commentary edition not | **fab** |
| 69e79681… Tibetan "no title" | first_no_prior | unverifiable (high) | Oracle — no title/author to identify a work | INDET |
| 69e763a3… Gangtey rtsis text | first_no_prior | unverifiable (low) | Oracle — OCR-garbled title, cannot bound | INDET |
| 69e7962f… Cakrasaṃvara bong-zhal | first_no_prior | unverifiable (low) | Oracle — catalogue-blind, cannot bound | INDET |

### 5. Review queue B — LOW-CONFIDENCE / INDETERMINATE (oracle)
| book_id | oracle verdict | conf | strength | resolvable? | note |
|---|---|---|---|---|---|
| 69e795ed… Guhyasamāja sādhana | first_no_prior | low | weak | hard | a `first_no_prior` resting on weak/blind sources — treat as provisional, NOT a confident first |
| 69e79681… "no title" | unverifiable | high | weak | no | no work identity |
| 69e763a3… Gangtey rtsis | unverifiable | low | weak | maybe w/ better OCR | garbled title |
| 69e7962f… Cakrasaṃvara bong-zhal | unverifiable | low | weak | maybe | catalogue-blind |

### 6. Review queue C — RANDOM SPOT-CHECK (mandatory)
Five drawn pseudo-randomly across strata, re-inspected against the oracle's cited sources:
| book_id | methods said | on inspection | correct? | systematic issue? |
|---|---|---|---|---|
| 69af4a8b Proclus/Euclid | both not_first/NA-adjacent; oracle not_first | Morrow 1970 (Princeton) is real & complete | ✓ oracle | none |
| 69af2138 Leskov | oracle not_first | Muckle 1995, Bramcote Press, 122pp is real | ✓ oracle | none |
| 69905f20 Pomponazzi | oracle first_complete | Thorndike excerpt is genuinely partial (24pp) | ✓ oracle | none |
| 69e7ab9e Neyphug Kanjur | Gemini not_first / oracle NA | a Kangyur volume IS a scripture container | ✓ oracle | **confirms NA-miss is a real Gemini gap, not oracle over-call** |
| 69c25169 Meistergrad | Gemini not_first / oracle NA | anonymous multi-part ritual ms — NA defensible | ✓ oracle (borderline) | NA boundary is a judgment call (see §7) |

### 7. Measure-the-measurer — ORACLE AUDIT
- **Oracle quality is high where checkable:** the 5 spot-checks + the strong-evidence NA/not_first calls cite real, verifiable sources (Morrow 1970, Muckle 1995, Sondergard 2008–14, ETCSL, van der Aa 1707, Thorndike excerpt). No fabricated priors observed in the oracle output.
- **Caveat A — analyst-supplied context in the per-book prompts (Round-1 limitation, to fix):** the oracle was unprimed w.r.t. our registry (no badge/tier0/disposition), BUT each per-book prompt carried scholarly *context hints* I wrote (e.g. "Middle English IS English", "this is vol 27 of 240", "a Kangyur volume is a container", "84000 is translating the Kangyur"). These are true and aid work-identity, but they **nudge toward `not_applicable`/`not_first`** and are not uniform across books → the oracle's NA-heaviness is partly analyst-induced, not purely model judgment. **Round 2 fix:** use a single uniform minimal prompt (title/author/language + §2 rules, zero per-book hints) and **A/B** it against the hinted prompt on the same books to size the bias.
- **Caveat B — the NA boundary is genuinely fuzzy.** Clear NAs (Federalist, Budge dict, Kanjur volumes, account book) are safe. Borderline NAs (anonymous ritual cahiers, the Gold-/Rosenkreuzer correspondence, "thor bu" miscellanies) are judgment calls — a human or a 2nd independent oracle pass should re-judge a slice next round (oracle self-consistency not yet measured; do it Round 2).
- **Drift / systematic oracle error found?** None fabricated; the one *structural* risk is the NA-aggressiveness above. → **Fix the prompt (uniform/minimal) before trusting the NA rate as ground truth.**

### 8. Alignment audit (#2885a — Tier-0)
- The drawn sample carried **no confident Tier-0 link** (`tier0.best` is `null` for all 52: 33 books had a surname match with title-overlap < 0.3, 19 had 0 candidates). **No Tier-0 auto-merges existed to audit this round**, so Tier-0 precision/recall is **not yet evaluable** from this sample.
- → **Action:** draw the Round-2 increment to deliberately **oversample books that DO have a `tier0.best` catalog match**, so the false-merge / recall-miss audit has cases to score.

### 9. Failure patterns named this round → variant hypotheses
1. **NA-detection gap (Tier-1)** — Gemini almost never emits `not_applicable` (4 vs oracle's 26). → **Hypothesis H1:** add an explicit pre-classifier / strengthen the Tier-1 prompt's NA branch (container / single-scripture-volume / English-original / generic-anonymous-ritual). Test as an A/B arm vs current Tier-1 next round. **This is the highest-value lever** — it fixes both the largest disagreement and most of the badged over-claim.
2. **Analyst-hint bias in the oracle prompt** — see §7 Caveat A. → **Hypothesis H2:** uniform minimal oracle prompt; A/B vs hinted.
3. **Tier-1 over-claims `first_no_prior` on weak/blind non-Western searches** — where the oracle says `unverifiable` (weak), Gemini says `first_no_prior`. → **Hypothesis H3:** require Tier-1 to down-rank to `unverifiable`/`evidence_strength:weak` when grounding sources are catalogue-blind for the tradition.

### 10. Decisions
- **Variants to A/B next round:** H1 (Tier-1 NA branch) and H2 (uniform minimal oracle prompt), both on the SAME books so the effect is measured, not assumed.
- **Strata to EXPAND** (Wilson CI wider than ±10%): **all four** — every stratum CI is still ±15–22pp at n=13. `inference.suggestSampleSize` equivalent: ~30–40 more per stratum to reach ±10%.
- **Overall stop check:** all strata within target? **No.** Last K rounds dry of new failure patterns? **No** (Round 1 surfaced the NA-gap). → **CONTINUE** (expand + run the A/B arms).
- **Sign-off needed?** This is a **measure-only** round — no flips. For Derek's awareness, the badged-stratum **measure-only** badge-impact (NOT a recommendation to apply): of 26 badged books, oracle reads FIRST 13 · **NA 11** · INDET 2 · **NOT_FIRST 0**. The over-claim on badged firsts is **almost entirely "this badge is ill-posed for this item type" (NA), essentially zero "someone translated it first" (not_first)** — a materially different remediation (suppress badge on containers/scripture-volumes/English-originals) than demotion. Any actual flip needs a directional Tier-2 re-verify (`ft-verify`) + Derek sign-off.

### 10b. CORRECTED-RUBRIC re-read (added 2026-06-30, after Derek review)
Derek rejected the strict `not_applicable` rule: a multi-work container / single scripture-volume / compilation that we produced the **first English of** (no prior English of the content) IS a first — "container"/"scripture copy" are cataloguing labels, not translation facts. NA should mean only *already-English* or *wordless visual art*. Re-mapping the **same oracle evidence** (no re-run — `ft-pilot-score.mjs` `clsCorrected`):

| | strict NA rule (orig) | corrected rule |
|---|---|---|
| BADGED genuine-first | 13/26 = **50.0%** | **20/26 = 76.9%** [57.9–89.0] |
| overall genuine-first | 17/52 = 32.7% | **32/52 = 61.5%** [48.0–73.5] |

The badged "over-claim" collapses from 50% to **4/26 (15%)** real problems — and they are specific: **1 remove** (Federalist, already English) + **3 demote** (Seneca two-work volume, festival maḥzor, Bum Tha/Prajñāpāramitā — each has an actual complete prior English). Everything else the strict rule called NA was untranslated Tibetan/Chinese/Hebrew material we were genuinely first to English. The contract's NA definition (`ft-verdict-contract.md` §1/§2) was narrowed accordingly, and Round 2's oracle uses the corrected rubric. **Claim-wording guardrail:** word the public badge around the *material/volume actually translated*, not the implied complete parent work.

### 11. Ledger row
`| 2026-06-30 | pilot round 1 | Tier-1 gemini-3-flash-preview + oracle sonnet (unprimed, hinted) | 4×13 stratified (badged×W/nonW) | 52 | κ=0.30; T1 NA-blindness (26 oracle NA vs 4); badged 50% genuine / 42% NA / 0% real-prior | scripts/eval/results/ft-pilot-round-1.* | round artifact |`
