# Theosophical import — source material & batch log

## Provenance
On 2026-05-29, Reinout Spaink (via Jozef Ritman; contact details in the private ops repo) emailed Derek
a pointer to the **Campbell Theosophical Research Library** index, "Links to
Theosophical Texts Online" — the catalog of the Theosophical Society in Australia.
The original site (`austheos.org.au/clibrary/`) is **dead on the live web**; it
survives only via the Wayback Machine. Reinout urged grabbing it before the archived
copy also goes. The three saved HTML pages here are that snapshot:

- `theos-index.html` — top-level contents (author pages, A–Z, sections)
- `theos-early.html` — **Early Classics** (primary wisdom texts: Hermetica, Gnostic,
  Kabbalah, Vedas/Upanishads, Tao Te Ching, Dhammapada, etc.)
- `theos-online-libs.html` — **Online Theosophical Libraries** (a directory of ~60
  theosophy websites — mostly HTML transcriptions, not scans)

Wayback origin: `https://web.archive.org/web/20180314022808/http://www.austheos.org.au/clibrary/bindex-0.html`

## What's importable
The directory itself is a *map*, not a feed — most "Online Libraries" links are typed
transcriptions that don't fit our scanned-original + OCR model. The importable layer is
the **Internet Archive** corpus it points at (thousands of public-domain texts:
theosophy ~4.9k, kabbalah ~4k, hermeticism ~1.7k, Blavatsky ~1.9k).

## Tier 1 batch (this PR)
`scripts/maintenance/import-theosophy-tier1.mjs` — Early Classics overlapping our core
mission (Hermetica / Gnostic / Kabbalah primaries). Deduped against the live collection;
we already held the Ficino 1481 *Pimander*, Mead's *Thrice-Greatest Hermes* (3 vols),
*Fragments of a Faith Forgotten*, and a *Pistis Sophia* edition. Net-new imports (5):

| IA id | Title | Year | Lang | Pages |
|---|---|---|---|---|
| `b30329619` | The Divine Pymander (Everard) | 1650 | English | 236 |
| `hymnshermes00hermgoog` | The Hymns of Hermes (Mead) | 1907 | English | 93 |
| `bub_gb_oDUgg6Xh8LgC` | Kabbala Denudata (Knorr von Rosenroth) | 1677 | Latin | 776 |
| `b24884443` | The Kabbalah Unveiled (Mathers) | 1887 | English | 408 |
| `cu31924075115380` | The Kabbalah (Ginsburg) | 1865 | English | 166 |

Imported `visible: false`; auth via the `CRON_SECRET` bearer bypass (the `/api/import/*`
routes now require `editor`+ — the curator skill doc is stale on this).

## Tier 2 (imported 2026-07-16)
On 2026-07-16 Reinout sent two further pointers — the Theosophical University Press
online library (`theosociety.org/pasadena/ts/tup-onl.htm`) and
`collectedwritings.net` — asking "missing any?". Audited both against the DB
(hidden books included — `search_library` cannot see them, see
[[lesson_search_library_misses_hidden_imports]]).

Most of the Tier 2 canon named in the old note turned out to be **already held**:
*Secret Doctrine* I–III, *Isis Unveiled* (several eds), *Key to Theosophy* (two),
*Voice of the Silence*, *Theosophical Glossary*, *Transactions of the Blavatsky
Lodge*, Judge's *Ocean of Theosophy* / *Echoes from the Orient* / *Yoga Aphorisms*,
the Mahatma Letters (Barker 1923), Sinnett, Besant, Mabel Collins, Arnold, and
Olcott's *Old Diary Leaves* First Series. Net-new imports (5, `visible: false`):

| IA id | Title | Year | Pages |
|---|---|---|---|
| `nightmaretales01blavgoog` | Nightmare Tales (Blavatsky) | 1892 | 171 |
| `studiesinoccult00blavgoog` | Studies in Occultism (Blavatsky) | 1895 | 81 |
| `lettersthathaveh00judguoft` | Letters That Have Helped Me (Judge) | 1920 | 228 |
| `epitomeoftheosop00judgiala` | An Epitome of Theosophy (Judge) | 1922 | 40 |
| `olddiaryleaveso00olcogoog` | Old Diary Leaves, Third Series (Olcott) | 1904 | 473 |

### Known gaps and traps

- **`collectedwritings.net` is not importable, and doesn't need to be.** It framesets
  onto `blavatskyarchives.com` and is Boris de Zirkoff's 15-volume *Collected
  Writings* (TPH, 1950–1991) — **in copyright**. But its contents are HPB's ~1,000
  articles of 1874–1891, public domain *in their original periodical form*, and we
  already hold those periodicals (below). Treat the BCW gap as an OCR problem on
  material we own, not an acquisition target. Don't import the de Zirkoff volumes.
- **Most of the TUP list is TUP's own copyright**, not public domain: Purucker,
  Grace Knoche, James Long, Titchenell's *Masks of Odin*, Barborka, Kaviratna's 1980
  *Dhammapada*, the *Encyclopedic Theosophical Glossary*, Eek's *Damodar*, Ryan.
  TUP is the rights holder — a permission ask, not an import.
