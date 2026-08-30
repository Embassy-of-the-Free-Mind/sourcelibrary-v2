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
- **Below-master is real and large.** The MASTER tier reads **~11% of pages
  below native resolution** (mean stored/native width ratio 0.958). Against
  20.18M pages that is ~2.2M — arrived at independently, and within 5% of
  #3186's 2.1M. It serves fine and it cannot be regenerated larger.
- **An audit must not become an incident.** The MASTER tier reads bytes from
  the source institution's server. Three hosts blocked us inside 48 hours in
  August 2026 (#4395 MDZ; plus the IA and Wellcome incidents). The audit runs
  **serially with a 650ms gap** for that reason. Do not parallelise it to make
  a report finish sooner.
- **Native width must come from an upgraded URL.** Probing a stored
  `/full/1200,/` source URL reports 1200 as "native", and every derivative then
  grades itself a perfect master. `fetchNativeWidth()` applies
  `upgradeToFullRes` first. This is the same class of error as #3186 itself.

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
