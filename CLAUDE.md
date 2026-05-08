# Claude Code Guidelines for Source Library

## Development Workflow — CRITICAL
- **Feature branches off `main`.** One branch per feature/task: `feat/ai-search`, `fix/cover-thumbnails`, etc. No long-running dev branches.
- **Create a branch via worktree:** Use `EnterWorktree` at session start — it creates an isolated checkout with its own branch. Do NOT `git checkout -b` in the main directory (see Multi-Session Awareness above).
- **PR when done:** `gh pr create --base main`. Keep PRs focused (5-15 commits). Small PRs merge fast.
- **After merge, clean up:** Delete the worktree branch. The main directory stays on `main`.
- **NEVER run `vercel --prod` from a feature branch.** The CLI deploys whatever is on disk — it ignores the Vercel production branch setting. Use `vercel` (no `--prod`) for preview deploys from branches.
- **NEVER push directly to main.** All changes go through PRs.
- **Preview URL:** Push the branch (`git push`) and Vercel auto-deploys a shareable preview. Use that for testing and sharing with the other dev.
- The production site (sourcelibrary.org) stays untouched until a PR is reviewed and merged.

## Multi-Session Awareness — CRITICAL
Derek runs ~10 Claude Code terminals simultaneously, all sharing the main working directory. Branch switches in one terminal silently break all others.

**The rule is simple: the main directory stays on `main`. Always.**

- **NEVER run `git checkout <branch>` in the main directory.** This is the #1 source of cross-session chaos.
- **All feature work happens in worktrees.** At session start, if your task needs a feature branch, immediately call `EnterWorktree` to get an isolated copy. Branch switches in worktrees are safe — they don't affect other terminals.
- **Read-only tasks (searching code, reading files, running queries) can stay in the main directory on `main`.** No worktree needed.
- **If you're on an unexpected branch** (not `main` in the main directory), tell the user: "This directory is on `X` — another session may have switched it. Want me to switch back to `main`?" Do NOT silently switch or start working on the wrong branch.
- **At session start, check your branch** with `git branch --show-current`. If it's not `main` and you're in the main directory, flag it immediately.
- **Commit and push before exiting a worktree.** Uncommitted worktree changes are invisible to other sessions.
- **Set the terminal title at session start.** Run: `printf '\033]0;CC: <task-description>\007'` (e.g., `CC: embeddings`, `CC: pipeline-monitor`). This labels the Ghostty tab so Derek can find the right terminal. Use a short, descriptive name based on what you're working on.

**Worktree quick reference:**
- `EnterWorktree` — creates an isolated checkout with its own branch
- Active worktrees: `git worktree list`
- Worktrees live in `.claude/worktrees/`

## Data Protection — CRITICAL
- **NEVER** delete books, pages, or source material without explicit confirmation
- **NEVER** batch delete — list items first, wait for approval
- `deleted_books` collection has recoverable items: `POST /api/books/restore/[id]`
- Assume all books are valuable, even without IA identifiers

## Security — CRITICAL
- Reading `.env*` files is OK for understanding what variables exist
- **NEVER** embed secrets in code — use `process.env.VAR` with no fallback
- Review scripts for hardcoded credentials before committing

## Stack
- Next.js 16, MongoDB Atlas, Gemini AI, Vercel deployment
- Production database: `bookstore` (~17K live books, ~24.5K warehouse), NOT `sourcelibrary_research`

## AI Models — IMPORTANT
- Summary/Index generation: enrich-worker uses `gemini-3.1-flash-lite-preview` for all phases — summary+index (Phase 6), chapters (Phase 7), quality scoring (Phase 7.5), collection assignment (Phase 7.6). NEVER use models older than v3.
- OCR/Translation routing: `gemini-3-flash-preview` for BPH books, `gemini-3.1-flash-lite-preview` for everything else (50% cheaper). See `src/lib/types/ai-models.ts`.
- Reference: https://ai.google.dev/gemini-api/docs/models

