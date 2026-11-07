import { Suspense } from 'react';
import { Metadata } from 'next';
import { siteOgImage, OG_LOCALE } from '@/lib/og-locale';

// Chinese twin of src/app/search/layout.tsx (#7175). The `<Suspense>` boundary
// is load-bearing: the page reads `useSearchParams`.

const TITLE = '搜索 - Source Library';
const DESCRIPTION = '在中文古籍中搜索：炼丹、医学、哲学、天文等。摘录取自原书文字。';

export const metadata: Metadata = {
  title: TITLE,
  description: DESCRIPTION,
  alternates: {
    canonical: '/zh/search',
    languages: { en: '/search', es: '/es/search', la: '/la/search', zh: '/zh/search', 'x-default': '/search' },
  },
  // Both blocks, always (i18n.md, "the share card").
  openGraph: {
    title: TITLE,
    description: DESCRIPTION,
    siteName: 'Source Library',
    type: 'website',
    locale: OG_LOCALE.zh,
    url: 'https://sourcelibrary.org/zh/search',
    images: [siteOgImage('zh')],
  },
  twitter: {
    card: 'summary',
    title: TITLE,
    description: DESCRIPTION,
    images: [siteOgImage('zh')],
  },
};

export default function ZhSearchLayout({ children }: { children: React.ReactNode }) {
  return (
    <Suspense>
      <h1 className="sr-only">在 Source Library 中搜索</h1>
      {children}
    </Suspense>
  );
}
