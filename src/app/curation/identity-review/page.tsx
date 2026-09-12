'use client';

/**
 * Identity adjudication (#3846): the human remainder of the identity stack.
 * Tab 1 — work_merge_queue pairs ("same intellectual work?").
 * Tab 2 — edition_keeper_queue clusters ("same printing: which scan do readers see?").
 * Approve/keep actuates immediately through the same write semantics as the
 * maintenance scripts, attributed to the signed-in admin — no second job
 * reads these decisions later.
 *
 * Batch lanes (#4271): the same decision, N at a time, in three enforced
 * steps — see the whole affected list, eyeball a random sample, then run.
 * The run is a client-driven loop of small chunks so it shows progress and
 * can be aborted, and each chunk performs the merges/hides inline through the
 * exact same server function a single click uses. Nothing is enqueued for a
 * later job to consume.
 */

import { useEffect, useState, useCallback, useRef } from 'react';

// ── work merges ──

interface WorkSide {
  workId: string;
  nBooks: number;
  nVisible: number;
  bph: boolean;
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
  bph: boolean;
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
        {side.bph && <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-100 text-amber-800 whitespace-nowrap">BPH</span>}
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

// ── batch lane ──

/** Server refuses a run when this share of the sample is flagged. Mirrored here so the UI can say why. */
const SPOT_CHECK_ABORT_RATIO = 0.2;

interface ManifestResponse<M> {
  total: number;
  capped: boolean;
  manifest: M[];
  spotCheckIds: string[];
  spotCheckSize: number;
}

interface BatchLaneProps<M, S> {
  /** Short imperative name of the run, e.g. "Approve all 980 LLM-`same` merges". */
  title: string;
  /** One sentence saying exactly what the writes will be. */
  whatHappens: string;
  manifestUrl: string;
  postUrl: string;
  /** Extra fields merged into every chunk POST body (verdict, action, …). */
  bodyBase: Record<string, unknown>;
  /** Name of the array field carrying the ids in the POST body. */
  idsField: string;
  chunkSize: number;
  keyOf: (m: M) => string;
  manifestHead: React.ReactNode;
  renderManifestRow: (m: M) => React.ReactNode;
  /** Headline numbers: "980 pairs · 1,842 books will move". */
  renderSummary: (data: ManifestResponse<M>) => React.ReactNode;
  /** Warnings the manifest surfaced (stale rows, blocked clusters). */
  renderNotices?: (data: ManifestResponse<M>) => React.ReactNode;
  spotCheckUrl: (ids: string[]) => string;
  spotKeyOf: (s: S) => string;
  renderSpotCheck: (s: S) => React.ReactNode;
  onClose: (didWrite: boolean) => void;
}

type Step = 'manifest' | 'spot' | 'run' | 'done';

/**
 * List-first → spot-check → run. The three steps are enforced in order: the
 * run button does not exist until every sampled row has been judged, and the
 * server independently refuses a chunk whose declared spot-check is
 * incomplete or mostly flagged. Flagged rows are EXCLUDED from the run and
 * left pending for manual review — never auto-rejected.
 */
function BatchLane<M, S>(props: BatchLaneProps<M, S>) {
  const [data, setData] = useState<ManifestResponse<M> | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [step, setStep] = useState<Step>('manifest');
  const [spotItems, setSpotItems] = useState<S[] | null>(null);
  const [judged, setJudged] = useState<Record<string, 'ok' | 'flag'>>({});
  const [done, setDone] = useState(0);
  const [tally, setTally] = useState<Record<string, number>>({});
  const [errors, setErrors] = useState<string[]>([]);
  const [running, setRunning] = useState(false);
  const [finalizing, setFinalizing] = useState(false);
  const [finalized, setFinalized] = useState<{ revalidated: number; purged: boolean } | null>(null);
  const abortRef = useRef(false);
  const wroteRef = useRef(false);

  useEffect(() => {
    let live = true;
    fetch(props.manifestUrl)
      .then(async (r) => {
        const j = await r.json();
        if (!r.ok) throw new Error(j.error || `HTTP ${r.status}`);
        return j;
      })
      .then((j) => { if (live) setData(j); })
      .catch((e) => { if (live) setLoadError(e.message); });
    return () => { live = false; };
  }, [props.manifestUrl]);

  const startSpotCheck = useCallback(async () => {
    if (!data) return;
    setStep('spot');
    if (spotItems) return;
    try {
      const res = await fetch(props.spotCheckUrl(data.spotCheckIds));
      const j = await res.json();
      setSpotItems(j.items || []);
    } catch {
      setSpotItems([]);
    }
  }, [data, spotItems, props]);

  const sampled = data?.spotCheckIds || [];
  const reviewed = sampled.filter((id) => judged[id]).length;
  const flagged = sampled.filter((id) => judged[id] === 'flag').length;
  const sampleComplete = sampled.length > 0 && reviewed === sampled.length;
  const screenUnreliable = sampled.length > 0 && flagged / sampled.length >= SPOT_CHECK_ABORT_RATIO;

  const targets = (data?.manifest || [])
    .map(props.keyOf)
    .filter((id) => judged[id] !== 'flag');

  async function run() {
    if (!data) return;
    abortRef.current = false;
    setRunning(true);
    setStep('run');
    const runId = (globalThis.crypto?.randomUUID?.() ?? String(Date.now()));
    const spotCheck = { reviewed, flagged, of: sampled.length };
    const allPaths: string[] = [];
    const localTally: Record<string, number> = {};
    const localErrors: string[] = [];
    let processed = 0;

    for (let i = 0; i < targets.length; i += props.chunkSize) {
      if (abortRef.current) break;
      const slice = targets.slice(i, i + props.chunkSize);
      try {
        const res = await fetch(props.postUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ...props.bodyBase, [props.idsField]: slice, runId, spotCheck }),
        });
        const j = await res.json();
        if (!res.ok) {
          localErrors.push(j.error || `HTTP ${res.status}`);
          break; // a rejected chunk means the run itself is refused — stop, don't hammer
        }
        wroteRef.current = true;
        for (const [k, v] of Object.entries(j.tally || {})) localTally[k] = (localTally[k] || 0) + (v as number);
        for (const r of j.results || []) {
          if (r.status === 'error') localErrors.push(`${r.id || r.editionKey}: ${r.message}`);
        }
        allPaths.push(...(j.paths || []));
      } catch (e) {
        localErrors.push(e instanceof Error ? e.message : String(e));
        break;
      }
      processed += slice.length;
      setDone(processed);
      setTally({ ...localTally });
      setErrors([...localErrors]);
    }
    setTally({ ...localTally });
    setErrors([...localErrors]);
    setRunning(false);
    setStep('done');

