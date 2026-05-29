'use client';

/**
 * Client UI for the summary review queue. Each card shows the live "About This
 * Book" text vs the re-synthesized candidate, with editable fields and
 * Approve / Reject / Save actions that POST to /api/admin/summary-review.
 * Acted-on cards drop out of the list.
 */
import { useState } from 'react';

export interface ReviewItem {
  id: string;
  title?: string;
  display_title?: string;
  author?: string;
  slug?: string;
  language?: string;
  oldBrief: string;
  brief: string;
  abstract: string;
  detailed: string;
  prompt_version?: string;
}

const C = {
  bg: '#0d1117', card: '#161b22', border: '#30363d', text: '#e6edf3',
  dim: '#8b949e', blue: '#58a6ff', green: '#3fb950', red: '#f85149', amber: '#f0883e',
};

function Card({ item, onResolved }: { item: ReviewItem; onResolved: (id: string, how: string) => void }) {
  const [brief, setBrief] = useState(item.brief);
  const [abstract, setAbstract] = useState(item.abstract);
  const [detailed, setDetailed] = useState(item.detailed);
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [showDetail, setShowDetail] = useState(false);

  const dirty = brief !== item.brief || abstract !== item.abstract || detailed !== item.detailed;

  async function act(action: 'approve' | 'reject' | 'save') {
    setBusy(action); setErr(null);
    try {
      const res = await fetch('/api/admin/summary-review', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(
          action === 'reject'
            ? { id: item.id, action }
            : { id: item.id, action, brief, abstract, detailed },
        ),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
      if (action === 'save') { setBusy(null); return; } // stays in queue
      onResolved(item.id, action);
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'failed'); setBusy(null);
    }
  }

  const hasGloss = item.display_title && item.display_title !== item.title;

  return (
    <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 8, padding: 16, marginBottom: 16 }}>
      <div style={{ marginBottom: 10 }}>
        <a href={`/book/${item.slug || item.id}`} target="_blank" rel="noreferrer"
          style={{ color: C.blue, fontWeight: 600, fontSize: 15, textDecoration: 'none' }}>
          {item.title || item.id}
        </a>
        {hasGloss && <span style={{ color: C.dim, fontSize: 13 }}> ({item.display_title})</span>}
        <span style={{ color: C.dim, fontSize: 13 }}> · {item.author || 'Unknown'}{item.language ? ` · ${item.language}` : ''}</span>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
        {/* OLD (live) */}
        <div>
          <div style={{ color: C.amber, fontSize: 11, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 6 }}>Current (live)</div>
          <div style={{ color: '#c9d1d9', fontSize: 14, lineHeight: 1.55, whiteSpace: 'pre-wrap' }}>
            {item.oldBrief || <span style={{ color: C.dim }}>(none)</span>}
          </div>
        </div>
        {/* NEW (candidate, editable) */}
        <div>
          <div style={{ color: C.green, fontSize: 11, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 6 }}>
            Candidate {item.prompt_version ? `· ${item.prompt_version}` : ''}{dirty ? ' · edited' : ''}
          </div>
          <textarea value={brief} onChange={(e) => setBrief(e.target.value)} rows={5}
            style={{ width: '100%', background: C.bg, color: C.text, border: `1px solid ${C.border}`, borderRadius: 4, padding: 8, fontSize: 14, lineHeight: 1.55, fontFamily: 'inherit', resize: 'vertical' }} />
        </div>
      </div>

      <button onClick={() => setShowDetail((s) => !s)}
        style={{ background: 'none', border: 'none', color: C.blue, cursor: 'pointer', fontSize: 12, padding: '8px 0 0' }}>
        {showDetail ? '▾ hide' : '▸ show'} abstract & detailed (Reading Guide)
      </button>
      {showDetail && (
        <div style={{ marginTop: 8, display: 'grid', gap: 10 }}>
          <div>
            <div style={{ color: C.dim, fontSize: 11, marginBottom: 4 }}>ABSTRACT</div>
            <textarea value={abstract} onChange={(e) => setAbstract(e.target.value)} rows={4}
              style={{ width: '100%', background: C.bg, color: C.text, border: `1px solid ${C.border}`, borderRadius: 4, padding: 8, fontSize: 13, lineHeight: 1.5, fontFamily: 'inherit', resize: 'vertical' }} />
          </div>
          <div>
            <div style={{ color: C.dim, fontSize: 11, marginBottom: 4 }}>DETAILED</div>
            <textarea value={detailed} onChange={(e) => setDetailed(e.target.value)} rows={7}
              style={{ width: '100%', background: C.bg, color: C.text, border: `1px solid ${C.border}`, borderRadius: 4, padding: 8, fontSize: 13, lineHeight: 1.5, fontFamily: 'inherit', resize: 'vertical' }} />
          </div>
        </div>
      )}

      <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 12 }}>
        <button onClick={() => act('approve')} disabled={!!busy}
          style={{ background: C.green, color: '#0d1117', border: 'none', borderRadius: 5, padding: '7px 16px', fontWeight: 600, cursor: 'pointer', opacity: busy ? 0.6 : 1 }}>
          {busy === 'approve' ? 'Approving…' : (dirty ? 'Approve edited' : 'Approve')}
        </button>
        <button onClick={() => act('reject')} disabled={!!busy}
          style={{ background: 'transparent', color: C.red, border: `1px solid ${C.red}`, borderRadius: 5, padding: '7px 16px', cursor: 'pointer', opacity: busy ? 0.6 : 1 }}>
          {busy === 'reject' ? 'Rejecting…' : 'Reject'}
        </button>
        {dirty && (
          <button onClick={() => act('save')} disabled={!!busy}
            style={{ background: 'transparent', color: C.dim, border: `1px solid ${C.border}`, borderRadius: 5, padding: '7px 12px', cursor: 'pointer' }}>
            {busy === 'save' ? 'Saving…' : 'Save edit (keep pending)'}
          </button>
        )}
        {err && <span style={{ color: C.red, fontSize: 12 }}>{err}</span>}
      </div>
    </div>
  );
}

