# Agent tool results — what the model does with what you hand it

**Read this when:** adding or changing a tool the Librarian or the public MCP
server can call (`src/lib/embassy/librarian.ts`, `src/app/api/mcp/route.ts`), or
changing the text a tool returns. Companion to `measurement-instruments.md`
(which is about numbers you quote) — this is about the string a model reads.

---

## A ranker cannot answer a cardinality question

`search` returns the strongest matching passages. That is a top-k list, and a
top-k list cannot answer "how many" or "show me all" **no matter how good the
ranking is** — the shape of the answer is wrong, not its quality.

Until #4154 the Librarian's only view of the catalogue was `search`, so it
answered *"can you find me all the book published in spanish?"* with **5 books**,
assembled from the 8 passages that happened to rank highest, against a shelf of
67 printed in Spanish and 146 a Spanish reader can open. Same failure for "how
many books before 1600", "everything in the astrology collection", "how many
first translations". `browse_catalog` is the second tool that answers those:
filter, exact count, a representative page, and the browse URL.

**When a question class needs a different query shape, give it a different
tool.** Prompt wording cannot make a ranker count.

## Silence in a tool result is an invitation to fabricate

Both defects below were invisible in the code and in the query measurements —
they only appeared in a real turn against a preview deploy. Both are the same
mistake: the result *omitted* something instead of *saying it was absent*.

1. **Rows carried author names but no author URL.** The model wrote
   `https://sourcelibrary.org/es/author/alfonso-x-el-sabio` — wrong twice over:
   the slug was invented, and `/author` has no localized twin, so the `/es`
   prefix 404s on its own. Fix: hand over the resolvable link
   (`books.author_id`, else `authorSlug(book.author)`), always unprefixed.
2. **A filter with no browse page produced no browse line.** The model composed
   `sourcelibrary.org/books?year_to=1599`, a 404. Fix: the result now says *"There
   is NO page that lists exactly this filter. Do not write a browse link for
   it."*

Only `/book/<slug>` links are verified after the fact (`citation-fixes.ts`
rewrites bad book slugs; `LINK_PATTERNS` there does not cover `/author`,
`/collections`, or anything else). **So every non-book URL has to be correct at
the moment the model receives it** — there is no net under it.

Rules that follow, for any new tool:

- Hand over **URLs, never the ingredients of a URL**. A name plus the knowledge
  that `/author/<slug>` exists is a fabrication waiting to happen.
- Emit a URL only when a page shows **exactly** the set you counted. Anything
  narrower gets no link and an explicit "there is no such page" — never a link
  that quietly means something else.
- Locale-prefix a link only if the shape is in `LOCALIZED_PATTERNS`
  (`src/lib/locale-path.ts`). `/book/<slug>` and `/collections/<slug>` have `/es`
  twins; `/author/<slug>`, `/languages/<slug>` and `/browse/*` do not.
- State the absence, out loud, in the words you want the model to obey. "No
  results" beats an empty field; "do not link this" beats no link.

## Count and link must agree

A tool that reports 74 and links a page listing 67 is a worse answer than one
that reports 67. `browse_catalog` resolves a language to the **exact** catalogued
value because that is what `/languages/<slug>` counts, and returns the compound
shelves ("Old Spanish", "Spanish / Latin", "Nahuatl-Spanish") as *named variants
with their own counts* rather than folding them into the total. Same reason the
tenant filter is applied: the number must describe the shelf the reader can
actually reach from the link beside it.

## Verify a tool by running a turn, not by reading the code

`npx tsc --noEmit` passed, the queries were measured correct against production,
and the tool still produced two fabricated 404s the first time a model used it.
Push the branch, let Vercel build the preview, and POST a real question to
`/api/embassy/chat` (`{"message": "...", "lang": "es", "visibility": "private",
"stream": true}` — anonymous is allowed, 5/hour/IP). Then **curl every URL in the
answer**. That is the only step that finds this class of bug.

Note `next dev` cannot stand in for it in a worktree: the shared `node_modules`
symlink points outside the worktree root and Turbopack panics on it
("Symlink [project]/node_modules is invalid, it points out of the filesystem
root"). Preview deploys are the practical loop.
