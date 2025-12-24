'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { ChevronLeft, RefreshCw, Clock, BookOpen, FileText, Languages, Users, MapPin, Globe, DollarSign, Coins, ListChecks, CheckCircle, XCircle, Pause, Loader2 } from 'lucide-react';

interface MetricStat {
  name: string;
  count: number;
  avg: number;
  min: number;
  max: number;
  p50: number | null;
  p95: number | null;
}

interface RecentSample {
  name: string;
  duration: number;
  timestamp: number;
  metadata?: Record<string, unknown>;
}

interface PerformanceData {
  stats: MetricStat[];
  recentSamples: RecentSample[];
  query: { hours: number; metricName: string | null };
}

interface UsageData {
  summary: {
    totalBooks: number;
    totalPages: number;
    pagesWithOcr: number;
    pagesWithTranslation: number;
    ocrPercentage: number;
    translationPercentage: number;
    totalHits: number;
    uniqueVisitors: number;
  };
  hitsByDay: Array<{ date: string; hits: number; uniqueVisitors: number }>;
  processingByDay: Array<{ date: string; ocr: number; translation: number }>;
  modelUsage: Array<{ model: string; count: number }>;
  promptUsage: Array<{ prompt: string; count: number }>;
  recentBooks: Array<{ title: string; author: string; created_at: string; pages_count: number }>;
  visitorsByCountry: Array<{ country: string; countryCode: string; hits: number; visitors: number }>;
  visitorLocations: Array<{ city: string; country: string; countryCode: string; hits: number; lat: number; lon: number }>;
  costStats?: {
    totalCost: number;
    totalTokens: number;
    costByDay: Array<{ date: string; cost: number; tokens: number }>;
    costByAction: Array<{ action: string; cost: number; count: number }>;
  };
}

interface JobLog {
  id: string;
  type: 'batch_ocr' | 'batch_translate' | 'batch_split' | 'book_import';
  status: 'pending' | 'processing' | 'paused' | 'completed' | 'failed' | 'cancelled';
  progress: {
    total: number;
    completed: number;
    failed: number;
  };
  book_id?: string;
  book_title?: string;
  created_at: string;
  updated_at: string;
  started_at?: string;
  completed_at?: string;
  error?: string;
  config: {
    model?: string;
    prompt_name?: string;
    language?: string;
    page_ids?: string[];
  };
}

