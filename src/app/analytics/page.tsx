'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';

interface AnalyticsData {
  topPages?: Array<{ path: string; count: number }>;
  topReferrers?: Array<{ referrer: string; count: number }>;
  topCountries?: Array<{ country: string; count: number }>;
  totalVisitors?: number;
  totalPageviews?: number;
  error?: string;
}

export default function AnalyticsPage() {
  const [data, setData] = useState<AnalyticsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const fetchAnalytics = async () => {
      try {
        const res = await fetch('/api/analytics');
        if (!res.ok) {
          throw new Error('Failed to fetch analytics');
        }
        const analyticsData = await res.json();
        setData(analyticsData);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Unknown error');
      } finally {
        setLoading(false);
      }
    };

    fetchAnalytics();
    const interval = setInterval(fetchAnalytics, 5 * 60 * 1000);
    return () => clearInterval(interval);
  }, []);

  return (
    <main className="max-w-6xl mx-auto px-4 py-12">
      <div className="mb-8">
        <Link href="/" className="text-sm text-gray-600 hover:text-gray-900">
          ← Back to home
        </Link>
        <h1 className="text-4xl font-bold mt-4 mb-2">Analytics</h1>
        <p className="text-gray-600">Source Library visitor statistics</p>
      </div>

      {loading && (
        <div className="bg-blue-50 border border-blue-200 rounded-lg p-8 text-center">
          <p className="text-gray-700">Loading analytics...</p>
        </div>
      )}

      {error && (
        <div className="bg-red-50 border border-red-200 rounded-lg p-8">
          <p className="text-red-800 font-semibold">Error loading analytics</p>
          <p className="text-red-600 text-sm mt-2">{error}</p>
          <p className="text-gray-600 text-sm mt-4">
            Analytics data is available in the{' '}
            <a href="https://vercel.com/dashboard" target="_blank" rel="noopener noreferrer" className="text-blue-600 hover:underline">
              Vercel dashboard
            </a>
          </p>
        </div>
      )}

      {data && !error && (
        <div className="space-y-8">
          {(data.totalVisitors || data.totalPageviews) && (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              {data.totalVisitors && (
                <div className="bg-gradient-to-br from-blue-50 to-blue-100 border border-blue-200 rounded-lg p-6">
                  <p className="text-gray-600 text-sm font-semibold">TOTAL VISITORS</p>
                  <p className="text-3xl font-bold text-gray-900 mt-2">{data.totalVisitors.toLocaleString()}</p>
                </div>
              )}
              {data.totalPageviews && (
                <div className="bg-gradient-to-br from-purple-50 to-purple-100 border border-purple-200 rounded-lg p-6">
                  <p className="text-gray-600 text-sm font-semibold">TOTAL PAGEVIEWS</p>
                  <p className="text-3xl font-bold text-gray-900 mt-2">{data.totalPageviews.toLocaleString()}</p>
                </div>
              )}
            </div>
          )}

          {data.topPages && data.topPages.length > 0 && (
            <div className="bg-white border border-gray-200 rounded-lg p-6">
              <h2 className="text-xl font-bold mb-4">Top Pages</h2>
              <div className="space-y-3">
                {data.topPages.map((page, idx) => (
                  <div key={idx} className="flex items-center justify-between pb-3 border-b border-gray-100 last:border-0">
                    <p className="text-gray-900 font-medium truncate">{page.path}</p>
                    <p className="text-gray-600 text-sm ml-4">{page.count.toLocaleString()} views</p>
                  </div>
                ))}
              </div>
            </div>
          )}

          {data.topReferrers && data.topReferrers.length > 0 && (
            <div className="bg-white border border-gray-200 rounded-lg p-6">
              <h2 className="text-xl font-bold mb-4">Traffic Sources</h2>
              <div className="space-y-3">
                {data.topReferrers.map((referrer, idx) => (
                  <div key={idx} className="flex items-center justify-between pb-3 border-b border-gray-100 last:border-0">
                    <p className="text-gray-900 font-medium truncate">{referrer.referrer || 'Direct traffic'}</p>
                    <p className="text-gray-600 text-sm ml-4">{referrer.count.toLocaleString()} visitors</p>
                  </div>
                ))}
              </div>
            </div>
          )}

          {data.topCountries && data.topCountries.length > 0 && (
            <div className="bg-white border border-gray-200 rounded-lg p-6">
              <h2 className="text-xl font-bold mb-4">Visitor Locations</h2>
              <div className="space-y-3">
                {data.topCountries.map((country, idx) => (
                  <div key={idx} className="flex items-center justify-between pb-3 border-b border-gray-100 last:border-0">
                    <p className="text-gray-900 font-medium">{country.country}</p>
                    <p className="text-gray-600 text-sm ml-4">{country.count.toLocaleString()} visitors</p>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="bg-gray-50 border border-gray-200 rounded-lg p-4 text-sm text-gray-600">
            <p>📊 Real-time analytics provided by <a href="https://vercel.com" target="_blank" rel="noopener noreferrer" className="text-blue-600 hover:underline">Vercel Analytics</a>. Data refreshes every 5 minutes.</p>
          </div>
        </div>
      )}
    </main>
  );
}
