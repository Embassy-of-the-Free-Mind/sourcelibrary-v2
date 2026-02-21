'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import Link from 'next/link';
import {
  ChevronLeft, RefreshCw, Download, Search, ChevronUp, ChevronDown,
  ArrowUpDown, ExternalLink,
} from 'lucide-react';
import type { ProcessingRow } from '@/app/api/admin/processing-csv/route';

type SortKey = keyof ProcessingRow;
type SortDir = 'asc' | 'desc';

const STATUS_COLORS: Record<string, string> = {
  complete: 'var(--accent-sage)',
  enriched: 'var(--accent-sage)',
  ocr_complete: 'var(--accent-gold)',
  translate_complete: 'var(--accent-gold)',
  ocr_submitted: 'var(--accent-gold)',
  translate_submitted: 'var(--accent-gold)',
  archiving: 'var(--text-muted)',
  queued: 'var(--text-muted)',
  failed: 'var(--accent-rust)',
  not_enrolled: 'var(--text-faint)',
};

export default function ProcessingPage() {
  const [rows, setRows] = useState<ProcessingRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [languageFilter, setLanguageFilter] = useState('');
  const [sortKey, setSortKey] = useState<SortKey>('title');
  const [sortDir, setSortDir] = useState<SortDir>('asc');

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/admin/processing-csv?format=json');
      if (!res.ok) throw new Error('Failed to fetch');
      const data = await res.json();
      setRows(data.rows);
    } catch (e) {
      console.error('Failed to fetch processing data:', e);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchData(); }, [fetchData]);

  // Derive unique statuses and languages for filter dropdowns
  const statuses = useMemo(() => {
    const set = new Set(rows.map(r => r.pipeline_status));
    return Array.from(set).sort();
  }, [rows]);

  const languages = useMemo(() => {
    const set = new Set(rows.map(r => r.language).filter(Boolean));
    return Array.from(set).sort();
  }, [rows]);

  // Filter and sort
  const filtered = useMemo(() => {
    let result = rows;
    if (search) {
      const q = search.toLowerCase();
      result = result.filter(r =>
        r.title.toLowerCase().includes(q) ||
        r.author.toLowerCase().includes(q) ||
        r.book_id.toLowerCase().includes(q)
      );
    }
    if (statusFilter) {
      result = result.filter(r => r.pipeline_status === statusFilter);
    }
    if (languageFilter) {
      result = result.filter(r => r.language === languageFilter);
    }

    // Sort
    const sorted = [...result].sort((a, b) => {
      const av = a[sortKey];
      const bv = b[sortKey];
      if (typeof av === 'number' && typeof bv === 'number') {
        return sortDir === 'asc' ? av - bv : bv - av;
      }
      if (typeof av === 'boolean' && typeof bv === 'boolean') {
        return sortDir === 'asc' ? (av === bv ? 0 : av ? -1 : 1) : (av === bv ? 0 : av ? 1 : -1);
      }
      const sa = String(av ?? '');
      const sb = String(bv ?? '');
      return sortDir === 'asc' ? sa.localeCompare(sb) : sb.localeCompare(sa);
    });
    return sorted;
  }, [rows, search, statusFilter, languageFilter, sortKey, sortDir]);

  const handleSort = (key: SortKey) => {
    if (sortKey === key) {
      setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    } else {
      setSortKey(key);
      setSortDir('asc');
    }
  };

  const SortIcon = ({ col }: { col: SortKey }) => {
    if (sortKey !== col) return <ArrowUpDown className="w-3 h-3 opacity-30" />;
    return sortDir === 'asc'
      ? <ChevronUp className="w-3 h-3" />
      : <ChevronDown className="w-3 h-3" />;
  };

  // Column definitions for the visible table
  const columns: { key: SortKey; label: string; width?: string; align?: 'right' | 'center' }[] = [
    { key: 'title', label: 'Title', width: '240px' },
    { key: 'author', label: 'Author', width: '140px' },
    { key: 'year', label: 'Year', width: '60px', align: 'right' },
    { key: 'language', label: 'Lang', width: '70px' },
    { key: 'pages', label: 'Pages', width: '55px', align: 'right' },
    { key: 'ocr_pct', label: 'OCR %', width: '60px', align: 'right' },
    { key: 'translate_pct', label: 'Trans %', width: '60px', align: 'right' },
    { key: 'pipeline_status', label: 'Status', width: '110px' },
    { key: 'ocr_model', label: 'OCR Model', width: '130px' },
    { key: 'ocr_prompt', label: 'OCR Prompt', width: '100px' },
    { key: 'trans_model', label: 'Trans Model', width: '130px' },
    { key: 'trans_prompt', label: 'Trans Prompt', width: '100px' },
    { key: 'has_summary', label: 'Sum', width: '40px', align: 'center' },
    { key: 'has_index', label: 'Idx', width: '40px', align: 'center' },
    { key: 'has_chapters', label: 'Ch', width: '40px', align: 'center' },
    { key: 'source', label: 'Source', width: '60px' },
  ];

  return (
    <div className="min-h-screen" style={{ background: 'var(--bg-cream)' }}>
      {/* Header */}
      <header
        className="sticky top-0 z-20 px-4 py-3 border-b"
        style={{ background: 'var(--bg-cream)', borderColor: 'var(--border-light)' }}
      >
        <div className="flex items-center justify-between gap-4 max-w-[1800px] mx-auto">
          <div className="flex items-center gap-3">
            <Link href="/analytics" style={{ color: 'var(--text-muted)' }}>
              <ChevronLeft className="w-5 h-5" />
            </Link>
            <h1 className="font-serif text-xl" style={{ color: 'var(--text-primary)' }}>
              Processing Status
            </h1>
            <span
              className="text-xs px-2 py-0.5 rounded-full"
              style={{ background: 'var(--bg-warm)', color: 'var(--text-muted)' }}
            >
              {filtered.length.toLocaleString()} / {rows.length.toLocaleString()} books
            </span>
          </div>

          <div className="flex items-center gap-2">
            {/* Search */}
            <div className="relative">
              <Search
                className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2"
                style={{ color: 'var(--text-faint)' }}
              />
              <input
                type="text"
                placeholder="Search title, author, ID..."
                value={search}
                onChange={e => setSearch(e.target.value)}
                className="pl-8 pr-3 py-1.5 text-sm rounded border w-56"
                style={{
                  borderColor: 'var(--border-light)',
                  background: 'var(--bg-warm)',
                  color: 'var(--text-primary)',
                }}
              />
            </div>

            {/* Status filter */}
            <select
              value={statusFilter}
              onChange={e => setStatusFilter(e.target.value)}
              className="text-sm rounded border px-2 py-1.5"
              style={{
                borderColor: 'var(--border-light)',
                background: 'var(--bg-warm)',
                color: 'var(--text-primary)',
              }}
            >
              <option value="">All statuses</option>
              {statuses.map(s => <option key={s} value={s}>{s}</option>)}
            </select>

            {/* Language filter */}
            <select
              value={languageFilter}
              onChange={e => setLanguageFilter(e.target.value)}
              className="text-sm rounded border px-2 py-1.5"
              style={{
                borderColor: 'var(--border-light)',
                background: 'var(--bg-warm)',
                color: 'var(--text-primary)',
              }}
            >
              <option value="">All languages</option>
              {languages.map(l => <option key={l} value={l}>{l}</option>)}
            </select>

            {/* CSV download */}
            <a
              href="/api/admin/processing-csv"
              className="flex items-center gap-1 text-sm px-3 py-1.5 rounded border"
              style={{
                borderColor: 'var(--border-light)',
                color: 'var(--text-secondary)',
              }}
            >
              <Download className="w-3.5 h-3.5" /> CSV
            </a>

            {/* Refresh */}
            <button
              onClick={fetchData}
              disabled={loading}
              className="p-1.5 rounded"
              style={{ color: 'var(--text-muted)' }}
            >
              <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
            </button>
          </div>
        </div>
      </header>

      {/* Table */}
      <div className="overflow-x-auto">
        <table className="w-full text-sm" style={{ minWidth: '1600px' }}>
          <thead>
            <tr
              className="sticky top-[57px] z-10"
              style={{ background: 'var(--bg-warm)' }}
            >
              {columns.map(col => (
                <th
                  key={col.key}
                  className="px-2 py-2 font-medium cursor-pointer select-none whitespace-nowrap border-b"
                  style={{
                    width: col.width,
                    textAlign: col.align || 'left',
                    color: 'var(--text-secondary)',
                    borderColor: 'var(--border-light)',
                    fontSize: '11px',
                    letterSpacing: '0.03em',
                  }}
                  onClick={() => handleSort(col.key)}
                >
                  <span className="inline-flex items-center gap-1">
                    {col.label}
                    <SortIcon col={col.key} />
                  </span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {loading && rows.length === 0 ? (
              <tr>
                <td
                  colSpan={columns.length}
                  className="text-center py-16"
                  style={{ color: 'var(--text-muted)' }}
                >
                  <RefreshCw className="w-6 h-6 mx-auto mb-2 animate-spin opacity-30" />
                  Loading...
                </td>
              </tr>
            ) : filtered.length === 0 ? (
              <tr>
                <td
                  colSpan={columns.length}
                  className="text-center py-16"
                  style={{ color: 'var(--text-muted)' }}
                >
                  No books match filters
                </td>
              </tr>
            ) : (
              filtered.map(row => (
                <tr
                  key={row.book_id}
                  className="hover:bg-[var(--bg-warm)] transition-colors"
                  style={{ borderBottom: '1px solid var(--border-light)' }}
                >
                  {/* Title */}
                  <td className="px-2 py-1.5 truncate" style={{ maxWidth: '240px' }}>
                    <a
                      href={row.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="hover:underline inline-flex items-center gap-1"
                      style={{ color: 'var(--accent-rust)' }}
                      title={row.title}
                    >
                      <span className="truncate">{row.title || '(untitled)'}</span>
                      <ExternalLink className="w-3 h-3 flex-shrink-0 opacity-40" />
                    </a>
                  </td>
                  {/* Author */}
                  <td
                    className="px-2 py-1.5 truncate"
                    style={{ color: 'var(--text-secondary)', maxWidth: '140px' }}
                    title={row.author}
                  >
                    {row.author}
                  </td>
                  {/* Year */}
                  <td className="px-2 py-1.5 text-right" style={{ color: 'var(--text-muted)' }}>
                    {row.year}
                  </td>
                  {/* Language */}
                  <td className="px-2 py-1.5 truncate" style={{ color: 'var(--text-muted)', maxWidth: '70px' }}>
                    {row.language}
                  </td>
                  {/* Pages */}
                  <td className="px-2 py-1.5 text-right tabular-nums" style={{ color: 'var(--text-secondary)' }}>
                    {row.pages || ''}
                  </td>
                  {/* OCR % */}
                  <td className="px-2 py-1.5 text-right tabular-nums">
                    <PctCell value={row.ocr_pct} />
                  </td>
                  {/* Translate % */}
                  <td className="px-2 py-1.5 text-right tabular-nums">
                    <PctCell value={row.translate_pct} />
                  </td>
                  {/* Pipeline status */}
                  <td className="px-2 py-1.5">
                    <span
                      className="text-xs px-1.5 py-0.5 rounded"
                      style={{
                        color: STATUS_COLORS[row.pipeline_status] || 'var(--text-muted)',
                        background: `color-mix(in srgb, ${STATUS_COLORS[row.pipeline_status] || 'var(--text-muted)'} 12%, transparent)`,
                      }}
                    >
                      {row.pipeline_status}
                    </span>
                  </td>
                  {/* OCR model */}
                  <td className="px-2 py-1.5 truncate text-xs" style={{ color: 'var(--text-muted)', maxWidth: '130px' }}>
                    {shortModel(row.ocr_model)}
                  </td>
                  {/* OCR prompt */}
                  <td className="px-2 py-1.5 text-xs" style={{ color: 'var(--text-muted)' }}>
                    {row.ocr_prompt}
                  </td>
                  {/* Trans model */}
                  <td className="px-2 py-1.5 truncate text-xs" style={{ color: 'var(--text-muted)', maxWidth: '130px' }}>
                    {shortModel(row.trans_model)}
                  </td>
                  {/* Trans prompt */}
                  <td className="px-2 py-1.5 text-xs" style={{ color: 'var(--text-muted)' }}>
                    {row.trans_prompt}
                  </td>
                  {/* Summary */}
                  <td className="px-2 py-1.5 text-center">
                    <Dot ok={row.has_summary} />
                  </td>
                  {/* Index */}
                  <td className="px-2 py-1.5 text-center">
                    <Dot ok={row.has_index} />
                  </td>
                  {/* Chapters */}
                  <td className="px-2 py-1.5 text-center">
                    <Dot ok={row.has_chapters} />
                  </td>
                  {/* Source */}
                  <td className="px-2 py-1.5 text-xs" style={{ color: 'var(--text-faint)' }}>
                    {row.source}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function PctCell({ value }: { value: number }) {
  if (!value) return <span style={{ color: 'var(--text-faint)' }}>0</span>;
  const color = value >= 95
    ? 'var(--accent-sage)'
    : value >= 50
      ? 'var(--accent-gold)'
      : 'var(--text-muted)';
  return <span style={{ color }}>{value}%</span>;
}

function Dot({ ok }: { ok: boolean }) {
  return (
    <span
      className="inline-block w-2 h-2 rounded-full"
      style={{ background: ok ? 'var(--accent-sage)' : 'var(--border-light)' }}
    />
  );
}

function shortModel(model: string): string {
  if (!model) return '';
  return model
    .replace('gemini-', '')
    .replace('-preview', '')
    .replace('-latest', '');
}
