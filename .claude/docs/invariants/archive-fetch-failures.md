# Archive fetching — a failure is a claim about the source

**Read this when:** Writing or debugging an archiver / importer: `scripts/lib/fetch-stall-timeout.mjs`, `scripts/**/archive-*.mjs`, anything writing `archived_photo`, or triaging a book that "failed to fetch".

*Split out of `CLAUDE.md` on 2026-08-04. The text is unchanged apart from cross-references repointed to their new files. See `.claude/docs/knowledge-layer.md` for why this tier exists.*

---

Lessons from acquiring Thibault's *Académie de l'Espée* (2026-08-01). Full
postmortem: `.claude/handoffs/2026-08-01-thibault-acquisition-and-archive-failure-classes.md`.
Three failure classes, one shape: an archiver's error handling encoded a guess
about the source as a durable fact, and every one of them failed *silently, in
the direction that looks like success*.

- **A total-duration fetch timeout is a file-size limit wearing a clock's
  costume.** Aborting 60s after a fetch *starts* fires on the LARGEST page in a
  book — always the foldout, the map, the plate — while ordinary text pages sail
  through. It cost **42 of 45 double-page engravings** on one book, and the book
  still reported hundreds of archived pages, so nothing looked wrong. Use
  `fetchWithStallTimeout()` (`scripts/lib/fetch-stall-timeout.mjs`), which
  re-arms per chunk so size stops mattering. **Never "fix" this by requesting a
  smaller IIIF size** — that is the #3186 mistake and is doubly destructive on
  exactly the wide plates it destroys. **Tell:** failures cluster on the widest
  canvases; a lone fetch of the failing page succeeds. The abort surfaces as
  `This operation was aborted`, which reads as rate limiting — backing the
  request rate off makes it strictly worse, because the constraint is
  per-request duration, not requests per second.
- **HTTP 403 may be a rights refusal, not a block — never auto-retry it.** 88%
  of this corpus's failure markers are Internet Archive, and they resolve to
  `access-restricted-item: true` / `inlibrary` books: IA **correctly refusing to
  serve in-copyright material**. Clearing such a marker re-queues a fetch that
  must never succeed, and if one did we would mirror copyrighted pages into R2.
  `classifyArchiveFailure()` treats bare 403 as `unknown` (reported, never
  auto-cleared); `--include-403` is an explicit opt-in for a caller who has
  confirmed the books are public domain. Check the IA item's
  `access-restricted-item` before assuming a 403 is transient.
- **Never write an error you did not attribute into `archived_photo`.** The
  field doubles as the archiver's work queue, so any `failed:` string hides the
  page from every future run — and a catch-all handler writes *our* failures
  there too: a Mongo DNS blip and an R2 clock-skew error each permanently hid a
  perfectly readable page. An infrastructure error says nothing about the
  source. (Same class as the Data Protection rule in `CLAUDE.md`: a bad write erases its
  own repair path.)
- **Recovery must never be gated on the SPEND allowlist.** Phase 8.5 rolls a
  stuck `*_submitted` status back, which submits nothing and costs nothing — but
  it was confined to the selective-unpause scope (160 books of ~99.7K) and
  skipped entirely on a paused run, so 8 books sat stuck 10–23 days and were
  repaired by hand. Corollary of "the pause is a SPEND control": gate the phases
  that spend, never the bookkeeping that heals.
- **Sampling the head of a collection samples insertion order, not the
  population.** A 2,500-page sample read 92.9% retryable; the full 14,123 read
  69.2%. Validate a corpus sweep at corpus scale — and note that a *silent*
  long-running script reads as a hang (two full scans were killed before
  emitting a line). The fix is a heartbeat, not an index: indexing
  `archived_photo` would add ~1.5 GB to a hot collection to serve a rare sweep.
- **A fetched tile pasted onto a prepared canvas must be checked for EXTENT, or
  a short read becomes invisible data loss.** `fetchIiifNativeRes` composited
  IIIF region tiles at `left = col*chunk` onto a **white** canvas and never
  looked at what came back. `rearchive-iiif-fullres.mjs` sized the stride from
  `pageInfo.maxWidth || 2000` — and EAP advertises *nothing*, so the fallback
  invented 2000 while EAP serves 1200. Every cell was short by 0.6 linear /
  0.36 area: masters that are 63.5% pure white, every line of text truncated at
  a gutter and resuming 800px later. It rewrote `photo` as well as
  `archived_photo`, so readers, IIIF and OCR all got the gapped image. 80,981
  pages / 167 Tibetan books, 74,344 of them carrying a published translation the
  model invented off a two-thirds-blank folio (#4523, #4534).
  **Nothing downstream could see it**: R2 served a real, complete, 200-OK JPEG,
  and the blank-page guard keys on ink coverage while these leaves are dense. A
  hole in a page image has no detector, so it has to fail at the write boundary
  — `tileFits()` in `scripts/lib/iiif-utils.mjs` now refuses any tile that does
  not fill its cell, and the stitcher probes one tile to learn the server's real
  cap instead of believing its advertisement.
  Two corollaries worth more than the incident: **an advertised limit is a hint,
  and on `SILENT_CAP_HOSTS` a known lie — probe, never trust** (a `|| 2000`
  fallback is the same bug wearing a default's clothes); and when you go looking
  for the damage afterwards, **key on GEOMETRY, not quantity**. The first
  detector screened on "lots of pure white" and reported 63.6% of Tibetan pages
  broken — mostly BDRC pecha scans, long thin folios on a white ground that are
  legitimately 75–96% white. The signature is an interior full-span white band
  ≥200px on BOTH axes; margins touch the border, gutters do not. Standing
  detector: `scripts/audit/tile-stitch-gutters.mjs`.
