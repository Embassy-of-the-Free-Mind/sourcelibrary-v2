# Multi-Tenancy Architecture

_Last updated: 2026-04-15. Authoritative reference — supersedes all prior versions._

---

## Architecture Decisions (Summary)

| Decision | Choice | Rationale |
|---|---|---|
| Tenant routing | Path-based (`/{tenant}/...`) | No custom domain requirement in v1 |
| Tenant identity | UUID internally, slug in URL | Stable ID, human-readable URLs |
| Slug → UUID resolution | Database lookup in proxy.ts | Simple, no external cache dependency for Phase 1 |
| Proxy/middleware | `proxy.ts` (Next.js 16 name, already in use) | No codemod needed |
| Auth strategy | JWT (already configured) | Session strategy stays as-is |
| Session storage | DB-backed (`sessions` collection) | Instant revocability |
| JWT claims | `tenantId` + `role` | Resolved at login, verified by proxy |
| Multi-tenant users | One account, many tenant memberships | Same email, different role per tenant |
| Membership collection | Single `memberships` collection | Replaces `admin_users` + `platform_admins` + `user_tenant_memberships` |
| Auth wrappers | Unified `withAuth(handler, { minRole })` | Replaces proliferating HOCs |
| `system_config` | Stays platform-global | Adaptive limits are infrastructure concerns |
| Superadmin routing | `platform` treated as superadmin "tenant slug" | `/platform/login`, `/platform/dashboard`, etc. |

---

## Role Hierarchy

```
superadmin          platform owner — /platform/ only, cross-tenant, no tenantId in JWT
  admin             tenant-scoped — manages users + settings
    editor          tenant-scoped — manages content + triggers pipeline
      user          authenticated — read + personal data (likes, history)
        guest       unauthenticated — public browse only
```

Role levels (used by `withAuth` and `requireRole`):
```ts
export const ROLE_LEVEL: Record<Role, number> = {
  user: 1, editor: 2, admin: 3, superadmin: 4
}
export type Role = 'superadmin' | 'admin' | 'editor' | 'user'
```

---

## Collections

### `tenants`
```ts
{
  id: string,            // UUID (crypto.randomUUID())
  slug: string,          // 'british-library' (URL-safe, unique index)
  name: string,          // 'British Library'
  status: 'active' | 'suspended',
  createdAt: Date,
  createdBy: string,     // user id
  settings: {
    publicBrowsing: boolean,   // default: true
    allowSignup: boolean,      // default: false — invite-only by default
  },
  pipeline: {
    pausedPhases: string[],
    geminiQuota: number,       // max concurrent Gemini jobs for this tenant
  }
}
// Index: { slug: 1 } unique
```

### `memberships`
Unified collection replacing the old `admin_users`, `platform_admins`, and `user_tenant_memberships` collections.

```ts
{
  email: string,           // lowercase — indexed for invite lookups before account exists
  tenantId: string | null, // UUID ref: tenants.id. null = superadmin (platform-level)
  userId: string | null,   // ref: users._id. null until pending invite is accepted
  role: 'superadmin' | 'admin' | 'editor' | 'user',
  status: 'active' | 'pending' | 'suspended' | 'deleted',
  invitedBy: string | null, // user id of inviter
  addedAt: Date,
  joinedAt?: Date,           // set when pending → active
}
// Unique index: { email: 1, tenantId: 1 }
// Index: { email: 1, tenantId: 1, status: 1 }  ← invite lookup
// Unique sparse index: { userId: 1, tenantId: 1 }
```

**Superadmin bootstrap**: `PLATFORM_ADMIN_EMAILS` env var. On first sign-in, JWT callback
upserts a record with `tenantId: null, role: 'superadmin', status: 'active'` (idempotent).

---

## Auth Implementation (`src/lib/auth.ts`)

**Role exported** for use in auth-helpers:
```ts
export const ROLE_LEVEL: Record<Role, number> = { user: 1, editor: 2, admin: 3, superadmin: 4 }
export type Role = 'superadmin' | 'admin' | 'editor' | 'user'
```

