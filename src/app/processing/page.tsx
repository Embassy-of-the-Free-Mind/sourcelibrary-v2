'use client';

import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import { ChevronLeft, RefreshCw, Loader2, Search, ChevronUp, ChevronDown, ChevronsUpDown, Layers, DollarSign, BookOpen, FileText } from 'lucide-react';
import { analytics } from '@/lib/api-client';
import type { ProcessingRow, ProcessingOverviewResponse } from '@/lib/api-client/types/analytics';

const STEPS = [
  { value: '', label: 'All Steps' },
  { value: 'import', label: 'Import' },
  { value: 'split', label: 'Split Detection' },
  { value: 'archive', label: 'Archive' },
  { value: 'thumbnail', label: 'Thumbnails' },
  { value: 'ocr', label: 'OCR' },
  { value: 'translate', label: 'Translation' },
  { value: 'extract_images', label: 'Image Extraction' },
  { value: 'summarize', label: 'Summary' },
  { value: 'index', label: 'Index' },
  { value: 'pipeline', label: 'Pipeline' },
  { value: 'edition', label: 'Editions' },
  { value: 'batch_job', label: 'Batch Jobs' },
];

const STEP_COLORS: Record<string, { bg: string; text: string }> = {
  import: { bg: '#dbeafe', text: '#1e40af' },
  split: { bg: '#e0e7ff', text: '#3730a3' },
  archive: { bg: '#ccfbf1', text: '#115e59' },
  thumbnail: { bg: '#f0fdf4', text: '#166534' },
  ocr: { bg: '#fef3c7', text: '#92400e' },
  translate: { bg: '#d1fae5', text: '#065f46' },
  extract_images: { bg: '#ede9fe', text: '#5b21b6' },
  summarize: { bg: '#fce7f3', text: '#9d174d' },
  index: { bg: '#ffedd5', text: '#9a3412' },
  pipeline: { bg: '#e0f2fe', text: '#0369a1' },
  edition: { bg: '#fef9c3', text: '#854d0e' },
  batch_job: { bg: '#f1f5f9', text: '#475569' },
};

const STEP_LABELS: Record<string, string> = {
  import: 'Import',
  split: 'Split',
  archive: 'Archive',
  thumbnail: 'Thumbnail',
  ocr: 'OCR',
  translate: 'Translation',
  extract_images: 'Images',
  summarize: 'Summary',
  index: 'Index',
  pipeline: 'Pipeline',
  edition: 'Edition',
  batch_job: 'Batch',
};

// Columns that support sorting — maps column key to asc/desc sort param values
const SORTABLE_COLUMNS: Record<string, { asc: string; desc: string }> = {
  book: { asc: 'book_asc', desc: 'book_desc' },
  step: { asc: 'step_asc', desc: 'step_desc' },
  date: { asc: 'date_asc', desc: 'date_desc' },
  pages: { asc: 'pages_asc', desc: 'pages_desc' },
  cost: { asc: 'cost_asc', desc: 'cost_desc' },
  status: { asc: 'status_asc', desc: 'status_desc' },
};

const PAGE_SIZE = 50;

