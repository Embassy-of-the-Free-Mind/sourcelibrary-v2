---
name: ft-verify
description: Stage-2 verification of first-translation flips using INDEPENDENT Claude subagents (subscription, not API key) with full evidence capture. Use to verify proposed badge changes (demotes/promotes) before writing any public claim — the binding step that catches AI-fabricated priors. Each subagent reports its actual search queries + sources, persisted to the first_translation_attempts provenance log.
---

# FT Verification (Stage 2) — independent Claude subagents

The first-translation pipeline is **two-stage**: a cheap Gemini adjudicator generates candidate
verdicts (Stage 1), then **this** skill independently verifies the consequential ones (Stage 2)
before anything touches a public surface. We proved a single pass can't be trusted — ~63% of the
Gemini adjudicator's "a prior exists" claims were fabricated. So every flip gets re-checked by a
**different model family** (Claude, not Gemini) to break correlated error.

Why Claude subagents (not the Gemini gate): (1) genuine independence — different training/search,
so the blind spots don't correlate; (2) far richer, auditable evidence (the subagent reports every
query + every source + what each showed); (3) runs on the subscription, no API key / no Gemini rate
limit. Context: issue #2564; `.claude/docs/ft-verification-runbook.md`.

## When to use
- After a Stage-1 adjudication run (`ft-gemini-adjudicate.mjs`) proposes badge changes.
- Before applying ANY `is_first_translation` flip or catalog write. Never write a public claim on a
  single-pass verdict.

## Inputs
**Build the worklist from the LEDGER, never from a per-run report file** (#3881 pass 2 —
`ft-ladder-*.json` files are run reports; they overwrite each other and go stale):

    set -a; source .env.production.local; set +a
    npx tsx scripts/eval/ft-rung3-queue.ts --out=queue.json          # full, bucket-prioritized
    npx tsx scripts/eval/ft-rung3-queue.ts --bucket=demote_candidate --out=demotes.json

Buckets arrive verification-priority ordered: `demote_candidate` (a claimed complete prior
against a live badge — verify these FIRST), `uncertain`, `needs_review`, `hard_class`,
`undocumented_absence`.

A set of flips, each with: `book_id`, `work` (title), `author`, `lang`, and a **direction**:
- `demote` — Stage 1 said *a prior exists* → verify the prior is REAL and COMPLETE.
- `promote` — Stage 1 said *first / no prior* → try to REFUTE by FINDING a prior.

## Process
1. **Batch** the flips (~6–8 per round) and spawn one `general-purpose` subagent **per book**
   (model: `sonnet`), in parallel (one message, multiple Agent calls).
2. Each subagent uses the appropriate prompt below. It MUST do real `WebSearch`/`WebFetch` and
   return ONLY the JSON contract (no prose).
3. **Capture the evidence — ALL sinks, one command.** Write the round's results to
   `scripts/output/ft-evidence-<date>/roundN-results.json` (include a `registry_rows[]` array on
   every result whose prior was CONFIRMED real — structured translator/year/title/completeness/
   source_language/source_url), then run:
   `node scripts/maintenance/ingest-ft-verify-results.mjs <roundN-results.json> --apply`
   That single command writes **Sink A** (the `first_translation_attempts` ledger row with the
   verbatim queries + per-source findings) and **Sink C** (every confirmed real translation into
   the `translation_catalogs` registry, dedup-on-write, with `completeness` set). Sink B (the
   verdict) stays derived-from-evidence; the public flag stays behind the sign-off reconcile.
   **A round is not done until this script has run.** Do not hand-roll the writes — three sinks
   scattered across sessions is exactly how the six-store evidence sprawl happened (#2780).
4. **Output** survivors vs rejects as a reviewable diff. Do NOT apply badge flips — bring the diff
   to Derek for sign-off (public bibliographic claims need explicit approval; back up before any write).

### The three sinks (write contract — spec: `.claude/docs/ft-enumeration-three-sink-spec.md`)
| Sink | Store | Written by |
|---|---|---|
| A — evidence | `first_translation_attempts` (append-only) | `ingest-ft-verify-results.mjs` (step 3) |
| B — verdict | `book.first_translation` | `derive-ft-verdict-from-attempts.ts` (never this skill) |
| C — registry | `translation_catalogs` (the flywheel of verified positives) | `ingest-ft-verify-results.mjs` (step 3) |

### Survivor rules
- **demote** survives (the demote is valid) only if `result == confirmed_complete` with a real URL.
  `confirmed_partial` / `not_found` → the badge was right; KEEP it.
- **promote** survives (the first stands) if `result == none_found` or `only_partial_exists`.
  `complete_prior_found` → a prior exists; do NOT promote as a plain "first". **BUT see first_modern.**

### first_modern — a complete prior can still be a badgeable first (don't collapse it)
A complete prior does NOT always defeat the claim. The graded model (`src/lib/first-translation/types.ts`)
has a `first_modern` verdict: **if the ONLY complete prior(s) are pre-1900, the text grades `first_modern`
(a first-family badge, "First Modern Translation"), not `not_first`.** A 480-year-old Tudor crib is not a
readable modern English translation. `derive-from-evidence.ts` makes this call automatically — but ONLY if
the prior's **year is a structured `pub_year` field** in the registry row. So the one thing that CANNOT be
dropped is the year: every found prior MUST carry `pub_year`. Do not bury "translator, 1547, title" in a
single string — the grader can't parse it and a genuine first-modern collapses to not_first (this is exactly
how Whittington 1547 mis-graded De remediis fortuitorum, 2026-07-13). Always emit `registry_rows[]` with a
real `pub_year` for every confirmed prior, whatever the `result` value.

