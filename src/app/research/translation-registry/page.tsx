import { Metadata } from 'next';
import type { ReactNode } from 'react';
import Link from 'next/link';
import ContentPageLayout, { ContentHeader } from '@/components/layout/ContentPageLayout';
import RegistryBrowser from './RegistryBrowser';
import registryData from './registry-data.json';

export const revalidate = false;

export const metadata: Metadata = {
  title: 'The Translation Registry — Source Library Research',
  description:
    'Which early-modern Latin works have already been translated into English — and who translated them? A work-level registry that credits the translators and links to the translations, the companion to the Translation Gap.',
  alternates: { canonical: '/research/translation-registry' },
  openGraph: {
    images: [{ url: 'https://sourcelibrary.org/og-image.jpg', alt: 'Source Library — Digitizing and translating ancient texts' }],
    title: 'The Translation Registry',
    description:
      'The early-modern Latin works that have been Englished, and the translators who did it. The companion to the Translation Gap.',
  },
};

// Stats are computed server-side from the full dataset; only these numbers reach
// the client. The browse rows are fetched a page at a time from the API route,
// so the ~1,600-work dataset is never serialized into the page.
const works = registryData.works;
const translatorCount = (() => {
  const s = new Set<string>();
  for (const w of works) for (const c of w.c) if (c.tr) s.add(c.tr.toLowerCase());
  return s.size;
})();
const renCount = works.filter((w) => w.tgt).length;
const workHeld = works.filter((w) => w.h === 'work').length;
const workLinkable = works.filter((w) => w.h === 'work' && w.slug).length;
const authorHeld = works.filter((w) => w.h === 'author').length;
const totalRecords = (registryData as { total_records?: number }).total_records ?? 0;

function Stat({ n, unit, label }: { n: string; unit?: string; label: string }) {
  return (
    <div className="px-5 py-6 border-stone-200 [&:not(:last-child)]:border-r max-sm:[&:nth-child(odd)]:border-r max-sm:[&:nth-child(-n+2)]:border-b">
      <div className="font-serif text-3xl md:text-4xl text-stone-900 tracking-tight">
        {n}
        {unit && <span className="text-amber-800 text-2xl">{unit}</span>}
      </div>
      <div className="font-body text-sm text-stone-500 mt-1.5 leading-snug">{label}</div>
    </div>
  );
}

function Section({ kicker, title, children }: { kicker: string; title: string; children: ReactNode }) {
  return (
    <section className="py-12 border-b border-stone-200">
      <div className="font-body text-xs tracking-[0.16em] uppercase text-amber-700 font-semibold mb-3">{kicker}</div>
      <h2 className="font-serif text-2xl md:text-3xl text-stone-900 mb-4 tracking-tight">{title}</h2>
      {children}
    </section>
  );
}

export default function TranslationRegistryPage() {
  return (
    <ContentPageLayout
      header={
        <ContentHeader
          title="The Translation Registry"
          subtitle="The flip side of the Translation Gap. As we check whether each early-modern Latin work has ever been Englished, we are building a registry of the ones that have — crediting the translators who did the work, and linking to the translations that exist. The works that never appear here are the gap."
        />
      }
    >
      <div className="max-w-3xl mx-auto font-body text-stone-700 text-lg leading-relaxed">
        <div className="grid grid-cols-2 md:grid-cols-4 border border-stone-200 rounded-lg my-8 text-center">
          <Stat n={totalRecords.toLocaleString()} label="translation records in our database" />
          <Stat n={works.length.toLocaleString()} label="distinct works they resolve to" />
          <Stat n={translatorCount.toLocaleString()} label="translators credited" />
          <Stat n={workHeld.toLocaleString()} label="whose original we hold on Source Library" />
        </div>
        <p className="-mt-4 mb-6 text-base text-stone-500">
          {totalRecords.toLocaleString()} published-translation records — across the UNESCO Index Translationum, the Library
          of Congress, scholarly series, and more — collapse to <strong className="text-stone-700">{works.length.toLocaleString()} distinct
          works</strong> once reprints and re-catalogued editions of the same translation are merged. {renCount.toLocaleString()} are
          Renaissance Latin.
        </p>

        <p>
          The <Link href="/research/translation-gap" className="text-amber-800 hover:underline">Translation Gap</Link> measures
          what has <em>not</em> been translated: of roughly 366,000 distinct Latin works printed in Europe between 1400
          and 1700, fewer than 3% have a known English translation. This page is the other half of that same count — the
          works that <em>have</em> been translated, and the people who translated them.
        </p>
        <p className="mt-4">
          Every entry was found in an external source — a scholarly series like the I Tatti Renaissance Library or Brill,
          or a bibliographic catalogue like the UNESCO Index Translationum and the Library of Congress — and matched to its
          original in the Universal Short Title Catalogue at the level of the <em>work</em>, not the edition. We only count
          translations made <em>independently</em> of Source Library, so this is a record of the field&rsquo;s collective
          effort, not our own.
        </p>
        <p className="mt-4 text-base text-stone-600">
          <strong className="text-stone-800">A note on &ldquo;in our library.&rdquo;</strong> These published translations
          are mostly in copyright (Harvard, Brill, Loeb) and are <em>not</em> hosted here — follow the credit to find them.
          What Source Library holds is the <em>original</em>: we own the source text for {workHeld.toLocaleString()} of
          these works ({workLinkable.toLocaleString()} of them publicly readable now via the <em>Read original</em> link; the
          rest are held but still processing), and other writings by the author for {authorHeld.toLocaleString()} more.
        </p>
      </div>

      <div className="max-w-3xl mx-auto mt-10">
        <RegistryBrowser />
      </div>

      <div className="max-w-3xl mx-auto font-body text-stone-700 text-lg leading-relaxed">
        <Section kicker="How this was built" title="A work-level, translator-credited census">
          <p>
            The registry is generated by matching known translations to USTC work-clusters using author identity plus
            rare-token title overlap, with a confidence gate so the credits shown here are trustworthy. It is deliberately
            conservative: a small number of works are still listed under variant spellings, and the obscure long tail of
            translations is never fully captured — so treat this as a floor on what has been translated, and the gap as a
            floor on what has not.
          </p>
          <p className="mt-4">
            The full method, the data sources, and the honest confidence levels behind every number are written up in the{' '}
            <Link href="/research/translation-gap" className="text-amber-800 hover:underline">Translation Gap</Link> companion.
            This registry grows as the pipeline reads more of the corpus.
          </p>
        </Section>
      </div>
    </ContentPageLayout>
  );
}
