# Agentic Librarian — 2026-04-13

## What was built

Transformed the Reading Room Librarian from a single-shot RAG chatbot into an agentic research assistant with persistent memory.

### Backend (`src/lib/embassy/librarian.ts`)
- **Gemini function calling** via `@google/genai` SDK (was `@google/generative-ai`)
- **7 tools**: search_collection, search_semantic, search_wikipedia, get_book_page, read_nearby_pages, add_to_notebook, present_choices
- **12 tool-calling rounds** (was single-shot RAG)
- **Streaming** via `generateContentStream` — text flows token-by-token
- **Research notebook** — `research_notebooks` MongoDB collection stores findings per thread. Loaded into system prompt so agent builds on prior discoveries.
- **System prompt** instructs agent to: reason first, search strategically, go deep, save findings, suggest next steps. Natural conversation over rigid choice chips.

### API (`src/app/api/embassy/chat/route.ts`)
- Structured SSE events: thinking, tool_call, tool_result, choices, chunk, sources, notebook_update, done, error
- threadId passed through for notebook access
- History validation allows empty content (choices-only responses)

### Notebook export (`src/app/api/embassy/threads/[id]/notebook/route.ts`)
- GET returns formatted markdown: key passages, analytical notes, auto-generated bibliography
- Downloads as .md file
- ?format=json for programmatic access

### Frontend (`src/app/reading-room/ReadingRoomClient.tsx`)
- Structured message model: thinking (collapsible), search steps (checkmarks/X), content, source cards, choices, notebook indicator
- Source cards row below every response (from `sources` array, previously saved but never rendered)
- Dynamic choice chips (rarely used — only for genuine ambiguity)
- Stop button (AbortController)
- "My Conversations" sidebar tab
- "Show more" pagination (5 visible, +10 per click)
- "Export research" link when notebook has findings
- remarkGfm + remarkBreaks for paragraph spacing
- linkifySourceUrls post-processor for bare URLs
- All links open in new tab
- Source Library logo as avatar
- 10,000+ book count

### Threads API (`src/app/api/embassy/threads/route.ts`)
- Added `?mine=true` param for user's own threads

## Key design decisions

1. **Reason-first, search-second** — Gemini uses training knowledge to form hypotheses, then validates with tools. "Hallucination" is hypothesis generation.
2. **English translations as universal search layer** — collection spans 6+ languages but all translated. Semantic search handles cross-language concept mapping.
3. **Natural conversation over choice chips** — Librarian shares thinking as text and searches immediately. Choices only for genuine ambiguity (e.g., "mercury").
4. **Research notebook persistence** — findings accumulate across messages in a thread. Agent doesn't repeat searches.
5. **Page URLs use `?page=N`** format (not `/page/N` which triggers skeleton pages).

## Issues
- #996 — Original agentic librarian design issue (3 detailed comments)
- #1047 — Research agent: persistent context, deep search, export

## PRs merged
#999, #1003, #1004, #1007, #1009, #1012, #1021, #1026, #1043, #1056, #1057, #1058, #1059, #1061

## Known gaps / future work (tracked in #1047)
- **Notebook panel UI** — collapsible sidebar showing accumulated findings
- **"Add to notebook" button** on source cards (user-initiated, not just agent)
- **PDF export** via scholarly-edition pipeline
- **Pretext passages** — manuscript typography for quoted passages (decided against for chat bubbles, maybe for a dedicated passage view)
- **Ghost cards** for books not in the collection
- **Mobile optimization** — chat container height, touch interactions
