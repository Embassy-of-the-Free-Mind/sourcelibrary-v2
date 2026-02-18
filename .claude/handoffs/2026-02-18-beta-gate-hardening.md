# Beta Gate Hardening — 2026-02-18

## What was done

Second pass on the beta launch infrastructure. Replaced Mayank's server-side `RegistrationWall` with a client-side email gate modal, added bot protection, and committed all previously-unstaged changes.

**Commits:** `16fa108`, `dbd2e4a`, `d266755`

### Gate System (client-side)

- **Removed `RegistrationWall`** from `src/app/book/[id]/page.tsx` — book pages always render `BookPagesSection` with thumbnails visible. No more server-side content blocking.
- **`useBetaGate` hook** (`src/hooks/useBetaGate.ts`): Grants access if any of: book is `featured`, user has next-auth session (`useSession()`), or email stored in localStorage (`sl_beta_email`). Gates non-featured book page thumbnail clicks.
- **`BetaGateModal`** (`src/components/beta/BetaGateModal.tsx`): Cream/rust design matching site tokens. Three access paths:
  1. Quick email entry (POST to `/api/beta/subscribe`, localStorage, instant)
  2. Google OAuth (via `signIn('google')`)
  3. Email magic link (via `signIn('email')`, shows "check your email" state)
- **`PagesGrid`** (`src/components/book/PagesGrid.tsx`): Added `onPageClick` prop — when set, intercepts thumbnail clicks and calls the gate instead of navigating.
- **Preview page** at `/beta/gate-preview` for testing modal without clearing localStorage.

### Bot Protection

- **Cron auth** (`src/lib/cron-auth.ts`): `verifyCronAuth()` checks `Authorization: Bearer <CRON_SECRET>`. Applied to all 10 cron routes.
- **Rate limiting** in `src/proxy.ts`: In-memory per-IP store. 60 req/min for public `/api/` routes, 10 req/min for expensive routes (batch-ocr, batch-translate, queue-books, admin, analytics/usage). Cron routes exempted.
- **`robots.txt`**: Crawl-Delay: 2, disallows `/api/`, `/admin/`, `/analytics/`, `/auth/`, `/beta/`.

### Other

- Homepage (`src/app/page.tsx`): Minor tweaks.
- `ChapterDropdown`: Fixes.

## Architecture Decision: Client-Side vs Server-Side Gating

Mayank's `RegistrationWall` (server-side, next-auth) completely hid book content from non-authenticated users. This was the right long-term infrastructure (real auth needed for paid tiers) but wrong UX (users couldn't see what they were signing up for).

The new approach: show everything (thumbnails, metadata, OCR stats), gate only on page-level click. `useBetaGate` checks next-auth session so real accounts work too. This preserves Mayank's auth infrastructure while improving conversion.

**Key:** `RegistrationWall` component still exists at `src/components/auth/RegistrationWall.tsx` but is no longer imported anywhere. Can be deleted or repurposed for future paid tier.

## What's NOT done

### 1. Featured book curation
`scripts/curate-beta-100.mjs` exists but was never run with `--apply`. Need to execute:
```bash
node scripts/curate-beta-100.mjs --apply
```
This marks ~100 top books as `featured: true`. Until then, ALL books trigger the gate (no books are featured).

### 2. Resend email magic links
`RESEND_API_KEY` must be added to Vercel env vars and `sourcelibrary.org` domain verified with Resend. Without this, the "Send sign-in link" button in the modal won't work. Google OAuth works immediately.

### 3. Google OAuth consent screen
Must be set to "External" and published (not test mode) in Google Cloud Console for public sign-ups.

### 4. Admin API hardening
~130 routes use `withAuth` (any authenticated user). Most should use `withAdminAuth`. Low risk since readers can't discover admin routes, but should be fixed before public launch.

### 5. Modal brand logo
Currently uses `/brand/svg/icon-only--black-on-white.svg` which has a white background rect. On the cream modal background this looks slightly off. May want a version without the white rect, or use CSS to clip/mask it.

## Key Files

| File | Purpose |
|------|---------|
| `src/hooks/useBetaGate.ts` | Gate logic (session + localStorage + featured) |
| `src/components/beta/BetaGateModal.tsx` | Modal UI (cream/rust, 3 auth paths) |
| `src/components/book/BookPagesSection.tsx` | Wires gate to page grid |
| `src/components/book/PagesGrid.tsx` | `onPageClick` intercept |
| `src/app/book/[id]/page.tsx` | Always renders BookPagesSection (no RegistrationWall) |
| `src/lib/cron-auth.ts` | Cron route bearer token auth |
| `src/proxy.ts` | Rate limiting middleware |
| `src/app/beta/gate-preview/page.tsx` | Modal preview page |

## Database

- `beta_subscribers` collection: email, source (`reader_gate` or `reader_gate_magic`), subscribed_at, ip
- `admin_users` collection: dereklomas@gmail.com (active, admin), mayank.bagchi@playpowerlabs.com (active), nirmal@playpowerlabs.com (active)
- No books have `featured: true` yet — curation script needs to be run
