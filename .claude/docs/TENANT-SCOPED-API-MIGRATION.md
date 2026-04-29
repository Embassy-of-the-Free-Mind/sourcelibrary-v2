# Tenant-Scoped API Migration

**Status:** Phase 2 (API Layer Tenant Scoping) — Not started  
**Priority:** Critical before Phase 2 deployment  
**Architecture Reference:** [tenant-architecture.md](../../tenant-architecture.md) (Phase 2)

---

## Overview

Currently, ~40-50 API routes call `getTenantContextFromRequest()` but are NOT under `[tenant]` path, causing them to receive invalid headers from the proxy. This is a band-aid situation that violates the tenant isolation contract.

**Fix:** Move all these routes under `/api/[tenant]/...` so the proxy correctly injects tenant headers.

---

## API Routes to Migrate

### Critical (User-Facing Page Viewer)
**These are called directly from tenant-scoped pages and must work correctly.**

#### Pages APIs
- `/api/pages/[id]` → `/api/[tenant]/pages/[id]` (GET, PATCH, DELETE)
- `/api/pages/batch` → `/api/[tenant]/pages/batch` (POST)
- `/api/pages/[id]/ocr` → `/api/[tenant]/pages/[id]/ocr` (POST)
- `/api/pages/[id]/translate` → `/api/[tenant]/pages/[id]/translate` (POST)
- `/api/pages/[id]/summarize` → `/api/[tenant]/pages/[id]/summarize` (POST)
- `/api/pages/[id]/detect-split` → `/api/[tenant]/pages/[id]/detect-split` (POST)
- `/api/pages/[id]/split` → `/api/[tenant]/pages/[id]/split` (POST)
- `/api/pages/[id]/snapshot` → `/api/[tenant]/pages/[id]/snapshot` (POST)
- `/api/pages/[id]/snapshots` → `/api/[tenant]/pages/[id]/snapshots` (GET)
- `/api/pages/[id]/restore` → `/api/[tenant]/pages/[id]/restore` (POST)
- `/api/pages/[id]/ask` → `/api/[tenant]/pages/[id]/ask` (POST)
- `/api/pages/[id]/modernize` → `/api/[tenant]/pages/[id]/modernize` (POST)
- `/api/pages/[id]/transliterate` → `/api/[tenant]/pages/[id]/transliterate` (POST)

#### Books APIs
- `/api/books/[id]` → `/api/[tenant]/books/[id]` (GET, PATCH, DELETE)
- `/api/books/[id]/pages` → `/api/[tenant]/books/[id]/pages` (GET)
- `/api/books/[id]/batch-ocr-async` → `/api/[tenant]/books/[id]/batch-ocr-async` (POST)
- `/api/books/[id]/batch-ocr-multi` → `/api/[tenant]/books/[id]/batch-ocr-multi` (POST)
- `/api/books/[id]/batch-translate-async` → `/api/[tenant]/books/[id]/batch-translate-async` (POST)
- `/api/books/[id]/search` → `/api/[tenant]/books/[id]/search` (GET)
- `/api/books/[id]/download` → `/api/[tenant]/books/[id]/download` (GET)
- `/api/books/[id]/extract-chapters` → `/api/[tenant]/books/[id]/extract-chapters` (POST)
- `/api/books/[id]/reorder` → `/api/[tenant]/books/[id]/reorder` (POST)
- `/api/books/[id]/sections` → `/api/[tenant]/books/[id]/sections` (GET)
- `/api/books/[id]/sections/summarize` → `/api/[tenant]/books/[id]/sections/summarize` (POST)
- `/api/books/[id]/index` → `/api/[tenant]/books/[id]/index` (GET, POST)
- `/api/books/[id]/editions` → `/api/[tenant]/books/[id]/editions` (GET, POST, PATCH, DELETE)
- `/api/books/[id]/editions/[editionId]` → `/api/[tenant]/books/[id]/editions/[editionId]` (GET, PATCH, DELETE)
- `/api/books/[id]/editions/front-matter` → `/api/[tenant]/books/[id]/editions/front-matter` (POST)
- `/api/books/[id]/editions/mint-doi` → `/api/[tenant]/books/[id]/editions/mint-doi` (POST)
- `/api/books/[id]/chat` → `/api/[tenant]/books/[id]/chat` (GET, POST)
- `/api/books/[id]/history` → `/api/[tenant]/books/[id]/history` (GET)
- `/api/books/[id]/quote` → `/api/[tenant]/books/[id]/quote` (GET)
- `/api/books/[id]/pipeline` → `/api/[tenant]/books/[id]/pipeline` (GET, POST)
- `/api/books/[id]/pipeline/step` → `/api/[tenant]/books/[id]/pipeline/step` (POST)

