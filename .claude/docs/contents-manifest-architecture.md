# Contents-manifest layer & the work count — architecture guide

**What this is:** the end-to-end map of how Source Library turns a *book* count
into an honest *work* count — how container books are decomposed into their
constituent works (`contents_works[]`), how those constituents are verified, and
how the canonical first-translated-**work** count is computed and surfaced.

**Read order:**
1. `.claude/docs/translation-works-architecture.md` — the whole works/translation
   stack. This layer sits *on top* of it (it consumes work identity, it does not
   define it).
2. `.claude/docs/title-and-work-identity-principles.md` — **Set F (counting)** is
   the governing policy. This doc is the *implementation* of Set F.
3. `.claude/docs/contents-works-schema.md` — the field-by-field schema + write
   contract for `contents_works[]`. This guide is the architecture; that doc is
   the data dictionary. Don't duplicate it — link to it.

Issues: **#2913** (the honest book-floored count) · **#2914** (derive manifests
from the chapter index) · **#2916** (ingest container sub-works + verify).

---

## 1. The problem this layer solves

We badge ~5,800 books "First Translation." But a single *book* is often a
**container** of many *works*:

- *Articella* = Hippocrates + Galen + Ḥunayn ibn Isḥāq, bound together.
- *Corpus Hermeticum* = ~18 distinct treatises.
- "Collected Drukpa Kagyu texts" (`gsung 'bum`) = dozens of works.

Counting first translations **book-by-book under-counts**: ~463 FT containers
that carry a chapter index hold ~3,157 constituent works we can already see.
The headline is therefore *lower* than the truth, not higher.

The fix is a **book → sub-works decomposition** stored additively on each book.
It never touches `work_id`. Keep these two relations strictly apart — this is the
load-bearing distinction of the entire layer:

| relation | question it answers | cardinality |
|---|---|---|
| **`work_id`** (clustering, Layer 1) | "do we hold the original of *this* work?" — groups editions+translations of one work | **≤ books** |
| **`contents_works[]` + the count** (this layer) | "how many distinct works do we hold first translations of?" — the curatorial tally | **≥ books** (book-floored) |

> The count is **never** `distinct work_id`. A book is **at least** one work; a
> container is more. Conflating the two is the bug the count function asserts
> against at runtime.

---

## 2. Where it sits in the stack

```
  homepage_stats.firstTranslatedWorks / …Provisional        ← SURFACE (the number)
        ▲
  countFirstTranslatedWorks()  (scripts/lib/contents-works.mjs)   ← THE COUNT
        ▲
  books.contents_works[]   (subdoc array, one entry per constituent)   ← THIS LAYER
        ▲          ▲
   seeded from     verified against
   books.chapters[]    translation_catalogs   (+ LLM adjudication)
        ▲                    ▲
  enrich-worker          #2453 catalog / registry  ← consumed from lower layers
  chapter index          (translation-works-architecture.md)
```

The manifest is **derived from data we already have** (the chapter index the
enrich-worker writes) and **verified against data we already have** (the
`translation_catalogs` registry of known prior translations). Both the seed and
the free verification tier cost **zero tokens**.

---

## 3. The data model (summary — full contract in `contents-works-schema.md`)

A subdoc array on each **`books`** document. Chosen over works-catalog rows
because it's local, simple, and the book is the natural floor.

```jsonc
book.contents_works = [{
  "title":              "Liber Azoth",       // as printed in the source
  "title_en":           "The Book of Azoth", // English form if distinct, else null
  "source_language":    null,                // language translated FROM (set later)
  "page_from": 12, "page_to": 48,            // 1-based page span within THIS book
  "work_id":            null,                // optional link into the cluster (#2453)
  "is_first_translation": null,              // tri-state: true | false | null=unproven
  "verified":           false,               // ft-verify'd? flips true only after match
  "provenance":         "chapter_index",     // how derived: chapter_index | ai_toc | manual
  "confidence":         0.96                 // [0,1] = index-reach × thin-penalty
}]
book.contents_works_meta = {                 // derivation marker on the book
  "provenance": "chapter_index", "index_reach": 1.0,
  "est_works": 7, "derived_at": "2026-06-30T…Z"
}
```

Two tri-state / provenance fields do the heavy lifting:
`is_first_translation` (`true`/`false`/`null=unproven`) and `verified`. A
container being FT-badged does **not** make its constituents firsts — every
constituent must be proven independently before it counts above the floor.

---

## 4. The pipeline (provisional → verified)

### Stage 0 — Estimate (read-only, eval)
`scripts/eval/estimate-works-from-chapters.mjs` — the #2914 measurement
instrument. Derives constituents from the chapter index, validates by page
coverage, and prints the headline extrapolation. Writes nothing to the DB
(`--out` dumps a JSONL of manifests for inspection). Use it to size the impact
before seeding.

