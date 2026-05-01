// Root-level author page — same as tenant-scoped version.
// Author pages query the global books collection (not tenant-filtered),
// so the same component works at both /author/[name] and /[tenant]/author/[name].
//
// Route segment config must be declared directly (Next.js can't parse re-exports).
export const revalidate = 86400;
export const dynamicParams = true;
export async function generateStaticParams() { return []; }

export { default, generateMetadata } from '@/app/[tenant]/author/[name]/page';