export function ReviewClient({ initialItems, counts }: { initialItems: ReviewItem[]; counts: Record<string, number> }) {
  const [items, setItems] = useState(initialItems);
  const [resolved, setResolved] = useState<{ approved: number; rejected: number }>({ approved: 0, rejected: 0 });

  function onResolved(id: string, how: string) {
    setItems((prev) => prev.filter((it) => it.id !== id));
    setResolved((r) => ({ ...r, [how]: (r as Record<string, number>)[how] + 1 || 1 }));
  }

  return (
    <div style={{ maxWidth: 1200, margin: '0 auto', color: C.text }}>
      <h1 style={{ fontSize: 24, margin: '0 0 6px' }}>About This Book — summary review</h1>
      <div style={{ color: C.dim, fontSize: 14, marginBottom: 20 }}>
        Live text (left) vs re-synthesized candidate (right, editable). Approve promotes to live and revalidates the page; reject discards.
        {' '}Queue: <strong style={{ color: C.text }}>{counts.pending ?? 0}</strong> pending
        {counts.approved ? ` · ${counts.approved} approved` : ''}
        {counts.rejected ? ` · ${counts.rejected} rejected` : ''}.
        {(resolved.approved || resolved.rejected) ? (
          <span style={{ color: C.green }}> This session: {resolved.approved} approved, {resolved.rejected} rejected.</span>
        ) : null}
      </div>

      {items.length === 0 ? (
        <div style={{ color: C.dim, padding: 40, textAlign: 'center' }}>No pending candidates. Generate some with <code>scripts/maintenance/resynthesize-summaries.mjs --sample=N</code>.</div>
      ) : (
        items.map((it) => <Card key={it.id} item={it} onResolved={onResolved} />)
      )}
    </div>
  );
}
