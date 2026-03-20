'use client';

import { useState, useEffect } from 'react';

interface DashboardData {
  canon: {
    total_books: number;
    total_pages: number;
    readable_books: number;
    readable_percent: number;
    first_translations: number;
    first_translations_complete: number;
  };
  coverage: {
    ocr_pages: number;
    ocr_percent: number;
    translated_pages: number;
    translated_percent: number;
  };
  enrichment: {
    with_summary: number;
    with_index: number;
    with_images: number;
    tagged: number;
  };
  pipeline: {
    processing: number;
    queued: number;
  };
  economics: {
    cost_per_page_30d: number;
    total_cost_30d: number;
    pages_translated_30d: number;
  };
}

function fmt(n: number) {
  return n >= 1000 ? `${(n / 1000).toFixed(1)}k` : n.toString();
}

function StatCard({
  label, value, sub, color,
}: {
  label: string; value: string | number; sub?: string; color?: string;
}) {
  return (
    <div style={{
      background: '#0d1117', border: '1px solid #30363d', borderRadius: 10,
      padding: '16px 20px',
    }}>
      <div style={{ fontSize: 12, color: '#8b949e', marginBottom: 6 }}>{label}</div>
      <div style={{ fontSize: 28, fontWeight: 700, color: color || '#f0f6fc' }}>{value}</div>
      {sub && <div style={{ fontSize: 12, color: '#8b949e', marginTop: 4 }}>{sub}</div>}
    </div>
  );
}

function ProgressBar({ percent, color }: { percent: number; color: string }) {
  return (
    <div style={{ height: 6, background: '#21262d', borderRadius: 3, overflow: 'hidden' }}>
      <div style={{
        height: '100%', width: `${Math.min(percent, 100)}%`,
        background: color, borderRadius: 3, transition: 'width 0.5s ease',
      }} />
    </div>
  );
}

