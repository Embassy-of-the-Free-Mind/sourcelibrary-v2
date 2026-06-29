---
name: collection-quotes
description: "Use this skill to choose and VERIFY the short cycling source quotes that fill a collection page's quote band (the dark, parallax passage section, e.g. QuoteBlock on the collection redesign). Trigger for any request to find, pick, add, or refresh the 2–4 key quotes for a collection. Every quote must be a real, page-exact passage from a book in that collection, copied verbatim and linked to its exact page — never paraphrased, never from memory, never an AI editorial annotation. Quotes are the original author's words; the surrounding curation is not."
---

# Collection Quotes

The quote band on a collection page cycles through a handful of short passages drawn from the collection's own books. Done right, it is the most persuasive section on the page: the sources speaking in their own voice. Done wrong, it fabricates citations, which is the single worst failure mode on Source Library (see the "mercury on page 89" misquote, PRs #2232/#2233, and the cannabis-essay corrections, #2584/#2587).

**Default output: 3 quotes** (2 minimum, 4 maximum — the band cycles, more than 4 dilutes). For an **artwork-only collection** (no readable OCR text) there is nothing to quote — omit the band entirely; do not invent an atmospheric line dressed as a quote.

## The one inviolable rule

**Every quote is verbatim source text, verified page-exact before it ships.** No exceptions.

- Copy the words exactly. Never paraphrase inside quote marks, never transcribe from memory, never quote a search snippet or a scholar's retelling as if it were the source.
- **Never quote an editorial annotation.** OCR/translation page text is wrapped in AI-written blocks (`<meta>`, `<summary>`, `<keywords>`, `<vocab>`, `<scan-quality>`, `<page-type>`, `<warning>`, …) that *describe* the page and routinely mention content from adjacent pages. They are not the source. Always run candidate text through `stripEditorialWrappers()` (`src/lib/strip-editorial-wrappers.ts`) — which knows both wrapper families — and quote only what survives. Inline glosses and real page marks (`<note>`, `<margin>`, `<header>`, `<catchword>`) are body text and may stay.
- **Every quote links to its exact page**, using the page **id**, not the page number: `/book/<slug>/page/<pageId>`. A page-*number* URL is a soft-404 that returns HTTP 200 with a "Page Not Found" body. Get the id from the verification step.

## How to verify (in order of preference)

1. **`get_quote` MCP tool** — the canonical path. Give it the book + page; it returns wrapper-stripped, page-exact text plus a citation URL (with the correct pageId). Built for exactly this. Use it whenever the Source Library MCP server is connected.
2. **The quote API on a running deployment** — `GET /api/books/<bookId>/quote?page=<n>&include_original=true`. Same `stripEditorialWrappers` path, returns `quote.translation`, `quote.original`, and a citation `url`/`short_url`. Use a preview/prod URL when the MCP tool isn't wired into the session.
3. **Direct Mongo read + strip** — read `pages.{translation,ocr}.data` for the chosen page, run it through `stripEditorialWrappers()`, and build the link from `pages.id`. Use only as a last resort, and re-read the stripped output to be sure no annotation prose slipped through.

If you cannot verify a passage, do not use it. A thinner band of three solid quotes beats four where one is unconfirmed.

## Finding good candidates

Verification proves a quote is real; it does not make it *good*. Selection is the judgment part.

1. **Pick the source works first.** The featured work, plus a few notable members spread across **different authors, languages, and eras** so the band has range. A collection's first-translations are strong candidates: the passage is readable and the work is a headline.
2. **Read the actual text** (translated page data, or OCR for untranslated works) to find passages — don't guess which page is good. Skim for moments that are vivid, self-contained, and representative of what the collection is *about*.
3. **Shortlist more than you need** (6–8), then verify and cut to the best 3.

### What makes a quote worth showing
- **Self-contained.** Reads on its own, out of context. No dangling "as we said above," no mid-sentence fragment.
- **Characteristic.** It captures the collection's subject or spirit — a claim, an image, a moment of observation or argument that only this tradition would produce.
- **Short.** One to three sentences. Trim with care; never alter words to fit. An ellipsis for an internal cut is fine if the meaning is preserved.
- **Diverse as a set.** Different works, ideally different languages and centuries. Avoid three quotes from the same book.
- **Prefer an original + translation pair.** When the work is non-English, include both: the band shows the original beneath the translation. Verify both halves (the original comes from the OCR side, the translation from the translation side).

### Avoid
- Pure catalog/bibliographic lines, dedications, page furniture, printer's notes.
- Anything disturbing or quoted out of a context that flips its meaning.
- The most over-anthologised line if a fresher passage from the same work is just as strong.

## Output shape

Return the quotes ready to drop into the band component (`QuoteBlock` `quotes={[…]}`):

```ts
{
  translated: 'The exact English passage, verbatim and wrapper-stripped.',
  original: 'The exact source-language passage (omit for English-native works).',
  language: 'Latin',                       // source language
  attribution: 'Author, Short Title, Year', // human-readable, from the book record
  href: '/book/<slug>/page/<pageId>',       // exact page, page ID not number
}
```

Also pick the band's background image with the **`quote-background-image`** skill, and keep the band's image credit pointing at a real gallery image.

## Checklist before it ships
- [ ] Every quote verified page-exact (get_quote / quote API / strip), not from memory.
- [ ] Ran through `stripEditorialWrappers` — no `<meta>`/`<summary>` prose, no adjacent-page bleed.
- [ ] Each `href` uses the page **id** and loads a real page (grep the response for "page not found", don't trust the 200).
- [ ] 2–4 quotes, spread across works/languages/eras, each self-contained.
- [ ] Original-language text included for non-English works, and itself verified.
- [ ] Artwork-only collection → band omitted, not faked.
