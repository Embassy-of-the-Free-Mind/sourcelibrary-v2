# The first-translation system is not under-documented. It is under-retrieved.

*Written 2026-09-01 after a session that rediscovered five things the project
already knew. The evidence is that session's own failures, which is the only
honest way to assess this.*

## The measurable sprawl

| | count |
|---|---|
| FT scripts (`scripts/eval/ft-*`, `scripts/maintenance/*ft*`, `scripts/audit/*ft*`) | **77** |
| FT docs in `.claude/docs/` | **20** |
| modules in `src/lib/first-translation/` | **16** |
| **open FT-related issues** | **132** |
| stores an FT fact can live in | **13** |

That is the shape everyone notices. It is not the thing that cost the most.

## What actually went wrong: five rediscoveries in one session

Every one of these was **already written down somewhere in this repo or in
memory**. None was found at the moment it was needed.

1. **Filed #4523 (OCR fabricating Sanskrit on Tibetan folios) without knowing
   #3244 existed** — same failure, same mechanism, characterised in July 2026
   with the wrong-script case documented verbatim ("a Tibetan page tagged
   `<language>Javanese</language>` … translated as a Sumatra genealogy").
   Thirteen months of prior art, re-derived from scratch.
2. **Recommended withdrawing the Tibetan text** when a *verified fix* was on
   record: `gemini-3.1-pro` re-OCR rescued 6/6 of the worst leaves in a June
   2026 pilot, with a costed proposal and a public `/tibet` page built on it.
3. **Rediscovered that the #2880 pilot converged on 2026-06-30.** Four rounds
   had already measured the rates and recommended STOP; nobody had multiplied
   them by the population. The whole round-5 estimate was arithmetic waiting to
   be done.
4. **Measured the wrong evidence store.** Reported "only 672 books have a cited
   prior" from `books.prior_translation`, a narrow reader-facing credit field.
   The actual store is `priors[]` on the ledger: **11,323 books**. A memory file
   mapping all 13 stores existed and was not consulted.
5. **Nearly shipped a wrong conclusion** — "a one-line prompt fix recovers
   12,187 pages" — measured on script identity rather than transcription
   fidelity. Caught only because Derek asked "did you spot check?".

Four of five are retrieval failures. Only the fifth is a reasoning failure.

## What this implies

**Adding documentation is not the fix; it is closer to the cause.** Twenty docs
and 132 issues is a corpus large enough that a worker samples it rather than
reads it, and sampling reliably misses the one relevant page.

Three things demonstrably worked in this session, and they share a property —
they are **indexes read at the start, not documents found by luck**:

- **`ft-eval-runs-ledger.md`** — one row per measurement ever run. Reading it is
  what surfaced the converged pilot (rediscovery #3, caught *because* the ledger
  was eventually read). It is the highest-value artifact in the FT layer and it
  is not in anyone's required path.
- **The invariant doc's "Read this when" header** — routing by *what you are
  about to touch* rather than by topic.
- **`scripts/lib/books-known-fields.json`** — a machine-checkable index that
  fails a PR writing an unknown field. The only one of the three that cannot be
  skipped.

## Recommendations, in order of expected value

1. **Make the runs ledger the mandatory first read for any FT work**, cited from
   the invariant doc's header. Every rediscovery above would have been cheaper
   if the first question were "what has already been tried?" rather than "what
   does the code do?". *Cost: one line. Prevents rediscoveries #1–#3.*
2. **Move the 13-store evidence map out of per-machine memory and into
   `first-translation-claims.md`.** It is a team fact, not a private note; it
   lived only in one machine's memory and its absence produced a wrong number
   presented to Derek. *Prevents #4.*
3. **Prefer a check to a sentence.** `books-known-fields.json` is the pattern:
   the guard that cannot be skipped beats the doc that can. Candidates that
   would have caught real defects this session:
   - a script-vs-`books.language` check at the OCR write boundary (#4523);
   - a `reconcile` dry-run that actually applies `--ids`/`--verdict`/`--resolver`
     before printing (today it returns *before* the filter block, so the dry run
     reported 1,432 demotions for a 795-book scope — a trap that only did not
     fire because the missing log line was noticed).
4. **Triage the 132 open issues into ~6 epics with the rest closed or linked.**
   A backlog that size is not a plan; it is a place findings go to be
   re-derived. #3881 already proposes the mechanism budget — apply the same
   ratchet to issues.

## The one-line version

The FT system's problem is not that it is complicated. It is that **its
knowledge is organised for writing and not for reading**, so each new worker
pays full price for lessons already bought. The fix is fewer, earlier,
unskippable indexes — not more documents.
