# Three scheduled detectors were blind, and two of them filed their own error as a finding

**Date:** 2026-08-19
**Session:** issue close-out sweep ("any recent issues to close out")
**Outcome:** 4 issues closed as artifacts, 1 PR merged, 1 issue filed and assigned, 1 invariant written

## What happened

Started as a routine backlog sweep. The four most recent auto-filed issues turned
out to share a single cause that nobody had looked at, because everyone had been
reading them by title.

**#3572, #3862, #4009** — "Image/text misalignment found in weekly sample", three
consecutive Mondays (Aug 3, 10, 17). **#4023** — "Field sprawl breach on books".
The fenced payload in every one of them is the script's own error:

```
MONGODB_URI not set — source .env.production.local first
```

`gh secret list` returns exactly four secrets: `CF_ZONE_ID`,
`CLOUDFLARE_API_TOKEN`, `CRON_SECRET`, `HETZNER_SSH_KEY`. There is no
`MONGODB_URI`. Three scheduled jobs reference `secrets.MONGODB_URI` and have
therefore never opened a database connection:

| workflow / job | cadence | state |
|---|---|---|
| `corpus-integrity-watch.yml` → `alignment-sample` | weekly Mon 07:00 UTC | never sampled a book |
| `corpus-integrity-watch.yml` → `feedback-clusters` | daily 08:00 UTC | never clustered a report |
| `field-sprawl-watch.yml` → `field-sprawl` | weekly Tue 07:30 UTC | never counted a field |

The PR-time `field-write-lint` job in the same workflow needs no database and has
been working — the static half of the #3969 ratchet held.

## Why it hid for weeks

Both failure directions were live simultaneously.

- **Loudly wrong.** `bulk-archive-alignment.mjs` exited `1` for "found
  misalignment" *and* for "no MONGODB_URI"; the workflow files a finding issue on
  `1`. `field-sprawl-watch.yml` filed on `fired != '0'`, which swept its script's
  correct exit `2` into the finding branch.
- **Silently wrong.** `feedback-symptom-clusters.mjs` exits `2` and its job files
  only on `1` — green daily since July, zero reports clustered, no trace anywhere.

`set +e` (needed to capture the exit code) meant every run reported **success** in
the Actions UI. So the four filed issues were the only visible signal, and they
pointed at the corpus rather than at the harness.

## Files modified

- `scripts/audit/bulk-archive-alignment.mjs` — exit `2` on missing `MONGODB_URI`
  and on uncaught throw; `1` reserved for a real finding
- `.github/workflows/field-sprawl-watch.yml` — files on `fired == '1'` (was
  `!= '0'`); new step fails the job on anything outside `{0,1}`
- `.github/workflows/corpus-integrity-watch.yml` — same failure step on both jobs
- `.claude/docs/invariants/measurement-instruments.md` — new section "A detector
  that cannot run must go RED, never file a finding"
- `CLAUDE.md` — routing line extended to cover scheduled detectors; fixed the
  fresh-worktree lamejs command, which was missing its `mkdir -p` and fails as
  written (cost one failed commit this session)

## Verification

With `MONGODB_URI` unset, all three scripts now exit `2`
(`bulk-archive-alignment.mjs --sample 1`, `field-sprawl.mjs --collection books`,
`feedback-symptom-clusters.mjs --days 14`). Both workflow YAMLs parse;
`node --check` passes on the script. PR #4072 green on `test`/DCO/field-write-lint,
merged as `6aba91ac`. No deploy owed — `.github/` + `scripts/` only.

The behaviour with a *working* secret is untestable until the secret exists.

## State / what's next

- **#4071 is open and assigned to `Mayank-PPL`.** It needs a `MONGODB_URI` repo
  secret. Deliberately **not** the personal full-access URI in
  `.env.production.local` — this repo is public and all three jobs are read-only
  censuses; the right credential is a new read-only Atlas user.
- **Permission split, discovered while writing the handoff comment:** Mayank has
  `write`, not `admin`, and GitHub requires admin to set a repo secret. So
  `gh secret set` must be Derek. Mayank can do the Atlas half (create
  `ci-readonly` with *Only read any database*; open Network Access to `0.0.0.0/0`
  — GitHub runners have no stable egress range) and hand the URI over
  out-of-band, never in the public thread.
- Verification is step 4 of #4071: `gh workflow run corpus-integrity-watch.yml`
  and `gh workflow run field-sprawl-watch.yml`. After #4072, a still-broken secret
  produces a **red run**, not a fifth false issue.
- Nothing is known about whether the corpus is actually misaligned or sprawling.
  It has not been measured since these detectors were added; it becomes knowable
  when the secret lands.

## Also noted, not acted on

Two other issues are one action from closing, both blocked on Derek specifically:

- **#3991** — `@source-library/mcp-server` is 4.6.0 in-repo, 4.5.0 on npm since
  2026-06-28. Derek is the sole npm maintainer: `cd mcp-server && npm publish`.
  That also closes the last open half of **#3937** (stdio-package users have no
  images).
- **#4025** — the `frondular` Vercel scope watching this repo produces the failing
  deploy statuses. Vercel → frondular → sourcelibrary-v2 → Settings → Git →
  Disconnect closes #4025 and #4060 together; real builds run on
  `dereklomas-projects`.

Checked the last 25 merged PRs for `Closes #` links pointing at still-open issues
— none. Merge hygiene is clean. Backlog is 275 open after this sweep.

## The transferable lesson

Every detector gets a three-value exit contract — `0` clean, `1` finding, `2`
could-not-run — and the caller reads all three. Never branch a finding on `!= 0`.
An uncaught throw is `2`, not `1`. And verify a detector by making it *fail*: a
green scheduled run proves nothing about an instrument whose failure mode is
silence. Written up in `measurement-instruments.md`.

Diagnostic tell: an auto-filed issue whose fenced block is an error message rather
than a measurement. When a watchdog files the same title on a regular cadence and
nobody acts, suspect the watchdog before the corpus.
