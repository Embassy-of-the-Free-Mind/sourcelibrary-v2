# Doc reference & staleness audit — 2026-07-09

Snapshot. Records what the knowledge layer looked like the day the archive convention
was written (PR #3119, commit `7fa84cda`) and the day the staleness check was built
(this PR). Do not cite as current — re-run the check instead:

    node scripts/audit/doc-staleness.mjs

## Why this file exists

PR #3119 folded the audit's *conclusions* into `.claude/docs/knowledge-layer.md` but
never wrote down the audit itself. The conclusions therefore cited numbers — "39 of 115
living docs with zero inbound references" — with no provenance and no way to reproduce
them. This file supplies the provenance, and the script supplies the reproduction.

Re-derived on 2026-07-09 against `7fa84cda` with an explicit definition, the count comes
out at **40 of 115**, not 39. The difference is not worth reconciling: the original was
taken mid-sweep, while docs were being archived and untracked drafts were being added.
That it lands within one is the point. What matters is the shape, and the shape held.

## Definitions used

- **Living doc** — a tracked `.md` under `.claude/docs/`, excluding `archive/`.
- **Inbound reference** — the doc's *basename* appears in any tracked file other than
  itself, excluding `archive/`. A citation from an archived snapshot does not keep a
  living doc alive.
- **Counted with `git grep`, never `grep -r`.** See the trap below.

## Findings

**40 of 115 living docs have zero inbound references.** They fall into two kinds that
were sitting undifferentiated in the same directory: dated one-off audits whose work is
finished, and live drafts nobody had linked yet (essay drafts, a conference abstract, an
annotator brief, a census). Mixing them is what made the directory hard to reason about
— you could not tell the finished from the merely unlinked. Zero inbound references is
**not** a delete signal. It is a question: would the next session find this when they
need it?

**5 dated docs still sit outside `archive/`, and all five are referenced by code.**
This is the load-bearing finding, and it is why archiving is a deletion-class action:

| Doc | Inbound | Nature of the reference |
|---|---|---|
| `bph-author-extraction-2026-05-11.md` | 2 | **write target** of `scripts/enrichment/extract-author-from-ocr.mjs` |
| `bph-cover-audit-2026-05-11.md` | 2 | **write target** of `scripts/audit/bph-cover-quality.mjs` |
| `bph-memorix-alignment-2026-05-19.md` | 3 | cited by `bph-memorix-final-sync.mjs` + `.sql` |
| `jung-bph-alignment-2026-05-22.md` | 1 | linked from `collections/jung-resonances/page.tsx` |
| `tenant-architecture-audit-2026-05-23.md` | 3 | cited by two migrations + `src/lib/embassy/librarian.ts` |

Two are *write targets*: a script opens the file and rewrites it. Moving them to
`archive/` breaks a script silently — the doc has a date in its name and looks exactly
like a finished snapshot. **A date in the filename makes a doc a candidate for
archiving, never an automatic one.** Read the inbound lines; a reference from a script is
a dependency, not a citation.

**3 stale statistics were being read into every session as current.** These are lines in
the auto-loaded files (`CLAUDE.md`, `memory/`) that pair a date with a measurement and
assert it in the present tense. The worst was `CLAUDE.md`'s corpus line, dated
2026-05-26 and quoted as fact for six weeks. Re-measured against Atlas on 2026-07-09:

| Claim (as of 2026-05-26) | Actual (2026-07-09) | Drift |
|---|---|---|
| ~46K total docs | 99,700 | 2.2× |
| ~29K `visible: true` | 32,028 | 1.1× |
| ~15K `pages_count > 0` ("actually processed") | 74,717 | **5.0×** |
| ~14K with any OCR | 48,322 | 3.5× |

Fixed in this PR. The other two — `memory/mcp-server.md:34` (~32K bot hits, as of
2026-05) and `memory/pipeline-ops.md:5` (snapshot 2026-05) — are left open deliberately.
They need a live analytics query to re-measure, and leaving them lets the first scheduled
run of the check prove it surfaces real work rather than reporting clean.

## The trap that nearly deleted five live docs

Reference counts decided a destructive action, and the count could not be trusted.

`grep -r` over `.claude/` descends into the dozens of full repo checkouts under
`.claude/worktrees/`. Patching that with `--exclude-dir` does not work either, because
`grep` on this machine may be **ugrep**, not GNU grep, and the two disagree about
`--exclude-dir` semantics. During the #3119 audit the same query returned **134 hits,
then 0, then 2**, depending on which binary ran and whether a file path was mixed in with
the directory arguments. The "0" nearly archived five live docs — including the two write
targets above.

**Use `git grep`.** It searches tracked files only, never enters a worktree, and is fast.
When a count decides a destructive action, read the matching *lines*, not the count.

## What was built in response

- `scripts/audit/doc-staleness.mjs` — the three checks above, reproducible, `--json`.
- `.github/workflows/doc-staleness.yml` — runs monthly, opens/updates a tracking issue.
- `CLAUDE.md` corpus stat — re-measured and re-dated.
- `.claude/docs/knowledge-layer.md` — the claim "there is a monthly staleness audit" was
  aspirational when written. It now names the script that makes it true.

## Known limits of the check

The stale-stat check finds measurements that **date themselves** ("as of 2026-05-26:
~46K"). An undated stat is invisible to it — there is nothing to compare against. If you
write a number into an auto-loaded file, date it, or the check cannot defend it.

Orphan detection matches on basename. A doc referred to only by prose description
("the author identity doc") reads as an orphan. That is arguably correct: if the next
session cannot grep its way to the file, it may as well not be linked.
