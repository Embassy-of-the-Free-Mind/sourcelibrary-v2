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
      <p className="text-xs mb-6 max-w-3xl -mt-4" style={{ color: 'var(--text-muted)' }}>
        Unit: one pageview per navigation on any page (admin and API paths excluded), with repeats of the same path
        from the same anonymized IP dropped for 60 seconds. This is not the &ldquo;Reads&rdquo; or &ldquo;Pages read&rdquo;
        on the /analytics Books tab, which keep at most one per IP per book or page per hour; don&apos;t compare, sum or
        ratio the two (#3657).
      </p>
      <TrafficDashboard />
    </main>
  );
}
