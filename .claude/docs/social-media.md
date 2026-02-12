# Social Media System

## Overview

AI-powered tweet generation for gallery images with multi-audience targeting, voice styles, research context enrichment, scheduling, and metrics tracking.

## Tweet Generation

### Audiences (7)
| Audience | Focus |
|----------|-------|
| `jungian` | Depth psychology, archetypes, collective unconscious |
| `esoteric` | Western esotericism scholars |
| `arthistory` | Art historians, iconography |
| `philosophy` | History of ideas, Renaissance thought |
| `consciousness` | Consciousness studies |
| `aesthetic` | Visual beauty, poetry |
| `general` | Educated general audience |

### Voice Styles (5)
`scholarly` (curious academic), `provocative` (challenging question), `aesthetic` (beauty/poetry), `mysterious` (intrigue), `contextual` (educational)

### Generation Flow
1. Select image via `selectImagesForPosts()` in `src/lib/social-image-selector.ts`
2. Fetch research context: page translation, adjacent page, book overview, themes, quotes, section summary
3. Call `generateTweetVariations()` in `src/lib/tweet-generator.ts` with audience/voice combos
4. AI produces: tweet text (< 200 chars), hashtags, reasoning
5. `buildFullTweetText()` combines tweet + hashtags + gallery link (≤ 280 chars)

### Image Selection Scoring
```
base = gallery_quality * 50
+10 rich metadata (subjects/symbols/figures)
+15 museum description (50+ chars)
+10 interesting type (emblem/engraving/frontispiece)
+5  high confidence (≥ 0.8)
max: 90 points
```
Excludes recently posted (30 days), diversifies by book (max 1 per book).

## Routes

| Route | Purpose |
|-------|---------|
| `POST /api/social/generate` | Generate tweet variations for one image |
| `POST /api/social/generate/batch` | Generate tweets for top N images |
| `GET/POST /api/social/posts` | List and create posts |
| `POST /api/social/posts/[id]/publish` | Manually publish a post |
| `GET/PATCH /api/social/config` | Configuration (posting hours, rate limits) |

## Scheduling & Posting

### Crons (vercel.json)
| Path | Schedule | Purpose |
|------|----------|---------|
| `/api/cron/social-post` | Every hour | Post queued tweets |
| `/api/cron/social-reset` | Daily midnight UTC | Reset daily counter |

### Posting Logic
1. Check `auto_post_enabled` and current hour in `posting_hours`
2. Respect daily limit (default: 2 posts/day)
3. Find next queued post (prioritize `scheduled_for <= now`)
4. Post to Twitter API with image
5. Update record: status → `posted`, set `twitter_id`, `twitter_url`
6. Increment usage counters

## Database

### `social_posts` collection
```
id, tweet_text, hashtags[],
image_ref: { page_id, detection_index, gallery_image_id },
image_data: { cropped_url, description, book_title, book_author, book_year },
status (draft|queued|posted|failed), scheduled_for,
generated_by: { model, generated_at, alternatives[], research_notes },
posted_at, twitter_id, twitter_url, error,
metrics: { impressions, likes, retweets, replies, url_clicks, fetched_at },
created_at, updated_at
```

### `social_config` collection (singleton)
```
settings: { posts_per_day, posting_hours[], auto_post_enabled, min_gallery_quality },
usage: { tweets_today, tweets_this_month, last_tweet_at }
```

### `social_tags` collection
```
handle, name, audience, description, followers, relevance, active, priority (1-10)
```
