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

**Settled 2026-09-12 by Derek: one experience, two surfaces — the wall searches
visually, the kiosk (touchscreen) reads.** "I see them as the same... the wall for
searching visually and the touch screen or kiosk for reading." So the turning book goes
to the kiosk, and the wall keeps the picture plane. Do not build a second reader in the
wall panels; do not build a second search on the kiosk.

This is cheaper than it sounds, because they are **already one crate** —
`~/makepad/apps/source-library-spiral`, four binaries over one `lib.rs`. `sl_kiosk.rs`
already imports four shared modules (`backend`, `ask`, `kiosk`, `phone`); `wall` is
public too. So "the kiosk gets the turning book" is not a port. It is lifting the leaf
out of `wall.rs` into its own module both binaries use: the `DrawPage` leaf shader
(`:301`, and it already takes a flat RGBA texture — no shader work), `Book`/`PageTurn`/
`BookDrag`/`spread_view` (`:2245`–`:2420`), `open_book_of`/`close_book`/`turn_pages`
(`:7310`–`:7420`) and `draw_book` (`:9053`). Roughly 600–800 lines, entangled with the
wall's camera and tile state, so mechanical but not trivial — and it is wall-side work,
so it belongs to whoever owns `wall.rs`.

**1a. Paginate the text into leaves.** The kiosk reader (sl-kiosk at `de8292d` on
`spiral-timeline`) sets a cream leaf in Aldine with the apparatus correctly lifted out —
but it is a PortalList, so the text scrolls off the foot and a scrollbar gives it away. A
page whose text scrolls is a pane with a paper background. Cut each source page into as
many leaves as it needs, both columns on the same span of source lines so they keep
facing each other. Handoff, posture first, with six checks:
`~/sourcelibrary-ops/handoffs/2026-09-12-kiosk-paginate-leaves.md`.

Measured on the bundle, one page sampled per book over 502 books — **size the leaf from
these, do not guess**: the median page is **10 lines** of original text, p75 **23**, p90
**35**, p99 **92**, longest seen 221. So a leaf holding ~24 lines carries three quarters
of all pages whole, and splitting is the exception — but a common one.

**1b. The empty second column.** Measured on the same sample, positive-controlled:
**55% of pages have no translation at all** (44% real, 1% tag-only blanks). The two-column
reader shows an empty English column on the majority of pages in the corpus; it never
showed in review because the demo book, PH150, is fully translated. Decide what one
column looks like before this reaches a case. The `<summary>` the pipeline already
writes — present on 31% of translated pages, e.g. *"the traditional opening of the Divine
Office, based on Psalm 51 and Psalm 70"* — is written, paid for, and currently discarded;
it is the one sentence a standing visitor most needs.

---

## Next, in this order

**2. Search at two speeds.** Keystrokes return index results in ~14 ms; the local model
works its tools in the background and lands a considered answer underneath, with
citations that open the page. Never a spinner where results should be. The model and its
twelve tools already work — `offlinesource` and the `sl-ask` daemon on 127.0.0.1:8766.
Only the surface is missing.

**3. The wall's live defects.**
- *Pictures never settle.* `tile.aspect` was overwritten when the atlas slot landed
  (`src/wall.rs:7736`); the row packer (`justified_rows`) is greedy and sequential, so one
  changed aspect re-cut every row after it, and arrivals kept coming. **Fixed** — a frozen
  `layout_aspect` taken from the index at first placement, on branch `wall-panels`. The
  rule it establishes holds everywhere, including the reading page: **geometry comes from
  the index, never from the pixels.**
- *Pointer lag, if it is real.* `tile_at` (`:8092`) walks every tile evaluating animated
  positions. **Do not "restore" the constant-time path at `:8128`** — an earlier audit
  said to, and that is wrong. It indexes by rank off square-cell arithmetic, and
  `a994e21` deliberately abandoned it because justified rows put pictures where their
  shapes say, so clicks landed on the wrong picture or on nothing. Reverting trades a
  possible slowdown for a certain correctness bug. The real fix is a row index over the
  packed rows — binary search on y, then scan one row — which is its own work with its own
  mis-hit risk, so it gets its own PR. First confirm the cost is real: nobody has verified
  whether hover fires per mouse-move or only on enter, and the whole item rests on that.

**4. Page scans, for the books that will be in cases.** `mirror-scans.mjs` is written.
Cased books at full quality, the rest at the 1000 px reading tier. Blocked only on
running it from a network the bulk guard recognises.

---

## Deliberately not started

Not "someday" — *not yet, on purpose*, because each is a second surface for a reading
page that does not exist:

- **The local-mode web reader.** Branch `feat/local-web-reader` exists; leave it.
- **A second reader in the wall panels.** Now a permanent no, not a "not yet" — Derek
  settled the split on 2026-09-12: the wall searches, the kiosk reads. The panel shows a
  passage and hands off.
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
