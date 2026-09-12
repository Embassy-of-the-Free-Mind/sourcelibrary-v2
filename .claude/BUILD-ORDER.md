# Build order

**What we are building, in what order.** One item is *in hand* at a time. If you want to
start something that is not the top unfinished item, say so before you start — on 11–12
September five surfaces were opened in parallel and none of them finished.

This is not `.claude/ROADMAP.md`, which is a different and still-live thing: *which books
to translate next*. This file is *what to build next*.

Updated 2026-09-12. Evidence for the order: `~/sourcelibrary-ops/design/2026-09-12-audit-five-surfaces.html`.
Interface direction it must satisfy: `~/sourcelibrary-ops/design/2026-09-11-three-rooms-ui-vision.html`
and `design/DECISIONS.md` beside it.

---

## In hand

**1. The reading page — text set onto the turning leaf.**

The native app already has a book whose leaves turn (`Book` at `src/wall.rs:2245`, the
`DrawPage` leaf shader at `:301`, drag and flip in `BookView`/`BookDrag`). It already
loads page text (`Book::texts`, `book_want_texts`). But the leaf is only ever a *scan*,
and the text runs in a column beside the book (`src/reader.rs`), so a book with no scan
opens as blank paper. We have **no scans mirrored at all**, so that is every book.

Do this: typeset a page to an offscreen texture and hand it to the leaf shader, which
already takes one. The book then does not care whether a leaf carries a photograph of a
page or a page we set ourselves.

- Original in Aldine Aetna on one leaf, the English facing it.
- A plate that was cut from page *n* appears at page *n*, sized from the aspect the
  picture index already stores for all 167,400 of them — never measured after it decodes.
- A scan, where one exists, simply replaces the typeset texture on that leaf.

Definition of done: open any book from search, turn pages, read the original beside the
English, see its plates in place, with no scan on disk and no network.

**Open question for Derek, blocking the placement only:** the turning book lives in the
wall app; the kiosk has its own column reader. Does the kiosk get the book, or does the
wall become the reading surface? The audit assumed the kiosk, before this was found.

---

## Next, in this order

**2. Search at two speeds.** Keystrokes return index results in ~14 ms; the local model
works its tools in the background and lands a considered answer underneath, with
citations that open the page. Never a spinner where results should be. The model and its
twelve tools already work — `offlinesource` and the `sl-ask` daemon on 127.0.0.1:8766.
Only the surface is missing.

**3. The wall's two live defects.**
- *Pictures never settle.* `tile.aspect` is overwritten when the atlas slot lands
  (`src/wall.rs:7736`); the row packer (`justified_rows`, `:1298`) is greedy and
  sequential, so one changed aspect re-cuts every row after it, and arrivals keep coming.
  Freeze a layout-only aspect at first placement, taken from the index. Same rule as the
  reading page: **geometry comes from the index, never from the pixels.**
- *Pointer lag.* `tile_at` (`:8087`) walks every tile evaluating animated positions on
  every mouse move; the constant-time grid path at `:8105` is unreachable because
  `relayout` always sets `justified_rows > 0`. Restore it for plain grids.

**4. Page scans, for the books that will be in cases.** `mirror-scans.mjs` is written.
Cased books at full quality, the rest at the 1000 px reading tier. Blocked only on
running it from a network the bulk guard recognises.

---

## Deliberately not started

Not "someday" — *not yet, on purpose*, because each is a second surface for a reading
page that does not exist:

- **The local-mode web reader.** Branch `feat/local-web-reader` exists; leave it.
- **A second reader in the wall panels.** The panel shows a passage and hands off.
- **Meaning search over pages, offline.** Needs the corpus re-embedded with an open
  model; a night of GPU time. Keyword and concept-alias search cover it for now.
- **The experience-map rebuild.** Classification ran; the pages can wait.

---

## Done — do not rebuild

- Corpus mirror, 38,713 books, full text, FTS in both scripts (`~/sl-corpus`).
- `sl-local` MCP daemon, twelve tools, in every session.
- `offlinesource` terminal librarian; `sl-ask` HTTP daemon for in-app use.
- Offline picture search by content: CLIP over 184,790 pictures (`~/sl-corpus/clip`).
- The kiosk bundle: 42 GB, one file, 14 ms full-text search.
- `mirror-scans.mjs`, the page-scan mirror — written, not yet run.

---

## Rules for this file

1. One item in hand. Finish it before opening another.
2. A new front needs a line here before it needs a handoff.
3. When an item is done, move it to **Done** with its commit or PR number.
4. Keep it under one screen. If it needs more room, it is a handoff, not a roadmap.
