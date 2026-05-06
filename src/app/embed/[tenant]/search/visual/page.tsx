// Tenant subdomain entry for /search/visual (see src/proxy.ts).
// The visual search API filters by tenant via x-tenant-id header set by proxy.ts,
// so this re-export needs no extra plumbing.
export { default } from '@/app/[tenant]/search/visual/page';
