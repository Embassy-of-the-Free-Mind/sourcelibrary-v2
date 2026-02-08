# Dev Environment Optimization — 2026-02-08

## What was done

### Terminal tools installed & configured
- **tmux** — config at `~/.config/tmux/tmux.conf`. Prefix is `Ctrl+A`. Mouse on, intuitive splits (`|` and `-`), Alt+Arrow pane switching.
- **fzf** — shell integration in `.zshrc`. Ctrl+R (history), Ctrl+T (files), Alt+C (cd).
- **bat** — aliased as `cat`. Config at `~/.config/bat/config` (ansi theme, line numbers).
- **`dev-sl`** script at `~/.local/bin/dev-sl` — launches tmux workspace with dev server + git log panes.

### CLAUDE.md optimized
- **Global `~/.claude/CLAUDE.md`** — added Autonomy, Links, Working Style sections. Emphasizes: be autonomous, full clickable URLs, collaborative codebase mindset, UX-first.
- **Project `sourcelibrary/CLAUDE.md`** — slimmed from 320 to ~40 lines. Reference docs moved to `@.claude/docs/import-apis.md` and `@.claude/docs/image-archiving.md`. Gemini model (`gemini-3-flash-preview`) emphasized as IMPORTANT.

### Claude Code config
- **Settings** (`~/.claude/settings.json`): sandbox off, all tools allowed, deny list only blocks `.aws/`, `.ssh/`, `rm -rf /|~`. PostToolUse hook runs eslint --fix on edits (finds nearest eslint config automatically).
- **Status line**: shows `Model | dir | ctx: N% | ~$X.XX` plus agent name when subagent running.
- **Slash commands**: `/ship` (commit+push+PR), `/review` (audit diff), `/dev` (tmux workspace).
- **Subagents**: `security-reviewer`, `code-simplifier` in `.claude/agents/`.
- **`.claudeignore`**: excludes `.next/`, `node_modules/`, `data/`, build artifacts.
- **Compaction instructions**: preserve modified files, task state, test results, user decisions.

### Security cleanup
- Supabase URL/key and Google OAuth credentials moved from `.zshrc` to `secret-lover` (macOS Keychain).
- Duplicate PATH line removed from `.zshrc`.
- `.secrets.json` created for sourcelibrary listing all 15 required secrets + static env vars. Added to `.gitignore`.
- `.env*` files are now readable (removed from deny list) — only embedding secrets in code is blocked.

## Committed & pushed
- `89a7685` — CLAUDE.md, commands, agents, docs, claudeignore (pushed to origin/main)
- `.gitignore` update and `.secrets.json` are uncommitted local changes

## Open items
- **Secret-lover migration**: The 15 secrets in `.env.local` could be migrated to keychain so `secret-lover run -- npm run dev` works. Currently `dev-sl` runs `npm run dev` directly (reads `.env.local`).
- **Terminal dark mode**: Ghostty follows macOS appearance. `darkmode` alias in `.zshrc` toggles system-wide. No in-session toggle exists — waiting on `CSI ? 2031` adoption across tools.
- **Status line limitation**: Can't show billing mode (subscription vs API) or subagent models — not exposed in status line JSON. Claude will mention subagent models in response text instead.
