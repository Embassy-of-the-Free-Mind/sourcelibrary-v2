# Paired artifacts must be verified, never assumed

**Read this when:** Writing code where one artifact must line up with another produced elsewhere: page images vs OCR, splits vs text, any two sequences indexed independently.

*Split out of `CLAUDE.md` on 2026-08-04. The text is unchanged apart from cross-references repointed to their new files. See `.claude/docs/knowledge-layer.md` for why this tier exists.*

---

Three incidents, one shape: #3362 (archiver wrote every page to a shared `archived/undefined/N.jpg` because `book_id` was missing from a projection), #3186/#3357 (e-rara PDF cover sheet made `photo_original` a one-page-offset sequence, and the re-archive sweep slid every image under its OCR), and #3368 (bulk archiver indexed the IA `*_jp2.zip` with the IIIF `/page/nN` number — IA keeps calibration/`Delete` leaves in the zip but strips them from the access derivatives, so a leading `Color Card` put **every** page's scan one leaf behind its text, on ~261 visible books / ~105K pages, undetected for four months).

Each time, two artifacts produced by **different code at different times** were assumed to correspond, and nothing checked. The rule:

- **When one writer's output must line up with another's, verify the pairing at write time and fail closed.** Not "usually lines up," not "lined up in testing" — the failure mode here works on the majority of inputs (1,309 aligned vs 524 shifted), so spot checks pass. `scripts/lib/page-alignment.mjs` `checkAlignment()` is the shared perceptual-hash test; `archive-bulk.mjs` and `rearchive-iiif-fullres.mjs` both gate on it. Refuse the book rather than write a suspect sequence — a skipped book is recoverable, a silently shifted one is not.
- **Never treat an external system's two numbering schemes as one.** IA's IIIF page number ≠ the zip leaf ordinal; resolve via `scripts/lib/ia-access-leaves.mjs` (scandata), and index files by the **ordinal in the filename**, never by position in a sorted listing (that also shifts on sparse zips).
- **A misalignment is invisible in either artifact alone.** Both panes render real content from the right book; only reading them *against each other* reveals it. A browser always looks fine. Proof is a hash or a page-by-page comparison, never a glance.
- **Don't trust `<page-num>` (or any single-side signal) as the detector.** A *uniform* shift preserves the page-number sequence perfectly (`De Abditis Nonnullis`: 100% shifted, zero sequence breaks), and early-modern books produce heavy false positives (`Opera Chymica`: 77 spurious "duplicates" from ornate numerals). It detects only the duplicate/gap class that arises when two OCR passes straddle the archival date.
- **Audit the writer's own pages, not the book's.** Books are archived by several paths; sampling all pages tests pages the writer never touched and returns a false pass (`Homiliae S. Isaaci Antiocheni`: 22 of 894 pages from bulk_jp2, sampled clean, actually shifted).
- **Ordering matters as much as mapping.** OCR that runs *before* archival reads the source URL; OCR that runs *after* reads the archived image. If those disagree, a book OCR'd in two passes gets pages transcribed **twice** while their neighbours are never transcribed at all — real duplicate text and real gaps that re-archiving alone cannot repair (see #3362's ordering hazard).

Full postmortem: `.claude/handoffs/2026-07-27-bulk-jp2-leaf-offset.md`.

---

**The same shape on artwork provenance fields (#3838, 2026-08-10):** on artwork
docs, `commons_title`, `commons_url`, and `commons_sha1` are written by
different code at different times and are NOT guaranteed to name the same
Commons file. The image-upgrade path (`image_upgrade_source: "Commons
alternate"`, May–June 2026) re-points `commons_title` at a higher-quality
duplicate file without refreshing `commons_url` or `commons_sha1` — measured
2026-08-10, **440** of ~11.2K true-Commons artwork docs disagree. Inside that
set, sha1 equality compares the wrong file: 362 of 367 apparent "sha1
divergences" were this, not wrong images (dHash confirmed the served images
match the upgraded file). So: **never use `commons_sha1` equality (dedup #3037,
integrity checks) without first checking that `commons_title` and `commons_url`
name the same file**, or test membership of the stored sha1 in the file's
*version history* (batchable: `prop=imageinfo&iiprop=sha1&iilimit=20`). And
never refresh a stale sha1 without dHash-verifying our stored image against the
newly named file first — an unverified refresh fabricates provenance.
`source_ids.commons` (the canonical post-redirect title, written 2026-08-09/10)
is the authoritative pointer; `fetchCommonsSource` prefers it.
