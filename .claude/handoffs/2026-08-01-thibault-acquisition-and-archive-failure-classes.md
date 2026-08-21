# Thibault acquisition → three archive-failure classes — 2026-07-31/08-01

Started as "acquire Thibault's *Académie de l'Espée*". The book shipped; the
interesting part is what archiving it exposed.

## The deliverable

**Gérard Thibault d'Anvers, *Académie de l'Espée* (Leiden, 1628)** — live at
`/book/academie-de-l-espee-d-anvers`, book id `6a6be1c4b7e35edd8ad0421f`.

- Source: Gallica, BnF Arsenal copy GR FOL-104, `ark:/12148/bpt6k1912344f`
- 448 pages archived to R2 at native resolution (plates to 12,180 × 8,948)
- OCR 448/448; translated 341/448 — the other 107 are `page-type: blank`
  (versos, covers, bleed-through). Verified: **zero** pages with real body text
  lack a translation.
- Summary + 40 chapters; 60 gallery images, avg quality 0.95, **43 of 45**
  double-page engravings
- Published via the three required steps: Mongo flip (visible/hidden opposites,
  `hidden_reason` unset) → Supabase `books_catalog` sync → ISR revalidate + CF
  purge. Live HTML verified to carry real server-rendered content.

Chose Gallica over six other digitised copies (KU Leuven, Leiden, LoC, Antwerp,
Barcelona, Brazil BN): it was the only one serving a clean IIIF manifest at
native resolution. **The CLAUDE.md note that Gallica blocks datacenter IPs is
stale** — Hetzner fetched manifest and images at 200 throughout.

## Class 1 — a total-duration fetch cap is a file-size limit in disguise

The archivers aborted a fetch 60s after it *started*. At Gallica's ~570 KB/s
that buys ~34 MB, and only if nothing shares the pipe. This book's 45
double-page engravings are ~21.7 MB each and take ~38s alone; under two workers
they crossed 60s and aborted.

**42 of 45 plates failed while every 6 MB text page succeeded**, and the book
still reported hundreds of archived pages — the loss is invisible from outside.

The abort surfaces as `This operation was aborted`, which reads as rate
limiting. **I misdiagnosed it that way and slowed the request rate, which made
it strictly worse** (5.7 hours for 5 pages): the constraint is per-request
duration, not requests per second. The tell that corrected it: failures
clustered on the *widest* canvases, and a lone fetch of p89 completed in 38s at
21.7 MB.

Fixed: `scripts/lib/fetch-stall-timeout.mjs` — re-arms per chunk, so size stops
mattering; absolute `maxMs` backstop retained; abort errors now name their
reason. Wired into `archive-gallica.mjs` (#3477) and `archive-ocr.mjs` (#3493).

Not fixed by requesting a smaller IIIF size — that is the #3186 mistake and is
doubly destructive on wide-format plates.

## Class 2 — recovery gated on the SPEND allowlist

8 books sat in `*_submitted` for 10–23 days after their jobs were cancelled;
`pipeline_auto.status` was never rolled back. Six were on preview-only OCR (25
of 264 pages); one was **already visible to readers** with its gallery plates
missing.

Phase 8.5 already knows how to fix this. Two gates blinded it: candidates were
filtered through the selective-unpause scope (160 books of ~99.7K), and a
recovery-only run exited at the global pause gate. A status rollback spends
nothing, and every phase that *does* spend stays scope-gated.

Fixed in #3501. Verified by A/B on one non-scoped book temporarily marked
stale, then restored byte-identical: old code `Stale books: 0`, new code
`Stale RETRY: De Voluptate (images_submitted -> chapters_complete)`.

## Class 3 — a 403 can be a rights refusal, not a block

14,123 pages carry `archived_photo: "failed:…"`. Because every archiver selects
on that field being empty, a marker hides the page from all future runs, and
**nothing clears them** (`archive-auto-unblock.mjs` only touches book-level
`archive_metadata.*`).

Built the sweep (#3500), classified `HTTP 403` as transient — "a 403 means the
provider refused us, not that the page is absent." Correct about HTTP, wrong
about this corpus. 8,583 of 9,767 clearable markers are Internet Archive, and
sampling resolved to `naghammadilibrar00jame` — Robinson's *Nag Hammadi Library
in English* (1981), `access-restricted-item: true`, `inlibrary`/`printdisabled`.

That 403 is IA **correctly refusing to serve an in-copyright book.** Clearing it
re-queues a fetch that must never succeed; if one did, we would be mirroring
copyrighted pages. Verified no harm: that book has 0 pages with a real
`archived_photo`.

Corrected in #3525 — bare 403 is now `UNKNOWN` (reported, never auto-cleared),
with `--include-403` as an explicit opt-in.

## Measurement lessons

- **The 2,500-page sample was wrong by a third.** It said 92.9% transient; the
  full corpus said 69.2%. Sampling the head of a collection samples insertion
  order, not the population.
- **Two of my own alarms were measurement bugs, not defects.** "100 untranslated
  text pages" came from `replace(/<[^>]+>/g,'')`, which strips tags but keeps
  wrapper prose — the exact bug CLAUDE.md warns about. "2 refusals" came from
  `/as an AI/i` matching inside "as an aid". Both were false.
- **A silent long-running script reads as a hang.** Two full scans were killed
  before emitting anything; the fix was a heartbeat, not an index. An index on
  `archived_photo` would be ~1.5 GB on a hot collection to serve a rare sweep.
- **The report can be blind while the logic is right.** The dry-run collapsed
  every digit, printing `2438 HTTP N` and merging retryable 403 with permanent
  404 — in the exact output an operator reads before `--apply`.

## Spot check (browser, not curl)

Reading the actual page found two things database checks could not:

1. `<note>` render truncates at a block boundary, silently dropping an entire
   second note (the image description). Known class, #3298.
2. **`<meta>` → `<note>` promotion**: OCR puts engraver attributions in `<meta>`
   (hidden wrapper); the translation promotes them to `<note>`, which is
   reader-visible *and survives `stripEditorialWrappers`*. 9 of 341 pages.
   These are AI assertions ("Engraved by Nicolaes Lastman in Amsterdam")
   rendered indistinguishably from source text — the #2232 class in a new spot,
   and *more* citable because they are plausible.

## State at handoff

Merged: #3476, #3477, #3493, #3500, #3501.
Open: **#3525** (403 correction — merge before any further sweep run).
Issue: **#3502** (96K-page backfill; blocked on the above).

Done to production data: 7 books un-stranded; 2,149 failure markers cleared
(1,000 IA, 1,000 gallica, 149 tail).

**Open, not done:**
- Restore the ~1,000 cleared IA markers (inert while paused; they point at
  lending-gated material).
- Do NOT clear the remaining 7,583 IA markers.
- File: `<meta>`→`<note>` promotion; infrastructure errors written as page
  verdicts (a Mongo DNS blip and an R2 clock-skew error each permanently hid a
  readable page); `pages_archived` counter drift (that IA book reads 518
  archived against a true 0 — which means #3502's gap is **understated**); the
  87 unknown-reason markers.
- Thibault plates 89 and 355 produce no gallery entry — vision model returned
  zero detections twice, deterministically. Both readable in the book.
