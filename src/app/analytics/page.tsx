'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { ChevronLeft, RefreshCw, Clock, BookOpen, FileText, Languages, Users, Globe, DollarSign, Coins, ListChecks, CheckCircle, XCircle, Pause, Loader2, Database, HardDrive, Archive, BarChart3, Search, AlertTriangle } from 'lucide-react';
import { analytics, jobs } from '@/lib/api-client';
import { JobLog } from '@/lib/api-client';

interface MetricStat {
  name: string;
  count: number;
  avg: number;
  min: number;
  max: number;
  p50: number | null;
  p95: number | null;
}

interface SourceStat {
  source: string;
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
  sourceStats: SourceStat[];
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
  };
  modelUsage: Array<{ model: string; count: number }>;
  promptUsage: Array<{ prompt: string; count: number }>;
  recentBooks: Array<{ title: string; author: string; created_at: string; pages_count: number }>;
  costStats?: {
    totalCost: number;
    totalTokens: number;
    costByDay: Array<{ date: string; cost: number; tokens: number }>;
    costByAction: Array<{ action: string; cost: number; count: number }>;
  };
  collectionStats?: {
    blobStorage: {
      pagesWithCroppedPhoto: number;
      pagesWithArchivedPhoto: number;
      totalBlobPages: number;
      booksWithSplitPages: number;
    };
    byLanguage: Array<{ language: string; count: number }>;
    byCategory: Array<{ category: string; count: number }>;
    byImageSource: Array<{ provider: string; count: number }>;
  };
  pipelineHealth?: {
    splitting: {
      needsSplitting: number;
      alreadySplit: number;
      noSplitNeeded: number;
      unchecked: number;
    };
    enrichment: {
      booksWithSummary: number;
      booksWithIndex: number;
      booksWithChapters: number;
      booksWithEditions: number;
      fullyTranslated: number;
    };
    images: {
      pagesWithDetectedImages: number;
      totalDetectedImages: number;
    };
    batchJobs: {
      pending: number;
      processing: number;
      byType: Array<{ type: string; count: number }>;
    };
  };
}

interface VercelAnalytics {
  topPages?: Array<{ path: string; count: number }>;
  topReferrers?: Array<{ referrer: string; count: number }>;
  topCountries?: Array<{ country: string; count: number }>;
  totalVisitors?: number;
  totalPageviews?: number;
  error?: string;
}