## Subagent prompt — DEMOTE (verify a claimed prior is real)
> You are verifying a "first English translation" claim for a library audit. Stage 1 says a PRIOR
> English translation of this work exists — **be skeptical, AI invents plausible translators/years.**
> WORK: "<work>" by <author> (<lang>). CLAIMED prior: <translator>, <year>.
> Do REAL web research (WebSearch/WebFetch): WorldCat, archive.org, Google Books, HathiTrust, the
> publisher, tradition-appropriate catalogues, scholarship. Confirm whether THIS specific translation
> actually exists, and whether it is COMPLETE or only partial/excerpt. Disambiguate same-named works
> and authors. **Record the YEAR of every prior you find** — a pre-1900-only prior means the text is a
> "first MODERN translation", so the year decides the grade. Return ONLY JSON:
> `{"result":"confirmed_complete|confirmed_partial|not_found|uncertain","priors":[{"translator":"","year":0,"english_title":"","completeness":"complete|partial|excerpt","source_url":""}],"prior":"<translator, year, title — human-readable summary of the strongest prior, or empty>","evidence_url":"<real url or empty>","queries_run":["every search you ran, verbatim"],"sources_consulted":[{"url":"...","found":"<one line: what it showed>"}],"reasoning":"<2-3 sentences>"}`

## Subagent prompt — PROMOTE (try to refute "it's a first")
> You are verifying a "first English translation" claim. We are about to claim "<work>" by <author>
> (<lang>) is a FIRST English translation — NO complete prior exists. **BE SKEPTICAL: try to REFUTE
> it by FINDING a prior complete English translation.** AI tends to wrongly assume "no prior" — fight
> that. Do REAL web research (WorldCat, archive.org, Google Books, HathiTrust, publisher,
> tradition-appropriate sources for <lang>, scholarship). Separate THIS work from related works /
> other editions; flag if it's a multi-work container/anthology/manuscript-miscellany (the claim is
> then ill-posed). If you DO find a complete prior, **record its YEAR** — a prior that is only pre-1900
> does not defeat the claim outright, it grades the text a "first MODERN translation", so the year is
> load-bearing. Return ONLY JSON:
> `{"result":"complete_prior_found|only_partial_exists|none_found|uncertain","priors":[{"translator":"","year":0,"english_title":"","completeness":"complete|partial|excerpt","source_url":""}],"prior":"<translator, year, title — human-readable summary of the strongest prior, or empty>","evidence_url":"<real url or empty>","queries_run":["every search, verbatim"],"sources_consulted":[{"url":"...","found":"<one line>"}],"reasoning":"<2-3 sentences>"}`

## Notes
- Quality observed (2026-06-21): Claude subagents disambiguated authors (Johann vs Georgius
  Agricola), corrected authorship (Detharding vs Agricola), and caught container/miscellany cases
  the Gemini gate missed — at 45–72 tool calls each.
- For famous-adjacent works where BOTH a Gemini and a Claude pass may share a blind spot (e.g. an old
  scholarly edition like Allberry's 1938 Manichaean Psalm-Book), route to a human specialist — that's
  the only layer that removes correlated error.
- The Gemini equivalent (`scripts/eval/ft-verify-gate.mjs`) is the cheap/scalable fallback when the
  flip volume is large; prefer Claude subagents for the high-stakes, smaller sets.
