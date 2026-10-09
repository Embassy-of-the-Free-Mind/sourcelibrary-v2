import { Metadata } from 'next';
import Link from 'next/link';
import ContentPageLayout from '@/components/layout/ContentPageLayout';
import SiteHeader from '@/components/layout/SiteHeader';
import { sampleAudit } from '@/lib/quality-center';
import { ParetoPresentation, TRANSLATION } from '../ParetoCharts';

const audit = sampleAudit();
const auditDate = new Date(`${audit.date}T12:00:00Z`).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });

// The cost/quality charts one per screen, for presenting (#5983): OCR by script, then translation by
// language. Same data and components as the grids on /quality; every number is read at build time from
// src/data/ocr-pareto.json and src/data/translation-pareto.json.
export const revalidate = false;

export const metadata: Metadata = {
  title: 'OCR and Translation Cost Against Quality | Source Library',
  description:
    'For each script we read, what each OCR engine costs per 1,000 pages and how closely its text agrees with a typed edition; for each language we translate, what each engine costs and how faithful its English is to a published translation. With 95% intervals and the frontier of engines nothing else beats.',
  alternates: { canonical: '/quality/pareto' },
};

export default function ParetoPage() {
  return (
    <ContentPageLayout header={<SiteHeader variant="light" />} bg="bg-cream" maxWidth="wide">
      {/* One wrapper, exempt from the site's scroll reveal (ScrollReveal.tsx). Without it the translation
          section was a single block thousands of pixels tall at opacity 0 until scrolled to, so a
          full-page capture or a print to PDF showed ~11,000 px of blank page where it should be (#6217). */}
      <div data-reveal-skip="">
      <header className="max-w-3xl">
        <p className="text-sm uppercase tracking-wider text-stone-600">
          <Link href="/quality" className="hover:text-amber-800">Quality Center</Link>
        </p>
        <h1 className="font-serif text-4xl md:text-5xl text-stone-900 mt-2">What it costs to read and translate a page, and how well</h1>
        <p className="text-lg text-stone-700 leading-relaxed mt-4">
          One chart per script for reading, then one per language for translation. Within a chart, the engines are compared
          only on pages every one of them handled, against a typed edition or a published translation of the same pages. The
          whisker on each dot is its 95% interval; where only a few books were read, the chart says so. A check of the pages
          behind the charts on {auditDate} left out {audit.dropped.translation + audit.dropped.ocr} that do not suit the
          measure; the limits it found are under each chart and{' '}
          <Link href="/quality#chart-limits" className="text-amber-800 underline decoration-amber-800/30 underline-offset-2">summed up on the Quality Center</Link>. Each chart has its own
          link and downloads as SVG or PNG for slides. Scroll for the next one, or jump to{' '}
          <a href="#translation" className="text-amber-800 underline decoration-amber-800/30 underline-offset-2">translation</a>.
        </p>
      </header>
      <h2 id="ocr" className="font-serif text-3xl text-stone-900 mt-12">Reading the page (OCR)</h2>
      <ParetoPresentation />
      <h2 id="translation" className="font-serif text-3xl text-stone-900 mt-16">Translating it into English</h2>
      <p className="text-lg text-stone-700 leading-relaxed mt-4 max-w-3xl">
        One chart per language. The score is model-judged, not human-scored: blind AI judges compare our English with a
        published human translation of the same page and grade it from 1 to 5. They read our transcription, not the page
        image, so a misread page can still score well.
      </p>
      <ParetoPresentation m={TRANSLATION} />
      </div>
    </ContentPageLayout>
  );
}
