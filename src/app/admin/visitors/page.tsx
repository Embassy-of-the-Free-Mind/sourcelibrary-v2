import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import {
  getVisitorCastReport, portrait,
  type CastMember, type Crawler, type EdgeRule,
} from '@/lib/visitor-cast-report';

/**
 * /admin/visitors: who visited in the last 24 h, each kind described as a person (#312):
 * readers, proxy pools, walkers, announced crawlers, and the fleets Cloudflare turned away.
 * Renderer only: every figure comes from ops_reports/visitor-cast, written by
 * scripts/audit/visitor-cast.mjs. Admin-gated by the /admin layout.
 */
export const metadata: Metadata = {
  title: 'Who visits',
  robots: { index: false, follow: false, nocache: true, googleBot: { index: false, follow: false } },
};
export const dynamic = 'force-dynamic';
export const revalidate = 0;

const n = (v: number) => Math.round(v).toLocaleString('en-US');
const muted = { color: 'var(--text-muted)' } as const;
const primary = { color: 'var(--text-primary)' } as const;

const KIND: Record<CastMember['kind'], { label: string; tone: string }> = {
  readers: { label: 'Readers', tone: '#3fb950' },
  pool: { label: 'Proxy pool', tone: '#f0883e' },
  walker: { label: 'Walker', tone: '#d29922' },
  declared: { label: 'Named bot', tone: '#8b949e' },
};

function Hours({ hours, tone }: { hours: number[]; tone: string }) {
  const max = Math.max(1, ...hours);
  return (
    <div>
      <svg viewBox="0 0 96 24" width="100%" height="28" preserveAspectRatio="none" role="img" aria-label="Reads by hour of day, UTC">
        {hours.map((h, i) => (
          <rect key={i} x={i * 4 + 0.5} y={24 - (h / max) * 24} width={3} height={(h / max) * 24} fill={tone} opacity={0.85} />
        ))}
      </svg>
      <div className="flex justify-between text-[10px]" style={muted}><span>00</span><span>06</span><span>12</span><span>18</span><span>24 UTC</span></div>
    </div>
  );
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid grid-cols-[7rem_1fr] gap-2 text-sm py-1">
      <div style={muted}>{label}</div>
      <div style={primary}>{children}</div>
    </div>
  );
}

function bookUrl(slug: string) {
  return `https://sourcelibrary.org/book/${slug}`;
}

function MemberCard({ c }: { c: CastMember }) {
  const k = KIND[c.kind];
  const bookViews = c.where.deep_page + c.where.book_root;
  return (
    <section className="rounded-lg border p-4" style={{ borderColor: 'var(--border-color, #30363d)' }}>
      <div className="flex items-baseline justify-between gap-3 mb-1">
        <h3 className="text-base font-medium" style={primary}>{c.name}</h3>
        <span className="text-xs px-2 py-0.5 rounded" style={{ color: k.tone, border: `1px solid ${k.tone}` }}>{k.label}</span>
      </div>
      <div className="text-2xl font-medium" style={primary}>
        {n(c.reads)} <span className="text-sm font-normal" style={muted}>page views · {c.share_pct}% of all</span>
      </div>
      <p className="text-sm my-3" style={primary}>{portrait(c)}</p>

      <Row label="Says it is">
        {c.claims.map(x => `${x.label} (${x.pct}%)`).join(', ')}
      </Row>
      <Row label="From">{c.countries.map(x => `${x.key} ${x.pct}%`).join(' · ')}</Row>
      <Row label="Arrives from">{c.arrives_from.map(x => `${x.key} ${x.pct}%`).join(' · ')}</Row>
      <Row label="How it reads">
        {c.reads_per_address} pages per address · {c.pages_per_book} pages per book
        {bookViews > 0 && <> · {Math.round((c.where.deep_page / bookViews) * 100)}% straight to an inner page</>}
      </Row>
      <Row label="Reads">
        {c.languages.slice(0, 4).map(x => `${x.key} ${x.pct}%`).join(' · ')}
        <br />
        <span style={muted}>{c.centuries.slice(0, 4).map(x => `${x.key} ${x.pct}%`).join(' · ')}</span>
      </Row>
      <Row label="Most read">
        <ol className="list-decimal pl-4">
          {c.top_books.slice(0, 5).map(b => (
            <li key={b.slug}>
              <a href={bookUrl(b.slug)} className="hover:underline" style={{ color: 'var(--accent-rust)' }}>{b.title}</a>
              <span style={muted}> · {n(b.reads)}{b.year ? ` · ${b.year}` : ''}</span>
            </li>
          ))}
        </ol>
      </Row>
      <div className="mt-2"><Hours hours={c.hours_utc} tone={k.tone} /></div>
    </section>
  );
}

