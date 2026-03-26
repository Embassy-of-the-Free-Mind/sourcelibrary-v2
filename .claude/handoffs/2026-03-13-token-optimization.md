# Token Optimization — March 12-13, 2026

## Problem

Claude Code costs spiking. Root cause: 15 reference docs in `.claude/docs/` auto-loaded into every turn via `@` prefix in `CLAUDE.md`, adding ~50-60k tokens before any actual work.

## Fixes Applied

1. **Removed `@` doc prefixes** — ~50-60k fewer tokens/turn. Docs still discoverable, read on demand.
2. **`.gitignore` + `.claudeignore`** — suppressed 300+ tmp files from git status and file index.
3. **MEMORY.md restructured** — 186 → 59 lines, domain knowledge split to `memory/*.md` files.
4. **CLAUDE.md trimmed** — 80 → 51 lines, sections moved into lazy-loaded skills.
5. **Domain context skills created** — `/pipeline-context`, `/ui-context`, `/maintenance`, `/lesson` — load ~50 tokens metadata until invoked.

## Impact

~30-40% reduction in per-session token overhead (~8k tokens/turn fewer).

## What still auto-loads

- `CLAUDE.md` (~2k tokens) — critical rules
- `~/.claude/CLAUDE.md` (~1.5k tokens) — user preferences
- `MEMORY.md` (~4k tokens) — session context

## Key commits

`accd0a6d`, `65c00100`, `70586052`, `fec21bb2`, `76c09fd4`, `2fe1ab48`

## Related

- GitHub issue #161 (closed)
- GitHub issue #162 (closed — AI-assisted memory review, triaged out 2026-03-25)
