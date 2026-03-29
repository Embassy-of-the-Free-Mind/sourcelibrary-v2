---
name: Stale page counters from Hetzner workers
description: Hetzner translate-worker didn't update book-level pages_translated; sync-worker gallery crash hid the problem
type: feedback
---

Hetzner workers that write to pages must also update book-level counters (pages_translated, pages_ocr, pages_blank).

**Why:** The translate-worker was translating pages correctly but never updating `book.pages_translated`. The sync-worker (every 2h) was supposed to catch this, but it crashed on the gallery sync phase (`book_rank: 0` projection bug), masking the fact that page counts *were* being synced. Result: 169K translated pages over 3 days invisible to book-level stats. "Fully translated" appeared to drop from 1,990 to 1,519.

**How to apply:**
- Any new Hetzner worker that writes `ocr.data` or `translation.data` must also update book counters (or at minimum, the sync-worker handles it)
- The sync-worker runs every 2h and checks all 40K books (~6-33 min). If it errors, page counts drift.
- Fixed 2026-03-27: translate-worker now syncs counters on job completion; sync-worker `$literal` fix deployed.
- Monitor `/var/log/sourcelibrary/sync.log` for errors — a crash there silently breaks stats.
