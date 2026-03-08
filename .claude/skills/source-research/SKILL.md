---
name: source-research
description: Search and cite primary sources from Source Library. Use when asked what historical authors wrote, to find quotes from old texts, investigate alchemical or philosophical works, or cite translated Latin/German sources.
---

# Source Research

Search the Source Library collection of translated historical texts and retrieve quotes with citations.

## When to Use

- "What did Drebbel write about..."
- "Find quotes about quintessence"
- "What do historical sources say about..."
- "Cite primary sources for..."

## CRITICAL: Verbatim Quoting

When presenting text in quotation marks:
- The quoted text MUST appear verbatim in the `get_quote` or `get_book_text` response
- NEVER reconstruct quotes from memory — even if you "know" the text from training data
- If you can't find the exact passage, say so — don't approximate
- Copy-paste from the tool response, then trim with ellipses (…) if needed
- If the Source Library translation differs from other known translations (e.g., Woodcroft 1851 for Hero's Pneumatica), use the Source Library version — that's the point of citing it

## Section References

Use the section headings from Source Library's translation, not from other editions. If the Source Library translation says "The construction of a mechanism so that when a fire is lit, the doors open automatically", cite that — don't substitute "Theorem 37" from a different edition.

## API Endpoints

### Search

```bash
curl -s "https://sourcelibrary.org/api/search?q=QUERY"
```

Options: `language=Latin`, `has_doi=true`, `limit=10`

### Get Quote (single page — use before quoting)

```bash
curl -s "https://sourcelibrary.org/api/books/hero-pneumatica-1693/quote?page=68"
```

Returns translation, original text, and citation for ONE page. ALWAYS use this tool before putting text in quotation marks — copy the exact text from the response.

### Get Book Text (multi-page reading)

```bash
curl -s "https://sourcelibrary.org/api/books/BOOK_ID/text?from=1&to=50"
```

Returns up to 50 pages. Use for reading/analysis. When quoting from this response, copy text verbatim.

### Get Book

```bash
curl -s "https://sourcelibrary.org/api/books/BOOK_ID"
```

## Workflow

1. Search for the topic
2. Note book IDs and page numbers from results
3. Use `get_quote` for each page you want to quote — copy text verbatim
4. Present findings with inline citations using the exact text from the response

## Example

```bash
# Search
curl -s "https://sourcelibrary.org/api/search?q=quintessence&limit=5"

# Get quote for citing (always use slug, not hex ID)
curl -s "https://sourcelibrary.org/api/books/drebbel-1628/quote?page=57"
```

## Citing

Use the `citation.inline` from the response:

> "The Fifth Essence, red like a ruby, is immutable." (Drebbel 1628, p. 57)
