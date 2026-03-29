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
- `/library` — Full library browse with filters
- `/book/[slug]` — Book detail with reader
- `/about/*` — Content pages (research, faq, sources, standards, progress)
- `/admin/*` — Admin dashboard (auth-gated)
- `/artwork` — Visual art wing (admin-only for now)
- `/gallery` — Image gallery across all books

## Lessons Learned

- **Designer review feedback (2026-03-18):** Reduce container widths, fix navbars, avoid AI-sounding writing, fix pagination, reduce dark gradients.
- **Book URLs must use slugs (2026-03-16):** Hex ObjectIds break client-side navigation due to Next.js routing. Always use `bookUrl(book)`.
- **Hydration mismatches from Date formatting:** Use `suppressHydrationWarning` on date elements or format server-side only.
