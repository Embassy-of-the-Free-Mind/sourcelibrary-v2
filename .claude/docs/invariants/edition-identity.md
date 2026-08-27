# Edition identity — `edition_key`

**Read this when:** writing or reading `edition_key` / `edition_external_ids`,
building a duplicate queue, deciding whether two books are "the same edition,"
or adding a surface that shows other scans/copies of a book.

Materialized 2026-08-07 (#3260, workstream A of #3258). Companion to
`work-identity.md` — that file governs the layer above this one. For *why* this
layer is worth maintaining rather than merely how, see
[`../identity-stack-rationale.md`](../identity-stack-rationale.md).

---

## The four layers, and which one your claim attaches to

| Layer | Key on `books` | Means | Validator |
|---|---|---|---|
| Person | `author_id` | the human | thesaurus build scripts |
| Work | `work_id` | the abstract creation | `work-coverage.mjs` |
| **Edition** | **`edition_key`** | **one printing** | `edition-key-integrity.ts` |
| Copy | `duplicate_of` | one digitization of that printing | `duplicate-integrity-check.mjs` |

Claims attach to exactly one layer. First-translation is work×language.
Translation completeness is per-edition. Gallery images are per-copy. Putting a
claim on the wrong layer is the single most common defect in this cluster.

## The key

`src/lib/edition-key.ts` is the **only** definition:

    <normalized title>|<author surname>|<year>|v<volume>

**Never reimplement it.** Three private copies of "same edition" is what this
layer replaced — `dedup.ts`, `duplicate-integrity-check.mjs` and the admin
duplicates route each had one, and they disagreed: the same corpus read as 456
or 296 same-edition clusters depending on which you asked, the difference being
volume-awareness alone. A metric with three implementations cannot be falsified.

**Identity is a PIPELINE property, not a convention (Phase 0, 2026-08-08).**
The writer is `computeIdentityFields()` — `src/lib/identity-fields.ts`, with a
pinned `.mjs` twin in `scripts/lib/` for plain-node workers (parity test:
`tests/unit/identity-fields-parity.test.ts`; change both sides or neither).
Two call sites, and only two:

- `import-utils.ts` at import time (books that take the official route);
- `scripts/workers/identity-worker.mjs`, cron on Hetzner every 2h, which stamps
  any book missing the fields **however it was inserted** — this is what closes
  the 47-direct-insert-scripts hole, and it runs even while the pipeline is
  paused (zero AI cost; the pause exists to stop paid work). Since 2026-08-08 it
  covers `books_warehouse` too (backfilled: 22,542 stamped, 100 unkeyable) —
  import dedup queries the warehouse alongside the live library, so an unstamped
  warehouse row is invisible to any identity-keyed tier. `stale_missing` in
  `cron_runs` is the COMBINED count across both collections.

Field convention: **absent = never computed** (the worker's queue), **null =
computed, unkeyable** (stub title — a correct terminal state, not a gap). Never
write partial identity. The worker's `stale_missing` count in `cron_runs` is
the alarm: a book >7 days old with no identity fields means the worker is not
running. The integrity script proves stored == computed.

**Dedup tier 2 IS the edition key (flipped 2026-08-08, #3730 §2).**
`checkDuplicate()`'s tier 2 is `editionKeyTierMatches()` — stored-key prefix
lookup, year/volume as a both-sides veto, a missing year non-distinguishing
(the safe error is "assume duplicate"). It replaced the ASCII title+author
match on Derek's call after the offline replay (99.94% agreement over 20,326
real candidates, 0 regressions — PR #3787) rather than after the planned week
of shadow traffic. The retired title+author tier still runs as the POST-FLIP
shadow: both verdicts land in `dedup_shadow_decisions` (`regime:
'edition_live'`), where a shadow-only row now means the OLD tier caught
something the new one lets through — the regression signature. Read with
`scripts/audit/dedup-shadow-agreement.mjs`. **Retirement is gated on #4270,
not on a lucky quiet week**: the 2026-08-27 triage found tier 2 blind to
bilingual stored titles (native script + romanization) re-imported under the
bare romanized title — the key prefix differs, and only the old ASCII tier
catches it (by stripping the non-Latin half). Fix the recall gap
(`edition_key_latin` secondary key, #4270), THEN a clean week deletes the
shadow block and `titleAuthorTierMatches()`. Audit scripts replaying
books already in the DB must pass `{ shadowLog: false }`. The shadow block is
fenced — it must never fail an import. Corollary of the flip: dedup recall now
DEPENDS on Phase 0 stamping both `books` and `books_warehouse` — an unstamped
row is invisible to tier 2 (tiers 1/3 still catch same-source re-imports).

## `edition_key_quality` is not decoration — gate on it

    full        title + author + year      the ONLY tier a reader-facing surface may trust
    no-year     year unknown
    no-author   anonymous
    title-only  neither

With the year slot empty, **every printing of that title across every century
collapses into one key.** That is correct for a human review queue (they might
be copies) and catastrophic for an "other scans of this edition" rail. Use
`isTrustedEditionKey(quality)`; measured 2026-08-07, only 49,597 of 79,588 keyed
books (62%) are `full`.

## A shared key is a claim, not a fact

Two books with one `edition_key` are strong enough to **enqueue for review** and
never strong enough to **publish or merge unreviewed**. The only exception is a
year-verified USTC id (below), which is authority rather than heuristic.

## USTC: the identifier is not automatically edition-level

`edition_external_ids: { ustc, ustc_scope, ustc_reason }`. Trust `ustc_scope:
'edition'` only. #3260 assumed the USTC number *is* the edition authority — true
of USTC, **false of what we stored**: the AI matcher (`ustc_match.match_method:
'ai_tool_calling'`) matched books to a *different printing of the same work* and
said so in its own reasoning. Hellwig's *Curiosa physica*, our copy dated 1714,
carries USTC 2814137 dated 1700 with the note "the library book is a later
edition of the same work." Merging on that id would assert a 1714 and a 1700
printing are one edition.

So promotion to `edition` scope requires positive proof — the match record
carries USTC's own year and it agrees with ours. **Measured 2026-08-07 that is
23 of 4,141 books**, because only 36 rows even store `ustc_year`. The remaining
~4,100 keep the id at `unverified` scope: real provenance, never identity, and a
sized re-fetch task rather than an assumed-done step.

## The ASCII-`\w` trap (why this file exists twice over)

`dedup.ts normalizeTitle()` strips `[^\w\s]`, and JS `\w` without the `u` flag is
`[A-Za-z0-9_]`. **Every non-Latin-script title normalizes to the empty string** —
營造法式, བཀའ་འགྱུར, كتاب الشفاء, Ἰλιάς, Тайная доктрина all become `""`. On this corpus
that silently excluded 12,147 of 79,715 books (15%) from the edition layer: the
entire Chinese, Tibetan, Arabic, Greek and Cyrillic holdings.

Worse, it **manufactured false duplicates**. Eight books titled
`營造法式 (Yingzao Fashi) · 卷一~卷四`, `· 卷五~卷九`, … are eight juan ranges of a
34-volume work; with the Chinese erased, all eight keyed identically and the
dupe queue showed them as seven redundant copies awaiting merge. Same for Ibn
Tufayl: `حي بن يقظان / Philosophus Autodidactus` (243pp) merged with
`Philosophus Autodidactus` (223pp). **The volume-awareness that fixed 456→296
clusters was Latin-only.**

`normalizeEditionTitle()` in `edition-key.ts` keeps `\p{L}\p{N}` and is
byte-identical to `normalizeTitle()` on Latin input (a unit test pins this — it
is what keeps the cluster baseline comparable). `dedup.ts` still has the defect;
fixing it there rewrites every stored `normalized_title` and changes
import-time dedup corpus-wide, so it is a separate, bigger change — **not**
evidence that the ASCII behaviour is intended.

Corollary for any new normalizer: **`\w`, `\b` and `[a-z]` are Latin-only
assertions.** In a corpus that is substantially non-Latin they do not fail
loudly; they return plausible empty strings and take a sixth of the collection
out of whatever you are measuring.

## `edition_key` ≠ a multi-volume SET key

They are opposite by design and must never share a field name:

- **`edition_key`** keys volumes **APART** — vol. 1 and vol. 2 of one set are two
  printings, and collapsing them was the original 456-vs-296 bug.
- A **set key** (#3708's `volume_number` / completeness work) keys volumes
  **TOGETHER** — that is the whole point of "you're reading vol. 2 of 5" and of
  detecting that vol. 3 is missing.

Both are wanted. If a completeness feature needs the set-level grouping, give it
its own name (`volume_set_key`); do not widen `edition_key`, which four
consumers now read as one printing.

## Tools

    npx tsx scripts/maintenance/materialize-edition-keys.ts            # dry run + cluster report
    npx tsx scripts/maintenance/materialize-edition-keys.ts --apply    # backs up first
    npx tsx scripts/maintenance/materialize-edition-keys.ts --restore=<backup.jsonl>
    npx tsx scripts/maintenance/edition-key-integrity.ts [--strict]    # drift, coverage, conflicts

`--strict` fails on key drift or a full-quality `work_id` conflict. Drift means a
writer changed title/author/year without recomputing — the layer is then lying,
and nothing downstream of it can be trusted.

## What the layer found on day one

- **297 both-visible clusters, +336 extra copies** — the keeper-choice queue,
  matching the 296/+340 reference baseline (so the new key reproduces the old
  measurement rather than inventing a new one).
- **222 `work_id` conflicts, 213 at full quality** — same edition, two work_ids.
  Nearly all are English-gloss-vs-original-title slug pairs of one work
  (`local:a:johann-otto-von-hellwig:curious-physics` vs
  `local:n:hellwig-johann-otto-von:curiosa-physica`), i.e. the known
  work_id over-split, now **detected automatically from below** instead of
  hunted by hand. This is the argument for building layers bottom-up: the
  edition layer falsifies the work layer for free.
