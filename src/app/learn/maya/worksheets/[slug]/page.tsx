import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import SiteHeader from '@/components/layout/SiteHeader';
import SheetView from '../Sheet';
import PrintButton from '../PrintButton';
import { SHEETS, getSheet } from '../data';
import '../print.css';

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
      <main className="bg-cream min-h-screen print:bg-white">
        <nav className="ws-noprint max-w-[800px] mx-auto px-4 pt-6 pb-4 flex flex-wrap items-center gap-3 text-sm">
          <Link href="/learn/maya/worksheets" className="text-stone-600 hover:underline">← All worksheets</Link>
          <span className="flex-1" />
          {prev && <Link href={`/learn/maya/worksheets/${prev.slug}`} className="text-stone-600 hover:underline">‹ {prev.title}</Link>}
          {next && <Link href={`/learn/maya/worksheets/${next.slug}`} className="text-stone-600 hover:underline">{next.title} ›</Link>}
          <PrintButton />
        </nav>
        <div className="pb-12 print:pb-0">
          <SheetView sheet={sheet} />
        </div>
      </main>
    </>
  );
}
