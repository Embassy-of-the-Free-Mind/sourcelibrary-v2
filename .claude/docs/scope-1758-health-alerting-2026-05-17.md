# Scope: Issue #1758 — Proactive Health Alerting
**Date:** 2026-05-17
**Author:** Claude Code (scoping pass, no code written)

---

## 1. Staleness verdict: FRESH — work not started

- `gh issue view 1758 --json closedByPullRequestsReferences` → `[]`. No PRs linked or closing.
- `git log --all --oneline --since=2026-05-10 | grep -iE 'session.*start|health|canary|alert|probe'` → no matches. No alerting commits have landed since the incident.
- `ls scripts/ops/` → directory does not exist. `rg "SessionStart" .claude/` → no results. No hook or ops script has been created.
- PR #1757 (loader hardening) is **merged**. That was the acute fix. #1758 is the prevention follow-up and is entirely unimplemented.

**Active gap confirmed right now:** `uptime-monitor.mjs` runs every 5 min on Hetzner and checks `api/health` and `api/books?limit=1` via the `.vercel.app` bypass URL. It does NOT check any tenant embed. A live test from Hetzner during this scoping pass shows `/embed/bph` at **3.3s** (above the proposed 3s SLO) while `/embed/ficino` is 145ms. The gap exists today.

---

## 2. Existing infra inventory

| Asset | Location | What it does | Alert channel | Gap |
|---|---|---|---|---|
| `scripts/uptime-monitor.mjs` | Hetzner, cron `*/5` | Checks `/api/health` + `/api/books?limit=1` via `.vercel.app`; logs to MongoDB `uptime_checks`; sends ntfy.sh on failure with 1h cooldown | ntfy.sh topic `sourcelibrary-uptime` | No tenant embed coverage; no latency SLO (binary up/down only) |
| `scripts/workers/pipeline-health-alert.mjs` | Hetzner, cron `0 7` daily | Checks OCR throughput, Gemini storage, stuck jobs, orphan books | Resend email (key not in Hetzner env) + cron log | Daily cadence only — misses hour-scale embed regressions |
| `telegram-claude-bridge.service` | Hetzner, running as `claude` user | Telegram bot bridging messages to Claude Code | Telegram (interactive only) | No push-alert capability; no CHAT_ID env for programmatic sends |
| `/api/admin/cache-probe` POST | Hetzner cron `30 5` daily | Warms Cloudflare cache | — | Monitoring-adjacent, not alerting |

**Key finding:** ntfy.sh is the live alert channel. The Telegram bot is interactive, not push-capable without knowing the chat ID. No Slack, no Resend key active on Hetzner. For new alerts, extend the existing ntfy.sh pattern in `uptime-monitor.mjs`.

---

## 3. What endpoints to probe

All probes must use `.vercel.app` URLs to bypass Cloudflare's JS challenge — Hetzner IPs get 403 on `sourcelibrary.org` directly (documented in existing `uptime-monitor.mjs`).

| Endpoint | URL | SLO | Why |
|---|---|---|---|
| API health | `https://sourcelibrary-v2.vercel.app/api/health` | 200, <500ms | Existing; keep |
| API books | `https://sourcelibrary-v2.vercel.app/api/books?limit=1` | 200, <1s | Existing; keep |
| BPH embed | `https://sourcelibrary-v2.vercel.app/embed/bph?host_path=%2Fdigital-collection-search` | 200, <3s, no RSC error body | Exact incident endpoint |
| Ficino embed | `https://sourcelibrary-v2.vercel.app/embed/ficino` | 200, <1s | Cross-tenant baseline |
| Bhutan embed | `https://sourcelibrary-v2.vercel.app/embed/bhutan` | 200, <1s | Third tenant |

The ficino/bhutan comparison against BPH is the key diagnostic: if all three are slow, it is Vercel/Atlas-wide; if only BPH is slow, it is a BPH-specific regression (the 2026-05-15 pattern exactly).

**Body check:** For embed endpoints, also grep the response body for `Something went wrong` or RSC digest patterns — a 200 with an error boundary payload is a soft failure.

---

## 4. Where the probe runs

**Recommended: extend the existing Hetzner cron (`uptime-monitor.mjs`).**

Rationale:
- Already runs every 5 min with ntfy.sh wired and MongoDB cooldown state.
- The Hetzner machine already uses the `.vercel.app` bypass URL that avoids Cloudflare.
- GitHub Actions would add credential surface, new billing, and unstable IP ranges.
- Vercel cron route adds complexity and a single-point-of-failure on the thing being monitored.

Change needed: add the three embed endpoints to `ENDPOINTS` in `uptime-monitor.mjs` with latency thresholds.

---

## 5. Alert fanout

**Primary: ntfy.sh** (already wired). Derek subscribes to `ntfy.sh/sourcelibrary-uptime` in the ntfy mobile app. Alerts carry `Priority: high`. No new channel needed.

**Secondary: Resend email** once `RESEND_API_KEY` is added to Hetzner's `.env.production.local` (the key exists in Vercel env; a `vercel env pull` syncs it). The `pipeline-health-alert.mjs` Resend pattern is already written — extend it. Email is too slow for "within a minute" but good for persistent degradation overnight.

**Do not add a new channel.** The Telegram bot is interactive, not push-capable for one-way alerts without configuring a `CHAT_ID` env var and modifying `bot.js`. ntfy.sh is simpler and already live.

---

## 6. SessionStart hook design

**Purpose:** When Derek (or Claude Code) opens a new session in this repo, inject a warning line if any tenant embed is degraded. Silent when all endpoints are green — zero noise on healthy days.

