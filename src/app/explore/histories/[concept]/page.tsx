import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import ContentPageLayout, { ContentHeader } from '@/components/layout/ContentPageLayout';
import { HISTORIES, conceptBySlug, fmt, qualityStatement } from '../histories';

// Static (#7623). dynamicParams=false makes an unknown concept a routing-level
// 404, not a notFound() under /explore's loading.tsx (a soft 200, rendering-and-seo.md).
export const dynamicParams = false;
export function generateStaticParams() { return HISTORIES.concepts.map((c) => ({ concept: c.slug })); }

const OG_IMAGE = { url: 'https://sourcelibrary.org/og-image.jpg', alt: 'Source Library: Digitizing and translating ancient texts' };

export async function generateMetadata({ params }: { params: Promise<{ concept: string }> }): Promise<Metadata> {
  const c = conceptBySlug((await params).concept);
  if (!c) return {};
  const title = `${c.title}: a conceptual history | Source Library`;
  const url = `https://sourcelibrary.org/explore/histories/${c.slug}`;
  return {
    title, description: c.question,
    alternates: { canonical: `/explore/histories/${c.slug}` },
    openGraph: { title, description: c.question, url, siteName: 'Source Library', type: 'article', images: [OG_IMAGE] },
    twitter: { card: 'summary_large_image', title, description: c.question, images: [OG_IMAGE.url] },
  };
}

export default async function ConceptPage({ params }: { params: Promise<{ concept: string }> }) {
  const c = conceptBySlug((await params).concept);
  if (!c) notFound();
  const shown = c.counts.verified + c.counts.partial;
  return (
    <ContentPageLayout
      maxWidth="narrow"
      header={<ContentHeader title={c.title} subtitle={c.question} maxWidth="narrow" backHref="/explore/histories" backLabel="All histories" />}
    >
      <div className="space-y-10">
        <p className="text-sm" style={{ color: 'var(--text-muted)' }}>
          <Link href="/explore">Explore</Link> / <Link href="/explore/histories">Histories</Link> / {c.title}
        </p>

        <section>
          <h2 className="font-serif text-2xl mb-4" style={{ color: 'var(--text-primary)' }}>Essays</h2>
          <ol className="space-y-2">
            {c.essays.map((e) => (
              <li key={e.slug} className="leading-relaxed">
                <Link href={`/explore/histories/${c.slug}/${e.slug}`}>{e.title}</Link>
              </li>
            ))}
          </ol>
        </section>

        <section>
          <h2 className="font-serif text-2xl mb-3" style={{ color: 'var(--text-primary)' }}>The claims</h2>
          <p className="leading-relaxed" style={{ color: 'var(--text-secondary)' }}>
            The essays rest on {fmt(shown)} claims, each tied to the page it quotes:{' '}
            {fmt(c.counts.verified)} verified and {fmt(c.counts.partial)} partly verified (marked as such).{' '}
            {fmt(c.counts.dropped)} claims that are unverified or disputed are not shown.{' '}
            <Link href={`/explore/histories/${c.slug}/claims`}>Read the claims</Link>, grouped by tradition and period.
          </p>
          {c.map && (
            <p className="leading-relaxed mt-3" style={{ color: 'var(--text-secondary)' }}>
              What the library holds on this theme, tradition by tradition, is on the <Link href={c.map}>map of {c.title.toLowerCase()}</Link>.
            </p>
          )}
        </section>

        <section id="how-far-it-was-checked" className="scroll-mt-24">
          <h2 className="font-serif text-2xl mb-3" style={{ color: 'var(--text-primary)' }}>How far it was checked</h2>
          <p className="text-sm leading-relaxed" style={{ color: 'var(--text-secondary)' }}>{qualityStatement(c)}</p>
          <p className="text-sm leading-relaxed mt-3" style={{ color: 'var(--text-muted)' }}>
            Found a claim its page does not support? Tell us with the feedback link at the foot of this page.
          </p>
        </section>

        {c.keepTerms.length > 0 && (
          <section>
            <h2 className="font-serif text-2xl mb-3" style={{ color: 'var(--text-primary)' }}>Words kept in the original</h2>
            <p className="leading-relaxed mb-4" style={{ color: 'var(--text-secondary)' }}>
              These words carry a meaning the usual English would lose, so the essays keep them in the original.
            </p>
            <dl className="space-y-3">
              {c.keepTerms.map((k) => (
                <div key={`${k.term}-${k.lang}`}>
                  <dt className="font-serif" style={{ color: 'var(--text-primary)' }}>
                    {k.term}{k.translit && k.translit !== k.term ? <> <em>{k.translit}</em></> : null}
                  </dt>
                  <dd className="text-sm leading-relaxed" style={{ color: 'var(--text-secondary)' }}>
                    {k.gloss}{k.gloss && !/[.!?”)]$/.test(k.gloss) ? '.' : ''}
                    {k.avoid.length > 0 && <> Not simply “{k.avoid[0]}”.</>}
                    {k.evidence && <> <Link href={k.evidence}>The evidence</Link>.</>}
                  </dd>
                </div>
              ))}
            </dl>
          </section>
        )}
      </div>
    </ContentPageLayout>
  );
}
