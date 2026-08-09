'use client';

/**
 * Identity adjudication (#3846): the human remainder of the identity stack.
 * Tab 1 — work_merge_queue pairs ("same intellectual work?").
 * Tab 2 — edition_keeper_queue clusters ("same printing: which scan do readers see?").
 * Approve/keep actuates immediately through the same write semantics as the
 * maintenance scripts, attributed to the signed-in admin — no second job
 * reads these decisions later.
 */

import { useEffect, useState, useCallback } from 'react';

// ── work merges ──

interface WorkSide {
  workId: string;
  nBooks: number;
  nVisible: number;
  languages: string[];
  yearMin: number | null;
  yearMax: number | null;
  samples: { id: string; title: string; slug: string; visible: boolean; thumb: string | null }[];
}

interface MergeItem {
  id: string;
  status: string;
  author: string;
  evidence: { cont: number | null; inter: number | null; source: string };
  llm: { verdict: string; reason?: string } | null;
  a: WorkSide;
  b: WorkSide;
  suggestedWinner: string;
  winner: string | null;
  note: string | null;
  reviewed_by: string | null;
}

// ── edition keepers ──

interface KeeperMember {
  id: string;
  found: boolean;
  title: string;
  author: string;
  slug: string;
  language: string;
  year: number | null;
  visible: boolean;
  pages: number;
  ocr: number;
  translated: number;
  quality: number | null;
  ft: boolean;
  provider: string;
  thumb: string | null;
}

interface KeeperItem {
  editionKey: string;
  bucket: string;
  status: string;
  ftFlag: boolean;
  pageRatio: number | null;
  suggestedKeeper: string | null;
  keeper: string | null;
  members: KeeperMember[];
}

type Status = 'pending' | 'approved' | 'rejected' | 'kept' | 'dismissed' | 'stale';

const VERDICT_STYLE: Record<string, string> = {
  same: 'bg-emerald-100 text-emerald-800',
  different: 'bg-rose-100 text-rose-800',
  unsure: 'bg-amber-100 text-amber-800',
};

function Cover({ thumb, title }: { thumb: string | null; title: string }) {
  return thumb ? (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={thumb} alt={title} className="w-12 h-16 object-cover rounded border border-stone-200 flex-shrink-0" loading="lazy" />
  ) : (
    <div className="w-12 h-16 rounded border border-stone-200 bg-stone-100 flex-shrink-0" />
  );
}

function WorkSideCard({ side, isSuggested }: { side: WorkSide; isSuggested: boolean }) {
  return (
    <div className={`flex-1 min-w-0 rounded-lg border p-3 ${isSuggested ? 'border-emerald-300 bg-emerald-50/40' : 'border-stone-200'}`}>
      <div className="flex items-baseline gap-2 mb-2">
        <a href={`/work/${encodeURIComponent(side.workId)}`} target="_blank" rel="noopener noreferrer" className="text-xs font-mono text-accent-rust hover:underline truncate">
          {side.workId}
        </a>
        {isSuggested && <span className="text-[10px] uppercase tracking-wide text-emerald-700 whitespace-nowrap">suggested keep</span>}
      </div>
      <div className="text-xs text-stone-500 mb-2">
        {side.nBooks} book{side.nBooks === 1 ? '' : 's'} ({side.nVisible} visible)
        {side.languages.length > 0 && <> · {side.languages.join(', ')}</>}
        {side.yearMin !== null && <> · {side.yearMin === side.yearMax ? side.yearMin : `${side.yearMin}–${side.yearMax}`}</>}
      </div>
      <div className="space-y-1.5">
        {side.samples.map((s) => (
          <div key={s.id} className="flex items-center gap-2">
            <Cover thumb={s.thumb} title={s.title} />
            <a href={`/book/${s.id}`} target="_blank" rel="noopener noreferrer" className="text-sm text-stone-800 hover:underline leading-snug line-clamp-2">
              {s.title || s.id}
            </a>
          </div>
        ))}
      </div>
    </div>
  );
}