export default function ProcessingPage() {
  const [data, setData] = useState<ProcessingOverviewResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [step, setStep] = useState('');
  const [sort, setSort] = useState('date_desc');
  const [search, setSearch] = useState('');
  const [searchInput, setSearchInput] = useState('');
  const [offset, setOffset] = useState(0);

  const fetchData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await analytics.processingOverview({
        step: step || undefined,
        sort,
        limit: PAGE_SIZE,
        offset,
        search: search || undefined,
      });
      setData(result);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load data');
    } finally {
      setLoading(false);
    }
  }, [step, sort, offset, search]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    setOffset(0);
    setSearch(searchInput);
  };

  const handleSort = (column: string) => {
    const col = SORTABLE_COLUMNS[column];
    if (!col) return;
    // Toggle: if already sorting by this column desc, switch to asc; otherwise default to desc
    if (sort === col.desc) {
      setSort(col.asc);
    } else if (sort === col.asc) {
      setSort(col.desc);
    } else {
      setSort(col.desc);
    }
    setOffset(0);
  };

  const getSortColumn = (): string | null => {
    for (const [col, vals] of Object.entries(SORTABLE_COLUMNS)) {
      if (sort === vals.asc || sort === vals.desc) return col;
    }
    return null;
  };

  const getSortDir = (): 'asc' | 'desc' => {
    for (const vals of Object.values(SORTABLE_COLUMNS)) {
      if (sort === vals.asc) return 'asc';
    }
    return 'desc';
  };

  const formatDate = (iso: string, endIso?: string) => {
    const d = new Date(iso);
    const formatted = d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
    if (endIso) {
      const end = new Date(endIso);
      const sameDay = d.toDateString() === end.toDateString();
      if (!sameDay) {
        const endFormatted = end.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
        return `${formatted} - ${endFormatted}`;
      }
    }
    return formatted;
  };

  const formatCost = (cost: number) => {
    if (cost === 0) return '-';
    if (cost < 0.01) return `$${cost.toFixed(4)}`;
    if (cost < 1) return `$${cost.toFixed(3)}`;
    return `$${cost.toFixed(2)}`;
  };

  const totalPages = data ? Math.ceil(data.total / PAGE_SIZE) : 0;
  const currentPage = Math.floor(offset / PAGE_SIZE) + 1;
  const activeCol = getSortColumn();
  const activeDir = getSortDir();

  return (
    <div className="min-h-screen" style={{ background: 'var(--bg-cream)' }}>
      {/* Header */}
      <header className="px-6 py-4" style={{ background: 'var(--bg-white)', borderBottom: '1px solid var(--border-light)' }}>
        <div className="max-w-7xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-4">
            <Link href="/analytics" className="hover:opacity-70 transition-opacity" style={{ color: 'var(--text-muted)' }}>
              <ChevronLeft className="w-5 h-5" />
            </Link>
            <h1 className="text-xl font-medium" style={{ fontFamily: 'Cormorant Garamond, Georgia, serif', color: 'var(--text-primary)' }}>
              Processing Overview
            </h1>
          </div>
          <div className="flex items-center gap-3">
            {/* Step filter */}
            <select
              value={step}
              onChange={(e) => { setStep(e.target.value); setOffset(0); }}
              className="px-3 py-1.5 rounded-lg text-sm"
              style={{ border: '1px solid var(--border-medium)', background: 'var(--bg-white)' }}
            >
              {STEPS.map(s => (
                <option key={s.value} value={s.value}>{s.label}</option>
              ))}
            </select>
            {/* Search */}
            <form onSubmit={handleSearch} className="flex items-center gap-1">
              <div className="relative">
                <Search className="w-4 h-4 absolute left-2.5 top-1/2 -translate-y-1/2" style={{ color: 'var(--text-muted)' }} />
                <input
                  type="text"
                  placeholder="Search books..."
                  value={searchInput}
                  onChange={(e) => setSearchInput(e.target.value)}
                  className="pl-8 pr-3 py-1.5 rounded-lg text-sm w-48"
                  style={{ border: '1px solid var(--border-medium)', background: 'var(--bg-white)' }}
                />
              </div>
            </form>
            <button
              onClick={fetchData}
              className="p-1.5 rounded-lg hover:opacity-70 transition-opacity"
              style={{ color: 'var(--text-muted)' }}
            >
              <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
            </button>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-6 py-6 space-y-6">
        {/* Summary cards */}
        {data && (
          <div className="grid grid-cols-4 gap-4">
            <SummaryCard icon={<Layers className="w-5 h-5" />} label="Total Steps" value={data.summary.total_steps.toLocaleString()} />
            <SummaryCard icon={<DollarSign className="w-5 h-5" />} label="Total Cost" value={formatCost(data.summary.total_cost)} />
            <SummaryCard icon={<BookOpen className="w-5 h-5" />} label="Books Processed" value={data.summary.books_processed.toLocaleString()} />
            <SummaryCard icon={<FileText className="w-5 h-5" />} label="Pages Processed" value={data.summary.pages_processed.toLocaleString()} />
          </div>
        )}

        {/* Error */}
        {error && (
          <div className="p-4 rounded-xl text-sm" style={{ background: '#fef2f2', color: '#991b1b', border: '1px solid #fecaca' }}>
            {error}
          </div>
        )}

        {/* Loading */}
        {loading && !data && (
          <div className="flex items-center justify-center py-20">
            <Loader2 className="w-6 h-6 animate-spin" style={{ color: 'var(--text-muted)' }} />
          </div>
        )}

        {/* Table */}
        {data && (
          <div className="rounded-xl overflow-hidden" style={{ background: 'var(--bg-white)', border: '1px solid var(--border-light)' }}>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr style={{ background: 'var(--bg-warm)' }}>
                    <SortableHeader column="book" label="Book" align="left" activeCol={activeCol} activeDir={activeDir} onSort={handleSort} />
                    <SortableHeader column="step" label="Step" align="left" activeCol={activeCol} activeDir={activeDir} onSort={handleSort} />
                    <th className="text-left px-4 py-3 font-medium" style={{ color: 'var(--text-secondary)' }}>Model</th>
                    <th className="text-left px-4 py-3 font-medium" style={{ color: 'var(--text-secondary)' }}>Prompt</th>
                    <SortableHeader column="date" label="Date" align="left" activeCol={activeCol} activeDir={activeDir} onSort={handleSort} />
                    <SortableHeader column="pages" label="Pages" align="right" activeCol={activeCol} activeDir={activeDir} onSort={handleSort} />
                    <SortableHeader column="cost" label="Cost" align="right" activeCol={activeCol} activeDir={activeDir} onSort={handleSort} />
                    <SortableHeader column="status" label="Status" align="right" activeCol={activeCol} activeDir={activeDir} onSort={handleSort} />
                  </tr>
                </thead>
                <tbody>
                  {data.rows.map((row, i) => (
                    <tr
                      key={`${row.book_id}-${row.step}-${i}`}
                      className="transition-colors"
                      style={{ borderTop: '1px solid var(--border-light)' }}
                      onMouseEnter={(e) => e.currentTarget.style.background = 'var(--bg-cream)'}
                      onMouseLeave={(e) => e.currentTarget.style.background = ''}
                    >
                      <td className="px-4 py-3 max-w-[280px]">
                        <Link
                          href={`/book/${row.book_id}`}
                          className="hover:underline truncate block"
                          style={{ color: 'var(--accent-rust)' }}
                          title={row.book_title}
                        >
                          {row.book_title.length > 50 ? row.book_title.slice(0, 50) + '...' : row.book_title}
                        </Link>
                      </td>
                      <td className="px-4 py-3">
                        <StepBadge step={row.step} mode={row.mode} />
                      </td>
                      <td className="px-4 py-3" style={{ color: 'var(--text-secondary)' }}>
                        {row.model ? truncateModel(row.model) : '-'}
                      </td>
                      <td className="px-4 py-3" style={{ color: 'var(--text-muted)' }}>
                        {row.prompt_version || '-'}
                      </td>
                      <td className="px-4 py-3 whitespace-nowrap" style={{ color: 'var(--text-secondary)' }}>
                        {formatDate(row.date_start, row.date_end)}
                      </td>
                      <td className="px-4 py-3 text-right tabular-nums" style={{ color: 'var(--text-secondary)' }}>
                        {row.pages.toLocaleString()}
                      </td>
                      <td className="px-4 py-3 text-right tabular-nums" style={{ color: 'var(--text-secondary)' }}>
                        {formatCost(row.cost_usd)}
                      </td>
                      <td className="px-4 py-3 text-right">
                        <StatusCell success={row.success_count} failed={row.failed_count} />
                      </td>
                    </tr>
                  ))}
                  {data.rows.length === 0 && (
                    <tr>
                      <td colSpan={8} className="px-4 py-12 text-center" style={{ color: 'var(--text-muted)' }}>
                        No processing records found.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>

            {/* Pagination */}
            {totalPages > 1 && (
              <div className="flex items-center justify-between px-4 py-3" style={{ borderTop: '1px solid var(--border-light)', background: 'var(--bg-warm)' }}>
                <span className="text-sm" style={{ color: 'var(--text-muted)' }}>
                  {offset + 1}-{Math.min(offset + PAGE_SIZE, data.total)} of {data.total.toLocaleString()}
                </span>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => setOffset(Math.max(0, offset - PAGE_SIZE))}
                    disabled={offset === 0}
                    className="px-3 py-1 rounded text-sm disabled:opacity-30"
                    style={{ color: 'var(--text-secondary)' }}
                  >
                    Prev
                  </button>
                  <span className="text-sm" style={{ color: 'var(--text-muted)' }}>
                    Page {currentPage} of {totalPages}
                  </span>
                  <button
                    onClick={() => setOffset(offset + PAGE_SIZE)}
                    disabled={offset + PAGE_SIZE >= data.total}
                    className="px-3 py-1 rounded text-sm disabled:opacity-30"
                    style={{ color: 'var(--text-secondary)' }}
                  >
                    Next
                  </button>
                </div>
              </div>
            )}
          </div>
        )}
      </main>
    </div>
  );
}

