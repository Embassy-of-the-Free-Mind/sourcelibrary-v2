import { Metadata } from 'next';
import ContentPageLayout, { ContentHeader } from '@/components/layout/ContentPageLayout';
import { ProgressCharts } from './ProgressCharts';

export const metadata: Metadata = {
  title: 'Progress — Source Library',
  description:
    'Development timeline and collection growth since December 2025. 1,000+ commits, 4,000+ books, 30+ languages.',
  alternates: { canonical: '/progress' },
};

/* ── Git commit data (pre-computed — git not available on Vercel) ── */

const WEEKLY_COMMITS = [
  { x: 'Dec 12', y: 8 },
  { x: 'Dec 15', y: 44 },
  { x: 'Dec 22', y: 265 },
  { x: 'Dec 29', y: 78 },
  { x: 'Jan 5', y: 83 },
  { x: 'Jan 12', y: 22 },
  { x: 'Jan 19', y: 2 },
  { x: 'Jan 26', y: 6 },
  { x: 'Feb 2', y: 20 },
  { x: 'Feb 9', y: 52 },
  { x: 'Feb 16', y: 164 },
  { x: 'Feb 23', y: 114 },
];

/* ── Key milestones (extracted from git log) ── */

interface Milestone {
  date: string;
  title: string;
  detail: string;
  color: string;
}

const MILESTONES: Milestone[] = [
  {
    date: 'Dec 12',
    title: 'Project started',
    detail: 'First commit — a Next.js app connected to a database',
    color: 'var(--accent-rust)',
  },
  {
    date: 'Dec 15',
    title: 'AI-powered OCR and translation',
    detail: 'Read a scanned page image, extract the text, translate it to English — all with one click',
    color: 'var(--accent-sage)',
  },
  {
    date: 'Dec 22',
    title: 'Internet Archive import',
    detail: 'Import any book from archive.org by pasting its identifier. First of 13 library connectors.',
    color: 'var(--accent-rust)',
  },
  {
    date: 'Dec 24',
    title: 'Two-page spread detection',
    detail: 'Automatically detect and split digitized two-page spreads into individual pages',
    color: 'var(--accent-gold)',
  },
  {
    date: 'Dec 25',
    title: 'MCP research server',
    detail: 'AI agents can search and cite Source Library texts directly via the Model Context Protocol',
    color: 'var(--accent-violet)',
  },
  {
    date: 'Dec 27',
    title: 'Image gallery',
    detail: 'AI finds and extracts illustrations, emblems, and diagrams — each with museum-style metadata',
    color: 'var(--accent-gold)',
  },
  {
    date: 'Dec 28',
    title: 'Scholarly edition publishing',
    detail: 'Publish citable editions with DOIs, front matter, and citation export (APA, BibTeX)',
    color: 'var(--accent-rust)',
  },
  {
    date: 'Dec 29',
    title: 'Encyclopedia',
    detail: 'Cross-book index of people, places, and concepts — linking references across the entire collection',
    color: 'var(--accent-violet)',
  },
  {
    date: 'Jan 1',
    title: 'Gallica and Bavarian State Library',
    detail: 'Import from the Bibliothque nationale de France and the Bayerische Staatsbibliothek',
    color: 'var(--accent-sage)',
  },
  {
    date: 'Jan 4',
    title: 'Gallery as discovery interface',
    detail: 'Browse 71,000+ extracted illustrations. Full-text search. Schema.org structured data for Google.',
    color: 'var(--accent-gold)',
  },
  {
    date: 'Jan 15',
    title: '6 new library sources in one day',
    detail: 'Wellcome Collection, e-rara, Bodleian, Cambridge, Vatican, Herzog August. Total: 13 sources.',
    color: 'var(--accent-rust)',
  },
  {
    date: 'Feb 4',
    title: 'Parallel processing workers',
    detail: 'Three dedicated workers process OCR, translation, and image extraction simultaneously',
    color: 'var(--accent-sage)',
  },
  {
    date: 'Feb 12',
    title: 'IIIF manifests',
    detail: 'Every book serves a standard IIIF Presentation API 3.0 manifest for interoperability',
    color: 'var(--accent-violet)',
  },
  {
    date: 'Feb 14',
    title: 'Fully automated pipeline',
    detail: 'Import a book and walk away — the system archives, OCRs, translates, indexes, and extracts images automatically',
    color: 'var(--accent-rust)',
  },
  {
    date: 'Feb 15',
    title: 'English modernization',
    detail: 'Pre-1700 English texts get modernized to contemporary English instead of "translated"',
    color: 'var(--accent-gold)',
  },
  {
    date: 'Feb 16',
    title: 'Curated collections and feeds',
    detail: 'Themed gallery collections. Atom feeds for new books and images. Visual similarity search.',
    color: 'var(--accent-violet)',
  },
  {
    date: 'Feb 21',
    title: 'Wikidata alignment',
    detail: 'Entities linked to Wikidata for authoritative dates, descriptions, and cross-references',
    color: 'var(--accent-rust)',
  },
  {
    date: 'Feb 25',
    title: 'Strategic plan published',
    detail: 'Three-year institutional plan for scaling Source Library as a program of the Embassy of the Free Mind',
    color: 'var(--accent-gold)',
  },
];

