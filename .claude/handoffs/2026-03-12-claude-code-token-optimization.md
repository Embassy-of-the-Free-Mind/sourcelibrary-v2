# Claude Code Token Optimization

## Problem

Claude Code API costs are high. The primary cause is **system context loaded on every turn**.

## What's Loading Per Turn

Every message in a Source Library session loads:

| Source | Est. Tokens | Loaded How |
|--------|-------------|------------|
| `CLAUDE.md` (project) | ~2k | Auto-loaded |
| `~/.claude/CLAUDE.md` (global) | ~2k | Auto-loaded |
| 12x `@.claude/docs/*.md` references | ~30-35k | `@` references in CLAUDE.md |
| `MEMORY.md` | ~4-5k | Auto-loaded (auto-memory) |
| Skill list (system reminder) | ~3k | Auto-loaded when skills installed |
| Git status | ~2-3k (huge untracked list) | Auto-loaded |

**Total baseline per turn: ~45-50k tokens before any user message or tool results.**

Over a 30-turn session, that's ~1.5M tokens just in system context — before any actual work.

## Highest-Impact Fixes

### 1. Remove `@` doc references from CLAUDE.md (~30-35k tokens/turn saved)

The 12 `@.claude/docs/*.md` lines in `CLAUDE.md` cause every doc to be injected into every turn:

```
@.claude/docs/import-apis.md
@.claude/docs/image-archiving.md
@.claude/docs/observability.md
@.claude/docs/page-lifecycle.md
@.claude/docs/worker-architecture.md
@.claude/docs/batch-processing.md
@.claude/docs/editions.md
@.claude/docs/social-media.md
@.claude/docs/analytics.md
@.claude/docs/search.md
@.claude/docs/structured-data.md
@.claude/docs/style-system.md
@.claude/docs/pipeline.md
@.claude/docs/first-translation-system.md
@.claude/docs/thumbnails.md
```

**Fix:** Remove the `@` prefix from these lines (or remove the lines entirely). The docs still exist at `.claude/docs/` — Claude Code can read them on demand when a task touches that system. Most turns don't need all 12 docs.

**Trade-off:** Claude won't have instant awareness of all subsystems. For complex cross-cutting tasks, you may need to say "read the pipeline docs" or "check .claude/docs/worker-architecture.md". For most tasks, Claude will naturally discover what it needs via Grep/Read.

### 2. Clean up untracked files (~1-2k tokens/turn saved)

The git status snapshot includes 300+ `_tmp-*.mjs` files. This bloats the initial context. Either:
- Add `_tmp-*` to `.gitignore` (they're already not committed, but gitignore suppresses them from `git status`)
- Periodically delete old temp scripts

### 3. Trim MEMORY.md (~2-3k tokens/turn saved)

MEMORY.md is ~200 lines and growing. Archive older/resolved items to a separate file (e.g., `memory/archive.md`). Keep MEMORY.md focused on active, frequently-referenced info.

### 4. Use `/clear` between tasks

Each new task in the same session carries forward all prior tool results and messages. `/clear` resets to just the system context. Use it when switching between unrelated tasks.

### 5. Avoid unnecessary agent spawns

Each Agent tool call creates a subagent that inherits the full system context (~45-50k tokens). For simple lookups (one file read, one grep), use Read/Grep directly instead of spawning an Explore agent.

## Recommended Action

The single biggest win is fix #1 — removing `@` doc references saves ~30-35k tokens per turn. To implement:

1. Edit `CLAUDE.md`
2. Change the "Reference Docs" section from `@.claude/docs/foo.md` to just `.claude/docs/foo.md` (plain text path, not an include)
3. The docs remain available — Claude reads them when needed

## Pending Work

- **Champier book thumbnails**: 196/410 pages missing `thumbnail_blob` on book `6980941f1eb524781a7fdc09`. The `POST /api/books/{id}/generate-thumbnails` route returned 401. Need to either run thumbnail generation locally or authenticate the API call. Low priority — thumbnails will generate naturally when the book is reprocessed.
