import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import ContentPageLayout, { ContentHeader } from '@/components/layout/ContentPageLayout';
import { HISTORIES, conceptBySlug, loadEssays, essayFigures, pickFor } from '../../histories';
import Markdown from '../../Markdown';
import Quote from '../../Quote';

// Static (#7623); dynamicParams=false: see ../page.tsx.
export const dynamicParams = false;
export function generateStaticParams() {
  return HISTORIES.concepts.flatMap((c) => c.essays.map((e) => ({ concept: c.slug, essay: e.slug })));
}

async function find(params: Promise<{ concept: string; essay: string }>) {
  const { concept, essay } = await params;
  const c = conceptBySlug(concept);
  if (!c) return null;
  const essays = await loadEssays(c.slug);
  const i = essays.findIndex((e) => e.slug === essay);
  return i < 0 ? null : { c, e: essays[i], prev: essays[i - 1], next: essays[i + 1] };
}

export async function generateMetadata({ params }: { params: Promise<{ concept: string; essay: string }> }): Promise<Metadata> {
  const hit = await find(params);
  if (!hit) return {};
  const { c, e } = hit;
  const title = `${e.title} | ${c.title}: a conceptual history | Source Library`;
  const description = `${e.title}. An essay in the conceptual history of ${c.title.toLowerCase()} on Source Library; every claim links to the page it quotes.`;
  const url = `https://sourcelibrary.org/explore/histories/${c.slug}/${e.slug}`;
  const img = pickFor(c.slug).image;
  const OG_IMAGE = { url: img.src, alt: img.alt };
  return {
    title, description,
    alternates: { canonical: `/explore/histories/${c.slug}/${e.slug}` },
    openGraph: { title, description, url, siteName: 'Source Library', type: 'article', images: [OG_IMAGE] },
    twitter: { card: 'summary_large_image', title, description, images: [OG_IMAGE.url] },
  };
}

export default async function EssayPage({ params }: { params: Promise<{ concept: string; essay: string }> }) {
  const hit = await find(params);
  if (!hit) notFound();
  const { c, e, prev, next } = hit;
  // One library quote, with its printed page, after each section that cites one (content/figures.json).
  const figs = essayFigures(c.slug, e.slug);
  const parts = e.md.split(/^(?=## )/m);
  return (
    <ContentPageLayout
      maxWidth="narrow"
      header={<ContentHeader title={e.title} subtitle={`A conceptual history of ${c.title.toLowerCase()}`} maxWidth="narrow" headerVariant="dark" />}
    >
      <p className="text-sm mb-8" style={{ color: 'var(--text-muted)' }}>
        <Link href="/explore">Explore</Link> / <Link href="/explore/histories">Histories</Link> /{' '}
        <Link href={`/explore/histories/${c.slug}`}>{c.title}</Link>
      </p>
      <article>
        {parts.map((md, i) => (
          <div key={i}>
            <Markdown md={md} />
            {figs[i] && <Quote f={figs[i]} />}
          </div>
        ))}
      </article>
      <p className="text-sm leading-relaxed mt-12" style={{ color: 'var(--text-muted)' }}>
        Drafted by AI from the library’s pages. Each numbered mark opens the claim it rests on, with the quoted page;{' '}
        a bracketed [unverified] or [disputed] marks a source that has not passed the check.{' '}
        <Link href={`/explore/histories/${c.slug}#how-far-it-was-checked`}>How far it was checked</Link>.
      </p>
      <nav className="mt-12 pt-6 flex justify-between gap-6 text-sm" style={{ borderTop: '1px solid var(--border-light)' }} aria-label="Essays">
        <span>{prev && <Link href={`/explore/histories/${c.slug}/${prev.slug}`}>← {prev.title}</Link>}</span>
        <span className="text-right">{next && <Link href={`/explore/histories/${c.slug}/${next.slug}`}>{next.title} →</Link>}</span>
      </nav>
    </ContentPageLayout>
  );
}