function WorkMergesTab() {
  const [status, setStatus] = useState<Status>('pending');
  const [verdict, setVerdict] = useState<string>('');
  const [items, setItems] = useState<MergeItem[]>([]);
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [total, setTotal] = useState(0);
  const [skip, setSkip] = useState(0);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const LIMIT = 25;

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ status, limit: String(LIMIT), skip: String(skip) });
      if (verdict) params.set('verdict', verdict);
      const res = await fetch(`/api/admin/work-merges?${params}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setItems(data.items || []);
      setCounts(data.counts || {});
      setTotal(data.total || 0);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  }, [status, verdict, skip]);

  useEffect(() => { load(); }, [load]);

  async function act(item: MergeItem, action: 'approve' | 'reject', winner?: string) {
    const note = action === 'reject' ? (prompt('Why is this not the same work? (optional)', '') ?? undefined) : undefined;
    if (action === 'reject' && note === undefined) return;
    setBusy(item.id);
    try {
      const res = await fetch('/api/admin/work-merges', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: item.id, action, winner, note: note || undefined }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) { alert(`${action} failed: ${data.error || res.status}`); return; }
      setItems((prev) => prev.filter((i) => i.id !== item.id));
      setCounts((c) => ({ ...c, pending: Math.max(0, (c.pending || 1) - 1), [data.status]: (c[data.status] || 0) + 1 }));
      setTotal((t) => Math.max(0, t - 1));
    } finally {
      setBusy(null);
    }
  }

  return (
    <div>
      <div className="flex flex-wrap items-center gap-2 mb-4">
        {(['pending', 'approved', 'rejected', 'stale'] as Status[]).map((s) => (
          <button key={s} onClick={() => { setStatus(s); setSkip(0); }}
            className={`px-3 py-1.5 text-sm rounded border ${status === s ? 'border-accent-rust text-accent-rust bg-white' : 'border-stone-200 text-stone-500 hover:text-stone-800'}`}>
            {s} <span className="text-xs text-stone-400">({counts[s] || 0})</span>
          </button>
        ))}
        <span className="mx-2 text-stone-300">|</span>
        <select value={verdict} onChange={(e) => { setVerdict(e.target.value); setSkip(0); }} className="text-sm border border-stone-200 rounded px-2 py-1.5 bg-white text-stone-700">
          <option value="">all LLM verdicts</option>
          <option value="same">LLM: same</option>
          <option value="different">LLM: different</option>
          <option value="unsure">LLM: unsure</option>
          <option value="none">not screened</option>
        </select>
        <span className="text-xs text-stone-400 ml-auto">{total} matching{loading ? ' · loading…' : ''}</span>
      </div>

      {!loading && items.length === 0 && <p className="text-sm text-stone-500">Nothing here.</p>}

      <div className="space-y-4">
        {items.map((item) => (
          <article key={item.id} className="border border-stone-200 rounded-lg p-4 bg-white">
            <header className="flex flex-wrap items-baseline gap-x-3 gap-y-1 mb-3">
              <h3 className="text-sm font-semibold text-stone-800">{item.author || 'unknown author'}</h3>
              {item.evidence.cont !== null && (
                <span className="text-xs text-stone-400">containment {item.evidence.cont} · overlap {item.evidence.inter}</span>
              )}
              {item.llm && (
                <span title={item.llm.reason || ''} className={`text-[11px] px-2 py-0.5 rounded-full ${VERDICT_STYLE[item.llm.verdict] || 'bg-stone-100 text-stone-600'}`}>
                  LLM: {item.llm.verdict}
                </span>
              )}
              {item.status !== 'pending' && item.reviewed_by && (
                <span className="text-xs text-stone-400 ml-auto">{item.status} by {item.reviewed_by}{item.winner ? ` → kept ${item.winner}` : ''}{item.note ? ` — ${item.note}` : ''}</span>
              )}
            </header>

            <div className="flex flex-col sm:flex-row gap-3 mb-3">
              <WorkSideCard side={item.a} isSuggested={item.suggestedWinner === item.a.workId} />
              <WorkSideCard side={item.b} isSuggested={item.suggestedWinner === item.b.workId} />
            </div>

            {item.status === 'pending' && (
              <div className="flex flex-wrap gap-2">
                <button disabled={busy === item.id} onClick={() => act(item, 'approve', item.a.workId)}
                  className={`text-xs px-3 py-1.5 rounded text-white transition-colors disabled:opacity-50 ${item.suggestedWinner === item.a.workId ? 'bg-emerald-600 hover:bg-emerald-700' : 'bg-emerald-500/80 hover:bg-emerald-600'}`}>
                  Same work → keep left
                </button>
                <button disabled={busy === item.id} onClick={() => act(item, 'approve', item.b.workId)}
                  className={`text-xs px-3 py-1.5 rounded text-white transition-colors disabled:opacity-50 ${item.suggestedWinner === item.b.workId ? 'bg-emerald-600 hover:bg-emerald-700' : 'bg-emerald-500/80 hover:bg-emerald-600'}`}>
                  Same work → keep right
                </button>
                <button disabled={busy === item.id} onClick={() => act(item, 'reject')}
                  className="text-xs px-3 py-1.5 bg-stone-100 hover:bg-stone-200 text-stone-700 rounded transition-colors disabled:opacity-50">
                  Not the same work
                </button>
              </div>
            )}
          </article>
        ))}
      </div>

      {total > LIMIT && (
        <div className="flex items-center gap-3 mt-4 text-sm">
          <button disabled={skip === 0} onClick={() => setSkip(Math.max(0, skip - LIMIT))} className="px-3 py-1 border border-stone-200 rounded disabled:opacity-40">← Prev</button>
          <span className="text-stone-500">{skip + 1}–{Math.min(skip + LIMIT, total)} of {total}</span>
          <button disabled={skip + LIMIT >= total} onClick={() => setSkip(skip + LIMIT)} className="px-3 py-1 border border-stone-200 rounded disabled:opacity-40">Next →</button>
        </div>
      )}
    </div>
  );
}

function EditionKeepersTab() {
  const [status, setStatus] = useState<Status>('pending');
  const [bucket, setBucket] = useState<string>('human');
  const [items, setItems] = useState<KeeperItem[]>([]);
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [buckets, setBuckets] = useState<Record<string, number>>({});
  const [total, setTotal] = useState(0);
  const [skip, setSkip] = useState(0);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const LIMIT = 15;

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ status, bucket, limit: String(LIMIT), skip: String(skip) });
      const res = await fetch(`/api/admin/edition-keepers?${params}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setItems(data.items || []);
      setCounts(data.counts || {});
      setBuckets(data.buckets || {});
      setTotal(data.total || 0);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  }, [status, bucket, skip]);

  useEffect(() => { load(); }, [load]);

  async function act(item: KeeperItem, action: 'keep' | 'dismiss', keeperId?: string) {
    if (action === 'keep' && item.ftFlag && !confirm('This cluster carries a First Translation badge — hiding a badged copy changes what FT counting sees. Proceed?')) return;
    setBusy(item.editionKey);
    try {
      const res = await fetch('/api/admin/edition-keepers', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ editionKey: item.editionKey, action, keeperId }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) { alert(`${action} failed: ${data.error || res.status}`); return; }
      setItems((prev) => prev.filter((i) => i.editionKey !== item.editionKey));
      setCounts((c) => ({ ...c, pending: Math.max(0, (c.pending || 1) - 1), [data.status]: (c[data.status] || 0) + 1 }));
      setTotal((t) => Math.max(0, t - 1));
    } finally {
      setBusy(null);
    }
  }

  return (
    <div>
      <div className="flex flex-wrap items-center gap-2 mb-4">
        {(['pending', 'kept', 'dismissed'] as Status[]).map((s) => (
          <button key={s} onClick={() => { setStatus(s); setSkip(0); }}
            className={`px-3 py-1.5 text-sm rounded border ${status === s ? 'border-accent-rust text-accent-rust bg-white' : 'border-stone-200 text-stone-500 hover:text-stone-800'}`}>
            {s} <span className="text-xs text-stone-400">({counts[s] || 0})</span>
          </button>
        ))}
        <span className="mx-2 text-stone-300">|</span>
        <select value={bucket} onChange={(e) => { setBucket(e.target.value); setSkip(0); }} className="text-sm border border-stone-200 rounded px-2 py-1.5 bg-white text-stone-700">
          <option value="human">Needs a human (TOSSUP + SUSPECT{buckets.TOSSUP !== undefined ? `: ${(buckets.TOSSUP || 0) + (buckets.SUSPECT_NOT_SAME || 0)}` : ''})</option>
          <option value="TOSSUP">TOSSUP ({buckets.TOSSUP || 0})</option>
          <option value="SUSPECT_NOT_SAME">SUSPECT_NOT_SAME ({buckets.SUSPECT_NOT_SAME || 0})</option>
          <option value="MECHANICAL_KEEP">MECHANICAL_KEEP ({buckets.MECHANICAL_KEEP || 0})</option>
          <option value="SCORED_KEEP">SCORED_KEEP ({buckets.SCORED_KEEP || 0})</option>
          <option value="all">all buckets</option>
        </select>
        <span className="text-xs text-stone-400 ml-auto">{total} matching{loading ? ' · loading…' : ''}</span>
      </div>

      {!loading && items.length === 0 && (
        <p className="text-sm text-stone-500">Nothing here. If the queue is empty entirely, run <code className="text-xs">scripts/maintenance/ingest-keeper-choice-queue.mjs</code> to load a triage snapshot.</p>
      )}

      <div className="space-y-4">
        {items.map((item) => (
          <article key={item.editionKey} className="border border-stone-200 rounded-lg p-4 bg-white">
            <header className="flex flex-wrap items-baseline gap-x-3 gap-y-1 mb-3">
              <span className={`text-[11px] px-2 py-0.5 rounded-full ${item.bucket === 'SUSPECT_NOT_SAME' ? 'bg-rose-100 text-rose-800' : 'bg-amber-100 text-amber-800'}`}>{item.bucket}</span>
              {item.ftFlag && <span className="text-[11px] px-2 py-0.5 rounded-full bg-purple-100 text-purple-800">FT badge in cluster</span>}
              {item.pageRatio !== null && <span className="text-xs text-stone-400">page similarity {(item.pageRatio * 100).toFixed(0)}%</span>}
              <span className="text-xs font-mono text-stone-400 truncate max-w-full" title={item.editionKey}>{item.editionKey.length > 90 ? item.editionKey.slice(0, 90) + '…' : item.editionKey}</span>
            </header>

            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 mb-3">
              {item.members.map((m) => (
                <div key={m.id} className={`rounded-lg border p-3 ${m.id === item.suggestedKeeper ? 'border-emerald-300 bg-emerald-50/40' : 'border-stone-200'} ${!m.visible ? 'opacity-60' : ''}`}>
                  <div className="flex gap-2 mb-2">
                    <Cover thumb={m.thumb} title={m.title} />
                    <div className="min-w-0">
                      <a href={`/book/${m.id}`} target="_blank" rel="noopener noreferrer" className="text-sm text-stone-800 hover:underline leading-snug line-clamp-2">{m.title || m.id}</a>
                      <div className="text-[11px] text-stone-500 mt-0.5">
                        {m.provider}{m.language ? ` · ${m.language}` : ''}{m.year ? ` · ${m.year}` : ''}
                        {!m.visible && <span className="text-rose-600"> · hidden</span>}
                        {m.ft && <span className="text-purple-600"> · FT</span>}
                      </div>
                    </div>
                  </div>
                  <div className="text-[11px] text-stone-500 mb-2">
                    {m.pages} pp · OCR {m.pages ? Math.round((m.ocr / m.pages) * 100) : 0}% · transl. {m.pages ? Math.round((m.translated / m.pages) * 100) : 0}%
                    {m.quality !== null && <> · quality {m.quality}</>}
                  </div>
                  {item.status === 'pending' && (
                    <button disabled={busy === item.editionKey} onClick={() => act(item, 'keep', m.id)}
                      className={`w-full text-xs px-2 py-1.5 rounded text-white transition-colors disabled:opacity-50 ${m.id === item.suggestedKeeper ? 'bg-emerald-600 hover:bg-emerald-700' : 'bg-emerald-500/80 hover:bg-emerald-600'}`}>
                      Keep this one · hide {item.members.length - 1} other{item.members.length === 2 ? '' : 's'}
                    </button>
                  )}
                </div>
              ))}
            </div>

            {item.status === 'pending' ? (
              <button disabled={busy === item.editionKey} onClick={() => act(item, 'dismiss')}
                className="text-xs px-3 py-1.5 bg-stone-100 hover:bg-stone-200 text-stone-700 rounded transition-colors disabled:opacity-50">
                Not the same edition — leave all visible
              </button>
            ) : (
              <div className="text-xs text-stone-500">{item.status}{item.keeper ? ` — keeper ${item.keeper}` : ''}</div>
            )}
          </article>
        ))}
      </div>

      {total > LIMIT && (
        <div className="flex items-center gap-3 mt-4 text-sm">
          <button disabled={skip === 0} onClick={() => setSkip(Math.max(0, skip - LIMIT))} className="px-3 py-1 border border-stone-200 rounded disabled:opacity-40">← Prev</button>
          <span className="text-stone-500">{skip + 1}–{Math.min(skip + LIMIT, total)} of {total}</span>
          <button disabled={skip + LIMIT >= total} onClick={() => setSkip(skip + LIMIT)} className="px-3 py-1 border border-stone-200 rounded disabled:opacity-40">Next →</button>
        </div>
      )}
    </div>
  );
}

