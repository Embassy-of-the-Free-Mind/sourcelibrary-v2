'use client';

import { useState, useEffect, useCallback } from 'react';
import { toast } from 'sonner';
import Link from 'next/link';
import {
  ChevronLeft, RefreshCw, BookOpen, DollarSign, ExternalLink,
  Plus, Check, Package, Upload, ShoppingCart, X, Edit2,
  TrendingUp, Award, Star, Filter,
} from 'lucide-react';
import { BookLoader } from '@/components/ui/BookLoader';

// ─── Types ───────────────────────────────────────────────────────────────

type TabId = 'candidates' | 'pipeline' | 'published';

interface KdpCandidate {
  id: string;
  slug?: string;
  title: string;
  original_title: string;
  author: string;
  language: string;
  published: string;
  categories: string[];
  thumbnail?: string;
  pages_count: number;
  pages_translated: number;
  translation_pct: number;
  read_count: number;
  kdp_score: number;
  kdp_score_breakdown: {
    quality: number;
    translation: number;
    efm_relevance: number;
    engagement: number;
    apparatus: number;
    first_translation_bonus: number;
  } | null;
  is_first_translation: boolean;
  publication: {
    status: string;
    asin?: string;
    kindle_url?: string;
    goodreads_url?: string;
  } | null;
}

interface KdpPublication {
  id: string;
  book_id: string;
  status: string;
  kdp_metadata: {
    title: string;
    subtitle: string;
    author: string;
    description: string;
    keywords: string[];
    categories: string[];
    ai_disclosure: string;
    price: string;
  };
  asin?: string;
  kindle_url?: string;
  goodreads_url?: string;
  kdp_score_snapshot: number;
  notes?: string;
  created_at: string;
  updated_at: string;
  published_at?: string;
  book?: {
    title: string;
    author: string;
    thumbnail?: string;
    slug?: string;
  };
}

interface DashboardStats {
  total_candidates: number;
  total_scored: number;
  publications_by_status: Record<string, number>;
  avg_score: number;
}

// ─── Status Config ───────────────────────────────────────────────────────

const STATUS_FLOW: string[] = ['candidate', 'packaging', 'ready', 'uploaded', 'live'];
const STATUS_STYLES: Record<string, { color: string; bg: string; icon: typeof BookOpen }> = {
  candidate: { color: 'var(--accent-violet)', bg: 'color-mix(in srgb, var(--accent-violet) 12%, transparent)', icon: Star },
  packaging: { color: 'var(--accent-gold)', bg: 'color-mix(in srgb, var(--accent-gold) 12%, transparent)', icon: Package },
  ready: { color: 'var(--accent-sage)', bg: 'color-mix(in srgb, var(--accent-sage) 12%, transparent)', icon: Check },
  uploaded: { color: 'var(--accent-rust)', bg: 'color-mix(in srgb, var(--accent-rust) 12%, transparent)', icon: Upload },
  live: { color: 'var(--status-success)', bg: 'color-mix(in srgb, var(--status-success) 12%, transparent)', icon: ShoppingCart },
  rejected: { color: 'var(--text-faint)', bg: 'color-mix(in srgb, var(--text-faint) 12%, transparent)', icon: X },
};

// ─── Page ────────────────────────────────────────────────────────────────

