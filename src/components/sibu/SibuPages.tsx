import Link from 'next/link';
import type { Metadata } from 'next';
import { ArrowLeft } from 'lucide-react';
import ConditionalSiteHeader from '@/components/layout/ConditionalSiteHeader';
import { localePath } from '@/lib/locale-path';
import {
  OUTSIDE_CODE, SIBU_GENERATED, SIBU_PARTS, SIBU_TOTALS,
  sibuClass, sibuCount, sibuPartCount, sibuRows,
} from '@/lib/sibu-catalogue';

/**
 * The 四部 catalogue at /zh/sibu (leads) and /sibu. One component, two URLs, as the book page:
 * routes are thin and pass `lang`.
 */
export type SibuLang = 'zh' | 'en';

const T = {
  zh: {
    title: '四部书目',
    intro: '馆藏中文古籍，按《四库全书总目》的经、史、子、集分类，并附道藏、佛藏。每种书列为一条，点击打开第一册，书页上可查看其余各册。',
    gap: '目前馆藏集中于经部与子部；史部和集部很少，空缺的类目如实列出。',
    source: '类目与题录依据 Kanseki Repository（漢籍リポジトリ）目录。',
    stats: (w: string, v: string) => `${w} 种，${v} 册`,
    asOf: (d: string) => `统计截至 ${d}。`,
    none: '暂无',
    outside: '未入目录',
    outsideNote: '《四库》未收或目录未能对应的著作，包括白话小说、戏曲、禁毁书和敦煌写本。',
    back: '四部书目',
    vols: (n: string) => `${n} 册`,
    emptyClass: '此类暂无馆藏。',
    collections: '专题',
  },
  en: {
    title: 'The Four Branches',
    intro: 'Our Chinese books by the classes of the Siku Quanshu catalogue: Classics, Histories, Masters and Literary collections, with the Daoist and Buddhist canons. Each work is one row. It opens on the first volume, whose page lists the others.',
    gap: 'We hold mainly Classics and Masters. Histories and Literary collections are thin, and the empty classes are listed as empty.',
    source: 'Classes and titles follow the Kanseki Repository catalogue.',
    stats: (w: string, v: string) => `${w} works, ${v} volumes`,
    asOf: (d: string) => `Counted ${d}.`,
    none: 'None yet',
    outside: 'Outside the catalogue',
    outsideNote: 'Works the Siku left out, or that we could not match to the catalogue: vernacular fiction, drama, banned books and Dunhuang manuscripts among them.',
    back: 'The Four Branches',
    vols: (n: string) => `${n} volumes`,
    emptyClass: 'We hold nothing in this class yet.',
    collections: 'Collections',
  },
} as const;

const nf = (n: number, lang: SibuLang) => n.toLocaleString(lang === 'zh' ? 'zh-CN' : 'en-US');
const url = (lang: SibuLang, path: string) => (lang === 'zh' ? `/zh${path}` : path);

function shareMeta(lang: SibuLang, path: string, title: string, description: string): Metadata {
  return {
    title: `${title} | Source Library`,
    description,
    alternates: {
      canonical: url(lang, path),
      languages: { en: path, zh: `/zh${path}`, 'x-default': path },
    },
    // Set both blocks: declaring only openGraph leaves the layout's English twitter card (i18n.md).
    openGraph: { title, description, siteName: 'Source Library', type: 'website', url: `https://sourcelibrary.org${url(lang, path)}` },
    twitter: { card: 'summary', title, description },
  };
}

export function sibuIndexMetadata(lang: SibuLang): Metadata {
  return shareMeta(lang, '/sibu', T[lang].title, T[lang].intro);
}

export function sibuClassMetadata(lang: SibuLang, code: string): Metadata {
  const c = sibuClass(code);
  const name = code === OUTSIDE_CODE ? T[lang].outside : c ? (lang === 'zh' ? `${c.part.zh} · ${c.zh}` : `${c.part.en}: ${c.en}`) : T[lang].title;
  return shareMeta(lang, `/sibu/${code}`, name, T[lang].intro);
}

