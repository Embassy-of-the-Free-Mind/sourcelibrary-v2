# From "what is R2 costing us?" to "we are not getting full resolution" — 2026-08-30

One session, one thread pulled all the way. It started as a storage-cost question and
ended at the acquisition path. Every finding below is measured, not inferred; where a
number did not reproduce that is said plainly.

## What was asked, and where it went

"Can we move hidden books to cheaper storage? What is R2 costing?" → R2 is 21.7 TB /
~$326 a month, ~95% of the Cloudflare bill, and hidden books are 56% of it. Cold-tier
options were costed. But the live question turned out to be the **+165 GB/day with a
flat object count** that the cost doc had listed as unexplained for two weeks.

That unexplained line led to a bake nobody was watching, a backup that excluded the
corpus's irreplaceable half, and finally to the acquisition path silently storing
capped derivatives as masters.

## Merged and deployed

| PR | | commit |
|---|---|---|
| #4409 | provenance reaches the surfaces machines read | `46cf73e0` — **live, verified on prod** |
| #4414 | text backup + `preservation-policy.md` | `5666b095` |
| #4428 | resolution debt measurable; instrument fix | `f2049bbc` |

Open: **#4434** (archiver dimension guard), **#4435** (CLAUDE.md budget demotion).

## The findings, in the order they fell

**1. The 165 GB/day was `bake-provenance-mark.mjs`.** It does not mark in place — it
*regenerates* `display_photo` from the master at `min(2000, native)` while the forward
generator writes 1200px. Same key overwritten → flat object count; 2.8× the pixels →
the bytes. Controlled test (same master, same q85, width the only variable): **1.98×,
+336 KB/page**. Independently, Cloudflare's own analytics: 165 GB/day ÷ ~500K
PutObject/day = **330 KB/put**. ~1.5 TB / ~$22 a month spent, ~$40 at completion.

**Why an earlier investigation cleared it:** the script's header said it "marks the
EXISTING variant" — true at birth, changed mid-PR by a commit that never updated the
docstring. That investigation measured the *watermark* (0.7%, correct) instead of the
*resize* (98%). **A controlled test only clears a suspect of the hypothesis it varied.**

**2. The bake had been hung for nine days** — alive, 0.03s CPU per 20s, log silent since
Aug 21. The 40-attempt wrapper cannot rescue a process that never exits. Stopped
(wrapper first, or it relaunches the unfixed code), cause fixed, log annotated.

**3. Two programmes aimed opposite intentions at the same objects.** #3005 Pass 1 calls
a display "never downsized" at ≥90% of its master; a baked variant is 100–122% of its
master. So every marked page reads as bloat and `regen-display-bloat.mjs` would have
stripped the watermark from all of it. Guarded, counted, `--force-unmark` to override.

**4. The mark was on what people see, not what machines take.** `/api/iiif/{id}/manifest`
painted the unmarked original; crawlers read manifests and never run JS. Now paints
`display_photo` with the full-res original as a labelled `rendering`. Verified on
production: **606/606 canvases**, painted bodies 25/25 marked, renderings 0/25.
The forward path also marked only 10% of new pages, with a *local reimplementation*
carrying no keyed watermark at all — now `markImage()` on every page (z=59.3 our key,
z=−1.9 wrong key).

**5. `pages` had no offsite copy.** `backup-books.sh` stopped at book metadata on the
reasoning "pages can be re-OCR'd from R2" — while the preservation manifest says the
text is the half that *cannot* be re-acquired. Same repo, opposite conclusions, and the
script's version was the one running. `backup-corpus-text.sh` now streams six
collections into restic (no disk landing — 39 GB free vs 33 GB of collections). **First
run completed: 20,663,445 pages in 54 min, six snapshots, restore-rehearsed.**

**6. We are not getting full resolution, and could not measure it.** `/full/full/` is a
*request*; seven hosts silently cap (Kyoto 8.69×, TU Delft 5.92×, Manchester 3.25×).
`fetchIiifNativeRes` defeats it and was wired into **two** callers.

- EAP (goes through the stitching worker): **11/14 full res**, median ratio 1.000
- e-rara (PDF at `pdftoppm -r 200`): **0/14**, median **0.667**, 1.92M pages
- Positive control, Manchester: `/full/full/` = 1366×2000 = **29% of native**;
  tile-stitched = 4782×7000 = **100%**. A 12× pixel recovery, available today.

**The selection effect that hid it:** answering the question needs stored *and* native
width. Corpus records stored on 66.7%, native on **7.7%** — and that 7.7% is almost
exactly what `archive-eap.mjs` wrote, the one worker that stitches *and* records. Over
that subset the corpus reads **95.2% full-resolution**. **The population we could
measure was the population we had archived correctly.**

**And the instrument leaned toward good news:** `fetchNativeWidth`'s fallback fetched
`/full/full/` and called the answer native — on a capping host that *is* the cap, so
ratio 1.0, perfect master. Now returns `null` for those hosts.

