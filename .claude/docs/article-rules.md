# Articles: rules for the pages

How an article under `/articles` looks and what goes into it. Read this before writing or editing an article. The structure (categories, list, summaries) lives in `src/app/articles/posts.ts`; this file is about the page itself.

## The page

- **Hero.** Every article has a hero picture: `<ContentHeader feature headerVariant="dark" image=... imageAlt=...>`. `feature` makes it 70vh tall from tablet width up, with a slight parallax. The hero is also the share image (og:image, twitter:image), so pick it for a link preview too: a strong plate or page from the books the article is about, with a calm area where the title sits. Real works only, never generated pictures (the image rules in the `BlogPost.image` comment in `posts.ts` apply).
- **Container.** The article body stays at the standard width (`ContentPageLayout`, default). The overview and the related slider use the wide container; the article does not.
- **Dark bar.** `headerVariant="dark"`, like the book pages.
- **No red text.** Don't use `text-accent-rust` (or any red) for text or links. Links in the article body are styled once, in `globals.css` under `.article-page`: body colour with a thin gold underline that darkens on hover. So write a plain `<Link href=...>` and give it no colour class.
- **What the layout adds for you**, after the article: "Books in this article" (book cards), the outlined footer note (AI disclosure, revision history, suggest an edit), and "Related articles". Don't build any of these by hand.

## Pictures

Pictures carry a lot of these articles, but only when they add something. Decide section by section.

- **A picture where it adds something, not by quota.** Most sections gain from one: the page being quoted, the plate being described, a diagram that shows what the text explains, a chart of the numbers. Add it when the reader learns something from looking at it that the text alone doesn't give them.
- **Leave it out when it adds nothing.** A section that argues, explains a method or tells a short step in a story may be better as text. Signs a picture is filler: it is loosely related ("a page from around then"), it repeats the one just above, it is there so the section isn't bare, or the caption has to work hard to explain why it is there. Two or three pictures in a row that make the same point should be one.
- **Long runs of text are still worth breaking up**, but with the right picture, a short quotation or a subheading, not with any picture.
- A picture means something the reader can look at that carries information: a page, a plate, a detail of a plate, a diagram, a map, a screenshot of a tool or a result, a chart.
- **From the library first.** Pages and plates from the books the article quotes, at their true proportions, never cropped to a uniform box. Use `PageFigure` (`src/components/articles/PageFigure.tsx`) with `href` set to the reader page (`/book/<slug>?page=N`) and `source` set to the book.
- **Outside material only when the licence is clear.** Public domain, CC0, CC BY or CC BY-SA, or written permission. Say who holds it, the licence, and link to it, in the `credit` line of `PageFigure`. Museum open-access images already mirrored under `images.sourcelibrary.org/artwork/` are fine (their credit is in the gallery record). If the licence is unclear, leave the image out. Never hotlink: bring the file in with `scripts/import-*-artworks.mjs` or into `public/articles/<slug>/`.
- **Screenshots** of Source Library itself (the reader, a search, a chart) are welcome where they show what the article describes.
- **Alt text** on every picture: what it shows, in a sentence.

### Image size and weight

- **Always show pictures through `PageFigure` or `SourceQuote`** (both use `ArticleImage`): they go through the image optimiser, so a 500 KB page scan arrives as a 30 to 80 KB AVIF or WebP at the width it is shown. Don't write a bare `<img>` in an article.
- A picture from a host the optimiser can't fetch from falls back to the original file. If you use a new outside host often, add it to `images.remotePatterns` in `next.config.ts` and to `OPTIMISABLE` in `src/components/articles/image-hosts.ts`.
- **Files you add to `public/articles/<slug>/`:** JPEG at quality 80, longest side at most 2,000 px (2,400 for a map that needs the detail), progressive. PNG only for diagrams with flat colour or transparency. Aim under 400 KB.
- **Over about 60 megapixels the optimiser gives up** and sends the original untouched (a 6,800 × 10,100 scan arrived as 5 MB). Some archived masters are that big. Bring those into `public/articles/<slug>/` at 2,000 px instead; `generate-article-image-sizes.mjs` lists any it finds.
- **Pictures hold their place and fade in.** After adding or changing pictures, run `node scripts/maintenance/generate-article-image-sizes.mjs --base http://localhost:<port>` against your dev server: it records each picture's size and a tiny blurred copy, so the page keeps the picture's space while it loads instead of jumping. A picture missing from that file still works, it just doesn't reserve its space.
- **Crop to the picture, not off the notice.** Never crop out a copyright or provenance notice printed on a scan (for example the Early European Books / ProQuest line). Keep it on the image and repeat it in the `credit` line.
- **Tall single pages:** hold them to a reading width (a `max-w-md` or `max-w-lg` wrapper) so one page doesn't fill the screen.