**JWT callback** (Phase 0 — superadmin only):
```ts
async jwt({ token, user, trigger }) {
  if (user?.email) {
    const email = user.email.toLowerCase();
    const db = client.db(dbName);
    const adminEmails = (process.env.PLATFORM_ADMIN_EMAILS || '')
      .split(',').map(e => e.trim().toLowerCase()).filter(Boolean);

    if (adminEmails.includes(email)) {
      token.role = 'superadmin';
      // Idempotent bootstrap
      await db.collection('memberships').updateOne(
        { email, tenantId: null, role: 'superadmin' },
        { $setOnInsert: { email, tenantId: null, role: 'superadmin',
            userId: null, status: 'active', invitedBy: null, addedAt: new Date() } },
        { upsert: true }
      );
    } else {
      const superRecord = await db.collection('memberships').findOne(
        { email, tenantId: null, role: 'superadmin', status: 'active' }
      );
      token.role = superRecord ? 'superadmin' : 'user';
      // TODO (Phase 1): resolve tenant-scoped role (admin/editor) from memberships
      // when tenantSlug is available via callbackUrl at sign-in time.
    }
  } else {
    token.role = 'user';
  }
  // Keep ficino membership check — needed for per-tenant membership tiers in future
  return token;
}
```

**Phase 1 JWT additions** (when tenant routing is live):
```ts
token.tenantId = tenant.id      // UUID from memberships lookup
token.tenantSlug = tenantSlug   // from callbackUrl
token.role = membership?.role ?? 'user'
```

---

## Auth Helpers (`src/lib/auth-helpers.ts`)

```ts
// Server component guards
export async function requireRole(minRole: Role, loginPath = '/auth/signin'): Promise<Session>
export const requireSuperAdmin = () => requireRole('superadmin', '/platform/login')
export const requireAdmin = () => requireRole('admin')      // loginPath updated per-tenant in Phase 1
export const requireEditor = () => requireRole('editor')

// API route wrapper (unified — replaces all old wrappers)
export function withAuth(handler, { minRole = 'user' } = {})

// Shims — keep existing callsites working, remove after Phase 1 migration
// TODO: Remove withAdminAuth once all callsites use withAuth({ minRole: 'admin' })
export const withAdminAuth = (h) => withAuth(h, { minRole: 'admin' })
// TODO: Remove withInnerCircleAuth — mapped to 'editor', verify each callsite
export const withInnerCircleAuth = (h) => withAuth(h, { minRole: 'editor' })
// TODO: Remove withCuratorAuth — mapped to 'editor', verify each callsite
export const withCuratorAuth = (h) => withAuth(h, { minRole: 'editor' })
export const withSuperadminAuth = (h) => withAuth(h, { minRole: 'superadmin' })
```

CRON_SECRET bypass stays in `withAuth` — pipeline workers use it.
`resolveIdentity()` and `ResolvedIdentity` unchanged — used by likes/engagement APIs.

---

## `platform` Route Structure (Superadmin)

`platform` is treated as the superadmin's tenant slug. Routes mirror `[tenant]`:

```
/platform/login            ←→  /[tenant]/login
/platform/dashboard        ←→  /[tenant]/dashboard
/platform/tenants/new      ←→  /[tenant]/admin/...
/platform/members          ←→  /[tenant]/admin/members
```

**File structure** (route groups prevent the guard from blocking the login page):
```
src/app/platform/
  (protected)/
    layout.tsx              ← requireSuperAdmin() + <PlatformNav />
    dashboard/page.tsx      ← tenant list table
    tenants/new/page.tsx    ← create tenant form
    members/page.tsx        ← (future) superadmin member management
  page.tsx                  ← redirect to /platform/dashboard
  login/page.tsx            ← no guard — Google + magic link sign-in
  PlatformNav.tsx           ← client component, dark GitHub style
```

**API routes**:
```
src/app/api/platform/
  tenants/
    route.ts                ← GET (list) + POST (create)
    [slug]/
      invite/route.ts       ← POST (invite tenant admin)
```

