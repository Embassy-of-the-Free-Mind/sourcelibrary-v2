# Tenant Architecture Audit — 2026-05-23

**Trigger:** the AI librarian surfaced a Bhutanese Buddhist book (`mkha-gro-snying-thig-gi-bla-ma-i-rnal-byor-collection`) on the main `sourcelibrary.org` host. The link 404'd because the book carries `tenant_id: bhutan` and the main-site book route filters by tenant. Derek thought only `bph` and `kloss` were real tenants — so where did `bhutan` come from, and how many other surprises are lurking?

## TL;DR

There are **three distinct things all called "tenant"** in the codebase, with three overlapping fields on the `books` collection, populated by at least two different import waves. BPH is the only real partner subdomain in production. Kloss is a unified-catalogue partner using a different model (Supabase `library_catalog_records`, not Mongo `tenant_id`). Bhutan is an EAP/British Library import that got `tenant_id: bhutan` stamped on it but never had a subdomain stood up — it's stuck in limbo. The librarian leaks all of it because the semantic search RPC explicitly dropped tenant filtering in PR #1780 ("was causing PGRST202") and no one ever added it back.

## 1. The three concepts being called "tenant"

| Concept | Where it lives | Example | What it should be called |
|---|---|---|---|
| Subdomain partner with isolated UI | `tenants` collection + hardcoded in `src/proxy.ts:185-189` | `bph.sourcelibrary.org` → tenant `bph` | **Subdomain tenant** (true tenant) |
| Unified-catalogue partner using Supabase `library_catalog_records.tenant_id` | `tenants` row + `src/lib/library-partners.ts:231-241` | `kloss-collection`, future Kloss-like partners | **Catalogue partner** |
| Source provider / contributing library | `tenants` row (created by `scripts/maintenance/create-all-provider-tenants.mjs`) + `image_source.provider` on books | Gallica, Bodleian, Wellcome, Internet Archive | **Source provider** |

All three live in the same `tenants` Mongo collection with no `kind` / `type` field to distinguish them. That's the root design flaw — there's no schema-level signal telling code which kind of "tenant" a row is.

## 2. The data — what's actually on books

### `tenant_id` (Mongo, slug-string)
- `default`: 43,251
- `bhutan`: 1,325 ← the surprise
- one orphan ObjectId `6914683048ab298bc53ef5ea`: 1
- (none): 1,135

So **only one non-default `tenant_id` value exists on books**: `bhutan`. Everything else is `default` or missing.

### `held_by` (Mongo, array-of-string — legacy provider marker)
Top values: `bph` (3,583), `mdz` (1,423), `iiif` (1,412), `e-rara` (1,094), `bsb` (942), then a long tail of provider slugs. `cmc_kloss` shows up at 1,521.

### `image_source.provider` (Mongo, single string — modern provider marker)
Top values: `wikimedia_commons` (21,598), `internet_archive` (8,303), `bph` (2,362), `rijksmuseum` (1,888), `cmc_kloss` (1,521), `mdz` (1,426), `bl` (1,343), `e-rara` (1,150). 699 books have no provider at all.

Note the BPH discrepancy: `held_by:'bph'` = 3,583 books, `image_source.provider:'bph'` = 2,362 books. The legacy `held_by` field has 1,221 BPH books that the newer field doesn't. That's a backfill gap from the `image_source` migration, not a tenant issue, but it means BPH-scoped queries that pick the wrong field get wrong counts.

### `collections` (Mongo, array — editorial tags)
Top values are editorial: `visual-art`, `natural-philosophy`, `alchemy`, `hermetica`. But **`bhutan` is in there too — 1,252 books** — used as both an editorial collection AND a tenant_id. Same string, two semantics.

### Supabase `library_catalog_records.tenant_id`
Holds `kloss-collection` (1,521 records). This is Kloss's actual home — Mongo `books` is not the source of truth for Kloss browsing.

## 3. The `tenants` collection — 33 docs, three kinds blended

