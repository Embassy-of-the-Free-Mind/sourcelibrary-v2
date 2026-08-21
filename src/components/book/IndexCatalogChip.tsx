import Link from 'next/link';
import { getIndexCatalogStatus } from '@/lib/index-catalog-status';

/**
 * "Banned by the Index" chip. Renders on the book page when this work — or its
 * author — was condemned on the Index Librorum Prohibitorum. Links into the
 * catalog browser. Self-contained async server component (does its own
 * Supabase read); wrap in <Suspense fallback={null}> so it streams.
 *
 * Tenant-gated by the caller via embedPolicy.showIndexCatalogStatus — it points
 * at a GLOBAL collection, so it must not render in an embedded/tenant view
 * (Tenant Subdomain Lockdown).
 */
export default async function IndexCatalogChip({
  bookIds, authorEntityId,
}: { bookIds: (string | null | undefined)[]; authorEntityId: string | null | undefined }) {
  const status = await getIndexCatalogStatus(bookIds, authorEntityId).catch(() => null);
  if (!status) return null;

  // Strongest scope drives the headline.
  const has = (s: string) => status.scopes.includes(s);
  const expurgationOnly = (has('expurgated') || has('donec_corrigatur')) && !has('opera_omnia') && !has('single_work');

  const headline = status.workBanned
    ? (expurgationOnly ? 'Expurgated by the Index' : 'Banned by the Index')
    : 'Author censored by the Index';

  const detail = status.workBanned
    ? (expurgationOnly
        ? 'Passages of this work were ordered censored on the Index Librorum Prohibitorum.'
        : 'This work appears on the Index Librorum Prohibitorum.')
    : 'Works by this author were condemned on the Index Librorum Prohibitorum.';

  const span = status.firstYear
    ? (status.lastYear && status.lastYear !== status.firstYear ? `${status.firstYear}–${status.lastYear}` : `${status.firstYear}`)
    : null;
  const editionsLabel = status.editionCount > 0
    ? `${status.editionCount} edition${status.editionCount === 1 ? '' : 's'}${span ? `, ${span}` : ''}`
    : null;

  // A calm bibliographic note, not an alert box — muted rust on the cream panel
  // (a slightly warmer amber for expurgation vs an outright ban).
  const tone = expurgationOnly
    ? { border: '#e6ddc8', background: '#faf6ec', color: '#6f5a22' }
    : { border: '#e6d7d1', background: '#fbf6f3', color: '#7a3a2f' };

  return (
    <Link
      href={`/collections/${status.collectionSlug}`}
      className="group mt-4 flex items-start gap-2.5 rounded-md border px-3 py-2 no-underline transition-colors"
      style={tone}
      title="View the Index Librorum Prohibitorum catalogue"
    >
      <svg viewBox="0 0 20 20" aria-hidden className="mt-0.5 h-4 w-4 flex-none opacity-60" fill="currentColor">
        <path fillRule="evenodd" d="M10 1.5a8.5 8.5 0 100 17 8.5 8.5 0 000-17zM4.7 5.4l9.9 9.9a6.5 6.5 0 01-9.9-9.9zm1.4-1.1a6.5 6.5 0 019.6 8.4L6.1 4.3z" clipRule="evenodd" />
      </svg>
      <span className="text-sm leading-snug">
        <span className="font-medium">{headline}</span>
        {editionsLabel && <span className="opacity-70"> · {editionsLabel}</span>}
        <span className="block text-xs opacity-80">{detail}{' '}
          <span className="underline decoration-dotted underline-offset-2 group-hover:decoration-solid">See the catalogue →</span>
        </span>
      </span>
    </Link>
  );
}
