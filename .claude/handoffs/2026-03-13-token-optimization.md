# Token Optimization System — Handoff

## What was done

Completed GitHub issue #161: reduced Claude Code per-session token overhead by ~30-40% (~8k tokens/turn).

### Changes made

**Context reduction:**
- `.gitignore` + `.claudeignore` — suppressed 300+ tmp files from git status and file index
- MEMORY.md restructured from 186 → 59 lines, with 6 domain memory files split out
- CLAUDE.md trimmed from 80 → 51 lines by moving sections into lazy-loaded skills
- Handoffs un-hidden from .claudeignore (indexed but not auto-loaded)

**Domain context skills (load ~50 tokens metadata until invoked):**
- `/pipeline-context` — pipeline, cron, Lambda, OCR, translation + audit trail
- `/ui-context` — UI, frontend, navigation, analytics
- `/maintenance` — data fixes, page counts, quality issues
- `/lesson` — structured workflow for recording bugs/patterns into memory files

**Self-correcting knowledge:**
- All 3 domain skills include "Staleness Check" section — Claude flags contradictions and outdated entries when loading context
- CLAUDE.md instructs Claude to auto-detect domain from prompts and load context without being asked
- CLAUDE.md instructs Claude to proactively update memory after non-trivial fixes
- Memory entries with dates >14 days flagged for verification

**Session workflow:**
- Global CLAUDE.md: Claude suggests `/clear` when user switches domains
- Compact instructions preserve: files modified, task state, agreements, which memory files were read

### Key files

- `/Users/dereklomas/sourcelibrary/CLAUDE.md` — 51 lines, always loaded
- `~/.claude/projects/-Users-dereklomas-sourcelibrary/memory/MEMORY.md` — 59 lines, always loaded
- `memory/pipeline-ops.md`, `data-quality.md`, `lessons-learned.md`, `ui-navigation.md`, `mcp-server.md`, `conversation-index-notes.md` — domain files, read on demand
- `.claude/skills/pipeline-context/`, `ui-context/`, `maintenance/`, `lesson/` — skill definitions

### MCP audit result
No user-configured MCP servers found. Gmail tools are platform-managed. Nothing to disable.

## What to watch

1. **Does Claude auto-load domain context?** The instructions say "detect the domain and load the right context automatically." If it doesn't happen, strengthen the CLAUDE.md wording or add explicit triggers to skill descriptions.
2. **Does /lesson capture happen after fixes?** Instructions say "proactively update memory." If Claude skips this, the instruction may need to be more forceful or moved to a hook.
3. **Is CLAUDE.md the right size?** 51 lines. If Claude keeps making mistakes that are covered in domain memory files but not CLAUDE.md, some critical rules may need to move back.
4. **Staleness detection working?** Domain skills instruct Claude to flag contradictions. If stale entries persist for weeks, the instructions aren't effective.

## Related

- GitHub issue #161 (closed): https://github.com/Embassy-of-the-Free-Mind/sourcelibrary-v2/issues/161
- GitHub issue #162 (open): AI-assisted memory review system
- Commits: 65c00100, 70586052, fec21bb2, 76c09fd4, 2fe1ab48