### Stage 1 — Seed (free, no AI)
`scripts/maintenance/seed-contents-works.mjs` writes the chapter-derived manifest
as **provisional** rows (`provenance:'chapter_index'`, `verified:false`,
`is_first_translation:null`).

- **Container set** = FT books (`is_first_translation:true, visible:true,
  pages_translated>0`) whose title/author trips `isContainerSignal()`
  (`--all-ft` widens to every FT book).
- **Derivation** = `deriveContentsWorks()`: the **level-1** chapters with
  distinct, **non-generic** titles ARE the constituent works.
- **Only seeds ≥2 constituents.** A singleton means the book floor (1) already
  covers it — nothing to add.
- **Safe by default:** dry-run unless `--apply`; a backup of prior state is
  dumped to `scripts/output/` before any write; `--clear --apply` fully reverses.

### Stage 2 — Clean / down-weight
Thin (<2pp) constituents are likely mis-leveled section-heads. They are **kept
but down-weighted** (`confidence ×0.4`), never silently dropped. Chapterless
containers + the thin/low-reach residual route to **AI ToC extraction**
(`provenance:'ai_toc'`) — **paid, ask before scaling** (Derek's rule).

### Stage 3 — Verify per constituent (recall then precision)
A constituent's `is_first_translation:true` only counts once `verified:true`.
Verification is **two cheap stages — structural matching is recall, an LLM is
precision** (see §5).

### Stage 4 — Count
`countFirstTranslatedWorks()` reads `contents_works[]` and emits the book-floored
count in two modes (see §6). Wired into both stats writers.

---

## 5. Verification: structural recall + LLM precision

The design insight (Derek, 2026-06-30) that corrected this layer: **completeness
is an output of verification, not a gate on it.**

- **"Is there a prior translation of this work?"** is a *match* (author + title +
  source-language). Completeness is irrelevant to it. The catalog has only ~1% of
  rows marked `completeness: complete` (172 of 23,756) — gating the match on that
  field censored 99% of real priors and made the free matcher return 0.
- **"Does that prior defeat the badge?"** is a *judgment about* the match — and
  *that's* where complete-vs-partial matters. So completeness is what the
  adjudicator *determines*, not a precondition for looking.

Two stages:

1. **Gate-free structural match (FREE, no LLM).**
   - `scripts/eval/ft-catalog-match.mjs` — book-level (the #2780 Tier-0 matcher).
   - `scripts/eval/ft-constituent-catalog-match.mjs` — the **constituent** sibling
     (#2916). Matches each `contents_works[]` entry against `translation_catalogs`
     by surname + title-token containment. Constituents inherit the container's
     author, so this only runs on single-named-author containers (Plato, Galen…);
     multi-author "Various" containers report `unverifiable_here` (NOT a gap — they
     fall through to the paid tier). **Measured 2026-06-30:** of 3,620
     constituents, 269 are in named-author containers, 14 match, 10 pass the
     source-language guard — recall is currently metadata-blocked on the same
     unfilled `completeness` field, which §5's insight then removed as a gate.

2. **LLM pairwise adjudication (CHEAP, ~$0.0001–0.003/pair).**
   `scripts/eval/ft-prior-adjudicate.mjs` (gemini-3.1-flash-lite, metadata-only,
   no web grounding for the obvious cases). Judges each surfaced pair: *is the
   candidate a COMPLETE English translation of our exact work?* It trivially
   separates a book *about* the author (Findlen's *The Last Man Who Knew
   Everything* ≠ a translation of *Musurgia*), a scholarly edition of the
   *original*, a single volume of a set, or a *partial* prior. `defeats_badge =
   true` ONLY for a COMPLETE prior of the exact work; uncertain →
   `confidence:low` → escalate to the web-search Claude-subagent tier (#2880),
   never guess. The completeness it determines flows back to the catalog for free.

**Both stages only record evidence; neither flips a flag.** Verdicts append to
`first_translation_attempts` (`method:'llm_prior_adjudicate'` /
`'constituent_catalog_match'`, idempotent, via `scripts/lib/ft-attempt-log.mjs`).
A demote always stays Derek's sign-off — false demotes are the #1 historical
failure (the "Arithmologia"/"Pa'amon ve-Rimon" incidents).

---

## 6. The count function

`countFirstTranslatedWorks(ftBooks, { mode, dupRecords })` in
`scripts/lib/contents-works.mjs` is the **single canonical implementation**,
imported by both stats writers.

```
count = Σ over FT books of  max(1, qualifying constituents)   − dupRecords
```

| mode | qualifying constituents | meaning | stat field |
|---|---|---|---|
| `verified` (default) | `is_first_translation === true && verified === true` | the **honest, surfaceable** number. Equals the book count today; rises as ft-verify lands. | `firstTranslatedWorks` |
| `provisional` | every chapter-derived constituent | **upper bound**, internal sizing only — never the public headline | `firstTranslatedWorksProvisional` |

- **Book floor:** every book contributes ≥1, always. A container contributes its
  decomposed works *instead of* 1.
- **The only downward correction is `dupRecords`** — exact duplicate *records*
  (the same single edition catalogued twice). **Never** multi-volume sets, **never**
  multi-edition holdings. Defaults to 0 (not auto-detected here).
- **Hard runtime invariant:** the function `throw`s if the result drops below the
  book floor — that can only happen if someone fed it `distinct work_id` (i.e.
  conflated clustering with counting). This guard is the executable form of §1.

Container-signal tokens (`CONTAINER_RE`) and generic-title rejects (`GENERIC_RE`)
live alongside the function. The token set is **multilingual but
high-precision** — English/Latin collected-works terms plus precision-validated
Tibetan (`thor bu`, `bka' 'bum`, `gsung 'bum`) and Greek/Latin (`operum`,
`corpus`). A broad "decompose anything with ≥2 chapters" rule is **deliberately
rejected**: Latin/German/Sanskrit FT books are monograph-dominated (descriptive
chapter titles ≠ distinct works), and CJK collected-works tokens (全集/文集/全書)
were measured to catch ~nothing real in this corpus. **Re-validate any new token
against a corpus sample before adding it.**

---

## 7. Consumers (where the number surfaces)

- `scripts/maintenance/update-homepage-stats.mjs` — on-demand writer of
  `system_config.homepage_stats`.
- `scripts/maintenance/prewarm-browse.mjs` — the daily 05:00 cron writer.

Both compute `firstTranslatedWorks` (verified) **and**
`firstTranslatedWorksProvisional` from the same `countFirstTranslatedWorks`. Keep
them in sync — they share the canonical filters (see CLAUDE.md "Visibility &
Stats Invariants"). As of 2026-06-30 the stats carry provisional ≈ 8,508 and
verified ≈ 5,814; the **rendered headline (`firstTranslationCount`, the FT
*book* count) is unchanged** — the new figures are additive until the ft-verify
pass justifies flipping the public number (#2913 Phase 4).

---

## 8. Invariants & guardrails

1. **Two relations, never conflated.** `work_id` ≤ books (clustering); the count ≥
   books (curatorial tally). Asserted in code.
2. **Provisional by default.** Never seed unverified sub-works as authoritative.
   ~3,157 / the provisional figure is an **upper bound**, not a fact.
3. **Per-constituent FT is unproven until ft-verify'd.** A container's FT badge
   does not propagate to its constituents.
4. **Reversible writes only** — dry-run + backup before any apply; `--clear` to
   undo (#2318 discipline).
5. **Ask before paid AI** — chapter-index seed and structural match are free; AI
   ToC extraction and LLM adjudication cost money.
6. **The only downward correction is exact duplicate records** — never sets,
   never multi-edition holdings.
7. **Evidence, never flag flips.** Verification records to
   `first_translation_attempts`; demotes need Derek's sign-off.

---

## 9. File index

| file | role |
|---|---|
| `scripts/lib/contents-works.mjs` | **the heart** — `deriveContentsWorks`, `validateManifest`, `entryConfidence`, `isContainerSignal`, `countFirstTranslatedWorks`, `CONTAINER_RE`/`GENERIC_RE` |
| `scripts/eval/estimate-works-from-chapters.mjs` | read-only estimator + page-coverage validation (#2914) |
| `scripts/maintenance/seed-contents-works.mjs` | seed provisional manifests (dry-run/`--apply`/`--clear`/`--all-ft`) |
| `scripts/eval/ft-catalog-match.mjs` | free book-level Tier-0 prior match (#2780) |
| `scripts/eval/ft-constituent-catalog-match.mjs` | free constituent-level prior match (#2916) |
| `scripts/eval/ft-prior-adjudicate.mjs` | LLM pairwise precision adjudication (#2916) |
| `scripts/lib/ft-attempt-log.mjs` | idempotent evidence ledger → `first_translation_attempts` |
| `scripts/maintenance/update-homepage-stats.mjs` · `prewarm-browse.mjs` | stats consumers |

**Collections touched:** `books` (`contents_works[]`, `contents_works_meta`,
`chapters[]`) · `translation_catalogs` (prior-translation registry, read-only) ·
`first_translation_attempts` (evidence ledger) · `system_config.homepage_stats`
(output).

**See also:** `contents-works-schema.md` (field contract) ·
`title-and-work-identity-principles.md` Set F (grain policy) ·
`translation-works-architecture.md` (the layer below) ·
`ft-verification-runbook.md` / `ft-verdict-contract.md` (the verify discipline).
