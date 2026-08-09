'use client';

import { useState, useEffect, useCallback } from 'react';

// ─── Types ───────────────────────────────────────────────────────────────

interface WorksData {
  live_books: number;
  all_books: number;
  work_id_live: number;
  work_id_all: number;
  edition_key_live: number;
  aliased_live: number;
  distinct_works_live: number;
  multi_edition_works: number;
  multi_language_works: number;
  cluster_sizes: Record<string, number>;
  merge_queue: Record<string, number>;
  merges_applied: number;
}

interface AuthorsData {
  author_string_live: number;
  author_id_live: number;
  author_string_all: number;
  author_id_all: number;
  thesaurus: {
    total: number;
    wikidata_anchored: number;
    viaf_anchored: number;
    entity_linked: number;
    non_person: number;
    tombstones: number;
  };
  top_unresolved: { author: string; books: number }[];
}

interface FtProcess {
  live_total: number;
  live_translated: number;
  searched: number;
  verdict_materialized: number;
  badged: number;
}

interface FtData {
  process?: FtProcess;
  badged_live: number;
  badged_all: number;
  verdict_on_badged_live: number;
  verdicts: Record<string, number>;
  strengths: Record<string, number>;
  attempts_total: number;
  attempts_by_method: Record<string, number>;
  attempts_by_day: { day: string; n: number }[];
  books_searched: number;
  reverify_proposals: number;
}

interface Snapshot {
  works: WorksData;
  authors: AuthorsData;
  first_translations: FtData;
  _snapshot?: { updated_at: string; stale: boolean };
  _computing?: boolean;
  message?: string;
}

// ─── Palette (validated: ordinal blue ramps + status, dark surface) ──────

const INK = '#e6edf3';
const INK_2 = '#8b949e';
const SURFACE = '#161b22';
const BORDER = '#30363d';
const BLUE = '#3987e5';
const ORDINAL_4 = ['#9ec5f4', '#5598e7', '#2a78d6', '#1c5cab'];
const ORDINAL_3 = ['#86b6ef', '#3987e5', '#184f95'];
const STATUS_GOOD = '#0ca30c';
const STATUS_WARN = '#fab219';

const fmt = (n: number | undefined) => (n ?? 0).toLocaleString('en-US');
const pct = (n: number, d: number) => (d > 0 ? `${(n / d * 100).toFixed(1)}%` : '—');

// ─── Building blocks ─────────────────────────────────────────────────────

function Tile({ label, value, sub, accent }: { label: string; value: string; sub?: string; accent?: string }) {
  return (
    <div style={{
      background: SURFACE, border: `1px solid ${BORDER}`, borderRadius: 8,
      padding: '12px 16px', minWidth: 150, flex: '1 1 150px',
    }}>
      <div style={{ fontSize: 12, color: INK_2, marginBottom: 4 }}>{label}</div>
      <div style={{ fontSize: 26, fontWeight: 600, color: accent || INK, lineHeight: 1.1 }}>{value}</div>
      {sub && <div style={{ fontSize: 12, color: INK_2, marginTop: 4 }}>{sub}</div>}
    </div>
  );
}

