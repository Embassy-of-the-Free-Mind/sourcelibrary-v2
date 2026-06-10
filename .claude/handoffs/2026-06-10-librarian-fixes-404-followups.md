# Librarian fixes + 404-triage follow-ups closed (2026-06-10)

Continuation of `2026-06-10-404-log-triage-provider-strip.md`. All shipped
the same session.

## Librarian (Embassy chat) — PR #2508, merged + deployed

Production conversation triage found ~1/3 of anonymous sessions re-asking
the same question in fresh threads. Two causes, both fixed:

1. **Dead threads after long answers.** Librarian answers exceed 10k chars;
   client sends them back as history; `messageSchema` rejected >10k history
   items → every follow-up 400'd and the client rendered the raw
   `"Invalid request"` as the Librarian's reply. History is now clipped via
   zod `.transform`, not rejected. Overlong *messages* (>5k) still 400 with
   a human-readable sentence (the client renders `err.error` verbatim —
   any new 400 in that route must read like a sentence).
2. **Back-navigation lost the chat** (direct user feedback). Thread id now
   lives at `/librarian?thread=<id>` via `replaceState`; LibrarianClient
   restores from `GET /api/embassy/threads/[id]` on mount. That GET now
   serves `unlisted` (anonymous) threads to anyone with the id; `private`
   still requires creator auth.

Also: per-turn Gemini token usage persisted on each AI message
(`embassy_messages.usage`: model/rounds/prompt/output/thinking/cached) and
agent errors logged from the non-stream path too. Known but unfixed:
system prompt embeds `messageIndex` + notebook near the top → cross-turn
implicit cache ≈ 0; revisit once a week of usage data exists.

## 404-triage follow-ups

- **29 legacy `kind:'provider'` tenants rows DELETED** (Derek-approved).
  Backup: `scripts/output/tenants-provider-rows-backup-2026-06-10.json`
  (main checkout, untracked). 5 rows remain (all/bph/kloss-collection/
  default/bhutan). Verified post-delete: BPH home, provider 308s,
  homepage, embed book all 200. CLAUDE.md §"Source Library is the
  destination" point 4 updated.
- **BPH catalog leak (catalog/2666 → chymische-hochzeit) self-resolved** —
  404s ran 2026-05-29 → 06-05; today catalog, embed book, and both slug
  variants are 200. Residual provider-prefix/embed 404 *reports* through
  06-10 were stale CDN-cached 404 HTML from before the morning purge
  (origin 308s verified). Lesson: a not_found_report timestamp is when a
  *cached page* was viewed, not necessarily a live route failure — curl
  origin before chasing.
- **Real gap found while verifying:** `/embed/<tenant>/book/<slug>/page-number/<n>`
  had no route (global side has one) → PR #2510, mirrors the global 308
  handler with tenant scoping; redirect stays on the embed path.
- **Health email now reads the write-only logs** → PR #2509:
  `checks.not_found_404s` (24h vs prev-24h, top URLs/prefixes, warns on
  spike ≥600 or ≥300+2× day-over-day) and `checks.librarian`
  (embassy_errors by kind, turns, avg tokens, cached-token share). Both
  cap at `warning`. The 07:00 routine summarizes whatever this endpoint
  returns, so no routine change needed.
- Still pending: `/author/*` 404 re-count ~2026-06-16 (spot-checks resolve
  since the thesaurus read-path).

## CLAUDE.md check

Done — tenants point 4 updated in this PR. No new invariant needed; the
quote/snippet and tenant-lockdown sections already cover the touched
surfaces.
