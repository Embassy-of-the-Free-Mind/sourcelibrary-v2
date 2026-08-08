# MCP feedback triage, chapter spans, and a duplicate-work collision — 2026-08-07

Technical postmortem. Ten MCP feedback reports arrived in one day from Aristotle
quote-verification sessions; most were already fixed by work that shipped mid-day, one
was not, and the follow-on produced a duplicate-effort incident worth recording.

## Shipped

| PR | What |
|---|---|
| **#3696** | `chapters[].endPage` was derived flatly (`chapters[i+1].pageNumber - 1`) with no regard for `level`. Every level-1 span in every nested book ran backwards. Fixed + repaired 13,537 books / 53,010 entries. |
| **#3702** | Golden-passage regression suite for the MCP read/search surface. |
| **#3715** | MCP server version was three literals reporting three different values (4.7.0 / 4.5.0 / 4.6.0). Now one constant. |

**#3713 was opened and closed** — see the collision section.

## Filed

- **#3697** chapter extraction quality: a silently missing chapter, `confidence` that is `"high"` on 96% of 315,356 entries including the wrong ones, no end-matter category.
- **#3698** malformed `<margin>` markup in served text. The *original* has a well-formed tag and the *translation* mangles it, so the defect is in the translation pass.
- **#3699** `search_within_book` scores normalised within the result set, so nonsense scores 1.0 and the tool cannot express "nothing here". **Introduced by the ranking fix in #3680**, after the reporter's last test — nobody had seen it.
- **#3700** `search_translations` never got the ranking work `search_within_book` did: no `score`, no `found_by`, no proximity.
- **#3714** two sessions can silently overwrite each other's derived collections.
- **#3716** `books.published` and `books.year` disagree on 1,035 visible books; different APIs read different fields.

## What was already fixed before the reports were read

Nine of the ten reports predate the 14:19–14:33 deploys (#3676/#3677/#3680/#3690). Verified
by re-running the reporter's own repros against production rather than reading code:

- All three ranking regression cases now pass — pages 264, 705, 159, previously ~50th or absent.
- `continues_from_previous` and `hyphen_split_at_end` both correct on the two named pages.
- `search_concept` cross-referencing, `/llms.txt` as an MCP resource, `contains_works`,
  `list_editions`, and the feedback length error all shipped.

**Lesson: re-verify before triaging a backlog.** Most of a day's feedback was already
addressed; filing issues off the reports alone would have produced six duplicates.

## The chapter `endPage` bug

`endPage` is derived, and the derivation ignored `level`. A "Book I" heading is
immediately followed by its own "Chapter I", usually on the *same* page, so the parent's
end was computed from its own first child and landed one page **before** its own start.
29,037 inverted entries across 6,901 books, 6,045 visible.

Two things worth carrying forward:

- **Four independent copies of `computeEndPages` existed**, which is how one flat
  implementation stayed wrong in four places. Collapsed to the repo's `.mjs`/`.ts` twin
  pair with a parity test.
- **`chapter_texts` was deliberately left untouched.** Its rows must *partition* the book;
  chunking a container over its full span would store every child page twice. A container
  is chunked over its own preamble only — which is exactly what the old flat rule
  computed, so `chunkEndPage` reproduces it and no materialized row changed. A test pins
  that equivalence; if it fails, the repair owes a re-materialization pass.

The repair script initially wrote the **sorted** chapters array. `chapter_texts.chapter_index`
is that array's positional index, so that would have silently repointed every materialized
chunk of any book not already in page order. Caught before applying.

## The collision

Another session merged **#3703** (canonical Bekker/Stephanus loci, #3661 phases 1–3) at
23:09:48Z while this session was building the same feature. Theirs is better: 10 editions
vs 7, 6,324 anchors vs 4,279, line-level references, work identification via running
heads. **#3713 was closed entirely**; only the version-drift fix survived as #3715.

Two failures, both now in `CLAUDE.md`:

1. **The issue was never claimed.** Third recurrence of
   `memory/lesson_check_issue_claims_before_starting.md`. The trigger each time is that
   the work felt like *continuation* of the current thread rather than a fresh pickup. A
   well-scoped open issue is precisely what another session also grabs.

2. **Both sweeps rebuilt `locus_anchors` with `deleteMany({})`.** Ordering alone decided
   which survived. Reversed, the shipped `/api/locus` would have queried a schema that no
   longer existed and returned zero for every locus — no error, no failed write, green CI.

## Two near-miss corrections, both caught before publishing

Recorded because both would have been confident and wrong, and both had the same shape:
reasoning from a number without checking what produced it.

- **`contains_works` read as "0 books".** It is an object with a `.works` array, not an
  array; `contains_works.0` matches nothing. The real figures are 2,090 books, 1,507 with
  ≥1 work. This is the "absence of a marker is not absence of the mechanism" trap.
- **Date conflicts read as 1,714 books.** Most were the parser's fault:
  `published: "1985 BC"` vs `year: -1985` is *agreement* with `year` correctly signed, and
  `"189-"` vs `1890` is uncertain-date notation normalised. Restricting to unambiguous
  four-digit pairs gives 1,035.

## State at close

- `main` clean, all worktrees for this session removed.
- `locus_anchors` holds #3703's 6,324 anchors (theirs, correct). Verified end-to-end on
  production for both systems: `1103b24` → Bekker 1831 p.319 (page carries
  "μὲν δίκαια πράττοντες δίκαιοι γινόμεθα" after its `<column-break/>`), `Rep. 509d` →
  Stephanus 1578 p.521 plus Burnet OCT.
- Smoke suite is **not** in CI (no smoke job). Run `npm run test:smoke` by hand after any
  change to search ranking, the continuity predicates, or chapter derivation.

## Next

- #3699 and #3700 are the two open search-quality defects; #3699 is pinned as an
  `it.fails` case so fixing it turns the suite red.
- #3716 needs a decision on which date field is canonical before anything is swept.
- One worktree, `feat+corpus-dataset`, holds stranded uncommitted work from another
  session (`src/app/blog/reading-or-generating/page.tsx`, `public/data/corpus/`).
