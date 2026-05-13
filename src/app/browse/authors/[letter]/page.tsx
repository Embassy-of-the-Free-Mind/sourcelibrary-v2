// Route segment config must be declared directly (Next.js can't parse re-exports).
export const revalidate = 86400;
export const maxDuration = 60;
export const dynamicParams = true;
export function generateStaticParams() { return []; }

export { default, generateMetadata } from '@/app/[tenant]/browse/authors/[letter]/page';