function SortableHeader({ column, label, align, activeCol, activeDir, onSort }: {
  column: string;
  label: string;
  align: 'left' | 'right';
  activeCol: string | null;
  activeDir: 'asc' | 'desc';
  onSort: (col: string) => void;
}) {
  const isActive = activeCol === column;
  return (
    <th
      className={`${align === 'right' ? 'text-right' : 'text-left'} px-4 py-3 font-medium select-none`}
      style={{ color: isActive ? 'var(--text-primary)' : 'var(--text-secondary)', cursor: 'pointer' }}
      onClick={() => onSort(column)}
    >
      <span className="inline-flex items-center gap-1">
        {align === 'right' && (
          <SortIcon active={isActive} dir={activeDir} />
        )}
        {label}
        {align === 'left' && (
          <SortIcon active={isActive} dir={activeDir} />
        )}
      </span>
    </th>
  );
}

function SortIcon({ active, dir }: { active: boolean; dir: 'asc' | 'desc' }) {
  if (!active) {
    return <ChevronsUpDown className="w-3.5 h-3.5 opacity-30" />;
  }
  return dir === 'asc'
    ? <ChevronUp className="w-3.5 h-3.5" />
    : <ChevronDown className="w-3.5 h-3.5" />;
}

function SummaryCard({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <div className="rounded-xl p-4" style={{ background: 'var(--bg-white)', border: '1px solid var(--border-light)' }}>
      <div className="flex items-center gap-2 mb-1" style={{ color: 'var(--text-muted)' }}>
        {icon}
        <span className="text-xs font-medium uppercase tracking-wide">{label}</span>
      </div>
      <div className="text-2xl font-semibold tabular-nums" style={{ color: 'var(--text-primary)' }}>
        {value}
      </div>
    </div>
  );
}

