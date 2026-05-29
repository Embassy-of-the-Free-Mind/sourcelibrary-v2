# sourcelibrary.org search — bug report and query matrix

**Author:** Derek (via Cowork test session)
**Date:** 2026-05-29
**Related PR:** [#2162](https://github.com/Embassy-of-the-Free-Mind/sourcelibrary-v2/pull/2162) — fixes P0 Bugs 1 and 2
**Scope:** MCP search tools (`search_library`, `search_translations`, `search_concept`, `search_images`)
**Method:** ~70 queries pulled from real prior sessions + a designed stress matrix; results scored for relevance, language distribution, and stability.

---

## TL;DR for the search team

Six bugs found. Bugs 1 and 2 (P0, silent) are fixed in PR #2162. Bugs 3, 5, 6 remain open as follow-ups.

| # | Severity | Status | Surface | Bug |
|---|----------|--------|---------|-----|
| 1 | **P0** | **Fixed in #2162** | `search_translations` | Zero results returned at default limit on common queries despite `total_matches` 25–60 |
| 2 | **P0** | **Fixed in #2162** | all search tools | `total_matches` is non-deterministic across identical calls |
| 3 | P1 | Open | `search_library` | Multi-word queries OR-match (advertised as AND); quoted phrases don't enforce phrase |
| 4 | P2 | Open | `search_library` | Sub-2-char queries return HTTP 400 instead of empty results |
| 5 | P2 | Open | `search_concept` | Language filter cannot rescue matches the English embedding never produced; docs too soft |
| 6 | P3 | Open | `search_images` | Symbol vocabulary not distinguished from generic noun (e.g., "green lion") |

---

## Bug 1 (P0, **fixed in #2162**) — `search_translations` silently returns zero at default limit

### Repro
```
search_translations(query="neidan")           → total_matches: 44, returned: 0
search_translations(query="neidan", limit=50) → total_matches: 44, returned: 31
```

Same pattern on every one of these real queries — `total_matches` is non-zero, `returned` is zero at default limit:

| Query | `total_matches` (default limit) | `returned` |
|---|---|---|
| `transmutation` | 25 | 0 |
| `social contract` | 33 | 0 |
| `harmony of the spheres` | 37 | 0 |
| `chemical wedding` | 22 | 0 |
| `neidan` | 41 | 0 |
| `kīmiyā` | 40 | 0 |

### Root cause (per #2162)
In `src/app/api/mcp/route.ts`, `searchPassages()` fetched exactly the user's `limit` page-rows, then ran an empty-snippet `.filter()` *after* fetching. When the backend's first rows carried blank snippets, the filter emptied the whole page while `total_matches` stayed high.

### Fix (per #2162)
Over-fetch from the same offset (`userLimit*3`, clamped to the backend's range), filter, then `.slice(0, userLimit)` — so the page is full whenever matches exist. Same pattern applied to `searchConcept()`.

---

## Bug 2 (P0, **fixed in #2162**) — `total_matches` is non-deterministic

### Repro
Three identical calls to `search_translations(query="neidan")` returned `total_matches`: **41, 63, 44**.
Three identical calls to `search_translations(query="transmutation")` returned: **25, 64, 30**.

### Root cause (per #2162)
Backend `total` is `dedupedResults.length` — the size of one request's merged+deduped window across four parallel lanes (Supabase book trigram, Atlas page search on an 8s race, semantic book, semantic page). Any lane that times out silently resolves to `[]`, shrinking the count run-to-run.

### Fix (per #2162)
Each lane flips a `degradedLanes` marker; the response now surfaces `partial: true` + `degraded_lanes: [...]` and the MCP propagates `partial`. Identical queries under no-timeout conditions now return the same `total`; a timeout is signalled instead of silently shrinking the number.

### Honest caveat (per #2162)
Making `total` a true corpus count still needs a backend redesign — that's documented in PR #2162 as a follow-up.

---

## Bug 3 (P1, **open**) — `search_library` multi-word queries OR-match; quoted phrases are a no-op

### Repro
```
search_library(query="xyzqwabc nonsense")     → total_matches: 34
```
There are no books containing `xyzqwabc`. The 34 matches come from `nonsense` alone, proving the query is being OR'd at term level. The tool description says "Multi-word queries match all terms (not phrase)" — that is, AND semantics, not phrase. Actual behavior is OR.

Quoted phrases also tested:
```
search_library(query='"chemical wedding"')    → behaves identically to: chemical wedding
search_library(query='"social contract"')     → same total_matches as unquoted
```
The quote-for-exact-phrase syntax appears unimplemented on the book lane (the page lane in `atlas-search.ts` does handle phrases).

### Suggested fix
- Default multi-word behavior should AND terms on the book lane (as documented).
- Quoted phrases should enforce phrase match. The page lane already does this — port that logic to the book lane.

---

## Bug 4 (P2, **open**) — Sub-2-char queries throw instead of returning empty

### Repro
```
search_library(query="a")
→ API 400: {"error":"Query must be at least 2 characters", ...}
```

### Suggested fix
Return `{ total_matches: 0, returned: 0, results: [] }` with a `warning` field instead of throwing. Agent loops handle empty arrays cleanly; errors abort the chain.

---

## Bug 5 (P2, **open** / docs) — `search_concept` Latin-bias is structural, not filter-able

### Repro
```
search_concept(query="mercury and sulfur principle of metals",
               languages=["Sanskrit","Arabic","Chinese"])
→ 0 returned
```
```
search_concept(query="union of opposites yin yang", language="Chinese")
→ 0 returned
```
```
search_concept(query="elixir of longevity immortality")  # no filter
→ 6 returned, all Chinese (Ge Hong, Li Shizhen, Pu Songling) — great results
```

### What this actually shows
The language filter is implemented correctly — it returns exactly the language set the user asked for, and nothing else. The failure mode is upstream: the English Gemini embedding has no semantic neighbor in the non-Western translated text for many concept phrasings. Filter cannot create matches the embedding never produced.

`elixir of longevity` happens to align with how Ge Hong and Li Shizhen were translated, so it works. `mercury and sulfur` does not, so Sanskrit/Arabic/Chinese return 0 even though those traditions discuss those substances.

### Suggested fix
This is a documentation problem more than a code problem. The current `search_concept` tool description hints at the issue but should be much more explicit:

> "When targeting non-Western corpora, prefer `search_translations` with tradition-internal vocabulary (`parada`, `iksīr`, `jing`, `bindu`, `neidan`). The language filter on this tool cannot rescue queries phrased in modern English — if the embedding doesn't reach the corpus, the filter returns 0 results."

A code-side improvement would be a tradition-vocabulary fallback: when `languages` is set to non-Western traditions AND the result set is empty, auto-fan-out the modern English term to its known tradition equivalents from a small lookup table (mercury → `parada`, `zhusha`, `zaybaq`, etc.) and re-search.

---

## Bug 6 (P3, **open**) — `search_images` symbol matching is text-only

### Repro
```
search_images(query="green lion")
```
Returned an ordinary Dürer lion engraving as a top hit. The alchemical "green lion devouring the sun" is a distinct iconographic motif and should be tagged separately from "any image containing a lion."

### Suggested fix
Add a `symbol` taxonomy field on images (already exists as a filter parameter, but evidently not populated densely enough that it dominates ranking). Worth a one-time tagging pass on alchemical, kabbalistic, and tantric symbol vocabulary.

---

## What's working well (don't regress)

- **Author/work discovery via `search_library`**: every named author tested (Albertus Magnus, Paracelsus, Andreae, d'Espagnet, Jabir, Bai Yuchan, Li Shizhen, Ge Hong) returns the right book in top 1–3.
- **Fuzzy typo matching**: `paracelus` → 55 matches with Paracelsus #1; `alchmy` → 58 with correct alchemy books on top.
- **Tradition vocabulary in `search_translations`**: `parada`, `bindu`, `jing`, `iksīr`, `mollities` all return 6–10 strong passages with citation URLs.
- **`search_images` for distinct symbols**: ouroboros, tree of life, sephirot, mandala all return 4–5 of 5 relevant results.
- **`search_concept` when the query is well-aligned with translated text**: `memory palace technique of loci` → 10/10 high-similarity passages. `subtle body channels of energy` + Sanskrit filter → 10/10 from Netra Tantra, Sangita Ratnakara, Caraka Samhita.

---

## Appendix A — Full query matrix (~70 queries)

The machine-readable form lives at `tests/fixtures/mcp-search-regression-queries.json`. The smoke test that exercises it is at `tests/smoke/mcp-search.test.ts`.

Each row is a query I actually ran. Copy this into a test harness and you have a regression set.

### Author / work discovery (`search_library`)
```
Paracelsus
Li Shizhen
Albertus Magnus
Andreae
d'Espagnet
Jabir ibn Hayyan
Bai Yuchan
Ge Hong
Atalanta fugiens
Rasarnava
Bencao Gangmu
Religio Medici
Institutio Oratoria
```

### Modern-English concepts (`search_concept` and `search_translations`)
```
memory palace technique of loci
harmony of the spheres
active intellect
transmutation
elixir of longevity
mercury and sulfur
social contract
distributed cognition
chemical wedding
union of opposites yin yang
subtle body channels of energy
```

### Tradition-vocabulary (`search_translations`)
```
parada
suta
rasendra
bindu
jing
neidan
iksīr
kīmiyā
sahq
hastamaithuna
shouyin
mollities
tribade
ouroboros
```

### Latin-bias probe (`search_concept` with filters)
```
elixir of longevity immortality                       (no filter)
elixir of longevity immortality                       (languages=["Sanskrit","Arabic","Chinese","Tibetan"])
elixir of longevity immortality                       (exclude_languages=["Latin","English","French","German","Greek"])
mercury and sulfur principle of metals                (languages=["Sanskrit","Arabic","Chinese"])
union of opposites yin yang                           (language="Chinese")
subtle body channels of energy                        (language="Sanskrit")
```

### Edge cases (`search_library`)
```
a                              → API 400 (sub-min; Bug 4)
the                            → unexpected near-misses
alchmy                         → fuzzy works
paracelus                      → fuzzy works
xyzqwabc nonsense              → OR-match bug (Bug 3)
"chemical wedding"             → quote-as-phrase no-op (Bug 3)
"social contract"              → quote-as-phrase no-op (Bug 3)
kimiya  vs  kīmiyā             → diacritic variation
```

### Image probe (`search_images`)
```
ouroboros
tree of life
sephirot
mandala
green lion                     → returns ordinary lion (Bug 6)
pelican
hexagram
alchemical king queen
```

### Bug 1 / Bug 2 stability probe (`search_translations`) — fixed by #2162
```
neidan                  (default limit) → 0       [pre-fix]
neidan                  (limit=50)      → 31      [pre-fix]
transmutation           (default limit) → 0       [pre-fix]
transmutation           (limit=50)      → 20      [pre-fix]
harmony of the spheres  (default limit) → 0       [pre-fix]
harmony spheres         (default limit) → 5       [pre-fix; note: trimming "of the" changes everything]

# Stability — same query repeated:
neidan          → total_matches: 41, 63, 44 across three calls   [pre-fix]
transmutation   → total_matches: 25, 64, 30 across three calls   [pre-fix]
```

---

## Appendix B — Tool-routing cheat sheet for agents

Updated for the post-#2162 world:

1. **Author or work named?** → `get_book` first (returns AI summary + chapter outline; often the entire answer). Use `list_books` to discover the ID.
2. **Need a passage to quote?** → `search_translations` is now reliable at default limit (post-#2162).
3. **Concept search across Western traditions?** → `search_concept` is fine.
4. **Concept search across non-Western traditions?** → DON'T use `search_concept` with a language filter. Use `search_translations` with tradition-internal vocabulary (`parada`, `iksīr`, `jing`, etc.) — Bug 5 remains open.
5. **Check `partial: true` on responses** (post-#2162) — if true, one or more lanes timed out; consider retrying.
6. **Don't rely on quoted phrases** in `search_library` (Bug 3, still open).

---

*Generated from Cowork test session 2026-05-29.*
