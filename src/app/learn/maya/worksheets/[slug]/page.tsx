import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import SiteHeader from '@/components/layout/SiteHeader';
import SheetView from '../Sheet';
import PrintButton from '../PrintButton';
import { SHEETS, getSheet } from '../data';

export const dynamicParams = false;

export function generateStaticParams() {
  return SHEETS.map((s) => ({ slug: s.slug }));
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const sheet = getSheet((await params).slug);
  if (!sheet) return {};
  return {
    title: `${sheet.title}: Maya glyph worksheet - Source Library`,
    description: sheet.intro,
    alternates: { canonical: `/learn/maya/worksheets/${sheet.slug}` },
  };
}

export default async function WorksheetPage({ params }: { params: Promise<{ slug: string }> }) {
  const sheet = getSheet((await params).slug);
  if (!sheet) notFound();
  const i = SHEETS.indexOf(sheet);
  const prev = SHEETS[i - 1];
  const next = SHEETS[i + 1];
  return (
    <>
      <div className="ws-noprint"><SiteHeader variant="dark" /></div>
      <main>
        <nav className="ws-noprint max-w-[820px] mx-auto px-4 pt-6 pb-5 flex flex-wrap items-center gap-4 text-[15px] font-bold">
          <Link href="/learn/maya/worksheets" className="hover:underline">← All sheets</Link>
          <span className="flex-1" />
          {prev && <Link href={`/learn/maya/worksheets/${prev.slug}`} className="hover:underline">‹ {prev.title}</Link>}
          {next && <Link href={`/learn/maya/worksheets/${next.slug}`} className="hover:underline">{next.title} ›</Link>}
          <PrintButton />
        </nav>
        <div className="px-4 pb-12 print:p-0">
          <div className="ws-frame ts-tile-flat max-w-[860px] mx-auto">
            <SheetView sheet={sheet} />
          </div>
        </div>
      </main>
    </>
  );
}