From `scripts/maintenance/create-all-provider-tenants.mjs` (bulk insert):
- True subdomain tenants: `bph`, plus `kloss-collection` (catalogue-only, no subdomain wired yet despite proxy.ts mentioning it)
- 30 source providers: `gallica`, `bodleian`, `cambridge`, `e-rara`, `wellcome-collection`, `vatican-library`, `hab-wolfenbuettel`, `hathi-trust`, `europeana`, `manchester`, `allard-pierson`, `laurenziana`, `leiden`, `e-codices`, `chester-beatty`, `ndl-japan`, `library-of-congress`, `british-library`, `sbb-berlin`, `austrian-national-library`, `yale-beinecke`, `harvard-houghton`, `penn-schoenberg`, `huntington`, `getty`, `kyoto`, `bavarian-state-library`, `google-books`, `internet-archive`, `default`
- One meta: `all`

There is **no row for `bhutan`** even though 1,325 books carry `tenant_id: 'bhutan'`. That's why proxy resolution fails on the main host — `resolveActiveTenant('bhutan')` returns nothing.

## 4. Where Bhutan came from

Git timeline:
- **2026-04-23 (ace15c70, 4df0bff6):** Blog post "Benchmarking AI OCR on 232K Bhutanese manuscripts"
- **2026-04-30 (5a53a405):** "Fix bhutan embed import path after tenant refactor" → confirms a `/embed/bhutan/` directory existed
- **2026-04-30 (a2c3a809):** "Fix bhutan embed catalogue: redirect to search instead of broken component" → already half-broken
- Source: British Library EAP (Endangered Archives Programme) project EAP105, IIIF manifests at `eap.bl.uk`
- `created_at` on the sampled book was around the 2026-04-21 image_source.access_date

So: in late April 2026 someone imported ~1,325 Bhutanese monastery texts (Ogyen Choling, Gangtey, Drametse, Neyphug) from the British Library EAP. The importer stamped `tenant_id: 'bhutan'` AND added them to `collections: ['bhutan']`. A `/embed/bhutan/` route was scaffolded. Then it stalled — no subdomain provisioned, no `tenants` row created, no live face. The blog post went out but the books became invisible everywhere except direct slug lookup, and even there only on the (nonexistent) Bhutan subdomain.

The temp-script trail (`scripts/_tmp-bhutan-cost-breakdown.mjs`, `_tmp-bhutan-cost-estimate.mjs`, `_tmp-bhutan-missing-records.mjs`) suggests this was an exploratory import that didn't get cleaned up.

## 5. Where Kloss is (it's actually well-populated)

- 1,521 books in Mongo with `held_by:'cmc_kloss'` and `image_source.provider:'cmc_kloss'`
- 1,521 records in Supabase `library_catalog_records` with `tenant_id:'kloss-collection'`
- `kloss.sourcelibrary.org` is mapped in `src/proxy.ts:187` but DNS isn't resolving (verified separately)
- `src/lib/library-partners.ts:231-241` defines `kloss-collection` with `hasUnifiedCatalogue: true`
- Routes exist: `/embed/kloss-collection/page.tsx`, `/embed/kloss-collection/catalog/[ubn]/page.tsx`
- Phase 1-3 work landed in PRs #1887, #1889, #1898 (Oct-Nov 2025)

So Kloss is wired in code, populated in both DBs, and just needs DNS + a designed landing page to launch.

## 6. The librarian leak — root cause

`scripts/migration/add-match-semantic-rpc.sql:26-27`:
> "Tenant filter: page_translations doesn't currently carry a tenant_id column, so we accept the parameter for API compatibility but ignore it."

And PR **#1780 (70a44dcf):** "Fix: drop filter_tenant_id from match_books_semantic (was causing PGRST202)" — when the SQL function signature drifted, someone removed the param entirely rather than fix it.

Net effect: `src/lib/semantic-search.ts:60` accepts a `tenantId` option but never sends it to Supabase. The librarian (`src/lib/embassy/librarian.ts:315-363`) calls `semanticBookSearch(query, 8)` with zero filter args. Books from any tenant — including `bhutan`'s 1,325 drafts — surface to main-site users, who then click through to a `/book/...` URL that 404s because the book route IS tenant-scoped.

Three filters are missing from the semantic path:
- `status: { $ne: 'draft' }`
- `hidden: { $ne: true }`
- `tenant_id` scoped to the request's resolved tenant (or `default` for the main host)

