# Crediting the holding library — and the provenance layer it exposed (2026-07-29 → 07-31)

Started as a one-line wording question. Ended up touching four layers, uncovering a
second provenance system nobody had documented, and producing the same class of bug
three separate times — twice in code I wrote during the session.

**PR:** #3445 (open, CI green) · **Follow-up issue:** #3471

---

## The original report

`/book/opera-chirurgica-aquapendente` credited *"From the collection of Internet
Archive."* The 1628 folio belongs to **Fisher — University of Toronto**; IA scanned it
and hosts the scans. Scholarly convention and IA's own item page credit the custodian
first, so this was an attribution error, not a wording preference.

The custodian was already in the record (`image_source.contributing_library`, set at
import from IA's contributor field). Nothing read it as a custodian — and two call
sites read it as the *digitizer*, which the field's own doc comment says it is not.

## What was actually wrong — four layers

1. **Book page** rendered the provider as the collection owner.
2. **`/libraries`** grouped on raw strings behind a four-item exclude list. Its largest
   "contributing institution" was Internet Archive; Bayerische Staatsbibliothek was
   split across four spellings. 302 entries, many not institutions.
3. **The Supabase catalog column** shipped the wrong institution. There are **two**
   fields — legacy top-level `books.contributing_library` (coarse, usually the
   provider) and `image_source.contributing_library` (the real custodian) — and the
   sync preferred the legacy one. 6,931 books shipped "Internet Archive" while the
   record knew "Cornell University Library".
4. **The stored data itself.** A batch import blanket-assigned *"Biblioteca Nazionale
   Centrale di Firenze"* to 955 books; **32–36% are held elsewhere** (Rome ×173, John
   Carter Brown ×43, Alessandrina ×11, + 33 more institutions).

## What shipped

| | |
|---|---|
| Book-page holding credit | 5,664 books, 193 institutions |
| `/libraries` grouping | 302 → 203 entries; BSB unified at 3,042 |
| Catalog sync mapping | 8,353 improved, 3,259 correctly nulled |
| Harvest (fill) | 1,103 custodians recovered from `archive.org/metadata` |
| Harvest (verify) | 312 misattributions corrected |
| Provenance repair | 1,103 stamps reconstructed, 1,124 marked `disputed` |

Key modules: `src/lib/holding-library.ts`, `src/lib/field-provenance.ts` (both with
parity-pinned `.mjs` twins + regen scripts), `scripts/audit/field-provenance.mjs`,
`scripts/maintenance/harvest-holding-libraries.mjs`,
`scripts/maintenance/repair-holding-library-provenance.mjs`.

---

## The finding that outgrew the PR: provenance is TWO layers

`.claude/docs/data-provenance.md` documents the **AI-output** chain (prompt id/hash/
name/version → model → page text → revisions → `gemini_usage`), audits it, and
concludes *"Known Gaps: None for the AI text content trail."* That layer is genuinely
strong, and the doc is honestly scoped — I initially mischaracterised it as
overclaiming; its title says "AI Output" and its gaps section names its own scope.

The real problem was narrower and still serious: **`books.field_provenance` — the layer
behind every citation claim, rendered to readers by `BibliographicInfo.tsx` — had no
documentation anywhere and nothing cross-referenced it.**

Measured 2026-07-30 over 19,420 visible books:

- 92.5% carry *some* stamp, but per field most values are unattributed:
  `published` 78.1% unprovenanced, `title`/`author` 74.1%, `contributing_library` 52.7%.
- 134,488 stamps from **81 independent writers** → **164 distinct key-shapes**;
  only 23.7% name their script, only 16.1% record `previous_value`, 1,901 have no `source`.
- **1,124 books asserted `method: 'ia_metadata'` while storing "Internet Archive"** —
  a value IA's contributor field never returns for a library-scanned book.

**A wrong stamp is worse than a missing one.** It reads as authority and stops anyone
looking — plausibly why the placeholder problem survived four months looking sourced.