function CrawlerRow({ b }: { b: Crawler }) {
  return (
    <tr className="border-t align-top" style={{ borderColor: 'var(--border-color, #30363d)' }}>
      <td className="py-2 pr-3 font-medium" style={primary}>{b.name}</td>
      <td className="py-2 pr-3 text-right tabular-nums" style={primary}>{n(b.hits)}</td>
      <td className="py-2 pr-3 text-right tabular-nums" style={muted}>{n(b.addresses_at_least)}</td>
      <td className="py-2 pr-3" style={muted}>{b.actions.map(a => `${a.key} ${n(a.count)}`).join(' · ')}</td>
      <td className="py-2" style={muted}>
        {b.top_books.length
          ? b.top_books.slice(0, 3).map((x, i) => (
            <span key={x.slug}>{i > 0 && ' · '}<a href={bookUrl(x.slug)} className="hover:underline" style={{ color: 'var(--accent-rust)' }}>{x.title}</a></span>
          ))
          : b.tried.slice(0, 2).map(x => x.key).join(' · ')}
      </td>
    </tr>
  );
}

function EdgeCard({ r }: { r: EdgeRule }) {
  return (
    <section className="rounded-lg border p-4" style={{ borderColor: 'var(--border-color, #30363d)' }}>
      <div className="flex items-baseline justify-between gap-3">
        <h3 className="text-sm font-medium" style={primary}>{r.name}</h3>
        <span className="text-xs" style={muted}>{r.action === 'block' ? 'blocked' : 'challenged'}</span>
      </div>
      <div className="text-xl font-medium mt-1" style={primary}>
        {n(r.turned_away)} <span className="text-sm font-normal" style={muted}>requests turned away</span>
      </div>
      {r.action === 'challenge' && r.solve_rate_pct != null && (
        <p className="text-sm mt-1" style={primary}>
          Passed the check {n(r.solved)} times ({r.solved > 0 && r.solve_rate_pct < 0.1 ? 'under 0.1' : r.solve_rate_pct}%); {n(r.passed_with_cookie)} more came back already cleared.
        </p>
      )}
      <Row label="Says it is">{r.claims.map(x => x.label).join(', ') || 'none recorded'}</Row>
      <Row label="Comes from">{r.networks.slice(0, 3).map(x => x.name).join(' · ')}</Row>
      <Row label="Tried to read">
        {r.tried.slice(0, 3).map(x => x.path.replace(/\/page\/[0-9a-f]{24}$/, '/page/…')).join(' · ')}
      </Row>
    </section>
  );
}