export default function AnalyticsPage() {
  const [perfData, setPerfData] = useState<PerformanceData | null>(null);
  const [usageData, setUsageData] = useState<UsageData | null>(null);
  const [vercelData, setVercelData] = useState<VercelAnalytics | null>(null);
  const [searchData, setSearchData] = useState<any | null>(null);
  const [jobLogs, setJobLogs] = useState<JobLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [hours, setHours] = useState(24);
  const [days, setDays] = useState(30);
  const [jobLimit, setJobLimit] = useState(50);
  const [jobTypeFilter, setJobTypeFilter] = useState<string>('');
  const [jobStatusFilter, setJobStatusFilter] = useState<string>('');
  const [activeTab, setActiveTab] = useState<'usage' | 'performance' | 'logs' | 'search' | 'traffic'>('usage');
  const [error, setError] = useState<string | null>(null);

  const fetchUsageData = async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await analytics.usage(days);
      setUsageData(data);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Unknown error');
    } finally {
      setLoading(false);
    }
  };

  const fetchPerfData = async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await analytics.loading(hours);
      setPerfData(data);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Unknown error');
    } finally {
      setLoading(false);
    }
  };

  const fetchTrafficData = async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await analytics.traffic();
      setVercelData(data);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Unknown error');
    } finally {
      setLoading(false);
    }
  };

  const fetchSearchData = async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await analytics.search(days);
      setSearchData(data);
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
      const data = await jobs.list({
        limit: jobLimit,
        type: jobTypeFilter || undefined,
        status: jobStatusFilter as any || undefined,
      });

      setJobLogs(data.jobs || []);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Unknown error');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (activeTab === 'usage') {
      fetchUsageData();
    }
  }, [days, activeTab]);

  useEffect(() => {
    if (activeTab === 'performance') {
      fetchPerfData();
    }
  }, [hours, activeTab]);

  useEffect(() => {
    if (activeTab === 'logs') {
      fetchJobLogs();
    }
  }, [activeTab, jobLimit, jobTypeFilter, jobStatusFilter]);

  useEffect(() => {
    if (activeTab === 'search') {
      fetchSearchData();
    }
  }, [days, activeTab]);

  useEffect(() => {
    if (activeTab === 'traffic') {
      fetchTrafficData();
    }
  }, [activeTab]);

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

  const handleRefresh = () => {
    if (activeTab === 'usage') {
      fetchUsageData();
    } else if (activeTab === 'performance') {
      fetchPerfData();
    } else if (activeTab === 'logs') {
      fetchJobLogs();
    } else if (activeTab === 'search') {
      fetchSearchData();
    } else if (activeTab === 'traffic') {
      fetchTrafficData();
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
              <button
                onClick={() => setActiveTab('search')}
                className={`px-3 py-1.5 rounded-md text-sm font-medium transition-all ${activeTab === 'search' ? 'shadow-sm' : ''}`}
                style={{
                  background: activeTab === 'search' ? 'var(--bg-white)' : 'transparent',
                  color: activeTab === 'search' ? 'var(--text-primary)' : 'var(--text-muted)',
                }}
              >
                Search
              </button>
              <button
                onClick={() => setActiveTab('traffic')}
                className={`px-3 py-1.5 rounded-md text-sm font-medium transition-all ${activeTab === 'traffic' ? 'shadow-sm' : ''}`}
                style={{
                  background: activeTab === 'traffic' ? 'var(--bg-white)' : 'transparent',
                  color: activeTab === 'traffic' ? 'var(--text-primary)' : 'var(--text-muted)',
                }}
              >
                Traffic
              </button>
            </div>

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
              onClick={handleRefresh}
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

                <a href="https://analytics.google.com" target="_blank" rel="noopener noreferrer" className="p-4 rounded-xl block hover:opacity-80 transition-opacity" style={{ background: 'var(--bg-white)', border: '1px solid var(--border-light)' }}>
                  <div className="flex items-center gap-2 mb-2">
                    <Users className="w-4 h-4" style={{ color: 'var(--text-muted)' }} />
                    <span className="text-xs font-medium uppercase" style={{ color: 'var(--text-muted)' }}>Traffic</span>
                  </div>
                  <div className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>
                    Google Analytics
                  </div>
                  <div className="text-xs mt-1" style={{ color: 'var(--accent-sage)' }}>
                    View traffic data &rarr;
                  </div>
                </a>

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

            {/* Collection Overview - Processing Pipeline */}
            {usageData?.collectionStats && (
              <div className="p-6 rounded-xl" style={{ background: 'var(--bg-white)', border: '1px solid var(--border-light)' }}>
                <h2 className="text-lg font-medium mb-4 flex items-center gap-2" style={{ color: 'var(--text-primary)' }}>
                  <Database className="w-5 h-5" style={{ color: 'var(--accent-violet)' }} />
                  Collection Processing Pipeline
                </h2>

                {/* Pipeline Progress Bars */}
                <div className="space-y-4">
                  {/* Total Pages Bar */}
                  <div>
                    <div className="flex justify-between text-sm mb-2">
                      <span style={{ color: 'var(--text-primary)' }}>Total Pages</span>
                      <span style={{ color: 'var(--text-muted)' }}>{formatNumber(usageData.summary.totalPages)}</span>
                    </div>
                    <div className="h-8 rounded-lg overflow-hidden flex" style={{ background: 'var(--bg-warm)' }}>
                      {/* Archived to Blob */}
                      <div
                        className="h-full flex items-center justify-center text-xs font-medium text-white"
                        style={{
                          width: `${(usageData.collectionStats.blobStorage.totalBlobPages / usageData.summary.totalPages) * 100}%`,
                          background: '#22c55e',
                          minWidth: usageData.collectionStats.blobStorage.totalBlobPages > 0 ? '60px' : '0',
                        }}
                        title={`${formatNumber(usageData.collectionStats.blobStorage.totalBlobPages)} pages archived to Vercel Blob`}
                      >
                        {((usageData.collectionStats.blobStorage.totalBlobPages / usageData.summary.totalPages) * 100).toFixed(0)}% Blob
                      </div>
                      {/* Not archived */}
                      <div
                        className="h-full flex items-center justify-center text-xs"
                        style={{
                          flex: 1,
                          color: 'var(--text-muted)',
                        }}
                      >
                        {formatNumber(usageData.summary.totalPages - usageData.collectionStats.blobStorage.totalBlobPages)} from external sources
                      </div>
                    </div>
                  </div>

                  {/* OCR Progress Bar */}
                  <div>
                    <div className="flex justify-between text-sm mb-2">
                      <span style={{ color: 'var(--text-primary)' }}>OCR Progress</span>
                      <span style={{ color: 'var(--text-muted)' }}>{formatNumber(usageData.summary.pagesWithOcr)} / {formatNumber(usageData.summary.totalPages)}</span>
                    </div>
                    <div className="h-6 rounded-lg overflow-hidden flex" style={{ background: 'var(--bg-warm)' }}>
                      <div
                        className="h-full flex items-center justify-center text-xs font-medium text-white"
                        style={{
                          width: `${usageData.summary.ocrPercentage}%`,
                          background: 'var(--accent-sage)',
                          minWidth: usageData.summary.ocrPercentage > 0 ? '40px' : '0',
                        }}
                      >
                        {usageData.summary.ocrPercentage}%
                      </div>
                    </div>
                  </div>

                  {/* Translation Progress Bar */}
                  <div>
                    <div className="flex justify-between text-sm mb-2">
                      <span style={{ color: 'var(--text-primary)' }}>Translation Progress</span>
                      <span style={{ color: 'var(--text-muted)' }}>{formatNumber(usageData.summary.pagesWithTranslation)} / {formatNumber(usageData.summary.totalPages)}</span>
                    </div>
                    <div className="h-6 rounded-lg overflow-hidden flex" style={{ background: 'var(--bg-warm)' }}>
                      <div
                        className="h-full flex items-center justify-center text-xs font-medium text-white"
                        style={{
                          width: `${usageData.summary.translationPercentage}%`,
                          background: 'var(--accent-rust)',
                          minWidth: usageData.summary.translationPercentage > 0 ? '40px' : '0',
                        }}
                      >
                        {usageData.summary.translationPercentage}%
                      </div>
                    </div>
                  </div>
                </div>

                {/* Storage Breakdown Cards */}
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mt-6">
                  <div className="p-3 rounded-lg" style={{ background: 'var(--bg-warm)' }}>
                    <div className="flex items-center gap-2 mb-1">
                      <Archive className="w-4 h-4" style={{ color: '#22c55e' }} />
                      <span className="text-xs font-medium" style={{ color: 'var(--text-muted)' }}>Archived</span>
                    </div>
                    <div className="text-lg font-semibold" style={{ color: 'var(--text-primary)' }}>
                      {formatNumber(usageData.collectionStats.blobStorage.pagesWithArchivedPhoto)}
                    </div>
                    <div className="text-xs" style={{ color: 'var(--text-muted)' }}>full pages</div>
                  </div>
                  <div className="p-3 rounded-lg" style={{ background: 'var(--bg-warm)' }}>
                    <div className="flex items-center gap-2 mb-1">
                      <HardDrive className="w-4 h-4" style={{ color: 'var(--accent-violet)' }} />
                      <span className="text-xs font-medium" style={{ color: 'var(--text-muted)' }}>Cropped</span>
                    </div>
                    <div className="text-lg font-semibold" style={{ color: 'var(--text-primary)' }}>
                      {formatNumber(usageData.collectionStats.blobStorage.pagesWithCroppedPhoto)}
                    </div>
                    <div className="text-xs" style={{ color: 'var(--text-muted)' }}>split pages</div>
                  </div>
                  <div className="p-3 rounded-lg" style={{ background: 'var(--bg-warm)' }}>
                    <div className="flex items-center gap-2 mb-1">
                      <BookOpen className="w-4 h-4" style={{ color: 'var(--accent-sage)' }} />
                      <span className="text-xs font-medium" style={{ color: 'var(--text-muted)' }}>Split Books</span>
                    </div>
                    <div className="text-lg font-semibold" style={{ color: 'var(--text-primary)' }}>
                      {formatNumber(usageData.collectionStats.blobStorage.booksWithSplitPages)}
                    </div>
                    <div className="text-xs" style={{ color: 'var(--text-muted)' }}>books processed</div>
                  </div>
                  <div className="p-3 rounded-lg" style={{ background: 'var(--bg-warm)' }}>
                    <div className="flex items-center gap-2 mb-1">
                      <Database className="w-4 h-4" style={{ color: 'var(--accent-rust)' }} />
                      <span className="text-xs font-medium" style={{ color: 'var(--text-muted)' }}>Total Blob</span>
                    </div>
                    <div className="text-lg font-semibold" style={{ color: 'var(--text-primary)' }}>
                      {formatNumber(usageData.collectionStats.blobStorage.totalBlobPages)}
                    </div>
                    <div className="text-xs" style={{ color: 'var(--text-muted)' }}>
                      {((usageData.collectionStats.blobStorage.totalBlobPages / usageData.summary.totalPages) * 100).toFixed(1)}% of collection
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* Pipeline Health */}
            {usageData?.pipelineHealth && (
              <div className="p-6 rounded-xl" style={{ background: 'var(--bg-white)', border: '1px solid var(--border-light)' }}>
                <h2 className="text-lg font-medium mb-4 flex items-center gap-2" style={{ color: 'var(--text-primary)' }}>
                  <ListChecks className="w-5 h-5" style={{ color: 'var(--accent-violet)' }} />
                  Pipeline Health
                </h2>

                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
                  {/* Split Detection */}
                  <div className="space-y-3">
                    <h3 className="text-sm font-medium" style={{ color: 'var(--text-muted)' }}>Split Detection</h3>
                    <div className="space-y-2">
                      {[
                        { label: 'Needs Splitting', value: usageData.pipelineHealth.splitting.needsSplitting, color: '#f59e0b' },
                        { label: 'Already Split', value: usageData.pipelineHealth.splitting.alreadySplit, color: '#22c55e' },
                        { label: 'No Split Needed', value: usageData.pipelineHealth.splitting.noSplitNeeded, color: 'var(--accent-sage)' },
                        { label: 'Unchecked', value: usageData.pipelineHealth.splitting.unchecked, color: 'var(--text-muted)' },
                      ].map((item, i) => (
                        <div key={i} className="flex justify-between items-center text-sm">
                          <span style={{ color: 'var(--text-primary)' }}>{item.label}</span>
                          <span className="font-medium px-2 py-0.5 rounded" style={{ background: 'var(--bg-warm)', color: item.color }}>
                            {formatNumber(item.value)}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>

                  {/* Content Enrichment */}
                  <div className="space-y-3">
                    <h3 className="text-sm font-medium" style={{ color: 'var(--text-muted)' }}>Content Enrichment</h3>
                    <div className="space-y-2">
                      {[
                        { label: 'Fully Translated', value: usageData.pipelineHealth.enrichment.fullyTranslated, color: '#22c55e' },
                        { label: 'With Summary', value: usageData.pipelineHealth.enrichment.booksWithSummary, color: 'var(--accent-sage)' },
                        { label: 'With Index', value: usageData.pipelineHealth.enrichment.booksWithIndex, color: 'var(--accent-violet)' },
                        { label: 'With Chapters', value: usageData.pipelineHealth.enrichment.booksWithChapters, color: 'var(--accent-rust)' },
                        { label: 'With Editions', value: usageData.pipelineHealth.enrichment.booksWithEditions, color: '#3b82f6' },
                      ].map((item, i) => (
                        <div key={i} className="flex justify-between items-center text-sm">
                          <span style={{ color: 'var(--text-primary)' }}>{item.label}</span>
                          <span className="font-medium px-2 py-0.5 rounded" style={{ background: 'var(--bg-warm)', color: item.color }}>
                            {formatNumber(item.value)}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>

                  {/* Detected Images */}
                  <div className="space-y-3">
                    <h3 className="text-sm font-medium" style={{ color: 'var(--text-muted)' }}>Image Detection</h3>
                    <div className="space-y-2">
                      <div className="flex justify-between items-center text-sm">
                        <span style={{ color: 'var(--text-primary)' }}>Pages with Images</span>
                        <span className="font-medium px-2 py-0.5 rounded" style={{ background: 'var(--bg-warm)', color: 'var(--accent-violet)' }}>
                          {formatNumber(usageData.pipelineHealth.images.pagesWithDetectedImages)}
                        </span>
                      </div>
                      <div className="flex justify-between items-center text-sm">
                        <span style={{ color: 'var(--text-primary)' }}>Total Images Found</span>
                        <span className="font-medium px-2 py-0.5 rounded" style={{ background: 'var(--bg-warm)', color: 'var(--accent-rust)' }}>
                          {formatNumber(usageData.pipelineHealth.images.totalDetectedImages)}
                        </span>
                      </div>
                    </div>
                  </div>

                  {/* Active Batch Jobs */}
                  <div className="space-y-3">
                    <h3 className="text-sm font-medium" style={{ color: 'var(--text-muted)' }}>Active Batch Jobs</h3>
                    <div className="space-y-2">
                      <div className="flex justify-between items-center text-sm">
                        <span style={{ color: 'var(--text-primary)' }}>Pending</span>
                        <span className="font-medium px-2 py-0.5 rounded" style={{ background: 'var(--bg-warm)', color: '#f59e0b' }}>
                          {formatNumber(usageData.pipelineHealth.batchJobs.pending)}
                        </span>
                      </div>
                      <div className="flex justify-between items-center text-sm">
                        <span style={{ color: 'var(--text-primary)' }}>Processing</span>
                        <span className="font-medium px-2 py-0.5 rounded" style={{ background: 'var(--bg-warm)', color: 'var(--accent-sage)' }}>
                          {formatNumber(usageData.pipelineHealth.batchJobs.processing)}
                        </span>
                      </div>
                      {usageData.pipelineHealth.batchJobs.byType.length > 0 && (
                        <div className="pt-2 border-t" style={{ borderColor: 'var(--border-light)' }}>
                          {usageData.pipelineHealth.batchJobs.byType.map((job, i) => (
                            <div key={i} className="flex justify-between items-center text-xs mt-1">
                              <span className="capitalize" style={{ color: 'var(--text-muted)' }}>{job.type}</span>
                              <span style={{ color: 'var(--text-primary)' }}>{job.count}</span>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* Cost to Complete */}
            {usageData?.summary && usageData?.costStats && usageData.costStats.costByAction.length > 0 && (() => {
              const ocrAction = usageData.costStats.costByAction.find(a => a.action === 'ocr');
              const translationAction = usageData.costStats.costByAction.find(a => a.action === 'translation');

              // Cost per page (from tracked data, fallback to estimates)
              const ocrCostPerPage = ocrAction && ocrAction.count > 0
                ? ocrAction.cost / ocrAction.count
                : 0.00158;
              const translationCostPerPage = translationAction && translationAction.count > 0
                ? translationAction.cost / translationAction.count
                : 0.00241;

              // Remaining work
              const pagesNeedingOcr = usageData.summary.totalPages - usageData.summary.pagesWithOcr;
              const pagesNeedingTranslation = usageData.summary.totalPages - usageData.summary.pagesWithTranslation;

              // Cost estimates (realtime)
              const ocrCostRealtime = pagesNeedingOcr * ocrCostPerPage;
              const translationCostRealtime = pagesNeedingTranslation * translationCostPerPage;
              const totalRealtime = ocrCostRealtime + translationCostRealtime;

              // Batch API is 50% cheaper
              const ocrCostBatch = ocrCostRealtime * 0.5;
              const translationCostBatch = translationCostRealtime * 0.5;
              const totalBatch = ocrCostBatch + translationCostBatch;

              // Time estimate (roughly 1000 pages/hour with batch)
              const ocrHours = pagesNeedingOcr / 1000;
              const translationHours = pagesNeedingTranslation / 1000;
              const totalDays = Math.ceil((ocrHours + translationHours) / 24);

              return (
                <div className="p-6 rounded-xl" style={{ background: 'var(--bg-white)', border: '1px solid var(--border-light)' }}>
                  <h2 className="text-lg font-medium mb-4 flex items-center gap-2" style={{ color: 'var(--text-primary)' }}>
                    <Coins className="w-5 h-5" style={{ color: '#22c55e' }} />
                    Cost to Complete
                  </h2>

                  <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                    {/* Remaining Work */}
                    <div className="space-y-3">
                      <h3 className="text-sm font-medium" style={{ color: 'var(--text-muted)' }}>Remaining Work</h3>
                      <div className="space-y-2">
                        <div className="flex justify-between items-center text-sm">
                          <span style={{ color: 'var(--text-primary)' }}>Pages need OCR</span>
                          <span className="font-medium" style={{ color: 'var(--accent-sage)' }}>
                            {formatNumber(pagesNeedingOcr)}
                          </span>
                        </div>
                        <div className="flex justify-between items-center text-sm">
                          <span style={{ color: 'var(--text-primary)' }}>Pages need translation</span>
                          <span className="font-medium" style={{ color: 'var(--accent-rust)' }}>
                            {formatNumber(pagesNeedingTranslation)}
                          </span>
                        </div>
                      </div>
                    </div>

                    {/* Batch API Costs (Recommended) */}
                    <div className="space-y-3">
                      <h3 className="text-sm font-medium flex items-center gap-2" style={{ color: 'var(--text-muted)' }}>
                        Batch API <span className="text-xs px-1.5 py-0.5 rounded" style={{ background: '#dcfce7', color: '#16a34a' }}>50% off</span>
                      </h3>
                      <div className="space-y-2">
                        <div className="flex justify-between items-center text-sm">
                          <span style={{ color: 'var(--text-primary)' }}>OCR</span>
                          <span className="font-medium" style={{ color: 'var(--text-primary)' }}>
                            {formatCost(ocrCostBatch)}
                          </span>
                        </div>
                        <div className="flex justify-between items-center text-sm">
                          <span style={{ color: 'var(--text-primary)' }}>Translation</span>
                          <span className="font-medium" style={{ color: 'var(--text-primary)' }}>
                            {formatCost(translationCostBatch)}
                          </span>
                        </div>
                        <div className="flex justify-between items-center text-sm pt-2 border-t" style={{ borderColor: 'var(--border-light)' }}>
                          <span className="font-medium" style={{ color: 'var(--text-primary)' }}>Total</span>
                          <span className="font-bold text-lg" style={{ color: '#22c55e' }}>
                            {formatCost(totalBatch)}
                          </span>
                        </div>
                      </div>
                    </div>

                    {/* Time & Realtime Cost */}
                    <div className="space-y-3">
                      <h3 className="text-sm font-medium" style={{ color: 'var(--text-muted)' }}>Estimates</h3>
                      <div className="space-y-2">
                        <div className="flex justify-between items-center text-sm">
                          <span style={{ color: 'var(--text-primary)' }}>Time (sequential)</span>
                          <span className="font-medium" style={{ color: 'var(--accent-violet)' }}>
                            ~{totalDays} days
                          </span>
                        </div>
                        <div className="flex justify-between items-center text-sm">
                          <span style={{ color: 'var(--text-primary)' }}>Realtime API cost</span>
                          <span className="font-medium" style={{ color: 'var(--text-muted)' }}>
                            {formatCost(totalRealtime)}
                          </span>
                        </div>
                        <div className="text-xs pt-2" style={{ color: 'var(--text-faint)' }}>
                          Based on ${ocrCostPerPage.toFixed(4)}/pg OCR, ${translationCostPerPage.toFixed(4)}/pg translate
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              );
            })()}

            {/* Collection Breakdown Charts */}
            {usageData?.collectionStats && (
              <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                {/* Languages */}
                <div className="p-6 rounded-xl" style={{ background: 'var(--bg-white)', border: '1px solid var(--border-light)' }}>
                  <h2 className="text-lg font-medium mb-4 flex items-center gap-2" style={{ color: 'var(--text-primary)' }}>
                    <Languages className="w-5 h-5" style={{ color: 'var(--accent-rust)' }} />
                    By Language
                  </h2>
                  <div className="space-y-2 max-h-64 overflow-y-auto">
                    {usageData.collectionStats.byLanguage.map((lang, i) => {
                      const total = usageData.collectionStats!.byLanguage.reduce((a, b) => a + b.count, 0);
                      const pct = total > 0 ? (lang.count / total) * 100 : 0;
                      const colors = ['var(--accent-rust)', 'var(--accent-sage)', 'var(--accent-violet)', '#f59e0b', '#22c55e'];
                      return (
                        <div key={i}>
                          <div className="flex justify-between text-sm mb-1">
                            <span style={{ color: 'var(--text-primary)' }}>{lang.language}</span>
                            <span style={{ color: 'var(--text-muted)' }}>{lang.count}</span>
                          </div>
                          <div className="h-2 rounded-full overflow-hidden" style={{ background: 'var(--bg-warm)' }}>
                            <div
                              className="h-full rounded-full"
                              style={{ width: `${pct}%`, background: colors[i % colors.length] }}
                            />
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>

                {/* Categories */}
                <div className="p-6 rounded-xl" style={{ background: 'var(--bg-white)', border: '1px solid var(--border-light)' }}>
                  <h2 className="text-lg font-medium mb-4 flex items-center gap-2" style={{ color: 'var(--text-primary)' }}>
                    <BookOpen className="w-5 h-5" style={{ color: 'var(--accent-sage)' }} />
                    By Category
                  </h2>
                  <div className="space-y-2 max-h-64 overflow-y-auto">
                    {usageData.collectionStats.byCategory.map((cat, i) => {
                      const total = usageData.collectionStats!.byCategory.reduce((a, b) => a + b.count, 0);
                      const pct = total > 0 ? (cat.count / total) * 100 : 0;
                      const colors = ['var(--accent-sage)', 'var(--accent-violet)', 'var(--accent-rust)', '#22c55e', '#f59e0b'];
                      return (
                        <div key={i}>
                          <div className="flex justify-between text-sm mb-1">
                            <span className="truncate" style={{ color: 'var(--text-primary)' }} title={cat.category}>{cat.category}</span>
                            <span style={{ color: 'var(--text-muted)' }}>{cat.count}</span>
                          </div>
                          <div className="h-2 rounded-full overflow-hidden" style={{ background: 'var(--bg-warm)' }}>
                            <div
                              className="h-full rounded-full"
                              style={{ width: `${pct}%`, background: colors[i % colors.length] }}
                            />
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>

                {/* Image Sources */}
                <div className="p-6 rounded-xl" style={{ background: 'var(--bg-white)', border: '1px solid var(--border-light)' }}>
                  <h2 className="text-lg font-medium mb-4 flex items-center gap-2" style={{ color: 'var(--text-primary)' }}>
                    <HardDrive className="w-5 h-5" style={{ color: 'var(--accent-violet)' }} />
                    Image Sources
                  </h2>
                  <div className="space-y-3">
                    {usageData.collectionStats.byImageSource.map((src, i) => {
                      const total = usageData.collectionStats!.byImageSource.reduce((a, b) => a + b.count, 0);
                      const pct = total > 0 ? (src.count / total) * 100 : 0;
                      const providerLabels: Record<string, string> = {
                        internet_archive: 'Internet Archive',
                        gallica: 'Gallica (BnF)',
                        mdz: 'MDZ (Bavarian)',
                        efm: 'EFM Manuscripts',
                        iiif: 'IIIF Generic',
                        vercel_blob: 'Vercel Blob',
                      };
                      const providerColors: Record<string, string> = {
                        internet_archive: '#f59e0b',
                        gallica: '#3b82f6',
                        mdz: '#22c55e',
                        efm: 'var(--accent-violet)',
                        iiif: 'var(--accent-rust)',
                        vercel_blob: '#22c55e',
                      };
                      return (
                        <div key={i}>
                          <div className="flex justify-between text-sm mb-1">
                            <span style={{ color: 'var(--text-primary)' }}>{providerLabels[src.provider] || src.provider}</span>
                            <span style={{ color: 'var(--text-muted)' }}>{src.count} ({pct.toFixed(0)}%)</span>
                          </div>
                          <div className="h-3 rounded-full overflow-hidden" style={{ background: 'var(--bg-warm)' }}>
                            <div
                              className="h-full rounded-full"
                              style={{ width: `${pct}%`, background: providerColors[src.provider] || 'var(--accent-sage)' }}
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
                      const isUntracked = m.model === '__untracked__';
                      const displayName = isUntracked ? 'Untracked (historical)' : (m.model || 'Unknown');
                      return (
                        <div key={i}>
                          <div className="flex justify-between text-sm mb-1">
                            <span style={{ color: isUntracked ? 'var(--text-muted)' : 'var(--text-primary)', fontStyle: isUntracked ? 'italic' : 'normal' }}>
                              {displayName}
                            </span>
                            <span style={{ color: 'var(--text-muted)' }}>{formatNumber(m.count)}</span>
                          </div>
                          <div className="h-2 rounded-full overflow-hidden" style={{ background: 'var(--bg-warm)' }}>
                            <div
                              className="h-full rounded-full"
                              style={{ width: `${pct}%`, background: isUntracked ? 'var(--text-faint)' : 'var(--accent-sage)' }}
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
            {/* Blob vs IA Comparison */}
            {perfData?.sourceStats && perfData.sourceStats.length > 0 && (
              <div className="p-6 rounded-xl" style={{ background: 'var(--bg-white)', border: '1px solid var(--border-light)' }}>
                <h2 className="text-lg font-medium mb-4" style={{ color: 'var(--text-primary)' }}>
                  Image Loading: Blob vs Internet Archive
                </h2>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  {perfData.sourceStats.map((stat) => {
                    const sourceLabels: Record<string, string> = {
                      blob: 'Vercel Blob (Archived)',
                      ia: 'Internet Archive',
                      local: 'API Proxy',
                      other: 'Other',
                    };
                    const sourceColors: Record<string, string> = {
                      blob: '#22c55e',
                      ia: '#f59e0b',
                      local: 'var(--accent-sage)',
                      other: 'var(--text-muted)',
                    };
                    const color = sourceColors[stat.source] || sourceColors.other;
                    return (
                      <div
                        key={stat.source}
                        className="p-4 rounded-lg"
                        style={{ background: 'var(--bg-warm)', borderLeft: `4px solid ${color}` }}
                      >
                        <div className="flex items-center justify-between mb-2">
                          <span className="font-medium" style={{ color: 'var(--text-primary)' }}>
                            {sourceLabels[stat.source] || stat.source}
                          </span>
                          <span className="text-xs px-2 py-0.5 rounded-full" style={{ background: 'var(--bg-white)', color: 'var(--text-muted)' }}>
                            {stat.count} loads
                          </span>
                        </div>
                        <div className="text-2xl font-semibold mb-2" style={{ color }}>
                          {formatDuration(stat.avg)}
                        </div>
                        <div className="grid grid-cols-2 gap-2 text-xs">
                          <div>
                            <span style={{ color: 'var(--text-muted)' }}>P50: </span>
                            <span style={{ color: 'var(--text-primary)' }}>{stat.p50 ? formatDuration(stat.p50) : '-'}</span>
                          </div>
                          <div>
                            <span style={{ color: 'var(--text-muted)' }}>P95: </span>
                            <span style={{ color: 'var(--text-primary)' }}>{stat.p95 ? formatDuration(stat.p95) : '-'}</span>
                          </div>
                          <div>
                            <span style={{ color: 'var(--text-muted)' }}>Min: </span>
                            <span style={{ color: 'var(--text-primary)' }}>{formatDuration(stat.min)}</span>
                          </div>
                          <div>
                            <span style={{ color: 'var(--text-muted)' }}>Max: </span>
                            <span style={{ color: 'var(--text-primary)' }}>{formatDuration(stat.max)}</span>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
                {/* Comparison Bar */}
                {perfData.sourceStats.length >= 2 && (() => {
                  const blob = perfData.sourceStats.find(s => s.source === 'blob');
                  const ia = perfData.sourceStats.find(s => s.source === 'ia');
                  if (blob && ia) {
                    const speedup = ((ia.avg - blob.avg) / ia.avg * 100).toFixed(0);
                    const faster = blob.avg < ia.avg ? 'blob' : 'ia';
                    return (
                      <div className="mt-4 p-4 rounded-lg text-center" style={{ background: 'var(--bg-cream)' }}>
                        {faster === 'blob' ? (
                          <p style={{ color: 'var(--text-primary)' }}>
                            <span className="font-semibold" style={{ color: '#22c55e' }}>Vercel Blob</span> is{' '}
                            <span className="font-semibold">{speedup}% faster</span> than Internet Archive
                            <span className="text-sm ml-2" style={{ color: 'var(--text-muted)' }}>
                              ({formatDuration(blob.avg)} vs {formatDuration(ia.avg)})
                            </span>
                          </p>
                        ) : (
                          <p style={{ color: 'var(--text-primary)' }}>
                            <span className="font-semibold" style={{ color: '#f59e0b' }}>Internet Archive</span> is{' '}
                            <span className="font-semibold">{Math.abs(Number(speedup))}% faster</span> than Vercel Blob
                            <span className="text-sm ml-2" style={{ color: 'var(--text-muted)' }}>
                              ({formatDuration(ia.avg)} vs {formatDuration(blob.avg)})
                            </span>
                          </p>
                        )}
                      </div>
                    );
                  }
                  return null;
                })()}
              </div>
            )}

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
                        <th className="px-4 py-3 text-left font-medium" style={{ color: 'var(--text-muted)' }}>User</th>
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
                            <td className="px-4 py-3 text-xs" style={{ color: 'var(--text-muted)' }}>
                              {job.initiated_by || '-'}
                            </td>
                            <td className="px-4 py-3 max-w-[200px]">
                              {job.book_id ? (
                                <Link
                                  href={`/book/${job.book_id}`}
                                  className="block truncate hover:underline"
                                  style={{ color: 'var(--text-primary)' }}
                                  title={job.book_title || '-'}
                                >
                                  {job.book_title || '-'}
                                </Link>
                              ) : (
                                <div className="truncate" style={{ color: 'var(--text-primary)' }} title={job.book_title || '-'}>
                                  {job.book_title || '-'}
                                </div>
                              )}
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
        ) : activeTab === 'search' ? (
          /* Search Tab */
          <div className="space-y-8">
            {searchData ? (
              <>
                {/* Summary */}
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  <div className="p-4 rounded-xl" style={{ background: 'var(--bg-white)', border: '1px solid var(--border-light)' }}>
                    <div className="flex items-center gap-2 mb-2">
                      <Search className="w-4 h-4" style={{ color: 'var(--accent-violet)' }} />
                      <span className="text-xs font-medium uppercase" style={{ color: 'var(--text-muted)' }}>Total Searches</span>
                    </div>
                    <div className="text-2xl font-semibold" style={{ color: 'var(--text-primary)' }}>
                      {formatNumber(searchData.totalSearches)}
                    </div>
                  </div>
                  <div className="p-4 rounded-xl" style={{ background: 'var(--bg-white)', border: '1px solid var(--border-light)' }}>
                    <div className="flex items-center gap-2 mb-2">
                      <BookOpen className="w-4 h-4" style={{ color: 'var(--accent-sage)' }} />
                      <span className="text-xs font-medium uppercase" style={{ color: 'var(--text-muted)' }}>Unique Queries</span>
                    </div>
                    <div className="text-2xl font-semibold" style={{ color: 'var(--text-primary)' }}>
                      {formatNumber(searchData.topQueries?.length || 0)}
                    </div>
                  </div>
                  <div className="p-4 rounded-xl" style={{ background: 'var(--bg-white)', border: '1px solid var(--border-light)' }}>
                    <div className="flex items-center gap-2 mb-2">
                      <AlertTriangle className="w-4 h-4" style={{ color: 'var(--accent-rust)' }} />
                      <span className="text-xs font-medium uppercase" style={{ color: 'var(--text-muted)' }}>Zero-Result Queries</span>
                    </div>
                    <div className="text-2xl font-semibold" style={{ color: 'var(--text-primary)' }}>
                      {formatNumber(searchData.zeroResultQueries?.length || 0)}
                    </div>
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  {/* Top Queries */}
                  {searchData.topQueries && searchData.topQueries.length > 0 && (
                    <div className="p-6 rounded-xl" style={{ background: 'var(--bg-white)', border: '1px solid var(--border-light)' }}>
                      <h2 className="text-lg font-medium mb-4 flex items-center gap-2" style={{ color: 'var(--text-primary)' }}>
                        <Search className="w-5 h-5" style={{ color: 'var(--accent-violet)' }} />
                        Top Searches
                      </h2>
                      <div className="space-y-2">
                        {searchData.topQueries.slice(0, 20).map((q: any, idx: number) => (
                          <div key={idx} className="flex items-center justify-between py-2" style={{ borderBottom: idx < Math.min(searchData.topQueries.length, 20) - 1 ? '1px solid var(--border-light)' : 'none' }}>
                            <div className="flex-1 min-w-0">
                              <span className="font-medium text-sm truncate block" style={{ color: 'var(--text-primary)' }}>{q.query}</span>
                              <span className="text-xs" style={{ color: 'var(--text-muted)' }}>avg {q.avg_results} results</span>
                            </div>
                            <span className="text-sm font-medium ml-3 shrink-0" style={{ color: 'var(--text-secondary)' }}>{q.count}x</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Zero-Result Queries (Content Gaps) */}
                  <div className="p-6 rounded-xl" style={{ background: 'var(--bg-white)', border: '1px solid var(--border-light)' }}>
                    <h2 className="text-lg font-medium mb-4 flex items-center gap-2" style={{ color: 'var(--text-primary)' }}>
                      <AlertTriangle className="w-5 h-5" style={{ color: 'var(--accent-rust)' }} />
                      Content Gaps
                      <span className="text-xs font-normal" style={{ color: 'var(--text-muted)' }}>(zero results)</span>
                    </h2>
                    {searchData.zeroResultQueries && searchData.zeroResultQueries.length > 0 ? (
                      <div className="space-y-2">
                        {searchData.zeroResultQueries.map((q: any, idx: number) => (
                          <div key={idx} className="flex items-center justify-between py-2" style={{ borderBottom: idx < searchData.zeroResultQueries.length - 1 ? '1px solid var(--border-light)' : 'none' }}>
                            <span className="font-medium text-sm truncate" style={{ color: 'var(--accent-rust)' }}>{q.query}</span>
                            <span className="text-sm font-medium ml-3 shrink-0" style={{ color: 'var(--text-muted)' }}>{q.count}x</span>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <p className="text-sm" style={{ color: 'var(--text-muted)' }}>No zero-result queries in this period</p>
                    )}
                  </div>
                </div>

                {/* Search by Source */}
                {searchData.searchesBySource && searchData.searchesBySource.length > 0 && (
                  <div className="p-6 rounded-xl" style={{ background: 'var(--bg-white)', border: '1px solid var(--border-light)' }}>
                    <h2 className="text-lg font-medium mb-4" style={{ color: 'var(--text-primary)' }}>Searches by Source</h2>
                    <div className="flex gap-4 flex-wrap">
                      {searchData.searchesBySource.map((s: any, idx: number) => {
                        const labels: Record<string, string> = { global: 'Full Search', unified: 'Quick Search', book_search: 'Within Book' };
                        return (
                          <div key={idx} className="px-4 py-3 rounded-lg" style={{ background: 'var(--bg-warm)' }}>
                            <div className="text-xs font-medium uppercase" style={{ color: 'var(--text-muted)' }}>{labels[s.source] || s.source}</div>
                            <div className="text-xl font-semibold mt-1" style={{ color: 'var(--text-primary)' }}>{formatNumber(s.count)}</div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}
              </>
            ) : (
              <div className="text-center py-12" style={{ color: 'var(--text-muted)' }}>
                <Search className="w-12 h-12 mx-auto mb-4 opacity-30" />
                <p>No search data available yet</p>
                <p className="text-sm mt-1">Search queries will appear here as users search the library</p>
              </div>
            )}
          </div>
        ) : activeTab === 'traffic' ? (
          /* Traffic Tab */
          <div className="space-y-8">
            {vercelData && (
              <>
                {/* Summary Cards */}
                {(vercelData.totalVisitors || vercelData.totalPageviews) && (
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    {vercelData.totalVisitors !== undefined && (
                      <div className="p-6 rounded-xl" style={{ background: 'linear-gradient(135deg, var(--bg-white), #f0f9ff)', border: '1px solid var(--border-light)' }}>
                        <div className="flex items-center gap-2 mb-2">
                          <Users className="w-5 h-5" style={{ color: '#3b82f6' }} />
                          <span className="text-sm font-medium uppercase" style={{ color: 'var(--text-muted)' }}>Total Visitors</span>
                        </div>
                        <div className="text-4xl font-bold" style={{ color: 'var(--text-primary)' }}>
                          {vercelData.totalVisitors.toLocaleString()}
                        </div>
                      </div>
                    )}
                    {vercelData.totalPageviews !== undefined && (
                      <div className="p-6 rounded-xl" style={{ background: 'linear-gradient(135deg, var(--bg-white), #faf5ff)', border: '1px solid var(--border-light)' }}>
                        <div className="flex items-center gap-2 mb-2">
                          <BarChart3 className="w-5 h-5" style={{ color: '#8b5cf6' }} />
                          <span className="text-sm font-medium uppercase" style={{ color: 'var(--text-muted)' }}>Total Pageviews</span>
                        </div>
                        <div className="text-4xl font-bold" style={{ color: 'var(--text-primary)' }}>
                          {vercelData.totalPageviews.toLocaleString()}
                        </div>
                      </div>
                    )}
                  </div>
                )}

                {/* Top Pages */}
                {vercelData.topPages && vercelData.topPages.length > 0 && (
                  <div className="p-6 rounded-xl" style={{ background: 'var(--bg-white)', border: '1px solid var(--border-light)' }}>
                    <h2 className="text-lg font-medium mb-4" style={{ color: 'var(--text-primary)' }}>Top Pages</h2>
                    <div className="space-y-3">
                      {vercelData.topPages.map((page, idx) => (
                        <div key={idx} className="flex items-center justify-between pb-3" style={{ borderBottom: idx < vercelData.topPages!.length - 1 ? '1px solid var(--border-light)' : 'none' }}>
                          <p className="font-medium truncate" style={{ color: 'var(--text-primary)' }}>{page.path}</p>
                          <p className="text-sm ml-4" style={{ color: 'var(--text-muted)' }}>{page.count.toLocaleString()} views</p>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Traffic Sources and Countries */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  {vercelData.topReferrers && vercelData.topReferrers.length > 0 && (
                    <div className="p-6 rounded-xl" style={{ background: 'var(--bg-white)', border: '1px solid var(--border-light)' }}>
                      <h2 className="text-lg font-medium mb-4" style={{ color: 'var(--text-primary)' }}>Traffic Sources</h2>
                      <div className="space-y-3">
                        {vercelData.topReferrers.map((referrer, idx) => (
                          <div key={idx} className="flex items-center justify-between pb-3" style={{ borderBottom: idx < vercelData.topReferrers!.length - 1 ? '1px solid var(--border-light)' : 'none' }}>
                            <p className="font-medium truncate" style={{ color: 'var(--text-primary)' }}>{referrer.referrer || 'Direct traffic'}</p>
                            <p className="text-sm ml-4" style={{ color: 'var(--text-muted)' }}>{referrer.count.toLocaleString()} visitors</p>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {vercelData.topCountries && vercelData.topCountries.length > 0 && (
                    <div className="p-6 rounded-xl" style={{ background: 'var(--bg-white)', border: '1px solid var(--border-light)' }}>
                      <h2 className="text-lg font-medium mb-4 flex items-center gap-2" style={{ color: 'var(--text-primary)' }}>
                        <Globe className="w-5 h-5" style={{ color: 'var(--accent-sage)' }} />
                        Visitor Locations
                      </h2>
                      <div className="space-y-3">
                        {vercelData.topCountries.map((country, idx) => (
                          <div key={idx} className="flex items-center justify-between pb-3" style={{ borderBottom: idx < vercelData.topCountries!.length - 1 ? '1px solid var(--border-light)' : 'none' }}>
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
              </>
            )}

            {!vercelData && !loading && (
              <div className="text-center py-12" style={{ color: 'var(--text-muted)' }}>
                <BarChart3 className="w-12 h-12 mx-auto mb-4 opacity-30" />
                <p>No traffic data available yet</p>
                <p className="text-sm mt-1">Pageview data will appear here as the site is used</p>
              </div>
            )}
          </div>
        ) : null}
      </main>
    </div>
  );
}
