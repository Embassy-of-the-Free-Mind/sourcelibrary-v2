import { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import type { ComponentType } from 'react';
import ContentPageLayout, { ContentHeader } from '@/components/layout/ContentPageLayout';
import { getPressRelease, publishedReleases } from '@/lib/press-releases';
import SourceLibraryPublicBetaLaunch from '@/components/press/releases/SourceLibraryPublicBetaLaunch';
import EmbassyAnnouncesSourceLibrary from '@/components/press/releases/EmbassyAnnouncesSourceLibrary';

/** Slug → release body component. Add a new release here when adding it to the registry. */
const RELEASE_BODIES: Record<string, ComponentType> = {
  'source-library-public-beta-launch': SourceLibraryPublicBetaLaunch,
  'embassy-free-mind-announces-source-library': EmbassyAnnouncesSourceLibrary,
};

// Pre-render published releases at build time; drafts are still reachable on-demand.
export function generateStaticParams() {
  return publishedReleases().map((r) => ({ slug: r.slug }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const release = getPressRelease(slug);
  if (!release) return {};

  const isDraft = release.status === 'draft';
  return {
    title: `${release.title} — Source Library`,
    description: release.metaDescription,
    alternates: { canonical: `/press-releases/${slug}` },
    robots: isDraft ? { index: false, follow: false } : undefined,
    openGraph: {
      title: release.title,
      description: release.metaDescription,
      images: release.ogImage
        ? [{ url: release.ogImage, width: 1200, height: 630 }]
        : undefined,
    },
  };
}

export default async function PressReleaseDetail({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const release = getPressRelease(slug);
  const Body = RELEASE_BODIES[slug];
  if (!release || !Body) notFound();

  const isDraft = release.status === 'draft';

  return (
    <ContentPageLayout
      header={
        <ContentHeader title={release.title} subtitle={release.subtitle}>
          <p className="text-stone-400 text-sm mt-4">
            FOR IMMEDIATE RELEASE &middot; {release.dateline}
          </p>
        </ContentHeader>
      }
      bg="bg-cream"
    >
      <div className="mb-8">
        <Link
          href="/press-releases"
          className="inline-flex items-center gap-2 text-muted hover:text-secondary transition-colors text-sm"
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M10 19l-7-7m0 0l7-7m-7 7h18" />
          </svg>
          All press releases
        </Link>
      </div>

      {isDraft && (
        <div className="mb-8 bg-accent-gold/5 border border-accent-gold/30 rounded-lg p-4 text-sm text-secondary">
          <strong className="text-stone-800">Draft</strong> — this release is not yet published. It is
          hidden from the public list and search engines, but reachable by direct link for review.
        </div>
      )}

      <Body />
    </ContentPageLayout>
  );
}

// Allow drafts (not in generateStaticParams) to render on first request.
export const dynamicParams = true;
