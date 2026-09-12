# "Archived" is three questions, and answering the wrong one is the default

**Read this when:** Quoting how much of the corpus is archived; writing or changing an archiver's "is this book done?" selection; adding a field or R2 key that holds a page image; planning an archive/acquisition push; or reading `/admin/r2-coverage`.

*Added 2026-08-30 after three methods answered one question with 1.48M, 4.03M and 5.18M.*

---

## The rule

**Never say "archived" without saying which tier you mean, and never sum the tiers.**

| tier | question | cost | instrument |
|---|---|---|---|
| **RECORD** | does a page doc *claim* an R2 URL? | cheap, corpus-wide | `classifyPageRecord()` |
| **FILE** | does that object *exist*? | HEAD, sampled | `r2-coverage-snapshot.mjs` variant probe |
| **MASTER** | is it the *full-resolution original*? | dimensions, sampled | `classifyPagePreservation()` |

All three live in `scripts/lib/archive-coverage.mjs`. Report through
`scripts/audit/archive-coverage.mjs`. If you are about to write a fourth
definition, you are the sixteenth writer — see #4239.

## Why this is not pedantry

#4194 established the state that makes the distinction load-bearing. A page can
be **derivative-only**:

```
photo           api.digitale-sammlungen.de/.../full/full/...   (MDZ, full-res)
archived_photo  (absent)                                        ← no master
display_photo   images.sourcelibrary.org/.../0040.jpg           (1200px, ours)
```

That page serves **100% from R2** and is correctly counted as "served by us" —
while the only full-resolution copy sits on Munich's server. If MDZ changes a
URL scheme or withdraws the item, we serve 1200px forever and can never
regenerate anything larger. **A serving metric cannot see preservation.**

Measured 2026-08-30 on random samples: "on R2 at all" reads **78.4%** while
"claims a master" reads **72.6%**. Both are true. Quoting either without its
tier is how the same corpus got three different coverage numbers in one hour.

## The trap: you cannot classify by R2 key

`.claude/docs/r2-storage.md` documents `pages/{bookId}/{NNNN}.jpg` as the
"1200px display" variant. In production that key holds **full-resolution
masters** — measured 1361×2517 written by `archive-acquired.ts` (which resizes
nothing before `storagePut`), 2370×3816 written by the pipeline. Same key
shape, two different meanings, and neither is 1200px.

So a path-based classifier is guessing, and every guess has been optimistic.
`classifyPageRecord()` therefore returns `MASTER_OR_DERIVATIVE` — an honest
"cannot tell from here" — and only the dimensional check returns a verdict.
**An honest uncertain number beats a cheap wrong one**; the cheap wrong ones
are what produced the 3.5× spread.

## Corollaries

- **`books.pages_archived` and `archive_status` are not evidence.** #4190
  measured the counter 4.7× off on live books, with books reading `9 / 1625`
  that were fully on R2. Measured again 2026-08-30: **~15% of books flagged
  incomplete are actually complete.** `archive-bulk.mjs` still selects its work
  by that counter. Validate a completion claim against the pages, never the
  book doc.
- **Below-master is real and large — and the size is NOT known.** An earlier
  version of this line said "~11% of pages below native resolution (mean ratio
  0.958)". **That does not reproduce.** Re-run the same day on two independent
  samples it gave **63.8%** (400 pages / 1,200 books, mean 0.605) and **42.8%**
  (250 / 500, mean 0.732). Three answers, one instrument, one day. Do not quote
  a single figure for this until the recording below makes it a query. What is
  certain: it serves fine, it cannot be regenerated larger, and it is much more
  than 11%.