export default async function VisitorsPage() {
  const r = await getVisitorCastReport();
  if (!r) {
    return (
      <main className="max-w-5xl mx-auto px-6 py-8">
        <h1 className="text-xl font-medium" style={primary}>Who visits</h1>
        <p className="text-sm mt-2" style={muted}>Not yet counted. Run scripts/audit/visitor-cast.mjs --apply.</p>
      </main>
    );
  }
  const turnedAway = r.edge?.reduce((s, e) => s + e.turned_away, 0) ?? null;
  const bots = r.cast.filter(c => c.kind !== 'readers').reduce((s, c) => s + c.reads, 0);
  const readers = r.cast.find(c => c.kind === 'readers');
  const crawlerHits = r.crawlers.reduce((s, b) => s + b.hits, 0);
  const generated = new Date(r.generated_at).toISOString().replace('T', ' ').slice(0, 16) + ' UTC';

  return (
    <main className="max-w-6xl mx-auto px-6 py-8">
      <h1 className="text-xl font-medium mb-1" style={primary}>Who visits</h1>
      <p className="text-sm mb-6 max-w-3xl" style={muted}>
        Everyone who came to the library in the {r.window.hours} hours before {generated}, grouped by kind and
        described as one person would be: how many, who they say they are, what they read and how.
      </p>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-8">
        {[
          { label: 'Readers’ page views', value: readers ? n(readers.reads) : 'none', note: readers ? `${readers.share_pct}% of page views` : '' },
          { label: 'Pool and walker page views', value: n(bots), note: `${Math.round((bots / Math.max(1, r.page_views)) * 1000) / 10}% of page views` },
          { label: 'Named-bot requests', value: n(crawlerHits), note: `${r.crawler_days.join(' + ')} (UTC days)` },
          { label: 'Turned away at Cloudflare', value: turnedAway == null ? 'not measured' : n(turnedAway), note: 'requests blocked or challenged' },
        ].map(s => (
          <div key={s.label} className="rounded-lg border p-3" style={{ borderColor: 'var(--border-color, #30363d)' }}>
            <div className="text-xs" style={muted}>{s.label}</div>
            <div className="text-2xl font-medium" style={primary}>{s.value}</div>
            <div className="text-xs" style={muted}>{s.note}</div>
          </div>
        ))}
      </div>

      <h2 className="text-lg font-medium mb-1" style={primary}>Who got in</h2>
      <p className="text-sm mb-3 max-w-3xl" style={muted}>Visitors whose browser ran the page. Pools and walkers are named by the traffic-anomaly detector from their shape; everyone else is counted as a reader.</p>
      <div className="grid md:grid-cols-2 gap-4 mb-10">
        {r.cast.map(c => <MemberCard key={c.key} c={c} />)}
      </div>

      <h2 className="text-lg font-medium mb-1" style={primary}>Bots that say what they are</h2>
      <p className="text-sm mb-3 max-w-3xl" style={muted}>They run no JavaScript, so they never appear above. Counted by the site itself, {r.crawler_days.join(' and ')}.</p>
      <div className="overflow-x-auto mb-10">
        <table className="w-full text-sm">
          <thead><tr style={muted} className="text-left">
            <th className="py-1 pr-3 font-normal">Bot</th><th className="py-1 pr-3 font-normal text-right">Requests</th>
            <th className="py-1 pr-3 font-normal text-right">Addresses</th><th className="py-1 pr-3 font-normal">What happened</th>
            <th className="py-1 font-normal">Reading</th>
          </tr></thead>
          <tbody>{r.crawlers.map(b => <CrawlerRow key={b.key} b={b} />)}</tbody>
        </table>
      </div>

      <h2 className="text-lg font-medium mb-1" style={primary}>Turned away at the door</h2>
      <p className="text-sm mb-3 max-w-3xl" style={muted}>
        Cloudflare rules, one card each{r.edge_since ? `, since ${r.edge_since.slice(0, 16).replace('T', ' ')} UTC` : ''}. A request is one
        fetch, not one person; a challenge most real browsers pass without noticing.
      </p>
      {r.edge ? (
        <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-4 mb-10">
          {r.edge.map(e => <EdgeCard key={e.key} r={e} />)}
        </div>
      ) : (
        <p className="text-sm mb-10" style={muted}>Not measured in this snapshot{r.edge_error ? `: ${r.edge_error}` : ''}.</p>
      )}

      <h2 className="text-sm font-medium mb-1" style={primary}>How this is counted</h2>
      <p className="text-xs max-w-3xl" style={muted}>{r.method}</p>
    </main>
  );
}
