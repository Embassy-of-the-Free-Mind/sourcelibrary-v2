'use client';

import { useState, useEffect } from 'react';
import { BookOpen, FileText, Languages, Users, DollarSign, Coins, ListChecks, Database, HardDrive, Archive, AlertTriangle, Loader2 } from 'lucide-react';
import { analytics } from '@/lib/api-client';
import type { UsageStats } from '@/lib/api-client/types/analytics';
import { formatNumber, formatCost, formatTokens } from '../shared/formatters';
import { AreaChart } from '../charts/AreaChart';
import { dateLabel } from '../charts/chart-utils';

interface UsageTabProps {
  days: number;
}

export default function UsageTab({ days }: UsageTabProps) {
  const [data, setData] = useState<UsageStats | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    analytics.usage(days).then(setData).finally(() => setLoading(false));
  }, [days]);

  if (loading) return <div className="text-center py-12" style={{ color: 'var(--text-muted)' }}><Loader2 className="w-8 h-8 mx-auto animate-spin opacity-30" /></div>;
  if (!data) return null;

  return (
    <div className="space-y-8">
      {/* Summary Cards */}
      {data.summary && (
        <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
          <div className="p-4 rounded-xl" style={{ background: 'var(--bg-white)', border: '1px solid var(--border-light)' }}>
            <div className="flex items-center gap-2 mb-2">
              <BookOpen className="w-4 h-4" style={{ color: 'var(--accent-violet)' }} />
              <span className="text-xs font-medium uppercase" style={{ color: 'var(--text-muted)' }}>Books</span>
            </div>
            <div className="text-2xl font-semibold" style={{ color: 'var(--text-primary)' }}>
              {formatNumber(data.summary.totalBooks)}
            </div>
          </div>

          <div className="p-4 rounded-xl" style={{ background: 'var(--bg-white)', border: '1px solid var(--border-light)' }}>
            <div className="flex items-center gap-2 mb-2">
              <FileText className="w-4 h-4" style={{ color: 'var(--accent-sage)' }} />
              <span className="text-xs font-medium uppercase" style={{ color: 'var(--text-muted)' }}>Pages OCR'd</span>
            </div>
            <div className="text-2xl font-semibold" style={{ color: 'var(--text-primary)' }}>
              {formatNumber(data.summary.pagesWithOcr)}
              <span className="text-sm font-normal ml-1" style={{ color: 'var(--text-muted)' }}>
                / {formatNumber(data.summary.totalPages)}
              </span>
            </div>
            <div className="text-xs mt-1" style={{ color: 'var(--accent-sage)' }}>
              {data.summary.ocrPercentage}% complete
            </div>
          </div>

          <div className="p-4 rounded-xl" style={{ background: 'var(--bg-white)', border: '1px solid var(--border-light)' }}>
            <div className="flex items-center gap-2 mb-2">
              <Languages className="w-4 h-4" style={{ color: 'var(--accent-rust)' }} />
              <span className="text-xs font-medium uppercase" style={{ color: 'var(--text-muted)' }}>Translated</span>
            </div>
            <div className="text-2xl font-semibold" style={{ color: 'var(--text-primary)' }}>
              {formatNumber(data.summary.pagesWithTranslation)}
            </div>
            <div className="text-xs mt-1" style={{ color: 'var(--accent-rust)' }}>
              {data.summary.translationPercentage}% complete
            </div>
          </div>

          <a href="https://analytics.google.com" target="_blank" rel="noopener noreferrer" className="p-4 rounded-xl block hover:opacity-80 transition-opacity" style={{ background: 'var(--bg-white)', border: '1px solid var(--border-light)' }}>
            <div className="flex items-center gap-2 mb-2">
              <Users className="w-4 h-4" style={{ color: 'var(--text-muted)' }} />
              <span className="text-xs font-medium uppercase" style={{ color: 'var(--text-muted)' }}>Traffic</span>
            </div>
            <div className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>
              Google Analytics
            </div>
            <div className="text-xs mt-1" style={{ color: 'var(--accent-sage)' }}>
              View traffic data &rarr;
            </div>
          </a>

          <div className="p-4 rounded-xl" style={{ background: 'var(--bg-white)', border: '1px solid var(--border-light)' }}>
            <div className="flex items-center gap-2 mb-2">
              <DollarSign className="w-4 h-4" style={{ color: '#22c55e' }} />
              <span className="text-xs font-medium uppercase" style={{ color: 'var(--text-muted)' }}>API Cost</span>
            </div>
            <div className="text-2xl font-semibold" style={{ color: 'var(--text-primary)' }}>
              {data.costStats ? formatCost(data.costStats.totalCost) : '$0.00'}
            </div>
            <div className="text-xs mt-1" style={{ color: '#22c55e' }}>
              {data.costStats ? formatTokens(data.costStats.totalTokens) : '0'} tokens
            </div>
          </div>
        </div>
      )}

      {/* Pipeline Funnel + Backlog */}
      {(data.pipelineFunnel || data.backlog) && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {data.pipelineFunnel && data.pipelineFunnel.length > 0 && (
            <PipelineFunnel funnel={data.pipelineFunnel} />
          )}
          {data.backlog && <BacklogCard backlog={data.backlog} />}
        </div>
      )}

      {/* Collection Processing Pipeline */}
      {data.collectionStats && (
        <CollectionPipeline summary={data.summary} collectionStats={data.collectionStats} />
      )}

      {/* Pipeline Health */}
      {data.pipelineHealth && (
        <PipelineHealthSection health={data.pipelineHealth} days={days} />
      )}

      {/* Cost to Complete */}
      {data.summary && data.costStats && data.costStats.costByAction.length > 0 && (
        <CostToComplete summary={data.summary} costStats={data.costStats} />
      )}

      {/* Collection Breakdown */}
      {data.collectionStats && (
        <CollectionBreakdown collectionStats={data.collectionStats} />
      )}

      {/* Model & Prompt Usage */}
      <ModelPromptUsage modelUsage={data.modelUsage} promptUsage={data.promptUsage} />

      {/* Cost Breakdown + Daily Cost Chart */}
      {data.costStats && data.costStats.costByAction.length > 0 && (
        <CostBreakdown costStats={data.costStats} />
      )}

      {/* Recent Books */}
      {data.recentBooks && data.recentBooks.length > 0 && (
        <div className="p-6 rounded-xl" style={{ background: 'var(--bg-white)', border: '1px solid var(--border-light)' }}>
          <h2 className="text-lg font-medium mb-4" style={{ color: 'var(--text-primary)' }}>
            Recently Added Books
          </h2>
          <div className="space-y-3">
            {data.recentBooks.map((book, i) => (
              <div key={i} className="flex items-center justify-between py-2" style={{ borderBottom: i < data.recentBooks.length - 1 ? '1px solid var(--border-light)' : 'none' }}>
                <div>
                  <div className="font-medium" style={{ color: 'var(--text-primary)' }}>{book.title}</div>
                  <div className="text-sm" style={{ color: 'var(--text-muted)' }}>{book.author}</div>
                </div>
                <div className="text-right">
                  <div className="text-sm" style={{ color: 'var(--text-muted)' }}>{book.pages_count || 0} pages</div>
                  <div className="text-xs" style={{ color: 'var(--text-faint)' }}>
                    {new Date(book.created_at).toLocaleDateString()}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}


/* --- Sub-components extracted from the monolith for readability --- */

function PipelineFunnel({ funnel }: { funnel: Array<{ status: string; count: number }> }) {
  const stageOrder = [
    'complete', 'images_complete', 'images_submitted',
    'chapters_complete', 'chapters', 'enriched', 'enriching',
    'translate_complete', 'translate_submitted',
    'metadata_enriched', 'ocr_complete', 'ocr_submitted',
    'archive_complete', 'archiving', 'queued', 'failed',
  ];
  const stageLabels: Record<string, string> = {
    complete: 'Complete', images_complete: 'Images done', images_submitted: 'Extracting images',
    chapters_complete: 'Chapters done', chapters: 'Extracting chapters',
    enriched: 'Enriched', enriching: 'Enriching',
    translate_complete: 'Translated', translate_submitted: 'Translating...',
    metadata_enriched: 'Metadata enriched', ocr_complete: 'OCR complete', ocr_submitted: 'OCR in progress...',
    archive_complete: 'Archived', archiving: 'Archiving...', queued: 'Queued', failed: 'Failed',
    not_enrolled: 'Not enrolled',
  };
  const stageColors: Record<string, string> = {
    complete: '#22c55e', failed: 'var(--accent-rust)', not_enrolled: 'var(--text-muted)',
  };
  const activeStages = ['ocr_submitted', 'translate_submitted', 'archiving', 'enriching', 'chapters', 'images_submitted'];
  const sorted = [...funnel].sort((a, b) => {
    const ai = stageOrder.indexOf(a.status);
    const bi = stageOrder.indexOf(b.status);
    return (ai === -1 ? 99 : ai) - (bi === -1 ? 99 : bi);
  });
  const maxCount = Math.max(...sorted.map(s => s.count));

  return (
    <div className="p-6 rounded-xl" style={{ background: 'var(--bg-white)', border: '1px solid var(--border-light)' }}>
      <h2 className="text-lg font-medium mb-4 flex items-center gap-2" style={{ color: 'var(--text-primary)' }}>
        <ListChecks className="w-5 h-5" style={{ color: 'var(--accent-violet)' }} />
        Pipeline Funnel
      </h2>
      <div className="space-y-2">
        {sorted.map(stage => (
          <div key={stage.status} className="flex items-center gap-3">
            <div className="w-[140px] text-xs text-right truncate" style={{
              color: stage.status === 'failed' ? 'var(--accent-rust)' : 'var(--text-muted)',
              fontWeight: stage.status === 'complete' || stage.status === 'failed' ? 600 : 400,
            }}>
              {stageLabels[stage.status] || stage.status}
              {activeStages.includes(stage.status) && (
                <Loader2 className="w-3 h-3 inline ml-1 animate-spin" />
              )}
            </div>
            <div className="flex-1 h-5 rounded overflow-hidden" style={{ background: 'var(--bg-warm)' }}>
              <div
                className="h-full rounded flex items-center justify-end pr-2 text-xs font-medium text-white"
                style={{
                  width: `${Math.max(8, (stage.count / maxCount) * 100)}%`,
                  background: stageColors[stage.status] || 'var(--accent-violet)',
                  minWidth: '32px',
                }}
              >
                {stage.count}
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function BacklogCard({ backlog }: { backlog: NonNullable<UsageStats['backlog']> }) {
  return (
    <div className="p-6 rounded-xl" style={{ background: 'var(--bg-white)', border: '1px solid var(--border-light)' }}>
      <h2 className="text-lg font-medium mb-4 flex items-center gap-2" style={{ color: 'var(--text-primary)' }}>
        <AlertTriangle className="w-5 h-5" style={{ color: 'var(--accent-gold)' }} />
        Processing Backlog
      </h2>
      <div className="space-y-4">
        <div className="p-4 rounded-lg" style={{ background: 'var(--accent-sage)', color: 'white' }}>
          <div className="flex items-center justify-between mb-1">
            <span className="text-sm font-medium">Needs OCR</span>
            <span className="text-xl font-bold">{formatNumber(backlog.needsOcr)}</span>
          </div>
          <div className="text-xs opacity-80">Pages without OCR yet. Largest segment of remaining work.</div>
        </div>
        <div className="p-4 rounded-lg" style={{ background: 'var(--accent-rust)', color: 'white' }}>
          <div className="flex items-center justify-between mb-1">
            <span className="text-sm font-medium">Needs translation</span>
            <span className="text-xl font-bold">{formatNumber(backlog.needsTranslation)}</span>
          </div>
          <div className="text-xs opacity-80">Pages with OCR but no translation. Highest ROI.</div>
        </div>
        <div className="p-4 rounded-lg" style={{ background: 'var(--bg-warm)', border: '1px solid var(--border-light)' }}>
          <div className="flex items-center justify-between mb-1">
            <span className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>Old OCR (not in pipeline)</span>
            <span className="text-xl font-bold" style={{ color: 'var(--text-primary)' }}>{formatNumber(backlog.oldOcrPages)}</span>
          </div>
          <div className="text-xs" style={{ color: 'var(--text-muted)' }}>OCR'd pages in books not enrolled in auto pipeline.</div>
        </div>
        <div className="pt-3 border-t" style={{ borderColor: 'var(--border-light)' }}>
          <div className="text-xs space-y-1" style={{ color: 'var(--text-muted)' }}>
            <div className="flex justify-between">
              <span>OCR remaining (~$0.0011/pg batch)</span>
              <span className="font-medium" style={{ color: 'var(--text-primary)' }}>~${(backlog.needsOcr * 0.0011).toFixed(0)}</span>
            </div>
            <div className="flex justify-between">
              <span>Translate remaining (~$0.0011/pg batch)</span>
              <span className="font-medium" style={{ color: 'var(--text-primary)' }}>~${(backlog.needsTranslation * 0.0011).toFixed(0)}</span>
            </div>
            <div className="flex justify-between font-medium pt-1 border-t" style={{ borderColor: 'var(--border-light)', color: 'var(--text-primary)' }}>
              <span>Total to complete</span>
              <span>~${((backlog.needsOcr + backlog.needsTranslation) * 0.0011).toFixed(0)}</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function CollectionPipeline({ summary, collectionStats }: { summary: UsageStats['summary']; collectionStats: NonNullable<UsageStats['collectionStats']> }) {
  return (
    <div className="p-6 rounded-xl" style={{ background: 'var(--bg-white)', border: '1px solid var(--border-light)' }}>
      <h2 className="text-lg font-medium mb-4 flex items-center gap-2" style={{ color: 'var(--text-primary)' }}>
        <Database className="w-5 h-5" style={{ color: 'var(--accent-violet)' }} />
        Collection Processing Pipeline
      </h2>
      <div className="space-y-4">
        {/* Total Pages Bar */}
        <div>
          <div className="flex justify-between text-sm mb-2">
            <span style={{ color: 'var(--text-primary)' }}>Total Pages</span>
            <span style={{ color: 'var(--text-muted)' }}>{formatNumber(summary.totalPages)}</span>
          </div>
          <div className="h-8 rounded-lg overflow-hidden flex" style={{ background: 'var(--bg-warm)' }}>
            <div
              className="h-full flex items-center justify-center text-xs font-medium text-white"
              style={{
                width: `${(collectionStats.blobStorage.totalBlobPages / summary.totalPages) * 100}%`,
                background: '#22c55e',
                minWidth: collectionStats.blobStorage.totalBlobPages > 0 ? '60px' : '0',
              }}
              title={`${formatNumber(collectionStats.blobStorage.totalBlobPages)} pages archived to Vercel Blob`}
            >
              {((collectionStats.blobStorage.totalBlobPages / summary.totalPages) * 100).toFixed(0)}% Blob
            </div>
            <div className="h-full flex items-center justify-center text-xs" style={{ flex: 1, color: 'var(--text-muted)' }}>
              {formatNumber(summary.totalPages - collectionStats.blobStorage.totalBlobPages)} from external sources
            </div>
          </div>
        </div>
        {/* OCR Progress */}
        <div>
          <div className="flex justify-between text-sm mb-2">
            <span style={{ color: 'var(--text-primary)' }}>OCR Progress</span>
            <span style={{ color: 'var(--text-muted)' }}>{formatNumber(summary.pagesWithOcr)} / {formatNumber(summary.totalPages)}</span>
          </div>
          <div className="h-6 rounded-lg overflow-hidden flex" style={{ background: 'var(--bg-warm)' }}>
            <div className="h-full flex items-center justify-center text-xs font-medium text-white" style={{ width: `${summary.ocrPercentage}%`, background: 'var(--accent-sage)', minWidth: summary.ocrPercentage > 0 ? '40px' : '0' }}>
              {summary.ocrPercentage}%
            </div>
          </div>
        </div>
        {/* Translation Progress */}
        <div>
          <div className="flex justify-between text-sm mb-2">
            <span style={{ color: 'var(--text-primary)' }}>Translation Progress</span>
            <span style={{ color: 'var(--text-muted)' }}>{formatNumber(summary.pagesWithTranslation)} / {formatNumber(summary.totalPages)}</span>
          </div>
          <div className="h-6 rounded-lg overflow-hidden flex" style={{ background: 'var(--bg-warm)' }}>
            <div className="h-full flex items-center justify-center text-xs font-medium text-white" style={{ width: `${summary.translationPercentage}%`, background: 'var(--accent-rust)', minWidth: summary.translationPercentage > 0 ? '40px' : '0' }}>
              {summary.translationPercentage}%
            </div>
          </div>
        </div>
      </div>
      {/* Storage Breakdown Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mt-6">
        {[
          { icon: Archive, color: '#22c55e', label: 'Archived', value: collectionStats.blobStorage.pagesWithArchivedPhoto, sub: 'full pages' },
          { icon: HardDrive, color: 'var(--accent-violet)', label: 'Cropped', value: collectionStats.blobStorage.pagesWithCroppedPhoto, sub: 'split pages' },
          { icon: BookOpen, color: 'var(--accent-sage)', label: 'Split Books', value: collectionStats.blobStorage.booksWithSplitPages, sub: 'books processed' },
          { icon: Database, color: 'var(--accent-rust)', label: 'Total Blob', value: collectionStats.blobStorage.totalBlobPages, sub: `${((collectionStats.blobStorage.totalBlobPages / summary.totalPages) * 100).toFixed(1)}% of collection` },
        ].map((item) => (
          <div key={item.label} className="p-3 rounded-lg" style={{ background: 'var(--bg-warm)' }}>
            <div className="flex items-center gap-2 mb-1">
              <item.icon className="w-4 h-4" style={{ color: item.color }} />
              <span className="text-xs font-medium" style={{ color: 'var(--text-muted)' }}>{item.label}</span>
            </div>
            <div className="text-lg font-semibold" style={{ color: 'var(--text-primary)' }}>{formatNumber(item.value)}</div>
            <div className="text-xs" style={{ color: 'var(--text-muted)' }}>{item.sub}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

function PipelineHealthSection({ health, days }: { health: NonNullable<UsageStats['pipelineHealth']>; days: number }) {
  return (
    <div className="p-6 rounded-xl" style={{ background: 'var(--bg-white)', border: '1px solid var(--border-light)' }}>
      <h2 className="text-lg font-medium mb-4 flex items-center gap-2" style={{ color: 'var(--text-primary)' }}>
        <ListChecks className="w-5 h-5" style={{ color: 'var(--accent-violet)' }} />
        Pipeline Health
      </h2>
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        {/* Split Detection */}
        <HealthColumn title="Split Detection" items={[
          { label: 'Needs Splitting', value: health.splitting.needsSplitting, color: '#f59e0b' },
          { label: 'Already Split', value: health.splitting.alreadySplit, color: '#22c55e' },
          { label: 'No Split Needed', value: health.splitting.noSplitNeeded, color: 'var(--accent-sage)' },
          { label: 'Unchecked', value: health.splitting.unchecked, color: 'var(--text-muted)' },
        ]} />
        {/* Enrichment */}
        <HealthColumn title="Content Enrichment" items={[
          { label: 'Fully Translated', value: health.enrichment.fullyTranslated, color: '#22c55e' },
          { label: 'With Summary', value: health.enrichment.booksWithSummary, color: 'var(--accent-sage)' },
          { label: 'With Index', value: health.enrichment.booksWithIndex, color: 'var(--accent-violet)' },
          { label: 'With Chapters', value: health.enrichment.booksWithChapters, color: 'var(--accent-rust)' },
          { label: 'With Editions', value: health.enrichment.booksWithEditions, color: '#3b82f6' },
        ]} />
        {/* Images */}
        <HealthColumn title="Image Detection" items={[
          { label: 'Pages with Images', value: health.images.pagesWithDetectedImages, color: 'var(--accent-violet)' },
          { label: 'Total Images Found', value: health.images.totalDetectedImages, color: 'var(--accent-rust)' },
        ]} />
        {/* Batch Jobs */}
        <div className="space-y-3">
          <h3 className="text-sm font-medium" style={{ color: 'var(--text-muted)' }}>Active Batch Jobs</h3>
          <div className="space-y-2">
            <div className="flex justify-between items-center text-sm">
              <span style={{ color: 'var(--text-primary)' }}>Pending</span>
              <span className="font-medium px-2 py-0.5 rounded" style={{ background: 'var(--bg-warm)', color: '#f59e0b' }}>{formatNumber(health.batchJobs.pending)}</span>
            </div>
            <div className="flex justify-between items-center text-sm">
              <span style={{ color: 'var(--text-primary)' }}>Processing</span>
              <span className="font-medium px-2 py-0.5 rounded" style={{ background: 'var(--bg-warm)', color: 'var(--accent-sage)' }}>{formatNumber(health.batchJobs.processing)}</span>
            </div>
            {health.batchJobs.byType.length > 0 && (
              <div className="pt-2 border-t" style={{ borderColor: 'var(--border-light)' }}>
                {health.batchJobs.byType.map((job, i) => (
                  <div key={i} className="flex justify-between items-center text-xs mt-1">
                    <span className="capitalize" style={{ color: 'var(--text-muted)' }}>{job.type}</span>
                    <span style={{ color: 'var(--text-primary)' }}>{job.count}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
      {/* Worker Health */}
      {health.workerHealth && (health.workerHealth.ocrBlocked > 0 || health.workerHealth.needsAttention > 0 || health.workerHealth.highFailureBooks.length > 0) && (
        <div className="mt-6 pt-6 border-t" style={{ borderColor: 'var(--border-light)' }}>
          <h3 className="text-sm font-medium mb-3 flex items-center gap-2" style={{ color: 'var(--accent-rust)' }}>
            <AlertTriangle className="w-4 h-4" />
            Worker Health
          </h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-2">
              {[
                { label: 'Books OCR-blocked', value: health.workerHealth.ocrBlocked, color: '#f59e0b' },
                { label: 'Needs attention', value: health.workerHealth.needsAttention, color: 'var(--accent-rust)' },
              ].filter(item => item.value > 0).map((item, i) => (
                <div key={i} className="flex justify-between items-center text-sm">
                  <span style={{ color: 'var(--text-primary)' }}>{item.label}</span>
                  <span className="font-medium px-2 py-0.5 rounded" style={{ background: 'var(--bg-warm)', color: item.color }}>{formatNumber(item.value)}</span>
                </div>
              ))}
              {health.workerHealth.failuresByCategory.length > 0 && (
                <div className="pt-2 mt-2 border-t" style={{ borderColor: 'var(--border-light)' }}>
                  <div className="text-xs font-medium mb-1" style={{ color: 'var(--text-muted)' }}>Failure categories ({days}d)</div>
                  {health.workerHealth.failuresByCategory.slice(0, 5).map((f, i) => (
                    <div key={i} className="flex justify-between items-center text-xs mt-1">
                      <span style={{ color: 'var(--text-muted)' }}>{f.category}</span>
                      <span style={{ color: 'var(--text-primary)' }}>{formatNumber(f.count)}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
            {health.workerHealth.highFailureBooks.length > 0 && (
              <div className="space-y-1">
                <div className="text-xs font-medium mb-1" style={{ color: 'var(--text-muted)' }}>Repeat failures (&gt;90% page failure rate)</div>
                {health.workerHealth.highFailureBooks.slice(0, 8).map((book, i) => (
                  <div key={i} className="flex justify-between items-center text-xs gap-2">
                    <a href={`https://sourcelibrary.org/book/${book.bookId}`} target="_blank" rel="noopener" className="truncate hover:underline" style={{ color: 'var(--accent-rust)' }}>{book.title}</a>
                    <span className="shrink-0" style={{ color: 'var(--text-muted)' }}>{book.jobCount}x / {formatNumber(book.totalPagesFailed)} pages</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function HealthColumn({ title, items }: { title: string; items: Array<{ label: string; value: number; color: string }> }) {
  return (
    <div className="space-y-3">
      <h3 className="text-sm font-medium" style={{ color: 'var(--text-muted)' }}>{title}</h3>
      <div className="space-y-2">
        {items.map((item, i) => (
          <div key={i} className="flex justify-between items-center text-sm">
            <span style={{ color: 'var(--text-primary)' }}>{item.label}</span>
            <span className="font-medium px-2 py-0.5 rounded" style={{ background: 'var(--bg-warm)', color: item.color }}>{formatNumber(item.value)}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function CostToComplete({ summary, costStats }: { summary: UsageStats['summary']; costStats: NonNullable<UsageStats['costStats']> }) {
  const ocrAction = costStats.costByAction.find(a => a.action === 'ocr');
  const translationAction = costStats.costByAction.find(a => a.action === 'translation');
  const ocrCostPerPage = ocrAction && ocrAction.count > 0 ? ocrAction.cost / ocrAction.count : 0.00158;
  const translationCostPerPage = translationAction && translationAction.count > 0 ? translationAction.cost / translationAction.count : 0.00241;
  const pagesNeedingOcr = summary.totalPages - summary.pagesWithOcr;
  const pagesNeedingTranslation = summary.totalPages - summary.pagesWithTranslation;
  const ocrCostBatch = pagesNeedingOcr * ocrCostPerPage * 0.5;
  const translationCostBatch = pagesNeedingTranslation * translationCostPerPage * 0.5;
  const totalBatch = ocrCostBatch + translationCostBatch;
  const totalRealtime = (pagesNeedingOcr * ocrCostPerPage) + (pagesNeedingTranslation * translationCostPerPage);
  const totalDays = Math.ceil((pagesNeedingOcr / 1000 + pagesNeedingTranslation / 1000) / 24);

  return (
    <div className="p-6 rounded-xl" style={{ background: 'var(--bg-white)', border: '1px solid var(--border-light)' }}>
      <h2 className="text-lg font-medium mb-4 flex items-center gap-2" style={{ color: 'var(--text-primary)' }}>
        <Coins className="w-5 h-5" style={{ color: '#22c55e' }} />
        Cost to Complete
      </h2>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <div className="space-y-3">
          <h3 className="text-sm font-medium" style={{ color: 'var(--text-muted)' }}>Remaining Work</h3>
          <div className="space-y-2">
            <div className="flex justify-between items-center text-sm">
              <span style={{ color: 'var(--text-primary)' }}>Pages need OCR</span>
              <span className="font-medium" style={{ color: 'var(--accent-sage)' }}>{formatNumber(pagesNeedingOcr)}</span>
            </div>
            <div className="flex justify-between items-center text-sm">
              <span style={{ color: 'var(--text-primary)' }}>Pages need translation</span>
              <span className="font-medium" style={{ color: 'var(--accent-rust)' }}>{formatNumber(pagesNeedingTranslation)}</span>
            </div>
          </div>
        </div>
        <div className="space-y-3">
          <h3 className="text-sm font-medium flex items-center gap-2" style={{ color: 'var(--text-muted)' }}>
            Batch API <span className="text-xs px-1.5 py-0.5 rounded" style={{ background: '#dcfce7', color: '#16a34a' }}>50% off</span>
          </h3>
          <div className="space-y-2">
            <div className="flex justify-between items-center text-sm"><span style={{ color: 'var(--text-primary)' }}>OCR</span><span className="font-medium" style={{ color: 'var(--text-primary)' }}>{formatCost(ocrCostBatch)}</span></div>
            <div className="flex justify-between items-center text-sm"><span style={{ color: 'var(--text-primary)' }}>Translation</span><span className="font-medium" style={{ color: 'var(--text-primary)' }}>{formatCost(translationCostBatch)}</span></div>
            <div className="flex justify-between items-center text-sm pt-2 border-t" style={{ borderColor: 'var(--border-light)' }}>
              <span className="font-medium" style={{ color: 'var(--text-primary)' }}>Total</span>
              <span className="font-bold text-lg" style={{ color: '#22c55e' }}>{formatCost(totalBatch)}</span>
            </div>
          </div>
        </div>
        <div className="space-y-3">
          <h3 className="text-sm font-medium" style={{ color: 'var(--text-muted)' }}>Estimates</h3>
          <div className="space-y-2">
            <div className="flex justify-between items-center text-sm"><span style={{ color: 'var(--text-primary)' }}>Time (sequential)</span><span className="font-medium" style={{ color: 'var(--accent-violet)' }}>~{totalDays} days</span></div>
            <div className="flex justify-between items-center text-sm"><span style={{ color: 'var(--text-primary)' }}>Realtime API cost</span><span className="font-medium" style={{ color: 'var(--text-muted)' }}>{formatCost(totalRealtime)}</span></div>
            <div className="text-xs pt-2" style={{ color: 'var(--text-faint)' }}>Based on ${ocrCostPerPage.toFixed(4)}/pg OCR, ${translationCostPerPage.toFixed(4)}/pg translate</div>
          </div>
        </div>
      </div>
    </div>
  );
}

function CollectionBreakdown({ collectionStats }: { collectionStats: NonNullable<UsageStats['collectionStats']> }) {
  const colors = ['var(--accent-rust)', 'var(--accent-sage)', 'var(--accent-violet)', '#f59e0b', '#22c55e'];
  const providerLabels: Record<string, string> = { internet_archive: 'Internet Archive', gallica: 'Gallica (BnF)', mdz: 'MDZ (Bavarian)', efm: 'EFM Manuscripts', iiif: 'IIIF Generic', vercel_blob: 'Vercel Blob' };
  const providerColors: Record<string, string> = { internet_archive: '#f59e0b', gallica: '#3b82f6', mdz: '#22c55e', efm: 'var(--accent-violet)', iiif: 'var(--accent-rust)', vercel_blob: '#22c55e' };

  return (
    <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
      <BreakdownCard title="By Language" icon={Languages} iconColor="var(--accent-rust)" items={collectionStats.byLanguage.map((l, i) => ({ label: l.language, count: l.count, color: colors[i % colors.length] }))} />
      <BreakdownCard title="By Category" icon={BookOpen} iconColor="var(--accent-sage)" items={collectionStats.byCategory.map((c, i) => ({ label: c.category, count: c.count, color: ['var(--accent-sage)', 'var(--accent-violet)', 'var(--accent-rust)', '#22c55e', '#f59e0b'][i % 5] }))} />
      <BreakdownCard title="Image Sources" icon={HardDrive} iconColor="var(--accent-violet)" items={collectionStats.byImageSource.map(s => ({ label: providerLabels[s.provider] || s.provider, count: s.count, color: providerColors[s.provider] || 'var(--accent-sage)' }))} showPercent />
    </div>
  );
}

function BreakdownCard({ title, icon: Icon, iconColor, items, showPercent }: { title: string; icon: any; iconColor: string; items: Array<{ label: string; count: number; color: string }>; showPercent?: boolean }) {
  const total = items.reduce((a, b) => a + b.count, 0);
  return (
    <div className="p-6 rounded-xl" style={{ background: 'var(--bg-white)', border: '1px solid var(--border-light)' }}>
      <h2 className="text-lg font-medium mb-4 flex items-center gap-2" style={{ color: 'var(--text-primary)' }}>
        <Icon className="w-5 h-5" style={{ color: iconColor }} />
        {title}
      </h2>
      <div className="space-y-2 max-h-64 overflow-y-auto">
        {items.map((item, i) => {
          const pct = total > 0 ? (item.count / total) * 100 : 0;
          return (
            <div key={i}>
              <div className="flex justify-between text-sm mb-1">
                <span className="truncate" style={{ color: 'var(--text-primary)' }} title={item.label}>{item.label}</span>
                <span style={{ color: 'var(--text-muted)' }}>{item.count}{showPercent ? ` (${pct.toFixed(0)}%)` : ''}</span>
              </div>
              <div className={`${showPercent ? 'h-3' : 'h-2'} rounded-full overflow-hidden`} style={{ background: 'var(--bg-warm)' }}>
                <div className="h-full rounded-full" style={{ width: `${pct}%`, background: item.color }} />
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function ModelPromptUsage({ modelUsage, promptUsage }: { modelUsage: UsageStats['modelUsage']; promptUsage: UsageStats['promptUsage'] }) {
  if ((!modelUsage || modelUsage.length === 0) && (!promptUsage || promptUsage.length === 0)) return null;
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
      {modelUsage && modelUsage.length > 0 && (
        <div className="p-6 rounded-xl" style={{ background: 'var(--bg-white)', border: '1px solid var(--border-light)' }}>
          <h2 className="text-lg font-medium mb-4" style={{ color: 'var(--text-primary)' }}>Model Usage</h2>
          <div className="space-y-3">
            {modelUsage.map((m, i) => {
              const total = modelUsage.reduce((a, b) => a + b.count, 0);
              const pct = total > 0 ? (m.count / total) * 100 : 0;
              const isUntracked = m.model === '__untracked__';
              return (
                <div key={i}>
                  <div className="flex justify-between text-sm mb-1">
                    <span style={{ color: isUntracked ? 'var(--text-muted)' : 'var(--text-primary)', fontStyle: isUntracked ? 'italic' : 'normal' }}>
                      {isUntracked ? 'Untracked (historical)' : (m.model || 'Unknown')}
                    </span>
                    <span style={{ color: 'var(--text-muted)' }}>{formatNumber(m.count)}</span>
                  </div>
                  <div className="h-2 rounded-full overflow-hidden" style={{ background: 'var(--bg-warm)' }}>
                    <div className="h-full rounded-full" style={{ width: `${pct}%`, background: isUntracked ? 'var(--text-faint)' : 'var(--accent-sage)' }} />
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
      {promptUsage && promptUsage.length > 0 && (
        <div className="p-6 rounded-xl" style={{ background: 'var(--bg-white)', border: '1px solid var(--border-light)' }}>
          <h2 className="text-lg font-medium mb-4" style={{ color: 'var(--text-primary)' }}>Prompt Usage</h2>
          <div className="space-y-3">
            {promptUsage.slice(0, 5).map((p, i) => {
              const total = promptUsage.reduce((a, b) => a + b.count, 0);
              const pct = total > 0 ? (p.count / total) * 100 : 0;
              return (
                <div key={i}>
                  <div className="flex justify-between text-sm mb-1">
                    <span className="truncate" style={{ color: 'var(--text-primary)' }}>{p.prompt}</span>
                    <span style={{ color: 'var(--text-muted)' }}>{formatNumber(p.count)}</span>
                  </div>
                  <div className="h-2 rounded-full overflow-hidden" style={{ background: 'var(--bg-warm)' }}>
                    <div className="h-full rounded-full" style={{ width: `${pct}%`, background: 'var(--accent-rust)' }} />
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

function CostBreakdown({ costStats }: { costStats: NonNullable<UsageStats['costStats']> }) {
  const chartData = costStats.costByDay.map(d => ({
    x: new Date(d.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
    y: d.cost,
  }));

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
      <div className="p-6 rounded-xl" style={{ background: 'var(--bg-white)', border: '1px solid var(--border-light)' }}>
        <h2 className="text-lg font-medium mb-4 flex items-center gap-2" style={{ color: 'var(--text-primary)' }}>
          <DollarSign className="w-5 h-5" style={{ color: '#22c55e' }} />
          Cost by Action
        </h2>
        <div className="space-y-3">
          {costStats.costByAction.map((a, i) => {
            const totalCost = costStats.costByAction.reduce((acc, b) => acc + b.cost, 0);
            const pct = totalCost > 0 ? (a.cost / totalCost) * 100 : 0;
            return (
              <div key={i}>
                <div className="flex justify-between text-sm mb-1">
                  <span className="capitalize" style={{ color: 'var(--text-primary)' }}>{a.action}</span>
                  <span style={{ color: 'var(--text-muted)' }}>{formatCost(a.cost)} ({a.count} calls)</span>
                </div>
                <div className="h-2 rounded-full overflow-hidden" style={{ background: 'var(--bg-warm)' }}>
                  <div className="h-full rounded-full" style={{ width: `${pct}%`, background: '#22c55e' }} />
                </div>
              </div>
            );
          })}
        </div>
      </div>
      {costStats.costByDay.length > 0 && (
        <div className="p-6 rounded-xl" style={{ background: 'var(--bg-white)', border: '1px solid var(--border-light)' }}>
          <h2 className="text-lg font-medium mb-4 flex items-center gap-2" style={{ color: 'var(--text-primary)' }}>
            <Coins className="w-5 h-5" style={{ color: '#22c55e' }} />
            Daily Cost
          </h2>
          <AreaChart
            data={chartData}
            color="#22c55e"
            yLabel={(v) => formatCost(v)}
            height={192}
          />
        </div>
      )}
    </div>
  );
}
