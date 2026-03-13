# Context Token Optimization — March 12, 2026

## Problem

Claude Code costs were spiking. Root cause: 15 reference docs in `.claude/docs/` were auto-loaded into every conversation turn via `@` prefix in `CLAUDE.md`.

Each `@.claude/docs/filename.md` reference causes Claude Code to inject the full file contents as "project instructions" in the system prompt. With 15 large docs (pipeline, worker architecture, analytics, search, etc.), this added ~50-60k tokens to every single message — before any actual work happened.

## Fix

Removed the `@` prefix from all 15 doc references in `CLAUDE.md`. Changed from:
```
- Import APIs: @.claude/docs/import-apis.md
```
To:
```
- Import APIs: `.claude/docs/import-apis.md`
```

Added a note: "Read these on demand when working on related features — do NOT load all at once."

## Impact

- ~50-60k fewer input tokens per conversation turn
- Docs are still discoverable (listed in CLAUDE.md) and can be read with the Read tool when needed
- No loss of capability — just stops paying for docs that aren't relevant to the current task

## What still auto-loads

- `CLAUDE.md` (project, ~2k tokens) — always loaded, contains critical rules
- `~/.claude/CLAUDE.md` (global, ~1.5k tokens) — always loaded, user preferences
- `MEMORY.md` (~4k tokens) — always loaded, session context

These are small and genuinely needed every turn.

## Commit

`accd0a6d` on main — "Stop auto-loading 15 reference docs into Claude Code context"
