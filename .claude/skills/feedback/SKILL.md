---
name: feedback
description: Triage and respond to the user-feedback queue — pull open feedback, detect items already fixed but never marked, route translation-requests and metadata-corrections, mark items resolved, and (on approval) email submitters. Use when asked to check/triage/answer/clear feedback, "what are people saying?", or "respond to feedback."
---

# Feedback triage & response

The `feedback` collection (Mongo `bookstore`) collects messages from the
FeedbackWidget, the translation-request prompt, and the MCP `submit_feedback`
tool. The infra to resolve it already exists — this skill runs the loop instead
of the throwaway `_tmp_fb_*` scripts that used to do it ad-hoc.

## Lifecycle (don't invent new states)
- **unread** — `read != true`
- **read** — `read == true && addressed != true` (triaged, not resolved)
- **addressed** — `addressed == true` (done)

Resolving via the admin API (`PATCH /api/feedback/[id]`) auto-emails the
submitter once if they left an email (`feedback-reply-email.ts`, idempotent via
`reply_sent_at`). The `/admin/feedback` page is the human UI for this.

## Step 1 — pull & classify the queue (read-only)

```bash
set -a; source .env.production.local; set +a
node scripts/analytics/feedback-triage.mjs           # all open items, grouped
node scripts/analytics/feedback-triage.mjs --days 45 # recent only
```

Groups: **bug · translation-request · metadata-correction · partner-cms ·
feature-request · praise · other.** Each line shows the `_id`, date, state,
whether an email was left (✉), and the page. The footer splits emailed (reply
candidates) vs anonymous (bulk-resolvable).

## Step 2 — the already-fixed detector (the point of this skill)

For each open item, decide if it's **already shipped but never marked** — this
is the main backlog source. Cross-check, don't guess:
- `git log --oneline --since=<feedback date> -S "<keyword>"` and search merged PRs (`gh pr list --search`).
- Check `memory/` + `MEMORY.md` for a matching lesson (e.g. librarian "kites" → PR #2829; Spanish voice → PR #2699).
- For "broken X" reports, verify against **live code/data** the way the metrics work taught us: the data is often fine and the report was transient (victorio's "can't load pages" was healthy R2 images served through a degraded CF colo — already addressed). Curl the asset / query the book before believing the complaint.

Propose a disposition per item: `already-fixed (link PR/page)` · `real, route it` · `wontfix/explain` · `praise (ack)`.

## Step 3 — route the real ones
- **translation-request** → page-precise pipeline demand. Collect the `book_id`/page and hand to the daily pipeline queue (the corpus is paused as of 2026-06-08 — note that; don't unpause without Derek's say-so). Mark addressed once queued.
- **metadata-correction** (scholars correcting editions/dates) → fix the record or open an issue; these are high-trust. Reply if email present.
- **partner-cms** (Paul's `/catalog/*/edit` notes) → one GitHub issue for the BPH catalog editor; tag EFM-facing.
- **feature-request** → issue or note; ack the submitter.
- **praise** → mark addressed; reply with thanks if email present (many are Spanish — reply in kind).

## Step 4 — resolve

**Anonymous / no-email items (the bulk):** mark directly — no email is sent.
```bash
node scripts/analytics/feedback-triage.mjs --mark-addressed <id,id,...> --note "what was done" [--link URL] --apply
# or just triage without resolving:
node scripts/analytics/feedback-triage.mjs --mark-read <id,id,...> --apply
```
Always dry-run first (omit `--apply`). The note becomes `addressed_action`.

**Items WITH an email that deserve a reply:** these must go through the
`/admin/feedback` UI (or the authed `PATCH /api/feedback/[id]`) so the canonical
reply email fires. Script-marking sets state but does NOT email — the script
warns when a marked id has an email. **Sending an email is outward-facing and
unsendable: draft it, show Derek, and only resolve-with-reply on his explicit
approval.** Per-item, not blanket.

## Guardrails
- **Never blanket-resolve.** Mark by explicit `_id` list, after classifying. A wrong "addressed" can fire a wrong email.
- **Verify "already fixed" against code/data**, not memory of a fix. The whole reason for the backlog is fixes that landed without the row being marked — so confirm the fix is live before claiming it.
- **Geo caveat:** submitter IPs are often Cloudflare edge addresses (`172.x`), so logged country ≠ real location. Don't infer audience geography from feedback rows.
- The corpus pipeline is **paused** (`system_config.processing_control.paused`) — translation-requests queue but won't process until unpaused.
