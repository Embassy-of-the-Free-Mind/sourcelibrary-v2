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
    detail: 'Initial Next.js scaffold with MongoDB integration',
    color: 'var(--accent-rust)',
  },
  {
    date: 'Dec 15',
    title: 'OCR + translation',
    detail: 'First AI-powered text extraction and translation using Gemini',
    color: 'var(--accent-sage)',
  },
  {
    date: 'Dec 17',
    title: 'Custom prompts',
    detail: 'Prompt versioning system with MongoDB storage',
    color: 'var(--accent-violet)',
  },
  {
    date: 'Dec 22',
    title: 'Internet Archive import',
    detail: 'First external library connector — import books from archive.org',
    color: 'var(--accent-rust)',
  },
  {
    date: 'Dec 24',
    title: 'Split detection',
    detail: 'ML-powered detection of two-page spreads in digitized books',
    color: 'var(--accent-gold)',
  },
  {
    date: 'Dec 25',
    title: 'MCP server + Batch API',
    detail: 'Claude MCP integration for AI research. Gemini Batch API for 50% cost savings.',
    color: 'var(--accent-violet)',
  },
  {
    date: 'Dec 27',
    title: 'Image gallery',
    detail: 'AI-powered extraction and cataloguing of illustrations, emblems, diagrams',
    color: 'var(--accent-gold)',
  },
  {
    date: 'Dec 28',
    title: 'Edition publishing',
    detail: 'Scholarly editions with front matter, DOI minting via Zenodo',
    color: 'var(--accent-rust)',
  },
  {
    date: 'Dec 29',
    title: 'Encyclopedia',
    detail: 'Cross-book entity index linking people, places, concepts across the collection',
    color: 'var(--accent-violet)',
  },
  {
    date: 'Jan 1',
    title: 'Analytics + Gallica/MDZ',
    detail: 'Custom analytics. Import from Gallica (BnF) and MDZ (Bavarian State Library).',
    color: 'var(--accent-sage)',
  },
  {
    date: 'Jan 4',
    title: 'Gallery redesign + SEO',
    detail: 'Image discovery interface. Schema.org structured data. About and developers pages.',
    color: 'var(--accent-gold)',
  },
  {
    date: 'Jan 15',
    title: '6 new library importers',
    detail: 'Wellcome, e-rara, Bodleian, Cambridge, Vatican, HAB. Total: 13 sources.',
    color: 'var(--accent-rust)',
  },
  {
    date: 'Feb 4',
    title: 'AWS Lambda workers',
    detail: 'Dedicated OCR, translation, and image extraction workers on SQS queues',
    color: 'var(--accent-sage)',
  },
  {
    date: 'Feb 12',
    title: 'Gemini Batch API',
    detail: 'Large-scale batch processing with 50% cost savings. IIIF manifest endpoint.',
    color: 'var(--accent-violet)',
  },
  {
    date: 'Feb 14',
    title: 'Automated pipeline',
    detail: 'Full post-import pipeline: archive, OCR, translate, enrich, chapters, images',
    color: 'var(--accent-rust)',
  },
  {
    date: 'Feb 15',
    title: 'English modernization',
    detail: 'Early Modern English books get modernized instead of translated. Blog launched.',
    color: 'var(--accent-gold)',
  },
  {
    date: 'Feb 16',
    title: 'Gallery collections + feeds',
    detail: 'Curated gallery collections. Atom feeds. Similarity search with embeddings.',
    color: 'var(--accent-violet)',
  },
  {
    date: 'Feb 19',
    title: 'Batch processing at scale',
    detail: '700+ batch OCR jobs processed. Multi-key management. Pipeline quality checks.',
    color: 'var(--accent-sage)',
  },
  {
    date: 'Feb 21',
    title: 'Wikidata alignment',
    detail: 'Entity enrichment from Wikidata. Attribution and licensing framework.',
    color: 'var(--accent-rust)',
  },
  {
    date: 'Feb 25',
    title: 'Strategic plan',
    detail: 'Institutional plan and budget for scaling as an EFM program',
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

        {/* Technical stats */}
        <h2 className="text-2xl md:text-3xl text-primary mt-16 mb-6">By the Numbers</h2>

        <div className="grid md:grid-cols-2 gap-6 mb-12">
          <div className="bg-white rounded-xl p-6 border border-border-light">
            <h3 className="font-semibold text-primary mb-3">Infrastructure</h3>
            <ul className="space-y-2 text-secondary text-sm">
              <li>13 digital library import sources</li>
              <li>3 AWS Lambda workers (OCR, translation, image extraction)</li>
              <li>9 automated cron jobs</li>
              <li>Gemini Batch API with 50% cost savings</li>
              <li>IIIF Presentation API 3.0 manifests</li>
              <li>Schema.org structured data on all pages</li>
            </ul>
          </div>
          <div className="bg-white rounded-xl p-6 border border-border-light">
            <h3 className="font-semibold text-primary mb-3">AI Pipeline</h3>
            <ul className="space-y-2 text-secondary text-sm">
              <li>Language-specific OCR prompts (Standard, Latin, German)</li>
              <li>Context-aware translation with cross-page continuity</li>
              <li>English modernization (Early Modern English)</li>
              <li>Multi-column layout detection</li>
              <li>AI image extraction with museum-style metadata</li>
              <li>Total processing cost: ~$3,400 for 4,400+ books</li>
            </ul>
          </div>
          <div className="bg-white rounded-xl p-6 border border-border-light">
            <h3 className="font-semibold text-primary mb-3">Scholarly Features</h3>
            <ul className="space-y-2 text-secondary text-sm">
              <li>DOI-backed scholarly editions via Zenodo</li>
              <li>AI-generated front matter and introductions</li>
              <li>Cross-book entity encyclopedia</li>
              <li>Community annotations and highlights</li>
              <li>Citation export (APA, BibTeX)</li>
            </ul>
          </div>
          <div className="bg-white rounded-xl p-6 border border-border-light">
            <h3 className="font-semibold text-primary mb-3">Developer Tools</h3>
            <ul className="space-y-2 text-secondary text-sm">
              <li>MCP server with 11 research tools</li>
              <li>REST API for all data</li>
              <li>Atom feeds (gallery, new books)</li>
              <li>Embedding-based similarity search</li>
              <li>Full-text search with alias expansion</li>
            </ul>
          </div>
        </div>
      </div>
    </ContentPageLayout>
  );
}
