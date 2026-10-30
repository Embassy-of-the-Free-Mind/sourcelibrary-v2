import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import ContentPageLayout, { ContentHeader } from '@/components/layout/ContentPageLayout';
import PageFigure from '@/components/articles/PageFigure';
import {
  HISTORIES, conceptBySlug, fmt, qualityStatement, loadEssays, pickFor, keyQuotes, sections, essayLine, isStub,
  claimsHref, domainLabel, readerHref,
} from '../histories';
import Markdown from '../Markdown';
import Quote from '../Quote';

// Static (#7623). dynamicParams=false makes an unknown concept a routing-level
// 404, not a notFound() under /explore's loading.tsx (a soft 200, rendering-and-seo.md).
export const dynamicParams = false;
export function generateStaticParams() { return HISTORIES.concepts.map((c) => ({ concept: c.slug })); }

export async function generateMetadata({ params }: { params: Promise<{ concept: string }> }): Promise<Metadata> {
  const c = conceptBySlug((await params).concept);
  if (!c) return {};
  const title = `${c.title}: a conceptual history | Source Library`;
  const url = `https://sourcelibrary.org/explore/histories/${c.slug}`;
  const img = pickFor(c.slug).image;
  return {
    title, description: c.question,
    alternates: { canonical: `/explore/histories/${c.slug}` },
    openGraph: { title, description: c.question, url, siteName: 'Source Library', type: 'article', images: [{ url: img.src, alt: img.alt }] },
    twitter: { card: 'summary_large_image', title, description: c.question, images: [img.src] },
  };
}

/** Paragraphs that explain the project's own markup ("How to read it") are left out of the excerpt. */
const excerpt = (md: string) => md.split(/\n\s*\n/).filter((p) => !/^\*\*How to read\b/.test(p.trim())).join('\n\n');

/** The claims in sentences; a count of zero is never printed as a sentence. */
function claimsSentence(c: { counts: { verified: number; partial: number; dropped: number } }): string {
  const { verified, partial, dropped } = c.counts;
  const parts = [`The essays rest on ${fmt(verified + partial)} claims, each tied to the page it quotes.`];
  if (partial > 0) parts.push(`${fmt(partial)} of them are only partly supported by their page and are marked as such.`);
  if (dropped > 0) parts.push(`${fmt(dropped)} more, unverified or disputed, are not shown.`);
  return parts.join(' ');
}

const H2 = ({ children, id }: { children: React.ReactNode; id?: string }) => (
  <h2 id={id} className="font-serif text-2xl mb-4 scroll-mt-24" style={{ color: 'var(--text-primary)' }}>{children}</h2>
);

