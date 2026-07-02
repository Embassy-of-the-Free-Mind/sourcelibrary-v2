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

## Tier 2 (not yet imported)
The public-domain Blavatsky / Theosophical Society canon — *Secret Doctrine*,
*Isis Unveiled*, *Key to Theosophy*, Besant, Olcott's *Old Diary Leaves*, Judge,
Leadbeater. Candidate IA ids gathered but held for a separate batch.
