# The decision queue — /platform/admin/decisions (#6258)

PRIOR ART: none in this repo — searched `.claude/docs`, `docs/`, `scripts/maintenance`, `src/lib` for decision/pending/hold tooling. The `/decisions` terminal command and DECISIONS-PENDING.md live in the private ops repo; `scripts/maintenance/safe-merge.sh` is reused, not replaced.

**Read this when:** changing the decisions page, `src/lib/decision-queue*.ts`, `scripts/maintenance/decision-answers-drain.mjs`, or the `decision_answers` collection; the groups or briefs (`src/lib/decision-briefs.ts`, `scripts/maintenance/decision-briefs.ts`, `decision_briefs`); or building stage 2 (the laptop session sync).

## Who it is for

Derek, on his phone, in bursts of a few minutes. One card per decision, oldest and most expensive first (one day of age weighs as much as $10, the spend floor; the dollar figure is the largest one in the row, a heuristic). Each card: question, recommended default, what Default does, evidence links, **Default / Other / Skip**. A card that cannot be decided on a phone (a diff over 15 files or 400 lines, a row over 1,200 characters) says "Needs a desk" — Skip it.

## Sources

| source | read from | Default does | Other does |
|---|---|---|---|
| `tier:hold` PRs | GitHub GraphQL, live, with `GITHUB_TOKEN` | queues a merge; the drainer runs `safe-merge.sh` | queues a PR comment + the `blocked` label |
| ops `DECISIONS-PENDING.md` | GitHub contents API, live, the same `GITHUB_TOKEN` `/shared/[slug]` uses | records the answer | records the answer |
| stuck sessions | not yet (stage 2, below) | — | — |

**Every answer** is a row in Mongo `decision_answers`: who, when, what the card said, the choice, the text, and a status (`queued` → `acting` → `done` / `refused` / `failed`, or `recorded`). The page hides a card once it has an answer; a refused or failed action brings it back with the reason. Skip hides it for 24 h.

A PR card is keyed to its head sha, so a push after an answer is a new decision. An ops card is keyed to its section + opening bold text, so an edited recommendation is a new decision.

### Why PR actions are queued, not done in the web function

A web function that can merge to `main` deploys production: the site would need a GitHub token with write on the code repo, and `safe-merge.sh` waits up to two minutes for GitHub to compute mergeability. So the page writes a `queued` row, and `scripts/maintenance/decision-answers-drain.mjs` acts on it every 5 min on Hetzner (line in `infrastructure/hetzner-crontab`, auto-applied by the git-pull cron), with the box's own `gh` login. It runs `safe-merge.sh` itself — one gate for the terminal and the page — and adds three guards: the PR is still open and `tier:hold`; its head is the sha Derek answered on; at most one merge per run, only when main's tip is ≥ 8 min old (as `auto-merge.mjs`). **Writing a `queued` row is actuation**: the drainer acts on it within about 5 minutes.

The answer route rebuilds the card from its live source and refuses (409) when it no longer exists, so a stale page cannot queue a merge of code Derek did not see. It accepts only a platform superadmin: `withAuth` lets the `CRON_SECRET` bearer through as `admin` without checking `minRole`, so the route checks the platform grant itself.

Known gap: between the drainer's sha check and `safe-merge.sh`'s own pinned merge there are a few seconds in which a push could land; `safe-merge.sh` then merges the sha *it* checked. An `--expect-head <sha>` flag on `safe-merge.sh` would close it.

### Why the ops file is read through the GitHub API, not mirrored into Mongo

The file is edited by sessions with git, many times a day. A Mongo mirror needs a writer on every push (a workflow in the ops repo, or a cron), and goes stale silently when that writer breaks; a live read cannot be stale. The site already reads the ops repo with `GITHUB_TOKEN` (`src/app/shared/[slug]/route.ts`), so stage 1 needs no new secret.

