# Teaching AI to Cite Primary Sources: How Source Library Works

*How we built an API that lets Claude research 17th-century alchemical texts and cite them properly.*

---

## The Problem

Large language models hallucinate. Ask Claude about what Cornelius Drebbel wrote in 1628 about the "fifth essence," and you'll get a plausible-sounding answer that may or may not reflect what's actually in the book.

We wanted something different: an AI that could search a library of translated historical texts, retrieve actual quotes, and provide proper academic citations—complete with DOIs.

## The Solution

Source Library provides two APIs that work together:

1. **Search API** - Full-text search across books and translations
2. **Quote API** - Retrieve specific passages with formatted citations

These same endpoints power both the web interface and an MCP server for Claude Desktop.

## How It Works: A Real Example

Let's trace a real research query: *"What experiments did Drebbel report on regarding the quintessence?"*

### Step 1: Search

```bash
curl "https://sourcelibrary.org/api/search?q=quintessence"
```

Returns matches across all translated texts:

```json
{
  "query": "quintessence",
  "total": 15,
  "results": [
    {
      "id": "6836f8ee811c8ab472a49e36-p45",
      "type": "page",
      "book_id": "6836f8ee811c8ab472a49e36",
      "title": "Tractatus duo. De natura elementorum. De quinta essentia",
      "display_title": "Two Treatises: On the Nature of Elements & On the Fifth Essence",
      "author": "Drebbel, Cornelius",
      "published": "1628",
      "page_number": 45,
      "snippet": "CORNELIUS DREBBEL, A BELGIAN, Later Treatise ON THE QUINTESSENCE, Its powers, use, & how it can be extracted from Minerals, Metals, Vegetables, and Animals..."
    }
  ]
}
```

The search finds the relevant book and specific pages mentioning the term.

### Step 2: Get the Quote

```bash
curl "https://sourcelibrary.org/api/books/6836f8ee811c8ab472a49e36/quote?page=57"
```

Returns the full translation with the original Latin and formatted citations:

```json
{
  "quote": {
    "translation": "CHAPTER V. Two ways of preparing the Fifth Essence from Gold.\n\nLet aqua fortis be made from vitriol and salt petre, and into it put as much prepared common salt as it can hold. Then let gold leaf be saturated, until, kept warm for three or four days, it absorbs no more...",
    "original": "CAPVT V. Duo modi parandi Quintam Eſſentiam ex Auro. Fiat aqua fortis ex vitriolo & ſale nitro...",
    "page": 57
  },
  "citation": {
    "inline": "(Drebbel 1628, p. 57)",
    "footnote": "Cornelius Drebbel, Two Treatises: On the Nature of Elements & On the Fifth Essence, trans. Source Library (2025), 57. DOI: 10.5281/zenodo.18053504.",
    "doi_url": "https://doi.org/10.5281/zenodo.18053504"
  }
}
```

Now we have:
- The actual text from the book
- The original Latin for verification
- A proper academic citation with DOI

### Step 3: Verify

The response includes the original Latin OCR, so claims can be verified:

> **Translation**: "Let aqua fortis be made from vitriol and salt petre"
>
> **Original**: "Fiat aqua fortis ex vitriolo & sale nitro"

This bidirectional linking means AI-generated summaries can always be traced back to source text.

## What We Learned About Drebbel

Using this workflow, we discovered that Drebbel's 1628 treatise contains detailed experimental procedures:

**Preparing Quintessence from Gold (Chapter V):**
1. Make *aqua fortis* (nitric acid) from vitriol and saltpeter
2. Saturate with common salt
3. Dissolve gold leaf, keep warm 3-4 days
4. Add rectified spirit of wine (alcohol)
5. Heat in furnace—the tincture floats on top, "red like blood"

**From Minerals (Chapter VI):**
- Dissolve in distilled vinegar
- Repeated crystallization cycles
- Digest to blackness

**From Plants (Chapter VII):**
- Distill aromatic herbs
- Separate spirit from water
- Combine with tincture

**Tests for Success (Chapter II):**
- Dissolve in pure alcohol—should show "copious humidity"
- When dissolved in water to saturation: resists freezing
- Resists putrefaction indefinitely

In modern terms, Drebbel was doing acid dissolution, solvent extraction, fractional distillation, and crystallization. The "red like blood" gold tincture was likely colloidal gold. His procedures are real chemistry; his explanations are pre-scientific.

## The MCP Server

For Claude Desktop, we provide an MCP server with three tools:

| Tool | Purpose |
|------|---------|
| `search_library` | Search across all books and translations |
| `get_quote` | Get a specific passage with citations |
| `get_book` | Get book metadata and structure |

Configuration for Claude Desktop:

```json
{
  "mcpServers": {
    "source-library": {
      "command": "node",
      "args": ["/path/to/mcp-server/dist/index.js"],
      "env": {
        "SOURCE_LIBRARY_API": "https://sourcelibrary.org/api"
      }
    }
  }
}
```

Once configured, Claude can autonomously search the library, retrieve quotes, and cite sources—without hallucinating content.

## API Reference

### Search

```
GET /api/search?q=<query>
```

Parameters:
- `q` (required) - Search query
- `language` - Filter by original language (Latin, German, etc.)
- `date_from`, `date_to` - Publication year range
- `has_doi` - Only books with DOIs
- `has_translation` - Only books with translations
- `limit`, `offset` - Pagination

### Quote

```
GET /api/books/<id>/quote?page=<n>
```

Parameters:
- `page` (required) - Page number
- `include_original` - Include original language text (default: true)
- `include_context` - Include adjacent pages

### Book

```
GET /api/books/<id>
```

Returns full book metadata including page count, edition info, and DOI.

## Why This Matters

Historical research requires citations. When an AI claims "Drebbel described dissolving gold in aqua fortis," you need to know:

1. Is that actually in the text?
2. What page?
3. How do I cite it?

Source Library answers all three. The AI becomes a research assistant that can search a specialized library and provide verifiable, citable quotes—not a black box that generates plausible-sounding text.

## Try It

- **Search UI**: https://sourcelibrary.org/search
- **API**: https://sourcelibrary.org/api/search?q=quintessence
- **MCP Server**: See `/mcp-server/README.md`

---

*Source Library is an open project for translating and publishing historical texts with proper academic infrastructure. All editions include DOIs via Zenodo.*
