# Postmortem: Quote Hallucination in MCP/CLI-Assisted Writing

**Date:** March 8, 2026
**Severity:** Medium — published fabricated quotes with valid-looking citations
**Affected:** `/blog/hidden-engineers` article (5 of 13 inline quotes were wrong)

## Summary

The "Hidden Engineers" blog article was written with access to Source Library's MCP tools and/or source-research skill. Despite having the actual translated text available via `get_book_text` and `search_translations`, 5 of 13 inline quotes contained fabricated or inaccurate text presented in quotation marks with page-level citations.

The AI model retrieved the right books and pages, but reconstructed quotes from its parametric memory (training data) instead of copying verbatim from the retrieved text.

## What Went Wrong

### The Failures

| # | Book | Linked Page | Actual Page | Problem |
|---|------|-------------|-------------|---------|
| 1 | Hero, Pneumatica | p67 | p67-68 | "transparent" altar, "globe" for vessel, "Theorem 37" numbering — all from Woodcroft 1851 translation, not Source Library |
| 3 | Della Porta | p542 | p504 | "Hero of Ctesibius, his fire-throwing Tubes" — phrase doesn't exist anywhere in the 624-page book |
| 6 | Theatrum Chemicum | p2 | p303 | Linked to title page (no translation); furnace text is on p303 |
| 9 | Rosenkreuzer | p58 | p58 | Right page, fabricated labels: "Clear hole" vs actual "View hole", "Water or Steam Chamber" vs "Smoke Chamber" |
| 10 | Drebbel | p10 | p12 | Wrong page; quote doesn't appear verbatim anywhere in the 137-page book |

Additionally, all 10 book links used MongoDB `_id` hex strings instead of slugs, causing `?page=N` parameters to be lost on redirect.

### Root Cause: Training Data Contamination of Retrieved Content

The model had access to the actual Source Library translations via MCP tools. But several of these texts also exist in other English translations that are in the model's training data:

- **Hero's Pneumatica** → Woodcroft 1851 translation (Project Gutenberg, widely scraped)
- **Della Porta's Magia Naturalis** → multiple partial English translations exist
- **Drebbel** → various scholarly paraphrases in history of science literature

When asked to produce a quote, the model blended its training knowledge with the retrieved text, producing a confident-sounding quote that was neither the Source Library translation nor any published translation — a chimera of both.

### Why the Tools Didn't Prevent It

1. **No verbatim extraction instruction.** Neither the MCP tool descriptions nor the source-research skill instruct the model to copy text verbatim. The skill says "Get full quotes from relevant pages" and "Present findings with inline citations" — but never says "copy the exact text character-for-character."

2. **`search_translations` returns snippets, not full text.** The search tools return 100-200 char snippets. The model must then call `get_book_text` to get the full page, but the workflow doesn't enforce this second step for every quote.

3. **No quote verification step.** The workflow is search → note page numbers → present findings. There's no step that says "verify your quoted text appears verbatim on the cited page."

4. **`get_book_text` returns up to 50 pages of dense text.** When the model receives 50 pages of 16th-century translated text, it may summarize or paraphrase rather than extract exact passages — especially when it "already knows" what the text says from training data.

5. **Tool descriptions don't warn about this failure mode.** The MCP tool descriptions say nothing about the risk of conflating retrieved content with training data.

## Fixes

### Fix 1: Add verbatim extraction instruction to source-research skill

**File:** `.claude/skills/source-research/SKILL.md`

Add explicit instructions:

```markdown
## CRITICAL: Verbatim Quoting

When presenting text in quotation marks:
- The quoted text MUST appear verbatim in the `get_book_text` response
- NEVER reconstruct quotes from memory — even if you "know" the text
- If you can't find the exact passage, say so — don't approximate
- Copy-paste from the tool response, then trim with ellipses (…)
- If the Source Library translation differs from other known translations,
  use the Source Library version — that's the point of citing it
```

### Fix 2: Add a `get_quote` tool that returns bounded, citable text

**File:** `mcp-server/src/api.ts`, `mcp-server/src/index.ts`

