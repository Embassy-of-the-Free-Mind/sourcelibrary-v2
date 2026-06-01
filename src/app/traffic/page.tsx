'use client';

import { useState } from 'react';
import Link from 'next/link';
import dynamic from 'next/dynamic';
import { ChevronLeft, RefreshCw } from 'lucide-react';

const LoadingBar = () => (
  <div className="py-8">
    <div className="w-full h-1.5 rounded-full overflow-hidden" style={{ background: 'var(--bg-warm)' }}>
      <div className="h-full rounded-full" style={{ background: 'var(--accent-sage)', width: '40%', animation: 'loading-bar 2s ease-in-out infinite' }} />
    </div>
    <style>{`@keyframes loading-bar { 0% { transform: translateX(-100%); } 50% { transform: translateX(150%); } 100% { transform: translateX(-100%); } }`}</style>
    <p className="text-center text-sm mt-4" style={{ color: 'var(--text-muted)' }}>Loading...</p>
  </div>
);

// TrafficTab fetches first-party pageviews from /api/analytics (Mongo source of
// truth). Loaded client-side only, mirroring how /analytics renders its tabs.
const TrafficTab = dynamic(() => import('@/components/analytics/tabs/TrafficTab'), { ssr: false, loading: LoadingBar });

export default function TrafficPage() {
  const [refreshKey, setRefreshKey] = useState(0);

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
              Full analytics
            </Link>
          </div>
          <button
            onClick={() => setRefreshKey(k => k + 1)}
            className="flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm font-medium hover:opacity-70 transition-opacity"
            style={{ color: 'var(--accent-rust)' }}
          >
            <RefreshCw className="w-4 h-4" />
            Refresh
          </button>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-6 py-8">
        <p className="text-sm mb-6" style={{ color: 'var(--text-muted)' }}>
          First-party visitor data from the last 30 days — collected server-side with anonymized IPs, no cookie consent required. This is the source of truth, independent of Google Analytics.
        </p>
        <TrafficTab key={refreshKey} />
      </main>
    </div>
  );
}