Repair split by what is actually knowable: 1,103 stamps **reconstructed** (the bespoke
key held the date and prior value, so truth was recoverable); 1,124 **marked `disputed`
with a reason** (true provenance unrecoverable — inventing a plausible source would be
the same mistake with a fresher date). The audit counts disputed separately from
still-asserting claims, so honest remediation moves the number.

---

## Three instances of one bug — two of them mine

Worth reading together; the shape recurs.

1. **The sync preferred the coarse field** — a write path silently choosing the less
   specific of two sources.
2. **I wrote a bespoke `holding_library_harvest` key** instead of the canonical stamp,
   leaving 833 values under provenance that named a four-month-old pass. *Fixing the
   value while orphaning its provenance.*
3. **I never bumped `updated_at`.** `books_catalog` syncs incrementally on
   `updated_at > lastSync`. All 1,415 books I wrote were **invisible to the sync** —
   the corrected custodians would have sat in Mongo forever while `/libraries` served
   the old ones. `modifiedCount: 1` on every write, nothing thrown, nothing changed.

And a fourth, in the tooling: the full verify pass reported **0 corrections over 5,057
books** while silently dropping **885 candidates (15%)** to timeouts. A sweep that skips
a sixth of its candidates and prints a clean result is claiming coverage it did not
earn. Fixed with retry-with-backoff plus a failure ledger; the run now prints either
"coverage: every candidate was checked" or the command to close the gap.

## Method notes that paid off

- **Corpus-scale validation, not fixtures.** The fixture-only placeholder regex passed
  its tests while still crediting `"Google Books (partner libraries)"`.
- **Random sampling caught three things nothing else could**: cross-language merges
  invisible to string similarity (`"Bavarian State Library"` shares no tokens with
  `"Bayerische Staatsbibliothek"`); IA returning contributors as **HTML anchors**
  (would have written markup into a rendered field); and the Florence mislabelling.
- **Fuzzy merging is unsafe here.** Substring containment pairs `"British Library"` with
  `"University of British Columbia Library"`; ASCII-folding collapses every CJK name to
  the empty string, merging Peking University with Zhejiang University. The alias map is
  hand-verified on purpose.
- **Positive controls.** The `--verify` comparison is pinned to both fire (Florence vs
  Rome) and stay quiet (spelling/exonym variants) — otherwise the sweep is a no-op or
  destructive and looks identical either way.

## State at handoff

- **10 commits, CI green, 1,032 tests**, worktree clean.
- A **full verify dry-run with retries** was still running at wrap-up
  (`/tmp/verify-full3.log`, ledger `/tmp/verify-failures.json`). Prior pass without
  retries: 5,057 agreed, **0 corrections outside Florence**, 885 unchecked. Re-run only
  closes the measurement hole; no corrections expected. **`/tmp` is volatile — if the
  log is gone, just re-run the sweep.**

## Next

1. **`sync-books-catalog.mjs --full` at deploy time** — `/libraries` reads Supabase, so
   none of the grouping work is visible until it runs.
2. **#3471**: state the write rule in CLAUDE.md, migrate the remaining ~80 writers to
   `provenanceUpdate()`, wire `--strict` into CI, and decide whether the reader-facing
   provenance panel should surface `disputed` (it currently renders a withdrawn claim
   identically to a live one).
3. **`display_title` hallucinations** — out of scope, still open. This same book renders
   an H1 of *"The Remaining Works of Benedictus de Spinoza"*, a different book entirely,
   leaking into `og:title`, breadcrumb and schema.org. The record's own April audit
   flagged it verbatim and nothing acted. Needs a corpus sweep: divergent
   `display_title`s are mostly *legitimate* Latin→English renderings and cannot be
   separated by heuristic alone.

## CLAUDE.md

Added the sync-propagation invariant (`updated_at` on any synced-column write) — third
occurrence of that class, and it was not written down anywhere. The provenance doctrine
is deliberately **not** added here; it is #3471, to be reviewed on its own rather than
riding along in a feature PR.
