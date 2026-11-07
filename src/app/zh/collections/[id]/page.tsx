import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound, permanentRedirect } from 'next/navigation';
import { ArrowLeft } from 'lucide-react';
import ConditionalSiteHeader from '@/components/layout/ConditionalSiteHeader';
import CollectionCardImage from '@/components/collections/CollectionCardImage';
import CollectionBookCard, { type CollectionBook } from '@/components/CollectionBookCard';
import { getZhCollection } from '@/lib/zh-collections';
import { siteOgImage } from '@/lib/og-locale';
import collectionRedirects from '@/lib/collection-redirects.json';

// Chinese edition of /collections/[id]; see src/lib/zh-collections.ts for why a card is a work.
export const revalidate = 3600;
export const dynamicParams = true;
export const maxDuration = 60;

export async function generateStaticParams() {
  return [];
}

type Props = { params: Promise<{ id: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { id } = await params;
  const col = await getZhCollection(id);
  if (!col) return { title: '未找到专题 | Source Library' };
  const description = col.descriptionIsEnglish ? `${col.name}：Source Library 馆藏原始文献。` : (col.description || '').slice(0, 160);
  const image = col.heroImage ? { url: col.heroImage, alt: col.name } : siteOgImage('zh');
  return {
    title: `${col.name} | Source Library`,
    description,
    alternates: {
      canonical: `/zh/collections/${id}`,
      languages: { en: `/collections/${id}`, zh: `/zh/collections/${id}`, 'x-default': `/collections/${id}` },
    },
    openGraph: { title: col.name, description, siteName: 'Source Library', type: 'website', locale: 'zh_CN', url: `https://sourcelibrary.org/zh/collections/${id}`, images: [image] },
    twitter: { card: 'summary_large_image', title: col.name, description, images: [image] },
  };
}

const nf = (n: number) => n.toLocaleString('zh-CN');

export default async function ZhCollectionPage({ params }: Props) {
  const { id } = await params;
  const redirectTarget = (collectionRedirects as Record<string, string>)[id];
  if (redirectTarget) permanentRedirect(`/zh/collections/${redirectTarget}`);

  const col = await getZhCollection(id);
  if (!col) notFound();

  return (
    <div className="min-h-screen bg-cream" lang="zh-Hans">
      <ConditionalSiteHeader variant="light" />

      <div className="relative bg-dark overflow-hidden">
        {col.heroCandidates.length > 0 && (
          <div className="absolute inset-0 opacity-40">
            <CollectionCardImage candidates={col.heroCandidates} alt="" sizes="100vw" priority />
          </div>
        )}
        <div className="absolute inset-0 bg-gradient-to-b from-black/70 via-black/40 to-transparent" />
        <div className="relative max-w-[1500px] mx-auto px-6 pt-8 pb-12 sm:pb-16">
          <Link
            href={col.parent ? `/zh/collections/${col.parent.slug}` : '/zh/collections'}
            className="inline-flex items-center gap-2 text-sm text-white/50 hover:text-white/80 transition-colors mb-8"
          >
            <ArrowLeft className="w-4 h-4" />
            {col.parent ? col.parent.name : '专题'}
          </Link>
          <h1 className="text-4xl sm:text-5xl md:text-6xl text-white font-semibold leading-tight mb-3 font-display">{col.name}</h1>
          <p className="text-sm text-white/50 tabular-nums">{nf(col.bookCount)} 册</p>
        </div>
      </div>

      <div className="max-w-[1500px] mx-auto px-6 py-12">
        {col.description && (
          <div className="max-w-3xl mb-12">
            <p className="text-lg leading-relaxed text-primary/90 whitespace-pre-line" lang={col.descriptionIsEnglish ? 'en' : 'zh-Hans'}>
              {col.description}
            </p>
            {col.descriptionIsEnglish && <p className="mt-3 text-sm text-muted">简介暂为英文。</p>}
          </div>
        )}

        {col.children.length > 0 && (
          <section className="mb-14">
            <h2 className="text-2xl sm:text-3xl font-display text-primary mb-5">子专题</h2>
            <div className="grid gap-4 grid-cols-2 lg:grid-cols-4">
              {col.children.map((ch) => (
                <Link key={ch.slug} href={`/zh/collections/${ch.slug}`} className="group block">
                  <div className="relative aspect-[4/3] overflow-hidden bg-dark mb-2">
                    {ch.imageCandidates.length > 0 && <CollectionCardImage candidates={ch.imageCandidates} alt="" sizes="(max-width: 1024px) 50vw, 25vw" />}
                    <div className="absolute inset-0 bg-gradient-to-t from-black/70 to-transparent" />
                    <div className="absolute bottom-0 left-0 right-0 p-3">
                      <div className="text-white font-display text-lg leading-tight group-hover:text-accent-rust transition-colors">{ch.name}</div>
                      <div className="text-white/60 text-xs tabular-nums">{nf(ch.bookCount)} 册</div>
                    </div>
                  </div>
                </Link>
              ))}
            </div>
          </section>
        )}

        <section>
          <h2 className="text-2xl sm:text-3xl font-display text-primary mb-5">著作</h2>
          <div className="grid gap-6 grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
            {col.works.map((w) => (
              <div key={w.id}>
                <CollectionBookCard book={w as unknown as CollectionBook} lang="zh" />
                {w.vols > 1 && <p className="mt-1 text-xs text-muted tabular-nums">本专题收 {nf(w.vols)} 册</p>}
              </div>
            ))}
          </div>
          {col.truncated && (
            <p className="mt-8 text-sm text-muted">
              此处仅列阅读最多的著作。完整书目请见<Link href="/zh/sibu" className="underline hover:text-primary">四部书目</Link>。
            </p>
          )}
        </section>
      </div>
    </div>
  );
}
