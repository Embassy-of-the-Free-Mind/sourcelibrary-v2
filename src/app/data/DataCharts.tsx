'use client';

import { BarChart } from '@/components/analytics/charts/BarChart';

interface DataChartsProps {
  centuries: Array<{ x: string; y: number }>;
}

export function CenturyChart({ centuries }: DataChartsProps) {
  return (
    <BarChart
      data={centuries}
      width={800}
      height={240}
      color="var(--accent-rust)"
    />
  );
}