export default function IdentityReviewPage() {
  const [tab, setTab] = useState<'merges' | 'keepers'>('merges');

  return (
    <div className="max-w-6xl mx-auto px-6 py-10">
      <h1 className="text-2xl font-semibold mb-2">Identity review</h1>
      <p className="text-sm text-stone-500 mb-6 max-w-3xl">
        The human remainder of the identity stack. <strong>Work merges</strong>: are these two work
        ids the same intellectual work? Approving merges immediately (aliases + redirect + provenance,
        revert path in <code className="text-xs">work_id_merges</code>). <strong>Edition keepers</strong>:
        same printing scanned twice — which copy do readers see? Keeping hides the others as
        duplicates. Screen the merge queue first with{' '}
        <code className="text-xs">scripts/analysis/stamp-work-merge-queue-llm.mjs</code> and review
        the <em>unsure</em> lane, not everything.
      </p>

      <div className="flex gap-2 mb-6 border-b border-stone-200">
        {([['merges', 'Work merges'], ['keepers', 'Edition keepers']] as const).map(([key, label]) => (
          <button key={key} onClick={() => setTab(key)}
            className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${tab === key ? 'border-accent-rust text-accent-rust' : 'border-transparent text-stone-500 hover:text-stone-800'}`}>
            {label}
          </button>
        ))}
      </div>

      {tab === 'merges' ? <WorkMergesTab /> : <EditionKeepersTab />}
    </div>
  );
}
