import type { Metadata } from 'next';
import { getHomeData } from '@/lib/home-data';
import HomeView from '@/components/home/HomeView';
import { FEED_TYPES } from '@/lib/feed-links';
import { siteOgImage } from '@/lib/og-locale';

// Chinese edition of the homepage (#6382), the mirror of `/la` (#6254): a
// front door onto books WRITTEN in Chinese, read in the original. Nothing is
// translated into Chinese; the shelf under the hero (`nativeShelf`) is the one
// section whose books are in the page's language. Interface in Simplified
// characters; the texts are shown as printed.
export const revalidate = 60;
export const maxDuration = 60;

const TITLE = 'Source Library：历史文献图书馆';
const DESCRIPTION =
  'Source Library 将古籍数字化、转录并翻译。一万多种以中文写成的书籍，可在此对照原书影像阅读原文。';

export const metadata: Metadata = {
  title: TITLE,
  description: DESCRIPTION,
  alternates: {
    canonical: '/zh',
    languages: {
      en: '/',
      es: '/es',
      la: '/la',
      nl: '/nl',
      zh: '/zh',
      'x-default': '/',
    },
    // See src/lib/feed-links.ts — declaring `languages` here replaces the
    // layout's whole `alternates`, feed links included.
    types: FEED_TYPES,
  },
  // Both blocks, or neither: declaring `openGraph` replaces the layout's block
  // whole while its `twitter` block survives (.claude/docs/i18n.md, share card).
  // The image is the English card until art in this language exists (see og-locale.ts).
  openGraph: {
    images: [siteOgImage('zh')],
    title: TITLE,
    description: DESCRIPTION,
    siteName: 'Source Library',
    type: 'website',
    locale: 'zh_CN',
    url: 'https://sourcelibrary.org/zh',
  },
  twitter: {
    card: 'summary_large_image',
    site: '@SourceLibrary_',
    title: TITLE,
    description: DESCRIPTION,
    images: [siteOgImage('zh')],
  },
};

export default async function HomePageZh() {
  const data = await getHomeData('zh');
  // Reading language is the URL prefix and nothing else: links out of this page
  // keep `/zh` where a twin route exists (localePath), and no preference is
  // stored anywhere (.claude/docs/i18n.md rule 6).
  return <HomeView data={data} lang="zh" />;
}
