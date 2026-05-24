# UI & Navigation

Operational reference for frontend work. For design tokens, see `.claude/docs/style-system.md`. For search, see `.claude/docs/search.md`.

## Critical Rules

- Always use `bookUrl(book)` for internal links (slug-based). Hex IDs break client navigation.
- Never store `/api/image?url=` as `book.thumbnail` — crashes Next.js `<Image>` SSR.
- Use `navigator.sendBeacon()` for analytics, never axios.
- Wrap `useSearchParams()` in Suspense boundary — triggers BAILOUT_TO_CLIENT_SIDE_RENDERING.
- DELETE blocked globally by `src/proxy.ts` safety middleware — use POST-based admin routes.

## Layout System

- `ContentPageLayout` + `SubPageHeader` for all about/ and content pages
- `SiteHeader` with `variant="light"` for light backgrounds
- `GlobalFooter` for all pages (old `Footer.tsx` is dead code)
- Container width: `max-w-[var(--container-standard)]`

## Navigation Structure

- `/` — Home (hero + featured books + collections)
- `/{tenant}/book/[slug]` — Primary book detail route (root `/book/[slug]` is legacy-redirected by middleware)
- `/collections/[slug]` — Global collection detail route (shared across all tenants, contains cross-tenant books)
- `/{tenant}/gallery/image/[id]` — Primary gallery image route (root `/gallery/image/[id]` is legacy-redirected)
- `/browse`, `/catalog`, `/explore`, `/search` — Discovery surfaces (all global / non-tenant per the 2026-04-29 lesson below)
- `/librarian`, `/podcast`, `/blog`, `/artwork` — Reading-room features
- `/about/*` — Content pages (`faq`, `sources`, `research`, `progress`, `by-the-numbers`, `processing`)
- `/admin/*` — Admin dashboard (auth-gated). Includes `/admin/system-map` for the interactive architecture diagram.
- `/developers`, `/for-libraries`, `/for-researchers`, `/founding-donors`, `/ficino-society` — Partner / outreach pages

## Lessons Learned

- **Global vs tenant route scope must be explicit (2026-04-29):** Keep root nav routes (`/collections`, `/gallery`, `/browse`, `/explore`, `/librarian`, `/podcast`, `/search`) non-tenant and cross-tenant. Tenant-prefixed equivalents are tenant-scoped except Explore, which is global-only and should canonicalize `/{tenant}/explore...` to `/explore...` in `src/proxy.ts`.
- **Designer review feedback (2026-03-18) (verify):** Reduce container widths, fix navbars, avoid AI-sounding writing, fix pagination, reduce dark gradients.
- **Book URLs must use slugs (2026-03-16) (verify):** Hex ObjectIds break client-side navigation due to Next.js routing. Always use `bookUrl(book)`.
- **Hydration mismatches from Date formatting:** Use `suppressHydrationWarning` on date elements or format server-side only.
- **Platform nav hydration stability (2026-04-21):** Keep initial SSR/CSR tree shape deterministic in layout/nav (avoid adding/removing top-level wrappers during first client render). For client-only banners, render after mount to prevent recoverable hydration mismatch.
- **Tenant gallery must enforce scope in both links and APIs (2026-04-27):** Tenant-prefixed URLs alone are insufficient. `/[tenant]/gallery/image/[id]` links, in-page navigation, and `/api/gallery*` lookups must all filter by tenantId resolved from request context (slug header fallback) to prevent cross-tenant image access.