export default function KdpDashboard() {
  const [tab, setTab] = useState<TabId>('candidates');
  const [candidates, setCandidates] = useState<KdpCandidate[]>([]);
  const [publications, setPublications] = useState<KdpPublication[]>([]);
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [scoring, setScoring] = useState(false);

  // Filters
  const [minScore, setMinScore] = useState(0);
  const [categoryFilter, setCategoryFilter] = useState('');
  const [languageFilter, setLanguageFilter] = useState('');

  const fetchCandidates = useCallback(async () => {
    try {
      const params = new URLSearchParams();
      if (minScore > 0) params.set('minScore', String(minScore));
      if (categoryFilter) params.set('category', categoryFilter);
      if (languageFilter) params.set('language', languageFilter);
      params.set('limit', '100');

      const res = await fetch(`/api/admin/kdp?${params}`);
      if (!res.ok) throw new Error('Failed to fetch');
      const data = await res.json();
      setCandidates(data.results);
      setStats(data.stats);
    } catch (e) {
      console.error('Fetch candidates error:', e);
      toast.error('Failed to load candidates');
    }
  }, [minScore, categoryFilter, languageFilter]);

  const fetchPublications = useCallback(async () => {
    try {
      const res = await fetch('/api/admin/kdp/publications');
      if (!res.ok) throw new Error('Failed to fetch');
      const data = await res.json();
      setPublications(data.publications);
    } catch (e) {
      console.error('Fetch publications error:', e);
    }
  }, []);

  useEffect(() => {
    Promise.all([fetchCandidates(), fetchPublications()]).finally(() => setLoading(false));
  }, [fetchCandidates, fetchPublications]);

  async function handleRefreshScores() {
    setScoring(true);
    try {
      const res = await fetch('/api/admin/kdp/score', { method: 'POST' });
      const data = await res.json();
      toast.success(`Scored ${data.scored} books`);
      await fetchCandidates();
    } catch {
      toast.error('Failed to refresh scores');
    } finally {
      setScoring(false);
    }
  }

  async function handleAddToPipeline(bookId: string) {
    try {
      const res = await fetch('/api/admin/kdp/publications', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ book_id: bookId }),
      });
      if (res.status === 409) {
        toast.error('Already in pipeline');
        return;
      }
      if (!res.ok) throw new Error('Failed');
      toast.success('Added to KDP pipeline');
      await Promise.all([fetchCandidates(), fetchPublications()]);
    } catch {
      toast.error('Failed to add to pipeline');
    }
  }

  async function handleUpdatePublication(id: string, updates: Record<string, unknown>) {
    try {
      const res = await fetch(`/api/admin/kdp/publications/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updates),
      });
      if (!res.ok) throw new Error('Failed');
      toast.success('Updated');
      await fetchPublications();
    } catch {
      toast.error('Failed to update');
    }
  }

  // Derived data
  const pipelinePubs = publications.filter(p => !['live', 'rejected'].includes(p.status));
  const livePubs = publications.filter(p => p.status === 'live');
  const allCategories = [...new Set(candidates.flatMap(c => c.categories))].sort();
  const allLanguages = [...new Set(candidates.map(c => c.language))].sort();

  const tabs: { id: TabId; label: string; count?: number }[] = [
    { id: 'candidates', label: 'Candidates', count: stats?.total_candidates },
    { id: 'pipeline', label: 'Pipeline', count: pipelinePubs.length },
    { id: 'published', label: 'Published', count: livePubs.length },
  ];

  return (
    <div className="min-h-screen" style={{ background: 'var(--bg-cream)' }}>
      {/* Header */}
      <header
        className="sticky top-0 z-20 px-4 py-3 border-b"
        style={{ background: 'var(--bg-cream)', borderColor: 'var(--border-light)' }}
      >
        <div className="flex items-center justify-between max-w-6xl mx-auto">
          <div className="flex items-center gap-3">
            <Link href="/admin/processing" style={{ color: 'var(--text-muted)' }}>
              <ChevronLeft className="w-5 h-5" />
            </Link>
            <DollarSign className="w-5 h-5" style={{ color: 'var(--accent-gold)' }} />
            <h1 className="font-serif text-xl" style={{ color: 'var(--text-primary)' }}>
              KDP Publishing
            </h1>
          </div>
          <button
            onClick={handleRefreshScores}
            disabled={scoring}
            className="flex items-center gap-2 px-3 py-1.5 rounded-lg border text-sm"
            style={{ borderColor: 'var(--accent-gold)', color: 'var(--accent-gold)' }}
          >
            <RefreshCw className={`w-4 h-4 ${scoring ? 'animate-spin' : ''}`} />
            Refresh Scores
          </button>
        </div>
      </header>

      {loading ? (
        <div className="py-24"><BookLoader size="xs" /></div>
      ) : (
        <main className="max-w-6xl mx-auto px-4 py-6 space-y-6">
          {/* Stats */}
          {stats && (
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <StatCard
                label="Candidates"
                value={stats.total_candidates}
                sub={`${stats.total_scored} scored`}
                icon={<BookOpen className="w-4 h-4" />}
                color="var(--accent-violet)"
              />
              <StatCard
                label="Avg Score"
                value={stats.avg_score}
                sub="of 100"
                icon={<TrendingUp className="w-4 h-4" />}
                color="var(--accent-gold)"
              />
              <StatCard
                label="In Pipeline"
                value={pipelinePubs.length}
                sub={`${Object.entries(stats.publications_by_status).filter(([k]) => k !== 'live' && k !== 'rejected').map(([k, v]) => `${v} ${k}`).join(', ') || 'none'}`}
                icon={<Package className="w-4 h-4" />}
                color="var(--accent-rust)"
              />
              <StatCard
                label="Published"
                value={livePubs.length}
                sub={livePubs.length > 0 ? `${livePubs.filter(p => p.asin).length} with ASIN` : 'none yet'}
                icon={<Award className="w-4 h-4" />}
                color="var(--accent-sage)"
              />
            </div>
          )}

          {/* Tab bar */}
          <div className="flex gap-1 border-b" style={{ borderColor: 'var(--border-light)' }}>
            {tabs.map(t => (
              <button
                key={t.id}
                onClick={() => setTab(t.id)}
                className="px-4 py-2 text-sm font-medium transition-colors relative"
                style={{
                  color: tab === t.id ? 'var(--accent-rust)' : 'var(--text-muted)',
                  borderBottom: tab === t.id ? '2px solid var(--accent-rust)' : '2px solid transparent',
                }}
              >
                {t.label}
                {t.count !== undefined && (
                  <span
                    className="ml-1.5 text-xs px-1.5 py-0.5 rounded-full"
                    style={{ background: 'var(--bg-warm)', color: 'var(--text-faint)' }}
                  >
                    {t.count}
                  </span>
                )}
              </button>
            ))}
          </div>

          {/* Tab content */}
          {tab === 'candidates' && (
            <CandidatesTab
              candidates={candidates}
              allCategories={allCategories}
              allLanguages={allLanguages}
              minScore={minScore}
              setMinScore={setMinScore}
              categoryFilter={categoryFilter}
              setCategoryFilter={setCategoryFilter}
              languageFilter={languageFilter}
              setLanguageFilter={setLanguageFilter}
              onAddToPipeline={handleAddToPipeline}
            />
          )}

          {tab === 'pipeline' && (
            <PipelineTab
              publications={pipelinePubs}
              onUpdate={handleUpdatePublication}
            />
          )}

          {tab === 'published' && (
            <PublishedTab publications={livePubs} />
          )}
        </main>
      )}
    </div>
  );
}

// ─── Candidates Tab ──────────────────────────────────────────────────────

function CandidatesTab({
  candidates, allCategories, allLanguages,
  minScore, setMinScore, categoryFilter, setCategoryFilter,
  languageFilter, setLanguageFilter, onAddToPipeline,
}: {
  candidates: KdpCandidate[];
  allCategories: string[];
  allLanguages: string[];
  minScore: number;
  setMinScore: (v: number) => void;
  categoryFilter: string;
  setCategoryFilter: (v: string) => void;
  languageFilter: string;
  setLanguageFilter: (v: string) => void;
  onAddToPipeline: (bookId: string) => void;
}) {
  return (
    <div className="space-y-4">
      {/* Filters */}
      <div className="flex flex-wrap items-center gap-3">
        <Filter className="w-4 h-4" style={{ color: 'var(--text-muted)' }} />
        <select
          value={categoryFilter}
          onChange={e => setCategoryFilter(e.target.value)}
          className="text-sm px-2 py-1 rounded border"
          style={{ borderColor: 'var(--border-light)', background: 'white', color: 'var(--text-secondary)' }}
        >
          <option value="">All categories</option>
          {allCategories.map(c => <option key={c} value={c}>{c}</option>)}
        </select>
        <select
          value={languageFilter}
          onChange={e => setLanguageFilter(e.target.value)}
          className="text-sm px-2 py-1 rounded border"
          style={{ borderColor: 'var(--border-light)', background: 'white', color: 'var(--text-secondary)' }}
        >
          <option value="">All languages</option>
          {allLanguages.map(l => <option key={l} value={l}>{l}</option>)}
        </select>
        <label className="flex items-center gap-1 text-sm" style={{ color: 'var(--text-muted)' }}>
          Min score:
          <input
            type="number"
            value={minScore || ''}
            onChange={e => setMinScore(parseInt(e.target.value) || 0)}
            className="w-16 px-2 py-1 rounded border text-sm"
            style={{ borderColor: 'var(--border-light)', background: 'white', color: 'var(--text-secondary)' }}
            placeholder="0"
            min={0}
            max={100}
          />
        </label>
      </div>

      {/* Table */}
      <Section title={`Ranked Candidates (${candidates.length})`}>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr style={{ color: 'var(--text-muted)' }}>
                <th className="text-left py-2 pr-2 w-8">#</th>
                <th className="text-left py-2 pr-2">Book</th>
                <th className="text-right py-2 px-2">Score</th>
                <th className="text-right py-2 px-2">Trans %</th>
                <th className="text-left py-2 px-2">Language</th>
                <th className="text-right py-2 px-2">Reads</th>
                <th className="text-left py-2 px-2">Status</th>
                <th className="text-right py-2 pl-2">Actions</th>
              </tr>
            </thead>
            <tbody>
              {candidates.map((c, i) => (
                <tr key={c.id} className="border-t" style={{ borderColor: 'var(--border-light)' }}>
                  <td className="py-2 pr-2 tabular-nums" style={{ color: 'var(--text-faint)' }}>
                    {i + 1}
                  </td>
                  <td className="py-2 pr-2">
                    <div className="flex items-center gap-2">
                      {c.thumbnail && (
                        <img
                          src={c.thumbnail}
                          alt=""
                          className="w-8 h-10 object-cover rounded"
                          loading="lazy"
                        />
                      )}
                      <div className="min-w-0">
                        <a
                          href={`https://sourcelibrary.org/book/${c.slug || c.id}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-sm font-medium truncate block hover:underline"
                          style={{ color: 'var(--text-primary)', maxWidth: '280px' }}
                        >
                          {c.title}
                        </a>
                        <span className="text-xs truncate block" style={{ color: 'var(--text-faint)', maxWidth: '280px' }}>
                          {c.author} ({c.published})
                        </span>
                      </div>
                    </div>
                  </td>
                  <td className="py-2 px-2 text-right">
                    <ScoreBadge score={c.kdp_score} breakdown={c.kdp_score_breakdown} />
                  </td>
                  <td className="py-2 px-2 text-right tabular-nums" style={{ color: 'var(--text-secondary)' }}>
                    {c.translation_pct}%
                  </td>
                  <td className="py-2 px-2" style={{ color: 'var(--text-muted)' }}>
                    {c.language}
                  </td>
                  <td className="py-2 px-2 text-right tabular-nums" style={{ color: 'var(--text-muted)' }}>
                    {c.read_count}
                  </td>
                  <td className="py-2 px-2">
                    {c.publication ? (
                      <StatusBadge status={c.publication.status} />
                    ) : (
                      <span className="text-xs" style={{ color: 'var(--text-faint)' }}>--</span>
                    )}
                  </td>
                  <td className="py-2 pl-2 text-right">
                    <div className="flex items-center justify-end gap-1">
                      {!c.publication && (
                        <button
                          onClick={() => onAddToPipeline(c.id)}
                          className="text-xs px-2 py-1 rounded border whitespace-nowrap"
                          style={{ borderColor: 'var(--accent-sage)', color: 'var(--accent-sage)' }}
                          title="Add to KDP pipeline"
                        >
                          <Plus className="w-3 h-3 inline mr-0.5" />Add
                        </button>
                      )}
                      <a
                        href={`https://sourcelibrary.org/book/${c.slug || c.id}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="p-1 rounded"
                        style={{ color: 'var(--text-faint)' }}
                      >
                        <ExternalLink className="w-3.5 h-3.5" />
                      </a>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {candidates.length === 0 && (
          <p className="text-sm py-8 text-center" style={{ color: 'var(--text-faint)' }}>
            No candidates found. Try refreshing scores or adjusting filters.
          </p>
        )}
      </Section>
    </div>
  );
}

// ─── Pipeline Tab ────────────────────────────────────────────────────────

function PipelineTab({
  publications, onUpdate,
}: {
  publications: KdpPublication[];
  onUpdate: (id: string, updates: Record<string, unknown>) => void;
}) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editAsin, setEditAsin] = useState('');
  const [editGoodreads, setEditGoodreads] = useState('');
  const [editNotes, setEditNotes] = useState('');

  function startEdit(pub: KdpPublication) {
    setEditingId(pub.id);
    setEditAsin(pub.asin || '');
    setEditGoodreads(pub.goodreads_url || '');
    setEditNotes(pub.notes || '');
  }

  function saveEdit(id: string) {
    const updates: Record<string, unknown> = {};
    if (editAsin) updates.asin = editAsin;
    if (editGoodreads) updates.goodreads_url = editGoodreads;
    updates.notes = editNotes;
    onUpdate(id, updates);
    setEditingId(null);
  }

  // Group by status
  const groups = STATUS_FLOW.filter(s => s !== 'live').map(status => ({
    status,
    pubs: publications.filter(p => p.status === status),
  })).filter(g => g.pubs.length > 0);

  return (
    <div className="space-y-6">
      {groups.length === 0 && (
        <p className="text-sm py-8 text-center" style={{ color: 'var(--text-faint)' }}>
          No books in the pipeline. Add candidates from the Candidates tab.
        </p>
      )}

      {groups.map(g => (
        <Section key={g.status} title={`${g.status.charAt(0).toUpperCase() + g.status.slice(1)} (${g.pubs.length})`}>
          <div className="space-y-3">
            {g.pubs.map(pub => {
              const nextStatus = STATUS_FLOW[STATUS_FLOW.indexOf(pub.status) + 1];
              const isEditing = editingId === pub.id;

              return (
                <div
                  key={pub.id}
                  className="p-3 rounded-lg border"
                  style={{ borderColor: 'var(--border-light)', background: 'var(--bg-warm)' }}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex items-center gap-2 min-w-0">
                      {pub.book?.thumbnail && (
                        <img src={pub.book.thumbnail} alt="" className="w-8 h-10 object-cover rounded" />
                      )}
                      <div className="min-w-0">
                        <a
                          href={`https://sourcelibrary.org/book/${pub.book?.slug || pub.book_id}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-sm font-medium truncate block hover:underline"
                          style={{ color: 'var(--text-primary)' }}
                        >
                          {pub.book?.title || pub.kdp_metadata.title}
                        </a>
                        <span className="text-xs" style={{ color: 'var(--text-faint)' }}>
                          {pub.book?.author} &middot; Score: {pub.kdp_score_snapshot}
                        </span>
                      </div>
                    </div>

                    <div className="flex items-center gap-2 flex-shrink-0">
                      <StatusBadge status={pub.status} />
                      {nextStatus && (
                        <button
                          onClick={() => onUpdate(pub.id, { status: nextStatus })}
                          className="text-xs px-2 py-1 rounded border whitespace-nowrap"
                          style={{ borderColor: 'var(--accent-sage)', color: 'var(--accent-sage)' }}
                        >
                          → {nextStatus}
                        </button>
                      )}
                      <button
                        onClick={() => onUpdate(pub.id, { status: 'rejected' })}
                        className="p-1 rounded"
                        style={{ color: 'var(--text-faint)' }}
                        title="Reject"
                      >
                        <X className="w-3.5 h-3.5" />
                      </button>
                      <button
                        onClick={() => isEditing ? saveEdit(pub.id) : startEdit(pub)}
                        className="p-1 rounded"
                        style={{ color: 'var(--accent-violet)' }}
                        title={isEditing ? 'Save' : 'Edit details'}
                      >
                        {isEditing ? <Check className="w-3.5 h-3.5" /> : <Edit2 className="w-3.5 h-3.5" />}
                      </button>
                    </div>
                  </div>

                  {/* Metadata preview */}
                  <div className="mt-2 text-xs space-y-1" style={{ color: 'var(--text-muted)' }}>
                    <div><span style={{ color: 'var(--text-faint)' }}>KDP Title:</span> {pub.kdp_metadata.title}</div>
                    <div><span style={{ color: 'var(--text-faint)' }}>Keywords:</span> {pub.kdp_metadata.keywords.join(', ') || 'none'}</div>
                    {pub.asin && <div><span style={{ color: 'var(--text-faint)' }}>ASIN:</span> {pub.asin}</div>}
                  </div>

                  {/* Edit form */}
                  {isEditing && (
                    <div className="mt-3 space-y-2 pt-3 border-t" style={{ borderColor: 'var(--border-light)' }}>
                      <label className="block">
                        <span className="text-xs" style={{ color: 'var(--text-faint)' }}>ASIN</span>
                        <input
                          value={editAsin}
                          onChange={e => setEditAsin(e.target.value)}
                          className="block w-full mt-0.5 px-2 py-1 rounded border text-sm"
                          style={{ borderColor: 'var(--border-light)', background: 'white', color: 'var(--text-primary)' }}
                          placeholder="B0XXXXXXXX"
                        />
                      </label>
                      <label className="block">
                        <span className="text-xs" style={{ color: 'var(--text-faint)' }}>Goodreads URL</span>
                        <input
                          value={editGoodreads}
                          onChange={e => setEditGoodreads(e.target.value)}
                          className="block w-full mt-0.5 px-2 py-1 rounded border text-sm"
                          style={{ borderColor: 'var(--border-light)', background: 'white', color: 'var(--text-primary)' }}
                          placeholder="https://goodreads.com/book/show/..."
                        />
                      </label>
                      <label className="block">
                        <span className="text-xs" style={{ color: 'var(--text-faint)' }}>Notes</span>
                        <textarea
                          value={editNotes}
                          onChange={e => setEditNotes(e.target.value)}
                          className="block w-full mt-0.5 px-2 py-1 rounded border text-sm"
                          style={{ borderColor: 'var(--border-light)', background: 'white', color: 'var(--text-primary)' }}
                          rows={2}
                        />
                      </label>
                    </div>
                  )}

                  {/* Bundle button — disabled placeholder for Phase 2 */}
                  {pub.status === 'packaging' && (
                    <div className="mt-2">
                      <button
                        disabled
                        className="text-xs px-2 py-1 rounded border opacity-50 cursor-not-allowed"
                        style={{ borderColor: 'var(--border-medium)', color: 'var(--text-faint)' }}
                        title="Coming in Phase 2"
                      >
                        <Package className="w-3 h-3 inline mr-0.5" />
                        Generate Bundle (Phase 2)
                      </button>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </Section>
      ))}
    </div>
  );
}

// ─── Published Tab ───────────────────────────────────────────────────────

function PublishedTab({ publications }: { publications: KdpPublication[] }) {
  return (
    <div className="space-y-4">
      {publications.length > 0 && (
        <div className="flex items-center gap-4 text-sm" style={{ color: 'var(--text-muted)' }}>
          <span>Total live: <strong style={{ color: 'var(--text-primary)' }}>{publications.length}</strong></span>
          <span>
            Avg score: <strong style={{ color: 'var(--text-primary)' }}>
              {Math.round(publications.reduce((s, p) => s + p.kdp_score_snapshot, 0) / publications.length)}
            </strong>
          </span>
        </div>
      )}

      {publications.length === 0 ? (
        <p className="text-sm py-8 text-center" style={{ color: 'var(--text-faint)' }}>
          No books published yet. Move candidates through the pipeline.
        </p>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {publications.map(pub => (
            <div
              key={pub.id}
              className="rounded-xl border p-4"
              style={{ borderColor: 'var(--border-light)', background: 'white' }}
            >
              <div className="flex items-start gap-3">
                {pub.book?.thumbnail && (
                  <img src={pub.book.thumbnail} alt="" className="w-12 h-16 object-cover rounded" />
                )}
                <div className="min-w-0 flex-1">
                  <h3 className="text-sm font-medium truncate" style={{ color: 'var(--text-primary)' }}>
                    {pub.book?.title || pub.kdp_metadata.title}
                  </h3>
                  <p className="text-xs" style={{ color: 'var(--text-faint)' }}>
                    {pub.book?.author} &middot; Score: {pub.kdp_score_snapshot}
                  </p>
                </div>
              </div>

              <div className="mt-3 flex flex-wrap gap-2">
                {pub.asin && (
                  <a
                    href={pub.kindle_url || `https://www.amazon.com/dp/${pub.asin}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-xs flex items-center gap-1 px-2 py-1 rounded"
                    style={{ background: 'color-mix(in srgb, var(--accent-gold) 12%, transparent)', color: 'var(--accent-gold-dark)' }}
                  >
                    <ShoppingCart className="w-3 h-3" />
                    Amazon
                    <ExternalLink className="w-3 h-3" />
                  </a>
                )}
                {pub.goodreads_url && (
                  <a
                    href={pub.goodreads_url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-xs flex items-center gap-1 px-2 py-1 rounded"
                    style={{ background: 'color-mix(in srgb, var(--accent-sage) 12%, transparent)', color: 'var(--accent-sage-dark)' }}
                  >
                    <BookOpen className="w-3 h-3" />
                    Goodreads
                    <ExternalLink className="w-3 h-3" />
                  </a>
                )}
              </div>

              {pub.published_at && (
                <p className="mt-2 text-[10px]" style={{ color: 'var(--text-faint)' }}>
                  Published {new Date(pub.published_at).toLocaleDateString()}
                </p>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Shared Components ───────────────────────────────────────────────────

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-xl border p-4" style={{ borderColor: 'var(--border-light)', background: 'white' }}>
      <h2 className="text-xs font-medium uppercase tracking-wider mb-3" style={{ color: 'var(--text-muted)' }}>
        {title}
      </h2>
      {children}
    </section>
  );
}

function StatCard({ label, value, sub, icon, color }: {
  label: string; value: string | number; sub: string; icon: React.ReactNode; color: string;
}) {
  return (
    <div className="rounded-xl border p-4" style={{ borderColor: 'var(--border-light)', background: 'white' }}>
      <div className="flex items-center gap-2 mb-1">
        <span style={{ color }}>{icon}</span>
        <span className="text-xs uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>{label}</span>
      </div>
      <div className="text-2xl font-serif tabular-nums" style={{ color: 'var(--text-primary)' }}>
        {typeof value === 'number' ? value.toLocaleString() : value}
      </div>
      <div className="text-xs mt-0.5" style={{ color: 'var(--text-faint)' }}>{sub}</div>
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  const style = STATUS_STYLES[status] || STATUS_STYLES.candidate;
  const Icon = style.icon;
  return (
    <span
      className="inline-flex items-center gap-1 text-[10px] font-medium px-1.5 py-0.5 rounded"
      style={{ color: style.color, background: style.bg }}
    >
      <Icon className="w-3 h-3" />
      {status}
    </span>
  );
}

function ScoreBadge({ score, breakdown }: {
  score: number;
  breakdown: KdpCandidate['kdp_score_breakdown'];
}) {
  const color = score >= 60 ? 'var(--accent-sage)' : score >= 30 ? 'var(--accent-gold)' : 'var(--text-faint)';

  return (
    <span
      className="inline-block tabular-nums font-medium text-sm cursor-help"
      style={{ color }}
      title={breakdown
        ? `Quality: ${breakdown.quality}/30\nTranslation: ${breakdown.translation}/25\nEFM: ${breakdown.efm_relevance}/20\nEngagement: ${breakdown.engagement}/10\nApparatus: ${breakdown.apparatus}/10\nFirst trans: ${breakdown.first_translation_bonus}/5`
        : 'Not scored yet'
      }
    >
      {score || '--'}
    </span>
  );
}
