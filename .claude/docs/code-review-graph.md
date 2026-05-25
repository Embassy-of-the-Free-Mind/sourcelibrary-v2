# code-review-graph (optional MCP tool)

A local knowledge graph for AI coding tools. Builds a Tree-sitter map of the
codebase so the agent reads only the relevant slice instead of grepping.

**This is optional and opt-in.** Nothing in this repo depends on it. If you
don't install it, the regular grep/read workflow is unchanged.

Upstream: https://github.com/tirth8205/code-review-graph

## When to use

The graph is a faster grep **for structural questions**:

- Who calls function X? (`query_graph(pattern="callers_of", ...)`)
- What's the blast radius if I change this file? (`get_impact_radius`)
- Which functions have no tests? (`query_graph(pattern="tests_for", ...)`)
- High-level architecture overview (`get_architecture_overview`)

## When NOT to use

The graph is static-analysis only. It will **miss or mislead** for:

- **Tenant subdomain routing.** `src/proxy.ts` rewrites paths via host; the
  graph models neither the host→path remap nor `/embed/[tenant]/*` ↔
  `/[tenant]/*` parallel routes. Use `memory/ui-navigation.md` and the
  invariants in `CLAUDE.md` instead.
- **Atlas vs. Supabase queries.** Collections are runtime strings; the graph
  can't tell you that `held_by` defaults to GLOBAL or that tenant filtering
  is required. Use `memory/data-quality.md` and the tenant invariants.
- **Dynamic require/import.** e.g. `src/lib/embassy/podcast.ts` does
  `require('../vendor/lamejs-bundle')` — graph won't link that.
- **Cron triggers, Lambda handlers, worker scripts.** The trigger lives
  outside the import graph.
- **"Why" questions.** The graph encodes structure, not intent. For
  motivations, decisions, and past incidents, the repo memory files
  (`memory/*.md`) and `CLAUDE.md` invariants are authoritative.

**Rule of thumb:** if you'd answer with a *file path*, the graph can help.
If you'd answer with a *date, decision, or stakeholder*, read memory.

## Install (per-developer)

The MCP server runs locally; each dev installs it on their own machine.

```bash
# Install the CLI (Python 3.10+; PyPI package)
pipx install code-review-graph

# Install local embedding support (only needed if you want semantic search
# beyond exact symbol-name matching — see "Semantic search caveat" below)
pipx inject code-review-graph 'code-review-graph[embeddings]'

# First-time index build (~36s on this repo, 2089 files → 14515 nodes)
code-review-graph build

# Register with Claude Code as a project-scoped MCP server
claude mcp add code-review-graph "code-review-graph serve" --scope project
```

The `--scope project` flag writes to `.mcp.json` in this directory, which is
**gitignored** — your config doesn't propagate to other devs.

The graph stores its SQLite database at `.code-review-graph/graph.db`
(~120 MB on this repo); that directory is gitignored automatically by the
tool itself.

## Important: do NOT add it as a hook

The most natural-looking integration is a `PostToolUse` hook that re-indexes
after every Edit/Write/Bash. **Don't.** It would:

1. Add a 5–30s tax to every tool call.
2. Race across the ~10 CC terminals that share this directory.
3. Block tool calls if the binary isn't installed.
4. Crowd out the multi-session branch-safety `PreToolUse` hook in
   `.claude/settings.json` (which is load-bearing per `CLAUDE.md` Multi-Session
   Awareness).

Either run `code-review-graph update` manually after big refactors, or rely
on the upstream's own file-watcher if you want auto-refresh.

## Staleness — the main failure mode

The graph is a snapshot. If it hasn't re-indexed since the last commit it
will confidently return wrong answers — most dangerously, "no callers found"
for a function that's still used. This is exactly the failure mode that
almost killed `src/components/InputWidget.tsx` in PR #1980 (it was tagged as
orphaned by graph analysis but still imported by `/founding-donors`).

**Verify with grep before any destructive action** ("delete dead code",
"rename across project") that the graph informed.

## When the graph and memory disagree

Memory wins. The graph encodes "what the code looks like right now"; memory
encodes "what we learned the hard way." If the graph says a function is
dead but `memory/pipeline-ops.md` mentions it's triggered by a cron, the
cron is the authoritative source — update the graph's view by re-indexing,
or treat the function as live.

## Validated on this repo (2026-05-25, v2.3.4)

Ran 8 benchmark queries against `code-review-graph` v2.3.4 on commit
`6d940302`. Build took 36s (2089 files, 14515 nodes, 124457 edges, 119MB
SQLite). Findings below are *measured*, not vibes.

### Semantic search caveat — biggest surprise

Without `code-review-graph[embeddings]` installed (the default `pipx install`),
the `semantic_search_nodes_tool` falls back to **keyword matching against
node names**. Natural-language queries return 0 results:

| Query | Mode | Results |
|-------|------|---------|
| `"Mp3Encoder"` | keyword | 0 nodes |
| `"podcast mp3 encode audio"` | keyword | 0 nodes |
| `"enrich worker"` | keyword | 0 nodes |
| `"embed tenant book"` | hybrid (after embeddings) | 5 nodes (correct file found) |

