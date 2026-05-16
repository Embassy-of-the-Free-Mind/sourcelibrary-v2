# Source Library MCP — launch post drafts

Numbers below match production as of 2026-05-16 (26,735 visible books,
3,901,563 page embeddings, MCP v4.3.0). If you post weeks later, check
`scripts/analyze-search-usage.mjs` for fresh stats and rerun the count
queries from `MEMORY.md` style scripts before posting.

## Twitter / X (256 chars)

> Source Library is now an MCP for Claude. Ask about "distributed cognition" → get real citations from Bruno's *De Umbris*, Cicero's *De Oratore*, Aristotle on the active intellect. 26K pre-modern texts, semantic + keyword search, free, no install.
> sourcelibrary.org/api/mcp

## Bluesky (290 chars, room for more nuance)

> Source Library is now an MCP server. Plug it into Claude.ai and ask about "distributed cognition" — you get back primary text from Bruno's *De Umbris*, Cicero on rhetorical loci, Aristotle on the active intellect, Plato's wax tablet. 26K pre-modern works, free, no install.
> sourcelibrary.org/api/mcp

## Hacker News (Show HN)

**Title:** `Show HN: Source Library – MCP server for 26K rare pre-modern texts`

**Body:**

Source Library is an MCP server that gives Claude (or any MCP-compatible LLM) primary-source search across 26,000+ rare pre-modern texts — alchemical, Hermetic, philosophical, and early scientific works translated into English from Latin, German, Arabic, Greek, and others. Nine tools cover keyword search, conceptual search (Gemini embeddings over 3.9M page embeddings), full-book reading, and stable citation URLs. Hosted, no install, no auth required to start: point your MCP client at https://sourcelibrary.org/api/mcp.

The interesting part for LLM users is the conceptual search lane. Ask about "distributed cognition" and you get back the real ancestors of the modern idea: Bruno's *De Umbris Idearum* on artificial memory, Cicero's *De Oratore* on rhetorical loci, Aristotle on the active intellect, Plato's wax-tablet metaphor from the *Theaetetus*. The Gemini embeddings handle paraphrase, so the modern term doesn't need to appear in the historical text — they map to the historical concept directly.

I built this because I wanted something like arXiv for the period before peer review — a place you can search 16th-century alchemy or 5th-century BC philosophy and get back primary-source citations instead of Wikipedia summaries. Texts are CC-BY-SA. Code at https://github.com/Embassy-of-the-Free-Mind/sourcelibrary-v2. Connect instructions at https://sourcelibrary.org/connect.

## Notes for posting

**Screenshot to include (Twitter/Bluesky/HN):**
- Best: Claude.ai chat showing the MCP returning real passages with citation URLs
- Acceptable: `/connect` page screenshot
- Also good: tools/list response showing the 9 tools

**Show HN tactics:**
- Best post time: weekday morning US Pacific
- Be ready to engage in comments for ~3 hours after posting
- Likely questions and short honest answers:
  - "What was the hardest part?" → translation pipeline at scale; the OCR→translation→embedding chain runs on ~3.9M pages
  - "What's the corpus source?" → digitised public-domain books from Internet Archive, Gallica, e-rara, BSB, etc.; translations are LLM-generated (currently Gemini)
  - "What's the moat against just feeding text to an LLM?" → primary-source citations with stable URLs; the LLM alone hallucinates citations from these obscure works
  - "How fresh is the corpus?" → still actively curated; ~1k books added per month

**Communities beyond Twitter/HN:**
- r/LocalLLaMA — angle: open MCP, works locally
- r/ClaudeAI — angle: Claude.ai integration in 30s
- r/AskHistorians — angle: searchable primary sources
- r/digitalhumanities — angle: scholarly tool
- r/SemanticWeb — angle: semantic search at corpus scale
- Digital humanities newsletters (e.g. DH Now)
- HASTAC, MLA mailing lists
