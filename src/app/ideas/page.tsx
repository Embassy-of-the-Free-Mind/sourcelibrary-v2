import { Metadata } from 'next';
import Link from 'next/link';
import ContentPageLayout, { ContentHeader } from '@/components/layout/ContentPageLayout';
import { IDEAS, VERIFIED_ON, ideaTitle, traditionLabel, traditionsOf } from './ideas';

export const metadata: Metadata = {
  title: 'Ideas Across Traditions | Source Library',
  description:
    'Twenty-five ideas that several traditions wrote about, each with passages from the books themselves, quoted and linked to the page.',
  alternates: { canonical: '/ideas' },
  // Unlinked and out of the index until Derek has read the pages (#6173).
  robots: { index: false, follow: false },
};

export default function IdeasIndexPage() {
  return (
    <ContentPageLayout
      header={
        <ContentHeader
          title="Ideas Across Traditions"
          subtitle="The same idea in Greek, Hebrew, Arabic, Sanskrit, Chinese and Latin books, each passage quoted and linked to its page."
        />
      }
      bg="bg-cream"
    >
      <div className="max-w-3xl">
        <p className="text-lg text-secondary leading-relaxed mb-4">
          Each page below takes one idea and sets passages about it side by side, from books of different traditions.
          Every quotation links to the page it comes from, so you can read what stands around it.
        </p>
        <p className="text-secondary leading-relaxed mb-4">
          The passages were found by AI readers that searched and read the pages. Each quotation was checked by
          program to be on the page it links to, last on {VERIFIED_ON}. Almost all of the English is AI translation
          that no scholar has reviewed, and each passage says so.{' '}
          <Link href="/about/meaning" className="text-accent-rust hover:underline">How search by meaning works</Link>
        </p>
      </div>
      <ul className="list-none p-0 mt-8 grid gap-4 md:grid-cols-2">
        {IDEAS.map((idea) => (
          <li key={idea.slug} className="border border-light rounded bg-white/60 p-4 min-w-0">
            <h2 className="text-lg text-primary font-semibold mb-1">
              <Link href={`/ideas/${idea.slug}`} className="hover:underline">{ideaTitle(idea)}</Link>
            </h2>
            <p className="text-sm text-muted leading-snug m-0">
              {idea.passages.length} passages · {traditionsOf(idea).map(traditionLabel).join(', ')}
            </p>
          </li>
        ))}
      </ul>
    </ContentPageLayout>
  );
}