- **TUP-only compilations that look like standalone books but aren't:** *Practical
  Occultism: From the Private Letters of W. Q. Judge* and *Occult Tales* are
  mid-century TUP editorial compilations. No public-domain scan exists; don't go
  looking for one.
- **Not on Internet Archive as clean scans** (checked 2026-07-16, two query shapes
  each): Alexander Wilder's *New Platonism and Alchemy* (1869) — on-mission, worth a
  non-IA source hunt — and the 1890 first edition of *Gems from the East* (only a
  1983 reprint and an uncatalogued upload).
- **Old Diary Leaves is still incomplete.** We hold First (1895) and now Third
  (1904). Series 2 and 4–6 exist on IA only as DLI records with no `volume` field,
  so series numbering can't be confirmed from metadata — needs a page-image check
  before importing, not a guess.

### The real Theosophy asset is already here, unprocessed
The largest holding is periodical runs imported hidden and never OCR'd. **Do not
scope this run by title — the titles are wrong.** A title-regex sweep
(`/^Lucifer/`, `/^The Theosophist/`) reports 38 books / 16,117 un-OCR'd pages. The
true figure is 24 books / ~12,000 pages. Always cluster these by `ia_identifier`
and confirm against `archive.org/metadata/<id>` before acting.

**The canonical run (verified against IA, batch-submitted 2026-07-16):**

| Run | Books | Pages | Un-OCR'd | IA id pattern |
|---|---|---|---|---|
| *Lucifer* Vols 1–20 (no 14) | 19 | 10,276 | ~9,074 | `theosophicalrevi00NNunse` |
| *The Theosophist* | 4 | 3,152 | ~2,827 | `theosophist0*goog`, `theosophist0037unse` |
| *Lucifer* v19 n114 (single issue) | 1 | 88 | — | `lucifer_v19_n114_feb_15_1897` |

**Batch result (2026-07-16):** 23 of 24 books submitted — **11,900 pages, $9.41**.
No 429s, no quota trouble. The single *Lucifer* issue **failed and was skipped**:
it was never archived to R2 (no `display_photo` / `archived_photo`, only the IA
source URL, which now **403s**). That is an archiving-stage gap, not an OCR
problem — see [[lesson_archiving_provider_routing_gaps]]; fix with
`archiving-watchdog.mjs --rearchive` if it's wanted. Low priority: it is a single
issue of Vol 19, whose full volume (`theosophicalrevi0019unse`, 552pp) was OCR'd
in this same batch, so the content is very likely already covered.

All English and all post-1820, so **OCR-only — no translation or modernization
pass** (see the English reader year-split). Measured from `gemini_usage`: realtime
OCR costs $0.00324/page, but the Batch API path (`scripts/batch/bulk-reocr-local.mjs`,
`--new-only`) is **$0.00079/page → ~$9.50 for the whole run**. That script submits
batch jobs directly and **does not touch the paused pipeline**, so no selective
unpause and no #2610 exposure. Results land via the `process-batches` cron (2h).

### Two traps in this run — read before re-scoping it

1. **`/^Lucifer/` catches two non-Lucifer books:** Steiner's *Lucifer-Gnosis (GA 34)*
   (660pp, already 100% OCR'd) and a Wikimedia artwork *Lucifer* by Collin de Plancy
   (0pp). Both inflated the original estimate.
2. **Six records titled `The Theosophist — YYYY` are not The Theosophist at all.**
   Their titles were assigned from an assumed series pattern at import, not from IA
   metadata (cf. [[lesson_import_author_linking_editor_trap]]). Verified true titles:

   | Book title (wrong) | `ia_identifier` | What it actually is |
   |---|---|---|
   | The Theosophist — 1885 | `fiveyearstheoso00meadgoog` | *Five Years of Theosophy* |
   | The Theosophist — 1889 | `b30480188` | *Why I Became a Theosophist* |
   | The Theosophist — 1892 | `irishtheosophist0000unse` | *The Irish Theosophist* |
   | The Theosophist — 1918 | `evolutionbesant00anonuoft` | *Evolution of Mrs. Besant* |
   | The Theosophist — 1919 | `lifeworkofalanle00leob` | *The Life and Work of Alan Leo* |
   | The Theosophist — Volume-V 1896-97 | `ult.irishtheosophist0000dndu...` | *The Irish Theosophist* |

   These are real, wanted books — but they must be **retitled before OCR or go-live**,
   or we publish Besant's biography as a journal volume. Held back from the batch.
   Also note `theosophist00arungoog` is dated **1890** by IA, not 1879 as titled.
3. **Six `ult.lucifer*` scans duplicate `theosophicalrevi*` volumes** (2, 3, 5, 6, 8,
   10 — "Lucifer — 1892" is Vol X). ~3,210pp of redundant OCR; excluded. Pick one
   copy per volume before any go-live, or the public run shows doubled volumes.