    // One deduped cache pass at the end instead of ~2,000 during the run.
    if (allPaths.length) {
      setFinalizing(true);
      try {
        const res = await fetch(props.postUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'finalize', paths: [...new Set(allPaths)] }),
        });
        setFinalized(await res.json());
      } catch {
        setFinalized(null);
      } finally {
        setFinalizing(false);
      }
    }
  }

  return (
    <div className="border border-accent-rust/40 rounded-lg bg-white mb-6">
      <header className="flex flex-wrap items-baseline gap-3 px-4 py-3 border-b border-stone-200 bg-stone-50/60 rounded-t-lg">
        <h3 className="text-sm font-semibold text-stone-800">{props.title}</h3>
        <span className="text-xs text-stone-500">{props.whatHappens}</span>
        <button onClick={() => props.onClose(wroteRef.current)} disabled={running}
          className="ml-auto text-xs px-2 py-1 text-stone-500 hover:text-stone-800 disabled:opacity-40">
          Close
        </button>
      </header>

      <ol className="flex items-center gap-2 px-4 py-2 text-[11px] uppercase tracking-wide text-stone-400 border-b border-stone-100">
        {(['manifest', 'spot', 'run'] as const).map((s, i) => (
          <li key={s} className={step === s ? 'text-accent-rust font-semibold' : ''}>
            {i + 1}. {s === 'manifest' ? 'see the list' : s === 'spot' ? 'spot-check' : 'run'}
            {i < 2 && <span className="ml-2 text-stone-300">→</span>}
          </li>
        ))}
      </ol>

      {loadError && <p className="px-4 py-3 text-sm text-rose-700">Could not build the list: {loadError}</p>}
      {!data && !loadError && <p className="px-4 py-3 text-sm text-stone-500">Building the full list…</p>}

      {data && step === 'manifest' && (
        <div className="p-4">
          <p className="text-sm text-stone-700 mb-1">{props.renderSummary(data)}</p>
          {data.capped && (
            <p className="text-xs text-amber-700 mb-2">
              Only the first {data.manifest.length} of {data.total} are listed — run the batch again afterwards for the rest.
            </p>
          )}
          {props.renderNotices?.(data)}
          <p className="text-xs text-stone-500 mb-3">
            This is every row the run would touch. Read it before continuing — nothing has been written yet.
          </p>
          <div className="max-h-96 overflow-y-auto border border-stone-200 rounded">
            <table className="w-full text-xs">
              <thead className="sticky top-0 bg-stone-50 text-stone-500 text-left">{props.manifestHead}</thead>
              <tbody>
                {data.manifest.map((m) => (
                  <tr key={props.keyOf(m)} className="border-t border-stone-100 align-top">
                    {props.renderManifestRow(m)}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <button onClick={startSpotCheck} disabled={data.manifest.length === 0}
            className="mt-3 text-sm px-4 py-2 rounded bg-stone-800 text-white hover:bg-stone-900 disabled:opacity-40">
            I&apos;ve read the list — spot-check {data.spotCheckSize} of them →
          </button>
        </div>
      )}

      {data && step === 'spot' && (
        <div className="p-4">
          <p className="text-sm text-stone-700 mb-1">
            Judge each of these {sampled.length} at random. <strong>{reviewed}/{sampled.length}</strong> reviewed
            {flagged > 0 && <span className="text-rose-700"> · {flagged} flagged</span>}.
          </p>
          <p className="text-xs text-stone-500 mb-3">
            Flagged rows are left pending for manual review — they are excluded from the run, never auto-rejected.
          </p>
          {!spotItems && <p className="text-sm text-stone-500">Loading the sample…</p>}
          <div className="space-y-3">
            {(spotItems || []).map((s) => {
              const k = props.spotKeyOf(s);
              const v = judged[k];
              return (
                <div key={k} className={`border rounded-lg p-3 ${v === 'ok' ? 'border-emerald-300 bg-emerald-50/30' : v === 'flag' ? 'border-rose-300 bg-rose-50/30' : 'border-stone-200'}`}>
                  {props.renderSpotCheck(s)}
                  <div className="flex gap-2 mt-2">
                    <button onClick={() => setJudged((j) => ({ ...j, [k]: 'ok' }))}
                      className={`text-xs px-3 py-1.5 rounded border ${v === 'ok' ? 'bg-emerald-600 text-white border-emerald-600' : 'border-stone-200 text-stone-600 hover:border-emerald-400'}`}>
                      Looks right
                    </button>
                    <button onClick={() => setJudged((j) => ({ ...j, [k]: 'flag' }))}
                      className={`text-xs px-3 py-1.5 rounded border ${v === 'flag' ? 'bg-rose-600 text-white border-rose-600' : 'border-stone-200 text-stone-600 hover:border-rose-400'}`}>
                      Flag — don&apos;t include
                    </button>
                  </div>
                </div>
              );
            })}
          </div>

          <div className="mt-4 flex flex-wrap items-center gap-3">
            <button onClick={() => setStep('manifest')} className="text-sm px-3 py-2 rounded border border-stone-200 text-stone-600">← Back to the list</button>
            {screenUnreliable ? (
              <p className="text-sm text-rose-700">
                {flagged} of {sampled.length} sampled rows were wrong. That is a bad screen, not bad rows — review this
                slice one at a time instead of batching it.
              </p>
            ) : (
              <button onClick={() => { if (confirm(`${props.title}\n\n${targets.length} rows. ${props.whatHappens}\n\nThis writes immediately. Continue?`)) run(); }}
                disabled={!sampleComplete || targets.length === 0}
                className="text-sm px-4 py-2 rounded bg-accent-rust text-white hover:opacity-90 disabled:opacity-40">
                Run on {targets.length} rows
              </button>
            )}
            {!sampleComplete && !screenUnreliable && (
              <span className="text-xs text-stone-500">Judge all {sampled.length} before the run unlocks.</span>
            )}
          </div>
        </div>
      )}

      {data && (step === 'run' || step === 'done') && (
        <div className="p-4">
          <div className="h-2 w-full bg-stone-100 rounded overflow-hidden mb-2">
            <div className="h-full bg-accent-rust transition-all" style={{ width: `${targets.length ? (done / targets.length) * 100 : 0}%` }} />
          </div>
          <p className="text-sm text-stone-700">
            {done} of {targets.length} processed
            {Object.entries(tally).map(([k, v]) => <span key={k} className="text-stone-500"> · {v} {k}</span>)}
          </p>
          {running && (
            <button onClick={() => { abortRef.current = true; }}
              className="mt-3 text-sm px-4 py-2 rounded border border-rose-300 text-rose-700 hover:bg-rose-50">
              Abort — stop after this chunk
            </button>
          )}
          {step === 'done' && (
            <div className="mt-3 text-sm text-stone-600 space-y-1">
              <p>{abortRef.current ? 'Aborted.' : 'Finished.'} Rows already written stay written — each one is its own merge with its own provenance doc.</p>
              {finalizing && <p className="text-stone-500">Revalidating the touched pages…</p>}
              {finalized && <p className="text-stone-500">Revalidated {finalized.revalidated} paths{finalized.purged ? ' and purged Cloudflare' : ' (Cloudflare purge failed — see server logs)'}.</p>}
              <p className="text-xs text-stone-500">
                Supabase <code className="text-[11px]">books_catalog</code> is not written here: every row above bumped{' '}
                <code className="text-[11px]">updated_at</code>, which the incremental{' '}
                <code className="text-[11px]">sync-books-catalog.mjs</code> (:45 of every odd hour) keys on — public
                listings catch up within two hours.
              </p>
              {errors.length > 0 && (
                <details className="mt-2">
                  <summary className="text-rose-700 cursor-pointer">{errors.length} row{errors.length === 1 ? '' : 's'} did not apply</summary>
                  <ul className="mt-1 text-xs text-stone-600 max-h-40 overflow-y-auto space-y-0.5">
                    {errors.map((e, i) => <li key={i} className="font-mono break-all">{e}</li>)}
                  </ul>
                </details>
              )}
              <button onClick={() => props.onClose(true)} className="mt-2 text-sm px-4 py-2 rounded bg-stone-800 text-white hover:bg-stone-900">
                Back to the queue
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── work-merge manifest rows ──

interface MergeManifestRow {
  id: string;
  author: string;
  titleA: string;
  titleB: string;
  a: string;
  b: string;
  nA: number;
  nB: number;
  winner: string;
  loser: string;
  booksToMove: number;
  willBeStale: boolean;
  llmReason: string;
}

interface MergeManifest extends ManifestResponse<MergeManifestRow> {
  booksAffected: number;
  staleCount: number;
}

function WorkMergesTab({ bph }: { bph: boolean }) {
  const [status, setStatus] = useState<Status>('pending');
  const [verdict, setVerdict] = useState<string>('');
  const [items, setItems] = useState<MergeItem[]>([]);
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [total, setTotal] = useState(0);
  const [skip, setSkip] = useState(0);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [batch, setBatch] = useState<'approve' | 'reject' | null>(null);
  const LIMIT = 25;

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ status, limit: String(LIMIT), skip: String(skip) });
      if (verdict) params.set('verdict', verdict);
      if (bph) params.set('bph', '1');
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
  }, [status, verdict, skip, bph]);

  useEffect(() => { setSkip(0); }, [bph]);
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

      {/* Batch lane (#4271). Offered only where the LLM screen gives a single
          answer for the whole slice: `same` → approve, `different` → reject.
          `unsure` and unscreened rows stay one at a time on purpose. */}
      {status === 'pending' && !batch && (verdict === 'same' || verdict === 'different') && total > 1 && (
        <div className="mb-4 flex flex-wrap items-center gap-3 rounded-lg border border-stone-200 bg-stone-50/60 px-4 py-3">
          <span className="text-sm text-stone-700">
            {total} pending pairs the screen called <strong>{verdict}</strong>.
          </span>
          <button onClick={() => setBatch(verdict === 'same' ? 'approve' : 'reject')}
            className="text-sm px-3 py-1.5 rounded bg-stone-800 text-white hover:bg-stone-900">
            {verdict === 'same' ? `Batch-approve all ${total} →` : `Batch-reject all ${total} →`}
          </button>
          <span className="text-xs text-stone-500">
            You will see the full list and spot-check {Math.min(20, total)} before anything is written.
          </span>
        </div>
      )}

      {batch && (
        <BatchLane<MergeManifestRow, MergeItem>
          title={batch === 'approve' ? `Approve every LLM-‘same’ merge` : `Reject every LLM-‘different’ pair`}
          whatHappens={batch === 'approve'
            ? 'Each pair merges immediately: loser books rewritten to the winner, work_id_aliases stamped for the redirect, provenance + revert payload in work_id_merges.'
            : 'Status only — marks each pair rejected. No book is touched.'}
          manifestUrl={`/api/admin/work-merges/batch?verdict=${verdict}${bph ? '&bph=1' : ''}`}
          postUrl="/api/admin/work-merges/batch"
          bodyBase={{ action: batch, verdict }}
          idsField="ids"
          chunkSize={batch === 'approve' ? 25 : 100}
          keyOf={(m) => m.id}
          manifestHead={
            <tr>
              <th className="px-2 py-1.5 font-medium">Author</th>
              <th className="px-2 py-1.5 font-medium">Titles</th>
              <th className="px-2 py-1.5 font-medium">Keeps</th>
              <th className="px-2 py-1.5 font-medium whitespace-nowrap">Books moved</th>
            </tr>
          }
          renderManifestRow={(m) => (
            <>
              <td className="px-2 py-1.5 text-stone-700 whitespace-nowrap">{m.author || '—'}</td>
              <td className="px-2 py-1.5 text-stone-600">
                <div className="line-clamp-1">{m.titleA}</div>
                <div className="line-clamp-1 text-stone-400">{m.titleB}</div>
              </td>
              <td className="px-2 py-1.5 font-mono text-[10px] text-stone-500 break-all max-w-[16rem]">
                {batch === 'approve' ? m.winner : '—'}
              </td>
              <td className="px-2 py-1.5 text-stone-600 whitespace-nowrap">
                {m.willBeStale ? <span className="text-amber-700">already resolved</span> : (batch === 'approve' ? m.booksToMove : '0')}
              </td>
            </>
          )}
          renderSummary={(d) => {
            const dd = d as MergeManifest;
            return batch === 'approve'
              ? <>{dd.manifest.length} pairs · <strong>{dd.booksAffected} books</strong> change their work_id · {dd.manifest.length} provenance docs written</>
              : <>{dd.manifest.length} pairs marked rejected · <strong>no book is touched</strong></>;
          }}
          renderNotices={(d) => {
            const dd = d as MergeManifest;
            return dd.staleCount > 0 ? (
              <p className="text-xs text-amber-700 mb-2">
                <strong>{dd.staleCount} of {dd.manifest.length}</strong> have no books left on one side, so they will be
                marked <code className="text-[11px]">stale</code> rather than merged — approving them writes nothing to
                any book. Measured 2026-08-28, none of those retired ids appear in{' '}
                <code className="text-[11px]">work_id_aliases</code>, so they were not merged away: the local
                <code className="text-[11px]"> local:n:author:title</code> mint moved under them when a title or author
                was repaired. The queue is holding references to ids nothing carries any more.
              </p>
            ) : null;
          }}
          spotCheckUrl={(ids) => `/api/admin/work-merges?status=pending&limit=50&ids=${encodeURIComponent(ids.join(','))}`}
          spotKeyOf={(s) => s.id}
          renderSpotCheck={(s) => (
            <>
              <div className="flex flex-wrap items-baseline gap-x-3 mb-2">
                <span className="text-sm font-semibold text-stone-800">{s.author || 'unknown author'}</span>
                {s.llm?.reason && <span className="text-xs text-stone-500 italic">“{s.llm.reason}”</span>}
              </div>
              <div className="flex flex-col sm:flex-row gap-3">
                <WorkSideCard side={s.a} isSuggested={s.suggestedWinner === s.a.workId} />
                <WorkSideCard side={s.b} isSuggested={s.suggestedWinner === s.b.workId} />
              </div>
            </>
          )}
          onClose={(didWrite) => { setBatch(null); if (didWrite) { setSkip(0); load(); } }}
        />
      )}

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

/** One cluster member, read-only. The action button (if any) is passed as a child. */
function KeeperMemberCard({ m, suggested, children }: { m: KeeperMember; suggested: boolean; children?: React.ReactNode }) {
  return (
    <div className={`rounded-lg border p-3 ${suggested ? 'border-emerald-300 bg-emerald-50/40' : 'border-stone-200'} ${!m.visible ? 'opacity-60' : ''}`}>
      <div className="flex gap-2 mb-2">
        <Cover thumb={m.thumb} title={m.title} />
        <div className="min-w-0">
          <a href={`/book/${m.id}`} target="_blank" rel="noopener noreferrer" className="text-sm text-stone-800 hover:underline leading-snug line-clamp-2">{m.title || m.id}</a>
          <div className="text-[11px] text-stone-500 mt-0.5">
            {m.provider}{m.language ? ` · ${m.language}` : ''}{m.year ? ` · ${m.year}` : ''}
            {!m.visible && <span className="text-rose-600"> · hidden</span>}
            {m.ft && <span className="text-purple-600"> · FT</span>}
            {m.bph && <span className="text-amber-700"> · BPH</span>}
          </div>
        </div>
      </div>
      <div className="text-[11px] text-stone-500 mb-2">
        {m.pages} pp · OCR {m.pages ? Math.round((m.ocr / m.pages) * 100) : 0}% · transl. {m.pages ? Math.round((m.translated / m.pages) * 100) : 0}%
        {m.quality !== null && <> · quality {m.quality}</>}
      </div>
      {children}
    </div>
  );
}

// ── keeper manifest rows ──

interface KeeperManifestRow {
  editionKey: string;
  keeper: string;
  keeperTitle: string;
  keeperAuthor: string;
  keeperFound: boolean;
  keeperVisible: boolean;
  nMembers: number;
  willHide: number;
  liveFtInCluster: boolean;
  pageRatio: number | null;
  others: { id: string; title: string; visible: boolean }[];
}

interface KeeperManifest extends ManifestResponse<KeeperManifestRow> {
  booksHidden: number;
  ftExcluded: number;
  blocked: KeeperManifestRow[];
}

function EditionKeepersTab({ bph }: { bph: boolean }) {
  const [status, setStatus] = useState<Status>('pending');
  const [bucket, setBucket] = useState<string>('human');
  const [items, setItems] = useState<KeeperItem[]>([]);
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [buckets, setBuckets] = useState<Record<string, number>>({});
  const [total, setTotal] = useState(0);
  const [skip, setSkip] = useState(0);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [batchOpen, setBatchOpen] = useState(false);
  const LIMIT = 15;

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ status, bucket, limit: String(LIMIT), skip: String(skip) });
      if (bph) params.set('bph', '1');
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
  }, [status, bucket, skip, bph]);

  useEffect(() => { setSkip(0); }, [bph]);
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

      {/* Batch lane (#4271) — MECHANICAL_KEEP only, and only clusters with no
          FT badge at stake. Keeping HIDES books, so this lane is deliberately
          narrower than the work-merge one. */}
      {status === 'pending' && !batchOpen && (buckets.MECHANICAL_KEEP || 0) > 1 && (
        <div className="mb-4 flex flex-wrap items-center gap-3 rounded-lg border border-stone-200 bg-stone-50/60 px-4 py-3">
          <span className="text-sm text-stone-700">
            {buckets.MECHANICAL_KEEP} pending <strong>MECHANICAL_KEEP</strong> clusters — one member dominates on every axis.
          </span>
          <button onClick={() => setBatchOpen(true)} className="text-sm px-3 py-1.5 rounded bg-stone-800 text-white hover:bg-stone-900">
            Batch-keep the mechanical ones →
          </button>
          <span className="text-xs text-stone-500">FT-flagged clusters are excluded and stay per-cluster manual.</span>
        </div>
      )}

      {batchOpen && (
        <BatchLane<KeeperManifestRow, KeeperItem>
          title="Keep the suggested copy in every mechanical cluster"
          whatHappens="Each cluster hides its non-keeper members (hidden_reason 'duplicate', duplicate_of → keeper). This removes books from public listings."
          manifestUrl="/api/admin/edition-keepers/batch"
          postUrl="/api/admin/edition-keepers/batch"
          bodyBase={{ action: 'keep' }}
          idsField="editionKeys"
          chunkSize={25}
          keyOf={(m) => m.editionKey}
          manifestHead={
            <tr>
              <th className="px-2 py-1.5 font-medium">Keeper</th>
              <th className="px-2 py-1.5 font-medium">Hides</th>
              <th className="px-2 py-1.5 font-medium whitespace-nowrap">Page similarity</th>
            </tr>
          }
          renderManifestRow={(m) => (
            <>
              <td className="px-2 py-1.5 text-stone-700">
                <div className="line-clamp-1">{m.keeperTitle || m.keeper}</div>
                <div className="text-[10px] text-stone-400">{m.keeperAuthor}</div>
              </td>
              <td className="px-2 py-1.5 text-stone-600">
                {m.willHide} of {m.nMembers - 1}
                <div className="text-[10px] text-stone-400 line-clamp-1">{m.others.map((o) => o.title || o.id).join(' · ')}</div>
              </td>
              <td className="px-2 py-1.5 text-stone-600 whitespace-nowrap">{m.pageRatio !== null ? `${Math.round(m.pageRatio * 100)}%` : '—'}</td>
            </>
          )}
          renderSummary={(d) => {
            const dd = d as KeeperManifest;
            return <>{dd.manifest.length} clusters · <strong>{dd.booksHidden} books hidden</strong> from public listings</>;
          }}
          renderNotices={(d) => {
            const dd = d as KeeperManifest;
            return (
              <>
                {dd.manifest.length > 0 && dd.booksHidden === 0 && (
                  <p className="text-xs text-amber-700 mb-2">
                    <strong>No book will actually be hidden.</strong> Every non-keeper in these clusters is already
                    hidden with <code className="text-[11px]">hidden_reason: &lsquo;same_edition_duplicate&rsquo;</code> —
                    the script lane (<code className="text-[11px]">apply-keeper-choice-triage.mjs</code>) applied them
                    and never marked the queue rows. Running this reconciles the queue and records who signed off; it
                    changes nothing a reader sees.
                  </p>
                )}
                {dd.ftExcluded > 0 && (
                  <p className="text-xs text-purple-800 mb-2">
                    {dd.ftExcluded} MECHANICAL_KEEP clusters carry a First Translation badge and are excluded — hiding a
                    badged copy changes what FT counting sees. Review those one at a time.
                  </p>
                )}
                {dd.blocked.length > 0 && (
                  <p className="text-xs text-amber-700 mb-2">
                    {dd.blocked.length} further clusters were dropped from the batch: their suggested keeper no longer
                    exists, or a member has gained an FT badge since the 2026-08-09 triage snapshot.
                  </p>
                )}
              </>
            );
          }}
          spotCheckUrl={(ids) => `/api/admin/edition-keepers?status=pending&bucket=all&limit=50&ids=${encodeURIComponent(ids.join(','))}`}
          spotKeyOf={(s) => s.editionKey}
          renderSpotCheck={(s) => (
            <>
              <div className="text-xs font-mono text-stone-400 mb-2 line-clamp-1" title={s.editionKey}>{s.editionKey}</div>
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {s.members.map((m) => (
                  <KeeperMemberCard key={m.id} m={m} suggested={m.id === s.suggestedKeeper}>
                    <div className="text-[11px] text-stone-500">{m.id === s.suggestedKeeper ? 'would be KEPT' : 'would be hidden'}</div>
                  </KeeperMemberCard>
                ))}
              </div>
            </>
          )}
          onClose={(didWrite) => { setBatchOpen(false); if (didWrite) { setSkip(0); load(); } }}
        />
      )}

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
                <KeeperMemberCard key={m.id} m={m} suggested={m.id === item.suggestedKeeper}>
                  {item.status === 'pending' && (
                    <button disabled={busy === item.editionKey} onClick={() => act(item, 'keep', m.id)}
                      className={`w-full text-xs px-2 py-1.5 rounded text-white transition-colors disabled:opacity-50 ${m.id === item.suggestedKeeper ? 'bg-emerald-600 hover:bg-emerald-700' : 'bg-emerald-500/80 hover:bg-emerald-600'}`}>
                      Keep this one · hide {item.members.length - 1} other{item.members.length === 2 ? '' : 's'}
                    </button>
                  )}
                </KeeperMemberCard>
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
  // ?bph=1 opens the page scoped to BPH/EFM holdings (shareable link for
  // partner-collection reviewers). Client page, so location is available.
  const [bph, setBph] = useState<boolean>(() =>
    typeof window !== 'undefined' && new URLSearchParams(window.location.search).get('bph') === '1'
  );

  return (
    <div className="max-w-6xl mx-auto px-6 py-10">
      <h1 className="text-2xl font-semibold mb-2">Identity review</h1>
      <p className="text-sm text-stone-500 mb-6 max-w-3xl">
        The human remainder of the identity stack. <strong>Work merges</strong>: are these two work
        ids the same intellectual work? Approving merges immediately (aliases + redirect + provenance,
        revert path in <code className="text-xs">work_id_merges</code>). <strong>Edition keepers</strong>:
        same printing scanned twice — which copy do readers see? Keeping hides the others as
        duplicates. Screen the merge queue first with{' '}
        <code className="text-xs">scripts/analysis/stamp-work-merge-queue-llm.mjs</code>, then use
        the <strong>batch lanes</strong> to clear the screened slices in one sitting and review the{' '}
        <em>unsure</em> and unscreened lanes by hand. A batch is N single approvals, not a queued
        job: it shows the whole list, makes you spot-check twenty at random, and then performs the
        merges inline with the same provenance and revert payload one click writes.
      </p>

      <div className="flex items-center gap-2 mb-6 border-b border-stone-200">
        {([['merges', 'Work merges'], ['keepers', 'Edition keepers']] as const).map(([key, label]) => (
          <button key={key} onClick={() => setTab(key)}
            className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${tab === key ? 'border-accent-rust text-accent-rust' : 'border-transparent text-stone-500 hover:text-stone-800'}`}>
            {label}
          </button>
        ))}
        <label className="ml-auto flex items-center gap-2 text-sm text-stone-600 cursor-pointer pb-1">
          <input type="checkbox" checked={bph} onChange={(e) => setBph(e.target.checked)} />
          BPH holdings only
        </label>
      </div>

      {tab === 'merges' ? <WorkMergesTab bph={bph} /> : <EditionKeepersTab bph={bph} />}
    </div>
  );
}