**Withdrawn:** the invariant doc's "~11% below master (ratio 0.958)". Two same-day runs
gave **63.8%** and **42.8%**. Do not quote a single figure until the recording lands.

## Not-obvious things worth keeping

- **Read from R2 directly, not through `images.sourcelibrary.org`,** for any corpus-wide
  object sweep. Via the CDN: 2.5/s and millions of cold edge fills. Direct origin with a
  12 KB first range: **13.4/s**.
- **A `mongodump` of a renamed collection succeeds** and writes a valid *empty* archive.
  Assert the document count first.
- **`pipefail` says the pipeline failed, not which half.** `PIPESTATUS` distinguishes a
  dead dump from a dead uploader; without it a truncated dump uploads as a clean snapshot.
- **Kill the wrapper before the worker,** or the retry loop relaunches the unfixed code.
- **The negative control caught my own guard being a decoration** — `RECORDS_NATIVE`
  matched `fetchIiifInfo` in an *import*, so deleting the recording left the test green.
  Delete the guarded line and watch it go red, every time.

## Open, and all of them decisions rather than bugs

1. **Atlas cluster-snapshot coverage is UNVERIFIED** — no API credentials here. Dashboard
   check. Decides whether the new backup is a second copy or the only one.
2. **`PDF_DPI = 200`** on 1.92M e-rara pages, commented "Good balance of quality vs size";
   and **#3186's e-rara lane parked** as "marginal res gain not worth a bespoke pass".
   0/14 at full res and a 0.667 median contest that judgement. Un-parking needs the
   `rearchive_blocked` dHash guard on — e-rara is the provider whose cover-sheet offset
   corrupted 323 books.
3. **The #4406 width question.** 2000px does not make the mark stronger (median z 8.5 vs
   8.8) but does buy coverage: **28/33 vs 31/33** surviving a q60 recompress, at 2.19× the
   bytes. Three costed options on the issue, including mark-at-1200-and-retry-at-2000
   (~$8/mo instead of ~$40 for the same detection rate).
4. **Seven archivers still don't record native width** — `NATIVE_WIDTH_DEBT` in
   `tests/unit/archivers-record-dimensions.test.ts` is the list, and it shrinks by deletion.
5. **The bake is stopped and must be restarted deliberately** once #4409's cursor fix is
   on the box. Do not relaunch `/root/run-provbake.sh` blind.
6. **R2's 21.7 TB still has no second copy.** Tier-0 (BPH, Kloss, Allard Pierson) is not
   re-acquirable.

## The thread running under all of it

Nothing here failed loudly. A bake ran six weeks past its acquittal; a backup script's
comment quietly excluded 20.6M pages; an audit's fallback graded capped scans as perfect
masters; two programmes aimed opposite intentions at one set of objects. Each was
individually well-reasoned. They failed where they met each other, or where a number was
written down once and never re-checked.

**The durable fix in every case was making the system record what it actually did**, so
the next person does not have to re-derive it from the outside — and, where the property
is mechanical, asserting it in a test rather than a sentence.

---

## Day 2 addendum — 2026-08-31

**Merged:** #4434 (`73554f7d`) and #4435 (`ff6a5af6`). Both docs/scripts-only, so the
ignored-build-step correctly skipped a deploy — no purge owed.

**Two corrections to day 1, both found by asking whether the fix had done anything:**

