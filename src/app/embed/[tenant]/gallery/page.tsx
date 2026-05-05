// Tenant subdomains route /gallery here (see src/proxy.ts).
// The underlying /[tenant]/gallery page reads x-tenant-id from headers
// (set by proxy.ts), so it filters to BPH content with no extra plumbing.
export { default, revalidate } from '@/app/[tenant]/gallery/page';
