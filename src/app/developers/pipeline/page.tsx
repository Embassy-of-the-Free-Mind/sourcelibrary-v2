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

// ISR: rebuild every 6 hours. Allow 60s for first-hit generation.
export const revalidate = 21600;
export const maxDuration = 60;

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

    const maxTimeMS = 45000;
    const [funnel, pageAgg, totalBooks] = await Promise.all([
      books
        .aggregate([
          { $match: { 'pipeline_auto.status': { $exists: true } } },
          { $group: { _id: '$pipeline_auto.status', count: { $sum: 1 } } },
          { $sort: { count: -1 } },
        ], { maxTimeMS })
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
        ], { maxTimeMS })
        .toArray(),
      books.countDocuments({ hidden: { $ne: true } }, { maxTimeMS }),
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
            description="Digitized books often have two-page spreads scanned as a single image. On import, the system samples pages and uses aspect ratio analysis (< 0.9 = single, > 1.3 = spread) to flag books that need splitting. Crop coordinates (0-1000 scale) are computed for each half. Heuristic, ML, and Gemini vision methods exist for per-page refinement."
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

        {/* ── Processing history ── */}
        <h2 className="text-2xl md:text-3xl text-primary mt-16 mb-6">Processing History</h2>
        <p className="text-secondary mb-4">
          The pipeline above describes the current architecture. Books processed earlier went through
          different models, prompts, and workflows. Most books are being gradually reprocessed
          to current standards as capacity allows.
        </p>
        <div className="bg-white rounded-xl border border-border-light overflow-hidden mb-16">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border-light bg-stone-50">
                <th className="text-left px-4 py-3 font-medium text-muted">Period</th>
                <th className="text-left px-4 py-3 font-medium text-muted">What changed</th>
                <th className="text-left px-4 py-3 font-medium text-muted">Impact</th>
              </tr>
            </thead>
            <tbody>
              {[
                {
                  period: 'Dec 2025',
                  change: 'Initial pipeline: manual imports, basic OCR with gemini-2.0-flash, no automated orchestration',
                  impact: 'First ~500 books processed manually',
                },
                {
                  period: 'Jan 2026',
                  change: 'Split detection for two-page spreads: cascade of heuristic pixel analysis → ML model → Gemini vision. Computes crop coordinates (0-1000 scale) for each half',
                  impact: 'Digitized books with facing pages render correctly',
                },
                {
                  period: 'Jan 2026',
                  change: 'Image archiving moved to dedicated Hetzner server. Pages archived from external sources (IA, Gallica, MDZ) to Vercel Blob with thumbnail generation',
                  impact: 'Long-term image availability, faster page loads',
                },
                {
                  period: 'Jan 2026',
                  change: 'Auto pipeline cron introduced: books flow through stages automatically every 10 minutes instead of manual triggering',
                  impact: 'Fully automated processing for new imports',
                },
                {
                  period: 'Jan – Feb 2026',
                  change: 'Upgraded OCR from gemini-2.0/2.5-flash to gemini-3-flash-preview. Prompt evolved through v1-v6, adding page-type classification, multi-column detection, image bounding boxes',
                  impact: '~250k+ pages on current quality, ~75k older pages being reprocessed',
                },
                {
                  period: 'Feb 2026',
                  change: 'English modernization: pre-1700 English books get Early Modern → Modern English instead of translation. Output stored in same field, so all downstream processing works identically',
                  impact: '~200 English books modernized automatically',
                },
                {
                  period: 'Feb 2026',
                  change: 'Multi-column rendering: OCR detects column layouts (<columns>N</columns> + <column-break/> markers), reader renders as CSS grid',
                  impact: 'Two-column Renaissance books display correctly',
                },
                {
                  period: 'Feb 2026',
                  change: 'Write Queue architecture: AI workers (600+ concurrent) no longer write directly to MongoDB. Results flow through SQS → Writer Lambda (50 max concurrency)',
                  impact: 'Eliminated connection storms during large batches',
                },
                {
                  period: 'Feb 2026',
                  change: 'Translation switched to Lambda FIFO queue only (Batch API retired for translation). Each page receives the previous page\'s translation as context for terminology consistency',
                  impact: 'Better translation quality, ~30k stale translations being redone',
                },
                {
                  period: 'Feb 2026',
                  change: 'Added Metadata Enrichment (language, categories, display title, source work dates) and First Translation Check stages to the pipeline',
                  impact: '~280 confirmed first English translations identified',
                },
                {
                  period: 'Feb 2026',
                  change: 'Chapter extraction and enrichment (summary + index) split into dedicated cron so they don\'t starve translation of time budget',
                  impact: 'More reliable enrichment, no pipeline stalls',
                },
                {
                  period: 'Mar 2026',
                  change: 'Image extraction filters by page type — only pages classified as illustration, diagram, map, frontispiece, or mixed are scanned',
                  impact: '~80-90% cost reduction for image extraction',
                },
              ].map((row) => (
                <tr key={row.period + row.change.slice(0, 20)} className="border-b border-stone-100 last:border-0">
                  <td className="px-4 py-2.5 text-secondary whitespace-nowrap align-top font-medium">{row.period}</td>
                  <td className="px-4 py-2.5 text-secondary">{row.change}</td>
                  <td className="px-4 py-2.5 text-muted">{row.impact}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* ── Beyond the pipeline ── */}
        <h2 className="text-2xl md:text-3xl text-primary mt-16 mb-6">Beyond the Pipeline</h2>
        <p className="text-secondary mb-4">
          Once books reach &ldquo;complete,&rdquo; several downstream systems build on the processed data.
        </p>
        <div className="grid md:grid-cols-2 gap-4 mb-16">
          <MechCard
            title="Scholarly Editions & DOI"
            description="Completed translations can be published as citable scholarly editions with DOIs via Zenodo. Each edition is an immutable snapshot with content hash, AI-generated introduction and methodology, contributor tracking (AI + human), and citations in APA and BibTeX formats. Versioning is supported — republishing creates a new version."
          />
          <MechCard
            title="Gallery"
            description="Extracted illustrations, emblems, diagrams, and engravings from all books form a browsable gallery with AI-generated museum-style descriptions, subject tags, bounding boxes, and quality scores. Gallery images feed the social media system for automated tweet generation."
          />
          <MechCard
            title="Encyclopedia"
            description="AI-generated book indexes (people, places, concepts) are aggregated into an encyclopedia with cross-references across the entire library. Entity pages show every book that mentions a person or concept, with page-level links."
          />
          <MechCard
            title="First Translation Identification"
            description="A two-stage verification system identifies books that are the first known English translation of a historical text. Stage 1 (AI metadata enrichment) classifies during processing. Stage 2 (LLM deep knowledge check) verifies against known translations, academic publishers, and dissertations."
          />
          <MechCard
            title="GitHub Sync"
            description="On completion, full book text (OCR + translations) is synced to a public GitHub repository as plain text files — a permanent, version-controlled archive independent of the web application and database."
          />
          <MechCard
            title="MCP Server & API"
            description="The full library is accessible via a Model Context Protocol server (for AI assistants) and a REST API. Seven tools let AI models search books, read translations, and find illustrations across 4,800+ historical texts."
          />
        </div>

        {/* ── Automation & human review ── */}
        <h2 className="text-2xl md:text-3xl text-primary mt-16 mb-2">Automation & Human Review</h2>
        <p className="text-secondary mb-6">
          The pipeline is a stigmergic system — each safety mechanism, backpressure limit, and
          error handler is a trace left by a past failure that shapes future processing. The
          environment itself encodes intelligence: books flow through paths carved by previous
          experience, with human judgment required only at the boundaries.
        </p>

        <div className="space-y-6 mb-16">
          {/* Fully automated */}
          <div>
            <h3 className="font-semibold text-primary mb-3 flex items-center gap-2">
              <span className="w-2.5 h-2.5 rounded-full bg-status-success shrink-0" />
              Fully Automated
            </h3>
            <div className="grid md:grid-cols-2 gap-3">
              {[
                { title: 'Pipeline orchestration', desc: 'Two crons advance books through all 10 stages every 10 minutes — no human trigger needed after import.' },
                { title: 'OCR, translation, image extraction', desc: 'Lambda workers process pages via SQS queues. Backpressure, retries, and failure recovery are all automatic.' },
                { title: 'Metadata enrichment', desc: 'AI classifies language, categories, description, display title, source work dates, and first-translation status.' },
                { title: 'Staleness & zombie detection', desc: 'Books stuck for 48h get rolled back. Jobs stuck for 24h are force-completed. No alert fatigue — the system self-heals.' },
                { title: 'Gallery, search index, encyclopedia', desc: 'Image extraction results flow into the gallery. Book indexes aggregate into encyclopedia entries. All automatic.' },
                { title: 'Page count sync & data integrity', desc: 'Crons refresh cached counts, sync gallery metadata, and archive images on a fixed schedule.' },
              ].map((item) => (
                <div key={item.title} className="bg-status-success/5 border border-status-success/15 rounded-lg p-4">
                  <div className="font-medium text-primary text-sm mb-1">{item.title}</div>
                  <div className="text-muted text-sm leading-relaxed">{item.desc}</div>
                </div>
              ))}
            </div>
          </div>

          {/* Human-initiated */}
          <div>
            <h3 className="font-semibold text-primary mb-3 flex items-center gap-2">
              <span className="w-2.5 h-2.5 rounded-full bg-status-info shrink-0" />
              Human-Initiated, Then Automated
            </h3>
            <div className="grid md:grid-cols-2 gap-3">
              {[
                { title: 'Book imports', desc: 'A human decides which book to import and from which source. Everything after — page creation, archiving, OCR, translation — is automatic.' },
                { title: 'Re-enrollment', desc: 'Failed or completed books can be re-enrolled in the pipeline. One API call, then the cron takes over.' },
                { title: 'Emergency stop / resume', desc: 'Selective phase pausing is a human decision. The system respects it at both submission and completion boundaries.' },
                { title: 'Edition publishing', desc: 'A human initiates publication and chooses the license. Front matter generation, content hashing, and DOI minting are automated.' },
              ].map((item) => (
                <div key={item.title} className="bg-status-info/5 border border-status-info/15 rounded-lg p-4">
                  <div className="font-medium text-primary text-sm mb-1">{item.title}</div>
                  <div className="text-muted text-sm leading-relaxed">{item.desc}</div>
                </div>
              ))}
            </div>
          </div>

          {/* Requires human judgment */}
          <div>
            <h3 className="font-semibold text-primary mb-3 flex items-center gap-2">
              <span className="w-2.5 h-2.5 rounded-full bg-status-warning shrink-0" />
              Requires Human Judgment
            </h3>
            <div className="grid md:grid-cols-2 gap-3">
              {[
                { title: 'Curation & acquisition', desc: 'Which books belong in the library? What sources to prioritize? These are scholarly decisions no AI makes.' },
                { title: 'QA audit', desc: 'Comparing OCR against page images, verifying metadata against title pages, checking translation quality — still requires expert eyes.' },
                { title: 'Failed book triage', desc: 'Books in "needs attention" state require a human to diagnose the problem: bad source images, corrupt metadata, import failures.' },
                { title: 'First translation review', desc: 'When the AI is uncertain whether a translation exists, the "needs review" disposition flags it for a human scholar to verify.' },
                { title: 'Page corrections', desc: 'Manual OCR and translation edits — fixing names, dates, or passages the AI got wrong. Revisions are preserved and protected from re-processing.' },
                { title: 'Pipeline tuning', desc: 'Backpressure limits, model selection, prompt updates, cost/quality tradeoffs — the meta-decisions that shape the environment the pipeline runs in.' },
              ].map((item) => (
                <div key={item.title} className="bg-status-warning/5 border border-status-warning/15 rounded-lg p-4">
                  <div className="font-medium text-primary text-sm mb-1">{item.title}</div>
                  <div className="text-muted text-sm leading-relaxed">{item.desc}</div>
                </div>
              ))}
            </div>
          </div>
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
