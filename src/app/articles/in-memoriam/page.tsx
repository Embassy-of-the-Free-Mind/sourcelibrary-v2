import { Metadata } from 'next';
import ContentPageLayout, { ContentHeader } from '@/components/layout/ContentPageLayout';
import InMemoriamText from '@/components/articles/InMemoriamText';
import { withArticleMeta } from '@/lib/article-metadata';

// Moved from /in-memoriam (2026-10-18) without changing a word: the text lives in
// InMemoriamText, which the partner reading rooms still render at /in-memoriam.
// Written by Derek Lomas, so the footer note is his byline, not the AI disclosure
// (AUTHORED_ARTICLES in posts.ts).

const TITLE = 'In Memoriam: Joost R. Ritman (1941–2026)';
const DESCRIPTION =
  'In memory of Joost R. Ritman, founder of the Bibliotheca Philosophica Hermetica, the library where Source Library began, and the man whose motto was ad fontes.';

export const metadata: Metadata = withArticleMeta('in-memoriam', {
  title: `${TITLE} - Articles - Source Library`,
  description: DESCRIPTION,
  openGraph: { title: TITLE, description: DESCRIPTION },
  alternates: { canonical: '/articles/in-memoriam' },
});

export default function InMemoriamPage() {
  return (
    <ContentPageLayout
      header={
        <ContentHeader feature headerVariant="dark"
          title="Joost R. Ritman"
          subtitle="10 March 1941 – 5 June 2026"
          image="/memoriam/joost-ritman.jpg"
          imageAlt="Joost R. Ritman at the Embassy of the Free Mind, 2017"
        >
          <p>
            <span className="font-serif italic">In memoriam</span>
            {' '}&middot; Founder of the Bibliotheca Philosophica Hermetica.{' '}
            Photo: Embassy of the Free Mind, 2017.
          </p>
        </ContentHeader>
      }
      bg="bg-cream"
    >
      <InMemoriamText />
    </ContentPageLayout>
  );
}