export default async function ConceptPage({ params }: { params: Promise<{ concept: string }> }) {
  const c = conceptBySlug((await params).concept);
  if (!c) notFound();
  const pick = pickFor(c.slug);
  const essays = await loadEssays(c.slug);
  const opening = essays.find((e) => e.slug === pick.opening.essay) ?? essays[0];
  const sec = sections(opening.md).find((s) => s.heading === pick.opening.section) ?? sections(opening.md)[0];
  const others = essays.filter((e) => e !== opening);
  const key = keyQuotes(c.slug);
  const essayHref = (slug: string) => `/explore/histories/${c.slug}/${slug}`;
  return (
    <ContentPageLayout
      maxWidth="narrow"
      header={
        <ContentHeader
          title={c.title}
          subtitle={`${pick.word} · ${pick.translit}`}
          maxWidth="narrow"
          headerVariant="dark"
        />
      }
    >
      <div className="space-y-14">
        <p className="text-sm" style={{ color: 'var(--text-muted)' }}>
          <Link href="/explore">Explore</Link> / <Link href="/explore/histories">Histories</Link> / {c.title}
        </p>

        <section>
          <div className="max-w-md mx-auto">
            <PageFigure src={pick.image.src} alt={pick.image.alt} href={readerHref(pick.image.book, pick.image.page)} source={pick.image.caption} linkToPage />
          </div>
          <p className="text-lg leading-relaxed mb-8 font-body" style={{ color: 'var(--text-secondary)' }}>{c.question}</p>
          <H2><Link href={essayHref(opening.slug)}>{opening.title}</Link></H2>
          {sec.heading && <h3 className="font-serif text-xl mb-3" style={{ color: 'var(--text-primary)' }}>{sec.heading}</h3>}
          <Markdown md={excerpt(sec.md)} />
          <p className="mt-6">
            <Link href={essayHref(opening.slug)}>Read on: {opening.title}</Link>
          </p>
        </section>

        {others.length > 0 && (
          <section>
            <H2>The other essays</H2>
            <ul className="space-y-4">
              {others.map((e) => (
                <li key={e.slug}>
                  <Link href={essayHref(e.slug)} className="font-serif text-lg">{e.title}</Link>
                  <p className="text-sm leading-relaxed" style={{ color: 'var(--text-muted)' }}>
                    {isStub(e.md) ? <>Not yet written. {essayLine(e.md)}</> : essayLine(e.md)}
                  </p>
                </li>
              ))}
            </ul>
          </section>
        )}

        {key.length > 0 && (
          <section>
            <H2>From the sources</H2>
            {key.map((f) => <Quote key={`${f.claim}-${f.u}`} f={f} />)}
          </section>
        )}

        <section>
          <H2>The claims</H2>
          <p className="leading-relaxed mb-4" style={{ color: 'var(--text-secondary)' }}>
            {claimsSentence(c)} <Link href={`/explore/histories/${c.slug}/claims`}>All the claims</Link>, or by tradition and period:
          </p>
          <ul className="flex flex-wrap gap-x-5 gap-y-2 text-sm">
            {c.domains.map((d) => <li key={d}><Link href={claimsHref(c.slug, d)}>{domainLabel(d)}</Link></li>)}
          </ul>
        </section>

        {c.map && (
          <section>
            <H2>The sources</H2>
            <p className="leading-relaxed" style={{ color: 'var(--text-secondary)' }}>
              Every work on {c.title.toLowerCase()} the library knows of, by tradition and date: what you can read now, what
              is held but not yet readable, and what is missing, with the works this history quotes marked.{' '}
              <Link href={c.map}>The sources on {c.title.toLowerCase()}</Link>.
            </p>
          </section>
        )}

        {c.keepTerms.length > 0 && (
          <section>
            <H2>Words kept in the original</H2>
            <dl className="space-y-4">
              {c.keepTerms.map((k) => {
                const term = <>{k.term}{k.translit && k.translit !== k.term ? <> <em>{k.translit}</em></> : null}</>;
                return (
                  <div key={`${k.term}-${k.lang}`}>
                    <dt className="font-serif text-lg" style={{ color: 'var(--text-primary)' }}>
                      {k.evidence ? <Link href={k.evidence}>{term}</Link> : term}
                    </dt>
                    {k.gloss && <dd className="leading-relaxed" style={{ color: 'var(--text-secondary)' }}>{k.gloss}</dd>}
                    {k.avoid.length > 0 && (
                      <dd className="text-sm" style={{ color: 'var(--text-muted)' }}>
                        usually translated as {k.avoid.map((a) => `“${a}”`).join(', ')}
                      </dd>
                    )}
                  </div>
                );
              })}
            </dl>
          </section>
        )}

        <section id="how-far-it-was-checked" className="scroll-mt-24 pt-8" style={{ borderTop: '1px solid var(--border-light)' }}>
          <h2 className="font-serif text-xl mb-3" style={{ color: 'var(--text-primary)' }}>How far it was checked</h2>
          <p className="text-sm leading-relaxed" style={{ color: 'var(--text-secondary)' }}>{qualityStatement(c)}</p>
          <p className="text-sm leading-relaxed mt-3" style={{ color: 'var(--text-muted)' }}>
            Found a claim its page does not support? Tell us with the feedback link at the foot of this page.
          </p>
        </section>
      </div>
    </ContentPageLayout>
  );
}