#### User Interaction APIs
- `/api/likes` → `/api/[tenant]/likes` (GET, POST)
- `/api/likes/popular` → `/api/[tenant]/likes/popular` (GET)
- `/api/likes/mine` → `/api/[tenant]/likes/mine` (GET)
- `/api/reading-history` → `/api/[tenant]/reading-history` (GET, POST)
- `/api/reading-history/clear` → `/api/[tenant]/reading-history/clear` (POST)

#### Analytics APIs
- `/api/analytics/stats` → `/api/[tenant]/analytics/stats` (GET)
- `/api/analytics/track` → `/api/[tenant]/analytics/track` (POST)
- `/api/analytics/canon` → `/api/[tenant]/analytics/canon` (GET)
- `/api/analytics/pipeline-velocity` → `/api/[tenant]/analytics/pipeline-velocity` (GET)
- `/api/analytics/pipeline` → `/api/[tenant]/analytics/pipeline` (GET)
- `/api/analytics/usage` → `/api/[tenant]/analytics/usage` (GET)

#### Processing & Jobs APIs
- `/api/process/batch` → `/api/[tenant]/process/batch` (POST)
- `/api/process/route.ts` → `/api/[tenant]/process/route.ts` (POST)

---

### High Priority (Admin Operations)
**Called from admin UI pages, not critical path but require isolation.**

- `/api/extract-images` → `/api/[tenant]/extract-images` (POST, GET)
- `/api/highlights` → `/api/[tenant]/highlights` (GET, POST)
- `/api/highlights/[id]` → `/api/[tenant]/highlights/[id]` (GET, PATCH, DELETE)
- `/api/comparisons` → `/api/[tenant]/comparisons` (GET, POST)
- `/api/comparisons/stats` → `/api/[tenant]/comparisons/stats` (GET)
- `/api/learn` → `/api/[tenant]/learn` (GET)
- `/api/scan/recent` → `/api/[tenant]/scan/recent` (GET)

---

### Medium Priority (Browse & Listing)
**These may be called from tenant search, require scoping.**

- `/api/books` → `/api/[tenant]/books` (list books in tenant) (GET, POST)
- `/api/books/library` → `/api/[tenant]/books/library` (tenant-specific search) (GET)
- `/api/books/browse` → `/api/[tenant]/books/browse` (tenant-specific browse) (GET)
- `/api/books/timeline` → `/api/[tenant]/books/timeline` (GET)
- `/api/books/status` → `/api/[tenant]/books/status` (GET)
- `/api/books/facets` → `/api/[tenant]/books/facets` (GET)
- `/api/progress` → `/api/[tenant]/progress` (GET)

---

### Keep at Root (Platform/Global Operations)
**These should NOT be tenant-scoped — they're platform operations.**

- `/api/books/search` - global search (optional: tenant filter via query param)
- `/api/books/roadmap` - system-wide planning
- `/api/books/deleted` - system admin view
- `/api/books/restore/[id]` - admin restore (consider: cross-tenant admin only)
- `/api/books/migrate-categories` - admin operation
- `/api/cron/*` - system operations (fire-and-forget, all tenants)
- `/api/admin/*` - admin operations (superadmin only via `/_platform/`)
- `/api/platform/*` - platform operations
- `/api/config` - system config (cache aggressive)
- `/api/health` - health checks
- `/api/auth/*` - authentication
- `/api/dts/document` - DTS API (can add tenant filter if public)
- `/api/oai/` - OAI-PMH (can add tenant filter if public)
- `/api/debug/*` - debug utilities (guard behind auth)