export default function AnalyticsPage() {
  const [perfData, setPerfData] = useState<PerformanceData | null>(null);
  const [usageData, setUsageData] = useState<UsageData | null>(null);
  const [jobLogs, setJobLogs] = useState<JobLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [hours, setHours] = useState(24);
  const [days, setDays] = useState(30);
  const [jobLimit, setJobLimit] = useState(50);
  const [jobTypeFilter, setJobTypeFilter] = useState<string>('');
  const [jobStatusFilter, setJobStatusFilter] = useState<string>('');
  const [activeTab, setActiveTab] = useState<'usage' | 'performance' | 'logs'>('usage');
  const [error, setError] = useState<string | null>(null);

  const fetchData = async () => {
    setLoading(true);
    setError(null);
    try {
      const [perfRes, usageRes] = await Promise.all([
        fetch(`/api/analytics/loading?hours=${hours}`),
        fetch(`/api/analytics/usage?days=${days}`),
      ]);

      if (!perfRes.ok || !usageRes.ok) throw new Error('Failed to fetch analytics');

      const [perfJson, usageJson] = await Promise.all([
        perfRes.json(),
        usageRes.json(),
      ]);

      setPerfData(perfJson);
      setUsageData(usageJson);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Unknown error');
    } finally {
      setLoading(false);
    }
  };

  const fetchJobLogs = async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({ limit: jobLimit.toString() });
      if (jobTypeFilter) params.set('type', jobTypeFilter);
      if (jobStatusFilter) params.set('status', jobStatusFilter);

      const res = await fetch(`/api/jobs?${params}`);
      if (!res.ok) throw new Error('Failed to fetch job logs');

      const data = await res.json();
      setJobLogs(data.jobs || []);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Unknown error');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, [hours, days]);

  useEffect(() => {
    if (activeTab === 'logs') {
      fetchJobLogs();
    }
  }, [activeTab, jobLimit, jobTypeFilter, jobStatusFilter]);

  const formatDuration = (ms: number) => {
    if (ms < 1000) return `${Math.round(ms)}ms`;
    return `${(ms / 1000).toFixed(2)}s`;
  };

  const formatTime = (timestamp: number) => {
    return new Date(timestamp).toLocaleString();
  };

  const formatNumber = (n: number) => {
    return n.toLocaleString();
  };

  const formatCost = (cost: number) => {
    if (cost < 0.01) return `$${cost.toFixed(4)}`;
    if (cost < 1) return `$${cost.toFixed(3)}`;
    return `$${cost.toFixed(2)}`;
  };

  const formatTokens = (tokens: number) => {
    if (tokens >= 1000000) return `${(tokens / 1000000).toFixed(1)}M`;
    if (tokens >= 1000) return `${(tokens / 1000).toFixed(1)}K`;
    return tokens.toString();
  };

  const formatJobType = (type: string) => {
    const labels: Record<string, string> = {
      batch_ocr: 'OCR',
      batch_translate: 'Translate',
      batch_split: 'Split',
      book_import: 'Import',
    };
    return labels[type] || type;
  };

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'completed': return <CheckCircle className="w-4 h-4" style={{ color: '#22c55e' }} />;
      case 'failed': return <XCircle className="w-4 h-4" style={{ color: '#ef4444' }} />;
      case 'processing': return <Loader2 className="w-4 h-4 animate-spin" style={{ color: 'var(--accent-sage)' }} />;
      case 'paused': return <Pause className="w-4 h-4" style={{ color: '#f59e0b' }} />;
      case 'cancelled': return <XCircle className="w-4 h-4" style={{ color: 'var(--text-muted)' }} />;
      default: return <Clock className="w-4 h-4" style={{ color: 'var(--text-muted)' }} />;
    }
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'completed': return '#22c55e';
      case 'failed': return '#ef4444';
      case 'processing': return 'var(--accent-sage)';
      case 'paused': return '#f59e0b';
      case 'cancelled': return 'var(--text-muted)';
      default: return 'var(--text-muted)';
    }
  };

  return (
    <div className="min-h-screen" style={{ background: 'var(--bg-cream)' }}>
      {/* Header */}
      <header className="px-6 py-4" style={{ background: 'var(--bg-white)', borderBottom: '1px solid var(--border-light)' }}>
        <div className="max-w-6xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-4">
            <Link href="/" className="hover:opacity-70 transition-opacity" style={{ color: 'var(--text-muted)' }}>
              <ChevronLeft className="w-5 h-5" />
            </Link>
            <h1 className="text-xl font-medium" style={{ fontFamily: 'Cormorant Garamond, Georgia, serif', color: 'var(--text-primary)' }}>
              Analytics
            </h1>
          </div>
          <div className="flex items-center gap-4">
            {/* Tab toggle */}
            <div className="flex rounded-lg p-1" style={{ background: 'var(--bg-warm)' }}>
              <button
                onClick={() => setActiveTab('usage')}
                className={`px-3 py-1.5 rounded-md text-sm font-medium transition-all ${activeTab === 'usage' ? 'shadow-sm' : ''}`}
                style={{
                  background: activeTab === 'usage' ? 'var(--bg-white)' : 'transparent',
                  color: activeTab === 'usage' ? 'var(--text-primary)' : 'var(--text-muted)',
                }}
              >
                Usage
              </button>
              <button
                onClick={() => setActiveTab('performance')}
                className={`px-3 py-1.5 rounded-md text-sm font-medium transition-all ${activeTab === 'performance' ? 'shadow-sm' : ''}`}
                style={{
                  background: activeTab === 'performance' ? 'var(--bg-white)' : 'transparent',
                  color: activeTab === 'performance' ? 'var(--text-primary)' : 'var(--text-muted)',
                }}
              >
                Performance
              </button>
              <button
                onClick={() => setActiveTab('logs')}
                className={`px-3 py-1.5 rounded-md text-sm font-medium transition-all ${activeTab === 'logs' ? 'shadow-sm' : ''}`}
                style={{
                  background: activeTab === 'logs' ? 'var(--bg-white)' : 'transparent',
                  color: activeTab === 'logs' ? 'var(--text-primary)' : 'var(--text-muted)',
                }}
              >
                Logs
              </button>
            </div>

            {activeTab === 'usage' && (
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
            {activeTab === 'logs' && (
              <>
                <select
                  value={jobTypeFilter}
                  onChange={(e) => setJobTypeFilter(e.target.value)}
                  className="px-3 py-1.5 rounded-lg text-sm"
                  style={{ border: '1px solid var(--border-medium)', background: 'var(--bg-white)' }}
                >
                  <option value="">All Types</option>
                  <option value="batch_ocr">OCR</option>
                  <option value="batch_translate">Translate</option>
                  <option value="batch_split">Split</option>
                  <option value="book_import">Import</option>
                </select>
                <select
                  value={jobStatusFilter}
                  onChange={(e) => setJobStatusFilter(e.target.value)}
                  className="px-3 py-1.5 rounded-lg text-sm"
                  style={{ border: '1px solid var(--border-medium)', background: 'var(--bg-white)' }}
                >
                  <option value="">All Status</option>
                  <option value="completed">Completed</option>
                  <option value="failed">Failed</option>
                  <option value="processing">Processing</option>
                  <option value="paused">Paused</option>
                  <option value="pending">Pending</option>
                  <option value="cancelled">Cancelled</option>
                </select>
                <select
                  value={jobLimit}
                  onChange={(e) => setJobLimit(parseInt(e.target.value))}
                  className="px-3 py-1.5 rounded-lg text-sm"
                  style={{ border: '1px solid var(--border-medium)', background: 'var(--bg-white)' }}
                >
                  <option value={25}>Last 25</option>
                  <option value={50}>Last 50</option>
                  <option value={100}>Last 100</option>
                  <option value={200}>Last 200</option>
                </select>
              </>
            )}

            <button
              onClick={activeTab === 'logs' ? fetchJobLogs : fetchData}
              disabled={loading}
              className="flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm font-medium hover:opacity-70 transition-opacity"
              style={{ color: 'var(--accent-rust)' }}
            >
              <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
              Refresh
            </button>
          </div>
        </div>
      </header>

      <main className="max-w-6xl mx-auto px-6 py-8">
        {error && (
          <div className="p-4 rounded-lg mb-6" style={{ background: '#fef2f2', color: '#991b1b' }}>
            {error}
          </div>
        )}

        {loading ? (
          <div className="text-center py-12" style={{ color: 'var(--text-muted)' }}>
            <RefreshCw className="w-8 h-8 mx-auto mb-4 animate-spin opacity-30" />
            <p>Loading analytics...</p>
          </div>
        ) : activeTab === 'usage' ? (
          /* Usage Tab */
          <div className="space-y-8">
            {/* Summary Cards */}
            {usageData?.summary && (
              <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
                <div className="p-4 rounded-xl" style={{ background: 'var(--bg-white)', border: '1px solid var(--border-light)' }}>
                  <div className="flex items-center gap-2 mb-2">
                    <BookOpen className="w-4 h-4" style={{ color: 'var(--accent-violet)' }} />
                    <span className="text-xs font-medium uppercase" style={{ color: 'var(--text-muted)' }}>Books</span>
                  </div>
                  <div className="text-2xl font-semibold" style={{ color: 'var(--text-primary)' }}>
                    {formatNumber(usageData.summary.totalBooks)}
                  </div>
                </div>

                <div className="p-4 rounded-xl" style={{ background: 'var(--bg-white)', border: '1px solid var(--border-light)' }}>
                  <div className="flex items-center gap-2 mb-2">
                    <FileText className="w-4 h-4" style={{ color: 'var(--accent-sage)' }} />
                    <span className="text-xs font-medium uppercase" style={{ color: 'var(--text-muted)' }}>Pages OCR'd</span>
                  </div>
                  <div className="text-2xl font-semibold" style={{ color: 'var(--text-primary)' }}>
                    {formatNumber(usageData.summary.pagesWithOcr)}
                    <span className="text-sm font-normal ml-1" style={{ color: 'var(--text-muted)' }}>
                      / {formatNumber(usageData.summary.totalPages)}
                    </span>
                  </div>
                  <div className="text-xs mt-1" style={{ color: 'var(--accent-sage)' }}>
                    {usageData.summary.ocrPercentage}% complete
                  </div>
                </div>

                <div className="p-4 rounded-xl" style={{ background: 'var(--bg-white)', border: '1px solid var(--border-light)' }}>
                  <div className="flex items-center gap-2 mb-2">
                    <Languages className="w-4 h-4" style={{ color: 'var(--accent-rust)' }} />
                    <span className="text-xs font-medium uppercase" style={{ color: 'var(--text-muted)' }}>Translated</span>
                  </div>
                  <div className="text-2xl font-semibold" style={{ color: 'var(--text-primary)' }}>
                    {formatNumber(usageData.summary.pagesWithTranslation)}
                  </div>
                  <div className="text-xs mt-1" style={{ color: 'var(--accent-rust)' }}>
                    {usageData.summary.translationPercentage}% complete
                  </div>
                </div>

                <div className="p-4 rounded-xl" style={{ background: 'var(--bg-white)', border: '1px solid var(--border-light)' }}>
                  <div className="flex items-center gap-2 mb-2">
                    <Users className="w-4 h-4" style={{ color: 'var(--text-muted)' }} />
                    <span className="text-xs font-medium uppercase" style={{ color: 'var(--text-muted)' }}>Visitors</span>
                  </div>
                  <div className="text-2xl font-semibold" style={{ color: 'var(--text-primary)' }}>
                    {formatNumber(usageData.summary.uniqueVisitors)}
                  </div>
                  <div className="text-xs mt-1" style={{ color: 'var(--text-muted)' }}>
                    {formatNumber(usageData.summary.totalHits)} total hits
                  </div>
                </div>

                {/* API Cost Card */}
                <div className="p-4 rounded-xl" style={{ background: 'var(--bg-white)', border: '1px solid var(--border-light)' }}>
                  <div className="flex items-center gap-2 mb-2">
                    <DollarSign className="w-4 h-4" style={{ color: '#22c55e' }} />
                    <span className="text-xs font-medium uppercase" style={{ color: 'var(--text-muted)' }}>API Cost</span>
                  </div>
                  <div className="text-2xl font-semibold" style={{ color: 'var(--text-primary)' }}>
                    {usageData.costStats ? formatCost(usageData.costStats.totalCost) : '$0.00'}
                  </div>
                  <div className="text-xs mt-1" style={{ color: '#22c55e' }}>
                    {usageData.costStats ? formatTokens(usageData.costStats.totalTokens) : '0'} tokens
                  </div>
                </div>
              </div>
            )}

            {/* Traffic Chart */}
            {usageData?.hitsByDay && usageData.hitsByDay.length > 0 && (
              <div className="p-6 rounded-xl" style={{ background: 'var(--bg-white)', border: '1px solid var(--border-light)' }}>
                <h2 className="text-lg font-medium mb-4" style={{ color: 'var(--text-primary)' }}>
                  Traffic Over Time
                </h2>
                <div className="h-48 flex items-end gap-1">
                  {usageData.hitsByDay.map((day, i) => {
                    const maxHits = Math.max(...usageData.hitsByDay.map(d => d.hits));
                    const height = maxHits > 0 ? (day.hits / maxHits) * 100 : 0;
                    return (
                      <div key={i} className="flex-1 flex flex-col items-center gap-1">
                        <div
                          className="w-full rounded-t transition-all hover:opacity-80"
                          style={{
                            height: `${height}%`,
                            minHeight: day.hits > 0 ? '4px' : '0',
                            background: 'var(--accent-sage)',
                          }}
                          title={`${day.date}: ${day.hits} hits, ${day.uniqueVisitors} visitors`}
                        />
                        {i % Math.ceil(usageData.hitsByDay.length / 7) === 0 && (
                          <span className="text-xs" style={{ color: 'var(--text-faint)' }}>
                            {new Date(day.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                          </span>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Visitors by Country */}
            {usageData?.visitorsByCountry && usageData.visitorsByCountry.length > 0 && (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                {/* World Map */}
                <div className="p-6 rounded-xl" style={{ background: 'var(--bg-white)', border: '1px solid var(--border-light)' }}>
                  <h2 className="text-lg font-medium mb-4 flex items-center gap-2" style={{ color: 'var(--text-primary)' }}>
                    <Globe className="w-5 h-5" style={{ color: 'var(--accent-sage)' }} />
                    Visitor Locations
                  </h2>
                  <div className="relative bg-stone-100 rounded-lg overflow-hidden" style={{ aspectRatio: '2/1' }}>
                    {/* Simple world map background */}
                    <svg viewBox="0 0 360 180" className="w-full h-full" style={{ background: 'var(--bg-warm)' }}>
                      {/* Simplified continent outlines */}
                      <path d="M80,40 Q100,30 120,35 L140,40 Q160,45 150,60 L130,70 Q110,75 90,65 L80,50 Z" fill="var(--border-light)" />
                      <path d="M150,45 Q180,40 210,50 L240,55 Q260,60 250,80 L220,90 Q190,95 160,85 L145,70 Z" fill="var(--border-light)" />
                      <path d="M250,50 Q280,45 310,55 L330,65 Q340,80 320,100 L290,110 Q260,115 240,100 L235,80 Z" fill="var(--border-light)" />
                      <path d="M85,90 Q100,85 115,95 L120,110 Q115,130 95,135 L80,125 Q75,110 85,90 Z" fill="var(--border-light)" />
                      <path d="M155,95 Q170,100 180,115 L175,135 Q160,145 145,135 L140,115 Q145,100 155,95 Z" fill="var(--border-light)" />
                      <path d="M280,130 Q310,125 330,140 L325,160 Q300,170 275,160 L270,145 Z" fill="var(--border-light)" />

                      {/* Visitor location dots */}
                      {usageData.visitorLocations?.map((loc, i) => {
                        // Convert lat/lon to SVG coordinates (simple equirectangular)
                        const x = ((loc.lon + 180) / 360) * 360;
                        const y = ((90 - loc.lat) / 180) * 180;
                        const size = Math.min(8, Math.max(3, Math.log(loc.hits + 1) * 2));
                        return (
                          <g key={i}>
                            <circle
                              cx={x}
                              cy={y}
                              r={size}
                              fill="var(--accent-rust)"
                              opacity={0.7}
                            >
                              <title>{`${loc.city}, ${loc.country}: ${loc.hits} hits`}</title>
                            </circle>
                            <circle
                              cx={x}
                              cy={y}
                              r={size + 3}
                              fill="var(--accent-rust)"
                              opacity={0.2}
                            />
                          </g>
                        );
                      })}
                    </svg>
                  </div>
                </div>

                {/* Country List */}
                <div className="p-6 rounded-xl" style={{ background: 'var(--bg-white)', border: '1px solid var(--border-light)' }}>
                  <h2 className="text-lg font-medium mb-4 flex items-center gap-2" style={{ color: 'var(--text-primary)' }}>
                    <MapPin className="w-5 h-5" style={{ color: 'var(--accent-rust)' }} />
                    Visitors by Country
                  </h2>
                  <div className="space-y-3 max-h-64 overflow-y-auto">
                    {usageData.visitorsByCountry.slice(0, 10).map((c, i) => {
                      const total = usageData.visitorsByCountry.reduce((a, b) => a + b.hits, 0);
                      const pct = total > 0 ? (c.hits / total) * 100 : 0;
                      return (
                        <div key={i}>
                          <div className="flex justify-between text-sm mb-1">
                            <span style={{ color: 'var(--text-primary)' }}>
                              {c.country}
                            </span>
                            <span style={{ color: 'var(--text-muted)' }}>
                              {formatNumber(c.hits)} hits • {c.visitors} visitors
                            </span>
                          </div>
                          <div className="h-2 rounded-full overflow-hidden" style={{ background: 'var(--bg-warm)' }}>
                            <div
                              className="h-full rounded-full"
                              style={{ width: `${pct}%`, background: 'var(--accent-rust)' }}
                            />
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>
            )}

            {/* Model & Prompt Usage */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              {usageData?.modelUsage && usageData.modelUsage.length > 0 && (
                <div className="p-6 rounded-xl" style={{ background: 'var(--bg-white)', border: '1px solid var(--border-light)' }}>
                  <h2 className="text-lg font-medium mb-4" style={{ color: 'var(--text-primary)' }}>
                    Model Usage
                  </h2>
                  <div className="space-y-3">
                    {usageData.modelUsage.map((m, i) => {
                      const total = usageData.modelUsage.reduce((a, b) => a + b.count, 0);
                      const pct = total > 0 ? (m.count / total) * 100 : 0;
                      return (
                        <div key={i}>
                          <div className="flex justify-between text-sm mb-1">
                            <span style={{ color: 'var(--text-primary)' }}>{m.model}</span>
                            <span style={{ color: 'var(--text-muted)' }}>{formatNumber(m.count)}</span>
                          </div>
                          <div className="h-2 rounded-full overflow-hidden" style={{ background: 'var(--bg-warm)' }}>
                            <div
                              className="h-full rounded-full"
                              style={{ width: `${pct}%`, background: 'var(--accent-sage)' }}
                            />
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {usageData?.promptUsage && usageData.promptUsage.length > 0 && (
                <div className="p-6 rounded-xl" style={{ background: 'var(--bg-white)', border: '1px solid var(--border-light)' }}>
                  <h2 className="text-lg font-medium mb-4" style={{ color: 'var(--text-primary)' }}>
                    Prompt Usage
                  </h2>
                  <div className="space-y-3">
                    {usageData.promptUsage.slice(0, 5).map((p, i) => {
                      const total = usageData.promptUsage.reduce((a, b) => a + b.count, 0);
                      const pct = total > 0 ? (p.count / total) * 100 : 0;
                      return (
                        <div key={i}>
                          <div className="flex justify-between text-sm mb-1">
                            <span className="truncate" style={{ color: 'var(--text-primary)' }}>{p.prompt}</span>
                            <span style={{ color: 'var(--text-muted)' }}>{formatNumber(p.count)}</span>
                          </div>
                          <div className="h-2 rounded-full overflow-hidden" style={{ background: 'var(--bg-warm)' }}>
                            <div
                              className="h-full rounded-full"
                              style={{ width: `${pct}%`, background: 'var(--accent-rust)' }}
                            />
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>

            {/* Cost Breakdown */}
            {usageData?.costStats && usageData.costStats.costByAction.length > 0 && (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                {/* Cost by Action */}
                <div className="p-6 rounded-xl" style={{ background: 'var(--bg-white)', border: '1px solid var(--border-light)' }}>
                  <h2 className="text-lg font-medium mb-4 flex items-center gap-2" style={{ color: 'var(--text-primary)' }}>
                    <DollarSign className="w-5 h-5" style={{ color: '#22c55e' }} />
                    Cost by Action
                  </h2>
                  <div className="space-y-3">
                    {usageData.costStats.costByAction.map((a, i) => {
                      const totalCost = usageData.costStats!.costByAction.reduce((acc, b) => acc + b.cost, 0);
                      const pct = totalCost > 0 ? (a.cost / totalCost) * 100 : 0;
                      return (
                        <div key={i}>
                          <div className="flex justify-between text-sm mb-1">
                            <span className="capitalize" style={{ color: 'var(--text-primary)' }}>{a.action}</span>
                            <span style={{ color: 'var(--text-muted)' }}>
                              {formatCost(a.cost)} ({a.count} calls)
                            </span>
                          </div>
                          <div className="h-2 rounded-full overflow-hidden" style={{ background: 'var(--bg-warm)' }}>
                            <div
                              className="h-full rounded-full"
                              style={{ width: `${pct}%`, background: '#22c55e' }}
                            />
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>

                {/* Cost Over Time */}
                {usageData.costStats.costByDay.length > 0 && (
                  <div className="p-6 rounded-xl" style={{ background: 'var(--bg-white)', border: '1px solid var(--border-light)' }}>
                    <h2 className="text-lg font-medium mb-4 flex items-center gap-2" style={{ color: 'var(--text-primary)' }}>
                      <Coins className="w-5 h-5" style={{ color: '#22c55e' }} />
                      Daily Cost
                    </h2>
                    <div className="h-48 flex items-end gap-1">
                      {usageData.costStats.costByDay.map((day, i) => {
                        const maxCost = Math.max(...usageData.costStats!.costByDay.map(d => d.cost));
                        const height = maxCost > 0 ? (day.cost / maxCost) * 100 : 0;
                        return (
                          <div key={i} className="flex-1 flex flex-col items-center gap-1">
                            <div
                              className="w-full rounded-t transition-all hover:opacity-80"
                              style={{
                                height: `${height}%`,
                                minHeight: day.cost > 0 ? '4px' : '0',
                                background: '#22c55e',
                              }}
                              title={`${day.date}: ${formatCost(day.cost)} (${formatTokens(day.tokens)} tokens)`}
                            />
                            {i % Math.ceil(usageData.costStats!.costByDay.length / 7) === 0 && (
                              <span className="text-xs" style={{ color: 'var(--text-faint)' }}>
                                {new Date(day.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                              </span>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* Recent Books */}
            {usageData?.recentBooks && usageData.recentBooks.length > 0 && (
              <div className="p-6 rounded-xl" style={{ background: 'var(--bg-white)', border: '1px solid var(--border-light)' }}>
                <h2 className="text-lg font-medium mb-4" style={{ color: 'var(--text-primary)' }}>
                  Recently Added Books
                </h2>
                <div className="space-y-3">
                  {usageData.recentBooks.map((book, i) => (
                    <div key={i} className="flex items-center justify-between py-2" style={{ borderBottom: i < usageData.recentBooks.length - 1 ? '1px solid var(--border-light)' : 'none' }}>
                      <div>
                        <div className="font-medium" style={{ color: 'var(--text-primary)' }}>{book.title}</div>
                        <div className="text-sm" style={{ color: 'var(--text-muted)' }}>{book.author}</div>
                      </div>
                      <div className="text-right">
                        <div className="text-sm" style={{ color: 'var(--text-muted)' }}>{book.pages_count || 0} pages</div>
                        <div className="text-xs" style={{ color: 'var(--text-faint)' }}>
                          {new Date(book.created_at).toLocaleDateString()}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        ) : activeTab === 'performance' ? (
          /* Performance Tab */
          <div className="space-y-6">
            {perfData?.stats && perfData.stats.length > 0 ? (
              <>
                <h2 className="text-lg font-medium" style={{ color: 'var(--text-primary)' }}>
                  Performance Metrics
                </h2>
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                  {perfData.stats.map((stat) => (
                    <div
                      key={stat.name}
                      className="p-4 rounded-xl"
                      style={{ background: 'var(--bg-white)', border: '1px solid var(--border-light)' }}
                    >
                      <div className="flex items-start justify-between mb-3">
                        <h3 className="text-sm font-medium truncate" style={{ color: 'var(--text-primary)' }}>
                          {stat.name.replace(/_/g, ' ')}
                        </h3>
                        <span className="text-xs px-2 py-0.5 rounded-full" style={{ background: 'var(--bg-warm)', color: 'var(--text-muted)' }}>
                          {stat.count} calls
                        </span>
                      </div>
                      <div className="grid grid-cols-3 gap-2 text-center">
                        <div>
                          <div className="text-xs mb-1" style={{ color: 'var(--text-muted)' }}>Avg</div>
                          <div className="text-sm font-medium" style={{ color: 'var(--accent-sage)' }}>
                            {formatDuration(stat.avg)}
                          </div>
                        </div>
                        <div>
                          <div className="text-xs mb-1" style={{ color: 'var(--text-muted)' }}>P50</div>
                          <div className="text-sm font-medium" style={{ color: 'var(--text-secondary)' }}>
                            {stat.p50 ? formatDuration(stat.p50) : '-'}
                          </div>
                        </div>
                        <div>
                          <div className="text-xs mb-1" style={{ color: 'var(--text-muted)' }}>P95</div>
                          <div className="text-sm font-medium" style={{ color: 'var(--accent-rust)' }}>
                            {stat.p95 ? formatDuration(stat.p95) : '-'}
                          </div>
                        </div>
                      </div>
                      <div className="mt-3 pt-3 flex justify-between text-xs" style={{ borderTop: '1px solid var(--border-light)', color: 'var(--text-faint)' }}>
                        <span>Min: {formatDuration(stat.min)}</span>
                        <span>Max: {formatDuration(stat.max)}</span>
                      </div>
                    </div>
                  ))}
                </div>

                {/* Recent Samples */}
                {perfData.recentSamples && perfData.recentSamples.length > 0 && (
                  <div className="mt-8">
                    <h2 className="text-lg font-medium mb-4" style={{ color: 'var(--text-primary)' }}>
                      Recent Activity
                    </h2>
                    <div className="rounded-xl overflow-hidden" style={{ background: 'var(--bg-white)', border: '1px solid var(--border-light)' }}>
                      <table className="w-full text-sm">
                        <thead>
                          <tr style={{ background: 'var(--bg-warm)' }}>
                            <th className="px-4 py-2 text-left font-medium" style={{ color: 'var(--text-muted)' }}>Metric</th>
                            <th className="px-4 py-2 text-left font-medium" style={{ color: 'var(--text-muted)' }}>Duration</th>
                            <th className="px-4 py-2 text-left font-medium" style={{ color: 'var(--text-muted)' }}>Time</th>
                            <th className="px-4 py-2 text-left font-medium" style={{ color: 'var(--text-muted)' }}>Details</th>
                          </tr>
                        </thead>
                        <tbody>
                          {perfData.recentSamples.map((sample, i) => (
                            <tr key={i} style={{ borderTop: '1px solid var(--border-light)' }}>
                              <td className="px-4 py-2" style={{ color: 'var(--text-primary)' }}>
                                {sample.name.replace(/_/g, ' ')}
                              </td>
                              <td className="px-4 py-2 font-mono" style={{ color: 'var(--accent-sage)' }}>
                                {formatDuration(sample.duration)}
                              </td>
                              <td className="px-4 py-2" style={{ color: 'var(--text-muted)' }}>
                                {formatTime(sample.timestamp)}
                              </td>
                              <td className="px-4 py-2 text-xs" style={{ color: 'var(--text-faint)' }}>
                                {sample.metadata ? Object.entries(sample.metadata).slice(0, 2).map(([k, v]) => `${k}: ${v}`).join(', ') : '-'}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}
              </>
            ) : (
              <div className="text-center py-12" style={{ color: 'var(--text-muted)' }}>
                <Clock className="w-12 h-12 mx-auto mb-4 opacity-30" />
                <p>No performance data yet</p>
                <p className="text-sm mt-1">Metrics will appear here as the site is used</p>
              </div>
            )}
          </div>
        ) : activeTab === 'logs' ? (
          /* Logs Tab */
          <div className="space-y-6">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-medium flex items-center gap-2" style={{ color: 'var(--text-primary)' }}>
                <ListChecks className="w-5 h-5" style={{ color: 'var(--accent-violet)' }} />
                Batch Job History
              </h2>
              <span className="text-sm" style={{ color: 'var(--text-muted)' }}>
                {jobLogs.length} jobs
              </span>
            </div>

            {jobLogs.length > 0 ? (
              <div className="rounded-xl overflow-hidden" style={{ background: 'var(--bg-white)', border: '1px solid var(--border-light)' }}>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr style={{ background: 'var(--bg-warm)' }}>
                        <th className="px-4 py-3 text-left font-medium" style={{ color: 'var(--text-muted)' }}>Status</th>
                        <th className="px-4 py-3 text-left font-medium" style={{ color: 'var(--text-muted)' }}>Type</th>
                        <th className="px-4 py-3 text-left font-medium" style={{ color: 'var(--text-muted)' }}>Book</th>
                        <th className="px-4 py-3 text-left font-medium" style={{ color: 'var(--text-muted)' }}>Pages</th>
                        <th className="px-4 py-3 text-left font-medium" style={{ color: 'var(--text-muted)' }}>Model / Prompt</th>
                        <th className="px-4 py-3 text-left font-medium" style={{ color: 'var(--text-muted)' }}>Started</th>
                        <th className="px-4 py-3 text-left font-medium" style={{ color: 'var(--text-muted)' }}>Duration</th>
                      </tr>
                    </thead>
                    <tbody>
                      {jobLogs.map((job) => {
                        const startTime = job.started_at ? new Date(job.started_at) : new Date(job.created_at);
                        const endTime = job.completed_at ? new Date(job.completed_at) : new Date();
                        const durationMs = job.started_at ? endTime.getTime() - startTime.getTime() : 0;
                        const durationStr = durationMs > 0 ? formatDuration(durationMs) : '-';

                        return (
                          <tr key={job.id} style={{ borderTop: '1px solid var(--border-light)' }} className="hover:bg-stone-50 transition-colors">
                            <td className="px-4 py-3">
                              <div className="flex items-center gap-2">
                                {getStatusIcon(job.status)}
                                <span className="capitalize text-xs font-medium" style={{ color: getStatusColor(job.status) }}>
                                  {job.status}
                                </span>
                              </div>
                            </td>
                            <td className="px-4 py-3">
                              <span className="px-2 py-1 rounded-md text-xs font-medium" style={{ background: 'var(--bg-warm)', color: 'var(--text-primary)' }}>
                                {formatJobType(job.type)}
                              </span>
                            </td>
                            <td className="px-4 py-3 max-w-[200px]">
                              <div className="truncate" style={{ color: 'var(--text-primary)' }} title={job.book_title || '-'}>
                                {job.book_title || '-'}
                              </div>
                            </td>
                            <td className="px-4 py-3">
                              <div style={{ color: 'var(--text-primary)' }}>
                                {job.progress.completed}
                                <span style={{ color: 'var(--text-muted)' }}> / {job.progress.total}</span>
                              </div>
                              {job.progress.failed > 0 && (
                                <div className="text-xs" style={{ color: '#ef4444' }}>
                                  {job.progress.failed} failed
                                </div>
                              )}
                            </td>
                            <td className="px-4 py-3 text-xs">
                              <div style={{ color: 'var(--text-primary)' }}>{job.config.model || '-'}</div>
                              {job.config.prompt_name && (
                                <div style={{ color: 'var(--text-muted)' }}>{job.config.prompt_name}</div>
                              )}
                            </td>
                            <td className="px-4 py-3 text-xs" style={{ color: 'var(--text-muted)' }}>
                              {new Date(job.created_at).toLocaleDateString()}
                              <br />
                              {new Date(job.created_at).toLocaleTimeString()}
                            </td>
                            <td className="px-4 py-3 font-mono text-xs" style={{ color: 'var(--text-muted)' }}>
                              {job.status === 'processing' ? (
                                <span style={{ color: 'var(--accent-sage)' }}>In progress...</span>
                              ) : (
                                durationStr
                              )}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            ) : (
              <div className="text-center py-12" style={{ color: 'var(--text-muted)' }}>
                <ListChecks className="w-12 h-12 mx-auto mb-4 opacity-30" />
                <p>No batch jobs found</p>
                <p className="text-sm mt-1">Jobs will appear here when you run batch operations</p>
              </div>
            )}
          </div>
        ) : null}
      </main>
    </div>
  );
}
