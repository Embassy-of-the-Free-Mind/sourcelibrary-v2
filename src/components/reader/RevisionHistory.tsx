'use client';

import { useState, useEffect, useRef } from 'react';
import { History, RotateCcw, X, ChevronDown, Pencil } from 'lucide-react';
import type { PageRevision } from '@/lib/page-revisions';

interface RevisionHistoryProps {
  pageId: string;
  field: 'ocr' | 'translation';
  currentSource?: string;
  editedBy?: string;
  editedAt?: Date | string;
  model?: string;
}

function formatDate(date: string | Date) {
  const d = new Date(date);
  const now = new Date();
  const diffMs = now.getTime() - d.getTime();
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

  if (diffDays === 0) return 'Today ' + d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  if (diffDays === 1) return 'Yesterday';
  if (diffDays < 7) return `${diffDays}d ago`;
  return d.toLocaleDateString([], { month: 'short', day: 'numeric', year: d.getFullYear() !== now.getFullYear() ? 'numeric' : undefined });
}

function truncate(text: string, len: number) {
  if (text.length <= len) return text;
  return text.slice(0, len) + '...';
}

function SourceBadge({ source }: { source: string }) {
  const styles: Record<string, { bg: string; color: string; label: string }> = {
    ai: { bg: 'rgba(124, 93, 181, 0.1)', color: 'var(--accent-violet)', label: 'AI' },
    batch_api: { bg: 'rgba(124, 93, 181, 0.1)', color: 'var(--accent-violet)', label: 'Batch' },
    manual: { bg: 'rgba(139, 154, 125, 0.15)', color: 'var(--accent-sage)', label: 'Manual' },
    contributor: { bg: 'rgba(201, 168, 108, 0.15)', color: 'var(--accent-gold-dark)', label: 'Contrib' },
  };
  const s = styles[source] || styles.ai;

  return (
    <span
      className="px-1.5 py-0.5 rounded text-[10px] font-medium"
      style={{ background: s.bg, color: s.color }}
    >
      {s.label}
    </span>
  );
}

