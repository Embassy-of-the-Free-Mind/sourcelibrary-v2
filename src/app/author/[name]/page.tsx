// Root-level author page — same as tenant-scoped version.
// Author pages query the global books collection (not tenant-filtered),
// so the same component works at both /author/[name] and /[tenant]/author/[name].
export { default, generateMetadata, generateStaticParams, revalidate, dynamicParams } from '@/app/[tenant]/author/[name]/page';
