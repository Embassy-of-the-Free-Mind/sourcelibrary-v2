/**
 * Tenant slugs that own real URL space (partner subdomains with scoped UI).
 *
 * This is the ALLOWLIST for "is the first path segment a tenant?" — the one
 * question the proxy and the browser must answer identically. It lives in its
 * own leaf module (no imports) so a client bundle can read it without dragging
 * in `library-partners.ts` and its logo data.
 *
 * Segment 0 of a URL is claimed by three different namespaces: tenants
 * (`/bph/…`), locale prefixes (`/es/…`) and ~90 global route roots
 * (`/book/…`, `/gallery/…`, `/encyclopedia/…`). Deciding by *excluding* the
 * global routes cannot work — that list has to be maintained by hand and
 * silently rots every time a route is added (it was 39 entries short when this
 * module was extracted, which is how `/es/book/<id>` ended up calling
 * `/api/es/books/<id>` and answering "Book not found" in the cover picker).
 * The tenant set is small, closed and already known to the proxy, so match
 * against it and treat everything else as global. A missing entry here fails
 * loudly and immediately (a partner's pages read as global); a missing entry
 * in a denylist fails silently forever.
 *
 * Read by `src/proxy.ts` (via `@/lib/provider-prefix`) and by
 * `src/lib/api-client/client.ts`. Must never overlap with the provider-prefix
 * strip in `provider-prefix.ts` or with `PREFIXED_LOCALES` in `locale-path.ts`.
 */
export const TENANT_ROOT_PATHS = new Set(['bph', 'kloss-collection', 'bhutan']);
