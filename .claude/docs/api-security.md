# API Security Strategy

## Current State (Feb 2026)

- **DELETE blocking**: proxy.ts blocks all DELETE requests globally
- **No authentication**: All API routes are publicly accessible
- **No rate limiting**: No request throttling anywhere
- **Cron routes**: Unprotected — anyone who knows the URL can trigger them

## Vulnerabilities (Priority Order)

### 1. Rate Limiting (Critical)

No rate limiting exists. All routes are vulnerable to abuse.

**Created but not yet wired up:** `src/lib/rate-limit.ts` — in-memory per-instance rate limiter with preset configs for public/expensive/write/cron routes. Needs to be integrated into proxy.ts or individual routes.

**Presets defined:**
- `public`: 60 req/min (search, gallery, books, entities)
- `expensive`: 10 req/min (analytics/usage, processing dashboard)
- `write`: 20 req/min (imports, processing triggers)
- `cron`: 5 req/min

**To upgrade later:** Replace in-memory store with Vercel KV or Upstash Redis for global (cross-instance) limiting.

### 2. ReDoS in Entities Route (Critical, Easy Fix)

`src/app/api/entities/route.ts:55-59` passes user input directly to `$regex` without escaping. Craft a malicious regex pattern and the query hangs.

**Fix:** Add `escapeRegex()` before passing to `$regex`:
```typescript
const escapedQuery = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
filter.$or = [
  { name: { $regex: escapedQuery, $options: 'i' } },
  { aliases: { $regex: escapedQuery, $options: 'i' } }
];
```

### 3. Cron Route Auth (High)

proxy.ts explicitly bypasses cron routes — they're fully public. Anyone who discovers `/api/cron/social-post` can trigger tweet posting. None of the 8 cron routes check `CRON_SECRET`.

**Fix:** In proxy.ts, check `Authorization: Bearer <CRON_SECRET>` header for `/api/cron/*` paths. Vercel automatically sends this header when it triggers cron jobs if `CRON_SECRET` is set in env.

### 4. Max Query Length (Medium)

Search routes enforce min 2 chars but no maximum. An attacker could send a massive query string causing expensive regex operations.

**Fix:** Add `query.length > 500` check to `/api/search`, `/api/search/unified`, `/api/search/index`, `/api/entities`.

### 5. Admin/Write Route Auth (Deferred)

A JWT-based auth system was implemented in proxy.ts with role-based rules (admin/editor/contributor) but rolled back. When re-implementing:

- The auth rules were: admin for `/api/admin/*` and social POST, editor for imports/jobs/book mutations/page mutations, contributor for annotations/highlights
- Used `next-auth/jwt` `getToken()` to decode session cookie
- Role hierarchy: reader < contributor < editor < admin
- Public exceptions: book chat/search/quote subroutes, `/api/users/me`

### 6. Cost Exposure (Medium)

These public routes run expensive MongoDB aggregations:
- `/api/analytics/usage` — 10+ parallel aggregations, 60s timeout
- `/api/gallery` — `$lookup` + `$unwind` + `$facet` with `allowDiskUse: true`
- `/api/admin/processing-dashboard` — nested `$lookup` across all books

Rate limiting (fix #1) partially addresses this. Full fix requires auth on admin routes.

## What's Already Good

- Regex escaping in all search routes (`escapeRegex()` helper)
- Numeric limit capping with `Math.min()` on all paginated routes
- Security headers: CSP, HSTS, X-Frame-Options, X-Content-Type-Options
- No secrets in code, no `.env` files committed
- Import routes check for duplicates (409 Conflict)
- No dangerous MongoDB operators (`$where`, `$function`, `eval`)
