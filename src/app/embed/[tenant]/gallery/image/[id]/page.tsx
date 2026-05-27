// Tenant subdomain entry for /gallery/image/[id] (see src/proxy.ts).
// The underlying client page is tenant-agnostic — it loads its data via
// /api/[tenant]/gallery/image/* using the tenant header set by proxy.ts.
export { default } from '@/app/gallery/image/[id]/page';