export default function RevisionHistory({ pageId, field, currentSource, editedBy, editedAt, model }: RevisionHistoryProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [revisions, setRevisions] = useState<PageRevision[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [restoring, setRestoring] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!isOpen) return;
    setLoading(true);
    fetch(`/api/pages/${pageId}/revisions?field=${field}&limit=20`)
      .then(r => r.json())
      .then(data => {
        setRevisions(data.revisions || []);
        setTotal(data.total || 0);
      })
      .catch(() => setRevisions([]))
      .finally(() => setLoading(false));
  }, [isOpen, pageId, field]);

  // Close on outside click
  useEffect(() => {
    if (!isOpen) return;
    function handleClick(e: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [isOpen]);

  async function handleRestore(revisionId: string) {
    setRestoring(revisionId);
    try {
      const res = await fetch(`/api/pages/${pageId}/revisions/${revisionId}/restore`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ restoredBy: 'User' }),
      });
      if (res.ok) {
        // Reload the page to show restored content
        window.location.reload();
      }
    } catch {
      // ignore
    } finally {
      setRestoring(null);
    }
  }

  return (
    <div className="relative" ref={dropdownRef}>
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="flex items-center gap-1.5 px-2 py-1 rounded text-[10px] font-medium transition-colors hover:bg-stone-100"
        style={{ color: 'var(--text-muted)' }}
        title={`${field === 'ocr' ? 'OCR' : 'Translation'} source & revision history`}
      >
        {currentSource === 'manual' || currentSource === 'contributor' ? (
          <>
            <Pencil className="w-3 h-3" style={{ color: currentSource === 'contributor' ? 'var(--accent-gold-dark)' : 'var(--accent-sage)' }} />
            <span style={{ color: currentSource === 'contributor' ? 'var(--accent-gold-dark)' : 'var(--accent-sage)' }}>
              {editedBy || (currentSource === 'contributor' ? 'Contrib' : 'Edited')}
            </span>
            {editedAt && (
              <span style={{ color: 'var(--text-faint)' }}>{formatDate(editedAt)}</span>
            )}
          </>
        ) : (
          <>
            <SourceBadge source={currentSource || 'ai'} />
            {model && (
              <span style={{ color: 'var(--text-faint)' }}>
                {model.replace('gemini-', '').replace('-preview', '')}
              </span>
            )}
          </>
        )}
        <History className="w-3 h-3" style={{ color: 'var(--text-faint)' }} />
      </button>

      {isOpen && (
        <div
          className="absolute right-0 top-full mt-1 z-50 rounded-lg shadow-lg border overflow-hidden"
          style={{
            background: 'var(--bg-white, #fff)',
            borderColor: 'var(--border-light)',
            width: '340px',
            maxHeight: '400px',
          }}
        >
          {/* Header */}
          <div className="px-3 py-2 flex items-center justify-between" style={{ borderBottom: '1px solid var(--border-light)' }}>
            <span className="text-xs font-medium" style={{ color: 'var(--text-secondary)' }}>
              {field === 'ocr' ? 'OCR' : 'Translation'} History
              {total > 0 && <span className="ml-1" style={{ color: 'var(--text-muted)' }}>({total})</span>}
            </span>
            <button onClick={() => setIsOpen(false)} className="p-1.5 -mr-1 rounded hover:bg-stone-100" aria-label="Close history">
              <X className="w-3.5 h-3.5" style={{ color: 'var(--text-muted)' }} />
            </button>
          </div>

          {/* Current version */}
          <div className="px-3 py-2" style={{ background: 'rgba(139, 154, 125, 0.06)', borderBottom: '1px solid var(--border-light)' }}>
            <div className="flex items-center gap-2">
              <span className="text-[10px] font-medium px-1.5 py-0.5 rounded" style={{ background: 'rgba(139, 154, 125, 0.2)', color: 'var(--accent-sage-dark)' }}>
                Current
              </span>
              {currentSource && <SourceBadge source={currentSource} />}
            </div>
          </div>

          {/* Revision list */}
          <div className="overflow-auto" style={{ maxHeight: '300px' }}>
            {loading ? (
              <div className="p-4 text-center text-xs" style={{ color: 'var(--text-muted)' }}>
                Loading...
              </div>
            ) : revisions.length === 0 ? (
              <div className="p-4 text-center text-xs" style={{ color: 'var(--text-muted)' }}>
                No previous versions
              </div>
            ) : (
              revisions.map((rev, idx) => (
                <div
                  key={rev.id}
                  className="border-b last:border-b-0"
                  style={{ borderColor: 'var(--border-light)' }}
                >
                  <button
                    onClick={() => setExpandedId(expandedId === rev.id ? null : rev.id)}
                    className="w-full px-3 py-2 flex items-center justify-between text-left hover:bg-stone-50 transition-colors"
                  >
                    <div className="flex items-center gap-2 min-w-0">
                      <span className="text-[10px] tabular-nums" style={{ color: 'var(--text-muted)' }}>
                        v{total - idx}
                      </span>
                      <SourceBadge source={rev.source} />
                      {rev.model && (
                        <span className="text-[10px] truncate" style={{ color: 'var(--text-faint)' }}>
                          {rev.model.replace('gemini-', '').replace('-preview', '')}
                        </span>
                      )}
                      {rev.edited_by && (
                        <span className="text-[10px] truncate" style={{ color: 'var(--text-faint)' }}>
                          {rev.edited_by}
                        </span>
                      )}
                    </div>
                    <div className="flex items-center gap-1.5 flex-shrink-0">
                      <span className="text-[10px]" style={{ color: 'var(--text-faint)' }}>
                        {formatDate(rev.original_date || rev.created_at)}
                      </span>
                      <ChevronDown className={`w-3 h-3 transition-transform ${expandedId === rev.id ? 'rotate-180' : ''}`} style={{ color: 'var(--text-muted)' }} />
                    </div>
                  </button>

                  {expandedId === rev.id && (
                    <div className="px-3 pb-2">
                      {/* Preview */}
                      <div
                        className="text-[11px] leading-relaxed p-2 rounded mb-2 overflow-auto"
                        style={{
                          background: 'var(--bg-warm)',
                          color: 'var(--text-secondary)',
                          maxHeight: '120px',
                          }}
                      >
                        {truncate(rev.data, 500)}
                      </div>
                      <div className="flex items-center justify-between">
                        <span className="text-[10px]" style={{ color: 'var(--text-faint)' }}>
                          {rev.data.length.toLocaleString()} chars
                        </span>
                        <button
                          onClick={(e) => { e.stopPropagation(); handleRestore(rev.id); }}
                          disabled={restoring === rev.id}
                          className="flex items-center gap-1 px-2.5 py-1.5 rounded text-[10px] font-medium transition-colors hover:bg-accent-gold/8"
                          style={{ color: 'var(--accent-rust)' }}
                        >
                          <RotateCcw className={`w-3 h-3 ${restoring === rev.id ? 'animate-spin' : ''}`} />
                          {restoring === rev.id ? 'Restoring...' : 'Restore'}
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}
