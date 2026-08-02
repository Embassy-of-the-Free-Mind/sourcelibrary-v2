'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { Eye, TrendingUp, Download, Heart, BookOpen, Search, Moon, Globe, Layers, Sparkles, Star, HelpCircle } from 'lucide-react';

type Ref = { id: string; title: string; author: string; slug: string };
type Insights = {
  summary: { views7: number; views30: number; pageReads30: number; booksViewed: number; neverOpened: number; downloads30: number; bookLikes: number };
  weekly: { week: string; views: number }[];
  topViewed: (Ref & { count: number; language?: string })[];
  trending: (Ref & { now: number; prev: number; delta: number })[];
  topDownloaded: (Ref & { count: number })[];
  topLiked: (Ref & { count: number })[];
  deepestRead: (Ref & { count: number })[];
  punching: (Ref & { likes: number; views: number; per100: number })[];
  newArrivals: (Ref & { count: number; added?: string })[];
  byLanguage: { language: string; views: number; books: number }[];
  topSearches: { term: string; count: number }[];
  searchGaps: { term: string; count: number; results: number }[];
  geo: { country: string; count: number; pct: number }[];
};

const num = (n?: number) => (n ?? 0).toLocaleString();

function StatCard({ icon, label, value, sub, tint }: { icon: React.ReactNode; label: string; value: string; sub?: string; tint: string }) {
  return (
    <div className="p-5 rounded-xl" style={{ background: `linear-gradient(135deg, var(--bg-white), ${tint})`, border: '1px solid var(--border-light)' }}>
      <div className="flex items-center gap-2 mb-2" style={{ color: 'var(--text-muted)' }}>{icon}<span className="text-xs font-medium uppercase tracking-wide">{label}</span></div>
      <div className="text-3xl font-bold tabular-nums" style={{ color: 'var(--text-primary)' }}>{value}</div>
      {sub && <div className="text-xs mt-1" style={{ color: 'var(--text-muted)' }}>{sub}</div>}
    </div>
  );
}

function BookLink({ b }: { b: Ref }) {
  return <Link href={`/book/${b.slug}`} target="_blank" className="hover:underline" style={{ color: 'var(--text-primary)' }}>{b.title}{b.author ? <span style={{ color: 'var(--text-muted)' }}> · {b.author}</span> : null}</Link>;
}

function Panel({ title, icon, sub, children }: { title: string; icon: React.ReactNode; sub?: string; children: React.ReactNode }) {
  return (
    <div className="rounded-xl overflow-hidden" style={{ border: '1px solid var(--border-light)' }}>
      <div className="px-4 py-3 flex items-center gap-2" style={{ background: 'var(--bg-warm)', color: 'var(--text-primary)' }}>
        {icon}<h3 className="font-semibold text-sm">{title}</h3>{sub && <span className="text-xs font-normal ml-auto" style={{ color: 'var(--text-muted)' }}>{sub}</span>}
      </div>
      {children}
    </div>
  );
}

function RankTable<T extends Ref>({ title, icon, sub, rows, value, empty }: { title: string; icon: React.ReactNode; sub?: string; rows: T[]; value: (r: T) => React.ReactNode; empty: string }) {
  return (
    <Panel title={title} icon={icon} sub={sub}>
      {rows.length === 0 ? <div className="px-4 py-8 text-center text-sm" style={{ color: 'var(--text-muted)' }}>{empty}</div> : (
        <ol>{rows.map((r, i) => (
          <li key={r.id + i} className="flex items-center gap-3 px-4 py-2 text-sm" style={{ borderTop: i ? '1px solid var(--border-light)' : 'none' }}>
            <span className="w-5 text-right tabular-nums" style={{ color: 'var(--text-muted)' }}>{i + 1}</span>
            <span className="flex-1 min-w-0 truncate"><BookLink b={r} /></span>
            <span className="tabular-nums font-semibold shrink-0" style={{ color: 'var(--text-primary)' }}>{value(r)}</span>
          </li>
        ))}</ol>
      )}
    </Panel>
  );
}

