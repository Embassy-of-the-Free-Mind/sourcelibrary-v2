# Articles: rules for the pages

How an article under `/articles` looks and what goes into it. Read this before writing or editing an article. The structure (categories, list, summaries) lives in `src/app/articles/posts.ts`; this file is about the page itself.

## The page

- **Hero.** Every article has a hero picture: `<ContentHeader feature headerVariant="dark" image=... imageAlt=...>`. `feature` makes it 65vh tall from tablet width up, with a slight parallax. The hero is also the share image (og:image, twitter:image), so pick it for a link preview too: a strong plate or page from the books the article is about, with a calm area where the title sits. Real works only, never generated pictures (the image rules in the `BlogPost.image` comment in `posts.ts` apply).
- **Container.** The article body stays at the standard width (`ContentPageLayout`, default). The overview and the related slider use the wide container; the article does not.
- **Dark bar.** `headerVariant="dark"`, like the book pages.
- **No red text.** Don't use `text-accent-rust` (or any red) for text or links. Links in the article body are styled once, in `globals.css` under `.article-page`: body colour with a thin gold underline that darkens on hover. So write a plain `<Link href=...>` and give it no colour class.
- **What the layout adds for you**, after the article: "Books in this article" (book cards), the outlined footer note (AI disclosure, revision history, suggest an edit), and "Related articles". Don't build any of these by hand.

## Pictures

Articles need a lot of pictures. Text-only articles are boring, and the library is full of pages and plates.

- **A picture in most sections, ideally every one.** It isn't a hard rule: a good, relevant page or plate is worth adding, a weak or loosely related one isn't. Long runs of text with nothing to look at are what to avoid. A picture means something the reader can look at that carries information: a page, a plate, a detail of a plate, a diagram, a map, a screenshot of a tool or a result, a chart.
- **From the library first.** Pages and plates from the books the article quotes, at their true proportions, never cropped to a uniform box. Use `PageFigure` (`src/components/articles/PageFigure.tsx`) with `href` set to the reader page (`/book/<slug>?page=N`) and `source` set to the book.
- **Outside material only when the licence is clear.** Public domain, CC0, CC BY or CC BY-SA, or written permission. Say who holds it, the licence, and link to it, in the `credit` line of `PageFigure`. Museum open-access images already mirrored under `images.sourcelibrary.org/artwork/` are fine (their credit is in the gallery record). If the licence is unclear, leave the image out. Never hotlink: bring the file in with `scripts/import-*-artworks.mjs` or into `public/articles/<slug>/`.
- **Screenshots** of Source Library itself (the reader, a search, a chart) are welcome where they show what the article describes.
- **Alt text** on every picture: what it shows, in a sentence.

## Quotes

- **Quoting a book in the library: show the page.** Use `SourceQuote` (`src/components/articles/SourceQuote.tsx`): the quotation, optionally the original-language text, the source, and the printed page beside it, linked to that page in the reader.
- Quote the library's translation exactly as it stands on the linked page, or the printed English where the book is in English. Say which in the article's source note when it matters.
- A quotation from outside the library is cited in the text (author, work, date) and does not get a page picture.

## Data visualisations

- **Charts and maps make good articles better, and animated or interactive ones better still**: something the reader can scrub, filter, hover or play. Load the `dataviz` skill before building one.
- The data comes from the library (the books, pages, translations, dates, places) or from a cited, openly licensed source. Say where the numbers come from under the chart.
- Existing examples: `DrebbelNetwork` (who knew whom), the Sound Laboratory demos in `src/components/blog/lab/`, `HarmonyVisuals`, the Carbon Ledger charts.
- Charts follow the article rules too: no red, labels in the sans, readable at phone width.

## Books

- **Link every book you draw on** where you mention it (`/book/<slug>` or `/book/<slug>?page=N`). The "Books in this article" grid is built from those links.
- **No "The books" list at the end.** The grid replaces it. A short source note (whose translation, what is cited from outside the library) can stay as a small paragraph.
- A book the article relies on but never links in the text goes in `src/app/articles/<slug>/books.ts` as `EXTRA_BOOKS` (see the Maya article).
- After adding or editing an article: `node scripts/maintenance/generate-article-books.mjs` and `node scripts/maintenance/generate-article-heroes.mjs`. `tests/blog-posts.test.ts` fails if either generated file is stale.

## The listing entry (posts.ts)

- **`summary`**: 110 to 155 characters, one or two sentences, what the article is about and what the reader finds in it, concretely. It is the card text on `/articles` and the meta description. Only facts that are in the article.
- **`kind`**: one of the five categories (Stories, Reading tours, Research notes, Interactive, From the library).
- **`image`**: the card picture; usually the same as the hero.
- Wrap the page's metadata: `export const metadata: Metadata = withArticleMeta('<slug>', { title, description, ... })` (`src/lib/article-metadata.ts`). It fills in the canonical, feed links, article dates and share image.

## Writing

- British spelling (digitised, catalogue, colour).
- Plain words, like a knowledgeable person telling a friend. No em dashes. No marketing words, no rhetorical questions, no closing aphorism: stop when the information stops.
- Every claim traceable to a page in the library or a cited source.

## Checklist before opening a PR

1. Hero set, `feature` and `headerVariant="dark"` on `ContentHeader`; generators re-run.
2. Pictures in most sections; every outside image has a clear licence and a credit line.
3. Quotes from library books use `SourceQuote` with the page.
4. No `text-accent-rust` or other red text in the article.
5. Every book drawn on is linked (or in `books.ts`); no hand-written book list.
6. `posts.ts` entry with `kind`, `summary` (155 characters at most), `image`, `date`, `readTime`.
7. `npx vitest run tests/blog-posts.test.ts` passes.
