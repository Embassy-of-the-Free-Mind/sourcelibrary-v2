---
name: metrics
description: One-shot audience & usage report — signups, DAU/MAU, time on-site, traffic, top content, search behavior, referrers, countries, and user journeys. Use when asked "what's our usage?", "how many signups?", "time on site?", "traffic?", or any audience/engagement metrics question.
---

# Metrics Snapshot

Runs the two analytics scripts that together give the full audience + usage
picture, then summarizes the numbers and surfaces qualitative texture. Both read
production Mongo (`bookstore`) — purely read-only, no cost, no permission needed.

> **Live dashboard:** a daily-refreshed version of these numbers (with trends,
> deltas, growth/DAU charts, and a methodology panel) lives at
> https://sourcelibrary.org/platform/admin/metrics (super-admin gated). It reads
> `system_config.metrics_snapshot`, written by `scripts/analytics/snapshot-metrics.mjs`
> on the Hetzner cron (05:45 UTC) and accumulated daily into `metrics_history`.
> Use the scripts below when you need fresher-than-daily numbers, a custom window
> (`--days N`), or the deeper qualitative texture (search chains, journeys) the
> dashboard intentionally omits.

## Run all three (in order)

```bash
set -a; source .env.production.local; set +a
node scripts/analytics/audience-metrics.mjs            # signups, DAU/MAU, dwell, nudge list
node scripts/analytics/usage-deepdive.mjs --days 30    # traffic, content, search, journeys
node scripts/analytics/engagement-metrics.mjs          # retention, conversion, reading depth, demand, social, AI, cost
```

`usage-deepdive.mjs` also writes a dated markdown report to
`scripts/output/analytics/`. All three take `--days N` (default 30) except
reading-depth in engagement-metrics, which is fixed at 7d for query speed.

## What each surfaces

**`audience-metrics.mjs`** — the numbers people ask for first:
- Signups: total, email-verified, has-logged-in, new in 30d / 7d / 24h
- beta_subscribers / newsletter_subscribers counts
- MAU (30d unique fingerprints), avg DAU (14d), last-3-day DAU
- **Time on-site:** median + mean session duration (multi-pageview sessions, 7d)
- Incomplete-signup nudge list size (verification started, never finished)

**`usage-deepdive.mjs`** — the context:
- Daily pageviews (spot spikes — Instagram/EFM pushes show up here)
- Path categories + top 30 books + top collections + library pages
- Referrers (direct / embassyofthefreemind.com / l.instagram.com / search engines / AI bots)
- Countries (US + a strong Spanish-language tail: AR, ES, BR)
- **Search behavior:** top queries, zero-result queries, latency, refinement chains
- User journeys: entry/exit kinds, transitions, bounce rate, funnel

**`engagement-metrics.mjs`** — the dimensions the other two leave out:
- Conversion: visitor→signup rate (~15%), verify % (~43%), ever-logged-in %
- Retention: returning visitors (>1 day, ~25%), returning accounts (login≥2), DAU:MAU stickiness (~11%)
- Reading depth: pages read per reader-book pair — sobering: median=1, ~84% read a single page, deep reads (10+) ~0.2%
- Mission actions: download / share / cite / gate_hit event counts (share & cite are near-zero — flag it)
- Content demand: top `not_found_reports` URLs = what people want and we lack (broken BPH/legacy links + genuinely missing pages)
- Social: likes (count + distinct visitors + by target), feedback (count, unread, wants_to_help)
- AI surfaces: `ai_usage` by feature (librarian / search-expand / voice + cost + latency), `api_usage` by route/identity (the `mcp` route = external agents), distinct active API keys
- Pipeline cost: `gemini_usage_daily` spend (⚠ the daily rollup goes stale when the pipeline is paused — the script flags it; raw `gemini_usage` + `ai_usage` stay current)

## Reporting guidance

Lead with the headline numbers (signups + growth, MAU/DAU, time on-site), then
traffic and top content. **Always add qualitative texture** — the richest signal
is in `usage-deepdive`'s **search refinement chains** (you can read individual
sessions: a HEMA scholar hopping through Fechtbücher → Talhoffer → Liechtenauer;
a Gnostic seeker hitting zero-results on bardo / Iamblichus / Gnostic ascent =
unmet acquisition need).

Caveats to state, not hide:
- **The refinement-chain table is a CROSS-USER aggregate sample, not per-session
  journeys.** Adjacent rows where `to` of one = `from` of the next ARE one
  ip_hash's real sequence, but most of the table stitches unrelated users. Do
  NOT narrate it as one person's trail without pulling that ip_hash's raw rows
  from `search_queries` first (sort by ts). `to_n` is the query's result count,
  and a lone `0` is usually one anomalous search (e.g. Corpus Hermeticum medians
  ~13 results), not a content gap. Verify before storytelling.
- **Sessionization is ip+ua with last-octet-zeroed IPs** — a coarse proxy, not
  true users. DAU/MAU are fingerprints, not accounts.
- **Most zero-result queries are truncated typeahead** (`parace`, `fludd`, `th`)
  logged mid-keystroke — not real content gaps. Only conceptual zero-results
  (bardo, Gnostic ascent) point at genuine missing content.
- Bot filtering is on; bot share is normally ~0%.
- For deeper behavioral signal (scroll, rage-clicks, replays) the source is
  PostHog (EU project 148667) + session replay — gated to ~3% of visitors, good
  for behavior, not absolute counts. Mongo is truth for totals.
```
