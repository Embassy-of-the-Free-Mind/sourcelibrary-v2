# What we preserve, and what we are willing to lose

**Read this when:** deleting anything, designing a backup, adding a store, answering
"is it safe?", or deciding whether a copy is worth keeping.

*Added 2026-08-30. The principles here were already enforced in code and scattered
across five places; this file is where they are stated together, because until now
nobody could read them in one sitting and two of them contradicted each other.*

---

## The one-sentence version

**Keep what cannot be re-made; regenerate what can; and never confuse "we can still
serve it" with "we still have it."**

## The five principles

### 1. Classify by replaceability, never by convention

Before deleting anything the only question that matters is *could we get this back?*

| class | meaning | policy |
|---|---|---|
| **M — master** | irreplaceable, or only by re-acquiring from an institution | never delete |
| **S — source** | bulk imports/PDFs the corpus was built from | delete only after proving the derived pages exist |
| **D — derived** | recomputable from an M or S | free to delete and regenerate |
| **E — editorial** | hand-made site assets | small; losing it means a person redoes design work |
| **T — transient** | test/prototype scratch | free |

Full prefix inventory: `r2-storage.md`. The near-miss that produced it: `archive/`
(396 GB) showed every signal of dead weight — referenced by zero page docs, written
in one day, sitting beside the live `archived/` under a near-identical name. It is
358,625 JPEG 2000 masters from the BPH partner library with **no `ia_identifier`**,
so nothing could have re-fetched them. Deleting it would have destroyed partner
masters to save $71/year.

**Why this keeps happening:** a missing *display* variant is a broken image someone
reports within the hour. A missing *master* breaks nothing visible. The paths that
fail silently are exactly the ones that go undocumented, and they are the ones you
cannot re-create.

### 2. The text is the irreplaceable half, and it is 1.8% of the bytes

This is the principle most likely to be got backwards, because the intuition is that
the big thing is the important thing.

| | size | can we get it back? |
|---|---|---|
| images | ~21.7 TB | mostly yes — from the source institution, expensively |
| text + metadata | ~42 GB | **no** |

The text was produced here at ~$56.5K of model spend plus years of curatorial
judgment, and **no institution has a copy**. Re-OCR is not recovery: it re-spends the
budget and still does not regenerate human editorial corrections, `page_revisions`
(which record what a specific model produced on a specific day, and so are not
reproducible even in principle), first-translation evidence, or index attributions.

**Archive the text first. It costs about four cents a month.**

### 3. Tier by re-acquisition path, not by importance

- **tier0** — no public re-acquisition path: `bph`, `cmc_kloss`, `allard_pierson`.
  If we lose these, they are gone.
- **tier1** — public institutional repositories. Re-fetchable, expensively, and
  **only while the institution keeps serving them at the same URLs**.
- **tier2** — has an `ia_identifier`; Internet Archive holds a copy.

Instrument: `scripts/maintenance/build-preservation-manifest.mjs`.

### 4. "Archived" is three questions, and you never sum them

| tier | question | instrument |
|---|---|---|
| **RECORD** | does a page doc *claim* an R2 URL? | `classifyPageRecord()` |
| **FILE** | does that object *exist*? | HEAD, sampled |
| **MASTER** | is it the *full-resolution original*? | dimensions, sampled |

Measured 2026-08-30: "on R2 at all" reads **78.4%**, "claims a master" **72.6%**.
Both true. Quoting either without its tier is how one corpus produced three coverage
numbers in an hour. Full text: `invariants/archive-coverage.md`.

### 5. An honest uncertain answer beats a cheap wrong one

You cannot classify a page image by its R2 key. `pages/{id}/{NNNN}.jpg` is documented
as a 1200px display variant and in production also holds 1361×2517 and 2370×3816
masters. So `classifyPageRecord()` returns `MASTER_OR_DERIVATIVE` — "cannot tell from
here" — and only a dimensional check returns a verdict. Every cheap guess made before
this was optimistic, in the direction that looks like success.

## What this means for two specific questions

### Do we keep clean, unmarked material?

**Yes — it is a hard rule, enforced in code, not a convention.** The provenance bake
writes only to `pages/` keys; it refuses any other prefix, and skips a page whose
display key *is* its master rather than marking it. Serving tiers can remove *visible*
marks but never the EXIF or the keyed watermark. Verified 2026-08-30: the IIIF
manifest's full-resolution `rendering` originals sample 0/25 marked, while its painted
display bodies sample 25/25 marked.

