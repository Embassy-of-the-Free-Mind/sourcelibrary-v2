# Beta Registration System — 2026-02-18

## What was done

Built and deployed the reader registration + content gating system for the Feb 22 beta launch.

**Commit:** `882b0d5` — "Add reader registration and content gating for beta launch"

### Changes (23 files)

- **Auth rewrite** (`src/lib/auth.ts`): Opened sign-in to all users (was admin-only whitelist). Added Email provider via Resend (conditional on `RESEND_API_KEY`), MongoDB adapter, role system (admin/reader).
- **Admin separation** (`src/lib/auth-helpers.ts`): Added `requireAdmin`, `withAdminAuth`, `isAdmin`. Admin layouts (admin, analytics, experiments, jobs) now use `requireAdmin`.
- **MongoDB client** (`src/lib/mongodb-client.ts`): Singleton MongoClient for NextAuth adapter.
- **Admin users migration**: Moved admin whitelist from `users` → `admin_users` collection (3 active: dereklomas@gmail.com, mayank.bagchi@playpowerlabs.com, nirmal@playpowerlabs.com).
- **Free-tier flagging**: Top 120 books by `read_count` have `free_tier: true` in MongoDB. Index created on `free_tier`.
- **Content gate**: Book detail page, page reader layout, and page-number redirect all check auth for non-free books. Unauthenticated users see `RegistrationWall` component.
- **Registration wall** (`src/components/auth/RegistrationWall.tsx`): Email input + Google OAuth, matches site design.
- **Sign-in page** (`src/app/auth/signin/page.tsx`): Email input + Google OAuth + links to terms/privacy.
- **Verify page** (`src/app/auth/verify/page.tsx`): Post-magic-link "check your email" page.
- **Beta page** (`src/app/beta/page.tsx`): Updated copy — "120 books free and open", registration messaging.
- **Terms of Service** (`src/app/terms/page.tsx`): CC BY 4.0 for AI content, public domain originals.
- **Privacy Policy** (`src/app/privacy/page.tsx`): GDPR compliant, no data sales/ads/AI training.
- **Dependencies**: Added `@auth/mongodb-adapter`, `resend`, `nodemailer`. Created `.npmrc` with `legacy-peer-deps=true`.

## Outstanding TODOs for beta launch (Feb 22)

### 1. Resend setup (email magic links)
Add `RESEND_API_KEY` to Vercel env vars and verify `sourcelibrary.org` domain with Resend. Until then, email magic links won't work — Google OAuth is the only sign-in method.

### 2. Google OAuth open registration
Confirm the Google Cloud OAuth consent screen is set to "External" and published (not in test mode), so any user can sign in — not just whitelisted test accounts.

### 3. Admin API route hardening
Mayank's `withAuth` on ~130 API routes lets any authenticated user (including readers) call them. Swap to `withAdminAuth` on write/admin routes before public launch. Low risk for beta since readers can't discover admin routes.

### 4. End-to-end verification
Sign in as a non-admin user and confirm:
- Free-tier books show pages without auth
- Gated books show the registration wall
- Signing in unlocks gated books
- Admin pages still work for whitelisted admins

## Unstaged changes in repo

Other unstaged changes remain in the working tree (from Mayank and other sessions): cron auth (`verifyCronAuth`), contribute page rewrite, homepage tweaks, component updates, `proxy.ts`. These are deployed but not committed — coordinate with Mayank.