**MongoDB indexes** (create manually in Atlas/Compass):
```
tenants:     { slug: 1 }                          unique
memberships: { email: 1, tenantId: 1 }            unique
memberships: { email: 1, tenantId: 1, status: 1 }
memberships: { userId: 1, tenantId: 1 }           unique, sparse
```

---

## Phase Roadmap

### Phase 0 — Superadmin Bootstrap ✅ (current)
- `memberships` collection with superadmin bootstrap from `PLATFORM_ADMIN_EMAILS`
- `/platform/` dashboard: create tenant, invite tenant admin
- Unified role system in auth.ts and auth-helpers.ts
- Existing admin routes untouched

### Phase 1 — Routing & Tenant Auth ✅
**Goal:** Every request knows its tenant. Auth tokens carry tenant context.

1. **App Router restructure** — move pages under `[tenant]` segment
2. **next.config.js redirects** — preserve existing URLs (`/books/:id` → `/default/books/:id`)
3. **proxy.ts updates** — resolve slug → UUID via Vercel KV, set `x-tenant-id` header
4. **JWT updates** — add `tenantId` + role from `memberships` at `[tenant]/login` time
5. **Invite flow** — pending membership activated on first auth to that tenant
6. **Open signup** — `allowSignup: true` auto-creates `user` membership on first sign-in

**proxy.ts tenant resolution** (DB-backed):
```ts
const NON_TENANT_PATHS = ['platform', 'api', '_next', 'favicon.ico', 'auth']
// slug → tenantId lookup via MongoDB query
// Sets x-tenant-id + x-tenant-slug headers for downstream use
// KV caching can be added in Phase 4 for performance optimization
```

**Auth cross-check in `withAuth`** (Phase 1 addition):
```ts
const tenantId = req.headers.get('x-tenant-id')
if (session.user.role !== 'superadmin' && session.user.tenantId !== tenantId) {
  return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
}
```

### Phase 2 — API Layer Tenant Scoping ✅
**Goal:** Every DB query filtered by tenant (`tenantId` / `tenant_id`).

- Use `getTenantContextFromRequest(request)` from `src/lib/tenant-context.ts` (returns `{ slug, id }` from proxy headers)
- Audit all API routes — priority: search routes (cross-tenant exposure risk), then content routes, user data, pipeline
- Add `tenantId` filter to all MongoDB queries
- Update Atlas Search index: add `tenant_id` as filter field
- Verify: search results, collections, categories, languages scoped per tenant

Phase 2 completion notes (completed 2026-04-21):
- Root API tenant context now propagates through `proxy.ts` for `/api/*` requests using explicit `/api/{tenant}/...` segment or referer fallback from `/{tenant}/...` pages.
- Legacy root routes now tenant-scope DB queries: `/api/books`, `/api/books/search`, `/api/books/[id]/search`, `/api/likes/mine`, `/api/search`, `/api/search/unified`.
- Unified search applies tenant filtering across books, index expansion, gallery results, and visual-result book joins.
- Integration verification includes tenant isolation for likes/popular/reading history/analytics plus root-route coverage for likes-mine and per-book search.
- Share and cite links are tenant-scoped: `CiteButton` (APA + BibTeX URLs) and `ShareButton` (`QuoteShare`, `BookShare`) accept a `tenantSlug` prop and produce `/{tenant}/book/{id}` URLs. Threaded from proxy headers through `BookDetailPage` → `BookInfo` and via `useParams` in `TranslationEditor`.

### Phase 3 — Admin UI Split
```
src/app/admin/collections/   → src/app/[tenant]/admin/collections/
src/app/admin/pipeline/      → src/app/[tenant]/admin/pipeline/
src/app/admin/members/       → src/app/[tenant]/admin/members/
src/app/admin/system-map/    → src/app/platform/system-map/
src/app/admin/adaptive-limits/ → src/app/platform/adaptive-limits/
```

Impersonation: `POST /platform/api/impersonate` → time-limited session with `impersonating: true`, UI banner.

