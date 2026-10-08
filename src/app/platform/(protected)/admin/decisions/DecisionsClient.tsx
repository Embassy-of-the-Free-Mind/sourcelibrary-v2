'use client';

/**
 * Cards for /platform/admin/decisions. One card at a time is the unit of work:
 * Default / Other (free text) / Skip, each POSTing to /api/admin/decisions.
 * An answered card drops out and says what happens next.
 */
import { useState } from 'react';
import type { DecisionCard, DecisionChoice } from '@/lib/decision-queue';
import type { QueueSnapshot } from '@/lib/decision-queue-sources';

const C = {
  bg: '#0d1117', card: '#161b22', border: '#30363d', text: '#e6edf3',
  dim: '#8b949e', blue: '#58a6ff', green: '#3fb950', red: '#f85149', amber: '#f0883e',
};

const SOURCE_LABEL: Record<DecisionCard['source'], string> = { pr: 'PR · tier:hold', ops: 'Ops file', session: 'Session' };

const btn = (bg: string, fg = '#fff') => ({
  flex: 1, minHeight: 44, borderRadius: 8, border: `1px solid ${C.border}`, background: bg, color: fg,
  fontSize: 15, fontWeight: 600, cursor: 'pointer',
});

function Card({ card, onDone }: { card: DecisionCard; onDone: (id: string, note: string) => void }) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [otherOpen, setOtherOpen] = useState(false);
  const [text, setText] = useState('');

  async function answer(choice: DecisionChoice) {
    setBusy(true);
    setErr(null);
    try {
      const res = await fetch('/api/admin/decisions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ cardId: card.id, choice, text: choice === 'other' ? text : undefined }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`);
      onDone(card.id, json.next || 'Recorded.');
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 10, padding: 14, marginBottom: 14 }}>
      <div style={{ color: C.dim, fontSize: 12, marginBottom: 6 }}>
        {SOURCE_LABEL[card.source]}{card.raisedAt ? ` · ${card.raisedAt.slice(0, 10)}` : ''}
        {card.costUsd ? ` · $${card.costUsd.toLocaleString('en-US')}` : ''}
      </div>
      <div style={{ fontSize: 17, fontWeight: 600, lineHeight: 1.35, marginBottom: 10 }}>{card.question}</div>

      {card.lastAttempt && (
        <div style={{ color: C.red, fontSize: 13, marginBottom: 10 }}>{card.lastAttempt}</div>
      )}
      {card.needsDesk && (
        <div style={{ color: C.amber, fontSize: 13, marginBottom: 10 }}>Needs a desk: {card.needsDesk}. Skip it here.</div>
      )}

      <div style={{ fontSize: 14, lineHeight: 1.45, marginBottom: 6 }}>
        <span style={{ color: C.green, fontWeight: 600 }}>Default: </span>{card.defaultLabel}
      </div>
      <div style={{ color: C.dim, fontSize: 13, lineHeight: 1.45, marginBottom: 10 }}>{card.defaultDoes}</div>

      {card.details.map((d, i) => (
        <div key={i} style={{ color: '#c9d1d9', fontSize: 13, lineHeight: 1.45, marginBottom: 4 }}>{d}</div>
      ))}

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, margin: '10px 0 12px' }}>
        {card.evidence.map((e) => (
          <a key={e.url} href={e.url} target="_blank" rel="noreferrer" style={{ color: C.blue, fontSize: 14 }}>{e.label}</a>
        ))}
      </div>

      {otherOpen && (
        <textarea value={text} onChange={(e) => setText(e.target.value)} rows={3} autoFocus
          placeholder={card.source === 'pr' ? 'Posted on the PR; the PR gets the `blocked` label.' : 'Your answer'}
          style={{ width: '100%', boxSizing: 'border-box', background: C.bg, color: C.text, border: `1px solid ${C.border}`,
            borderRadius: 8, padding: 10, fontSize: 16, fontFamily: 'inherit', marginBottom: 10 }} />
      )}

      <div style={{ display: 'flex', gap: 8 }}>
        {otherOpen ? (
          <>
            <button disabled={busy || !text.trim()} onClick={() => answer('other')} style={btn('#1f6feb')}>Send</button>
            <button disabled={busy} onClick={() => setOtherOpen(false)} style={btn('transparent', C.dim)}>Cancel</button>
          </>
        ) : (
          <>
            <button disabled={busy} onClick={() => answer(card.defaultActionable ? 'default' : 'skip')}
              style={btn(card.defaultActionable ? '#238636' : '#30363d')}>
              {card.defaultActionable ? 'Default' : 'Default (skip)'}
            </button>
            <button disabled={busy} onClick={() => setOtherOpen(true)} style={btn('#30363d')}>Other</button>
            <button disabled={busy} onClick={() => answer('skip')} style={btn('transparent', C.dim)}>Skip</button>
          </>
        )}
      </div>
      {err && <div style={{ color: C.red, fontSize: 13, marginTop: 8 }}>{err}</div>}
    </div>
  );
}

export function DecisionsClient({ initial }: { initial: QueueSnapshot }) {
  const [cards, setCards] = useState(initial.cards);
  const [log, setLog] = useState<string[]>([]);

  function done(id: string, note: string) {
    const card = cards.find((c) => c.id === id);
    setCards((cs) => cs.filter((c) => c.id !== id));
    setLog((l) => [`${note} — ${card?.question ?? id}`, ...l].slice(0, 10));
  }

  return (
    <div style={{ maxWidth: 640, margin: '0 auto' }}>
      <h1 style={{ fontSize: 22, margin: '0 0 4px' }}>Decisions</h1>
      <div style={{ color: C.dim, fontSize: 13, marginBottom: 14 }}>
        {cards.length} open · {initial.counts.pr} PRs, {initial.counts.ops} ops rows · {initial.counts.answeredToday} answered today (UTC)
      </div>

      {initial.errors.map((e) => (
        <div key={e} style={{ color: C.red, fontSize: 13, marginBottom: 8 }}>{e}</div>
      ))}

      {log.map((l, i) => (
        <div key={i} style={{ color: C.green, fontSize: 13, marginBottom: 6 }}>{l}</div>
      ))}

      {cards.length === 0 && !initial.errors.length && (
        <div style={{ color: C.dim, fontSize: 15, padding: '24px 0' }}>Nothing waiting on you.</div>
      )}
      {cards.map((c) => <Card key={c.id} card={c} onDone={done} />)}

      <div style={{ border: `1px dashed ${C.border}`, borderRadius: 10, padding: 14, color: C.dim, fontSize: 13, lineHeight: 1.5 }}>
        <strong style={{ color: C.text }}>Stuck background sessions</strong> are not on this page yet. They live on
        the laptop (<code>~/.claude/jobs/*/state.json</code>); the sync that brings their questions here is stage 2
        of #6258. Until then, answer them in the terminal.
      </div>
    </div>
  );
}
