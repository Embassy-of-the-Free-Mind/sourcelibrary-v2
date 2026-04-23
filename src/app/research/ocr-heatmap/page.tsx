'use client';

import { useEffect, useState, useCallback, useRef } from 'react';

interface ClusterInfo {
  _id: string;
  count: number;
  books: Array<{ id: string; title: string; year: number; language: string }>;
}

interface HeatmapData {
  workId: string;
  editionA: { id: string; title: string; year: number; pages: number };
  editionB: { id: string; title: string; year: number; pages: number };
  pagesA: number[];
  pagesB: number[];
  matrix: number[][];
  stats: { avgBestMatch: number; totalA: number; totalB: number; sampledA: number; sampledB: number };
}

function simColor(sim: number): string {
  // Dark (low similarity) → bright (high similarity)
  if (sim >= 0.95) return '#22c55e'; // green - near identical
  if (sim >= 0.85) return '#86efac'; // light green
  if (sim >= 0.75) return '#fde047'; // yellow
  if (sim >= 0.65) return '#fb923c'; // orange
  if (sim >= 0.50) return '#f87171'; // red
  return '#1e1b4b'; // dark indigo - very different
}

export default function OcrHeatmapPage() {
  const [clusters, setClusters] = useState<ClusterInfo[] | null>(null);
  const [selectedWork, setSelectedWork] = useState<string | null>(null);
  const [heatmap, setHeatmap] = useState<HeatmapData | null>(null);
  const [loading, setLoading] = useState(false);
  const [hoveredCell, setHoveredCell] = useState<{ row: number; col: number; sim: number } | null>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    fetch('/api/research/ocr-heatmap')
      .then((r) => r.json())
      .then((d) => setClusters(d.clusters));
  }, []);

  const loadHeatmap = useCallback(async (workId: string) => {
    setSelectedWork(workId);
    setLoading(true);
    setHeatmap(null);
    try {
      const r = await fetch(`/api/research/ocr-heatmap?work_id=${encodeURIComponent(workId)}`);
      const data = await r.json();
      setHeatmap(data);
    } finally {
      setLoading(false);
    }
  }, []);

  // Draw heatmap on canvas
  useEffect(() => {
    if (!heatmap || !canvasRef.current) return;
    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const { matrix, pagesA, pagesB } = heatmap;
    const rows = matrix.length;
    const cols = matrix[0]?.length || 0;
    if (rows === 0 || cols === 0) return;

    const cellSize = Math.min(8, Math.floor(600 / Math.max(rows, cols)));
    const labelSpace = 40;
    const w = cols * cellSize + labelSpace;
    const h = rows * cellSize + labelSpace;

    const dpr = window.devicePixelRatio || 1;
    canvas.width = w * dpr;
    canvas.height = h * dpr;
    canvas.style.width = `${w}px`;
    canvas.style.height = `${h}px`;
    ctx.scale(dpr, dpr);

    ctx.fillStyle = '#fafaf9';
    ctx.fillRect(0, 0, w, h);

    // Draw cells
    for (let i = 0; i < rows; i++) {
      for (let j = 0; j < cols; j++) {
        ctx.fillStyle = simColor(matrix[i][j]);
        ctx.fillRect(labelSpace + j * cellSize, labelSpace + i * cellSize, cellSize - 0.5, cellSize - 0.5);
      }
    }

    // Axis labels (sampled)
    ctx.fillStyle = '#78716c';
    ctx.font = `${Math.min(9, cellSize)}px monospace`;
    ctx.textAlign = 'right';
    const labelStep = Math.max(1, Math.floor(rows / 10));
    for (let i = 0; i < rows; i += labelStep) {
      ctx.fillText(String(pagesA[i]), labelSpace - 3, labelSpace + i * cellSize + cellSize * 0.8);
    }
    ctx.textAlign = 'center';
    const colStep = Math.max(1, Math.floor(cols / 10));
    for (let j = 0; j < cols; j += colStep) {
      ctx.save();
      ctx.translate(labelSpace + j * cellSize + cellSize / 2, labelSpace - 3);
      ctx.rotate(-Math.PI / 4);
      ctx.fillText(String(pagesB[j]), 0, 0);
      ctx.restore();
    }

    // Axis titles
    ctx.fillStyle = '#44403c';
    ctx.font = '11px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('Edition B pages →', labelSpace + (cols * cellSize) / 2, 10);
    ctx.save();
    ctx.translate(10, labelSpace + (rows * cellSize) / 2);
    ctx.rotate(-Math.PI / 2);
    ctx.fillText('Edition A pages →', 0, 0);
    ctx.restore();
  }, [heatmap]);

  // Handle hover on canvas
  const handleCanvasMove = useCallback(
    (e: React.MouseEvent<HTMLCanvasElement>) => {
      if (!heatmap || !canvasRef.current) return;
      const rect = canvasRef.current.getBoundingClientRect();
      const { matrix, pagesA, pagesB } = heatmap;
      const rows = matrix.length;
      const cols = matrix[0]?.length || 0;
      const cellSize = Math.min(8, Math.floor(600 / Math.max(rows, cols)));
      const labelSpace = 40;

      const x = e.clientX - rect.left - labelSpace;
      const y = e.clientY - rect.top - labelSpace;
      const col = Math.floor(x / cellSize);
      const row = Math.floor(y / cellSize);

      if (row >= 0 && row < rows && col >= 0 && col < cols) {
        setHoveredCell({ row, col, sim: matrix[row][col] });
      } else {
        setHoveredCell(null);
      }
    },
    [heatmap],
  );

  return (
    <div className="min-h-screen bg-stone-50 p-6 max-w-5xl mx-auto">
      <h1 className="text-2xl font-bold text-stone-900 mb-1">OCR Consistency Heatmap</h1>
      <p className="text-stone-500 text-sm mb-6">
        Page-level embedding similarity between editions of the same work. A bright diagonal means
        the pipeline produced consistent output across different scans. Dark spots reveal OCR
        problems or translation drift.
      </p>

      {/* Legend */}
      <div className="flex items-center gap-1 mb-6 text-xs text-stone-500">
        <span>Low similarity</span>
        <div className="flex">
          {[0.3, 0.5, 0.65, 0.75, 0.85, 0.95].map((v) => (
            <div
              key={v}
              className="w-6 h-4"
              style={{ backgroundColor: simColor(v) }}
              title={`${(v * 100).toFixed(0)}%`}
            />
          ))}
        </div>
        <span>High similarity</span>
      </div>

      {/* Cluster selector */}
      {clusters && !selectedWork && (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
          {clusters.map((c) => (
            <button
              key={c._id}
              onClick={() => loadHeatmap(c._id)}
              className="text-left p-4 bg-white rounded-lg border border-stone-200 hover:border-stone-400 transition-colors"
            >
              <p className="font-medium text-stone-900 text-sm">{c._id}</p>
              <p className="text-xs text-stone-500 mt-1">
                {c.count} editions &middot; {c.books[0]?.language}
              </p>
              <p className="text-xs text-stone-400 mt-0.5">
                {c.books
                  .slice(0, 2)
                  .map((b) => b.title?.substring(0, 35))
                  .join(' vs ')}
              </p>
            </button>
          ))}
        </div>
      )}

      {loading && (
        <div className="flex flex-col items-center justify-center py-20 gap-3">
          <div className="inline-block w-6 h-6 border-2 border-stone-300 border-t-stone-600 rounded-full animate-spin" />
          <p className="text-stone-500 text-sm">Computing {selectedWork} similarity matrix...</p>
        </div>
      )}

      {/* Heatmap result */}
      {heatmap && (
        <div>
          <div className="flex items-center gap-4 mb-4">
            <button
              onClick={() => {
                setSelectedWork(null);
                setHeatmap(null);
              }}
              className="text-sm text-stone-500 hover:text-stone-700"
            >
              &larr; Back
            </button>
            <h2 className="text-lg font-semibold text-stone-900">{heatmap.workId}</h2>
          </div>

          {/* Stats */}
          <div className="bg-white rounded-lg border border-stone-200 p-4 mb-4 flex flex-wrap gap-6 text-sm">
            <div>
              <span className="text-stone-500">A:</span>{' '}
              <span className="font-medium">{heatmap.editionA.title}</span>
              <span className="text-stone-400 ml-1">({heatmap.stats.totalA}pp)</span>
            </div>
            <div>
              <span className="text-stone-500">B:</span>{' '}
              <span className="font-medium">{heatmap.editionB.title}</span>
              <span className="text-stone-400 ml-1">({heatmap.stats.totalB}pp)</span>
            </div>
            <div>
              <span className="text-stone-500">Avg best match:</span>{' '}
              <span
                className={`font-bold ${heatmap.stats.avgBestMatch > 0.8 ? 'text-green-600' : heatmap.stats.avgBestMatch > 0.6 ? 'text-amber-600' : 'text-red-600'}`}
              >
                {(heatmap.stats.avgBestMatch * 100).toFixed(1)}%
              </span>
            </div>
          </div>

          {/* Canvas heatmap */}
          <div className="bg-white rounded-lg border border-stone-200 p-4 overflow-auto">
            <div className="relative inline-block">
              <canvas
                ref={canvasRef}
                onMouseMove={handleCanvasMove}
                onMouseLeave={() => setHoveredCell(null)}
                className="cursor-crosshair"
              />
              {hoveredCell && heatmap && (
                <div className="absolute top-2 right-2 bg-white/95 border border-stone-200 rounded px-3 py-1.5 text-xs shadow-sm">
                  <span className="text-stone-500">
                    A p{heatmap.pagesA[hoveredCell.row]} ↔ B p{heatmap.pagesB[hoveredCell.col]}
                  </span>
                  <br />
                  <span
                    className={`font-bold ${hoveredCell.sim > 0.8 ? 'text-green-600' : hoveredCell.sim > 0.6 ? 'text-amber-600' : 'text-red-600'}`}
                  >
                    {(hoveredCell.sim * 100).toFixed(1)}% similarity
                  </span>
                </div>
              )}
            </div>
          </div>

          {/* Interpretation */}
          <div className="mt-4 text-xs text-stone-500 leading-relaxed">
            <p>
              <strong>Reading the heatmap:</strong> Each cell shows embedding similarity between a
              page in Edition A (rows) and Edition B (columns). A bright diagonal from top-left to
              bottom-right means the editions are page-aligned and consistently processed. Off-diagonal
              bright spots indicate the same content at different page numbers. Dark areas reveal
              pages where OCR or translation diverged significantly.
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
