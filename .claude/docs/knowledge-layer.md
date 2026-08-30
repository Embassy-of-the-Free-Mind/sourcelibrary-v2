# The knowledge layer — where writing goes, and why

Source Library is built by one maintainer, a couple of collaborators, and a large
number of AI sessions that each start with no memory of the last one. Every session
re-reads the repo from scratch. That constraint, more than any other, shapes how this
project writes things down.

This document explains the layers, what belongs in each, and how a thing moves between
them. If you're an agent starting a session, read `CLAUDE.md` first — this is the map of
everything *around* it.

## The layers

**`CLAUDE.md` — unconditional invariants.** Always loaded, in every session and every
terminal. The mission, the workflow rules, and the invariants that apply *regardless of
what you are working on*. It is deliberately an *index*, not the corpus: ~200 lines,
pointing at the reference docs rather than inlining them. Loading everything would be
both expensive and worse — an agent that reads 140 documents has no idea which three
matter.

**`.claude/docs/invariants/` — conditional invariants.** The same class of knowledge —
scar tissue, equally binding — but each piece fires only when you touch a particular
subsystem. Indexed from `CLAUDE.md` by **trigger** ("touching `src/proxy.ts` → read
`tenant-lockdown.md`"), so it loads when relevant instead of always. Each doc opens with
a "Read this when" line so an agent can bail in two seconds.

**The budget rule.** These two tiers only stay separate if something enforces it.
`CLAUDE.md` grew from ~290 lines to **827** between May and August 2026 — a 157KB file
loaded into every one of ~10 concurrent terminals, roughly 39K tokens before any work
began — because the ratchet below only ever *added*. Adding a section now means fitting
the budget — **~5,500 words by `wc -w`**; a line-count cap was tried first and gamed
within a month by joining essays into single 3,800-character lines — or demoting an
existing section into `invariants/`. The test: **if you
can name the file or subsystem that triggers a rule, it belongs in `invariants/`; if you
cannot, it belongs in `CLAUDE.md`.** Note that age is not the criterion — when the split
was done, the four largest sections were all under three weeks old.

**`.claude/docs/` — reference.** Read on demand, never all at once. Architecture,
subsystem design, editorial specifications, research notes. If `CLAUDE.md` names a doc,
that doc is load-bearing and must stay current.

**`.claude/docs/archive/` — snapshots.** One-off audits and point-in-time investigations.
True when written, archaeology now. Nothing may reference an archived doc as current.
See the convention below.

**`memory/` — domain context.** Five files, loaded by skill when the session's domain is
detected: pipeline, UI, data quality, MCP, lessons. This is committed team knowledge,
shared with collaborators.

**`.claude/skills/` — codified judgment.** The unusual layer. Everyone writes down their
build commands; almost nobody writes down what *good* looks like, so every AI-authored
page ends up sounding like a different person. `featured-work-description` says sell the
book, not the platform. `collection-intro-writing-rules` bans proper nouns from the
opening paragraph. `quote-background-image` says reject any plate with printed text on
it. Taste, made executable.

**`.claude/commands/` — rituals.** `/ship`, `/gnite`, `/review`, `/reap-worktrees`.
Sequences done often enough that forgetting a step is the failure mode.

**`.claude/handoffs/` — incident records.** What happened, what we changed, what we
learned. Written at the end of complex sessions.

**`~/sourcelibrary-ops` (private) — everything that isn't public-worthy technical
material.** Fundraising, contacts, outreach, budgets, donors, sponsors, correspondence
with named people, and any security note describing how to defeat a protection. **This
repo is public and AGPL.** Handoffs default to the ops repo; only genuinely
public-worthy technical postmortems, free of PII, secrets, and business strategy, belong
in `.claude/handoffs/` here — and only by deliberate `git add -f`.

**Auto-memory (`~/.claude/projects/<project>/memory/`, gitignored)** — Claude's private
per-machine notes about this user and this machine. Not team knowledge. Not committed.
The `/promote-lessons` skill sweeps it for anything that *should* be team knowledge and
proposes moving it here.

## How writing moves between layers

The ratchet that keeps `CLAUDE.md` alive has **two directions**, and for its first three
months only one of them was written down.

**Up.** Debug a hard problem → write the handoff → ask whether the next person needs an
invariant. If yes, PR the doc change *that session*. Otherwise the lesson lives only in
the handoff, where nobody will look, and it decays. The `/lesson` skill runs this loop.

**Down.** Ask the opposite question at the same moment: *is anything in `CLAUDE.md` now
conditional?* A rule keyed to a subsystem moves to `invariants/`; a rule superseded by a
newer one is merged, not appended beside it; a dated stat gets re-measured or deleted.
Without this half, the file grows monotonically — which is exactly what happened, and
the section that documented the discipline was itself 2.8× out of date when the split
finally ran. **`/gnite` asks both questions**, because the end of a session is when the
lesson is fresh and the file is on your mind.

Two failure modes that only the downward pass catches: the same incident written up
twice under different aphorisms (the 2026-07-28 usage review had **two** sections, 300
lines apart, both about unclassified `analytics_events`), and pointers that rot — four
handoff references had gone dead, three because the handoff correctly lived in the
private ops repo while `CLAUDE.md` cited a `.claude/handoffs/` path.

The reverse also has to happen. A doc that no longer describes reality is worse than no
doc, because it is trusted. Stats older than 14 days are to be verified before use, not
quoted — `scripts/audit/doc-staleness.mjs` finds the ones that date themselves, and
`.github/workflows/doc-staleness.yml` runs it monthly into a tracking issue. Its first
run caught `CLAUDE.md`'s corpus counts six weeks stale, with "actually processed" off by
5×. Undated stats are invisible to it: if you write a number into an auto-loaded file,
date it, or nothing can defend it.

## Two rules that are load-bearing

**Doctrine lives in `CLAUDE.md`, not six files.** No appending the same instructions to
`AGENTS.md`, `GEMINI.md`, `.cursorrules`, `.windsurfrules`, `.kiro/steering/`. One source
of truth. Agents from other tools can read `CLAUDE.md` directly. Duplicated doctrine
diverges, and then nobody knows which copy is real.

**Write the tell, not just the rule.** The most-used lines in `CLAUDE.md` are the ones
that name a *symptom* and map it to a cause: a page's CSS chunk 404s while the
homepage's returns 200 → stale edge HTML, not a data problem. A `cf-ray` with no
`x-vercel-id` → Cloudflare blocked it, not the app. A 200 response containing "Page Not
Found" → a Next.js soft-404, so never validate links by status code. Rules written from
the author's end state get skimmed. Rules written from the reader's confusion get used,
because confusion is where the reader actually is.

Where an invariant can be checked by a machine, it should be: `scripts/audit-bph-leaks.mjs`
crawls the tenant subdomain and exits non-zero on a leak; `tests/unit/provider-prefix-redirect.test.ts`
and `tests/unit/robots-content-signals.test.ts` pin behavior that silently regressed once
before. An invariant that lives only in prose gets violated by the next contributor who
didn't read the prose.

## The three questions at the end of an incident, and why all three

`CLAUDE.md` says every incident handoff ends with a check that runs in both directions,
and that a check beats a sentence. The evidence for each, kept here so the body can state
the rule without the archaeology:

**Why "could this be a check?" comes first.** A doc is the weakest layer: it only fires if
the next person reads it at the moment it applies. Measured 2026-08-21, **three of that
session's four findings were classes where the doc already existed and the thing recurred
anyway** — `csp-img-hosts.ts` says "one edit, both layers" and the second resolver still
never screened (#4163); #3293 says "validate a counter against the READ path" and
`pages_archived` drifted 4.7× regardless (#4190). Prefer a sweeping test, a detector, or a
constructor that throws. But **do not reflex into a bad test** — see
`invariants/tests-that-are-not-guards.md`: a guard whose only failure mode is "someone
deleted this line" is documentation with a green checkmark. Run the negative control.
And know when prose is right: a lesson about *judgment* ("hand-check the largest cluster
before quoting a rate") cannot be asserted. The discriminator — if you can name the file or
symbol that must hold the property, it is a check; if the trigger is a human about to draw
a conclusion, it is a doc.

**Why the downward pass is not optional.** For three months only the upward question was
written down. `CLAUDE.md` grew from ~290 lines to 827, with the same incident written up
twice, 300 lines apart. Nothing ever felt wrong at the time — that is exactly why the pass
has to be scheduled rather than triggered by suspicion. The word budget (~5,500) is what
makes it enforceable: over it, something must be demoted before anything is added.

**Why the upward pass needs a tier decision.** "Applies no matter what you're working on"
belongs in the body; "fires only when you touch a subsystem" belongs in
`.claude/docs/invariants/` with a routing line. The test: if you can name the file or
subsystem that triggers the rule, it is not body material.

`/gnite` runs all three at session end and also sweeps the private memory store; `/lesson`
runs the loop mid-session.

## Doc lifecycle — the archive convention

Reference docs accrete. A 2026-07 audit found **40 of 115 living docs with zero inbound
references** from anywhere in the tracked tree (full writeup, definitions, and the
re-measured numbers: `.claude/docs/archive/doc-reference-audit-2026-07-09.md`). Two
different kinds were mixed together: dated one-off audits, and live drafts nobody had
linked yet. `.claude/docs/archive/` already existed for the first kind — it just wasn't
being fed.

The convention that separates them:

- **A date in the filename means snapshot, not doctrine.** `bph-dedupe-2026-05-12.md`
  records what was true on that day. It goes in `.claude/docs/archive/` once its work is
  done. Nothing should cite it as current.
- **Undated docs are living.** They describe how the system works *now*, and must be
  updated or archived when that stops being true.
- **Archived docs are never deleted.** They are provenance for decisions. They just stop
  competing for an agent's attention.

When you finish a one-off investigation, date its filename and put it in `archive/`
directly. When a living doc goes stale, archive it under its final date rather than
letting it rot in place.

**Archiving is a deletion-class action: verify inbound references first.** Of the eleven
dated audits this convention was written against, **five were still referenced by
code** — and `.claude/docs/bph-cover-audit-2026-05-11.md` is a *write target* of
`scripts/audit/bph-cover-quality.mjs`, not merely a citation. Moving it would have
broken a script. A date in the filename makes a doc a *candidate* for archiving, never
an automatic one.

## Searching your own knowledge

**Use `git grep`.** It searches tracked files only, so it never descends into the dozens
of full repo checkouts under `.claude/worktrees/`, and it's fast:

    git grep -lF "<doc-basename>" -- ':!.claude/docs/archive'

A plain `grep -r` over `.claude/` crawls every worktree and returns nonsense counts. Do
not reach for `--exclude-dir` to patch that: `grep` on this machine may be **ugrep**, not
GNU grep, and the two disagree about `--exclude-dir` semantics. During the audit that
wrote this document, the same query returned 134 hits, then 0, then 2, depending on which
binary ran and whether a file path was mixed in with the directory arguments — and the
"0" nearly got five live docs archived. If a reference count decides a destructive
action, get it from `git grep`, and read the matching lines rather than trusting the
count.

The `/recall` skill searches every silo at once (auto-memory, `memory/`, `.claude/docs/`,
`.claude/handoffs/`, the private ops notes) through a local BM25 index. Use it before
starting non-trivial work on a topic that may already have a lesson attached. It costs
nothing.

## What this is for

The layers exist so that a session which begins knowing nothing can find, in the right
order: what this project is for, what will hurt if you get it wrong, where the thing you
need is, and what good looks like. Optimizing documentation for a reader with no memory
turns out to produce better documentation for the humans too.
