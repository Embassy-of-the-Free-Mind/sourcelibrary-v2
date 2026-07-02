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
  `complete_prior_found` → a prior exists; do NOT promote.

## Subagent prompt — DEMOTE (verify a claimed prior is real)
> You are verifying a "first English translation" claim for a library audit. Stage 1 says a PRIOR
> English translation of this work exists — **be skeptical, AI invents plausible translators/years.**
> WORK: "<work>" by <author> (<lang>). CLAIMED prior: <translator>, <year>.
> Do REAL web research (WebSearch/WebFetch): WorldCat, archive.org, Google Books, HathiTrust, the
> publisher, tradition-appropriate catalogues, scholarship. Confirm whether THIS specific translation
> actually exists, and whether it is COMPLETE or only partial/excerpt. Disambiguate same-named works
> and authors. Return ONLY JSON:
> `{"result":"confirmed_complete|confirmed_partial|not_found|uncertain","prior":"<translator,year,title or empty>","evidence_url":"<real url or empty>","queries_run":["every search you ran, verbatim"],"sources_consulted":[{"url":"...","found":"<one line: what it showed>"}],"reasoning":"<2-3 sentences>"}`

## Subagent prompt — PROMOTE (try to refute "it's a first")
> You are verifying a "first English translation" claim. We are about to claim "<work>" by <author>
> (<lang>) is a FIRST English translation — NO complete prior exists. **BE SKEPTICAL: try to REFUTE
> it by FINDING a prior complete English translation.** AI tends to wrongly assume "no prior" — fight
> that. Do REAL web research (WorldCat, archive.org, Google Books, HathiTrust, publisher,
> tradition-appropriate sources for <lang>, scholarship). Separate THIS work from related works /
> other editions; flag if it's a multi-work container/anthology/manuscript-miscellany (the claim is
> then ill-posed). Return ONLY JSON:
> `{"result":"complete_prior_found|only_partial_exists|none_found|uncertain","prior":"<translator,year,title or empty>","evidence_url":"<real url or empty>","queries_run":["every search, verbatim"],"sources_consulted":[{"url":"...","found":"<one line>"}],"reasoning":"<2-3 sentences>"}`

## Notes
- Quality observed (2026-06-21): Claude subagents disambiguated authors (Johann vs Georgius
  Agricola), corrected authorship (Detharding vs Agricola), and caught container/miscellany cases
  the Gemini gate missed — at 45–72 tool calls each.
- For famous-adjacent works where BOTH a Gemini and a Claude pass may share a blind spot (e.g. an old
  scholarly edition like Allberry's 1938 Manichaean Psalm-Book), route to a human specialist — that's
  the only layer that removes correlated error.
- The Gemini equivalent (`scripts/eval/ft-verify-gate.mjs`) is the cheap/scalable fallback when the
  flip volume is large; prefer Claude subagents for the high-stakes, smaller sets.
