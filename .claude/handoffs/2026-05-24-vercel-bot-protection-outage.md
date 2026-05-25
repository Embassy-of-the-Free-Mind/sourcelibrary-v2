# 2026-05-24 — Vercel Bot Protection outage

Short, self-inflicted outage during a memory-cleanup session. Full site returning 403 for ~20 minutes after a Vercel WAF managed-rule flip. Rolled back via API in seconds once detected.

## Timeline (UTC, approximate)

- **~14:08** — PATCHed `bot_protection` from `log` → `deny` via `https://api.vercel.com/v1/security/firewall/config` (Configurable Firewall managed rule). Verified the API response showed the change.
- **~14:15** — Decided to also flip `ai_bots` to `deny` after Derek picked "Block" in a follow-up question.
- **~14:30** — Updated memory + reference docs, told Derek "watch for traffic drops in PostHog over the next 24h" — that was the only post-flip verification I proposed. No curl test was run.
- **~14:35** — Derek: "what in my recent work might have made the site crash?"
- **~14:36** — `curl https://sourcelibrary.org/` returned **403 Forbidden** (Vercel edge ID `fra1::vtb6x-...`). Tested with Chrome UA, Googlebot UA, ClaudeBot UA, empty UA — all 403.
- **~14:37** — PATCHed both rules back to `log` via API. Re-tested: 200 on Chrome UA, 200 on plain curl. Site healthy.

## What I changed

Two PATCH requests against `/v1/security/firewall/config` for project `prj_rUw0rjkXvVbIo7iwqpRTl31sxA8s`:
- `{"action":"managedRules.update","id":"bot_protection","value":{"active":true,"action":"deny"}}`
- `{"action":"managedRules.update","id":"ai_bots","value":{"active":true,"action":"deny"}}`

Both reverted to `action:"log"`.

## Why I thought it was safe

The local `analytics_bot_access` MongoDB collection showed ~376K bot hits over the prior 30 days. ~195K of them were classified as `other-bot` or `unknown-bot` — i.e., user agents the in-app classifier didn't recognise. I read that as "lots of nuisance scraper traffic Vercel's managed Bot Protection will deny." Derek asked "do it" after seeing that breakdown.

What that data did NOT tell us: how Vercel's deny decision is actually made. The local middleware classified bots by **User-Agent string**. Vercel's managed Bot Protection uses **TLS fingerprinting + JS challenges + behavioural signals**, then denies anything that fails. That criteria denies all of:

- curl, wget, server-to-server HTTP, Python `requests`, fetch from any non-browser runtime
- RSS readers, link-preview unfurl bots, monitoring probes
- Some headless browser modes, hardened privacy browsers, atypical TLS stacks
- Probably also the MCP server's outbound traffic if it ever hits sourcelibrary.org

A UA spoof to "Chrome" does **not** pass — fingerprinting catches it. There is no relationship between "log shows 195K bots" and "deny would block 195K bots."

## Impact

- Anyone hitting sourcelibrary.org from a non-browser HTTP client got 403 from ~14:08 to ~14:37 UTC (~30 min window).
- Real browser users were also affected — the Chrome UA test from curl failed, meaning the rule does not exempt by UA. Some fraction of real users with privacy-hardened setups would have hit it.
- No data loss. Nothing in MongoDB or R2 touched.
- No PostHog signal yet — too small a window to confirm by traffic.

## Detection

User-reported. Derek noticed and asked. I had no monitor in place that would have caught this — the only post-flip verification I had proposed was "watch PostHog over the next 24h", which is a lagging indicator, not a circuit breaker.

## What I should have done

1. After the first PATCH (`bot_protection` → deny), curl the homepage with a plain Chrome User-Agent AND with no UA. If either fails, roll back within seconds. Only THEN proceed to the second toggle.
2. Not framed `bot_protection` → deny as "definitely flip to Block" in the recommendation. The log data didn't justify the confidence level.
3. For `ai_bots` specifically — should have noted that even "challenge" effectively blocks AI training crawlers (they don't solve challenges), so the choice is binary log vs no-AI-training, not a three-way trade-off.

## Memory updates

- New: [`feedback-firewall-rule-flip-verify.md`](../../../.claude/projects/-Users-dereklomas-sourcelibrary/memory/feedback-firewall-rule-flip-verify.md) — always curl-test after any Vercel managed-rule flip; includes the exact two curl commands.
- Updated: [`reference-vercel-firewall-api.md`](../../../.claude/projects/-Users-dereklomas-sourcelibrary/memory/reference-vercel-firewall-api.md) — current state marked as `log` post-incident with warning + cross-link.
- MEMORY.md indexed the new feedback entry.

## Open questions / follow-ups

- **Is Bot Protection on `deny` actually safe with extra config?** Vercel docs may support exempting verified bots (Googlebot, Bingbot) or specific IP allow-lists. Worth a dedicated investigation session before any future flip — not in a "quick housekeeping" context.
- **`challenge` vs `deny`?** Same root issue — both rely on fingerprinting. Likely also blocks non-browser traffic. Untested. If we want this, test on a Vercel preview deployment first, not prod.
- **Rate-limit rule from earlier today (`/api/image*`, 60/60s per IP, action: 429) is unaffected.** That's IP-based, not fingerprint-based. Left in place. Same for the broad `/api/*` 300/60s rule from March.
- **Monitoring gap.** No automated check ran "is sourcelibrary.org returning 200 to a plain curl?" between the flip and Derek's report. Worth adding a 5-minute synthetic monitor (could go on Hetzner crontab) that alerts to ntfy if homepage returns non-2xx.

## Net

System is back where it started this morning: `bot_protection` and `ai_bots` both `log`, rate-limit rules in place, no other firewall changes. The only useful thing carried forward is the lesson about why "log data" ≠ "deny safety."