function BarRow({ label, value, max, color, note }: {
  label: string; value: number; max: number; color: string; note?: string;
}) {
  const w = max > 0 ? Math.max(1, value / max * 100) : 0;
  return (
    <div
      title={`${label}: ${fmt(value)}${note ? ` — ${note}` : ''}`}
      style={{ display: 'grid', gridTemplateColumns: '170px 1fr 90px', gap: 10, alignItems: 'center', padding: '3px 0' }}
    >
      <div style={{ fontSize: 12.5, color: INK_2, textAlign: 'right', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
        {label}
      </div>
      <div style={{ background: '#21262d', borderRadius: 4, height: 14, overflow: 'hidden' }}>
        <div style={{ width: `${w}%`, height: '100%', background: color, borderRadius: '0 4px 4px 0' }} />
      </div>
      <div style={{ fontSize: 12.5, color: INK, fontVariantNumeric: 'tabular-nums' }}>
        {fmt(value)}{note && <span style={{ color: INK_2 }}> {note}</span>}
      </div>
    </div>
  );
}

function Section({ title, sub, children }: { title: string; sub?: string; children: React.ReactNode }) {
  return (
    <section style={{ marginBottom: 32 }}>
      <h2 style={{ fontSize: 17, fontWeight: 600, margin: '0 0 2px' }}>{title}</h2>
      {sub && <p style={{ fontSize: 12.5, color: INK_2, margin: '0 0 12px' }}>{sub}</p>}
      {children}
    </section>
  );
}

function Card({ title, children, grow }: { title: string; children: React.ReactNode; grow?: boolean }) {
  return (
    <div style={{
      background: SURFACE, border: `1px solid ${BORDER}`, borderRadius: 8,
      padding: '12px 16px', flex: grow ? '1 1 380px' : '0 1 auto', minWidth: 300,
    }}>
      <div style={{ fontSize: 13, fontWeight: 600, color: INK, marginBottom: 8 }}>{title}</div>
      {children}
    </div>
  );
}

function Sparkbars({ data }: { data: { day: string; n: number }[] }) {
  const max = Math.max(1, ...data.map(d => d.n));
  return (
    <div style={{ display: 'flex', alignItems: 'flex-end', gap: 2, height: 64 }}>
      {data.map(d => (
        <div
          key={d.day}
          title={`${d.day}: ${fmt(d.n)} attempts`}
          style={{
            flex: 1, minWidth: 4, height: `${Math.max(3, d.n / max * 100)}%`,
            background: BLUE, borderRadius: '2px 2px 0 0',
          }}
        />
      ))}
    </div>
  );
}

// ─── Page ────────────────────────────────────────────────────────────────

export default function CanonDashboardPage() {
  const [data, setData] = useState<Snapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/admin/canon');
      const json = await res.json();
      setData(json);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load');
    } finally {
      setLoading(false);
    }
  }, []);

  const refresh = useCallback(async () => {
    setRefreshing(true);
    try {
      const res = await fetch('/api/admin/canon', { method: 'POST' });
      if (!res.ok) throw new Error(`Recompute failed (${res.status})`);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Refresh failed');
    } finally {
      setRefreshing(false);
    }
  }, [load]);

  useEffect(() => { load(); }, [load]);

  if (loading) {
    return <div style={{ background: '#0d1117', minHeight: '100vh', color: INK_2, padding: 40, fontSize: 14 }}>Loading canon dashboard…</div>;
  }

  const w = data?.works;
  const a = data?.authors;
  const ft = data?.first_translations;
  const snap = data?._snapshot;

  const verdictEntries = ft ? Object.entries(ft.verdicts).sort((x, y) => y[1] - x[1]) : [];
  const verdictMax = Math.max(1, ...verdictEntries.map(([, n]) => n));
  const methodEntries = ft ? Object.entries(ft.attempts_by_method).sort((x, y) => y[1] - x[1]) : [];
  const methodMax = Math.max(1, ...methodEntries.map(([, n]) => n));
  const strengthOrder = ['weak', 'moderate', 'strong'];
  const clusterEntries = w ? Object.entries(w.cluster_sizes) : [];
  const clusterMax = Math.max(1, ...clusterEntries.map(([, n]) => n));
  const unresolvedLive = a ? a.author_string_live - a.author_id_live : 0;

  return (
    <div style={{ background: '#0d1117', minHeight: '100vh', color: INK, padding: '20px 24px', fontSize: 14 }}>
      <div style={{ maxWidth: 1200, margin: '0 auto' }}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 12, marginBottom: 4, flexWrap: 'wrap' }}>
          <h1 style={{ fontSize: 22, fontWeight: 600, margin: 0 }}>Canon</h1>
          <span style={{ fontSize: 12.5, color: INK_2 }}>
            works · author resolution · first translations
          </span>
          <span style={{ flex: 1 }} />
          {snap && (
            <span style={{ fontSize: 12, color: snap.stale ? STATUS_WARN : INK_2 }}>
              {snap.stale ? '⚠ stale — ' : ''}snapshot {new Date(snap.updated_at).toLocaleString()}
            </span>
          )}
          <button
            onClick={refresh}
            disabled={refreshing}
            style={{
              background: '#21262d', color: INK, border: `1px solid ${BORDER}`, borderRadius: 6,
              padding: '4px 12px', fontSize: 12.5, cursor: refreshing ? 'wait' : 'pointer',
            }}
          >
            {refreshing ? 'Recomputing…' : 'Refresh'}
          </button>
        </div>
        <p style={{ fontSize: 12.5, color: INK_2, margin: '0 0 24px' }}>
          Live = visible with processed pages. Totals include the hidden import backlog — the gap between the two is where resolution work remains.
        </p>

        {error && (
          <div style={{ background: '#2d1418', border: '1px solid #f8514966', borderRadius: 8, padding: '10px 14px', marginBottom: 16, fontSize: 13 }}>
            {error}
          </div>
        )}

        {data?._computing && (
          <div style={{ background: SURFACE, border: `1px solid ${BORDER}`, borderRadius: 8, padding: '14px 16px', marginBottom: 16, fontSize: 13, color: INK_2 }}>
            {data.message || 'No snapshot yet.'} Use Refresh to compute one (~15s).
          </div>
        )}

        {/* ── Works & editions ── */}
        {w && (
          <Section
            title="Works & editions"
            sub="Editions clustered under books.work_id — the layer that answers “do we already hold this work?”"
          >
            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 12 }}>
              <Tile label="Distinct works (live)" value={fmt(w.distinct_works_live)} />
              <Tile
                label="work_id coverage (live)"
                value={pct(w.work_id_live, w.live_books)}
                sub={`${fmt(w.work_id_live)} of ${fmt(w.live_books)} live books`}
                accent={w.work_id_live / Math.max(1, w.live_books) > 0.95 ? STATUS_GOOD : undefined}
              />
              <Tile
                label="work_id coverage (all)"
                value={pct(w.work_id_all, w.all_books)}
                sub={`${fmt(w.work_id_all)} of ${fmt(w.all_books)} incl. backlog`}
              />
              <Tile
                label="edition_key (live)"
                value={pct(w.edition_key_live, w.live_books)}
                sub={`${fmt(w.edition_key_live)} stamped`}
              />
              <Tile label="Multi-edition works" value={fmt(w.multi_edition_works)} sub="≥2 live editions" />
              <Tile label="Multi-language works" value={fmt(w.multi_language_works)} sub="editions span ≥2 languages" />
            </div>
            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
              <Card title="Cluster sizes (live editions per work)" grow>
                {clusterEntries.map(([label, n], i) => (
                  <BarRow key={label} label={label} value={n} max={clusterMax} color={ORDINAL_4[i] || BLUE} />
                ))}
              </Card>
              <Card title="Merge machinery" grow>
                <BarRow
                  label="queue pending"
                  value={w.merge_queue.pending || 0}
                  max={Math.max(w.merge_queue.pending || 0, w.merges_applied, 1)}
                  color={STATUS_WARN}
                  note="awaiting human review"
                />
                <BarRow
                  label="merges applied"
                  value={w.merges_applied}
                  max={Math.max(w.merge_queue.pending || 0, w.merges_applied, 1)}
                  color={BLUE}
                />
                <BarRow
                  label="aliased editions"
                  value={w.aliased_live}
                  max={Math.max(w.merge_queue.pending || 0, w.merges_applied, w.aliased_live, 1)}
                  color={ORDINAL_4[0]}
                  note="carry retired work_ids"
                />
              </Card>
            </div>
          </Section>
        )}

        {/* ── Author resolution ── */}
        {a && (
          <Section
            title="Author resolution"
            sub="books.author strings resolved to the canonical authors thesaurus (author_id), anchored to Wikidata/VIAF."
          >
            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 12 }}>
              <Tile
                label="Linked (live)"
                value={pct(a.author_id_live, a.author_string_live)}
                sub={`${fmt(a.author_id_live)} of ${fmt(a.author_string_live)} with an author string`}
              />
              <Tile
                label="Linked (all)"
                value={pct(a.author_id_all, a.author_string_all)}
                sub={`${fmt(a.author_id_all)} of ${fmt(a.author_string_all)} incl. backlog`}
              />
              <Tile label="Unlinked (live)" value={fmt(unresolvedLive)} sub="live books w/o author_id" accent={unresolvedLive > 0 ? STATUS_WARN : STATUS_GOOD} />
              <Tile label="Thesaurus authors" value={fmt(a.thesaurus.total)} />
              <Tile
                label="Wikidata-anchored"
                value={pct(a.thesaurus.wikidata_anchored, a.thesaurus.total)}
                sub={`${fmt(a.thesaurus.wikidata_anchored)} authors`}
              />
              <Tile
                label="VIAF-anchored"
                value={pct(a.thesaurus.viaf_anchored, a.thesaurus.total)}
                sub={`${fmt(a.thesaurus.viaf_anchored)} authors`}
              />
            </div>
            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
              <Card title="Resolution funnel — live vs all books" grow>
                <BarRow label="live: author string" value={a.author_string_live} max={a.author_string_all} color={ORDINAL_3[0]} />
                <BarRow label="live: author_id linked" value={a.author_id_live} max={a.author_string_all} color={ORDINAL_3[1]} />
                <div style={{ height: 8 }} />
                <BarRow label="all: author string" value={a.author_string_all} max={a.author_string_all} color={ORDINAL_3[0]} />
                <BarRow label="all: author_id linked" value={a.author_id_all} max={a.author_string_all} color={ORDINAL_3[1]} />
                <div style={{ fontSize: 12, color: INK_2, marginTop: 8 }}>
                  Thesaurus hygiene: {fmt(a.thesaurus.entity_linked)} entity-linked · {fmt(a.thesaurus.non_person)} non-person flagged · {fmt(a.thesaurus.tombstones)} merge tombstones
                </div>
              </Card>
              <Card title="Top unresolved author strings (live)" grow>
                {a.top_unresolved.length === 0 && <div style={{ fontSize: 12.5, color: INK_2 }}>None — fully resolved.</div>}
                {a.top_unresolved.map(r => (
                  <div key={r.author} style={{ display: 'flex', justifyContent: 'space-between', gap: 12, padding: '2px 0', fontSize: 12.5 }}>
                    <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.author}</span>
                    <span style={{ color: INK_2, fontVariantNumeric: 'tabular-nums' }}>{fmt(r.books)}</span>
                  </div>
                ))}
              </Card>
            </div>
          </Section>
        )}

        {/* ── First translations ── */}
        {ft && (
          <Section
            title="First translations"
            sub="Badges resolved by graded verdicts on recorded search attempts — one writer (nightly reconcile), evidence over assertion."
          >
            {ft.process && (
              <div style={{ marginBottom: 10 }}>
                <Card title="Process coverage — how much of the live corpus has been through FT" grow>
                  <BarRow label="live books" value={ft.process.live_total} max={ft.process.live_total} color={ORDINAL_4[0]} />
                  <BarRow
                    label="searched (≥1 attempt)"
                    value={ft.process.searched}
                    max={ft.process.live_total}
                    color={ORDINAL_4[1]}
                    note={pct(ft.process.searched, ft.process.live_total)}
                  />
                  <BarRow
                    label="verdict materialized"
                    value={ft.process.verdict_materialized}
                    max={ft.process.live_total}
                    color={ORDINAL_4[2]}
                    note={pct(ft.process.verdict_materialized, ft.process.live_total)}
                  />
                  <BarRow
                    label="badged first translation"
                    value={ft.process.badged}
                    max={ft.process.live_total}
                    color={ORDINAL_4[3]}
                    note={pct(ft.process.badged, ft.process.live_total)}
                  />
                  <div style={{ fontSize: 12, color: INK_2, marginTop: 8 }}>
                    Searched-but-no-verdict is mostly terminal, not pending: the search found a prior, so the book was never
                    badged, and verdicts are only materialized where they defend a badge. The unsearched tail
                    ({fmt(ft.process.live_total - ft.process.searched)} books) is what the census cron is closing.
                  </div>
                </Card>
              </div>
            )}
            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 12 }}>
              <Tile label="Badged (live)" value={fmt(ft.badged_live)} sub={`${fmt(ft.badged_all)} incl. hidden`} />
              <Tile
                label="Verdict coverage"
                value={pct(ft.verdict_on_badged_live, ft.badged_live)}
                sub={`${fmt(ft.verdict_on_badged_live)} of ${fmt(ft.badged_live)} badged live`}
                accent={ft.verdict_on_badged_live / Math.max(1, ft.badged_live) > 0.99 ? STATUS_GOOD : STATUS_WARN}
              />
              <Tile label="Books searched" value={fmt(ft.books_searched)} sub="≥1 recorded attempt" />
              <Tile label="Attempts logged" value={fmt(ft.attempts_total)} />
              <Tile
                label="Needs review"
                value={fmt(ft.verdicts.needs_review || 0)}
                sub="⚠ demotes at reconcile"
                accent={(ft.verdicts.needs_review || 0) > 0 ? STATUS_WARN : STATUS_GOOD}
              />
              <Tile label="Reverify proposals" value={fmt(ft.reverify_proposals)} />
            </div>
            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
              <Card title="Verdicts (all books carrying one)" grow>
                {verdictEntries.map(([v, n]) => (
                  <BarRow
                    key={v}
                    label={v}
                    value={n}
                    max={verdictMax}
                    color={v === 'needs_review' ? STATUS_WARN : v.startsWith('not_') ? '#8b949e' : BLUE}
                  />
                ))}
              </Card>
              <Card title="Evidence strength (badged live)" grow>
                {strengthOrder.map((s, i) => (
                  <BarRow
                    key={s}
                    label={s}
                    value={ft.strengths[s] || 0}
                    max={Math.max(1, ...strengthOrder.map(k => ft.strengths[k] || 0))}
                    color={ORDINAL_3[i]}
                  />
                ))}
                <div style={{ fontSize: 12, color: INK_2, marginTop: 8 }}>
                  Only strong/moderate render the assertive claim; weak stays “candidate” — none_found is weak evidence by doctrine.
                </div>
              </Card>
            </div>
            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginTop: 10 }}>
              <Card title="Search attempts — last 30 days" grow>
                {ft.attempts_by_day.length > 0
                  ? <Sparkbars data={ft.attempts_by_day} />
                  : <div style={{ fontSize: 12.5, color: INK_2 }}>No attempts recorded in the window.</div>}
              </Card>
              <Card title="Attempts by method" grow>
                {methodEntries.map(([m, n]) => (
                  <BarRow key={m} label={m} value={n} max={methodMax} color={BLUE} />
                ))}
              </Card>
            </div>
          </Section>
        )}
      </div>
    </div>
  );
}