## SEO

Most of this is automatic once the page wraps its metadata in `withArticleMeta`; the parts that need a person:

- **Title:** says what the article is about in plain words, ideally under 60 characters before the " - Articles - Source Library" suffix. Unique across the site.
- **`summary`** (posts.ts) is the meta description and the card text: 110 to 155 characters, concrete, with the names a reader would search for (people, books, places, dates).
- **One H1** (the hero title); sections as H2, sub-sections H3, in order. The contents panel is built from the H2s.
- **Alt text** on every picture, and an `imageAlt` on the posts.ts entry: what the picture shows, in a sentence.
- **Links:** relative (`/book/...`, `/articles/...`), never `https://sourcelibrary.org/...` (the tenant lockdown rule). Link the books and other articles where they are mentioned, with words that say what the target is, not "here".
- **Hero image** is the share image: a strong picture that still reads when cropped to 1200 × 630.
- **Automatic, don't hand-write:** canonical, Open Graph and Twitter tags, article dates, feed links, Article and breadcrumb JSON-LD, sitemap entry, share-image resizing. A page that sets its own `openGraph` or `alternates` still gets these through the helper.
- **Withdrawn or superseded pages:** add the slug to `UNLISTED_PAGES` and to `NOINDEX_SLUGS` in `src/lib/article-metadata.ts`; consider a redirect to the successor.

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

## Length

An article should be readable in one sitting. Most of ours run 8 to 12 minutes, and that is the range to aim for.

- **Aim for 8 to 15 minutes** (about 2,000 to 3,500 words). The `readTime` in posts.ts should be honest.
- **Over about 20 minutes (5,000 words), don't keep writing.** Suggest splitting it: two or more separate articles that each answer one question, or a series with a part number in the title and links between the parts. Propose the split (where it falls, what each part is called) and ask before doing it.
- **Cut before you split.** Long articles usually repeat themselves: the same point made in the lede, the body and the close; background the reader doesn't need; three examples where one does. Take those out first.
- Interactive pieces (a timeline, a game, a chart to explore) are measured by the reading, not by the size of the tool.

## Writing

- British spelling (digitised, catalogue, colour).
- Plain words, like a knowledgeable person telling a friend. No em dashes. No marketing words, no rhetorical questions, no closing aphorism: stop when the information stops.
- Every claim traceable to a page in the library or a cited source.

## What the tests enforce

`tests/blog-posts.test.ts` fails the PR if: a post has no category, summary (155 characters at most,
no em dash), card picture or alt text; an article lacks the `feature` + `headerVariant="dark"` hero or
the `withArticleMeta` wrapper; `src/generated/article-books.json` or `article-heroes.json` is stale; or
more article files carry `text-accent-rust` than the ratchet allows (lower the number when you clean
one). The rest of this file (which pictures are worth it, length, quotes with their pages, licences, charts, wording) needs a person.

## Checklist before opening a PR

1. Hero set, `feature` and `headerVariant="dark"` on `ContentHeader`; generators re-run.
2. Every picture earns its place (none added just to fill a section); every outside image has a clear licence and a credit line.
   Length 8 to 15 minutes; over about 20, a split into separate articles or a series is proposed instead.
3. Quotes from library books use `SourceQuote` with the page.
4. No `text-accent-rust` or other red text in the article.
5. Every book drawn on is linked (or in `books.ts`); no hand-written book list.
6. `posts.ts` entry with `kind`, `summary` (155 characters at most), `image`, `date`, `readTime`.
7. SEO: title under 60 characters, summary 110 to 155, alt text on every picture and on the posts.ts entry, relative links.
8. Pictures through PageFigure / SourceQuote; any new file in public/articles under 400 KB and 2,000 px; notices on scans left intact; `generate-article-image-sizes.mjs` re-run.
9. `npx vitest run tests/blog-posts.test.ts` passes.
