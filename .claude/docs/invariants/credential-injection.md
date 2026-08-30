# Credential injection — secret-lover fails OPEN, and a worktree has no secrets

**Read this when:** you are about to run any script or worker under `secret-lover run`,
or you are running a pipeline/maintenance script **from a worktree**, or a job reports
that a store is empty / a key is invalid / "no rows found" and you are about to believe it.

Scar tissue from 2026-08-21, where two separate instances of this cost most of a session.

## 1. `secret-lover` reports an UNREADABLE secret as a MISSING one

It never says "I could not authenticate." Every read failure is reported as absence:

- `secret-lover run -- <cmd>` prints `Warning: N secret(s) not in Keychain (skipping)`
  and then **runs the command anyway** with those variables unset. The wrapper exits 0.
  The worker fails much later, on a symptom far from the cause.
- `secret-lover get NAME` prints `Error: Secret 'NAME' not found (checked project 'X'
  and global)` — while `secret-lover list --all` shows that exact name under that exact
  project.

**`list` and `get` disagreeing is the tell**: the store is intact, the read is not.

`secret-lover check` is worthless for this — it reported "All checks passed / Keychain
read/write working" throughout a total outage of project-scoped reads.

**One-call diagnostic:** read a **global** secret (e.g. `COMPOSIO_API_KEY`). Globals
succeeding while project-scoped reads fail isolates it to the auth session, not the data.

**Cause and recovery.** Project-scoped items need an interactive Keychain approval. A
non-TTY shell — every Claude Code `Bash` call — cannot display that dialog, so it
degrades to skipping. `secret-lover clear-auth` **destroys a working session** and puts
you here; never run it from an agent shell to "reset" something. Recovery needs a human:
`secret-lover get <ANY_PROJECT_SECRET>` in a real terminal, approve, choose **Always
Allow**. Related: `secret-lover run` has never worked in background processes for the
same reason.

Bypassing the CLI: Keychain service is `secret-lover/<project>`, account is the bare
variable name. Note `security find-generic-password -w` **hangs forever** on the GUI
approval dialog from a non-TTY shell — kill the pid rather than waiting.

## 2. A worktree resolves to the WRONG project and gets ZERO secrets

The project is derived from the directory containing `.secrets.json` (or its `project`
field). Run from `.claude/worktrees/<name>/` and secret-lover looks for a project
literally named `<name>`, finds nothing, and skips **every** secret — including
`SUPABASE_DB_URL`, which exists nowhere else.

This collides head-on with the repo rule that all feature work happens in worktrees:
**any pipeline worker launched from a worktree runs with no credentials, and does not
fail.** It proceeds emptily and reports an empty result as a finding.

**Fix — keep cwd in the MAIN checkout and pass the worktree's script by absolute path.**
Relative imports resolve from the script file, so the worktree's code runs under the
main checkout's secret namespace:

```
cd ~/sourcelibrary && secret-lover run -- node --env-file=.env.production.local \
  .claude/worktrees/<wt>/scripts/workers/<worker>.mjs --dry-run
```

If the script only needs Mongo, skip secret-lover entirely — `MONGODB_URI` is in
`.env.production.local`, and `node --env-file=...` alone connects instantly.

## 3. A parent-set variable SHADOWS `--env-file`

`secret-lover run` injects its stored value into the parent environment, and
`node --env-file` does **not** override a variable the parent already set. So a stale
Keychain key silently shadows a working one in `.env.production.local`. In August 2026
secret-lover held pre-rotation Gemini keys for both `GEMINI_API_KEY` and
`GEMINI_API_KEY_TIER3`; because both arms of the usual `TIER3 || KEY` fallback were
dead, the fallback could not save it, and the failure arrived as 175 identical Gemini
400s — one per book — reading like every book breaking at once rather than one auth
fault.

**Rotating a key means rotating it in every store that injects it**, not just the env
files. Verify by **use**, with a positive control in the same sweep: a 400 means nothing
until another key returned 200 in the same run.

**Preflight, don't discover.** A worker that authenticates per-item turns one auth fault
into N identical failures. One probe call before the walk turns it into one line naming
the cause — `scripts/workers/embed-page-texts.mjs` does this.
