# FT expanding-pilot — per-round review template

*Copy this to `scripts/eval/results/ft-pilot-round-<N>.md` (or the ops repo) and fill it each round of the #2880 expanding pilot. One filled artifact per round = the qualitative record + the decisions; each round also appends one row to `ft-eval-runs-ledger.md`. Protocol: #2880. Contract: `ft-verdict-contract.md`. Audit sibling: #2885.*

> **Invariants** (every round): oracle is **UNPRIMED** (don't feed it `tier0` or our registry); **no public-badge flips** from the pilot (it measures; flips need Derek sign-off); prompt/threshold changes are **A/B-measured next round**, never blind-applied; the random spot-check queue is **mandatory** (it's the only thing that catches correlated error).

---

## Round `<N>` — `<date>`

### 1. Config
- **Sample:** increment `<n_new>` (strata: `<…>`) · cumulative `<N_total>`. Source manifest: `<path>`.
- **Tier-1 (Gemini):** model `<…>` · prompt variant `<id/desc>`.
- **Tier-2 oracle (Claude):** prompt variant `<id/desc>` (unified, `ft-verdict-contract.md` §2).
- **Escalation this round:** oracle run on `<all disagreements + random slice of agreements + re-audits>` → `<count>` oracle calls.
- **A/B arms tested (if any):** `<arm A = current; arm B = hypothesis from round N-1>`.

### 2. Metrics (this round / cumulative), by stratum
| Stratum | n | Tier-1 precision(first) | recall (known priors) | fabrication | κ (Tier-1↔oracle) | count est. ± CI |
|---|---|---|---|---|---|---|
| badged · western | | | | | | |
| badged · non-western | | | | | | |
| unbadged · western | | | | | | |
| unbadged · non-western | | | | | | |
| **overall** | | | | | | |

- **Trend vs prior rounds:** `<precision/recall/fabrication/κ up or down; note any regression>`.
- **Corpus count (cumulative):** `<N verified + M estimated within ±X, Wilson 95%>`.

### 3. Head-to-head (Gemini vs Claude vs oracle)
- Agreement Gemini↔Claude: `<%>` · Gemini↔oracle: `<%>` · Claude↔oracle: `<%>`.
- **Where Claude wins** (justifies the expensive pass): `<strata / case types>`.
- **Where they agree** (cheap path is safe): `<strata / case types>`.
- → **Routing implication:** `<which strata can run Tier-1-only; which need Tier-2>`.

### 4. Review queue A — DISAGREEMENTS (read all)
| book_id | Gemini | Claude/oracle | who's right (+evidence) | failure pattern |
|---|---|---|---|---|
| | | | | |

### 5. Review queue B — LOW-CONFIDENCE / uncertain / unverifiable
| book_id | verdict | why hedged | resolvable? | note |
|---|---|---|---|---|
| | | | | |

### 6. Review queue C — RANDOM SPOT-CHECK (mandatory; regardless of agreement)
*Catches systematic error agreement hides. Draw `<k>` at random from the round.*
| book_id | methods said | on inspection | correct? | systematic issue? |
|---|---|---|---|---|
| | | | | |

### 7. Measure-the-measurer — ORACLE AUDIT
- Re-judged `<k>` oracle labels via `<independent 2nd pass / human>`.
- Oracle self-consistency: `<k_agree/k>` · human-agreement (if run): `<…>`.
- **Drift / systematic oracle error found?** `<none / describe>` → `<fix oracle prompt before next round? Y/N>`.

### 8. Alignment audit (#2885a, free from the Tier-0 link)
- `tier0` present but oracle finds **no** prior → **false merge**: `<count>` `<book_ids>`.
- Oracle finds a **held** prior with **no** `tier0` → **recall miss**: `<count>` `<book_ids>`.
- → **Tier-0 verdict so far:** `<precise enough to auto-short-circuit? or each match still needs verify?>`.

### 9. Failure patterns named this round → variant hypotheses
1. `<pattern>` → hypothesis: `<prompt/threshold change>` → test as arm `<X>` next round.
2. …

### 10. Decisions
- **Variants to A/B next round:** `<…>`.
- **Strata to EXPAND** (CI wider than target): `<…>` · **STOP** (CI tight): `<…>`.
- **Overall stop check:** all strata within ±`<target>`? `<Y/N>` · last `<K>` rounds dry of new failure patterns? `<Y/N>` → **`<continue / stop>`**.
- **Sign-off needed?** `<any proposed public-badge action → list for Derek; else none>`.

### 11. Ledger row (append to `ft-eval-runs-ledger.md`)
`| <date> | pilot round <N> | Tier-1 <variant> + oracle <variant> | <strata> | <n cumulative> | <headline metric> | scripts/eval/results/ft-pilot-round-<N>.* | round artifact |`
