# Content URLs & contributing-library pages

**Read this when:** Adding a route for books/pages/gallery/collections, touching `src/lib/provider-prefix.ts` or `src/lib/library-partners.ts`, or adding a contributing library.

*Split out of `CLAUDE.md` on 2026-08-04. The text is unchanged apart from cross-references repointed to their new files. See `.claude/docs/knowledge-layer.md` for why this tier exists.*

---

Content lives on Source Library. We re-host books from many digital libraries
(Internet Archive, Gallica, Bodleian, Wellcome, …) and we credit them, but a
reader who landed on a book here never has to leave to read it. The URL shape
encodes that:

1. **Books, pages, gallery, collections live at tenant-agnostic URLs.**
   `/book/<slug>`, `/book/<slug>/page/<n>`, `/gallery`, `/gallery/image/<id>`,
   `/collections/<slug>`. Never `/internet-archive/book/foo`,
   `/gallica/gallery`, or any other `/<provider-slug>/*` prefix for content.
   This was patched in two waves: PR #1918 dropped the tenant prefix from
   book-page gallery links; PR #2025 added a proxy-level strip so every
   provider-prefixed URL 308s to its global equivalent. The strip's original
   Mongo lookup (`kind:'provider'` rows in `tenants`) was removed in commit
   8e348991 (providers were wrongly resolving as tenants), which silently
   killed the redirect for ~2 weeks (~770 404s/week in `not_found_reports`).
   PR #2505 restored it as a static lookup in `src/lib/provider-prefix.ts`,
   keyed off `LIBRARY_PARTNERS` with routing tenants excluded — a guard test
   (`tests/unit/provider-prefix-redirect.test.ts`) now pins the proxy wiring.
   Don't reintroduce provider-prefixed content paths, and don't replace the
   static lookup with a `tenants`-collection query.
2. **Each contributing library has its own page on Source Library at
   `/libraries/<slug>`.** The page credits the institution (name, description,
   hero image), shows the books we have from them, and may link out to the
   institution's own site. The `LIBRARY_PARTNERS` lookup in
   `src/lib/library-partners.ts` is the source of truth for this metadata —
   adding a new library is an edit to that file, not a DB change.
3. **Bibliographic data on a specific book may link out.** The
   `book.image_source.source_url` link in `BibliographicInfo.tsx` (and the
   IIIF manifest link beside it) point at the original record for citation
   and scholarly accountability. Keep these — they're per-book provenance,
   not "leave Source Library" prompts.
4. **The `tenants` Mongo collection is for subdomain partners, not for
   contributing libraries.** Subdomain tenants (`bph`, `kloss-collection`,
   `bhutan`) have their own scoped UI under a partner subdomain. The 29
   legacy `kind:'provider'` rows (from when routing doubled as an attribution
   registry) were **deleted on 2026-06-10** — backup at
   `scripts/output/tenants-provider-rows-backup-2026-06-10.json` in Derek's
   main checkout. Don't recreate them (`create-all-provider-tenants.mjs` is
   the legacy writer — don't run it). New contributing libraries go in
   `LIBRARY_PARTNERS`, not in the `tenants` collection.
5. **Segment 0 of a URL is shared by three namespaces, and ownership is
   decided by an ALLOWLIST of tenants — never by a denylist of routes.**
   `/bph/…` (tenant), `/es/…` (locale prefix) and `/book/…`, `/upload`,
   `/encyclopedia/…` (~90 global route roots) all compete for the same
   position. `getTenantSlugFromPathname` in `src/lib/api-client/client.ts`
   used to answer "is this a tenant?" by excluding the global roots from a
   hand-written set, which meant every new route had to remember to register
   itself. It didn't: the set was **39 entries short**, so those pages'
   api-client calls went to `/api/<root>/…` — tenant-scoped, resolving to no
   tenant, answered with a bare 404. On `/es/book/<id>` that surfaced as
   **"Book not found" inside the cover picker** (#4127); on `/upload` it
   meant `POST /api/upload/books` 404'd while `/api/books` was right there
   (#4136). Nothing logged, nothing failed a build, and the `/upload` case
   had been broken long enough that nobody connected the two.
   The resolver now matches `TENANT_ROOT_PATHS` from `src/lib/tenant-roots.ts`
   — a leaf module (no imports, so the browser can read it without pulling in
   `LIBRARY_PARTNERS`) shared with the proxy's own gate, so client and server
   cannot disagree about what a tenant is. Order matters and is the design:
   strip a locale prefix → `/embed/<tenant>/…` reserved slot → allowlist.
   **Adding a tenant means adding it to `TENANT_ROOT_PATHS`; adding a route
   root or a locale means doing nothing at all.** `tests/unit/locale-prefix-not-tenant.test.ts`
   sweeps every directory under `src/app/` and fails if one resolves to a
   tenant. General rule: when two sets compete for a namespace, match the
   small closed one. A wrong allowlist entry is visible on the first page
   load; a missing denylist entry is invisible forever.
