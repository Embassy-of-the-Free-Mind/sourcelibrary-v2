import { Metadata } from 'next';
import Link from 'next/link';
import ContentPageLayout, { ContentHeader } from '@/components/layout/ContentPageLayout';
import { publishedReleases, allReleases, type PressReleaseMeta } from '@/lib/press-releases';

export const metadata: Metadata = {
  title: 'Press Releases — Source Library',
  description:
    'Official announcements from Source Library and the Embassy of the Free Mind.',
  alternates: { canonical: '/press-releases' },
  openGraph: {
    title: 'Press Releases — Source Library',
    description: 'Official announcements from Source Library and the Embassy of the Free Mind.',
    images: [{ url: 'https://sourcelibrary.org/og-image.jpg', width: 1200, height: 630 }],
  },
};

function ReleaseCard({ release }: { release: PressReleaseMeta }) {
  const isDraft = release.status === 'draft';
  return (
    <Link
      href={`/press-releases/${release.slug}`}
      className="block bg-warm rounded-lg border border-border-light p-6 md:p-8 hover:border-accent-rust/40 transition-colors"
    >
      <div className="flex items-center gap-3 mb-3">
        <span className="text-xs text-muted uppercase tracking-wide">{release.dateline}</span>
        {isDraft && (
          <span className="text-xs text-accent-gold bg-accent-gold/10 px-2 py-0.5 rounded border border-accent-gold/30">
            Draft
          </span>
        )}
      </div>
      <h2 className="font-serif text-xl md:text-2xl text-primary mb-2">{release.title}</h2>
      <p className="text-sm text-accent-rust font-serif mb-3">{release.subtitle}</p>
      <p className="text-sm text-secondary leading-relaxed font-body">{release.summary}</p>
      <span className="inline-flex items-center gap-1 text-sm text-accent-rust mt-4">
        Read release
        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M14 5l7 7m0 0l-7 7m7-7H3" />
        </svg>
      </span>
    </Link>
  );
}

export default async function PressReleasesIndex({
  searchParams,
}: {
  searchParams: Promise<{ preview?: string }>;
}) {
  const { preview } = await searchParams;
  const showDrafts = preview === '1';
  const releases = showDrafts ? allReleases() : publishedReleases();

  return (
    <ContentPageLayout
      header={
        <ContentHeader
          title="Press Releases"
          subtitle="Official announcements from Source Library and the Embassy of the Free Mind"
        />
      }
      bg="bg-cream"
    >
      <div className="mb-8">
        <Link
          href="/"
          className="inline-flex items-center gap-2 text-muted hover:text-secondary transition-colors text-sm"
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M10 19l-7-7m0 0l7-7m-7 7h18" />
          </svg>
          Back to Library
        </Link>
      </div>

      {showDrafts && (
        <div className="mb-8 bg-accent-gold/5 border border-accent-gold/30 rounded-lg p-4 text-sm text-secondary">
          Preview mode — showing draft releases. Drafts are hidden from the public list and search engines.
        </div>
      )}

      {releases.length === 0 ? (
        <p className="text-secondary font-body">No press releases yet.</p>
      ) : (
        <div className="space-y-6">
          {releases.map((release) => (
            <ReleaseCard key={release.slug} release={release} />
          ))}
        </div>
      )}

      <div className="mt-12 bg-warm rounded-lg border border-border-light p-6 text-sm text-secondary">
        <strong className="text-stone-800">Media enquiries:</strong>{' '}
        <a href="mailto:team@sourcelibrary.org" className="text-accent-rust hover:underline">
          team@sourcelibrary.org
        </a>{' '}
        · Embassy of the Free Mind, Keizersgracht 123, Amsterdam
      </div>
    </ContentPageLayout>
  );
}