Keyword search (`buildBookSearchStage` in `src/lib/atlas-search.ts:35`) filters `hidden != true` but not `status` and not `tenant_id`. Same leak, different code path.

## 7. Cleanup plan (proposed — for decision, not action)

### Naming
Stop calling all three things "tenant." Suggested split:
- **Tenant** (subdomain partner) → keep this name, but add a `kind: 'subdomain'` field. Today: just `bph`. Tomorrow: kloss when DNS lands.
- **CataloguePartner** (Supabase-only unified-catalogue) → today: `kloss-collection`. Same row in `tenants` could carry `kind: 'catalogue'` if we don't split tables.
- **Provider** (source library / where books came from) → move out of `tenants` into a new `providers` collection, or add `kind: 'provider'`. 30 rows.

The cheapest first move is adding a `kind` field to existing `tenants` docs and updating `resolveActiveTenant` to filter by kind for subdomain routing. No table split, no rename, just a flag.

### Bhutan
Three options, pick one:
- **(a) Promote to real tenant.** Provision DNS for `bhutan.sourcelibrary.org`, add `tenants` row with `kind: 'subdomain'`, build a landing page. The 1,325 books are already tagged and ready. Aligns with the blog post that's already published.
- **(b) Demote to collection only.** Drop `tenant_id: 'bhutan'` from all 1,325 books (set to `default`), keep `collections: ['bhutan']`. Books become visible on the main site under the Bhutan collection. Cheapest path; loses the partner-face story.
- **(c) Keep as-is but hide.** Set `hidden: true` on all 1,325 books, leave `tenant_id` intact, mark for future activation. Clean for now; book pages 404 silently.

### Librarian leak (urgent regardless of tenant cleanup)
Add three filters to both search paths:
- `match_books_semantic` RPC: re-add `filter_tenant_id` parameter and add `filter_status`, `filter_hidden`. Fix the original PGRST202 by aligning function signature instead of dropping params.
- `match_semantic` RPC: add `status`/`hidden` joins through `books_catalog`. Document the `tenant_id`-absence on `page_translations` and either add the column or filter via the join.
- `buildBookSearchStage` (Atlas keyword): add `status: { $ne: 'draft' }` and a tenant filter.
- `src/lib/embassy/librarian.ts`: thread the request's resolved tenant_id into both `semanticBookSearch` and `executeSearchCollection`.

### Orphan ObjectId book
One book has `tenant_id: '6914683048ab298bc53ef5ea'` (an ObjectId where a slug should be). Find it, fix it.

## 8. Open questions for Derek

1. **Bhutan:** option (a), (b), or (c)? The published blog post nudges toward (a).
2. **Provider/tenant split:** add a `kind` field now, or wait until we have a second real subdomain tenant?
3. **Librarian leak:** fix immediately (1-day patch) or bundle with the broader tenant cleanup?
4. **`/embed/bhutan/*` routes:** delete or keep wired for future activation?
5. **HTTP 200 on Book-Not-Found:** the route returns 200 with a "Book Not Found" body. Fix to a proper 404? (separate small bug)

## Sources

- Mongo aggregations on `books`, `tenants`, `deleted_books` (this session)
- `src/proxy.ts:185-189, 240-288, 363-412, 576-654`
- `src/lib/embed-ui-policy.ts:1-46`
- `src/lib/semantic-search.ts:57-89`
- `src/lib/embassy/librarian.ts:252-363`
- `src/lib/atlas-search.ts:35-65`
- `src/lib/library-partners.ts:231-241`
- `scripts/migration/add-match-semantic-rpc.sql:26-27`
- `scripts/maintenance/create-all-provider-tenants.mjs`
- Git history: `git log -S 'tenant_id'`, `git log --diff-filter=A -- 'scripts/**bhutan**'`
- PRs: #1780, #1887, #1889, #1898, #1871, #1768, #1767

---

*One gap in this audit:* the third Mongo query (bhutan import-date histogram and BPH tagging cross-tab) had a syntax error and didn't run. The headline numbers above are from queries that did succeed; the Explore-agent claim that "Bhutan books are stored with `tenant_id: 'default'`" contradicts direct Mongo aggregation showing 1,325 with `tenant_id: 'bhutan'` — trust the direct aggregation.