- **"The archiver running right now is fixed" was too broad.** `archive-acquired.ts` has
  two routes: `erara|iiif|mdz|gallica` → `archiveIiif()` (the path #4428 fixed), and
  everything else → `archive-ia-bulk.mjs`, a separate script never touched. Most
  acquisitions take the second route and it recorded no dimensions at all. Now records
  `image_width/height` from the buffer sharp already decoded for the thumbnail.
  archive.org does not silently cap, so there is no native width to chase — it is on
  `NATIVE_WIDTH_DEBT` with that reason.
- **The guard could not see it.** `WRITES_PAGE_IMAGES` matched a LITERAL key path;
  archive-ia-bulk builds its key into a const first, so the largest un-recording writer
  in the repo was silently exempt from the test written to catch exactly that. Two
  looser patterns were tried and both were worse (any upload call swept in CSV snapshots
  and thumbnailers; the string `archived_photo` swept in every audit that merely
  projects it). Pattern stays tight; the blind spot is now `EXTRA_WRITERS`, hand-verified,
  and the guards-the-guard test asserts that list is reachable so it cannot rot either.

**The backfill's `unreadable=69` were PNGs named `.jpg`,** served with an `image/jpeg`
content-type (book `6836f8ee811c8ab472a49e36`, magic `89504E47`). A JPEG-only parser
returns null on them forever — an honest counter nobody could interpret, which is the
shape of every problem in this issue. Parser now reads magic bytes, not the extension or
the content-type, both of which lie here. Verified on the same sample: 69 → 0.

## RUNNING RIGHT NOW — pick this up

`backfill-stored-dimensions.mjs --apply --concurrency 24`, detached on Hetzner,
log `/var/log/sourcelibrary/backfill-dimensions.log`.

- Target ~5.42M pages (28.1% of pages archived on our R2 had no recorded width).
- At 2026-08-31 evening: **2,672,000 scanned / 2,671,349 recorded, 0 failed, 0
  unreadable, ~90/s** — roughly half done, ETA ~9h.
- Resumable and idempotent: it re-selects whatever still lacks a width and walks `_id`
  ascending, so a death costs only the in-flight batch. Re-run the same command.
- **When it finishes**, the STORED half of "are we holding the master?" becomes one query
  instead of a rate-limited probe. The NATIVE half still needs the six remaining
  archivers to record at fetch time — that is the highest-value remaining work, because
  it is the half that can never be backfilled.
- `not-ours` (651 so far) = pages whose `archived_photo` points somewhere other than our
  R2. Skipped deliberately rather than probing a partner. Worth a look afterwards: a page
  claiming an "archive" that lives on someone else's host is the derivative-only state
  wearing a disguise.

---

## Day 2 evening — the ceilings came off, and a number of mine came out

**Merged:** #4468 (`394d7376`), #4472 (`e085e4d8`), #4473 (`aefd9035`).
**Open:** #4478 (e-rara header + the withdrawal below).

**#4472 — six archivers, done.** `fetchPageMaster()` in `iiif-utils.mjs`, adopted by
archive-iiif-local / archive-ocr / archive-gallica / backfill-hires-illustrations /
archive-unarchived-books. It does NOT own the download: each worker keeps its own
retry/UA/rate policy (MDZ 2/s, Vatican 0.1/s, Harvard MPS 1/s after 294 books got
three-strike-blocked) and passes it in; the helper adds only the tile-stitch route on
known cappers and the native dimensions. `NATIVE_WIDTH_DEBT` went **7 → 4**, and the
four remaining are legitimate: archive-bulk and archive-erara read local files,
archive-ia-bulk fetches from a host that does not cap, repair-bulk-jp2-offset is a
one-off. Also removed archive-gallica's private `upgradeToFullRes`, which was
gallica-only and silently no-op'd on every other host it touches.

**#4473 — no resolution ceilings on masters (Derek's call).** The audit found five,
not the two I had flagged:

| file | ceiling |
|---|---|
| archive-bulk | `MAX_DIMENSION = 3000`, no comment, two sites |
| archive-erara | `MAX_DIMENSION = 3000` |
| archive-erara | `PDF_DPI = 200` — "Good balance of quality vs size" |
| **batch-split-bph** | **`CROPPED_MAX_WIDTH = 2000`** |
| rearchive-iiif-manifest | `--max-width 6000` default, on a RECOVERY path |

**batch-split-bph was the important one and was hiding in plain sight.** That crop is
not a derivative: `getPageSource()` returns `cropped_photo` FIRST and the splitter
overwrites `archived_photo` with the half, so for a split book the 2000px crop IS the
highest-resolution copy held — on BPH, which is tier 0 with no re-acquisition path.
Replaced by a SAFETY VALVE (skip loudly above 30000px, never shrink quietly).
Guarded by `tests/unit/no-master-resolution-ceilings.test.ts`, negative-controlled
both directions. Costs R2 storage on future archiving; existing masters unchanged.

**THE CORRECTION THAT MATTERS MOST.** I reported "e-rara 0/14 at full resolution,
median 0.667, ~44% of the pixels" and repeated it into a commit message, a PR, an
invariant doc and a code comment. **Withdrawn.** Re-measured across 30 pages ONE PER
BOOK: **19/30 (63%) at full resolution, median ratio 1.14**, p10 0.59, worst 0.28,
best 1.48. The median page holds MORE width than the IIIF service calls native. The
word is **uneven**, not lossy.

The bad figure came from 14 pages that were very likely a handful of books repeated.
**Pages within a book share a capture path — they are ONE observation, not N.** I had
diagnosed exactly this clustering the day before for the corpus-wide figure
(11% / 42.8% / 63.8% from one instrument) and then walked into it myself. Naming a
bias does not immunise you against it. The rule now lives in `archive-coverage.md`,
which also separates the two claim types that were muddled in one bullet: Manchester's
29% -> 100% is a single page establishing a MECHANISM (one case can); a RATE needs the
per-book sample.

`PDF_DPI` stays 400, on corrected reasoning: ratios above 1.0 show the PDF carries
more resolution than a 200-DPI rasterization extracts, so the 0.28 cases genuinely
benefit. Not because of the withdrawn number.

**`not-ours` resolved, benign.** Of 3,000 pages whose `archived_photo` is not on our
R2: **2,943 are `failed:` markers** (a recorded failure, not a claimed archive) and
**57 are Vercel Blob residue** from the completed migration. No preservation problem.

**Backfill still running:** 3.40M / 5.42M, ~88/s, 0 failed, 0 unreadable.
Resume with the same command; it re-selects whatever still lacks a width.
