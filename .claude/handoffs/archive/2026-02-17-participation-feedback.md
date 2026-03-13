# Participation Hub & Feedback System — 2026-02-17

## What was built

### 1. Participation page (`/contribute`)
Redesigned from a technical "paste your API key" page into a welcoming overview of ways to participate. Plain prose, no cards or icons. Lists:
- Read & annotate
- Correct translations
- Suggest books
- Publish research (links to blog)
- Form research groups
- Process pages (links to `/contribute/process`)
- Build with the API (links to `/developers`)

Ends with a "Get in touch" section showing derek@ancientwisdomtrust.org as plain text (no mailto).

### 2. Contributor processing flow (`/contribute/process`)
The original API-key processing page, now with a generosity-first onboarding:
- Step 1: Pick a tier ("Just curious" $0.25 / "Happy to help" $2 / "Feeling generous" $10 / "Modern-day Medici" $50)
- Step 2: API key + book selection (budget adjustable via number input)
- Step 3: Processing with progress bar

### 3. Feedback system
- **Widget:** `FeedbackWidget` component in footer — modal with textarea + optional name. Auto-captures current page path.
- **API:** `POST /api/feedback` saves to `feedback` MongoDB collection. `GET /api/feedback` lists all.
- **Page:** `/feedback` shows all feedback newest-first with source page linked and "new" badge for unread.
- **Collection schema:** `{ message, page, name, email, ip, user_agent, created_at, read }`

### 4. Footer changes
- Added "Participate" link (to `/contribute`)
- Replaced email address with `FeedbackWidget` button
- Both in SSR fallback and mounted versions

## Files changed
- `src/app/contribute/page.tsx` — rewritten as participation hub
- `src/app/contribute/process/page.tsx` — new, moved processing flow here
- `src/app/api/feedback/route.ts` — new, POST + GET
- `src/app/feedback/page.tsx` — new, feedback viewer
- `src/components/feedback/FeedbackWidget.tsx` — new, footer modal
- `src/components/layout/GlobalFooter.tsx` — added Participate link + FeedbackWidget

## Future work discussed
- **Research groups:** Academic teams working together inside the library (shared annotations, curated reading paths, collective translation review). The participate page invites people to email about this — responses will shape the feature.
- **Blog as research platform:** Featuring papers and essays from community members.
- **MCP server for contributors:** Programmatic access for Claude Code users to do entity resolution, metadata enrichment, etc.
