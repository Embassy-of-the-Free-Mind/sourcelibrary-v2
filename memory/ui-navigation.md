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
- **React Compiler hoists member access above conditional JSX guards (2026-07-17, second confirmed instance):** `{cond && <text y={points[12].r} />}` crashed an entire page at hydration (`TypeError: reading 'cents' of undefined`) even though the indexing was source-level guarded by `cond` — the compiled bundle evaluated `points[12]` on first render when the array had one element (PR #3166; first instance was the TranslationEditor bug below). Rule: precompute everything derived as plain scalars/strings at the top of the component; JSX conditionals may render only ready-made values, never index arrays or dot into possibly-undefined objects inline. The crash is invisible to tsc AND to SSR/curl (server HTML renders fine) — only a real browser hydration catches it, so runtime-verify UI changes on the preview before merge.
- **Don't wire interactive state directly into TranslationEditor (2026-06-08):** Adding a `useState` + a root-level conditional lazy overlay inside the 2400-line `TranslationEditor` (reactCompiler on, layout built from an inline IIFE) silently failed — the button's onClick was correctly wired and the gating prop present, but invoking the handler flipped no state and the overlay never mounted (an error boundary swallowed it, logging a bare "Error"). Fix: extract a small self-contained client component that owns its own open-state and renders its own overlay (`PageDeepZoomButton`, mirroring `ArtworkHero`), and drop that into the reader. Lesson: for new interactive bits in that component, prefer a standalone child over inline state. Verify in a real browser — typecheck passes on the broken version.
- **`TranslationEditor` IS the public reader (2026-07-15):** despite the `src/components/pipeline/` path, `TranslationEditor.tsx` is the component behind `/book/[id]/page/[pageId]` (via `PageEditorClient`). Judging it "internal pipeline tooling" by its path nearly left the reader-footer "Leave comment" removal (#3157) undone. Its footer owns LikeButton + nav hint + BookSearchBar; comments UI was removed after the #3093 probation ended with `annotations` at zero docs ever (`/api/annotations` routes kept).
- **Blog = AI-assisted research notes (2026-07-15, #3156):** every note gets `NoteFooter` from `src/app/blog/layout.tsx` (AI-disclosure line, "Last revised" from `src/generated/blog-revisions.json`, GitHub history + suggest-an-edit links); colophon at `/blog/how-these-are-made` is authored copy in Derek's voice — don't rewrite it without him. No comments, no public read counts (deliberate: low numbers anti-sell; counts live in GA4/PostHog + /metrics).
- **Verify against the correct deployed build, not just text presence (2026-06-08):** A Vercel branch preview keeps serving the *previous* commit's build until the new one finishes; a `curl | grep "<feature text>"` passes on both. Confirm the served build is the new one (compare the `dpl_…` hash in the HTML, or test the specific deployment URL once `vercel inspect` shows `● Ready`) before concluding a fix does/doesn't work. I twice tested deep-zoom against a stale build and drew the wrong conclusion.
