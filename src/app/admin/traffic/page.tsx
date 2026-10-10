'use client';

import dynamic from 'next/dynamic';
import { BookLoader } from '@/components/ui/BookLoader';

// /admin/traffic: the one interactive traffic view (range, bin, compare,
// drill-down, cross-filter). Replaces /traffic and the /analytics Traffic tab.
// Reads /api/analytics/traffic live from Mongo; /admin shows the daily
// snapshot. Admin-gated by the /admin layout.
const TrafficDashboard = dynamic(() => import('@/components/analytics/TrafficDashboard'), {
  ssr: false,
  loading: () => <div className="py-16 text-center"><BookLoader size="xs" /></div>,
});

export default function AdminTrafficPage() {
  return (
    <main className="max-w-7xl mx-auto px-6 py-8">
      <h1 className="text-xl font-medium mb-2" style={{ color: 'var(--text-primary)' }}>Traffic</h1>
      <p className="text-sm mb-6 max-w-3xl" style={{ color: 'var(--text-muted)' }}>
        Pageviews recorded by our own page tracker, with anonymized IPs, read live. Proxy-pool traffic is removed
        from every figure; crawlers and AI agents never run the tracker. Click a site, section, source or country
        to filter the rest of the page.
      </p>
      <TrafficDashboard />
    </main>
  );
}