### Phase 4 — Pipeline Isolation
- Per-tenant `canSubmitMore(tenantId, quota)` check
- Round-robin scheduling across tenants
- `tenantId` in all SQS message payloads
- Gemini quota: per-tenant (`tenants.pipeline.geminiQuota`) AND platform cap (`system_config.adaptive_limits.max_concurrent_batch`)

### Phase 5 — Storage & SEO
- R2 path convention: `pages/{tenantId}/{bookId}/{NNNN}.jpg`
- Sitemap: `/{tenant}/sitemap.xml` scoped per tenant
- Robots.txt: dynamic, disallow `/{tenant}/admin/`

### Phase 6 — Testing & Hardening
Key isolation tests:
1. Cross-tenant data isolation (auth to tenant-alpha, request tenant-beta data → 403)
2. Session tenant mismatch (crafted `x-tenant-id` header → 403)
3. Search isolation (no cross-tenant results)
4. Pipeline quota enforcement
5. Invite flow activation
6. Superadmin bypass (can read any tenant's data)
7. Impersonation scope (impersonating tenant-alpha/admin cannot access `/platform/`)

---

## What Stays Global (No Tenant Isolation)

- `entities`, `entity_aliases` — shared author/person registry
- `system_config` — platform-level adaptive limits
- `users` — identity only (email, OAuth), no tenant affiliation in this collection
- `memberships` — cross-tenant by design (one user, many memberships)
- `tenants` — platform metadata
- Static assets (`public/`)

---

## Tenant-Scoped Collections (need `tenant_id` field)

| Collection | Notes |
|---|---|
| `books` | Already has `tenant_id` in schema but value defaults to 'default' |
| `pages` | Same |
| `collections` | Unique index: `{ tenant_id: 1, slug: 1 }` |
| `gallery_collections` | |
| `gallery_images` | |
| `editions` | |
| `books_warehouse` | |
| `pages_warehouse` | |
| `reading_history` | Compound: `{ tenant_id: 1, user_id: 1 }` |
| `likes` | |
| `highlights` | |
| `discussions` | |
| `discussion_replies` | |
| `embassy_profiles` | |
| `embassy_messages` | |
| `purchases` | |
| `api_keys` | |
| `jobs` | |
| `batch_jobs` | |
| `comparisons` | Also add `user_id` |
| `curator_sessions` | Also add `user_id` |

---

## Open Design Questions (Post-V1)

- **Cross-tenant `related_books`**: Surface relations across tenants?
- **Shared entity enrichment**: Author pages spanning tenants?
- **USTC/IA identifier collisions**: Same external item imported by two tenants — duplicate or shared canonical?
- **`suggest_vocabulary`**: Per-tenant or shared platform vocabulary?
- **DOI minting**: Two tenants publishing editions of same work — separate DOIs OK?

---

## Migration Checklist

- [x] Phase 0 — Superadmin bootstrap + `/platform/` dashboard
- [ ] Phase 1.1 — App Router restructure (`[tenant]` segments)
- [ ] Phase 1.2 — next.config.js redirects
- [ ] Phase 1.3 — proxy.ts tenant resolution + KV
- [ ] Phase 1.4 — JWT: tenantId + role from memberships at login
- [ ] Phase 1.5 — Invite flow activation on auth
- [ ] Phase 1.6 — Open signup support
- [x] Phase 2.1 — Audit search API routes for tenant scoping
- [x] Phase 2.2 — Audit content API routes (collections, categories, languages, books)
- [x] Phase 2.3 — Audit user data API routes (likes, highlights, history, comparisons)
- [x] Phase 2.4 — Atlas Search index update with `tenant_id` filter field
- [x] Phase 2.5 — Verification: cross-tenant isolation tests
- [x] Phase 3.1 — Move tenant admin routes to `[tenant]/admin/`
- [x] Phase 3.2 — Move platform admin routes to `/platform/`
- [x] Phase 3.3 — Impersonation
- [ ] Phase 4 — Pipeline isolation + quota
- [ ] Phase 5 — R2 path migration + sitemap/robots
- [ ] Phase 6 — Isolation test suite
