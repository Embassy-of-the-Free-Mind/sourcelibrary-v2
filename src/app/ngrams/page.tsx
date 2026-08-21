import { Metadata } from 'next';
import { Suspense } from 'react';
import NgramViewer from '@/components/ngrams/NgramViewer';
import SiteHeader from '@/components/layout/SiteHeader';
import ExploreTabBar from '@/components/explore/ExploreTabBar';

const TITLE = 'Ngram Viewer — Source Library';
const DESCRIPTION =
  'Chart how words and phrases rise and fall across five centuries of primary sources — ' +
  'alchemy, Hermetica, Kabbalah, and early science — then click through to the pages themselves.';

// Social-card invariant: a page that defines openGraph must set images
// explicitly and mirror them in a twitter block (see CLAUDE.md, PRs #3149/#3151).
export const metadata: Metadata = {
  title: TITLE,
  description: DESCRIPTION,
  openGraph: {
    title: TITLE,
    description: DESCRIPTION,
    url: 'https://sourcelibrary.org/ngrams',
    siteName: 'Source Library',
    type: 'website',
    images: [{ url: 'https://sourcelibrary.org/og-image.jpg', width: 1200, height: 630, alt: 'Source Library — Digitizing and translating ancient texts' }],
  },
  twitter: {
    card: 'summary_large_image',
    title: TITLE,
    description: DESCRIPTION,
    images: ['https://sourcelibrary.org/og-image.jpg'],
  },
};

export default function NgramsPage() {
  return (
    <>
      <SiteHeader variant="light" />
      <div className="max-w-5xl mx-auto px-4 py-8">
      <h1 className="font-serif text-3xl mb-2">Ngram Viewer</h1>
      <p className="text-[var(--text-secondary)] mb-6 max-w-3xl">
        How often does a word or phrase appear across the library, year by year?
        Compare up to six terms, in English translation or in the original
        languages — and click any point on a curve to read the actual passages.
      </p>

      {/* Ngrams sits outside /explore/* but is one of the explore tools —
          carry the same tab bar so readers can move between them. */}
      <div className="mb-6">
        <ExploreTabBar />
      </div>

      <Suspense fallback={null}>
        <NgramViewer />
      </Suspense>

      <div className="mt-8 text-sm text-[var(--text-muted)] max-w-3xl space-y-2">
        <p>
          <strong>Reading these curves honestly:</strong> frequencies describe the
          Source Library collection — a curated corpus centered on alchemy,
          Hermetica, and early modern science — not print culture at large. The
          gray backdrop shows how much text each year contributes; a spike in a
          thin decade is thin evidence. Years are edition publication years, so a
          1650 reprint of a 15th-century text counts as 1650.
        </p>
        <p>
          Spelling is normalized before counting (long ſ, ligatures, and in Latin
          the u/v and i/j pairs), so <em>vniuersum</em> and <em>universum</em>{' '}
          chart as one term. The English corpus draws on our translations of
          works in every language, which lets one curve track a concept across
          Latin, German, French, and Greek sources at once.
        </p>
      </div>
      </div>
    </>
  );
}