**Hook location:** Project `.claude/settings.json` (checked in). A `SessionStart` hook with empty matcher fires for every session. The global `~/.claude/settings.json` already has three SessionStart hooks (peon-ping, session-monitor, codevibing drafts) — this adds a fourth at the project level.

**Hook shape to add to `.claude/settings.json`:**
```json
{
  "hooks": {
    "PreToolUse": ["<existing branch-guard hook>"],
    "SessionStart": [
      {
        "matcher": "",
        "hooks": [
          {
            "type": "command",
            "command": "bash /Users/dereklomas/sourcelibrary/scripts/ops/quick-health.sh",
            "timeout": 10
          }
        ]
      }
    ]
  }
}
```

**Script: `scripts/ops/quick-health.sh`**

Design requirements:
- Parallel curls (`&` + `wait`) so three endpoints complete in ~4s total, not 12s.
- Latency threshold check (not just HTTP status): BPH >3s = WARN, >6s = CRIT; ficino/bhutan >1.5s = WARN.
- RSC error body check: grep for `Something went wrong` or `digest:` in response.
- Silent when all OK — emit nothing (no noise per session).
- State-file caching: if `~/.cache/sl-health-last.json` is <5 min old, read from cache instead of making live probes. This avoids 3 HTTP calls on every session open.
- Output format (plain text to stdout; Claude Code reads hook stdout as additional context):

```
HEALTH WARNING (2026-05-17 14:32 UTC)
  embed/bph   : 200 in 5.2s — SLOW (SLO: <3s)
  embed/ficino: 200 in 0.15s — OK
  embed/bhutan: 200 in 0.18s — OK
Likely BPH-specific regression (not infra-wide). Check Atlas BPH-only indexes or recent BPH loader changes.
```

**Environment:** Script makes only HTTP probes. No credentials needed. Works from Derek's laptop without sourcing `.env.production.local`.

---

## 7. False-positive handling

The existing `uptime-monitor.mjs` uses MongoDB to implement a **1-hour cooldown per endpoint** before re-alerting. This prevents spam on sustained outages. Keep it.

For the new **latency SLO dimension**:

1. Only alert after **2 consecutive slow checks** (the 5-min probe fires twice and both exceed the SLO). Store `latency_ms` in the existing MongoDB `uptime_checks` documents (the schema already accepts arbitrary fields).
2. Use the same 1-hour cooldown logic already in the script — check the `alerted: true` flag in the last `ALERT_COOLDOWN_MS` window.
3. Send a recovery notification when BPH returns to <2s (with headroom below the 3s SLO), using the existing `recovery_sent` flag pattern already in the script.

For the **SessionStart hook** (no MongoDB access from dev laptop):
- Write `/tmp/sl-quick-health.json` (or `~/.cache/sl-health-last.json`) after each run.
- If the file is <5 min old, skip the live probe and echo cached status.
- On warning, always echo — no cooldown suppression at session level (Derek needs to see the warning even if it fired 3 min ago during another session open).

---

## 8. Rollout phases

### Phase 1: MVP (1–2 hours) — catches the next BPH-style outage

Modify `scripts/uptime-monitor.mjs` on Hetzner:
1. Add `embed_bph`, `embed_ficino`, `embed_bhutan` to `ENDPOINTS` with `.vercel.app` URLs.
2. Add `latency_slo_ms` field to endpoint config; update `checkEndpoint()` to set `ok: false` when latency exceeds SLO even if HTTP 200.
3. Add body check: if response body contains `Something went wrong`, mark as failed.
4. Deploy: `git pull` on Hetzner (no service restart — cron runs the script directly).

This catches the incident within 5 minutes, delivers ntfy.sh push notification within 10 minutes of degradation starting. No new infrastructure.

### Phase 2: SessionStart hook (2–3 hours) — in-session awareness

1. Create `scripts/ops/` directory.
2. Write `scripts/ops/quick-health.sh` with parallel curls, state-file caching, latency thresholds.
3. Add `SessionStart` entry to `.claude/settings.json`.
4. Test: open new Claude Code session; verify silent on healthy, verify warning text on simulated failure.

### Phase 3: Embed error boundary (separate, tracked in #1758)

Add `src/app/embed/[tenant]/error.tsx` with a graceful partner-facing fallback — "We are loading our catalogue, please try again in a moment." Defense-in-depth for user experience. Lower urgency now that #1757 has hardened the loaders.

### Phase 4: Resend email redundancy (low priority)

Sync `RESEND_API_KEY` to Hetzner via `vercel env pull`. The `pipeline-health-alert.mjs` Resend pattern is already written — extend it to cover embed latency alerts. Adds email backup to ntfy.sh for overnight incidents. Not needed for MVP.

---

## 9. Open questions for Derek

1. **ntfy.sh subscription confirmed?** Are you actively subscribed to `ntfy.sh/sourcelibrary-uptime` on your phone? The topic is public/unauthed — subscribe in the ntfy app. Without this, Phase 1 alerts are logged to MongoDB but don't reach you in real-time.

2. **BPH latency right now:** During this scoping pass (2026-05-17), `/embed/bph` measured **3.3s** from Hetzner. Phase 1 would immediately trigger warnings at the 3s SLO. Worth knowing if this is expected (e.g., cold lambda) or a real regression.

3. **SessionStart hook in `settings.json` (team) vs `settings.local.json` (Derek-only)?** Recommend `settings.json` so it covers all sessions including future contributors. The script only makes HTTP probes and needs no credentials, so there's no privacy concern with checking it in.

4. **RESEND_API_KEY on Hetzner:** The key exists in Vercel env but not in Hetzner's `.env.production.local`. A single `vercel env pull` syncs it and unlocks Phase 4 for free.
