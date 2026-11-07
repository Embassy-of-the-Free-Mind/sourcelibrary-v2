import type { Metadata } from 'next';
import { getWorkRecord } from '@/lib/work-record';
import { WorkRecordView } from './WorkRecordView';

/**
 * /admin/laura: everything Laura has worked on in Source Library, finished and unfinished, in plain
 * words for the team. Renderer only: the record is an ops_reports document (src/lib/work-record.ts).
 * force-dynamic: a failed read throws for this request only, never a cached page.
 * Gate: the admin layout's requireAdmin(); refused on partner hosts (tenant-global-paths); noindex.
 */
export const metadata: Metadata = {
  title: "Laura's work",
  robots: { index: false, follow: false, nocache: true, googleBot: { index: false, follow: false } },
};
export const dynamic = 'force-dynamic';
export const revalidate = 0;

export default async function LauraWorkPage() {
  const record = await getWorkRecord('laura');
  if (!record) {
    return (
      <main className="max-w-6xl mx-auto px-4 py-8">
        <h1 className="text-2xl font-semibold text-stone-900">Laura&apos;s work</h1>
        <p className="mt-2 text-sm text-stone-600">The record has not been pushed yet.</p>
      </main>
    );
  }
  return <WorkRecordView record={record} />;
}
