# Background Upload for Mobile Scanner

**Date:** 2026-03-11
**Files changed:** `src/app/scan/page.tsx`, `src/components/layout/UserMenu.tsx`
**Commit:** `3214cd11` (background upload), plus follow-up (user menu)

## What Changed

### Background Upload (`src/app/scan/page.tsx`)

Previously, the mobile scanner accumulated all captured photos in browser memory and uploaded them in a blocking batch when the user clicked "Upload All." If the browser tab closed or crashed before that, all photos were lost.

Now each page uploads immediately in the background as it's captured. Key implementation details:

**Sequential upload queue** — Pages upload one at a time via `processUploadQueue()` / `enqueueUpload()`. This is required because `/api/scan/upload` auto-detects the next page number from `max(page_number)` in MongoDB — concurrent uploads would race and create duplicate page numbers.

**React refs for async closures** — Five refs (`uploadStatusRef`, `uploadQueueRef`, `uploadActiveRef`, `pagesRef`, `bookIdRef`) ensure the upload queue always reads current state, not stale closure captures. State (`uploadStatus`) is updated in parallel for UI reactivity.

**bookIdRef timing** — `handleConfirmAndCreate` sets `bookIdRef.current = data.id` directly (not via the `useEffect` sync) because the title page's `enqueueUpload` call happens in the same handler. The effect wouldn't fire until the next render.

**Upload status indicators** on thumbnail strip:
- Green checkmark = uploaded to server
- Spinning border = uploading or pending
- Red dot with `!` = failed

**"Finish" button** replaces "Upload All" — waits for in-flight uploads, retries any failures, then transitions to done screen. Polls `uploadStatusRef` every 500ms.

**`beforeunload` guard** — Warns if any page has status other than `uploaded`.

### User Menu (`src/components/layout/UserMenu.tsx`)

Added "Scan Book" link to the authenticated user dropdown menu (avatar click on homepage). Positioned first in the list, before Bookshelf.

## Known Limitations

1. **No offline/retry persistence** — If the tab closes mid-upload, queued pages are lost. Only pages that completed upload are saved. A service worker + IndexedDB approach would solve this but is much more complex.

2. **Sequential = slower for bulk** — Uploading 50 photos one at a time is slower than 5-at-a-time batching. But correctness > speed here since the upload route relies on sequential page numbering.

3. **No upload resumption** — If you navigate away from `/scan` and come back, there's no way to resume a partial upload session. The book exists in the DB with whatever pages completed.

## Files Reference

| File | What |
|------|------|
| `src/app/scan/page.tsx` | Main scan page — all upload logic |
| `src/app/api/scan/upload/route.ts` | Server route — auto-assigns page numbers |
| `src/lib/scan/image-utils.ts` | Client-side EXIF, thumbnails, quality, resize |
| `src/app/api/scan/create/route.ts` | Creates book + first page |
| `src/app/api/scan/start-ocr/route.ts` | Queues OCR after upload complete |
| `src/app/api/scan/recent/route.ts` | Lists recent scans |