- **The pages we could MEASURE were the pages we archived CORRECTLY (#4406).**
  Answering "is this a master?" needs stored width AND native width. The corpus
  records stored on 66.7% of pages and native on **7.7%** — and that 7.7% is
  almost exactly the set `archive-eap.mjs` handled, the one worker that both
  tile-stitches to native *and* records `iiif_info`. Measured over it, the
  corpus reads **95.2% full-resolution**: true of the subset, meaningless as a
  corpus number. A selection effect this clean is why the debt stayed invisible
  for months. The fix is not a better sample, it is recording both numbers at
  archive time.
- **`fetchNativeWidth` used to grade capped pages as perfect masters.** Its
  fallback asks the source for `/full/full/` and calls the answer native. On the
  seven `SILENT_CAP_HOSTS` that request *is* the cap, so the probe read the cap
  as native, the stored copy matched it exactly, ratio 1.0, master. The error
  ran toward good news on precisely the population where the debt lives. It now
  returns `null` (undecidable) for those hosts rather than a flattering number.
- **Sample ONE PAGE PER BOOK, or a page count impersonates an independent
  sample.** This bullet previously read "e-rara **0/14** at full res, median
  **0.667**, ~44% of the pixels" — from 14 pages that were very likely a handful
  of books repeated. **Withdrawn.** Re-measured 2026-08-31 across 30 e-rara pages,
  one per book: **19/30 (63%) at full resolution**, median stored/native ratio
  **1.14**, p10 0.59, worst 0.28, best 1.48. The median page holds *more* width
  than the IIIF service calls native; about a third sit below it. The honest word
  is **uneven**, not lossy — and the first number reached a commit message, a PR
  and this doc before anything checked it. Pages within a book share a capture
  path, so they are one observation, not N.
- **What does hold up, measured the same way:** EAP/BL **11/14 at full res**
  (median ratio 1.000) — it goes through the worker that stitches. And the
  positive control on Manchester, which is a single page and therefore claims
  nothing about a population: `/full/full/` returns 1366x2000 = **29% of native
  width**; tile-stitching the same page returns 4782x7000 = **100%**. A 12x pixel
  recovery, available today. That one is a demonstration of a *mechanism*, which
  a single case can establish; a *rate* is what needs the per-book sample.
- **An audit must not become an incident.** The MASTER tier reads bytes from
  the source institution's server. Three hosts blocked us inside 48 hours in
  August 2026 (#4395 MDZ; plus the IA and Wellcome incidents). The audit runs
  **serially with a 650ms gap** for that reason. Do not parallelise it to make
  a report finish sooner.
- **Native width must come from an upgraded URL.** Probing a stored
  `/full/1200,/` source URL reports 1200 as "native", and every derivative then
  grades itself a perfect master. `fetchNativeWidth()` applies
  `upgradeToFullRes` first. This is the same class of error as #3186 itself.

## Make it a query, not a probe

The MASTER tier is sampled, slow and rate-limited **only because the two numbers
it compares were never written down**. Both halves are now being fixed, and the
order matters:

1. **Stored width — free, ours, corpus-wide.** `scripts/maintenance/backfill-stored-dimensions.mjs`
   reads the JPEG SOF header of each archived object **directly from R2**, not
   through `images.sourcelibrary.org`. Through the CDN this is 2.5/s and would
   take a month, and it would dump millions of cold edge fills — the thundering
   herd #2651 refused to trigger with a purge. Origin reads with a 12 KB first
   range (escalating only when EXIF pushes SOF past it) avoid both.
2. **Native width — must be recorded AT ARCHIVE TIME.** No sweep can backfill it
   cheaply, because getting it means asking the institution, which is the cost
   we are trying to stop paying. Every archiver that writes a master must record
   `iiif_info.width/height` beside `image_width/image_height`. `archive-acquired.ts`
   and `archive-eap.mjs` do. The rest do not yet — that is the remaining work,
   and until it lands the corpus keeps minting pages whose resolution can only
   be checked by going back to the source.

**The rule: an archiver that cannot say what it stored, and what was available,
has not finished archiving.** A master is a claim, and a claim needs evidence
recorded at the moment it is made — the same discipline the first-translation
badges already apply to a much less expensive assertion.

## When you add a page-image field or R2 key

Add it to `classifyPageRecord()` in the same commit. The function's derivative
list (`cropped_photo`, `display_photo`, `thumbnail_blob`, `image_thumb`) is the
enumeration everything else trusts; a field that is not in it is invisible to
every coverage number in the system, in the direction that looks like success.

Related: #4239 (one metric, one archiver), #4194 (three states), #3186
(resolution debt), #4190 (the counter lies), #4395/#4397 (the archiver stall
and the sharded drain this metric is meant to steer),
`invariants/archive-fetch-failures.md` (a failure is a claim about the source),
`invariants/measurement-instruments.md` (the general rule this is an instance of).