export default function BooksTab() {
  const [d, setD] = useState<Insights | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    fetch('/api/admin/book-insights').then((r) => { if (r.status === 403 || r.status === 401) throw new Error('This tab is admin-only.'); if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json(); }).then(setD).catch((e) => setErr(e.message)).finally(() => setLoading(false));
  }, []);

  if (loading) return <div className="py-12 text-center text-sm" style={{ color: 'var(--text-muted)' }}>Crunching reads, likes, downloads &amp; searches…</div>;
  if (err || !d) return <div className="py-12 text-center text-sm" style={{ color: 'var(--text-muted)' }}>Couldn&apos;t load insights{err ? ` (${err})` : ''}.</div>;

  const maxWeek = Math.max(1, ...d.weekly.map((w) => w.views));
  const maxLang = Math.max(1, ...d.byLanguage.map((l) => l.views));
  const fmtWeek = (iso: string) => new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });

  return (
    <div className="space-y-8">
      {/* Summary */}
      <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-7 gap-4">
        <StatCard icon={<Eye className="w-4 h-4" />} label="Reads · 7d" value={num(d.summary.views7)} tint="#eff6ff" />
        <StatCard icon={<Eye className="w-4 h-4" />} label="Reads · 30d" value={num(d.summary.views30)} tint="#f0f9ff" />
        <StatCard icon={<Layers className="w-4 h-4" />} label="Pages read · 30d" value={num(d.summary.pageReads30)} tint="#ecfeff" />
        <StatCard icon={<BookOpen className="w-4 h-4" />} label="Books opened" value={num(d.summary.booksViewed)} sub="all-time" tint="#f0fdf4" />
        <StatCard icon={<Moon className="w-4 h-4" />} label="Never opened" value={num(d.summary.neverOpened)} sub="visible, 0 views" tint="#faf5ff" />
        <StatCard icon={<Download className="w-4 h-4" />} label="Downloads · 30d" value={num(d.summary.downloads30)} tint="#fff7ed" />
        <StatCard icon={<Heart className="w-4 h-4" />} label="Book likes" value={num(d.summary.bookLikes)} sub="all-time" tint="#fef2f2" />
      </div>

      {/* Weekly trend */}
      <div>
        <h2 className="text-sm font-semibold uppercase tracking-wide mb-1" style={{ color: 'var(--text-muted)' }}>Book opens per week · last 16 weeks</h2>
        <p className="text-xs mb-3" style={{ color: 'var(--text-muted)' }}>All traffic (bots included). Reliable <em>human</em> read tracking began Jul 28 (#3405), so the human counts in the cards and leaderboards are recent-window; this trend gives the fuller shape.</p>
        <div className="flex items-end gap-1.5 h-40 px-1 rounded-xl py-3" style={{ border: '1px solid var(--border-light)', background: 'var(--bg-white)' }}>
          {d.weekly.map((w) => (
            <div key={w.week} className="flex-1 flex flex-col items-center justify-end h-full group" title={`Week of ${fmtWeek(w.week)}: ${num(w.views)} opens`}>
              <div className="w-full rounded-t transition-all group-hover:opacity-80" style={{ height: `${(w.views / maxWeek) * 100}%`, background: 'var(--accent-sage, #7c9885)', minHeight: 2 }} />
              <span className="text-[9px] mt-1 whitespace-nowrap" style={{ color: 'var(--text-muted)' }}>{fmtWeek(w.week)}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Trending + Most read */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <RankTable title="Trending this week" icon={<TrendingUp className="w-4 h-4" />} sub="reads, vs last week" rows={d.trending} value={(r) => <span title={`${r.now} this week vs ${r.prev} last`}>+{num(r.delta)}</span>} empty="Fills in as this week's reads accrue." />
        <RankTable title="Most read · all time" icon={<Eye className="w-4 h-4" />} rows={d.topViewed} value={(r) => num(r.count)} empty="No reads yet." />
      </div>

      {/* Depth + quality */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <RankTable title="Most deeply read" icon={<Layers className="w-4 h-4" />} sub="pages turned · 30d" rows={d.deepestRead} value={(r) => num(r.count)} empty="No page reads yet." />
        <RankTable title="Punching above their weight" icon={<Star className="w-4 h-4" />} sub="likes per 100 reads (≥25 reads)" rows={d.punching} value={(r) => <span title={`${r.likes} likes / ${num(r.views)} reads`}>{r.per100.toFixed(1)}</span>} empty="Not enough liked-and-read books yet." />
      </div>

      {/* Liked + Downloaded + New arrivals */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <RankTable title="Most liked" icon={<Heart className="w-4 h-4" />} rows={d.topLiked} value={(r) => num(r.count)} empty="No book likes yet." />
        <RankTable title="Most downloaded" icon={<Download className="w-4 h-4" />} sub="30d" rows={d.topDownloaded} value={(r) => num(r.count)} empty="No downloads in 30 days." />
        <RankTable title="New arrivals finding readers" icon={<Sparkles className="w-4 h-4" />} sub="added ≤90d" rows={d.newArrivals} value={(r) => num(r.count)} empty="No recent imports with reads." />
      </div>

      {/* Geography + Language */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Panel title="Where readers are" icon={<Globe className="w-4 h-4" />} sub="searches & downloads · 30d">
          <div className="p-4 space-y-2">
            {d.geo.length === 0 ? <div className="text-center text-sm py-4" style={{ color: 'var(--text-muted)' }}>No geo data yet.</div> : d.geo.map((g) => (
              <div key={g.country} className="text-sm">
                <div className="flex justify-between mb-0.5"><span style={{ color: 'var(--text-primary)' }}>{g.country}</span><span className="tabular-nums" style={{ color: 'var(--text-muted)' }}>{g.pct}% · {num(g.count)}</span></div>
                <div className="h-1.5 rounded-full overflow-hidden" style={{ background: 'var(--bg-warm)' }}><div className="h-full rounded-full" style={{ width: `${g.pct}%`, background: 'var(--accent-sage, #7c9885)' }} /></div>
              </div>
            ))}
          </div>
        </Panel>
        <Panel title="Reads by language" icon={<BookOpen className="w-4 h-4" />} sub="all-time">
          <div className="p-4 space-y-2">
            {d.byLanguage.map((l) => (
              <div key={l.language} className="text-sm">
                <div className="flex justify-between mb-0.5"><span style={{ color: 'var(--text-primary)' }}>{l.language}</span><span className="tabular-nums" style={{ color: 'var(--text-muted)' }}>{num(l.views)}</span></div>
                <div className="h-1.5 rounded-full overflow-hidden" style={{ background: 'var(--bg-warm)' }}><div className="h-full rounded-full" style={{ width: `${(l.views / maxLang) * 100}%`, background: 'var(--accent-sage, #7c9885)' }} /></div>
              </div>
            ))}
          </div>
        </Panel>
      </div>

      {/* Searches + gaps */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Panel title="Top searches" icon={<Search className="w-4 h-4" />} sub="30d">
          {d.topSearches.length === 0 ? <div className="px-4 py-8 text-center text-sm" style={{ color: 'var(--text-muted)' }}>No searches yet.</div> : (
            <ol>{d.topSearches.map((s, i) => (
              <li key={s.term + i} className="flex items-center gap-3 px-4 py-2 text-sm" style={{ borderTop: i ? '1px solid var(--border-light)' : 'none' }}>
                <span className="w-5 text-right tabular-nums" style={{ color: 'var(--text-muted)' }}>{i + 1}</span>
                <Link href={`/search?q=${encodeURIComponent(s.term)}`} target="_blank" className="flex-1 min-w-0 truncate hover:underline" style={{ color: 'var(--text-primary)' }}>{s.term}</Link>
                <span className="tabular-nums font-semibold shrink-0" style={{ color: 'var(--text-primary)' }}>{num(s.count)}</span>
              </li>
            ))}</ol>
          )}
        </Panel>
        <Panel title="Searches that came up short" icon={<HelpCircle className="w-4 h-4" />} sub="≤2 results · 30d — acquisition signal">
          {d.searchGaps.length === 0 ? <div className="px-4 py-8 text-center text-sm" style={{ color: 'var(--text-muted)' }}>No low-result searches — nice.</div> : (
            <ol>{d.searchGaps.map((s, i) => (
              <li key={s.term + i} className="flex items-center gap-3 px-4 py-2 text-sm" style={{ borderTop: i ? '1px solid var(--border-light)' : 'none' }}>
                <span className="w-5 text-right tabular-nums" style={{ color: 'var(--text-muted)' }}>{i + 1}</span>
                <Link href={`/search?q=${encodeURIComponent(s.term)}`} target="_blank" className="flex-1 min-w-0 truncate hover:underline" style={{ color: 'var(--text-primary)' }}>{s.term}</Link>
                <span className="text-xs shrink-0" style={{ color: 'var(--text-muted)' }}>{s.results} res · ×{s.count}</span>
              </li>
            ))}</ol>
          )}
        </Panel>
      </div>
    </div>
  );
}
