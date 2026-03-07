import { Metadata } from 'next';
import Link from 'next/link';
import ContentPageLayout, { ContentHeader } from '@/components/layout/ContentPageLayout';
import PipelineDiagram, { type StageData } from '@/components/pipeline/PipelineDiagram';
import { getDb } from '@/lib/mongodb';

export const metadata: Metadata = {
  title: 'Pipeline Architecture | Source Library',
  description:
    'How Source Library processes 4,800+ historical books: Lambda workers, SQS queues, Gemini AI, and a 10-stage pipeline from import to complete.',
  alternates: { canonical: '/developers/pipeline' },
};

export const revalidate = 3600;

/* ── Data fetching ── */

// Map pipeline_auto.status values to display stage groups
const STATUS_TO_STAGE: Record<string, string> = {
  queued: 'import',
  archiving: 'archive',
  archive_complete: 'archive',
  ocr_submitted: 'ocr',
  ocr_complete: 'ocr',
  metadata_enriched: 'metadata',
  ft_verifying: 'ft-verify',
  ft_verified: 'ft-verify',
  translate_submitted: 'translate',
  translate_complete: 'translate',
  enriching: 'enrich',
  enriched: 'enrich',
  chapters: 'chapters',
  chapters_complete: 'chapters',
  images_submitted: 'images',
  images_complete: 'images',
  complete: 'complete',
  failed: 'failed',
  needs_attention: 'needs_attention',
  empty_shell: 'empty_shell',
  paused: 'paused',
};

async function getPipelineStats() {
  try {
    const db = await getDb();
    const books = db.collection('books');

    const [funnel, pageAgg, totalBooks] = await Promise.all([
      books
        .aggregate([
          { $match: { 'pipeline_auto.status': { $exists: true } } },
          { $group: { _id: '$pipeline_auto.status', count: { $sum: 1 } } },
          { $sort: { count: -1 } },
        ])
        .toArray(),
      books
        .aggregate([
          {
            $group: {
              _id: null,
              pages: { $sum: '$pages_count' },
              ocr: { $sum: '$pages_ocr' },
              translated: { $sum: '$pages_translated' },
            },
          },
        ])
        .toArray(),
      books.countDocuments({ hidden: { $ne: true } }),
    ]);

    const agg = pageAgg[0] || { pages: 0, ocr: 0, translated: 0 };

    // Group by stage
    const stageGroups: Record<string, { total: number; substages: { status: string; count: number }[] }> = {};
    for (const row of funnel) {
      const status = row._id as string;
      const stage = STATUS_TO_STAGE[status] || 'other';
      if (!stageGroups[stage]) stageGroups[stage] = { total: 0, substages: [] };
      stageGroups[stage].total += row.count as number;
      stageGroups[stage].substages.push({ status, count: row.count as number });
    }

    return {
      stageGroups,
      totalBooks,
      totalPages: agg.pages as number,
      pagesOcr: agg.ocr as number,
      pagesTranslated: agg.translated as number,
      totalInPipeline: funnel.reduce((sum, r) => sum + (r.count as number), 0),
      complete: stageGroups['complete']?.total || 0,
      failed: stageGroups['failed']?.total || 0,
      needsAttention: stageGroups['needs_attention']?.total || 0,
    };
  } catch {
    return null;
  }
}

function fmt(n: number): string {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + 'M';
  if (n >= 1_000) return (n / 1_000).toFixed(n >= 10_000 ? 0 : 1) + 'k';
  return n.toLocaleString();
}

/* ── Stage definitions for diagram ── */

const STAGE_COLORS: Record<string, { color: string; textColor: string }> = {
  import: { color: '#78716c', textColor: '#78716c' },
  archive: { color: '#c9a86c', textColor: '#9e7c3c' },
  ocr: { color: '#8b9a7d', textColor: '#5e6d52' },
  metadata: { color: '#c9a86c', textColor: '#9e7c3c' },
  'ft-verify': { color: '#7c5db5', textColor: '#7c5db5' },
  translate: { color: '#9e4a3a', textColor: '#9e4a3a' },
  enrich: { color: '#7c5db5', textColor: '#7c5db5' },
  chapters: { color: '#7c5db5', textColor: '#7c5db5' },
  images: { color: '#d97706', textColor: '#d97706' },
  complete: { color: '#16a34a', textColor: '#16a34a' },
};

const STAGE_ORDER = [
  { id: 'import', name: 'Import' },
  { id: 'archive', name: 'Archive' },
  { id: 'ocr', name: 'OCR' },
  { id: 'metadata', name: 'Metadata' },
  { id: 'ft-verify', name: 'FT Check' },
  { id: 'translate', name: 'Translate' },
  { id: 'enrich', name: 'Enrich' },
  { id: 'chapters', name: 'Chapters' },
  { id: 'images', name: 'Images' },
  { id: 'complete', name: 'Complete' },
];