## System Map
- **Interactive diagram:** https://sourcelibrary.org/admin/system-map — click any node for details, key files, collections, gotchas
- **Markdown reference:** `.claude/docs/system-map.md` — full text version with file layout, collection inventory, dead code list
- **Dead code cleanup:** GitHub issue #258 (closed) — most cleaned up, some camera components may remain. Note: rithmomachia is a live feature (`/rithmomachia`), not dead code.

## Domain Context
Memory is organized hierarchically: `MEMORY.md` (top-level, always loaded) → `_index-*.md` section indexes → individual topic files. Load the relevant section index for your task — don't read all of them.

Detect the work domain from the user's prompt and load the right context automatically:
- **System overview / "where does X live?":** read `.claude/docs/system-map.md`
- **Pipeline/cron/Lambda/OCR/translation:** read `memory/_index-pipeline.md` + `memory/_index-safety.md` (or `/pipeline-context`)
- **UI/frontend/navigation:** read `memory/_index-product.md` (or `/ui-context`)
- **Data fixes/maintenance/stuck books:** read `memory/_index-safety.md` + `memory/_index-content.md` (or `/maintenance`)
- **Search/embeddings:** read `memory/_index-search.md`
- **Import/curation:** read `memory/_index-content.md` (or `/curator`, `/library-curator`)
- **Deploy/infra:** read `memory/_index-infrastructure.md`
- **Quality auditing:** `/qa-audit`
- **Batch processing:** `/batch-translate`
- **Handoffs:** `.claude/handoffs/` (read by date/topic)
- **Reference docs:** `.claude/docs/` (read on demand, never all at once)

## Knowledge Maintenance
- **After fixing a non-trivial bug**, proactively update the relevant memory file following the `/lesson` workflow. Don't wait to be asked.
- When reading memory files, flag anything that contradicts the current codebase and fix it.
- Memory entries with dates >14 days old: verify before trusting stats/counts.
- **When adding new memory files**, add them to the appropriate `_index-*.md` section index (not directly to MEMORY.md). Keep MEMORY.md under 100 lines.

## Compaction Instructions
When compacting (`/compact`), ALWAYS preserve:
- List of files modified this session
- Current task state and what was agreed with the user
- Any test results, errors, or deployment outcomes
- Which domain memory files were already read (avoid re-reading)

<!-- code-review-graph MCP tools -->
## MCP Tools: code-review-graph

**IMPORTANT: This project has a knowledge graph. ALWAYS use the
code-review-graph MCP tools BEFORE using Grep/Glob/Read to explore
the codebase.** The graph is faster, cheaper (fewer tokens), and gives
you structural context (callers, dependents, test coverage) that file
scanning cannot.

### When to use graph tools FIRST

- **Exploring code**: `semantic_search_nodes` or `query_graph` instead of Grep
- **Understanding impact**: `get_impact_radius` instead of manually tracing imports
- **Code review**: `detect_changes` + `get_review_context` instead of reading entire files
- **Finding relationships**: `query_graph` with callers_of/callees_of/imports_of/tests_for
- **Architecture questions**: `get_architecture_overview` + `list_communities`

Fall back to Grep/Glob/Read **only** when the graph doesn't cover what you need.

### Key Tools

| Tool | Use when |
|------|----------|
| `detect_changes` | Reviewing code changes — gives risk-scored analysis |
| `get_review_context` | Need source snippets for review — token-efficient |
| `get_impact_radius` | Understanding blast radius of a change |
| `get_affected_flows` | Finding which execution paths are impacted |
| `query_graph` | Tracing callers, callees, imports, tests, dependencies |
| `semantic_search_nodes` | Finding functions/classes by name or keyword |
| `get_architecture_overview` | Understanding high-level codebase structure |
| `refactor_tool` | Planning renames, finding dead code |

### Workflow

1. The graph auto-updates on file changes (via hooks).
2. Use `detect_changes` for code review.
3. Use `get_affected_flows` to understand impact.
4. Use `query_graph` pattern="tests_for" to check coverage.
