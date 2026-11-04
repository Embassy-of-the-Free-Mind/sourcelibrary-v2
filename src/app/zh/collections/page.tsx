import type { Metadata } from 'next';
import Link from 'next/link';
import ConditionalSiteHeader from '@/components/layout/ConditionalSiteHeader';
import CollectionCardImage from '@/components/collections/CollectionCardImage';
import { getZhCollectionList, type ZhCollectionSummary } from '@/lib/zh-collections';
import { SIBU_TOTALS } from '@/lib/sibu-catalogue';
import { siteOgImage } from '@/lib/og-locale';

// Data failures throw, so ISR keeps the last good page instead of caching an empty grid (#2973).
export const revalidate = 3600;
export const maxDuration = 60;

const TITLE = '专题 | Source Library';
const DESCRIPTION = '按四部分类检索馆藏中文古籍，或浏览中西典籍对读的专题。';

export const metadata: Metadata = {
  title: TITLE,
  description: DESCRIPTION,
  alternates: {
    canonical: '/zh/collections',
    languages: { en: '/collections', zh: '/zh/collections', 'x-default': '/collections' },
  },
  openGraph: { title: TITLE, description: DESCRIPTION, siteName: 'Source Library', type: 'website', locale: 'zh_CN', url: 'https://sourcelibrary.org/zh/collections', images: [siteOgImage('zh')] },
  twitter: { card: 'summary_large_image', title: TITLE, description: DESCRIPTION, images: [siteOgImage('zh')] },
};

const nf = (n: number) => n.toLocaleString('zh-CN');

function Card({ col, priority }: { col: ZhCollectionSummary; priority?: boolean }) {
  return (
    <Link href={`/zh/collections/${col.slug}`} className="group relative block overflow-hidden rounded-lg aspect-square">
      <CollectionCardImage candidates={col.imageCandidates} alt="" sizes="(max-width: 640px) 50vw, (max-width: 1024px) 33vw, 25vw" priority={priority} />
      <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/20 to-transparent" />
      <div className="absolute bottom-0 left-0 right-0 p-4">
        <h3 className="text-white text-xl font-display leading-tight group-hover:text-accent-rust transition-colors">{col.name}</h3>
        <p className="text-white/60 text-xs tabular-nums mt-1">{nf(col.bookCount)} 册</p>
      </div>
    </Link>
  );
}

function Grid({ cols, priority }: { cols: ZhCollectionSummary[]; priority?: boolean }) {
  return (
    <div className="grid gap-4 grid-cols-2 md:grid-cols-3 lg:grid-cols-4">
      {cols.map((c, i) => <Card key={c.slug} col={c} priority={priority && i < 2} />)}
    </div>
  );
}

export default async function ZhCollectionsPage() {
  const cols = await getZhCollectionList();
  const exhibits = cols.filter((c) => c.isExhibit);
  const shelves = cols.filter((c) => !c.isExhibit);
  return (
    <div className="min-h-screen bg-cream" lang="zh-Hans">
      <ConditionalSiteHeader variant="light" />
      <main className="max-w-[1500px] mx-auto px-6 py-10 sm:py-14">
        <h1 className="text-4xl sm:text-5xl font-display text-primary mb-8">专题</h1>

        <Link href="/zh/sibu" className="block border border-primary/20 hover:border-accent-rust p-6 mb-12 max-w-3xl transition-colors">
          <span className="block text-2xl font-display text-primary mb-1">四部书目</span>
          <span className="block leading-relaxed text-primary/90">
            全部馆藏中文古籍（{nf(SIBU_TOTALS.works)} 种，{nf(SIBU_TOTALS.volumes)} 册），按《四库全书总目》的经、史、子、集分类检索。
          </span>
        </Link>

        {exhibits.length > 0 && (
          <section className="mb-12">
            <h2 className="text-2xl sm:text-3xl font-display text-primary mb-5">策展专题</h2>
            <Grid cols={exhibits} priority />
          </section>
        )}
        {shelves.length > 0 && (
          <section className="mb-12">
            <h2 className="text-2xl sm:text-3xl font-display text-primary mb-5">主题书架</h2>
            <Grid cols={shelves} />
          </section>
        )}
      </main>
    </div>
  );
}
