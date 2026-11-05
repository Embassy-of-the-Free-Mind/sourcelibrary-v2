---
name: ui-context
description: Load context for UI, frontend, navigation, and analytics work. Use when starting any visual, interaction, or engagement task.
---

# UI Context

Read these files before proceeding with UI work:

1. `memory/ui-navigation.md` — Hydration patterns, book URL rules, analytics
2. `.claude/docs/style-system.md` — Colors, tokens, shared constants
3. `.claude/docs/analytics.md` — Analytics & engagement system
4. `.claude/docs/search.md` — Search system

## Critical Rules

- Always use `bookUrl(book)` for internal links (slug-based). Hex IDs break client nav.
- Never store `/api/image?url=` as `book.thumbnail` — crashes Next.js `<Image>` SSR
- Use `navigator.sendBeacon()` for analytics tracking, never axios
- Wrap `useSearchParams()` in Suspense boundary — triggers BAILOUT_TO_CLIENT_SIDE_RENDERING
- DELETE blocked globally by `src/proxy.ts` safety middleware — use POST-based admin routes

## Staleness Check

After reading the memory files above, flag anything that contradicts what you observe in the codebase:
- File paths or function names that no longer exist
- Behavioral claims that don't match the current code
- If you find contradictions, update the memory file immediately and tell the user what changed.

## Also Relevant

- Schema.org structured data: `.claude/docs/structured-data.md`
- Edition publishing & DOI minting: `.claude/docs/editions.md`
- Social media system: `.claude/docs/social-media.md`
