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
const opts = { ssr: false, loading: LoadingBar };
const UsageTab = dynamic(() => import('@/components/analytics/tabs/UsageTab'), opts);
const PerformanceTab = dynamic(() => import('@/components/analytics/tabs/PerformanceTab'), opts);
const LogsTab = dynamic(() => import('@/components/analytics/tabs/LogsTab'), opts);
const SearchTab = dynamic(() => import('@/components/analytics/tabs/SearchTab'), opts);
const TrafficTab = dynamic(() => import('@/components/analytics/tabs/TrafficTab'), opts);
const PipelineTab = dynamic(() => import('@/components/analytics/tabs/PipelineTab'), opts);
type Tab = 'usage' | 'performance' | 'logs' | 'search' | 'traffic' | 'pipeline';

const TABS: { key: Tab; label: string }[] = [
  { key: 'usage', label: 'Usage' },
  { key: 'performance', label: 'Performance' },
  { key: 'logs', label: 'Logs' },
  { key: 'search', label: 'Search' },
  { key: 'traffic', label: 'Traffic' },
  { key: 'pipeline', label: 'Pipeline' },
];

export default function AnalyticsPage() {
  const [activeTab, setActiveTab] = useState<Tab>('usage');
  const [days, setDays] = useState(30);
  const [hours, setHours] = useState(24);
  const [pipelineHours, setPipelineHours] = useState(24);
  const [refreshKey, setRefreshKey] = useState(0);

  return (
    <div className="min-h-screen" style={{ background: 'var(--bg-cream)' }}>
      {/* Header */}
      <header className="px-6 py-4" style={{ background: 'var(--bg-white)', borderBottom: '1px solid var(--border-light)' }}>
        <div className="max-w-7xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-4">
            <Link href="/" className="hover:opacity-70 transition-opacity" style={{ color: 'var(--text-muted)' }}>
              <ChevronLeft className="w-5 h-5" />
            </Link>
            <h1 className="text-xl font-medium" style={{ color: 'var(--text-primary)' }}>
              Analytics
            </h1>
            <Link
              href="/jobs"
              className="px-3 py-1.5 rounded-lg text-sm font-medium transition-colors hover:opacity-80"
              style={{ background: 'var(--bg-warm)', color: 'var(--text-secondary)' }}
            >
              Jobs
            </Link>
          </div>
          <div className="flex items-center gap-4">
            {/* Tab toggle */}
            <div className="flex rounded-lg p-1" style={{ background: 'var(--bg-warm)' }}>
              {TABS.map(tab => (
                <button
                  key={tab.key}
                  onClick={() => setActiveTab(tab.key)}
                  className={`px-3 py-1.5 rounded-md text-sm font-medium transition-all ${activeTab === tab.key ? 'shadow-sm' : ''}`}
                  style={{
                    background: activeTab === tab.key ? 'var(--bg-white)' : 'transparent',
                    color: activeTab === tab.key ? 'var(--text-primary)' : 'var(--text-muted)',
                  }}
                >
                  {tab.label}
                </button>
              ))}
            </div>

            {/* Time controls */}
            {activeTab === 'pipeline' && (
              <select
                value={pipelineHours}
                onChange={(e) => setPipelineHours(parseInt(e.target.value))}
                className="px-3 py-1.5 rounded-lg text-sm"
                style={{ border: '1px solid var(--border-medium)', background: 'var(--bg-white)' }}
              >
                <option value={6}>Last 6 hours</option>
                <option value={24}>Last 24 hours</option>
                <option value={72}>Last 3 days</option>
                <option value={168}>Last 7 days</option>
                <option value={336}>Last 14 days</option>
              </select>
            )}
            {(activeTab === 'usage' || activeTab === 'search') && (
              <select
                value={days}
                onChange={(e) => setDays(parseInt(e.target.value))}
                className="px-3 py-1.5 rounded-lg text-sm"
                style={{ border: '1px solid var(--border-medium)', background: 'var(--bg-white)' }}
              >
                <option value={7}>Last 7 days</option>
                <option value={30}>Last 30 days</option>
                <option value={90}>Last 90 days</option>
              </select>
            )}
            {activeTab === 'performance' && (
              <select
                value={hours}
                onChange={(e) => setHours(parseInt(e.target.value))}
                className="px-3 py-1.5 rounded-lg text-sm"
                style={{ border: '1px solid var(--border-medium)', background: 'var(--bg-white)' }}
              >
                <option value={1}>Last hour</option>
                <option value={6}>Last 6 hours</option>
                <option value={24}>Last 24 hours</option>
                <option value={72}>Last 3 days</option>
                <option value={168}>Last week</option>
              </select>
            )}

            <button
              onClick={() => setRefreshKey(k => k + 1)}
              className="flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm font-medium hover:opacity-70 transition-opacity"
              style={{ color: 'var(--accent-rust)' }}
            >
              <RefreshCw className="w-4 h-4" />
              Refresh
            </button>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-6 py-8">
        {activeTab === 'usage' && <UsageTab key={refreshKey} days={days} />}
        {activeTab === 'performance' && <PerformanceTab key={refreshKey} hours={hours} />}
        {activeTab === 'logs' && <LogsTab key={refreshKey} />}
        {activeTab === 'search' && <SearchTab key={refreshKey} days={days} />}
        {activeTab === 'traffic' && <TrafficTab key={refreshKey} />}
        {activeTab === 'pipeline' && <PipelineTab key={refreshKey} hours={pipelineHours} />}
      </main>
    </div>
  );
}
