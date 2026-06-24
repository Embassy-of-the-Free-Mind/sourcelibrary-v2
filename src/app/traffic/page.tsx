'use client';

import Link from 'next/link';
import dynamic from 'next/dynamic';
import { ChevronLeft } from 'lucide-react';
import { BookLoader } from '@/components/ui/BookLoader';

// First-party traffic dashboard (range/bin/compare + sectioned drill-down +
// cross-filtering). Reads /api/analytics/traffic, which aggregates Mongo
// directly. Client-only, mirroring how /analytics loads its tabs.
const TrafficDashboard = dynamic(() => import('@/components/analytics/TrafficDashboard'), {
  ssr: false,
  loading: () => <div className="py-16 text-center"><BookLoader size="xs" /></div>,
});

export default function TrafficPage() {
  return (
    <div className="min-h-screen" style={{ background: 'var(--bg-cream)' }}>
      <header className="px-6 py-4" style={{ background: 'var(--bg-white)', borderBottom: '1px solid var(--border-light)' }}>
        <div className="max-w-7xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-4">
            <Link href="/" className="hover:opacity-70 transition-opacity" style={{ color: 'var(--text-muted)' }}>
              <ChevronLeft className="w-5 h-5" />
            </Link>
            <h1 className="text-xl font-medium" style={{ color: 'var(--text-primary)' }}>
              Traffic
            </h1>
            <Link
              href="/analytics"
              className="px-3 py-1.5 rounded-lg text-sm font-medium transition-colors hover:opacity-80"
              style={{ background: 'var(--bg-warm)', color: 'var(--text-secondary)' }}
            >
              Pipeline &amp; system
            </Link>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-6 py-8">
        <p className="text-sm mb-6" style={{ color: 'var(--text-muted)' }}>
          First-party visitor data — collected server-side with anonymized IPs, no cookie consent required. The source of truth, independent of Google Analytics. Filter by subdomain under “Sites,” and see the human / bot / AI split (accruing from today).
        </p>
        <TrafficDashboard />
      </main>
    </div>
  );
}
