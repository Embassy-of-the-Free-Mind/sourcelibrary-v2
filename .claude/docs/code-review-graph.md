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
# Install the CLI
pipx install code-review-graph    # or: npm i -g code-review-graph
# (check the upstream README for the current install command)

# First-time index build (one-shot, takes ~30s on this repo)
code-review-graph build

# Register with Claude Code as a project-scoped MCP server
claude mcp add code-review-graph "code-review-graph serve" --scope project
```

The `--scope project` flag writes to `.mcp.json` in this directory, which is
**gitignored** — your config doesn't propagate to other devs.

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
