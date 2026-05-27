// Tenant subdomains route /gallery here (see src/proxy.ts).
// The underlying /[tenant]/gallery page reads x-tenant-id from headers
// (set by proxy.ts), so it filters to BPH content with no extra plumbing.
//
// Next.js 16 / Turbopack rejects re-exported route segment config —
// `export { revalidate } from '...'` fails the static-parse check at
// build time. Declare `revalidate` inline; keep the value in sync with
// the source page (src/app/[tenant]/gallery/page.tsx).
export { default } from '@/app/gallery/page';
export const revalidate = 3600;