**Write-back (moving a row to `## Done`) is stage 2** and needs a new secret: `OPS_REPO_TOKEN`, a fine-grained PAT scoped to `Embassy-of-the-Free-Mind/sourcelibrary-ops` only, permission *Contents: read and write*, set in Vercel (Production). Until then,
`node --env-file=.env.production.local scripts/maintenance/decision-answers-drain.mjs --list-ops`
prints the recorded ops answers as `## Done` lines for a session to move by hand. When a session acts on a decision and deletes the row (the file's own rule), the card goes too.

## Groups and briefs (#6280)

On 2026-10-08 the queue held 91 cards (71 held PRs, 20 ops rows). Two things cut that down without hiding a decision.

**Groups (no model).** `groupCards` in `src/lib/decision-briefs.ts`. PRs that name the same issue in their title are one group ("13 PRs on #6215: …"); ops rows under one section are one group; the first group is open and the rest are closed until tapped. A PR card whose Default cannot act (conflicts, `blocked`, stacked on another branch, a draft, a failing required check) is not Derek's to decide yet, so it sits in a closed "back with their author" list at the bottom and is not counted in "to decide".

**Briefs (a Claude session's reading).** One row per card in Mongo `decision_briefs`: a two-sentence summary, a recommendation (`default` / `other` with the text to send / `skip`), one to three reasons that each name what was read, the risk if the recommendation is wrong, the other cards it goes with, and what the writer opened. The card shows the brief above the opener's own default, says when the two differ, and rings the recommended button. When the recommendation is Other, the Other box opens with the text filled in for Derek to edit.

- **A brief is a note, not an action.** Nothing reads `decision_briefs` except the page. Only Derek's tap writes `decision_answers`. There is no "accept all recommendations" button and none should be added: held PRs are never merged on classification alone.
- **A brief cannot go stale silently.** It is keyed to the card id, which changes with the PR's head sha or the ops row's text. After a push the card has no brief until someone reads it again, and says so.
- **Who writes them.** A Claude Code session on the subscription, never an API key, so the web function cannot write one. `scripts/maintenance/decision-briefs.ts --packets <dir>` writes one evidence file per card without a brief (PR body, files, checks, last comments, linked issue, diff up to 40K characters; or the ops row in full) plus `INSTRUCTIONS.md`; the session reads them and writes `briefs/<card id>.json`; `--ingest <dir>` validates each against the live queue and upserts. `--status` counts what is briefed. Fan-out rule: at most eight readers, each writing files, never one reader per card.
- **Not scheduled.** The writer has no cron. Until it does, briefs appear when a session runs the pass (the `/decisions` terminal command is the natural place).

## Stage 2 design: stuck background sessions (not built)

Background sessions live on Derek's Mac: `~/.claude/jobs/<id>/state.json`. The site cannot see the laptop, so the laptop pushes and pulls; nothing inbound to the laptop is needed.

1. **Up (laptop → Mongo).** A `launchd` agent on the Mac runs every 5 min. For each job stopped on a question it upserts `decision_sessions { _id: <job id>, host, title, question, proposed_default, asked_at, last_output_tail, synced_at }`, and deletes rows for jobs that are running again or gone. It writes with a narrow credential — a Mongo user whose only grants are `readWrite` on `decision_sessions` and `find`/`update` on `decision_answers`, never the app credential — named `DECISIONS_SYNC_MONGO_URI`, in the laptop keychain via secret-lover.
2. **Cards.** `loadQueue` reads `decision_sessions`. A row not synced in the last hour shows "laptop not synced since …" rather than a question that may already be answered. Default = the session's own proposed answer when it named one, else "continue"; Other = free text; Skip.
3. **Down (Mongo → session).** An answer with `source: 'session'`, `status: 'queued'`. The same launchd agent claims it (`queued → acting`, atomically, so delivery is at most once), delivers it (`claude --resume <id> -p "<answer>"` in the job's directory, detached), and sets `done` with the delivery time, or `failed` with the error.
4. **Must not.** No inbound port or tunnel to the laptop. Never deliver to a session whose question changed since the card was shown: key the card to `question` + `asked_at`, as PR cards are keyed to the head sha.
