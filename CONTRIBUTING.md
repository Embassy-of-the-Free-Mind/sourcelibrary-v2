# Contributing to Source Library

This guide is for human collaborators working on this repo alongside Derek. It covers
the practical mechanics: setup, branches, PRs, how deploys work, and the few rules
that protect shared production data. Deeper doctrine lives in [CLAUDE.md](./CLAUDE.md) —
it's written to be read by AI coding assistants, but everything in it binds humans too.
If you work with an AI assistant (Claude Code, Cursor, etc.), point it at CLAUDE.md;
that one file is the single source of truth, deliberately not duplicated across
`.cursorrules`/`AGENTS.md`/etc.

## The shape of collaboration

- **`main` is production.** Every merge to `main` auto-deploys sourcelibrary.org
  within ~6 minutes. There is no staging branch.
- **All changes go through PRs.** Never push directly to `main`, even for one-liners.
- **Prod data is shared.** The MongoDB Atlas cluster and Supabase project behind your
  local dev server are the *live production stores*. Reading is fine; destructive
  writes need coordination (see Data safety below).
- **Coordination happens in GitHub issues.** Non-trivial work starts as an issue with
  a plan; comment "taking this" on an issue before you start so two people (or two
  AI sessions) don't build the same thing.

## One-time setup

1. Clone and install:
   ```bash
   git clone https://github.com/Embassy-of-the-Free-Mind/sourcelibrary-v2.git
   cd sourcelibrary-v2
   npm install
   ```
2. Copy `.env.example` to `.env.local` and ask Derek for credentials. You need at
   minimum: `MONGODB_URI`, the Supabase URL + anon key, and a Gemini API key for any
   AI-touching work. Never commit secrets; never hardcode them in scripts — use
   `process.env.VAR` with no fallback.
3. Run `npm run dev` and open http://localhost:3000. Remember: this is talking to
   production data.
4. Configure your git identity for DCO (see below).

## Branch and PR workflow

1. **Branch off `main`** — one branch per concern: `feat/x`, `fix/y`, `docs/z`.
   No long-running dev branches.
2. **Sign off every commit** (DCO check is enforced):
   ```bash
   git commit -s -m "fix(scope): what and why"
   ```
   The `-s` adds `Signed-off-by: Your Name <your-email>` using your git identity.
3. **Before opening the PR:** run `npx tsc --noEmit` (type errors are the #1 source
   of wasted deploy cycles) and `npm test`.
4. **Open the PR:** `gh pr create --base main`. Keep PRs focused — one concern per
   PR; state what's in scope *and* what you deliberately left out.
5. **Pushing the branch gives you a preview URL automatically** (a Vercel Preview
   deployment builds from Derek's Vercel project). Use that to test and share —
   you do not need any Vercel setup of your own.
6. **After merge, delete the branch.**

Details, conventions, and the reasoning behind them: [CLAUDE.md → PR Conventions](./CLAUDE.md#pr-conventions).

## How deploys work (and what NOT to set up)

- **Merging to `main` deploys production.** The repo's Git integration builds on
  Derek's Vercel team (`dereklomas-projects`), and a GitHub Action
  (`post-deploy-warm.yml`) then purges the Cloudflare CDN and re-warms pages.
  You never run a deploy yourself.
- **Do NOT connect this repo to your own Vercel account.** A second Vercel project
  watching the same repo posts its own (failing) deploy statuses onto every commit
  and PR. This is not hypothetical — as of Aug 2026 a project under the `frondular`
  Vercel scope is doing exactly this, and it:
  - marks PRs with a red "Vercel" check that has nothing to do with the real build
    (issue #4025), and
  - makes the post-deploy purge refuse to run after merges, leaving stale cached
    HTML pointing at deleted assets (issue #4060).

  **If that project is yours, disconnecting it fixes both issues in one stroke:**
  1. Go to https://vercel.com and switch to the `frondular` scope (top-left scope picker).
  2. Open the `sourcelibrary-v2` project there.
  3. Settings → Git → **Disconnect** the `Embassy-of-the-Free-Mind/sourcelibrary-v2`
     repository. (Or delete the whole project via Settings → Advanced → Delete
     Project — it serves no traffic.)
  4. That's it. You'll know it worked when the next PR shows a single Vercel check
     from `dereklomas-projects` instead of two.

  If you want your own playground deployments, deploy a fork, or use
  `vercel --cwd` against a scratch project *not* linked to this GitHub repo.

## Reading the checks on your PR

- **`test` and `DCO` are the truth.** Green there = mergeable in principle.
- **The Vercel check is currently unreliable** (see above): it can show "fail" from
  the stray integration, or stay "fail" after a successful retry. Judge the real
  build by the preview URL on your branch, or `npx vercel ls sourcelibrary-v2
  --meta githubCommitRef=<your-branch>` if you have CLI access to Derek's scope.
- **To block a PR** (yours or anyone's) with a real finding, add the `blocked`
  label — review comments scroll away; the label is what automated sweeps respect.

## Data safety — the hard rules

These exist because each one has already caused a real incident (receipts in
[CLAUDE.md](./CLAUDE.md), "CRITICAL" sections):

- **Never batch-delete books, pages, or source material.** List what you'd delete,
  get explicit confirmation first. (`deleted_books` keeps restorable copies, but
  don't lean on it.)
- **Every R2/page-image key must contain its own `book_id`** — write through the
  guarded helpers (`storagePut`, `src/lib/r2-key.ts`), never construct keys by hand.
- **Writing to a store that a cron/worker reads is actuation, not note-taking.**
  Before inserting rows into any ledger/queue collection, know what job consumes it
  and when it next runs.
- **Anything you're unsure about:** check the invariants index in CLAUDE.md — each
  entry is routed by the subsystem you're touching and opens with a "read this when"
  line.

## Where knowledge lives

| Place | What it holds |
|---|---|
| [CLAUDE.md](./CLAUDE.md) | Always-applicable doctrine: workflow, critical invariants, mission |
| [.claude/docs/invariants/](./.claude/docs/invariants/) | Subsystem-specific invariants (loaded when relevant) |
| [.claude/docs/](./.claude/docs/) | Reference docs, system map, specs |
| [memory/](./memory/) | Team facts loaded by AI skills (pipeline ops, UI, data quality) |
| GitHub issues | Plans, work claims, feedback triage |

This repo is **public (AGPL)**. Business/ops material (fundraising, contacts,
budgets) belongs in the private ops repo, never here.

## Questions

Open an issue, or leave feedback through the site's feedback widget (it lands in a
triaged queue). For anything security-sensitive, contact Derek directly rather than
filing a public issue.
