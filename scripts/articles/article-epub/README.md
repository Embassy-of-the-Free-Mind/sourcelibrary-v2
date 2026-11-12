# Article EPUB: an essay with its sources at the back

`bash scripts/articles/article-epub/build.sh <slug>` builds the EPUB and puts it in R2 at
`article-epubs/<slug>-<hash>.epub` (EPUBs are never committed: .gitignore), printing its URL. `UPLOAD=0`
skips the upload; `OUT=<path>` keeps a copy. `STYLE=bw` is the e-ink edition (`article-epubs/<slug>-bw-<hash>.epub`): page scans 1-bit by an adaptive
threshold, figures grayscale (`pictures.ts`, which also crops every picture to its printed area).
Hyperborea: 4.3 MB, against 11 MB in colour. The EPUB is the article, then every library page it links to
(`/book/<slug>?page=N`), each as a full page of text, in the order the article first cites
them. The article's links to those pages go to the reading in the back; each reading links
to the page online. For a reader on a plane or a Kindle (Derek, 2026-11-11).

1. `render.jsx` renders the article's page.tsx to static HTML with esbuild + react-dom/server,
   the site components swapped for the plain ones in `mocks/` (the live page is behind the
   crawler gate, so it cannot simply be fetched).
2. `fetch-pages.mjs` reads the cited pages from Mongo, read-only: the English translation, or
   the transcription for an English-language book.
3. `build.ts` assembles the EPUB with epub-gen-memory, using the site's `markdownToHtml`.
4. `upload.ts` puts it in R2 with `storagePut`.

Then set `epub: { colour: { href, mb }, eink: { href, mb } }` on the post in `src/app/articles/posts.ts`;
ArticleEnd shows the download link.

The key carries a content hash because the CDN keeps serving an old object at a reused key: every
rebuild gets a new URL, so update `epub` in posts.ts after one.

## The book's face (v2, 2026-11-12)

Order: cover, title page, **Source Library** (what the library is for: `briefs.json` `_source_library`, shared by
every article), **In brief** (`briefs.json`, per article; no entry, no page), contents, the essay, The Sources,
colophon. Public copy in `briefs.json` needs Derek's OK.

- **Ornaments are real woodcuts** from books in the library whose scans may be shared, chosen by eye
  (`ornaments.json`): Vesalius's 1555 initials (Fuchs for B, G, K, Z), Tycho Brahe's headpiece, tailpiece and
  fleuron, Bruno's headpiece for the front matter. `node ornaments.mjs` fetches the gallery crops, cuts each to
  its block and writes `ornaments/<name>.png` as an ink mask (black + alpha) plus `ornaments/contact.png` to
  check by eye; `build.ts` tints them (rust initials, gold ornaments; black on white for `STYLE=bw`). A letter
  with no cut (J, W, X, Y) gets a plain drop cap.
- **The printer's device** (`plates/device.mjs` → SVG → `plates/render.sh` → `ornaments/device.png`) is drawn,
  not a woodcut: the logo's rings in a laurel wreath. It closes the colophon.
- **Plates** (`plates.json`): per-article HTML fragments that close a named chapter. The Sea Road's two-sheet
  route map is drawn by `plates/sea-road-map.mjs` from `public/geo-countries-110m.json`; its numbered key is
  set in type so it stays readable on a phone. Re-render after a change:
  `node plates/sea-road-map.mjs && bash plates/render.sh plates/sea-road-west.svg plates/sea-road-west.png 1400 1300` (and east).
- **An interactive chart** in an article (the Hyperborea timeline) is set as a table of what it shows, read from
  the rendered HTML; no per-article work.
- **Type**: EB Garamond as static TTFs (`fonts/`, instanced from the site's woff2 at weight 400, so Kindle and
  Apple Books both load it), set explicitly on headings; rust headings and links (with
  `-webkit-text-fill-color`, or Apple Books paints links blue); italic only for titles and foreign words; no
  text under 0.9em except spaced capitals; text colour left to the reader's theme so night mode works.