export function SibuIndex({ lang }: { lang: SibuLang }) {
  const t = T[lang];
  const outside = sibuCount(OUTSIDE_CODE);
  return (
    <div className="min-h-screen bg-cream" lang={lang === 'zh' ? 'zh-Hans' : 'en'}>
      <ConditionalSiteHeader variant="light" />
      <main className="max-w-5xl mx-auto px-6 py-10 sm:py-14">
        <Link href={localePath('/collections', lang)} className="inline-flex items-center gap-2 text-sm text-muted hover:text-primary mb-6">
          <ArrowLeft className="w-4 h-4" />{t.collections}
        </Link>
        <h1 className="text-4xl sm:text-5xl font-display text-primary mb-4">{t.title}</h1>
        <p className="text-lg leading-relaxed text-primary/90 max-w-3xl mb-3">{t.intro}</p>
        <p className="leading-relaxed text-primary/90 max-w-3xl mb-3">{t.gap}</p>
        <p className="text-sm text-muted mb-10">
          {t.stats(nf(SIBU_TOTALS.works, lang), nf(SIBU_TOTALS.volumes, lang))} · {t.asOf(SIBU_GENERATED)} {t.source}
        </p>

        {SIBU_PARTS.map((part) => {
          const count = sibuPartCount(part);
          // The canons are additions to the Siku scheme, so their empty classes are not gaps worth listing.
          const classes = part.canon ? part.classes.filter((c) => sibuCount(c.code).works > 0) : part.classes;
          return (
            <section key={part.code} className="mb-10">
              <h2 className="flex flex-wrap items-baseline gap-3 border-b border-primary/20 pb-2 mb-1">
                <span className="text-2xl sm:text-3xl font-display text-primary">{lang === 'zh' ? part.zh : part.en}</span>
                {lang === 'en' && <span className="text-lg text-muted" lang="zh-Hans">{part.zh}</span>}
                <span className="text-sm text-muted tabular-nums">{t.stats(nf(count.works, lang), nf(count.vols, lang))}</span>
              </h2>
              <ul className="grid sm:grid-cols-2 gap-x-8">
                {classes.map((c) => {
                  const n = sibuCount(c.code);
                  const label = lang === 'zh' ? c.zh : c.en;
                  return (
                    <li key={c.code} className="flex items-baseline justify-between gap-4 py-2 border-b border-primary/10">
                      {n.works > 0
                        ? <Link href={localePath(`/sibu/${c.code}`, lang)} className="text-primary hover:text-accent-rust min-w-0">{label}</Link>
                        : <span className="text-muted min-w-0">{label}</span>}
                      <span className="text-sm text-muted tabular-nums shrink-0">{n.works > 0 ? t.stats(nf(n.works, lang), nf(n.vols, lang)) : t.none}</span>
                    </li>
                  );
                })}
              </ul>
            </section>
          );
        })}

        <section className="mb-10">
          <h2 className="flex flex-wrap items-baseline gap-3 border-b border-primary/20 pb-2 mb-3">
            <Link href={localePath(`/sibu/${OUTSIDE_CODE}`, lang)} className="text-2xl sm:text-3xl font-display text-primary hover:text-accent-rust">{t.outside}</Link>
            <span className="text-sm text-muted tabular-nums">{t.stats(nf(outside.works, lang), nf(outside.vols, lang))}</span>
          </h2>
          <p className="leading-relaxed text-primary/90 max-w-3xl">{t.outsideNote}</p>
        </section>
      </main>
    </div>
  );
}

export function SibuClassPage({ lang, code }: { lang: SibuLang; code: string }) {
  const t = T[lang];
  const c = sibuClass(code);
  const rows = sibuRows(code);
  const count = sibuCount(code);
  const heading = code === OUTSIDE_CODE ? t.outside : lang === 'zh' ? c?.zh : c?.en;
  const eyebrow = c ? (lang === 'zh' ? c.part.zh : c.part.en) : null;
  return (
    <div className="min-h-screen bg-cream" lang={lang === 'zh' ? 'zh-Hans' : 'en'}>
      <ConditionalSiteHeader variant="light" />
      <main className="max-w-5xl mx-auto px-6 py-10 sm:py-14">
        <Link href={localePath('/sibu', lang)} className="inline-flex items-center gap-2 text-sm text-muted hover:text-primary mb-6">
          <ArrowLeft className="w-4 h-4" />{t.back}
        </Link>
        {eyebrow && <p className="text-sm text-muted mb-1">{eyebrow}</p>}
        <h1 className="text-4xl sm:text-5xl font-display text-primary mb-3">{heading}</h1>
        <p className="text-sm text-muted tabular-nums mb-3">{t.stats(nf(count.works, lang), nf(count.vols, lang))}</p>
        {code === OUTSIDE_CODE && <p className="leading-relaxed text-primary/90 max-w-3xl mb-3">{t.outsideNote}</p>}
        {rows.length === 0 && <p className="text-muted mt-6">{t.emptyClass}</p>}
        <ol className="mt-6">
          {rows.map((r) => (
            <li key={`${r.kr || r.title}-${r.first}`} className="py-3 border-b border-primary/10 flex items-baseline justify-between gap-4">
              <div className="min-w-0">
                <Link href={localePath(`/book/${encodeURIComponent(r.first)}`, lang)} className="text-lg text-primary hover:text-accent-rust" lang="zh-Hant">
                  {r.title}
                </Link>
                {lang === 'en' && r.gloss && r.gloss !== r.title && <span className="block text-sm text-primary/80">{r.gloss}</span>}
                {(r.dynasty || r.author) && (
                  <span className="block text-sm text-muted" lang="zh-Hant">
                    {r.dynasty ? `〔${r.dynasty}〕` : ''}{r.author}
                  </span>
                )}
              </div>
              <span className="text-sm text-muted tabular-nums shrink-0">{t.vols(nf(r.vols, lang))}</span>
            </li>
          ))}
        </ol>
      </main>
    </div>
  );
}