Add a dedicated `get_quote` tool that returns a single page's translation as a short, copy-pasteable block. This is smaller than `get_book_text` (which dumps 50 pages), making verbatim extraction more likely.

The `/api/books/BOOK_ID/quote?page=N` endpoint already exists (referenced in the skill). Expose it as a first-class MCP tool:

```typescript
// New tool: get_quote
{
  name: "get_quote",
  description:
    "Get the exact translated text of a single page for quoting. Returns the full translation text, original OCR text, and a formatted citation. ALWAYS use this tool before putting text in quotation marks — copy the exact text from the response.",
  inputSchema: {
    type: "object",
    properties: {
      book_id: { type: "string", description: "The book ID" },
      page: { type: "number", description: "Page number to quote" },
    },
    required: ["book_id", "page"],
  },
}
```

The tool description itself contains the behavioral instruction: "ALWAYS use this tool before putting text in quotation marks."

### Fix 3: Add citation numbering to source-research skill

Instead of checking "Theorem 37", the skill should instruct the model to use Source Library's own section headings. The skill doesn't currently say anything about how to handle section/theorem/chapter references.

Add to the skill:

```markdown
## Section References

Use the section headings from Source Library's translation, not from other
editions. If the Source Library translation says "The construction of a
mechanism so that when a fire is lit, the doors open automatically", cite
that — don't substitute "Theorem 37" from a different edition.
```

### Fix 4: Add verification hint to `get_book_text` response

**File:** `mcp-server/src/api.ts`, `getBookText()` function

Add a `tip` field to the response:

```typescript
return {
  ...result,
  tip: "When quoting from these pages, copy text verbatim from the translation field. Do not paraphrase or reconstruct from memory.",
};
```

This puts the instruction at the point of use, not just in a skill file that may not be loaded.

### Fix 5: Slug-based URLs in all tool responses

Already fixed in the blog post, but the MCP tools should prefer slugs over IDs in generated URLs. Currently `api.ts` does `r.slug || r.book_id || r.id` — this is correct, but the skill's example uses a hex ID:

```bash
# Current (in SKILL.md)
curl -s "https://sourcelibrary.org/api/books/6836f8ee811c8ab472a49e36/quote?page=57"
```

Should use a slug example instead.

## Priority

| Fix | Effort | Impact | Priority |
|-----|--------|--------|----------|
| Fix 1: Verbatim instruction in skill | 5 min | High — directly addresses root cause | P0 |
| Fix 2: `get_quote` MCP tool | 1 hr | High — structural fix, smaller context = less drift | P1 |
| Fix 3: Section reference guidance | 5 min | Medium — prevents edition conflation | P1 |
| Fix 4: Verification hint in response | 5 min | Medium — defense in depth | P2 |
| Fix 5: Slug examples in skill | 2 min | Low — cosmetic | P2 |

## Lessons Learned

1. **RAG ≠ grounding.** Retrieving the right document doesn't mean the model will use it. When training data contains the same content in a different form (different translation, different edition), the model conflates them. This is especially dangerous for historical texts with multiple translations.

2. **Quotation marks are a contract.** Text inside quotation marks with a page citation is a scholarly claim: "these exact words appear on this page." The tooling must treat this as a verifiable assertion, not a creative writing task.

3. **Smaller context windows for quotes.** `get_book_text` returning 50 pages of dense text invites summarization. A dedicated single-page `get_quote` tool is more likely to produce verbatim extraction because there's less text to get lost in.

4. **The model's confidence is the danger.** The hallucinated quotes read perfectly — correct technical vocabulary, plausible page numbers, authoritative attributions. The failure is invisible without line-by-line verification against the source. This makes it worse than a model that admits uncertainty.

5. **Verify published quotes against sources.** Any article citing Source Library translations should have its quotes checked against the actual page content before publication. This can be automated — a script that extracts all quoted text + page links from a blog post and verifies each against the API.

## Related

- Commit `5b8a0a40`: Fixed 4 fabricated quotes + slug URLs
- Commit `d90411cb`: Fixed Hero Pneumatica quote (Woodcroft contamination)
- Greek manuscript confirmation: Gallica `btv1b10509612q` folios 30-31 (pages 67-68)