function buildStages(stageGroups: Record<string, { total: number; substages: { status: string; count: number }[] }>): StageData[] {
  return STAGE_ORDER.map((s) => ({
    ...s,
    color: STAGE_COLORS[s.id]?.color || '#78716c',
    textColor: STAGE_COLORS[s.id]?.textColor || '#78716c',
    count: stageGroups[s.id]?.total || 0,
    substages: stageGroups[s.id]?.substages || [],
    icon: s.id,
  }));
}

/* ── Page ── */

export default async function PipelineArchitecturePage() {
  const stats = await getPipelineStats();
  const stages = stats ? buildStages(stats.stageGroups) : buildStages({});

  return (
    <ContentPageLayout
      header={
        <ContentHeader
          title="Pipeline Architecture"
          subtitle="How 4,800+ historical books flow from scanned images to searchable, translated text — the full technical picture."
        />
      }
      bg="bg-cream"
      maxWidth="wide"
    >
      <div className="prose-content max-w-none">
        {/* ── Summary stats ── */}
        {stats && (
          <div className="grid grid-cols-2 md:grid-cols-5 gap-3 mb-12">
            <StatCard label="Books" value={fmt(stats.totalBooks)} />
            <StatCard label="In pipeline" value={fmt(stats.totalInPipeline)} />
            <StatCard label="Pages OCR'd" value={fmt(stats.pagesOcr)} />
            <StatCard label="Pages translated" value={fmt(stats.pagesTranslated)} />
            <StatCard label="Complete" value={fmt(stats.complete)} accent />
          </div>
        )}

        {/* ── Main diagram ── */}
        <h2 className="text-2xl md:text-3xl text-primary mb-2">Processing Flow</h2>
        <p className="text-secondary mb-6">
          Each book passes through 10 stages. Two crons orchestrate the pipeline every 10 minutes.
          Click any stage to expand its details.
        </p>

        <div className="bg-white rounded-xl border border-border-light p-4 md:p-6 mb-12">
          <PipelineDiagram stages={stages} />
        </div>

        {/* ── Error states ── */}
        {stats && (stats.failed > 0 || stats.needsAttention > 0) && (
          <div className="flex flex-wrap gap-3 mb-12">
            {stats.failed > 0 && (
              <div className="bg-status-error/8 border border-status-error/20 rounded-lg px-4 py-2 text-sm">
                <span className="font-semibold text-status-error">{stats.failed}</span>{' '}
                <span className="text-secondary">failed (3+ retries exhausted)</span>
              </div>
            )}
            {stats.needsAttention > 0 && (
              <div className="bg-status-warning/8 border border-status-warning/20 rounded-lg px-4 py-2 text-sm">
                <span className="font-semibold text-status-warning">{stats.needsAttention}</span>{' '}
                <span className="text-secondary">need manual attention</span>
              </div>
            )}
          </div>
        )}

        {/* ── Safety mechanisms ── */}
        <h2 className="text-2xl md:text-3xl text-primary mt-16 mb-6">Safety Mechanisms</h2>
        <div className="grid md:grid-cols-2 gap-4 mb-16">
          <MechCard
            title="Backpressure"
            description="Each stage has hard caps on concurrent jobs (50 Lambda OCR, 100 Lambda translation, 200 Batch API, 10 image extraction). The cron skips submission when limits are hit."
          />
          <MechCard
            title="Staleness Detection"
            description="Books stuck in submitted/in-progress states for 48+ hours get rolled back to the previous stage. Zombie jobs (processing >24h) are force-completed."
          />
          <MechCard
            title="Emergency Stop"
            description="Selective phase pausing via system_config. Both submission AND completion phases are guarded — in-flight work can't cascade through paused stages."
          />
          <MechCard
            title="Circuit Breakers"
            description="3+ consecutive batch failures trigger automatic Lambda fallback. Quota exhaustion (HTTP 429) immediately switches backend. OCR loops capped at 3 retries."
          />
          <MechCard
            title="Non-blocking Enrichment"
            description="Metadata, FT check, summary, index, and chapters are non-critical: persistent failures skip ahead rather than stalling the entire pipeline."
          />
          <MechCard
            title="Write Queue Isolation"
            description="AI workers (600+ concurrent) never write to MongoDB directly. Results flow through an SQS write queue to a Writer Lambda capped at 50 concurrent instances."
          />
        </div>

        {/* ── Special behaviors ── */}
        <h2 className="text-2xl md:text-3xl text-primary mt-16 mb-6">Special Behaviors</h2>
        <div className="space-y-4 mb-16">
          <BehaviorCard
            title="English Modernization"
            description="English books from before 1700 are modernized (Early Modern English to Modern English) instead of translated. The output is stored in the same translation.data field, so all downstream processing works identically."
          />
          <BehaviorCard
            title="Split Detection"
            description="Digitized books often have two-page spreads. A cascade of heuristic, ML, and Gemini vision detection identifies spreads and computes crop coordinates (0-1000 scale) for each half."
          />
          <BehaviorCard
            title="FIFO Context Chain"
            description="Translation uses an SQS FIFO queue — pages process in order per book. Each Lambda invocation fetches the previous page's translation for terminology consistency and sentence continuity. Batch API is never used for translation."
          />
          <BehaviorCard
            title="Page Revisions"
            description="Every version of OCR and translation text is preserved in the page_revisions collection — AI, batch, manual, contributor. If a page was manually edited, re-processing creates a backup snapshot first."
          />
          <BehaviorCard
            title="Multi-Column Rendering"
            description="OCR prompts detect multi-column layouts (<columns>N</columns> metadata + <column-break/> inline markers). The reader renders these as CSS grid layouts, with a fallback midpoint split when only the metadata tag exists."
          />
        </div>

        {/* ── Cost summary ── */}
        <h2 className="text-2xl md:text-3xl text-primary mt-16 mb-6">Cost per Book</h2>
        <p className="text-secondary mb-4">
          Based on <code className="text-accent-rust text-sm">gemini-3-flash-preview</code> pricing.
          A typical 300-page book costs roughly $1.50 to fully process through all stages.
        </p>
        <div className="bg-white rounded-xl border border-border-light overflow-hidden mb-16">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border-light bg-stone-50">
                <th className="text-left px-4 py-3 font-medium text-muted">Step</th>
                <th className="text-left px-4 py-3 font-medium text-muted">Cost/page</th>
                <th className="text-left px-4 py-3 font-medium text-muted">300-page book</th>
              </tr>
            </thead>
            <tbody>
              {[
                { step: 'OCR (Lambda)', cost: '$0.0023', book: '$0.68' },
                { step: 'OCR (Batch API)', cost: '$0.0011', book: '$0.34' },
                { step: 'Translation', cost: '$0.0022', book: '$0.66' },
                { step: 'Summary + Index', cost: '—', book: '$0.04' },
                { step: 'Chapter Extraction', cost: '—', book: '$0.01' },
                { step: 'Image Extraction', cost: '$0.0016', book: '~$0.05' },
                { step: 'Metadata + FT Check', cost: '—', book: '$0.008' },
              ].map((row) => (
                <tr key={row.step} className="border-b border-stone-100 last:border-0">
                  <td className="px-4 py-2.5 text-secondary">{row.step}</td>
                  <td className="px-4 py-2.5 text-muted tabular-nums">{row.cost}</td>
                  <td className="px-4 py-2.5 text-secondary tabular-nums font-medium">{row.book}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* ── Links ── */}
        <div className="border-t border-border-light pt-8">
          <div className="flex flex-wrap gap-4">
            <Link
              href="/about/processing"
              className="px-5 py-2.5 bg-stone-900 text-white rounded-full hover:bg-stone-800 transition-colors"
            >
              How Processing Works
            </Link>
            <Link
              href="/developers"
              className="px-5 py-2.5 bg-white border border-stone-300 text-stone-700 rounded-full hover:bg-stone-50 transition-colors"
            >
              API & MCP Server
            </Link>
            <Link
              href="/analytics"
              className="px-5 py-2.5 bg-white border border-stone-300 text-stone-700 rounded-full hover:bg-stone-50 transition-colors"
            >
              Pipeline Analytics
            </Link>
            <a
              href="https://github.com/Embassy-of-the-Free-Mind/sourcelibrary-v2"
              target="_blank"
              rel="noopener noreferrer"
              className="px-5 py-2.5 bg-white border border-stone-300 text-stone-700 rounded-full hover:bg-stone-50 transition-colors"
            >
              GitHub Repository
            </a>
          </div>
        </div>
      </div>
    </ContentPageLayout>
  );
}

/* ── Subcomponents ── */

function StatCard({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <div className="bg-white rounded-xl border border-border-light p-4 text-center">
      <div className={`text-xl md:text-2xl font-semibold ${accent ? 'text-status-success' : 'text-primary'}`}>
        {value}
      </div>
      <div className="text-xs text-muted mt-1">{label}</div>
    </div>
  );
}

function MechCard({ title, description }: { title: string; description: string }) {
  return (
    <div className="bg-white rounded-xl border border-border-light p-5">
      <h3 className="font-semibold text-primary mb-2">{title}</h3>
      <p className="text-secondary text-[15px] leading-relaxed">{description}</p>
    </div>
  );
}

function BehaviorCard({ title, description }: { title: string; description: string }) {
  return (
    <div className="bg-white rounded-xl border border-border-light p-5">
      <h3 className="font-semibold text-primary mb-2">{title}</h3>
      <p className="text-secondary text-[15px] leading-relaxed">{description}</p>
    </div>
  );
}
