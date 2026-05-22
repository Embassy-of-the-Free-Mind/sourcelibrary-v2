# Source Library MCP — launch post drafts

Numbers below match production as of 2026-05-16: ~26,735 books cataloged,
**12,926 with translation in progress** (the actually-searchable count),
3,901,563 page embeddings, MCP v4.3.1. Re-run the count queries before
posting if it's been more than a few weeks (corpus grows continuously).

## Twitter / X (270 chars)

> "distributed cognition" → Bruno's *De Umbris*, Cicero on rhetorical loci, Aristotle on the active intellect.
>
> Source Library: an MCP over 12K rare pre-modern texts translated to English. Theology, philosophy, history, literature, science, mysticism. Free, no install.
> sourcelibrary.org/api/mcp

## Bluesky (300 chars)

> Source Library is now an MCP server. Ask Claude about "distributed cognition" — get back Bruno's *De Umbris*, Cicero on rhetorical loci, Aristotle on the active intellect, Plato's wax tablet. 12K rare pre-modern texts translated to English. Free, no install.
> sourcelibrary.org/api/mcp

## Hacker News (Show HN)

**Title:** `Show HN: Source Library – MCP server for 12K rare pre-modern texts`

**Body:**

Source Library is an MCP server that gives Claude (or any MCP-compatible LLM) primary-source search across 12,000+ rare pre-modern texts translated into English from Latin, German, Tibetan, Greek, Sanskrit, Arabic, Sumerian, Chinese, Hebrew, and more. The corpus covers theology, philosophy, history, literature, natural philosophy, mysticism, alchemy, Hermetica, medicine, mathematics, astronomy, law — the full breadth of pre-modern intellectual history, not only the esoteric flavor. Hosted, no install, no auth required to start: point your MCP client at https://sourcelibrary.org/api/mcp.

Ask about "distributed cognition" and you get back the real ancestors of the modern idea: Bruno's *De Umbris Idearum* on artificial memory, Cicero's *De Oratore* on rhetorical loci, Aristotle on the active intellect, Plato's wax-tablet metaphor from the *Theaetetus*. The Gemini embeddings handle paraphrase, so the modern term doesn't need to appear in the historical text.

Nine tools cover keyword search, conceptual search (~4M Gemini-embedded pages), full-book reading, image search, and stable citation URLs (e.g. `sourcelibrary.org/q/abc123`) for every passage.

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
  - "What was the hardest part?" → translation pipeline at scale; the OCR→translation→embedding chain runs on ~3.9M pages across 15+ source languages
  - "What's the corpus source?" → digitised public-domain books from Internet Archive, Gallica, e-rara, BSB, etc.; translations are LLM-generated (currently Gemini)
  - "What's the moat against just feeding text to an LLM?" → primary-source citations with stable URLs; the LLM alone hallucinates citations for these obscure works
  - "How fresh is the corpus?" → still actively curated; ~1k books added per month, with translations following

**Communities beyond Twitter/HN:**
- r/LocalLLaMA — angle: open MCP, free remote endpoint
- r/ClaudeAI — angle: one-click Claude.ai integration
- r/AskHistorians — angle: searchable primary sources
- r/digitalhumanities — angle: scholarly tool
- r/SemanticWeb — angle: semantic search at corpus scale
- Digital humanities newsletters (e.g. DH Now)
- HASTAC, MLA mailing lists
