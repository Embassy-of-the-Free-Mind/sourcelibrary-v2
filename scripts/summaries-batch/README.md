# Missing-summaries trial (dry-run by default)

A trial run of "About this book" summaries for live books that have none, written to the draft
rules in `.claude/docs/book-summary-writing-rules.md`. Nothing here is live until a person
promotes it with the existing `scripts/maintenance/promote-summaries.mjs`, after Laura approves.

## Read this first: the production lane already does this

`scripts/workers/enrich-worker.mjs --batch` (`scripts/workers/lib/enrich-batch-lane.mjs`) and
`--agy` (#7628) already write summaries for books that lack one, with the shared prompt in
`scripts/workers/lib/summary-prompt.mjs`. Two things differ here, and they are the whole reason
this trial exists:

1. **The voice.** The production prompt opens with the label, allows "well-established fact" and
   feeds a Wikipedia block. The draft rules forbid all three. If Laura signs the rules off, the
   durable fix is to change `summary-prompt.mjs` and bump `SUMMARY_PROMPT_VERSION`, not to keep a
   second prompt here.
2. **Who is eligible.** Production only summarises books readable in English (`readable` or
   `complete`, or an English original from `transcribed`): a summary from a twentieth of a book "is
   not thin, it is a different book" (#2141). `--partial` widens that to books with 20+ transcribed
   pages or half the book, written from untranslated text. Treat that as an experiment to judge,
   not a default.

## Run order

All on **Hetzner**, never through a Vercel function (`.claude/docs/invariants/import-cost-and-egress.md`;
large File API uploads also fail from a residential Mac, #3974).

| Step | Script | Writes | Costs |
|---|---|---|---|
| 1 | `1-count.mjs` | nothing | nothing |
| 2 | `2-build-jsonl.mjs --limit=500` | a local `.jsonl` file | nothing |
| 3 | `3-submit.mjs --in=… --execute` | Gemini batch job, `gemini_usage` rows at submit | the batch |
| 4 | `4-collect.mjs --execute` | `book.summary_candidate` (status `pending`) only | nothing |
| 5 | `5-check.mjs --execute` | `summary_candidate.status = needs_review` on failures | nothing |
| 6 | Laura reads the sample from step 5 and the review page | | |
| 7 | `scripts/maintenance/promote-summaries.mjs` (dry-run, then `--execute`) | live fields, reversible with `--restore` | nothing |

Every write step is dry-run without `--execute`. Start with `--limit=500`; only scale after step 6.

`needs_review` candidates are not promoted (promotion selects `status: 'pending'`) and do not
appear on `/platform/admin/summary-review`, which lists pending ones.

## Credentials

Scripts read `MONGODB_URI` and `GEMINI_API_KEY_TIER3` (or `GEMINI_API_KEY`) from the environment.
Read `.claude/docs/invariants/credential-injection.md` before running under `secret-lover` or
from a worktree: an unreadable secret is reported as a missing one, and a worktree can resolve to
the wrong project with zero secrets. Each script exits with code 2 if a credential is missing.

## Cost

Steps 1 and 2 print estimates from a sample of real inputs, priced with
`calculateUsageCost` (batch rate, `gemini-3.1-flash-lite`). Rough figure from the 2026-11-12
count: about 26,600 live books had transcribed text but no `summary` field, so roughly $25-55 at
batch price; the real eligible number under the production gate is smaller (the count in step 1
gives it). Check prices against Google's current list before approving spend.

## What it does not do

- No live field is written: not `summary`, `reading_summary`, `index` or `book_indexes`.
- No `createBookRevision`: candidates are not live; promotion stashes the replaced values.
- No grounding, no Wikipedia, no thinking (budget 0, as the enrich lanes).