---

## Migration Steps

### Step 1: Create Directory Structure
```bash
mkdir -p src/app/api/\[tenant\]/pages
mkdir -p src/app/api/\[tenant\]/books
mkdir -p src/app/api/\[tenant\]/likes
mkdir -p src/app/api/\[tenant\]/highlights
mkdir -p src/app/api/\[tenant\]/reading-history
mkdir -p src/app/api/\[tenant\]/analytics
mkdir -p src/app/api/\[tenant\]/process
mkdir -p src/app/api/\[tenant\]/comparisons
mkdir -p src/app/api/\[tenant\]/extract-images
mkdir -p src/app/api/\[tenant\]/learn
mkdir -p src/app/api/\[tenant\]/scan
```

### Step 2: Move Route Files
For each API route, follow this pattern:

**Before:**
```
src/app/api/pages/[id]/route.ts
```

**After:**
```
src/app/api/[tenant]/pages/[id]/route.ts
```

Update imports and parameter extraction:
```typescript
// Before
const { params }: { params: Promise<{ id: string }> } = ...

// After
const { params }: { params: Promise<{ tenant: string; id: string }> } = ...
const { tenant, id } = await params;
```

### Step 3: Update Client-Side Calls
Any client code making these API calls must include the tenant in the URL:

**Before:**
```typescript
fetch(`/api/pages/${pageId}`)
fetch(`/api/books/${bookId}`)
```

**After:**
```typescript
const tenantPrefix = useParams<{ tenant: string }>().tenant;
fetch(`/api/${tenantPrefix}/pages/${pageId}`)
fetch(`/api/${tenantPrefix}/books/${bookId}`)
```

Or use a helper:
```typescript
function getTenantApiUrl(tenant: string, path: string): string {
  return `/api/${tenant}${path}`;
}

fetch(getTenantApiUrl(tenant, `/pages/${pageId}`))
```

### Step 4: Update All MongoDB Queries
Add `tenantId` filter to every query. Use `getTenantContextFromRequest(request)` which now throws if called incorrectly:

```typescript
const { id: tenantId } = getTenantContextFromRequest(request);
const pages = await db.collection('pages').find({ id: pageId, tenantId });
```

### Step 5: Update lib/api-client
Update all API client functions in `src/lib/api-client/*.ts` to include tenant parameter or accept it from context.

### Step 6: Test Cross-Tenant Isolation
For each migrated API:
1. Call from tenant-alpha context → should return data scoped to tenant-alpha
2. Call from tenant-beta context → should return 404 or empty results
3. Craft malicious header → should be rejected by proxy

---

## Expected Errors During Migration

**Before migration complete:**
```
TypeError: getTenantContextFromRequest: received invalid headers object.
API route must be under /api/[tenant]/... for proper tenant context.
```

This error is **intentional** — it enforces the contract. Every API calling `getTenantContextFromRequest()` must be under `[tenant]`.

**After migration complete:**
Error should disappear entirely. If you still see it, there's an orphaned API route not yet migrated.

---

## Verification Checklist

- [ ] All 40+ routes moved under `/api/[tenant]/...`
- [ ] All MongoDB queries include `tenantId` filter
- [ ] All client-side API calls include tenant in URL
- [ ] Cross-tenant isolation tests pass
- [ ] No errors from strict `getTenantContextFromRequest()`
- [ ] E2E tests: navigate between pages in different tenants, verify data isolation

---

## Timeline Estimate

- **Inventory & Planning:** 1 hour
- **Directory structure & file moves:** 2 hours
- **MongoDB query updates:** 4 hours (largest change)
- **Client-side URL updates:** 2 hours
- **Testing & validation:** 2 hours
- **Total:** ~11 hours spread across 1-2 days

Consider splitting into focused PRs by domain (pages, books, likes, analytics, etc.) for reviewability.
