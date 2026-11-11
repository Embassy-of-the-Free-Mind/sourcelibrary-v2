# Article EPUB: an essay with its sources at the back

`bash scripts/articles/article-epub/build.sh <slug>` builds the EPUB and puts it in R2 at
`article-epubs/<slug>.epub` (EPUBs are never committed: .gitignore), printing its URL. `UPLOAD=0`
skips the upload; `OUT=<path>` keeps a copy. The EPUB is the article, then every library page it links to
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

Then set `epub: { href: <printed URL>, mb }` on the post in `src/app/articles/posts.ts`;
ArticleEnd shows the download link.
