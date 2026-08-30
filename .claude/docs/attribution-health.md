# Attribution health — measuring whether the corpus is getting better at "who wrote this"

2026-08-12 (#3894). The point of this file is the **loop**, not any one fix: a
metric computable for free, a named defect, an intervention, and a
re-measurement that can come back negative. It already has.

Same shape as `ocr-quality-measurement-loop.md`, for the same reason: the
attribution workstream had been reporting *records fixed*, which is an activity
count — no denominator, no baseline, and structurally unable to show a
regression.

## The measurement

`scripts/audit/attribution-health.mjs`. Read-only, no model calls, computed
entirely from fields that already exist. `--snapshot` appends to
`attribution-health-ledger.jsonl` so the trend is a fact on disk.

**A byline is not decoration — it is how a reader REACHES a book.** Machiavelli's
*Il Principe* filed under its printer is present in the corpus and unreachable
by the only search anyone would try. So the tiers are the successive things
that must be true for a reader to arrive:

| tier | meaning |
|---|---|
| **T0** ABSENT | no author, or a placeholder. Nothing to search for. |
| **T1** UNUSABLE | a string that is not a name — a #3434 search term, a work title, `[object Object]`. **Worse than absent**: it looks like an answer and sends the reader nowhere. |
| **T2** UNLINKED | a plausible name, no `author_id`. The byline renders; there is no author page and the work graph cannot see it. |
| **T3** LINKED | joined to a thesaurus doc. The author page works. |
| **T4** ANCHORED | that doc carries VIAF or Wikidata. Checkable from outside this project, which is what *citable* requires. |

**Contradictions are an overlay, never a tier.** A book can be beautifully linked
and anchored *to the wrong person* — that is what this workstream kept finding —
so correctness is counted separately from reachability.

**Scope is TEXT ONLY** (`resource_type` absent). Artworks have a different
identity model: the "author" is the artist and artwork titles conventionally
open with the artist's name. Including them made the work-title check flag
Goltzius, Bruegel, Bosch and Botticelli — 3,606 books, nearly all of the
apparent defect. Artworks need their own instrument.

## Baseline — 2026-08-12, 21,974 visible text books

| tier | n | share |
|---|---|---|
| T0 ABSENT | 1,688 | 7.7% |
| T1 UNUSABLE | 68 | 0.3% |
| T2 UNLINKED | 3,106 | 14.1% |
| T3 LINKED | 3,048 | 13.9% |
| T4 ANCHORED | 14,064 | 64.0% |

- **reachable (T3+): 77.87%**
- **anchored (T4): 64.0%**
- contradicted: 246 of 4,313 books that have a second opinion
- integrity: 48 `author_id` values pointing at a missing doc, 3 at a tombstone

### The T0/T2 boundary moved on 2026-08-13 (#3950) — do not read it as a regression

`Various` used to be an exact-match placeholder, so `Various poets`,
`Various Authors` and `Various (Sangam anthology)` fell through to **T2
UNLINKED** — "a plausible name with no `author_id`", which none of them is.
Prefix-matching the collective forms moved **59 books from T2 to T0**, and T0
now reports how many of itself are deliberate collectives (**119 of 1,747**).

**No headline number changed**: reachable and anchored are computed from T3+T4,
which this does not touch. Ledger rows before and after are comparable on the
headline and NOT comparable on the T0/T2 split.

A collective stays in T0 on purpose. The ladder measures whether a byline gets a
reader to an author page, and `Various` does not, however true it is — but the
audit no longer reports those books as *missing* an attribution, because the
cataloguer answered the question and the answer is that there is no one author.
This is the reachability/correctness split the tiers already promise, applied to
T0.

## The first thing it measured was a regression

Over the 133 records corrected on 2026-08-11: **35 moved up a tier, 42 moved
down**, 56 unchanged. Net **−7** on reachability.

The dominant move is `T4 → T2`, 41 records. Those are books where the byline was
corrected from a printer to the real author — and `author_id` was **cleared**,
because no thesaurus doc existed for that person and inventing a link is how you
attach a book to a stranger.

So the trade was explicit: a **wrong but anchored** attribution became a **right
but unlinked** one. The reader now sees the correct name and can no longer click
through to an author page.

That is a real cost and the metric is right to show it. It is also the reason
the metric exists: "142 records corrected" concealed it completely.

## The named defect, and the intervention

**Defect:** correcting a byline strands the book at T2 whenever the correct
person has no `authors` doc.

**Intervention:** additively mint the missing docs from the QIDs already
collected — the grounded pass produced Wikidata ids for people the thesaurus
lacks (Annibale Caro Q566851, Sperone Speroni Q352663, Juan Huarte Q3091925,
Louis Le Roy Q684281, Francesco Patrizi Q3750435, G. F. Fortunio Q3767271, Sabo
Bobaljević Q1650958, and more from the printer cohort). Minting is the sanctioned
path (`additive-mint-authors-3780.mjs`); its two write shapes cannot reshape
existing clusters.

**Prediction to test:** those 41 `T4 → T2` records return to T4 — this time
pointing at the right person — and corpus reachability rises above the 77.87%
baseline rather than merely recovering to it.

**Re-measure with:** `node scripts/audit/attribution-health.mjs --snapshot`, and
read the `SINCE <date>` line it prints against the previous snapshot.

## What the loop is worth

The three numbers that would have been reported without it — "1,526 books at
risk", "6,025 unusable strings", "142 records corrected" — were respectively
wrong, wrong, and unfalsifiable. Each was corrected only because something
forced a denominator into view. A metric that can come back negative is the
cheapest available source of that force.
