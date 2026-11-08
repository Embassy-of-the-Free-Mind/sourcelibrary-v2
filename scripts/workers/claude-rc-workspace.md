# /root/work — phone sessions on this box

You were started from the Claude app (Remote Control) by Derek, probably on his phone. He can read
and reply but not easily look at a terminal: keep replies short, put links in full, and say plainly
what you did. Installed from `scripts/workers/claude-rc-workspace.md` in sourcelibrary-v2;
servers run by `/root/bin/claude-rc.sh` (one per Claude account).

## Where things are
- **Source Library live checkout: `/root/sourcelibrary` — NEVER edit, commit or switch branches in it.**
  The pipeline workers run from it and auto-pull rewrites it hourly. To change code, make a worktree:
  `git -C /root/sourcelibrary worktree add /root/sourcelibrary/.claude/worktrees/<name> -b <branch> origin/main`
  and follow `/root/sourcelibrary/CLAUDE.md` there (feature branch + PR; auto-merge decides by tier).
  Secrets: `node --env-file=/root/sourcelibrary/.env.production.local …` (worktrees have no env file).
- **Any other repo:** `gh` is logged in as JDerekLomas. Clone into `/root/work/<repo>` if absent
  (`gh repo clone JDerekLomas/<repo>`), `git pull` if present. Several sessions share this folder:
  if a clone is already in use, make a worktree (`git -C <repo> worktree add ../<repo>-<task> -b <branch>`).
  Active repos (2026-11): rehumanize, makemode, dereklomas-site, talks, earthlove, the-intelligences,
  conceptual-histories, voynich-translations, claude-limits, secret-lover; Embassy-of-the-Free-Mind/sourcelibrary-ops.
- **Other boxes:** `/root/bin/box.sh <main|cloudlayer|l7a|gex45> <verb>` runs only the verbs their
  box-rpc.sh allows (status and similar — no shell, by design). For real work on another box, Derek starts
  a session there instead: every box with Remote Control shows in the app under its own name.
- **Jobs on this box:** `tmux ls`; `claude-job.sh` jobs log under `/root/jobs/`. A job Derek should be able
  to watch from the phone: `/root/bin/claude-rc-job.sh start <name> "<brief>"`.

## Rules
- You run as root with permissions bypassed. Ask Derek before anything destructive or irreversible,
  anything that spends money, touches crontabs, auth, or deletes data.
- Commit and push finished work; don't leave changes only on this disk.
- The box also runs the paid pipeline at high load: don't start heavy CPU work (big builds, model runs)
  without saying so.
