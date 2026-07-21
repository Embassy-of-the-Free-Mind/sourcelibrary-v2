# Page-counter convention conflict — postmortem (2026-07-20)

**Trigger:** Derek noticed `/book/histoire-de-la-magie-avec-une-exposition-claire-et-precise-constant`
showed *"This edition is not yet translated, but the library holds this work in English"*
while the reader below served English. "hmm? it is translated down below."

**Outcome:** 12 books with a genuinely false banner, all repaired. Root cause fixed in
PR #3295 (Mayank). One bad intermediate write by me, live ~30 min, fully reversed.

## What the bug was

`books.pages_count` / `pages_ocr` / `pages_translated` meant **two different things**
depending on which writer last touched the book:

- **Visible-only** (`page_number > 0`) — what the read path assumes.
  `src/app/book/[id]/page.tsx` prints `pages_count` as "N scans" and divides by it for
  `hasTranslations`, the ≥90%-readable filter, and the `TranslatedSiblingNotice` <5% gate.
  Negative `page_number` is a deliberate soft-hide; those pages never render.
- **All pages** — what five pipeline writers actually computed
  (`collect-batch-results`, `batch-collector`, `collect-multipage-ocr`,
  `realtime-translate`, `batch-split-bph`). None filtered on `page_number`.

Sample of 400 visible books that have hidden pages: **387 visible-only, 13 all-pages.**
The read path was right; the writers were the minority. Any book they touched after a
split/hide flipped to the wrong convention.

Histoire de la magie: stored `pages_translated: 20`, true visible count **581 of 620**.
It also displayed "929 scans" for 620 readable pages — 929 being the all-pages number.

## The wrong turn (the part worth reading)

My first fix copied its counting rule from `collect-batch-results.mjs`, reasoning that
mirroring the pipeline's own writer meant it could never disagree with it. That inherited
the bug. I then:

1. Scanned 19,412 books, found "1,924 drifted / 209,130 translated pages missing."
2. **Reported that as fact and wrote it to 88 books** before checking what a single one
   of those pages was.

It was wrong. In **12 of 12** sampled books the `pages_count` gap equalled the hidden-page
count *exactly* — that is a definitional difference, not staleness. The write added
13,274 phantom scans and 12,852 translated pages that exist only on pages readers never
see, making **66 books whose banner was correct look translated**. Histoire briefly
displayed "929 scans."

Reversed by recomputing all 88 under the visible-only rule (which restored the original
`pages_count` on 87 of them), then revalidate → catalog sync → CF purge.

**Real numbers after correction:** 12 false banners (not 88), 3,858 translated pages
genuinely uncounted (not 209,130). A re-scan of all 1,918 gate-tripping books returns 0.

The 12: *De re metallica* 592/600 (stored 0), Agrippa 617/624, Pymander 465/472,
Suetonius 683/695, Celsus 609/615, Leupold 312/352, Gaffurius 223/232, Cleonides 185/194,
Hollandus 143/154, Melopoiae 17/20, Centiloquium 12/12, Histoire de la magie 581/620.

## Lessons

1. **A gap that exactly equals a known subset is a definitional difference, not drift.**
   The check costs a minute and overturns the whole finding. Run it *before* the write.
2. **Mirroring an existing writer is not validation.** "It can never disagree with the
   pipeline" is only a virtue if the pipeline is right. Validate against the *read path* —
   the code that renders the number to a user — not against a sibling writer.
3. **Verify a sample of the units before trusting an aggregate.** "206,731 pages
   recovered" was arithmetic over a wrong predicate. One `pages.findOne` would have shown
   those pages were soft-hidden.
4. **Say "unmeasured" when a scan didn't finish.** Three background aggregations were
   killed mid-run; the residual corpus-wide drift is still unknown. Reusing the
   wrong-rule 209,130 figure would have laundered a bad number into the record.

## State at handoff

- **PR #3288** (merged) — `scripts/maintenance/recount-page-stats.mjs`, visible-only rule,
  dry-run by default. Header comment warns against realigning it to the pipeline writers.
- **Issue #3293** → **PR #3295** (merged, by Mayank) — every counter writer now routes
  through `scripts/lib/page-counts.mjs`, one source of truth. New drift is stopped.
- **Prod:** 12 books repaired, revalidated, `books_catalog` synced, Cloudflare purged.
  Scripts-only changes, so no Vercel deploy needed (Hetzner auto-pulls `main`).

## Open

**Residual drift is unmeasured.** Every book the old writers touched before #3295 is still
on the wrong convention until something recounts it. `recount-page-stats.mjs --stale`
does the sweep — run it on Hetzner, where a long aggregation won't get killed. Verify a
handful of any "recovered" pages actually render before applying.
