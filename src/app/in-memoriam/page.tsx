import { Metadata } from 'next';
import ContentPageLayout, { ContentHeader } from '@/components/layout/ContentPageLayout';
import InMemoriamText from '@/components/articles/InMemoriamText';

export const metadata: Metadata = {
  title: 'In Memoriam: Joost R. Ritman (1941–2026) | Source Library',
  description:
    'In memory of Joost R. Ritman, founder of the Bibliotheca Philosophica Hermetica, the library where Source Library began, and the man whose motto was ad fontes.',
  alternates: {
    canonical: '/in-memoriam',
  },
};

export default function InMemoriamPage() {
  return (
    <ContentPageLayout
      header={
        <ContentHeader
          title="Joost R. Ritman"
          subtitle="10 March 1941 – 5 June 2026"
          image="/memoriam/joost-ritman.jpg"
          imageAlt="Joost R. Ritman at the Embassy of the Free Mind, 2017"
          heightClass="min-h-[340px] md:min-h-[460px]"
        >
          <p className="text-secondary text-sm leading-relaxed">
            <span className="text-accent-gold/90 font-serif italic">In memoriam</span>
            {' '}&middot; Founder of the Bibliotheca Philosophica Hermetica.{' '}
            <span className="text-secondary/70">Photo: Embassy of the Free Mind, 2017.</span>
          </p>
        </ContentHeader>
      }
      bg="bg-cream"
    >
      <InMemoriamText linkClassName="text-accent-rust hover:underline" />
    </ContentPageLayout>
  );
}
