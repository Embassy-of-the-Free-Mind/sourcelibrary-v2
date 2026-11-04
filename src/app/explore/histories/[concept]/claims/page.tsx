import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import ContentPageLayout, { ContentHeader } from '@/components/layout/ContentPageLayout';
import { HISTORIES, conceptBySlug, loadClaims, domainLabel, claimsHref, fmt } from '../../histories';

// Static (#7623); dynamicParams=false: see ../page.tsx. The claims of one
// concept, by domain; each domain is its own page (./[domain]).
export const dynamicParams = false;
export function generateStaticParams() { return HISTORIES.concepts.map((c) => ({ concept: c.slug })); }

const OG_IMAGE = { url: 'https://sourcelibrary.org/og-image.jpg', alt: 'Source Library: Digitizing and translating ancient texts' };

export async function generateMetadata({ params }: { params: Promise<{ concept: string }> }): Promise<Metadata> {
  const c = conceptBySlug((await params).concept);
  if (!c) return {};
  const title = `${c.title}: the claims and their sources | Source Library`;
  const description = `The ${fmt(c.counts.verified + c.counts.partial)} checked claims behind the conceptual history of ${c.title.toLowerCase()}, each with the page it quotes.`;
  const url = `https://sourcelibrary.org/explore/histories/${c.slug}/claims`;
  return {
    title, description,
    alternates: { canonical: `/explore/histories/${c.slug}/claims` },
    openGraph: { title, description, url, siteName: 'Source Library', type: 'website', images: [OG_IMAGE] },
    twitter: { card: 'summary_large_image', title, description, images: [OG_IMAGE.url] },
  };
}

export default async function ClaimsIndexPage({ params }: { params: Promise<{ concept: string }> }) {
  const c = conceptBySlug((await params).concept);
  if (!c) notFound();
  const claims = await loadClaims(c.slug);
  const groups = c.domains.map((d) => {
    const items = claims.filter((x) => x.d === d);
    return { d, n: items.length, partial: items.filter((x) => x.p).length, sample: items[0]?.s };
  });
  return (
    <ContentPageLayout
      maxWidth="narrow"
      header={<ContentHeader title={`${c.title}: the claims`} subtitle={`${fmt(claims.length)} claims, each with the page it quotes`} maxWidth="narrow" />}
    >
      <div className="space-y-6">
        <p className="text-sm" style={{ color: 'var(--text-muted)' }}>
          <Link href="/explore">Explore</Link> / <Link href="/explore/histories">Histories</Link> /{' '}
          <Link href={`/explore/histories/${c.slug}`}>{c.title}</Link> / Claims
        </p>
        <p className="leading-relaxed" style={{ color: 'var(--text-secondary)' }}>
          {fmt(c.counts.verified)} verified and {fmt(c.counts.partial)} partly verified claims, by tradition, period or
          kind. {fmt(c.counts.dropped)} unverified or disputed claims are not shown.{' '}
          <Link href={`/explore/histories/${c.slug}#how-far-it-was-checked`}>How far it was checked</Link>.
        </p>
        <ul className="space-y-4">
          {groups.map((g) => (
            <li key={g.d}>
              <Link href={claimsHref(c.slug, g.d)} className="font-serif text-xl">{domainLabel(g.d)}</Link>
              <span className="text-sm" style={{ color: 'var(--text-muted)' }}>
                {' '}· {fmt(g.n)} claims{g.partial ? `, ${fmt(g.partial)} partly verified` : ''}
              </span>
              {g.sample && <p className="text-sm leading-relaxed mt-1" style={{ color: 'var(--text-secondary)' }}>{g.sample}</p>}
            </li>
          ))}
        </ul>
      </div>
    </ContentPageLayout>
  );
}
