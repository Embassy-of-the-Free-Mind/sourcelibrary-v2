# RLS Phase 3: `library_catalog_records` lockdown — design (2026-05-25)

**Status:** design proposal for #1981 Phase 3. Not yet implemented.

## The problem

`library_catalog_records` is currently anon-readable via the public anon key. After Phases 1 / 2 / 4 (all merged 2026-05-25), this is the only remaining table in issue #1981 with the original exposure.

Quick anon probe (still 200 as of 2026-05-25 21:39 UTC):

```bash
curl -sS "$SUPABASE_URL/rest/v1/library_catalog_records?select=*&limit=1" \
  -H "apikey: $SUPABASE_ANON_KEY" -H "Authorization: Bearer $SUPABASE_ANON_KEY"
# returns: HTTP 200 + row with full bibliographic + tenant_id
```

Today only `kloss-collection` data lives here (1,614 rows). The exposure is low-impact while only one tenant is in the table — but the design needs to be settled **before** more tenants (Jung, BPH State, partner libraries from #1878 Phase 6+) start populating it, because once cross-tenant data is there a misfire becomes a real cross-tenant leak.

## Why Phase 3 is different from Phases 1 / 2 / 4

| | Phase 1 (PII) | Phase 2 (telemetry) | Phase 4 (public catalog) | Phase 3 (library_catalog_records) |
|---|---|---|---|---|
| Who reads it? | App server only | App server only | Public site (anon) | Public site (anon, **scoped to one tenant per request**) |
| What goes wrong with anon SELECT? | Visitor PII leak | AI cost surveillance | Anon could mutate the catalog | Anon could read **other tenants'** catalogs |
| Solution | `service_role`-only | `service_role`-only | anon SELECT + REVOKE writes | (this design) |

Phase 3 is the only one where the legitimate access path is per-tenant: each request needs to read **just that tenant's** rows.

## Constraints from CLAUDE.md

The "Tenant Subdomain Lockdown" section is unambiguous:

> 2. **Every server query touching a tenant page filters by tenant.** When rendered under `/embed/[tenant]/*` or `/[tenant]/*` with a tenant subdomain host, all data fetches must include the tenant constraint. The default for `held_by` / `image_source.provider` (Supabase) and `tenantId` (Atlas) is GLOBAL — explicit filtering is required.

Today every `library_catalog_records` query already complies — they all `.eq('tenant_id', tenant)`. The bug class is "a future query forgets to filter" — solvable in code review, but RLS is the architectural belt-and-braces.

## Consumers (full audit, 2026-05-25)

Every server-side caller of `library_catalog_records`:

| File | Operation | Tenant filter | Client |
|---|---|---|---|
| `src/app/api/catalog/[tenant]/route.ts` | SELECT with search/filter | `.eq('tenant_id', tenant)` ✓ | anon `supabase` |
| `src/app/api/cron/sync-catalog-sl-book-ids/route.ts` | SELECT + UPDATE | (per tenant, looped) | anon `supabase` |
| `src/lib/tenant-library-loaders.ts` | SELECT count + per-row reads | `.eq('tenant_id', tenantSlug)` ✓ | anon `supabase` |
| `src/lib/library-partners.ts` | SELECT (catalog-id → sl_book_id map) | `.eq('tenant_id', tenant)` ✓ | anon `supabase` |
| `src/app/embed/[tenant]/catalog/[ubn]/page.tsx` | SELECT one row | implicit via URL params | anon `supabase` (server-rendered) |
| `src/app/embed/[tenant]/catalog/[ubn]/GenericCatalogEntry.tsx` | renders fetched row | n/a | n/a |
| `src/app/[tenant]/page.tsx` | server-rendered tenant home | `.eq('tenant_id', tenant)` ✓ | anon `supabase` |
| `src/components/libraries/CatalogBrowser.tsx` | comment only, fetches via API | n/a (fetches `/api/catalog/[tenant]`) | n/a |
| `src/components/libraries/SharedLibraryView.tsx` | comment only, fetches via API | n/a | n/a |

**Zero direct client-side queries.** All access is server-rendered or via API routes that already filter by tenant.

Writer: `scripts/migration/backfill-library-catalog-records-from-bph.mjs` or similar (when Kloss / other tenants are imported) — service-role.

## Four options considered

### Option 1: JWT-claim-based RLS — REJECTED

Encode `tenant_id` in the JWT, use `USING (tenant_id = (auth.jwt() ->> 'tenant_id'))`.

**Why this doesn't work for us:** the catalog is publicly accessible without auth. Anonymous visitors browsing `kloss.sourcelibrary.org/catalog` have **no JWT** — the anon key has no embedded claims. Adding "users must sign in to see the catalog" contradicts the product (the catalog is public per-tenant).

A variant — a custom JWT minted per-request by the app with the tenant_id baked in — would require coordinating JWT minting with every server-rendered page. Substantial code change for marginal benefit over Option 2.

### Option 2: Request-header-based RLS — REJECTED

PostgREST exposes incoming HTTP headers to RLS policies via `current_setting('request.headers')::json`. The app sets `X-Tenant-Id` on every catalog read; the policy filters on it.

**Why this doesn't work:** the anon key allows arbitrary direct PostgREST calls. A malicious client can simply omit the header (or set whatever value they want). The policy can't tell "header from app" vs "header from curl". This isn't a security control at all when the client controls the key.

### Option 3: SECURITY DEFINER RPC functions — REJECTED for scope

Define `get_catalog(tenant_text, ...)` and `get_catalog_entry(tenant_text, ubn)` as `SECURITY DEFINER` PL/pgSQL functions; lock the underlying table to `service_role` only; grant `EXECUTE` on the functions to `anon`. The function bodies enforce the tenant filter.

**Why not now:** strongest invariant, but it forces a refactor of 6+ consumer files into RPC calls (`supabase.rpc('get_catalog', { tenant_text: tenant, ... })`). The current ad-hoc query DSL with chained `.eq()`, `.ilike()`, `.or()`, `.range()`, `.order()` is hard to reproduce as a function signature; would need to either pass JSON params or define multiple specialized functions. Worth doing eventually if we add more tenant-aware tables, but disproportionate for one table that already has consistent app-side filtering.

### Option 4: Service-role-only + app-layer filter (Phase 1/2 model) — RECOMMENDED

Lock `library_catalog_records` to `service_role` only — same as `gemini_usage` and `analytics_pageviews`. Switch the 6 consumer files from `supabase` to `supabaseAdmin`. The app-layer `.eq('tenant_id', tenant)` filter remains as the per-request boundary; the DB layer enforces that only the app (not direct anon callers) can read at all.

**Pros:**
- Same playbook as Phases 1 / 2. Predictable, tested today.
- Closes the "direct PostgREST with anon key" attack vector entirely.
- App-layer tenant filter stays as the security boundary (which it already is — every consumer already filters).
- No client-side regressions: no client code queries this table directly today, and the API route at `/api/catalog/[tenant]` is the canonical access path.

**Cons:**
- The tenant filter remains a code-review concern (developer must remember to `.eq('tenant_id', tenant)`). RLS doesn't enforce it at the DB level.
- If we ever need direct anon-readable per-tenant access (e.g., for a static catalog embed on a partner site), we'd need to revisit.

**Mitigation for the code-review concern:** add a CI lint that fails the build if `from('library_catalog_records')` appears anywhere without `.eq('tenant_id', ...)` within the next ~10 lines (or wrap the table access in a helper `loadCatalogRecords(tenant: string, ...)` that bakes the filter in).

## Recommended migration plan

Mirror Phases 1 / 2:

1. **Audit code** (done above): 6 consumer files use `supabase.from('library_catalog_records')`.

2. **SQL migration** (`scripts/migration/rls-lockdown-phase3-catalog.sql`):
   ```sql
   BEGIN;
   ALTER TABLE library_catalog_records ENABLE ROW LEVEL SECURITY;
   CREATE POLICY library_catalog_records_service_all
     ON library_catalog_records FOR ALL TO service_role USING (true) WITH CHECK (true);
   REVOKE SELECT, INSERT, UPDATE, DELETE ON library_catalog_records FROM PUBLIC;
   REVOKE SELECT, INSERT, UPDATE, DELETE ON library_catalog_records FROM authenticated;
   REVOKE SELECT, INSERT, UPDATE, DELETE ON library_catalog_records FROM anon;
   COMMIT;
   ```

3. **Code changes** (6 files):
   - `src/app/api/catalog/[tenant]/route.ts` — `supabase` → `supabaseAdmin`, add null guard
   - `src/app/api/cron/sync-catalog-sl-book-ids/route.ts` — same
   - `src/lib/tenant-library-loaders.ts` — same
   - `src/lib/library-partners.ts` — same
   - `src/app/embed/[tenant]/catalog/[ubn]/page.tsx` — same
   - `src/app/[tenant]/page.tsx` — same

4. **Optional belt-and-braces:** add a `loadCatalogRecord(supabaseAdmin, tenant, ubn)` helper in `tenant-library-loaders.ts` that bakes in `tenant_id`. Migrate consumers to it over time. (Could be its own follow-up.)

5. **Verify post-apply:**
   - Anon probe: `library_catalog_records?select=*&limit=1` with anon key returns **401** (was 200).
   - Per-tenant API still works: `/api/catalog/kloss-collection?limit=5` returns Kloss rows.
   - Cross-tenant attempt (forge a different tenant param) returns the requested tenant's rows only — same as before; the app's `.eq` filter still enforces.

## Expected effort

~1-2 hours, mirroring Phases 1 / 2 timing. Most of the work is the code switch in 6 files plus null guards; the SQL is ~10 lines.

## Decision

Proposing **Option 4** for implementation. It closes the public exposure cleanly with the same proven pattern, doesn't lock us out of future tenants joining the table, and leaves the application-layer tenant filter as the per-request boundary. If we later want stronger guarantees (e.g., Option 3 RPC functions), we can layer them on without undoing this work.

## References

- Issue #1981 (parent, 4-phase plan)
- PRs #1997 (Phase 1), #2001 (Phase 2), #2003 (Phase 4)
- CLAUDE.md "Tenant Subdomain Lockdown — CRITICAL"
- Constraint discovered: server-side filter pattern is already universal across the 6 consumers; no client-side direct reads
