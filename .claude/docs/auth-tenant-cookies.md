# Cross-subdomain authentication

How sign-in carries across `sourcelibrary.org` and every `*.sourcelibrary.org` tenant subdomain.

## TL;DR

In production, the NextAuth session cookie is set on the parent domain `.sourcelibrary.org` (with a leading dot). A signed-in user on `sourcelibrary.org` visiting `bph.sourcelibrary.org` is already signed in there — same identity, no re-sign-in. Tenant role gates still apply per-tenant via `memberships`.

## What's configured

In `src/lib/auth.ts`, the NextAuth `cookies` option overrides the default host-scoped behavior for two cookies only:

| Cookie | Production domain | Why |
|---|---|---|
| `__Secure-authjs.session-token` | `.sourcelibrary.org` | The actual session — needs to be readable on every subdomain. |
| `__Secure-authjs.callback-url` | `.sourcelibrary.org` | Sign-in / sign-out redirect target; needs to survive a subdomain hop during the OAuth/magic-link round-trip. |
| `__Host-authjs.csrf-token` | *(unchanged, host-scoped)* | The `__Host-` prefix forbids a `domain` attribute by spec. Each subdomain hits its own `/api/auth/*` routes, so per-host CSRF is fine. |

Override is gated on `process.env.VERCEL_ENV === 'production'`:
- **Production deploy** (main → `sourcelibrary.org`): shared cookie domain ON.
- **Vercel preview** (PR branches → `*.vercel.app`): host-scoped — there's no `.sourcelibrary.org` host to attach to.
- **Localhost dev**: host-scoped — same reason.

`useSecureCookies` is set to `process.env.NODE_ENV === 'production'`, which is the standard NextAuth flag for the `Secure` attribute.

## Security invariant — identity vs. permission

> **Sharing the session cookie shares identity. It does NOT share permissions.**

Role checks run via `getTenantMembershipRole(email, tenantId)` (`src/lib/auth-helpers.ts:19-42`), which reads the `memberships` collection filtered by tenant. The `withAuth({ minRole })` wrapper and the BPH-specific `withBphLibrarianAuth` enforce per-tenant role gates. A user with `editor` role on tenant `bph` cannot edit content on a hypothetical `kloss` tenant just by visiting `kloss.sourcelibrary.org` while signed in — they have no membership row for that tenant.

The phase-1 tenant verification block in `withAuth` (`auth-helpers.ts:204-234`) further checks `x-tenant-id` against session tenantId, preventing crafted-header cross-tenant access even when the identity is shared.

## How sign-out works

`signOut()` from `next-auth/react` (used in `UserMenu.tsx` and `EmbedUserMenu.tsx`) clears the session cookie. Since the cookie domain is `.sourcelibrary.org` in production, the browser removes it across every subdomain — one click signs out everywhere.

## Rollback

If anything goes wrong, the rollback is a one-line revert of the `cookies` block in `auth.ts`. No data loss possible — existing sessions get invalidated, users sign in again, that's it. The cookie names match NextAuth's production defaults so a revert reads any pre-change cookies unchanged.

## Why this wasn't always the case

Before this change (PR #1943, merged 2026-05-22), each subdomain held its own independent session. A user signing in on `sourcelibrary.org` would see "Sign in" again on `bph.sourcelibrary.org`. Paul Dijstelberge (librarian at BPH) flagged this in catalog feedback that prompted the change — many users belong to both surfaces, and forcing N sign-ins per session was a real friction.

## Related

- `src/lib/auth.ts` — the cookies config
- `src/lib/auth-helpers.ts` — per-tenant role gates (`getTenantMembershipRole`, `withAuth`, `withBphLibrarianAuth`)
- `src/components/embed/EmbedUserMenu.tsx` — the floating sign-in/out control on tenant subdomains
- `src/components/layout/UserMenu.tsx` — the main-site sign-in/out control
- CLAUDE.md → "Tenant Subdomain Lockdown" → "Authentication across subdomains"
