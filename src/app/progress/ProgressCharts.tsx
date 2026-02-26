'use client';

import { useEffect, useState } from 'react';
import { AreaChart } from '@/components/analytics/charts/AreaChart';
import { BarChart } from '@/components/analytics/charts/BarChart';
import { dateLabel } from '@/components/analytics/charts/chart-utils';

interface ChartData {
  x: string;
  y: number;
}

interface ProgressData {
  books: { weekly: ChartData[]; cumulative: ChartData[] };
  ocr: { weekly: ChartData[]; cumulative: ChartData[] };
  translation: { weekly: ChartData[]; cumulative: ChartData[] };
  totals: { books: number; pages: number; ocr: number; translated: number };
}

function formatNumber(n: number): string {
  return n.toLocaleString('en-US');
}

export function ProgressCharts({ commitData }: { commitData: ChartData[] }) {
  const [data, setData] = useState<ProgressData | null>(null);

  useEffect(() => {
    fetch('/api/progress')
      .then(r => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json();
      })
      .then(d => { if (d.books) setData(d); })
      .catch(() => {});
  }, []);

  return (
    <div className="space-y-12">
      {/* Commit activity */}
      <div>
        <h3 className="text-xl text-primary mb-1">Development Activity</h3>
        <p className="text-muted text-sm mb-4">Commits per week since project start (Dec 12, 2025)</p>
        <div className="bg-white rounded-xl p-4 border border-border-light">
          <BarChart data={commitData} width={800} height={220} color="var(--accent-violet)" />
        </div>
      </div>

      {data ? (
        <>
          {/* Books in collection */}
          <div>
            <h3 className="text-xl text-primary mb-1">
              Books in Collection
              <span className="text-muted text-base font-normal ml-3">{formatNumber(data.totals.books)} total</span>
            </h3>
            <p className="text-muted text-sm mb-4">Cumulative books imported from 13 digital library sources</p>
            <div className="bg-white rounded-xl p-4 border border-border-light">
              <AreaChart data={data.books.cumulative} width={800} height={220} color="var(--accent-rust)" xLabel={dateLabel} />
            </div>
          </div>

          {/* Pages OCR'd */}
          <div>
            <h3 className="text-xl text-primary mb-1">
              Pages OCR&apos;d
              <span className="text-muted text-base font-normal ml-3">{formatNumber(data.totals.ocr)} total</span>
            </h3>
            <p className="text-muted text-sm mb-4">Pages with AI-extracted text (Gemini vision models)</p>
            <div className="bg-white rounded-xl p-4 border border-border-light">
              <AreaChart data={data.ocr.cumulative} width={800} height={220} color="var(--accent-sage)" xLabel={dateLabel} />
            </div>
          </div>

          {/* Pages translated */}
          <div>
            <h3 className="text-xl text-primary mb-1">
              Pages Translated
              <span className="text-muted text-base font-normal ml-3">{formatNumber(data.totals.translated)} total</span>
            </h3>
            <p className="text-muted text-sm mb-4">Pages with English translations or modernizations</p>
            <div className="bg-white rounded-xl p-4 border border-border-light">
              <AreaChart data={data.translation.cumulative} width={800} height={220} color="var(--accent-gold)" xLabel={dateLabel} />
            </div>
          </div>
        </>
      ) : (
        <div className="text-center py-12 text-muted">Loading collection data...</div>
      )}
    </div>
  );
}
