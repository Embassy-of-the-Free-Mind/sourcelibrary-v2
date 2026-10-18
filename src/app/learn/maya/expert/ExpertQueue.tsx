'use client';

import { useEffect, useState } from 'react';
import { cropUrl, type MayaItem } from '@/lib/learn-maya';

interface Row {
  item: MayaItem;
  stats: { agree: number; disagree: number; unsure: number; right: number; wrong: number };
  corrections: string[];
  answers: string[];
}

/** Items learners dispute, one click to settle (#6921). Learner text is shown as plain text: it is untrusted input. */
export default function ExpertQueue() {
  const [data, setData] = useState<{ queue: Row[]; judgementsTotal: number; itemsJudged: number } | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch('/api/learn/maya/expert')
      .then((r) => (r.ok ? r.json() : Promise.reject(r.status)))
      .then(setData)
      .catch((s) => setError(`The queue did not load (${s}).`));
  }, []);

  const settle = async (row: Row, verdict: 'ai-right' | 'ai-wrong', correction: string, note: string) => {
    const r = await fetch('/api/learn/maya/expert', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ item_id: row.item._id, verdict, correction: correction || null, note: note || null }),
    });
    if (!r.ok) {
      setError(`Not saved (${r.status}).`);
      return;
    }
    setData((d) => (d ? { ...d, queue: d.queue.filter((x) => x.item._id !== row.item._id) } : d));
  };

  return (
    <div className="max-w-2xl mx-auto px-5 py-6">
      <h1 className="font-serif text-2xl text-primary mb-1">Disputed readings</h1>
      <p className="text-sm text-secondary mb-6">
        Items where a learner disagreed with the AI, or two were unsure. Your verdict settles the item and makes it gold.
      </p>
      {error && <p className="text-accent-rust mb-4">{error}</p>}
      {!data && !error && <div className="h-40 bg-stone-200 rounded-lg animate-pulse" />}
      {data && data.queue.length === 0 && (
        <p className="text-secondary">
          Nothing disputed. {data.judgementsTotal} learner verdicts on {data.itemsJudged} items so far.
        </p>
      )}
      <div className="space-y-6">
        {data?.queue.map((row) => <ExpertCard key={row.item._id} row={row} onSettle={settle} />)}
      </div>
    </div>
  );
}

function ExpertCard({ row, onSettle }: { row: Row; onSettle: (row: Row, v: 'ai-right' | 'ai-wrong', c: string, n: string) => void }) {
  const { item, stats } = row;
  const [correction, setCorrection] = useState('');
  const [note, setNote] = useState('');
  const key = item.rung === 'numeral' ? String(item.answer.value) : item.rung === 'day-sign' ? item.answer.sign : item.answer.gloss_es;
  return (
    <article className="rounded-lg border border-border-light bg-white p-4">
      <div className="flex gap-4">
        {item.image ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={cropUrl(item.image)} alt={`Dresden Codex, page ${item.image.codex_page}`} className="w-32 h-32 object-contain rounded bg-[#efe6d6] shrink-0" />
        ) : (
          <p className="font-serif text-3xl text-primary w-32 shrink-0">{item.word?.form}</p>
        )}
        <div className="text-sm space-y-1 min-w-0">
          <p><span className="text-muted">AI reading:</span> <span className="text-primary">{item.ai.reading}</span></p>
          <p><span className="text-muted">Answer key:</span> <span className="text-primary">{key}</span></p>
          {item.word && <p className="text-muted italic break-words">{item.word.source.line}</p>}
          <p className="text-muted">
            Learners: {stats.agree} agree · {stats.disagree} disagree · {stats.unsure} unsure · tries {stats.right} right / {stats.wrong} wrong
          </p>
        </div>
      </div>
      {row.corrections.length > 0 && (
        <ul className="mt-3 text-sm text-secondary list-disc pl-5">
          {row.corrections.map((c, i) => <li key={i} className="break-words">{c}</li>)}
        </ul>
      )}
      {row.answers.length > 0 && <p className="mt-2 text-xs text-muted break-words">Learners answered: {row.answers.filter(Boolean).join(', ') || '(blank)'}</p>}
      <ul className="mt-2 text-xs flex flex-wrap gap-x-3">
        {item.evidence.map((e) => <li key={e.url}><a href={e.url} className="text-accent-rust underline underline-offset-2">{e.label}</a></li>)}
      </ul>
      <input value={correction} onChange={(e) => setCorrection(e.target.value)} placeholder="Correct reading, if the AI is wrong" className="mt-3 w-full rounded border border-border-light p-2 text-sm" />
      <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Note (optional)" className="mt-2 w-full rounded border border-border-light p-2 text-sm" />
      <div className="grid grid-cols-2 gap-2 mt-3">
        <button onClick={() => onSettle(row, 'ai-right', correction, note)} className="py-2 rounded bg-[#1a1612] text-white">AI is right</button>
        <button onClick={() => onSettle(row, 'ai-wrong', correction, note)} className="py-2 rounded bg-accent-rust text-white">AI is wrong</button>
      </div>
    </article>
  );
}