**But "clean" means unmarked, not immutable.** `archived_photo` is a mutable slot:
`rearchive-iiif-fullres.mjs` refetches and overwrites it in place. That is how #3186
corrupted 320 books — `photo_original` turned out to be a differently-indexed sequence
of the same book (e-rara's PDF carries a generated cover sheet, its IIIF stream does
not), so every image slid one page under its own text. A perceptual-hash guard now
runs before any overwrite. **We hold *a* master and sometimes replace it; we do not
hold a frozen acquisition-time original.**

### Do we keep the highest resolution?

**It is the goal, with a measured deficit and an active repair path — not a guarantee.**

- **~11% of pages are below native resolution** (mean stored/native width ratio
  0.958) — ~2.2M pages. They serve fine and **cannot be regenerated larger**.
- **~90,000 pages across 486 live books have no master at all** — derivative-only.
  They render 100% from our CDN while the only full-resolution copy sits on the
  partner's server. If that partner changes a URL scheme, we serve 1200px forever.
- Repair: `rearchive-iiif-fullres.mjs`, `deepzoom-harvest-page-masters.mjs`.
  Standing detector: `scripts/audit/pages-served-without-a-master.mjs`, weekly.

**Corollary — an audit must not become an incident.** Verifying a master means reading
bytes from the source institution. Three hosts blocked us inside 48 hours in August
2026 (MDZ #4395, plus the IA and Wellcome incidents). The audit runs **serially with a
650ms gap** for that reason. Do not parallelise it to make a report finish sooner.

## What is actually backed up (as of 2026-08-30)

| store | covered by | where | frequency |
|---|---|---|---|
| `books`, `books_warehouse`, `deleted_books` | `backup-books.sh` → restic | Hetzner Object Storage nbg1, encrypted | daily 04:00 |
| `pages`, `page_revisions`, `chapter_texts`, `entities`, `first_translation_attempts`, `gallery_images` | `backup-corpus-text.sh` → restic | same repo, streamed (never lands on disk) | weekly, Sun 06:00 |
| `bph_works` | 4 layers incl. revisions + JSON export | `bph-catalogue-disaster-recovery.md` | daily |
| Supabase (`page_translations`, embeddings) | Supabase managed backups | Supabase | daily, 8 retained, **PITR off** |
| **R2 objects (~21.7 TB)** | **nothing — single copy** | Cloudflare R2 | — |

**The gap that was closed on 2026-08-30.** `backup-books.sh` stops at book metadata,
on the stated reasoning *"Images live on R2; pages can be re-OCR'd from R2 if needed."*
That sentence and principle 2 above are the same repo disagreeing with itself, and the
backup script's version was the one that ran. `backup-corpus-text.sh` implements
principle 2. Verified by restore rehearsal, not by the job exiting 0: read the snapshot
back out of restic, `gzip -t` the whole stream, confirm the mongodump magic
`6de29981`.

**The gap that is still open: R2 has no second copy.** Tier-1 and tier-2 objects are
re-acquirable in principle; tier-0 (BPH, Kloss, Allard Pierson) is not. A bucket-level
accident is currently unrecoverable for those. The preservation manifest exists and is
described as "the deliverable even if no bytes ever move" — no bytes have moved.

**Unverified: MongoDB Atlas cluster snapshots.** The cluster is dedicated (MongoDB
9.0.0 Enterprise), and Atlas enables Cloud Backup by default on dedicated tiers — but
it can be switched off, there are no Atlas API credentials in the environment, and
Atlas is also the one line the cost reference still lists as billing-unknown. **Treat
Atlas coverage as unknown until someone reads the dashboard.** Per
`invariants/measurement-instruments.md`, the absence of a marker here is not the
absence of the mechanism — and its presence is not proof either.

## Related

- `r2-storage.md` — prefix inventory and replaceability table
- `invariants/archive-coverage.md` — the three tiers, and why key-based classification lies
- `invariants/archive-fetch-failures.md` — a fetch failure is a claim about the source
- `bph-catalogue-disaster-recovery.md` — the four-layer model this borrows from
- `scripts/maintenance/build-preservation-manifest.mjs` — the manifest and its tiering
