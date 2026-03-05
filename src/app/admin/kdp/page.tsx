'use client';

import { useState, useEffect, useCallback } from 'react';
import { toast } from 'sonner';
import Link from 'next/link';
import {
  ChevronLeft, RefreshCw, BookOpen, ExternalLink,
  Plus, Check, Package, Upload, ShoppingCart, X,
  TrendingUp, Award, Star, Filter, Download,
  Copy, Eye, AlertTriangle, CheckCircle, Clock,
  ArrowRight, FileText, Image as ImageIcon,
  BookMarked, List, Clipboard,
} from 'lucide-react';
import { BookLoader } from '@/components/ui/BookLoader';

// ─── Types ───────────────────────────────────────────────────────────────

type StepId = 'select' | 'review' | 'upload' | 'pending' | 'live';

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
  quality_indicators?: {
    has_summary: boolean;
    has_index: boolean;
    has_chapters: boolean;
    has_cover: boolean;
  };
  publication: {
    id?: string;
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
  cover_image_url?: string;
  quality_flags?: {
    translation_percent: number;
    has_summary: boolean;
    has_index: boolean;
    has_chapters: boolean;
    has_cover: boolean;
    flagged_pages: number;
    low_quality: boolean;
    computed_at: string;
  };
  bundle_generated_at?: string;
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

// ─── Step Config ────────────────────────────────────────────────────────

const STEPS: { id: StepId; label: string; dbStatuses: string[]; color: string; icon: typeof Star }[] = [
  { id: 'select', label: 'Select', dbStatuses: ['candidate'], color: 'var(--accent-violet)', icon: Star },
  { id: 'review', label: 'Review', dbStatuses: ['review'], color: 'var(--accent-gold)', icon: Eye },
  { id: 'upload', label: 'Upload', dbStatuses: ['packaging', 'ready'], color: 'var(--accent-sage)', icon: Upload },
  { id: 'pending', label: 'Pending', dbStatuses: ['uploaded'], color: 'var(--accent-rust)', icon: Clock },
  { id: 'live', label: 'Live', dbStatuses: ['live'], color: 'var(--status-success)', icon: ShoppingCart },
];

// ─── Page ────────────────────────────────────────────────────────────────

export default function KdpPlaybook() {
  const [activeStep, setActiveStep] = useState<StepId>('select');
  const [candidates, setCandidates] = useState<KdpCandidate[]>([]);
  const [publications, setPublications] = useState<KdpPublication[]>([]);
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [scoring, setScoring] = useState(false);

  // Filters (select step)
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

  const refresh = useCallback(async () => {
    await Promise.all([fetchCandidates(), fetchPublications()]);
  }, [fetchCandidates, fetchPublications]);

  useEffect(() => {
    refresh().finally(() => setLoading(false));
  }, [refresh]);

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

  async function handleStartPublishing(bookId: string) {
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
      const data = await res.json();
      // Advance to review status
      await fetch(`/api/admin/kdp/publications/${data.publication.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'review' }),
      });
      toast.success('Added to review');
      await refresh();
      setActiveStep('review');
    } catch {
      toast.error('Failed to start publishing');
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
      await refresh();
    } catch {
      toast.error('Failed to update');
    }
  }

  // Derived data: count publications per step
  const stepCounts: Record<StepId, number> = {
    select: candidates.filter(c => !c.publication).length,
    review: publications.filter(p => p.status === 'review').length,
    upload: publications.filter(p => ['packaging', 'ready'].includes(p.status)).length,
    pending: publications.filter(p => p.status === 'uploaded').length,
    live: publications.filter(p => p.status === 'live').length,
  };

  const pubsForStep = (step: StepId) => {
    const dbStatuses = STEPS.find(s => s.id === step)?.dbStatuses || [];
    return publications.filter(p => dbStatuses.includes(p.status));
  };

  const allCategories = [...new Set(candidates.flatMap(c => c.categories))].sort();
  const allLanguages = [...new Set(candidates.map(c => c.language))].sort();

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
            <BookMarked className="w-5 h-5" style={{ color: 'var(--accent-gold)' }} />
            <h1 className="font-serif text-xl" style={{ color: 'var(--text-primary)' }}>
              KDP Publishing Playbook
            </h1>
          </div>
          <button
            onClick={() => { handleRefreshScores(); }}
            disabled={scoring}
            className="flex items-center gap-2 px-3 py-1.5 rounded-lg border text-sm"
            style={{ borderColor: 'var(--border-medium)', color: 'var(--text-muted)' }}
          >
            <RefreshCw className={`w-4 h-4 ${scoring ? 'animate-spin' : ''}`} />
            Refresh
          </button>
        </div>
      </header>

      {loading ? (
        <div className="py-24"><BookLoader size="xs" /></div>
      ) : (
        <main className="max-w-6xl mx-auto px-4 py-6 space-y-6">
          {/* Pipeline Stepper */}
          <div
            className="rounded-xl border p-4"
            style={{ borderColor: 'var(--border-light)', background: 'white' }}
          >
            <div className="flex items-center justify-between gap-1 md:gap-2">
              {STEPS.map((step, i) => {
                const isActive = activeStep === step.id;
                const count = stepCounts[step.id];
                const StepIcon = step.icon;
                return (
                  <div key={step.id} className="flex items-center flex-1">
                    <button
                      onClick={() => setActiveStep(step.id)}
                      className="flex flex-col items-center gap-1 flex-1 py-2 rounded-lg transition-all"
                      style={{
                        background: isActive
                          ? `color-mix(in srgb, ${step.color} 10%, transparent)`
                          : 'transparent',
                      }}
                    >
                      <div
                        className="w-8 h-8 rounded-full flex items-center justify-center transition-colors"
                        style={{
                          background: isActive ? step.color : 'var(--bg-warm)',
                          color: isActive ? 'white' : 'var(--text-muted)',
                        }}
                      >
                        <StepIcon className="w-4 h-4" />
                      </div>
                      <span
                        className="text-xs font-medium"
                        style={{ color: isActive ? step.color : 'var(--text-muted)' }}
                      >
                        {step.label}
                      </span>
                      <span
                        className="text-[10px] tabular-nums px-1.5 py-0.5 rounded-full"
                        style={{
                          background: isActive
                            ? `color-mix(in srgb, ${step.color} 15%, transparent)`
                            : 'var(--bg-warm)',
                          color: isActive ? step.color : 'var(--text-faint)',
                        }}
                      >
                        {count}
                      </span>
                    </button>
                    {i < STEPS.length - 1 && (
                      <ArrowRight
                        className="w-4 h-4 flex-shrink-0 mx-0.5"
                        style={{ color: 'var(--border-medium)' }}
                      />
                    )}
                  </div>
                );
              })}
            </div>
          </div>

          {/* Stats Row */}
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
                value={stepCounts.review + stepCounts.upload + stepCounts.pending}
                sub="review + upload + pending"
                icon={<Package className="w-4 h-4" />}
                color="var(--accent-rust)"
              />
              <StatCard
                label="Published"
                value={stepCounts.live}
                sub={stepCounts.live > 0
                  ? `${publications.filter(p => p.status === 'live' && p.asin).length} with ASIN`
                  : 'none yet'}
                icon={<Award className="w-4 h-4" />}
                color="var(--status-success)"
              />
            </div>
          )}

          {/* Step Workspace */}
          {activeStep === 'select' && (
            <SelectStep
              candidates={candidates}
              allCategories={allCategories}
              allLanguages={allLanguages}
              minScore={minScore}
              setMinScore={setMinScore}
              categoryFilter={categoryFilter}
              setCategoryFilter={setCategoryFilter}
              languageFilter={languageFilter}
              setLanguageFilter={setLanguageFilter}
              onStartPublishing={handleStartPublishing}
            />
          )}

          {activeStep === 'review' && (
            <ReviewStep
              publications={pubsForStep('review')}
              onUpdate={handleUpdatePublication}
              onRefresh={refresh}
            />
          )}

          {activeStep === 'upload' && (
            <UploadStep
              publications={pubsForStep('upload')}
              onUpdate={handleUpdatePublication}
            />
          )}

          {activeStep === 'pending' && (
            <PendingStep
              publications={pubsForStep('pending')}
              onUpdate={handleUpdatePublication}
            />
          )}

          {activeStep === 'live' && (
            <LiveStep publications={pubsForStep('live')} />
          )}
        </main>
      )}
    </div>
  );
}

// ─── SELECT Step ────────────────────────────────────────────────────────

function SelectStep({
  candidates, allCategories, allLanguages,
  minScore, setMinScore, categoryFilter, setCategoryFilter,
  languageFilter, setLanguageFilter, onStartPublishing,
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
  onStartPublishing: (bookId: string) => void;
}) {
  // Only show unpublished candidates
  const unpublished = candidates.filter(c => !c.publication);

  return (
    <div className="space-y-4">
      {/* Playbook instruction */}
      <PlaybookBox>
        Pick books scoring 70+ with full translations. Prefer first translations
        and books with gallery images. Click &quot;Start Publishing&quot; to move a book to Review.
      </PlaybookBox>

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
          Min:
          <input
            type="number"
            value={minScore || ''}
            onChange={e => setMinScore(parseInt(e.target.value) || 0)}
            className="w-14 px-2 py-1 rounded border text-sm"
            style={{ borderColor: 'var(--border-light)', background: 'white', color: 'var(--text-secondary)' }}
            placeholder="0"
            min={0}
            max={100}
          />
        </label>
      </div>

      {/* Table */}
      <Section title={`Candidates (${unpublished.length})`}>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr style={{ color: 'var(--text-muted)' }}>
                <th className="text-left py-2 pr-2 w-8">#</th>
                <th className="text-left py-2 pr-2">Book</th>
                <th className="text-right py-2 px-2">Score</th>
                <th className="text-right py-2 px-2">Trans</th>
                <th className="text-center py-2 px-1" title="Summary">S</th>
                <th className="text-center py-2 px-1" title="Index">I</th>
                <th className="text-center py-2 px-1" title="Chapters">C</th>
                <th className="text-center py-2 px-1" title="Cover">Cv</th>
                <th className="text-left py-2 px-2">Lang</th>
                <th className="text-right py-2 pl-2">Action</th>
              </tr>
            </thead>
            <tbody>
              {unpublished.map((c, i) => (
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
                          style={{ color: 'var(--text-primary)', maxWidth: '260px' }}
                        >
                          {c.title}
                        </a>
                        <span className="text-xs truncate block" style={{ color: 'var(--text-faint)', maxWidth: '260px' }}>
                          {c.author} ({c.published})
                        </span>
                      </div>
                    </div>
                  </td>
                  <td className="py-2 px-2 text-right">
                    <ScoreBadge score={c.kdp_score} breakdown={c.kdp_score_breakdown} />
                  </td>
                  <td className="py-2 px-2 text-right tabular-nums" style={{ color: c.translation_pct >= 90 ? 'var(--accent-sage-dark)' : 'var(--text-muted)' }}>
                    {c.translation_pct}%
                  </td>
                  <td className="py-2 px-1 text-center">
                    <QualityDot ok={c.quality_indicators?.has_summary ?? c.translation_pct > 50} title="Summary" />
                  </td>
                  <td className="py-2 px-1 text-center">
                    <QualityDot ok={c.quality_indicators?.has_index ?? false} title="Index" />
                  </td>
                  <td className="py-2 px-1 text-center">
                    <QualityDot ok={c.quality_indicators?.has_chapters ?? false} title="Chapters" />
                  </td>
                  <td className="py-2 px-1 text-center">
                    <QualityDot ok={c.quality_indicators?.has_cover ?? !!c.thumbnail} title="Cover" />
                  </td>
                  <td className="py-2 px-2 text-xs" style={{ color: 'var(--text-muted)' }}>
                    {c.language}
                  </td>
                  <td className="py-2 pl-2 text-right">
                    <button
                      onClick={() => onStartPublishing(c.id)}
                      className="text-xs px-2.5 py-1 rounded-lg border whitespace-nowrap font-medium"
                      style={{ borderColor: 'var(--accent-sage)', color: 'var(--accent-sage)' }}
                    >
                      Start Publishing <ArrowRight className="w-3 h-3 inline ml-0.5" />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {unpublished.length === 0 && (
          <p className="text-sm py-8 text-center" style={{ color: 'var(--text-faint)' }}>
            No unpublished candidates. All scored books are already in the pipeline.
          </p>
        )}
      </Section>
    </div>
  );
}

// ─── REVIEW Step ────────────────────────────────────────────────────────

function ReviewStep({
  publications, onUpdate, onRefresh,
}: {
  publications: KdpPublication[];
  onUpdate: (id: string, updates: Record<string, unknown>) => void;
  onRefresh: () => Promise<void>;
}) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editMeta, setEditMeta] = useState<Record<string, string>>({});
  const [editKeywords, setEditKeywords] = useState<string[]>([]);
  const [generatingBundle, setGeneratingBundle] = useState<string | null>(null);
  const [rejectingId, setRejectingId] = useState<string | null>(null);
  const [rejectReason, setRejectReason] = useState('');

  function startEdit(pub: KdpPublication) {
    setEditingId(pub.id);
    setEditMeta({
      title: pub.kdp_metadata.title,
      subtitle: pub.kdp_metadata.subtitle,
      author: pub.kdp_metadata.author,
      description: pub.kdp_metadata.description,
    });
    setEditKeywords([...pub.kdp_metadata.keywords]);
  }

  function saveEdit(pub: KdpPublication) {
    onUpdate(pub.id, {
      kdp_metadata: {
        ...pub.kdp_metadata,
        title: editMeta.title,
        subtitle: editMeta.subtitle,
        author: editMeta.author,
        description: editMeta.description,
        keywords: editKeywords,
      },
    });
    setEditingId(null);
  }

  async function handleGenerateBundle(pubId: string) {
    setGeneratingBundle(pubId);
    try {
      const res = await fetch(`/api/admin/kdp/bundle/${pubId}`);
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: 'Download failed' }));
        throw new Error(err.error || 'Download failed');
      }
      // Download the ZIP
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      const disposition = res.headers.get('content-disposition');
      const filename = disposition?.match(/filename="?(.+?)"?$/)?.[1] || 'kdp-bundle.zip';
      a.download = filename;
      a.click();
      URL.revokeObjectURL(url);

      // Advance to packaging/ready
      await onUpdate(pubId, { status: 'ready' });
      toast.success('Bundle downloaded! Ready for upload.');
      await onRefresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to generate bundle');
    } finally {
      setGeneratingBundle(null);
    }
  }

  function handleReject(pubId: string) {
    onUpdate(pubId, { status: 'rejected', notes: rejectReason || 'Rejected during review' });
    setRejectingId(null);
    setRejectReason('');
  }

  return (
    <div className="space-y-4">
      <PlaybookBox>
        Review each book before generating the KDP bundle. Check translation quality,
        verify metadata, and ensure the cover looks good. Fix any issues before proceeding.
      </PlaybookBox>

      {publications.length === 0 ? (
        <EmptyState>
          No books in review. Select a candidate to start the publishing process.
        </EmptyState>
      ) : (
        <div className="space-y-6">
          {publications.map(pub => {
            const isEditing = editingId === pub.id;
            const isRejecting = rejectingId === pub.id;
            const flags = pub.quality_flags;

            return (
              <div
                key={pub.id}
                className="rounded-xl border overflow-hidden"
                style={{ borderColor: 'var(--border-light)', background: 'white' }}
              >
                {/* Header */}
                <div className="p-4 flex items-start justify-between gap-3" style={{ borderBottom: '1px solid var(--border-light)' }}>
                  <div className="flex items-center gap-3 min-w-0">
                    {pub.book?.thumbnail && (
                      <img src={pub.book.thumbnail} alt="" className="w-12 h-16 object-cover rounded" />
                    )}
                    <div className="min-w-0">
                      <h3 className="font-serif text-lg" style={{ color: 'var(--text-primary)' }}>
                        {pub.book?.title || pub.kdp_metadata.title}
                      </h3>
                      <p className="text-sm" style={{ color: 'var(--text-muted)' }}>
                        {pub.book?.author} &middot; Score: {pub.kdp_score_snapshot}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 flex-shrink-0">
                    <a
                      href={`https://sourcelibrary.org/book/${pub.book?.slug || pub.book_id}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-xs flex items-center gap-1 px-2 py-1 rounded"
                      style={{ color: 'var(--accent-rust)' }}
                    >
                      Read full translation <ExternalLink className="w-3 h-3" />
                    </a>
                  </div>
                </div>

                <div className="p-4 grid md:grid-cols-2 gap-6">
                  {/* Left: Metadata */}
                  <div className="space-y-4">
                    <div className="flex items-center justify-between">
                      <h4 className="text-xs font-medium uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>
                        KDP Metadata
                      </h4>
                      {!isEditing ? (
                        <button
                          onClick={() => startEdit(pub)}
                          className="text-xs px-2 py-0.5 rounded border"
                          style={{ borderColor: 'var(--border-light)', color: 'var(--accent-violet)' }}
                        >
                          Edit
                        </button>
                      ) : (
                        <div className="flex gap-1">
                          <button
                            onClick={() => saveEdit(pub)}
                            className="text-xs px-2 py-0.5 rounded border"
                            style={{ borderColor: 'var(--accent-sage)', color: 'var(--accent-sage)' }}
                          >
                            Save
                          </button>
                          <button
                            onClick={() => setEditingId(null)}
                            className="text-xs px-2 py-0.5 rounded border"
                            style={{ borderColor: 'var(--border-light)', color: 'var(--text-faint)' }}
                          >
                            Cancel
                          </button>
                        </div>
                      )}
                    </div>

                    {isEditing ? (
                      <div className="space-y-3">
                        <MetaInput label="Title" value={editMeta.title} onChange={v => setEditMeta(m => ({ ...m, title: v }))} />
                        <MetaInput label="Subtitle" value={editMeta.subtitle} onChange={v => setEditMeta(m => ({ ...m, subtitle: v }))} />
                        <MetaInput label="Author" value={editMeta.author} onChange={v => setEditMeta(m => ({ ...m, author: v }))} />
                        <div>
                          <label className="text-xs block mb-0.5" style={{ color: 'var(--text-faint)' }}>Description</label>
                          <textarea
                            value={editMeta.description}
                            onChange={e => setEditMeta(m => ({ ...m, description: e.target.value }))}
                            className="w-full px-2 py-1.5 rounded border text-sm"
                            style={{ borderColor: 'var(--border-light)', background: 'var(--bg-cream)', color: 'var(--text-primary)' }}
                            rows={4}
                          />
                        </div>
                        <div>
                          <label className="text-xs block mb-0.5" style={{ color: 'var(--text-faint)' }}>Keywords (max 7)</label>
                          <div className="flex flex-wrap gap-1.5">
                            {editKeywords.map((kw, i) => (
                              <span
                                key={i}
                                className="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full border"
                                style={{ borderColor: 'var(--border-light)', color: 'var(--text-secondary)' }}
                              >
                                {kw}
                                <button onClick={() => setEditKeywords(k => k.filter((_, j) => j !== i))}>
                                  <X className="w-3 h-3" />
                                </button>
                              </span>
                            ))}
                            {editKeywords.length < 7 && (
                              <button
                                onClick={() => {
                                  const kw = prompt('Add keyword:');
                                  if (kw) setEditKeywords(k => [...k, kw]);
                                }}
                                className="text-xs px-2 py-0.5 rounded-full border"
                                style={{ borderColor: 'var(--border-light)', color: 'var(--text-faint)' }}
                              >
                                <Plus className="w-3 h-3 inline" /> Add
                              </button>
                            )}
                          </div>
                        </div>
                      </div>
                    ) : (
                      <div className="space-y-2 text-sm">
                        <MetaRow label="Title" value={pub.kdp_metadata.title} />
                        <MetaRow label="Subtitle" value={pub.kdp_metadata.subtitle} />
                        <MetaRow label="Author" value={pub.kdp_metadata.author} />
                        <MetaRow label="Description" value={pub.kdp_metadata.description ? (pub.kdp_metadata.description.slice(0, 200) + (pub.kdp_metadata.description.length > 200 ? '...' : '')) : 'None'} />
                        <div>
                          <span className="text-xs" style={{ color: 'var(--text-faint)' }}>Keywords: </span>
                          <span style={{ color: 'var(--text-secondary)' }}>
                            {pub.kdp_metadata.keywords.join(', ') || 'None'}
                          </span>
                        </div>
                        <MetaRow label="Categories" value={pub.kdp_metadata.categories.join(', ')} />
                        <MetaRow label="Price" value={pub.kdp_metadata.price} />
                        <details className="mt-1">
                          <summary className="text-xs cursor-pointer" style={{ color: 'var(--text-faint)' }}>
                            AI Disclosure
                          </summary>
                          <p className="text-xs mt-1 p-2 rounded" style={{ background: 'var(--bg-warm)', color: 'var(--text-muted)' }}>
                            {pub.kdp_metadata.ai_disclosure}
                          </p>
                        </details>
                      </div>
                    )}
                  </div>

                  {/* Right: Quality Checklist */}
                  <div className="space-y-4">
                    <h4 className="text-xs font-medium uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>
                      Quality Checklist
                    </h4>

                    <div className="space-y-2">
                      <ChecklistItem
                        ok={!flags || flags.translation_percent >= 90}
                        label={`Translation ${flags ? `${flags.translation_percent}%` : ''} complete`}
                        warning={flags && flags.translation_percent < 90 ? 'This book has untranslated pages' : undefined}
                      />
                      <ChecklistItem
                        ok={flags?.has_summary ?? true}
                        label="Has reading summary"
                        warning={flags && !flags.has_summary ? 'No description available for Amazon listing' : undefined}
                      />
                      <ChecklistItem
                        ok={flags?.has_index ?? true}
                        label="Has book index"
                      />
                      <ChecklistItem
                        ok={flags?.has_chapters ?? true}
                        label="Has chapters extracted"
                        warning={flags && !flags.has_chapters ? "Book won't have chapter navigation on Kindle" : undefined}
                      />
                      <ChecklistItem
                        ok={flags?.has_cover ?? !!pub.book?.thumbnail}
                        label="Cover image selected"
                      />
                      <ChecklistItem
                        ok={!flags || flags.flagged_pages === 0}
                        label={flags?.flagged_pages ? `${flags.flagged_pages} pages flagged` : 'No flagged quality issues'}
                        warning={flags && flags.flagged_pages > 0 ? `${flags.flagged_pages} pages may have missing translations` : undefined}
                      />
                      {flags?.low_quality && (
                        <div className="flex items-start gap-2 text-xs p-2 rounded" style={{ background: 'color-mix(in srgb, var(--status-warning) 10%, transparent)' }}>
                          <AlertTriangle className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" style={{ color: 'var(--status-warning)' }} />
                          <span style={{ color: 'var(--status-warning)' }}>Low quality score — review carefully</span>
                        </div>
                      )}
                    </div>

                    {/* Cover preview */}
                    <div>
                      <h4 className="text-xs font-medium uppercase tracking-wider mb-2" style={{ color: 'var(--text-muted)' }}>
                        Cover Preview
                      </h4>
                      <div
                        className="w-32 h-20 rounded border overflow-hidden flex items-center justify-center"
                        style={{ borderColor: 'var(--border-light)', background: 'var(--bg-warm)' }}
                      >
                        {(pub.cover_image_url || pub.book?.thumbnail) ? (
                          <img
                            src={pub.cover_image_url || pub.book?.thumbnail}
                            alt="Cover source"
                            className="w-full h-full object-cover"
                          />
                        ) : (
                          <ImageIcon className="w-6 h-6" style={{ color: 'var(--text-faint)' }} />
                        )}
                      </div>
                      <p className="text-[10px] mt-1" style={{ color: 'var(--text-faint)' }}>
                        Cover will be generated at 2560x1600 with title overlay
                      </p>
                    </div>
                  </div>
                </div>

                {/* Actions bar */}
                <div
                  className="px-4 py-3 flex items-center justify-between gap-3"
                  style={{ background: 'var(--bg-warm)', borderTop: '1px solid var(--border-light)' }}
                >
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => onUpdate(pub.id, { status: 'candidate' })}
                      className="text-xs px-3 py-1.5 rounded-lg border"
                      style={{ borderColor: 'var(--border-medium)', color: 'var(--text-muted)' }}
                    >
                      Back to Select
                    </button>
                    {isRejecting ? (
                      <div className="flex items-center gap-2">
                        <input
                          value={rejectReason}
                          onChange={e => setRejectReason(e.target.value)}
                          placeholder="Reason (optional)"
                          className="text-xs px-2 py-1 rounded border w-40"
                          style={{ borderColor: 'var(--border-light)', background: 'white', color: 'var(--text-primary)' }}
                        />
                        <button
                          onClick={() => handleReject(pub.id)}
                          className="text-xs px-2 py-1 rounded-lg"
                          style={{ background: 'var(--status-error)', color: 'white' }}
                        >
                          Confirm Reject
                        </button>
                        <button
                          onClick={() => setRejectingId(null)}
                          className="text-xs px-2 py-1"
                          style={{ color: 'var(--text-faint)' }}
                        >
                          Cancel
                        </button>
                      </div>
                    ) : (
                      <button
                        onClick={() => setRejectingId(pub.id)}
                        className="text-xs px-3 py-1.5 rounded-lg border"
                        style={{ borderColor: 'var(--status-error)', color: 'var(--status-error)' }}
                      >
                        <X className="w-3 h-3 inline mr-0.5" />
                        Reject
                      </button>
                    )}
                  </div>
                  <button
                    onClick={() => handleGenerateBundle(pub.id)}
                    disabled={generatingBundle === pub.id}
                    className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium text-white"
                    style={{ background: generatingBundle === pub.id ? 'var(--text-muted)' : 'var(--accent-sage-dark)' }}
                  >
                    {generatingBundle === pub.id ? (
                      <>
                        <RefreshCw className="w-4 h-4 animate-spin" />
                        Generating...
                      </>
                    ) : (
                      <>
                        <Download className="w-4 h-4" />
                        Generate Bundle
                      </>
                    )}
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ─── UPLOAD Step ─────────────────────────────────────────────────────────

function UploadStep({
  publications, onUpdate,
}: {
  publications: KdpPublication[];
  onUpdate: (id: string, updates: Record<string, unknown>) => void;
}) {
  return (
    <div className="space-y-4">
      <PlaybookBox>
        Follow these steps for each book. Copy the metadata fields below, upload the files
        from your downloaded bundle, and submit to KDP.
      </PlaybookBox>

      {/* Numbered instructions */}
      <Section title="Upload Instructions">
        <div className="space-y-2">
          {[
            'Go to kdp.amazon.com → Bookshelf → Create New Title → Kindle eBook',
            'Copy the fields below into KDP (click each field to copy)',
            'Upload the EPUB file from your downloaded bundle',
            'Upload the cover image from your downloaded bundle',
            'Set price to $2.99, select all territories',
            'Click Publish',
          ].map((step, i) => (
            <div key={i} className="flex items-start gap-3">
              <span
                className="w-6 h-6 rounded-full flex items-center justify-center flex-shrink-0 text-xs font-medium"
                style={{ background: 'var(--accent-sage)', color: 'white' }}
              >
                {i + 1}
              </span>
              <span className="text-sm pt-0.5" style={{ color: 'var(--text-primary)' }}>{step}</span>
            </div>
          ))}
        </div>
      </Section>

      {publications.length === 0 ? (
        <EmptyState>
          No books ready for upload. Generate a bundle in the Review step first.
        </EmptyState>
      ) : (
        publications.map(pub => (
          <div
            key={pub.id}
            className="rounded-xl border overflow-hidden"
            style={{ borderColor: 'var(--border-light)', background: 'white' }}
          >
            <div className="p-4" style={{ borderBottom: '1px solid var(--border-light)' }}>
              <div className="flex items-center gap-3">
                {pub.book?.thumbnail && (
                  <img src={pub.book.thumbnail} alt="" className="w-10 h-12 object-cover rounded" />
                )}
                <div>
                  <h3 className="font-medium" style={{ color: 'var(--text-primary)' }}>
                    {pub.book?.title || pub.kdp_metadata.title}
                  </h3>
                  <p className="text-xs" style={{ color: 'var(--text-faint)' }}>
                    {pub.book?.author}
                  </p>
                </div>
              </div>
            </div>

            {/* Copy-paste metadata fields */}
            <div className="p-4 space-y-2">
              <h4 className="text-xs font-medium uppercase tracking-wider mb-3" style={{ color: 'var(--text-muted)' }}>
                Copy-Paste Fields
              </h4>
              <CopyField label="Title" value={pub.kdp_metadata.title} />
              <CopyField label="Subtitle" value={pub.kdp_metadata.subtitle} />
              <CopyField label="Author" value={pub.kdp_metadata.author} />
              <CopyField label="Description" value={pub.kdp_metadata.description} multiline />
              {pub.kdp_metadata.keywords.map((kw, i) => (
                <CopyField key={i} label={`Keyword ${i + 1}`} value={kw} />
              ))}
              <CopyField label="AI Disclosure" value={pub.kdp_metadata.ai_disclosure} multiline />

              {/* Re-download bundle */}
              <div className="pt-3 flex items-center gap-3">
                <a
                  href={`/api/admin/kdp/bundle/${pub.id}`}
                  className="text-xs flex items-center gap-1.5 px-3 py-1.5 rounded-lg border"
                  style={{ borderColor: 'var(--border-medium)', color: 'var(--text-muted)' }}
                >
                  <Download className="w-3.5 h-3.5" />
                  Download Bundle Again
                </a>
              </div>
            </div>

            {/* Action */}
            <div
              className="px-4 py-3 flex justify-end"
              style={{ background: 'var(--bg-warm)', borderTop: '1px solid var(--border-light)' }}
            >
              <button
                onClick={() => onUpdate(pub.id, { status: 'uploaded' })}
                className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium text-white"
                style={{ background: 'var(--accent-rust)' }}
              >
                I&apos;ve Submitted to KDP <ArrowRight className="w-4 h-4" />
              </button>
            </div>
          </div>
        ))
      )}
    </div>
  );
}

// ─── PENDING Step ────────────────────────────────────────────────────────

function PendingStep({
  publications, onUpdate,
}: {
  publications: KdpPublication[];
  onUpdate: (id: string, updates: Record<string, unknown>) => void;
}) {
  const [asinInputs, setAsinInputs] = useState<Record<string, string>>({});

  function handleMarkLive(pub: KdpPublication) {
    const asin = asinInputs[pub.id]?.trim();
    if (!asin) {
      toast.error('ASIN is required');
      return;
    }
    onUpdate(pub.id, {
      status: 'live',
      asin,
      kindle_url: `https://www.amazon.com/dp/${asin}`,
    });
  }

  return (
    <div className="space-y-4">
      <PlaybookBox>
        Amazon is reviewing these books. This usually takes 24-72 hours.
        Check your KDP dashboard for approval, then enter the ASIN and mark as Live.
      </PlaybookBox>

      {publications.length === 0 ? (
        <EmptyState>
          No books pending Amazon review.
        </EmptyState>
      ) : (
        <Section title={`Awaiting Amazon Review (${publications.length})`}>
          <div className="space-y-3">
            {publications.map(pub => {
              const daysWaiting = Math.floor((Date.now() - new Date(pub.updated_at).getTime()) / (1000 * 60 * 60 * 24));

              return (
                <div
                  key={pub.id}
                  className="p-4 rounded-lg border"
                  style={{ borderColor: 'var(--border-light)', background: 'var(--bg-warm)' }}
                >
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex items-center gap-3 min-w-0">
                      {pub.book?.thumbnail && (
                        <img src={pub.book.thumbnail} alt="" className="w-10 h-12 object-cover rounded" />
                      )}
                      <div className="min-w-0">
                        <h3 className="text-sm font-medium truncate" style={{ color: 'var(--text-primary)' }}>
                          {pub.book?.title || pub.kdp_metadata.title}
                        </h3>
                        <p className="text-xs flex items-center gap-2" style={{ color: 'var(--text-faint)' }}>
                          <Clock className="w-3 h-3" />
                          Submitted {daysWaiting === 0 ? 'today' : `${daysWaiting} day${daysWaiting !== 1 ? 's' : ''} ago`}
                        </p>
                      </div>
                    </div>

                    <div className="flex items-center gap-2 flex-shrink-0">
                      <input
                        value={asinInputs[pub.id] || ''}
                        onChange={e => setAsinInputs(s => ({ ...s, [pub.id]: e.target.value }))}
                        placeholder="B0XXXXXXXX"
                        className="text-sm px-2 py-1.5 rounded border w-32"
                        style={{ borderColor: 'var(--border-light)', background: 'white', color: 'var(--text-primary)' }}
                      />
                      <button
                        onClick={() => handleMarkLive(pub)}
                        className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium text-white"
                        style={{ background: 'var(--status-success)' }}
                      >
                        <Check className="w-4 h-4" />
                        Mark as Live
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </Section>
      )}
    </div>
  );
}

// ─── LIVE Step ───────────────────────────────────────────────────────────

function LiveStep({ publications }: { publications: KdpPublication[] }) {
  return (
    <div className="space-y-4">
      {publications.length > 0 && (
        <div className="flex items-center gap-4 text-sm" style={{ color: 'var(--text-muted)' }}>
          <span>
            Total live: <strong style={{ color: 'var(--text-primary)' }}>{publications.length}</strong>
          </span>
          <span>
            Avg score: <strong style={{ color: 'var(--text-primary)' }}>
              {Math.round(publications.reduce((s, p) => s + p.kdp_score_snapshot, 0) / publications.length)}
            </strong>
          </span>
        </div>
      )}

      {publications.length === 0 ? (
        <EmptyState>
          No books published yet. Move candidates through the pipeline.
        </EmptyState>
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
                <a
                  href={`https://sourcelibrary.org/book/${pub.book?.slug || pub.book_id}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-xs flex items-center gap-1 px-2 py-1 rounded"
                  style={{ background: 'color-mix(in srgb, var(--accent-violet) 12%, transparent)', color: 'var(--accent-violet)' }}
                >
                  <BookOpen className="w-3 h-3" />
                  Source Library
                  <ExternalLink className="w-3 h-3" />
                </a>
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

function PlaybookBox({ children }: { children: React.ReactNode }) {
  return (
    <div
      className="p-3 rounded-lg text-sm border-l-4"
      style={{
        background: 'var(--bg-warm)',
        borderLeftColor: 'var(--accent-gold)',
        color: 'var(--text-secondary)',
      }}
    >
      <div className="flex items-start gap-2">
        <FileText className="w-4 h-4 flex-shrink-0 mt-0.5" style={{ color: 'var(--accent-gold)' }} />
        <span>{children}</span>
      </div>
    </div>
  );
}

function EmptyState({ children }: { children: React.ReactNode }) {
  return (
    <p className="text-sm py-8 text-center" style={{ color: 'var(--text-faint)' }}>
      {children}
    </p>
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

function QualityDot({ ok, title }: { ok: boolean; title: string }) {
  return (
    <span
      className="inline-block w-3 h-3 rounded-full"
      style={{ background: ok ? 'var(--status-success)' : 'var(--border-medium)' }}
      title={title}
    />
  );
}

function ChecklistItem({ ok, label, warning }: { ok: boolean; label: string; warning?: string }) {
  return (
    <div className="flex items-start gap-2">
      {ok ? (
        <CheckCircle className="w-4 h-4 flex-shrink-0 mt-0.5" style={{ color: 'var(--status-success)' }} />
      ) : (
        <AlertTriangle className="w-4 h-4 flex-shrink-0 mt-0.5" style={{ color: 'var(--status-warning)' }} />
      )}
      <div>
        <span className="text-sm" style={{ color: ok ? 'var(--text-primary)' : 'var(--status-warning)' }}>
          {label}
        </span>
        {warning && (
          <p className="text-xs mt-0.5" style={{ color: 'var(--status-warning)' }}>{warning}</p>
        )}
      </div>
    </div>
  );
}

function MetaRow({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <span className="text-xs" style={{ color: 'var(--text-faint)' }}>{label}: </span>
      <span style={{ color: 'var(--text-secondary)' }}>{value || 'None'}</span>
    </div>
  );
}

function MetaInput({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <div>
      <label className="text-xs block mb-0.5" style={{ color: 'var(--text-faint)' }}>{label}</label>
      <input
        value={value}
        onChange={e => onChange(e.target.value)}
        className="w-full px-2 py-1.5 rounded border text-sm"
        style={{ borderColor: 'var(--border-light)', background: 'var(--bg-cream)', color: 'var(--text-primary)' }}
      />
    </div>
  );
}

function CopyField({ label, value, multiline }: { label: string; value: string; multiline?: boolean }) {
  const [copied, setCopied] = useState(false);

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.error('Failed to copy');
    }
  }

  return (
    <div
      className="flex items-start gap-2 p-2 rounded border cursor-pointer group"
      style={{ borderColor: 'var(--border-light)', background: 'var(--bg-cream)' }}
      onClick={handleCopy}
    >
      <div className="flex-1 min-w-0">
        <span className="text-[10px] uppercase tracking-wider block" style={{ color: 'var(--text-faint)' }}>
          {label}
        </span>
        <span
          className={`text-sm block ${multiline ? '' : 'truncate'}`}
          style={{ color: 'var(--text-primary)' }}
        >
          {multiline ? (value.length > 200 ? value.slice(0, 200) + '...' : value) : value}
        </span>
      </div>
      <button className="flex-shrink-0 p-1 rounded" style={{ color: copied ? 'var(--status-success)' : 'var(--text-faint)' }}>
        {copied ? <Check className="w-3.5 h-3.5" /> : <Clipboard className="w-3.5 h-3.5" />}
      </button>
    </div>
  );
}
