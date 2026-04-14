'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import Link from 'next/link';
import { ChevronLeft, RefreshCw } from 'lucide-react';

// ── Pipeline stage definitions ──────────────────────────────────────────

interface Stage {
  id: string;
  label: string;
  phase: string;
  row: number;      // which row (0 = top, 1 = middle, 2 = bottom)
  col: number;      // column position
  description: string;
}

const STAGES: Stage[] = [
  { id: 'queued',              label: 'Enroll',          phase: '0',   row: 0, col: 0, description: 'New books auto-enrolled' },
  { id: 'archive_complete',    label: 'Archive',         phase: '1',   row: 0, col: 1, description: 'Page images downloaded' },
  { id: 'ocr_submitted',      label: 'OCR',             phase: '2',   row: 0, col: 2, description: 'Gemini Batch API' },
  { id: 'ocr_complete',       label: 'OCR Done',        phase: '3',   row: 0, col: 3, description: 'Text extracted' },
  { id: 'metadata_enriched',  label: 'Metadata',        phase: '3.5', row: 0, col: 4, description: 'AI classification' },
  { id: 'ft_verified',        label: 'FT Verify',       phase: '3.7', row: 0, col: 5, description: 'First translation check' },
  { id: 'translate_submitted', label: 'Translate',       phase: '4',   row: 1, col: 5, description: 'Hetzner realtime' },
  { id: 'translate_complete',  label: 'Translated',      phase: '5',   row: 1, col: 4, description: 'Full translation done' },
  { id: 'summary_indexed',    label: 'Summary',         phase: '6',   row: 1, col: 3, description: 'Gemini summary + index' },
  { id: 'chapters_complete',  label: 'Chapters',        phase: '7',   row: 1, col: 2, description: 'Chapter extraction' },
  { id: 'images_submitted',   label: 'Images',          phase: '8',   row: 1, col: 1, description: 'Gemini Batch vision' },
  { id: 'images_complete',    label: 'Images Done',     phase: '8.9', row: 1, col: 0, description: 'Cover selected' },
  { id: 'complete',           label: 'Complete',         phase: '9',   row: 2, col: 0, description: 'Fully processed' },
];

// Connections between stages (source → target)
const EDGES: [string, string][] = [
  ['queued', 'archive_complete'],
  ['archive_complete', 'ocr_submitted'],
  ['ocr_submitted', 'ocr_complete'],
  ['ocr_complete', 'metadata_enriched'],
  ['metadata_enriched', 'ft_verified'],
  ['ft_verified', 'translate_submitted'],
  ['translate_submitted', 'translate_complete'],
  ['translate_complete', 'summary_indexed'],
  ['summary_indexed', 'chapters_complete'],
  ['chapters_complete', 'images_submitted'],
  ['images_submitted', 'images_complete'],
  ['images_complete', 'complete'],
];

// ── Helpers ─────────────────────────────────────────────────────────────

