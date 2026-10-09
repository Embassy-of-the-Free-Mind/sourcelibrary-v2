import { Metadata } from 'next';
import Link from 'next/link';
import ContentPageLayout, { ContentHeader } from '@/components/layout/ContentPageLayout';
import BlogIndex from './BlogIndex';
import { posts } from './posts';

export const metadata: Metadata = {
  title: 'Research Notes - Source Library',
  description: 'Research notes on the history and translation of rare philosophical, esoteric, and scientific texts. AI-assisted analysis directed by Derek Lomas.',
  alternates: {
    canonical: '/blog',
  },
};

export default function BlogPage() {
  return (
    <ContentPageLayout
      header={
        <ContentHeader
          title="Research Notes"
          subtitle="AI-assisted research on rare texts, classification, and the history of knowledge. Derek Lomas directs the questions; Claude (Anthropic) builds the analysis. Every claim is grounded in primary sources from the collection."
          image="https://images.sourcelibrary.org/archived/699065973dc2ed39a49f1e71/4.jpg"
          imageAlt="The Fountain of Hermes from the Ripley Scroll, Bodleian Library, c. 1450"
        >
          <p className="text-stone-400 text-sm mt-4">
            <Link href="/blog/how-these-are-made" className="hover:text-white underline decoration-stone-500 underline-offset-2 transition-colors">
              How these notes are made
            </Link>
          </p>
        </ContentHeader>
      }
      bg="bg-cream"
    >
      <div className="flex justify-end mb-6">
        <a
          href="/api/feed/blog"
          className="inline-flex items-center gap-1.5 text-sm text-muted hover:text-accent-rust transition-colors"
          title="Subscribe to Research Notes via RSS"
        >
          <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24" aria-hidden="true">
            <path d="M4 11a9 9 0 0 1 9 9h2.5A11.5 11.5 0 0 0 4 8.5V11zm0 4a5 5 0 0 1 5 5h2.5A7.5 7.5 0 0 0 4 12.5V15zm1.6 2.4A1.6 1.6 0 1 0 4 19a1.6 1.6 0 0 0 1.6-1.6z" />
          </svg>
          RSS
        </a>
      </div>

      <BlogIndex posts={posts} />
    </ContentPageLayout>
  );
}
