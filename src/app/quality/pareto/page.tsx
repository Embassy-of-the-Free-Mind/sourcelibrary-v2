import { Metadata } from 'next';
import Link from 'next/link';
import ContentPageLayout from '@/components/layout/ContentPageLayout';
import SiteHeader from '@/components/layout/SiteHeader';
import { ParetoPresentation } from '../ParetoCharts';

// The cost/accuracy charts one per screen, for presenting (#5983). Same data and components as the
// grid on /quality; every number is read at build time from src/data/ocr-pareto.json.
export const revalidate = false;

export const metadata: Metadata = {
  title: 'OCR Cost Against Accuracy, by Script — Source Library',
  description:
    'For each script we read, what each OCR engine costs per 1,000 pages and how accurately it reads against a typed edition, with 95% intervals and the frontier of engines nothing else beats.',
  alternates: { canonical: '/quality/pareto' },
};

export default function ParetoPage() {
  return (
    <ContentPageLayout header={<SiteHeader variant="light" />} bg="bg-cream" maxWidth="wide">
      <header className="max-w-3xl">
        <p className="text-sm uppercase tracking-wider text-stone-600">
          <Link href="/quality" className="hover:text-amber-800">Quality Center</Link>
        </p>
        <h1 className="font-serif text-4xl md:text-5xl text-stone-900 mt-2">What it costs to read a page, and how well</h1>
        <p className="text-lg text-stone-700 leading-relaxed mt-4">
          One chart per script. Within a chart, the engines are compared only on pages every one of them read, against a
          typed edition of the same pages. The bar on each dot is its 95% interval; where only a few books were read, the
          chart says so. Each chart has its own link and downloads as SVG or PNG for slides. Scroll for the next script.
        </p>
      </header>
      <ParetoPresentation />
    </ContentPageLayout>
  );
}