export default function AdminDashboard() {
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch('/api/admin/dashboard')
      .then(r => r.json())
      .then(setData)
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <div style={{ padding: '60px 32px', textAlign: 'center', color: '#8b949e' }}>
        Loading dashboard...
      </div>
    );
  }

  if (!data) {
    return (
      <div style={{ padding: '60px 32px', textAlign: 'center', color: '#8b949e' }}>
        Failed to load dashboard
      </div>
    );
  }

  const { canon, coverage, enrichment, pipeline, economics } = data;

  return (
    <div style={{ padding: '24px 32px', maxWidth: 1200, color: '#c9d1d9' }}>
      <div style={{ marginBottom: 24 }}>
        <h1 style={{ fontSize: 22, fontWeight: 600, color: '#f0f6fc', marginBottom: 4 }}>
          Dashboard
        </h1>
        <p style={{ fontSize: 13, color: '#8b949e' }}>
          Source Library at a glance
        </p>
      </div>

      {/* Row 1: The Canon */}
      <div style={{ marginBottom: 28 }}>
        <div style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: 1, color: '#8b949e', marginBottom: 10 }}>
          The Canon
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 12 }}>
          <StatCard label="Books" value={fmt(canon.total_books)} color="#58a6ff" />
          <StatCard label="Readable" value={fmt(canon.readable_books)} sub={`${canon.readable_percent}% of collection`} color="#3fb950" />
          <StatCard label="First Translations" value={canon.first_translations} sub={`${canon.first_translations_complete} complete`} color="#d2a8ff" />
          <StatCard label="Total Pages" value={fmt(canon.total_pages)} color="#8b949e" />
        </div>
      </div>

      {/* Row 2: Coverage */}
      <div style={{ marginBottom: 28 }}>
        <div style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: 1, color: '#8b949e', marginBottom: 10 }}>
          Coverage
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
          <div style={{
            background: '#0d1117', border: '1px solid #30363d', borderRadius: 10,
            padding: '16px 20px',
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
              <span style={{ fontSize: 13, color: '#c9d1d9' }}>OCR</span>
              <span style={{ fontSize: 13, color: '#58a6ff', fontWeight: 600 }}>{coverage.ocr_percent}%</span>
            </div>
            <ProgressBar percent={coverage.ocr_percent} color="#58a6ff" />
            <div style={{ fontSize: 12, color: '#8b949e', marginTop: 6 }}>
              {fmt(coverage.ocr_pages)} pages transcribed
            </div>
          </div>
          <div style={{
            background: '#0d1117', border: '1px solid #30363d', borderRadius: 10,
            padding: '16px 20px',
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
              <span style={{ fontSize: 13, color: '#c9d1d9' }}>Translation</span>
              <span style={{ fontSize: 13, color: '#3fb950', fontWeight: 600 }}>{coverage.translated_percent}%</span>
            </div>
            <ProgressBar percent={coverage.translated_percent} color="#3fb950" />
            <div style={{ fontSize: 12, color: '#8b949e', marginTop: 6 }}>
              {fmt(coverage.translated_pages)} pages translated
            </div>
          </div>
        </div>
      </div>

      {/* Row 3: Enrichment */}
      <div style={{ marginBottom: 28 }}>
        <div style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: 1, color: '#8b949e', marginBottom: 10 }}>
          Enrichment
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 12 }}>
          <StatCard
            label="Summaries"
            value={enrichment.with_summary}
            sub={`${canon.total_books > 0 ? ((enrichment.with_summary / canon.total_books) * 100).toFixed(0) : 0}% of books`}
          />
          <StatCard
            label="Indexes"
            value={enrichment.with_index}
            sub={`${canon.total_books > 0 ? ((enrichment.with_index / canon.total_books) * 100).toFixed(0) : 0}% of books`}
          />
          <StatCard
            label="Images Extracted"
            value={enrichment.with_images}
            sub={`${canon.total_books > 0 ? ((enrichment.with_images / canon.total_books) * 100).toFixed(0) : 0}% of books`}
          />
          <StatCard
            label="Tagged"
            value={enrichment.tagged}
            sub={`${canon.total_books > 0 ? ((enrichment.tagged / canon.total_books) * 100).toFixed(0) : 0}% of books`}
          />
        </div>
      </div>

      {/* Row 4: Pipeline + Economics */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
        <div style={{
          background: '#0d1117', border: '1px solid #30363d', borderRadius: 10,
          padding: '16px 20px',
        }}>
          <div style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: 1, color: '#8b949e', marginBottom: 12 }}>
            Pipeline
          </div>
          <div style={{ display: 'flex', gap: 24 }}>
            <div>
              <div style={{ fontSize: 24, fontWeight: 700, color: pipeline.processing > 0 ? '#f0883e' : '#8b949e' }}>
                {pipeline.processing}
              </div>
              <div style={{ fontSize: 12, color: '#8b949e' }}>processing</div>
            </div>
            <div>
              <div style={{ fontSize: 24, fontWeight: 700, color: pipeline.queued > 0 ? '#58a6ff' : '#8b949e' }}>
                {pipeline.queued}
              </div>
              <div style={{ fontSize: 12, color: '#8b949e' }}>queued</div>
            </div>
          </div>
        </div>
        <div style={{
          background: '#0d1117', border: '1px solid #30363d', borderRadius: 10,
          padding: '16px 20px',
        }}>
          <div style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: 1, color: '#8b949e', marginBottom: 12 }}>
            Economics (30d)
          </div>
          <div style={{ display: 'flex', gap: 24 }}>
            <div>
              <div style={{ fontSize: 24, fontWeight: 700, color: '#c9d1d9' }}>
                ${economics.total_cost_30d.toFixed(0)}
              </div>
              <div style={{ fontSize: 12, color: '#8b949e' }}>total cost</div>
            </div>
            <div>
              <div style={{ fontSize: 24, fontWeight: 700, color: '#c9d1d9' }}>
                ${economics.cost_per_page_30d.toFixed(3)}
              </div>
              <div style={{ fontSize: 12, color: '#8b949e' }}>per page</div>
            </div>
            <div>
              <div style={{ fontSize: 24, fontWeight: 700, color: '#c9d1d9' }}>
                {fmt(economics.pages_translated_30d)}
              </div>
              <div style={{ fontSize: 12, color: '#8b949e' }}>pages</div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
