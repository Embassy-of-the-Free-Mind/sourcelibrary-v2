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
The largest holding is periodical runs imported hidden and never OCR'd:

| Run | Vols | Pages | OCR'd | Visible |
|---|---|---|---|---|
| *Lucifer* (HPB ed., 1887–1897) | 28 | 14,234 | 2,004 | 1 |
| *The Theosophist* (from Vol 1, 1879) | 10 | 5,401 | 1,514 | 0 |

~16,100 un-OCR'd pages here, plus 993 from the Tier 2 imports. All English and all
post-1820, so they are **OCR-only — no translation or modernization pass** (see the
English reader year-split). Measured cost from `gemini_usage` (last 200k ops,
2026-07-16): OCR runs **$0.00324/page** on `gemini-3-flash-preview`, and these route
to `gemini-3.1-flash-lite` at ~half that. **Whole run ≈ $30–55.** The blocker is not
money — it's that the pipeline is deliberately paused, and selective unpause has a
known phase-local bug (#2610): use `$addToSet` on `allow_book_ids`, never `$set`.
