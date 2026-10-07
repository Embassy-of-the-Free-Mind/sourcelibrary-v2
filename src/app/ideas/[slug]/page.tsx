import { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import ContentPageLayout, { ContentHeader } from '@/components/layout/ContentPageLayout';
import { IDEAS, VERIFIED_ON, ideaTitle, passageHref, sourceNote, traditionLabel, traditionsOf, type IdeaPassage } from '../ideas';

// The 25 ideas are a built data file: nothing is fetched at render, and any
// other slug is a 404 rather than a render.
export const dynamicParams = false;

export function generateStaticParams() {
  return IDEAS.map((idea) => ({ slug: idea.slug }));
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params;
  const idea = IDEAS.find((i) => i.slug === slug);
  if (!idea) return {};
  const traditions = traditionsOf(idea).map(traditionLabel);
  return {
    title: `${ideaTitle(idea)} | Ideas Across Traditions | Source Library`,
    description: `${idea.passages.length} passages on one idea from ${traditions.length} traditions (${traditions.join(', ')}), each quoted and linked to its page.`,
    alternates: { canonical: `/ideas/${idea.slug}` },
  };
}

function Passage({ p }: { p: IdeaPassage }) {
  const by = [p.book_author, p.book_year != null ? String(p.book_year) : '', p.book_language].filter(Boolean).join(' · ');
  return (
    <blockquote className="m-0 border-l-2 border-accent-rust pl-4 py-1">
      <p className="text-primary leading-relaxed mb-1">“{p.quote}”</p>
      <footer className="text-sm text-muted leading-snug">
        <span className="text-secondary">{p.book_title}</span>
        {by && <>. {by}</>}. <Link href={passageHref(p)} className="text-accent-rust hover:underline">Read page {p.page_number}</Link>
        <span className="block text-xs mt-0.5">{sourceNote(p)}</span>
      </footer>
    </blockquote>
  );
}

export default async function IdeaPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const idea = IDEAS.find((i) => i.slug === slug);
  if (!idea) notFound();
  const traditions = traditionsOf(idea);
  return (
    <ContentPageLayout
      header={
        <ContentHeader
          title={ideaTitle(idea)}
          subtitle={`${idea.passages.length} passages from ${traditions.length} traditions.`}
        />
      }
      bg="bg-cream"
    >
      <div className="max-w-3xl">
        <p className="text-secondary leading-relaxed mb-4">
          These passages are about the same idea and come from books of different traditions. Each is quoted from the
          page it links to. The passages were found by AI readers and the quotations were checked by program against
          the pages, last on {VERIFIED_ON}. The English is AI translation unless a passage says otherwise, so read the
          page before you cite it.
        </p>
        <p className="text-sm text-muted mb-0">
          <Link href="/ideas" className="text-accent-rust hover:underline">All ideas</Link>
        </p>
      </div>
      {traditions.map((t) => (
        <section key={t} className="mt-10 max-w-3xl" id={t}>
          <h2 className="text-2xl text-primary mb-4">{traditionLabel(t)}</h2>
          <div className="space-y-5">
            {idea.passages.filter((p) => p.tradition === t).map((p) => (
              <Passage key={`${p.book_slug}-${p.page_number}-${p.quote.slice(0, 24)}`} p={p} />
            ))}
          </div>
        </section>
      ))}
    </ContentPageLayout>
  );
}