export default function ProgressPage() {
  return (
    <ContentPageLayout
      header={
        <ContentHeader
          title="Building Source Library"
          subtitle="From first commit to the world's largest translated primary source library — in 77 days."
        />
      }
      bg="bg-cream"
    >
      <div className="prose-content max-w-none">
        {/* Stats bar */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-12">
          {[
            { label: 'Commits', value: '1,024+', color: 'text-accent-violet' },
            { label: 'Days', value: '77', color: 'text-accent-rust' },
            { label: 'Features shipped', value: MILESTONES.length.toString(), color: 'text-accent-sage' },
            { label: 'Library sources', value: '13', color: 'text-accent-gold' },
          ].map(s => (
            <div key={s.label} className="bg-white rounded-xl p-4 border border-border-light text-center">
              <div className={`text-2xl md:text-3xl font-serif ${s.color}`}>{s.value}</div>
              <div className="text-muted text-sm">{s.label}</div>
            </div>
          ))}
        </div>

        {/* Development timeline */}
        <h2 className="text-2xl md:text-3xl text-primary mt-12 mb-8">Development Timeline</h2>

        <div className="relative ml-4 md:ml-8">
          {/* Vertical line */}
          <div className="absolute left-0 top-0 bottom-0 w-px bg-border-medium" />

          {MILESTONES.map((m, i) => (
            <div key={i} className="relative pl-8 pb-8 last:pb-0">
              {/* Dot */}
              <div
                className="absolute left-0 top-1.5 w-3 h-3 rounded-full -translate-x-[5.5px] border-2 border-white"
                style={{ backgroundColor: m.color }}
              />
              <div className="text-xs text-muted mb-0.5">{m.date}</div>
              <div className="text-primary font-medium">{m.title}</div>
              <div className="text-secondary text-sm">{m.detail}</div>
            </div>
          ))}
        </div>

        {/* Charts section */}
        <h2 className="text-2xl md:text-3xl text-primary mt-16 mb-8">Growth</h2>

        <ProgressCharts commitData={WEEKLY_COMMITS} />

        {/* Features */}
        <h2 className="text-2xl md:text-3xl text-primary mt-16 mb-6">What You Can Do</h2>

        <div className="grid md:grid-cols-2 gap-6 mb-12">
          <div className="bg-white rounded-xl p-6 border border-border-light">
            <h3 className="font-semibold text-primary mb-3">Read and Discover</h3>
            <ul className="space-y-2 text-secondary text-sm">
              <li>Read original texts alongside English translations, page by page</li>
              <li>Browse 71,000+ extracted illustrations with AI-generated descriptions</li>
              <li>Search across the full text of every book in the collection</li>
              <li>Explore an encyclopedia of people, places, and concepts across all books</li>
              <li>Find visually similar images across centuries of illustration</li>
            </ul>
          </div>
          <div className="bg-white rounded-xl p-6 border border-border-light">
            <h3 className="font-semibold text-primary mb-3">AI-Powered Processing</h3>
            <ul className="space-y-2 text-secondary text-sm">
              <li>OCR handles Fraktur, Latin abbreviations, multi-column layouts, and drop caps</li>
              <li>Translation preserves context across pages for coherent output</li>
              <li>Pre-1700 English texts are modernized rather than translated</li>
              <li>Every book gets an AI-generated summary, index, and chapter structure</li>
              <li>Illustrations are extracted with museum-style cataloguing metadata</li>
            </ul>
          </div>
          <div className="bg-white rounded-xl p-6 border border-border-light">
            <h3 className="font-semibold text-primary mb-3">Scholarly Publishing</h3>
            <ul className="space-y-2 text-secondary text-sm">
              <li>Publish citable editions with DOIs minted through Zenodo</li>
              <li>AI-generated scholarly front matter and introductions</li>
              <li>Citation export in APA and BibTeX formats</li>
              <li>Community annotations, highlights, and corrections</li>
              <li>Google Scholar meta tags for academic discoverability</li>
            </ul>
          </div>
          <div className="bg-white rounded-xl p-6 border border-border-light">
            <h3 className="font-semibold text-primary mb-3">For Developers and Researchers</h3>
            <ul className="space-y-2 text-secondary text-sm">
              <li>MCP server lets AI agents search and cite Source Library directly</li>
              <li>IIIF Presentation API 3.0 manifests for every book</li>
              <li>REST API for programmatic access to all data</li>
              <li>Atom feeds for new books and gallery images</li>
              <li>Import from 13 digital library sources worldwide</li>
            </ul>
          </div>
        </div>
      </div>
    </ContentPageLayout>
  );
}
