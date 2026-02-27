# Analytics & Engagement

## Web Traffic

**Collections:** `analytics_pageviews`, `analytics_events`

### Pageview Tracking
- `POST /api/track` — records path, referrer, country (via Cloudflare headers), IP, user agent
- `PageTracker` component in `src/components/reader/PageTracker.tsx` — auto-tracks on pathname change, included in `src/app/layout.tsx`

### Event Tracking
- `POST /api/analytics/track` — tracks `book_read`, `page_read`, `page_edit` events
- Deduplication: same event + book_id + IP within 1 hour is ignored
- `BookAnalytics` component in `src/components/book/BookAnalytics.tsx` — auto-tracks `book_read` on mount, displays read/edit counts

### Traffic Dashboard
- `GET /api/analytics` — top pages, referrers, countries from `analytics_pageviews` (30-day window)
- `GET /api/analytics/stats` — book-specific or global read/edit counts from `books.read_count`/`edit_count`

### Two Traffic Systems
1. **Google Analytics** (`G-C1QJNTSZT2`) — external, linked from Usage tab summary card. Authoritative for traffic data. Custom events via `sendGAEvent()` in `src/lib/ga.ts`.
2. **Custom `analytics_pageviews`** — internal `POST /api/track`, shown on Traffic tab. Provides quick internal view of top pages, referrers, countries without leaving the app.

Note: Vercel Analytics was removed (Feb 2026) — redundant with GA.

### GA Custom Events
Sent via `sendGAEvent()` helper (`src/lib/ga.ts`), fire-and-forget:

| Event | Source component | Data |
|-------|-----------------|------|
| `book_view` | `BookAnalytics` | book_id |
| `page_read` | `TranslationEditor` | book_id, page_number |
| `search` | Search page | search_term, result count |
| `view_item` | Gallery image detail | image_id |

### API Client
`src/lib/api-client/analytics.ts`:
- `analytics.stats(book_id?)` — fast read/edit counts (used by footer on every page)
- `analytics.usage(days?)` — heavy pipeline/cost analytics (Usage tab, 90s timeout)
- `analytics.loading(hours?)` — performance metrics (Performance tab)
- `analytics.traffic()` — pageview/referrer/country data (Traffic tab)
- `analytics.search(days?)` — search query analytics (Search tab)
- `analytics.track(data)` — log book_read/page_read/page_edit events

---

## Performance Metrics

**Collection:** `loading_metrics`

### Client-Side
`src/lib/analytics.ts`:
- `recordLoadingMetric(name, duration, metadata)` — buffers metrics
- `createLoadingTimer(name)` — start/stop timer helper
- `withLoadingMetrics(fn, name)` — wrap async functions
- Auto-flushes to `POST /api/analytics/loading` every 30 seconds via beacon API
- Anonymous `visitor_id` from localStorage

### What's Measured
- Page load times, component render times
- Web Vitals: LCP, FID, TTFB
- Image load times by source (Blob vs IA): `page_thumbnail_load`, `book_card_image_load`
- OCR/translation processing times

### Dashboard
`GET /api/analytics/loading` — returns count, avg, min, max, p50, p95 per metric name. Time range: 1h, 6h, 24h, 3d, 1w.

---

## User Engagement

### Likes

**Collection:** `likes` (unique index on `target_type + target_id + visitor_id`)

| Route | Purpose |
|-------|---------|
| `POST /api/likes` | Toggle like (atomic deleteOne + conditional insertOne) |
| `GET /api/likes` | Batch fetch like counts |
| `GET /api/likes/popular` | Most liked items with enrichment |
| `GET /api/likes/mine` | User's likes by visitor_id |

Schema: `target_type` (image/page/book), `target_id`, `visitor_id`, `created_at`

### Highlights (UI removed Feb 2026)

**Collection:** `highlights` (indexed on `book_id + page_id`). API routes still exist but no frontend UI.

| Route | Purpose |
|-------|---------|
| `GET/POST /api/highlights` | List and create highlights |
| `GET/PATCH/DELETE /api/highlights/[id]` | Manage individual highlight |

Schema: `book_id`, `page_id`, `text` (selected), `context`, `note`, `color`, `user_name`, `created_at`

### Annotations (UI removed Feb 2026)

**Collection:** `annotations`. API routes still exist but no frontend UI — AnnotationEditor, AnnotationPanel, InlineAnnotations, and HighlightsPanel components were deleted.

| Route | Purpose |
|-------|---------|
| `GET/POST /api/annotations` | List and create |
| `GET/PATCH/DELETE /api/annotations/[id]` | Manage individual |
| `POST /api/annotations/[id]/upvote` | Upvote |

Types: `comment`, `context`, `correction`, `reference`, `question`, `etymology`

Schema: `book_id`, `page_id`, `anchor` (text + offsets), `content` (markdown), `type`, `user_name`, `upvotes`, `parent_id` (threading), `status` (auto-approved), `encyclopedia_refs[]`

---

## Split Detection Feedback

**Collection:** `split_adjustments`

`GET /api/analytics/split-learning` — returns user corrections to AI-detected split positions:
- Average delta (trend left/right)
- Average absolute delta
- Left vs right adjustment counts
- Last 100 adjustments

Schema: `pageId`, `detectedPosition`, `chosenPosition`, `timestamp`

Used as ML feedback loop for improving split detection accuracy.

---

## Experiments & Quality Testing

**Collections:** `experiments`, `comparisons`

### OCR Quality Experiments
Compare model/prompt combinations on sample pages:
- `POST /api/experiments/ocr-quality` — create experiment
- `POST /api/experiments/ocr-quality/[id]/run` — run on sample pages
- `POST /api/experiments/ocr-quality/[id]/judge` — AI judge scores with reasoning
- `GET /api/experiments/ocr-quality/[id]/results` — aggregate results

### Manual Comparisons
Side-by-side A/B ratings:
- `GET/POST /api/comparisons` — list and create ratings (winner: a/b/tie)
- `GET /api/comparisons/stats` — aggregate win rates

Frontend: `/experiments` pages for running and reviewing experiments.

---

## Analytics Dashboard (`/analytics`)

Five tabs:

| Tab | Content |
|-----|---------|
| **Usage** | Books, pages OCR'd, translated, API cost. Pipeline health (splits, enrichment, images, batch jobs). Cost-to-complete estimates. Language/category/source breakdowns. Model/prompt usage. Cost by action/day charts. |
| **Performance** | Loading metrics by name (avg/min/max/p50/p95). Source stats (Blob vs IA). Recent samples. Time range selector. |
| **Logs** | Job list with type/status filters. |
| **Search** | Top queries, zero-result queries (content gaps), searches by source (full/quick/within-book). Days selector. |
| **Traffic** | Top pages, referrers, countries from custom `analytics_pageviews` collection. |

---

## Search Analytics

**Route:** `GET /api/analytics/search?days=30`
**Frontend:** Search tab on `/analytics`

Aggregates `analytics_events` where `event: 'search_query'`. Returns:
- **Top queries** — frequency, avg results, last searched
- **Zero-result queries** — content gaps (what users want but can't find)
- **Searches by source** — global search, quick search (homepage dropdown), within-book search
- **Searches by day** — volume trends with unique query counts

Search queries are logged from three routes: `/api/search`, `/api/search/unified`, `/api/books/[id]/search`.

---

## Not Tracked

- **Feature flags / A/B routing** — only manual experiments via dedicated UI
- **Moderation audit** — annotations auto-approved, no admin approval tracking
- **Per-user sessions** — no login/auth, so no user-level analytics (only anonymous visitor_id)