function StepBadge({ step, mode }: { step: string; mode?: string }) {
  const colors = STEP_COLORS[step] || { bg: '#f3f4f6', text: '#374151' };
  let label = STEP_LABELS[step] || step;

  // For pipeline and batch_job, show the sub-status in the badge
  if (step === 'pipeline' && mode) {
    const shortStatus = mode.replace('_complete', '').replace('_submitted', ' sub.');
    label = `Pipeline: ${shortStatus}`;
  } else if (step === 'batch_job' && mode) {
    label = mode; // e.g. "ocr · completed"
  }

  return (
    <span
      className="inline-block px-2 py-0.5 rounded-full text-xs font-medium whitespace-nowrap"
      style={{ background: colors.bg, color: colors.text }}
    >
      {label}
    </span>
  );
}

function StatusCell({ success, failed }: { success: number; failed: number }) {
  if (failed === 0) {
    return <span style={{ color: '#16a34a' }}>{success.toLocaleString()}</span>;
  }
  return (
    <span>
      <span style={{ color: '#16a34a' }}>{success.toLocaleString()}</span>
      <span style={{ color: 'var(--text-muted)' }}> / </span>
      <span style={{ color: '#dc2626' }}>{failed.toLocaleString()}</span>
    </span>
  );
}

function truncateModel(model: string): string {
  return model
    .replace('models/', '')
    .replace('-preview', '')
    .replace('gemini-', 'g-');
}
