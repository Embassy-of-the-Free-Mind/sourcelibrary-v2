# /root/work — phone sessions on this box

You were started from the Claude app (Remote Control) by Derek, probably on his phone. He can read
and reply but not easily look at a terminal: keep replies short, put links in full, and say plainly
what you did. Installed from `scripts/workers/claude-rc-workspace.md` in sourcelibrary-v2;
servers run by `/root/bin/claude-rc.sh` (one per Claude account).

## Derek's rules and lessons: read these first
The laptop sessions work under Derek's global rules and about 850 saved lessons. A box has neither
unless you read them. A private copy, synced from the laptop daily, is in `/root/claude-home`.
1. `git -C /root/claude-home pull -q` (if the folder is missing: `gh repo clone JDerekLomas/claude-home /root/claude-home`).
2. Read `/root/claude-home/CLAUDE.md` in full before your first action: autonomy and when to stop and ask,
   the spend floor, the Gemini API rule, who merges, style. It names some laptop-only tools (secret-lover,
   Decision Deck, vibedeck, the climits menubar): skip those here. Where it and this file disagree
   about the box, this file wins.
3. Read the index `/root/claude-home/memory/MEMORY.md` (one line per lesson) and open the files that
   match your task before starting it.
- Never edit `/root/claude-home`: the laptop is the source and the next sync overwrites it. A lesson learned
  here goes in the repo it belongs to (a doc, an issue, a handoff in the ops repo), or tell Derek.
- The private ops repo (RUNNING.md, DECISIONS-PENDING.md, handoffs, `security/`) is at
  `/root/work/sourcelibrary-ops`; pull before reading it.

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

## Security and provenance (2026-11-11)
- **Infra and security details never go in the public `sourcelibrary-v2` repo** (issues, PRs, comments). That means IPs, keys, fingerprints, hostnames, `.env` contents and access findings. Put them in the private ops repo (`security/`). agent-guard logs a public post that carries them as `public-infra-leak`.
- **Start a job on another box only with `box.sh <box> start <name> < brief`**, never a raw `ssh root@…`, so the launcher is recorded. "Where did job X come from?" → `job-ledger.sh why X`, or ops `jobs/ledger/`.
- **agent-guard** (`/root/bin/agent-guard.py`) checks every tool call against the project's rules. It is in **shadow mode**: it logs, blocks nothing. `agent-guard.py report 7` shows what it would block. A deny that names a rule means enforcement is on: ask Derek, don't work around it.
- Plan, open decisions and audits: ops `security/agent-fleet-security-plan.md`. Shared ops store (provenance, claims, decisions, notes): #8609.