function fmt(n: number): string {
  if (n >= 10000) return `${(n / 1000).toFixed(1)}k`;
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`;
  return n.toLocaleString();
}

function getHealthColor(count: number, stageId: string): string {
  if (stageId === 'complete') return 'var(--accent-sage)';
  if (count === 0) return 'var(--text-faint)';
  if (count > 500) return 'var(--accent-rust)';
  if (count > 100) return 'var(--accent-gold)';
  return 'var(--accent-sage)';
}

function getHealthLabel(count: number, stageId: string): string {
  if (stageId === 'complete') return 'done';
  if (count === 0) return 'clear';
  if (count > 500) return 'backlog';
  if (count > 100) return 'busy';
  return 'flowing';
}

// ── Component ───────────────────────────────────────────────────────────

export default function PipelineViz() {
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(true);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const [error, setError] = useState<string | null>(null);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const fetchData = useCallback(async () => {
    try {
      const res = await fetch('/api/admin/realtime');
      if (!res.ok) throw new Error(`${res.status}`);
      const data = await res.json();
      const map: Record<string, number> = {};
      for (const item of data.pipelineFunnel || []) {
        map[item.status] = item.count;
      }
      setCounts(map);
      setLastUpdated(new Date());
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to fetch');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
    intervalRef.current = setInterval(fetchData, 30_000);
    return () => { if (intervalRef.current) clearInterval(intervalRef.current); };
  }, [fetchData]);

  // ── Layout calculations ──

  const NODE_W = 130;
  const NODE_H = 72;
  const GAP_X = 30;
  const GAP_Y = 40;
  const MARGIN = { top: 40, left: 40, right: 40, bottom: 60 };

  const maxCols = Math.max(...STAGES.map(s => s.col)) + 1;
  const maxRows = Math.max(...STAGES.map(s => s.row)) + 1;
  const svgW = MARGIN.left + maxCols * (NODE_W + GAP_X) - GAP_X + MARGIN.right;
  const svgH = MARGIN.top + maxRows * (NODE_H + GAP_Y) - GAP_Y + MARGIN.bottom;

  function nodeX(col: number) { return MARGIN.left + col * (NODE_W + GAP_X); }
  function nodeY(row: number) { return MARGIN.top + row * (NODE_H + GAP_Y); }
  function nodeCX(col: number) { return nodeX(col) + NODE_W / 2; }
  function nodeCY(row: number) { return nodeY(row) + NODE_H / 2; }

  const stageMap = new Map(STAGES.map(s => [s.id, s]));

  // ── Total counts ──

  const totalInPipeline = STAGES.filter(s => s.id !== 'complete')
    .reduce((sum, s) => sum + (counts[s.id] || 0), 0);
  const totalComplete = counts['complete'] || 0;
  const failedCount = counts['failed'] || 0;
  const notEnrolled = counts['not_enrolled'] || 0;

  return (
    <div style={{ minHeight: '100vh', background: 'var(--bg-cream)', padding: '2rem' }}>
      {/* Header */}
      <div style={{ maxWidth: 1200, margin: '0 auto' }}>
        <Link href="/admin" style={{ display: 'inline-flex', alignItems: 'center', gap: 4, color: 'var(--text-muted)', fontSize: 14, textDecoration: 'none', marginBottom: 12 }}>
          <ChevronLeft size={16} /> Admin
        </Link>

        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 }}>
          <div>
            <h1 style={{ fontFamily: 'var(--font-serif)', fontSize: 28, fontWeight: 400, color: 'var(--text-primary)', margin: 0 }}>
              Pipeline Flow
            </h1>
            <p style={{ color: 'var(--text-muted)', fontSize: 14, margin: '4px 0 0' }}>
              {totalInPipeline.toLocaleString()} in pipeline &middot; {totalComplete.toLocaleString()} complete
              {failedCount > 0 && <span style={{ color: 'var(--accent-rust)' }}> &middot; {failedCount} failed</span>}
              {notEnrolled > 0 && <span> &middot; {notEnrolled.toLocaleString()} not enrolled</span>}
            </p>
          </div>
          <button
            onClick={fetchData}
            disabled={loading}
            style={{
              display: 'flex', alignItems: 'center', gap: 6, padding: '8px 16px',
              border: '1px solid var(--text-faint)', borderRadius: 6, background: 'white',
              color: 'var(--text-secondary)', cursor: 'pointer', fontSize: 13,
            }}
          >
            <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
            {lastUpdated ? `Updated ${lastUpdated.toLocaleTimeString()}` : 'Loading...'}
          </button>
        </div>

        {error && (
          <div style={{ padding: '8px 16px', background: '#fef2f2', border: '1px solid var(--accent-rust)', borderRadius: 6, color: 'var(--accent-rust)', fontSize: 13, marginBottom: 16 }}>
            Error: {error}
          </div>
        )}

        {/* SVG Pipeline Diagram */}
        <div style={{ background: 'white', borderRadius: 12, border: '1px solid #e8e4de', padding: 24, overflowX: 'auto' }}>
          <svg width={svgW} height={svgH} style={{ display: 'block', margin: '0 auto' }}>
            <defs>
              <marker id="arrow" viewBox="0 0 10 7" refX="10" refY="3.5" markerWidth="8" markerHeight="6" orient="auto-start-reverse">
                <polygon points="0 0, 10 3.5, 0 7" fill="var(--text-faint)" />
              </marker>
            </defs>

            {/* Edges */}
            {EDGES.map(([fromId, toId]) => {
              const from = stageMap.get(fromId);
              const to = stageMap.get(toId);
              if (!from || !to) return null;

              const x1 = nodeCX(from.col);
              const y1 = nodeCY(from.row);
              const x2 = nodeCX(to.col);
              const y2 = nodeCY(to.row);

              // Same row: straight horizontal
              if (from.row === to.row) {
                const startX = from.col < to.col ? nodeX(from.col) + NODE_W : nodeX(from.col);
                const endX = from.col < to.col ? nodeX(to.col) : nodeX(to.col) + NODE_W;
                return (
                  <line
                    key={`${fromId}-${toId}`}
                    x1={startX} y1={y1} x2={endX} y2={y2}
                    stroke="var(--text-faint)" strokeWidth={1.5} markerEnd="url(#arrow)"
                  />
                );
              }

              // Different row: curved path
              const startX = x1;
              const startY = nodeY(from.row) + NODE_H;
              const endX = x2;
              const endY = nodeY(to.row);
              const midY = (startY + endY) / 2;

              return (
                <path
                  key={`${fromId}-${toId}`}
                  d={`M ${startX} ${startY} C ${startX} ${midY}, ${endX} ${midY}, ${endX} ${endY}`}
                  fill="none" stroke="var(--text-faint)" strokeWidth={1.5} markerEnd="url(#arrow)"
                />
              );
            })}

            {/* Nodes */}
            {STAGES.map((stage) => {
              const x = nodeX(stage.col);
              const y = nodeY(stage.row);
              const count = counts[stage.id] || 0;
              const color = getHealthColor(count, stage.id);
              const health = getHealthLabel(count, stage.id);

              return (
                <g key={stage.id}>
                  {/* Card background */}
                  <rect
                    x={x} y={y} width={NODE_W} height={NODE_H}
                    rx={8} fill="white" stroke={color} strokeWidth={2}
                  />

                  {/* Left color bar */}
                  <rect x={x} y={y} width={4} height={NODE_H} rx={2} fill={color} />

                  {/* Phase number */}
                  <text x={x + 14} y={y + 16} fontSize={10} fill="var(--text-faint)" fontFamily="var(--font-sans)">
                    Phase {stage.phase}
                  </text>

                  {/* Label */}
                  <text x={x + 14} y={y + 33} fontSize={14} fontWeight={600} fill="var(--text-primary)" fontFamily="var(--font-sans)">
                    {stage.label}
                  </text>

                  {/* Count */}
                  <text x={x + 14} y={y + 52} fontSize={18} fontWeight={700} fill={color} fontFamily="var(--font-sans)">
                    {fmt(count)}
                  </text>

                  {/* Health badge */}
                  <text x={x + NODE_W - 10} y={y + 52} fontSize={10} fill={color} textAnchor="end" fontFamily="var(--font-sans)">
                    {health}
                  </text>

                  {/* Hover tooltip area */}
                  <title>{`${stage.label} (Phase ${stage.phase})\n${count.toLocaleString()} books\n${stage.description}`}</title>
                </g>
              );
            })}

            {/* Row labels */}
            <text x={MARGIN.left - 8} y={nodeY(0) + NODE_H / 2} fontSize={11} fill="var(--text-faint)" textAnchor="end" dominantBaseline="middle" fontFamily="var(--font-sans)" transform={`rotate(-90, ${MARGIN.left - 8}, ${nodeY(0) + NODE_H / 2})`}>
              Ingest
            </text>
            <text x={MARGIN.left - 8} y={nodeY(1) + NODE_H / 2} fontSize={11} fill="var(--text-faint)" textAnchor="end" dominantBaseline="middle" fontFamily="var(--font-sans)" transform={`rotate(-90, ${MARGIN.left - 8}, ${nodeY(1) + NODE_H / 2})`}>
              Enrich
            </text>
          </svg>
        </div>

        {/* Legend */}
        <div style={{ display: 'flex', gap: 24, marginTop: 16, justifyContent: 'center', fontSize: 12, color: 'var(--text-muted)' }}>
          <span><span style={{ display: 'inline-block', width: 10, height: 10, borderRadius: 2, background: 'var(--accent-sage)', marginRight: 4 }} />Flowing (&lt;100)</span>
          <span><span style={{ display: 'inline-block', width: 10, height: 10, borderRadius: 2, background: 'var(--accent-gold)', marginRight: 4 }} />Busy (100-500)</span>
          <span><span style={{ display: 'inline-block', width: 10, height: 10, borderRadius: 2, background: 'var(--accent-rust)', marginRight: 4 }} />Backlog (&gt;500)</span>
          <span><span style={{ display: 'inline-block', width: 10, height: 10, borderRadius: 2, background: 'var(--text-faint)', marginRight: 4 }} />Clear (0)</span>
        </div>

        {/* Refresh note */}
        <p style={{ textAlign: 'center', fontSize: 11, color: 'var(--text-faint)', marginTop: 8 }}>
          Auto-refreshes every 30s
        </p>
      </div>
    </div>
  );
}