**Action:** If you want semantic search, you must install the embeddings
extra. Otherwise treat the tool as "search by exact symbol name" — useful
but very different from what "semantic" implies.

### Set A — structural queries (graph's claimed strength)

| Query | Graph result | Grep result | Token ratio (grep÷graph) |
|-------|--------------|-------------|--------------------------|
| Callers of `getRequestBaseUrl` | Correct, 429 tok, 0.12s | Correct, 166 tok, <1s | 0.4× — grep wins on tokens |
| Impact radius of `src/lib/auth.ts` | 6 direct + 500 impacted nodes, 135 files (high risk), 120 tok, 6.8s | Cannot answer — would require manual import-tracing | n/a — graph-only |
| List execution flows | 5 flows ranked by criticality, 459 tok | Cannot answer | n/a — graph-only |

**Verdict:** The graph wins on questions grep *can't* answer (impact radius,
execution flows). On "who calls X?" with a known symbol name, grep is more
compact and faster.

### Set B — predicted failure modes (all failed as predicted)

| Question | Graph result | Reality |
|----------|--------------|---------|
| Who uses `Mp3Encoder` (dynamic require)? | 0 results | `src/lib/embassy/podcast.ts:370` calls it via `require('../vendor/lamejs-bundle')`. Tree-sitter doesn't link computed-path requires. |
| Where is `bph.sourcelibrary.org/book/X` served from? | Found the file `src/app/embed/[tenant]/book/[slug]/page.tsx`, but no link from the BPH host to that path | The link lives in `src/proxy.ts` host-rewrite logic, invisible to a static import graph. |
| What triggers `enrich-worker`? | Found enrich-named symbols; no cron link | Vercel Cron declared in `vercel.json` (1-line `cat vercel.json \| jq .crons` answers it). |
| Where is `tenant_memberships` scoped per tenant? | Found the SQL table node | The runtime-string collection name appears in ~30 route handlers; graph sees the schema, not the access pattern. |

**Verdict:** Every failure mode flagged in "When NOT to use" above
reproduced exactly. If you ask these questions to the graph and trust the
silence as a real "no," you'll be wrong.

### Set C — dead-code detection (the dangerous one)

Ran `refactor_tool(mode="dead_code", kind="Function", file_pattern="src/")`.

- **2,509 "dead" functions reported** in `src/` alone (4,192 across the
  whole repo including SQL migrations)
- **Top false-positive categories:**
  - Next.js route exports — `GET`, `POST`, `PATCH`, `DELETE` in *active*
    route files flagged as dead. The framework calls them by HTTP method,
    not by an import — graph-blind.
  - Single-letter arrow-function parameters — `(s) => s.toLowerCase()`,
    `(v) => v.id`. Tree-sitter indexes these as Function nodes; they have
    no external "callers" so they look orphaned.
  - Internal helper functions in active files — used inside their own
    module but not exported, so the import graph sees no callers.
- **Sampled 20 random "dead" findings; 0 were actually unreferenced** in
  the way a human reviewer would mean by "dead code."

**Concretely on this repo, the dead-code mode would have you delete:**
- Active OAuth route at `src/app/oauth/authorize/route.ts` (`GET` flagged)
- Active cron warm endpoint at `src/app/api/cron/warm/route.ts`
- 17 helpers in `src/components/book/BookPagesSection.tsx` (a live component)
- 17 helpers in `src/lib/embassy/librarian.ts` (the librarian assistant)

**Do not use the `refactor_tool(mode="dead_code")` output as a deletion list.**
At best, treat it as a list of *symbols with no external import-graph
callers* — which on a Next.js app is enormous because of framework
conventions and intentional internal helpers. This is the same failure
class that flagged `InputWidget.tsx` in PR #1980.

### Bottom line

- **Use it for:** impact radius, execution-flow discovery, exact-symbol
  caller lookup when grep would be noisy.
- **Don't use it for:** dead-code detection on Next.js apps, anything
  routed via host headers, anything triggered by cron/Lambda, anything
  reached via dynamic `require()`, natural-language search (unless you
  installed the embeddings extra and verified non-keyword mode).
- **Token-reduction claim:** upstream advertises 6.8×–49×. On the queries
  I measured, grep matched or beat the graph for simple "who uses X?"
  questions; the graph only beats grep when the question is structurally
  beyond grep's reach (impact radius, flows). On dead-code mode it
  produces 4,000+ false positives — far more tokens than grep, and worse,
  *wrong* tokens that could lead to deletions.

The graph is a real tool with real wins, but the wins are narrower than
the upstream marketing implies. Treat it as a power tool with sharp
edges, not a default replacement for grep.

Benchmark scripts and full raw output: `/tmp/crg_bench2.py`,
`/tmp/crg_bench2_results.json`, `/tmp/crg_dead_analysis.py`,
`/tmp/crg_dead_analysis.json` (run from this repo on 2026-05-25, not
committed).
