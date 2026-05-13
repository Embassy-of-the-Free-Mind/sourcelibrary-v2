// Route segment config must be declared directly (Next.js can't parse re-exports).
export const revalidate = 86400;

export { default, metadata } from '@/app/[tenant]/browse/subjects/page';
