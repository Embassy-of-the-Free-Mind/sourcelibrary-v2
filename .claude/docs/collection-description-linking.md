# Linking books from a collection description

**Read this when** you write or edit a collection's `description` or
`expanded_description` — in `/curator`, `/library-curator`, `/curate-collection`, or by
hand. This is the single source of truth for how those strings become links; the skills
route here rather than restating it.

**The rule: every work you name in a collection description must be clickable.** These
pages are public-facing copy on a site whose whole point is navigation between primary
sources. Prose that names ten books and links none of them is a dead end — the reader
has to go back to the grid and hunt. Naming a book you hold and not linking it is the
one failure mode worth checking for every single time.

## What the renderer actually does

`src/app/collections/[id]/page.tsx` splits the description on `\n\n` into `<p>`s and
runs each paragraph through `linkBookTitles()`. That function handles exactly three
things, in priority order:

1. **Inline markdown links** — `[anchor text](/book/some-slug)`. Honored since #3040.
   **Internal hrefs only**: the href must start with `/`. An absolute
   `https://sourcelibrary.org/book/...` is **not** matched and renders as literal
   `[brackets](and-parens)` on the page. So does a `javascript:` or off-site href —
   that restriction is deliberate, this is admin-authored prose rendered unescaped.
2. **Explicit `mentioned_books`** — `{ text, book_id }` pairs on the collection doc,
   matched case-**in**sensitively, longest `text` first so a long-form claim ranges
   before a short-form fallback.
3. **Auto-detection** — a book's `title` or `display_title` (≥8 chars) found as an exact
   substring of the description, plus author names resolved against the collection's
   author list.

Emphasis IS parsed as of 2026-09-04 (`src/lib/inline-prose.tsx`): `*italic*`,
`**bold**`, and inline `<em>`/`<strong>`/`<i>`/`<b>` all render. Before that they
appeared verbatim to readers — `<em>Corrector</em>` was on the live
`forum-of-conscience` page — which is why this doc used to say "don't write them".
`_underscore_` is deliberately NOT emphasis (underscores are common in slugs), and
every other tag stays escaped: the whitelist is parsed into React elements, never
injected as HTML. Everything outside links and emphasis is plain text.

### Why auto-detection is not enough

Auto-detection searches for the *full book title* inside your prose. Real titles here
are long early-modern Latin ones (`Micrographia, or Some Physiological Descriptions of
Minute Bodies…`), and good prose names the short form (`Micrographia`). The long string
is not a substring of the short one, so the match fails. **Assume a named work does not
auto-link unless you have checked it.** That is exactly how the microscopy collection
shipped with a description naming eleven works and linking none (#1867).

## What to write

Prefer **inline markdown links** — the anchor is explicit, it survives a later rewrite
of the prose, and there is no second field to keep in sync:

```
This collection opens with Cesi and Stelluti's [Apiarium](/book/apiarium-1625), the
single broadside that produced the first printed image made through a microscope, and
tracks the field through Hooke's [Micrographia](/book/micrographia-1665).
```

Use `mentioned_books` instead when the same short name recurs across several paragraphs
and you want every occurrence linked without repeating the markdown, or when you are
patching link coverage onto prose you do not want to rewrite.

- **Path form:** `/book/<slug>`, using the book's real `slug` from Mongo. `/book/<id>`
  works too (the proxy 301s it), but it publishes an unreadable URL and costs a hop —
  use the slug. Never guess a slug; read it back from the books you tagged.
- **Deep links are fine:** `/book/<slug>/page/<pageId>` for a specific plate or passage.
- **No absolute URLs.** See above — they render as literal brackets.
- **Placeholder for an unresolved link:** if you are sketching prose before the import
  lands, write `[Title](TODO)` so the gap is obvious. `TODO` does not start with `/`, so
  it renders as visible literal text rather than a silent dead reference — that is the
  point. **Never ship a description containing `TODO`.**

## Verify before you ship

Reading back the book ids you just tagged is the whole check:

```bash
# Slugs for every book in a collection (manifest mode — no pagination)
curl -s "https://sourcelibrary.org/api/collections/SLUG?mode=manifest" \
  | jq -r '.books[] | "\(.slug // .id)\t\(.display_title // .title)"'
```

Then, on the live page: every work named in the intro is rust-coloured and clickable,
no stray `[`, `]`, `*`, or `TODO` is visible, and each link lands on the right book.

## Scope

- Applies to `description` and `expanded_description` on `collections` documents.
- The collection page body parses the links; the JSON-LD `description` and the
  `generateMetadata` meta/og description flatten them to anchor text via
  `stripMarkdownLinks()`. Any *new* plain-text consumer of these fields must do the same.
- **Don't retro-rewrite existing descriptions as a side effect** of other work. Adding
  links to a collection you are already curating is fine and welcome; a bulk sweep over
  hundreds of hand-tuned intros is its own reviewed change.

Prose style for the intro itself (the three-part structure, the banned framings) is a
separate doc: `.claude/docs/collection-intro-writing-rules.md`.
