'use client';

import { useState, useEffect } from 'react';
import { Users, Globe, BarChart3 } from 'lucide-react';
import { analytics } from '@/lib/api-client';
import { BookLoader } from '@/components/ui/BookLoader';
import type { TrafficData } from '@/lib/api-client/types/analytics';

export default function TrafficTab() {
  const [data, setData] = useState<TrafficData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    analytics.traffic().then(setData).finally(() => setLoading(false));
  }, []);

  if (loading) return <div className="py-12"><BookLoader size="xs" /></div>;

  if (!data) {
    return (
      <div className="text-center py-12" style={{ color: 'var(--text-muted)' }}>
        <BarChart3 className="w-12 h-12 mx-auto mb-4 opacity-30" />
        <p>No traffic data available yet</p>
        <p className="text-sm mt-1">Pageview data will appear here as the site is used</p>
      </div>
    );
  }

  return (
    <div className="space-y-8">
      {/* Summary Cards */}
      {(data.totalVisitors || data.totalPageviews) && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {data.totalVisitors !== undefined && (
            <div className="p-6 rounded-xl" style={{ background: 'linear-gradient(135deg, var(--bg-white), #f0f9ff)', border: '1px solid var(--border-light)' }}>
              <div className="flex items-center gap-2 mb-2">
                <Users className="w-5 h-5" style={{ color: '#3b82f6' }} />
                <span className="text-sm font-medium uppercase" style={{ color: 'var(--text-muted)' }}>Total Visitors</span>
              </div>
              <div className="text-4xl font-bold" style={{ color: 'var(--text-primary)' }}>
                {data.totalVisitors.toLocaleString()}
              </div>
            </div>
          )}
          {data.totalPageviews !== undefined && (
            <div className="p-6 rounded-xl" style={{ background: 'linear-gradient(135deg, var(--bg-white), #faf5ff)', border: '1px solid var(--border-light)' }}>
              <div className="flex items-center gap-2 mb-2">
                <BarChart3 className="w-5 h-5" style={{ color: '#8b5cf6' }} />
                <span className="text-sm font-medium uppercase" style={{ color: 'var(--text-muted)' }}>Total Pageviews</span>
              </div>
              <div className="text-4xl font-bold" style={{ color: 'var(--text-primary)' }}>
                {data.totalPageviews.toLocaleString()}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Top Pages */}
      {data.topPages && data.topPages.length > 0 && (
        <div className="p-6 rounded-xl" style={{ background: 'var(--bg-white)', border: '1px solid var(--border-light)' }}>
          <h2 className="text-lg font-medium mb-4" style={{ color: 'var(--text-primary)' }}>Top Pages</h2>
          <div className="space-y-3">
            {data.topPages.map((page, idx) => (
              <div key={idx} className="flex items-center justify-between pb-3" style={{ borderBottom: idx < data.topPages!.length - 1 ? '1px solid var(--border-light)' : 'none' }}>
                <p className="font-medium truncate" style={{ color: 'var(--text-primary)' }}>{page.path}</p>
                <p className="text-sm ml-4" style={{ color: 'var(--text-muted)' }}>{page.count.toLocaleString()} views</p>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Traffic Sources and Countries */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {data.topReferrers && data.topReferrers.length > 0 && (
          <div className="p-6 rounded-xl" style={{ background: 'var(--bg-white)', border: '1px solid var(--border-light)' }}>
            <h2 className="text-lg font-medium mb-4" style={{ color: 'var(--text-primary)' }}>Traffic Sources</h2>
            <div className="space-y-3">
              {data.topReferrers.map((referrer, idx) => (
                <div key={idx} className="flex items-center justify-between pb-3" style={{ borderBottom: idx < data.topReferrers!.length - 1 ? '1px solid var(--border-light)' : 'none' }}>
                  <p className="font-medium truncate" style={{ color: 'var(--text-primary)' }}>{referrer.referrer || 'Direct traffic'}</p>
                  <p className="text-sm ml-4" style={{ color: 'var(--text-muted)' }}>{referrer.count.toLocaleString()} visitors</p>
                </div>
              ))}
            </div>
          </div>
        )}

        {data.topCountries && data.topCountries.length > 0 && (
          <div className="p-6 rounded-xl" style={{ background: 'var(--bg-white)', border: '1px solid var(--border-light)' }}>
            <h2 className="text-lg font-medium mb-4 flex items-center gap-2" style={{ color: 'var(--text-primary)' }}>
              <Globe className="w-5 h-5" style={{ color: 'var(--accent-sage)' }} />
              Visitor Locations
            </h2>
            <div className="space-y-3">
              {data.topCountries.map((country, idx) => (
                <div key={idx} className="flex items-center justify-between pb-3" style={{ borderBottom: idx < data.topCountries!.length - 1 ? '1px solid var(--border-light)' : 'none' }}>
                  <p className="font-medium" style={{ color: 'var(--text-primary)' }}>{country.country}</p>
                  <p className="text-sm ml-4" style={{ color: 'var(--text-muted)' }}>{country.count.toLocaleString()} visitors</p>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      <div className="p-4 rounded-lg text-sm" style={{ background: 'var(--bg-warm)', color: 'var(--text-muted)' }}>
        <p>Pageview data from internal tracking. For detailed traffic analytics, see{' '}
          <a href="https://analytics.google.com" target="_blank" rel="noopener noreferrer" className="underline hover:opacity-80" style={{ color: 'var(--accent-rust)' }}>
            Google Analytics
          </a>.
        </p>
      </div>
    </div>
  );
}
