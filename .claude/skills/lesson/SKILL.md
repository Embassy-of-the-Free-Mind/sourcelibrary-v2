---
name: lesson
description: Record a lesson learned after fixing a bug or discovering a pattern. Updates domain memory files and checks for contradictions. Use after resolving non-trivial issues.
---

# Record a Lesson Learned

After fixing a bug, resolving an incident, or discovering an important pattern, record it for future sessions.

## Steps

1. **Classify the domain.** Determine which memory file this belongs to:
   - Pipeline/cron/Lambda/workers → `memory/pipeline-ops.md`
   - Data quality/known bugs → `memory/data-quality.md`
   - UI/frontend/navigation → `memory/ui-navigation.md`
   - MCP server/CLI → `memory/mcp-server.md`
   - Cross-cutting/general → `memory/lessons-learned.md`
   - If it's a critical safety rule → also add to `MEMORY.md` (keep under 200 lines)

   **Before picking a doc tier at all, ask whether this should be a CHECK.** A doc only
   works if the next person reads it at the moment it applies, and that is a weak bet:
   measured 2026-08-21, three of four findings in one session were classes where the doc
   already existed and the thing recurred anyway (#4163, #4190). If you can name the file
   or symbol that must hold the property, prefer a sweeping test, a detector that files
   what it finds, or a constructor that throws — and let the doc be one line pointing at
   it. Run the negative control first (`invariants/tests-that-are-not-guards.md`): delete
   the guarded line, watch it go red, restore it. Keep prose for lessons about *judgment*,
   which cannot be asserted.

   **If it rises to an invariant** — a rule whose violation already cost real damage —
   pick the tier deliberately:
   - Applies *regardless of what you're working on* → `CLAUDE.md` (budget: ~5,500 words
     by `wc -w`; over it, demote something to `invariants/` first).
   - Fires only when someone touches a particular subsystem → a new or existing
     `.claude/docs/invariants/<name>.md`, **plus** a one-line trigger entry in
     `CLAUDE.md`'s routing table. If you can name the file or subsystem that triggers
     the rule, it belongs here — this is the common case.

2. **Check for contradictions.** Read the target memory file and check:
   - Does this contradict an existing entry? → Update the old entry, don't duplicate.
   - Does this make an existing entry obsolete? → Remove or update it.
   - Is there already an entry for this? → Strengthen it with new detail, don't duplicate.

3. **Write the entry.** Format:
   ```
   - **Short description (YYYY-MM-DD):** What happened, what the fix was, and the general rule to follow going forward.
   ```
   - Always include the date.
   - State the **rule** (what to do), not just the **story** (what happened).
   - Keep it to 1-2 lines. Link to files/docs if details are needed.

4. **Check staleness nearby.** While editing, scan neighboring entries:
   - Any entry with a date older than 30 days → verify it's still accurate or mark `(verify)`.
   - Any entry referencing a file path → quick-check the file still exists.
   - Any entry with stats/counts → mark as `(snapshot, may be stale)` if not already marked.

5. **Report.** Tell the user what was added, what was updated, and any stale entries found.

## Examples

Good entry:
```
- **Lambda timeout on large books (2026-03-13):** Books with >500 pages can exceed Lambda 15min timeout. Split into chunks of 400 pages max. See `src/lib/lambda-queue.ts:128`.
```

Bad entry (no date, no rule):
```
- Fixed the Lambda timeout issue.
```

## When NOT to use this

- Trivial fixes (typos, one-line changes) — not worth recording
- Session-specific context — use handoffs instead
- Speculative conclusions from reading one file — verify first
