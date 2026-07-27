'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { getOrCreateVolunteerId } from '@/lib/volunteer-id';

// ── Types ──

export type TalkPagePost = {
  title: string;
  author: string;
  talkPageUrl: string;
  bookUrl: string;
  year: string | number;
  pages: number;
  pct: number;
  tier: 1 | 2 | 3;
  wikiText: string;
  /** Stable identifier for this item — book slug. Used as item_id in the event log. */
  slug: string;
};

type ItemStatus = {
  latest_event?: string;
  claimed_by?: string;
  claimed_at?: string;
  posted_count: number;
  merged_count: number;
  declined_count: number;
};

type MyEvent = { latest_event: string; created_at: string };

type StateResponse = {
  mine: Record<string, MyEvent>;
  global: Record<string, ItemStatus>;
  totals: Record<string, number>;
};

type Event = 'claimed' | 'released' | 'posted' | 'responded' | 'merged' | 'declined' | 'abandoned';

// ── Helpers ──

function timeAgo(iso?: string): string {
  if (!iso) return '';
  const ms = Date.now() - new Date(iso).getTime();
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

function shortVolunteer(id?: string): string {
  if (!id) return '';
  return 'anon-' + id.slice(0, 6);
}

// ── Subcomponents ──

function CopyButton({ text, label }: { text: string; label?: string }) {
  const [copied, setCopied] = useState(false);
  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      const ta = document.createElement('textarea');
      ta.value = text;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      document.body.removeChild(ta);
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };
  return (
    <button
      onClick={handleCopy}
      className={`px-4 py-2 rounded-lg text-sm font-medium transition-all ${
        copied ? 'bg-green-100 text-green-800 border border-green-300' : 'bg-accent-rust text-white hover:opacity-90'
      }`}
    >
      {copied ? 'Copied!' : label || 'Copy text'}
    </button>
  );
}

function Badge({
  color,
  label,
}: {
  color: 'green' | 'red' | 'blue' | 'purple' | 'amber' | 'gray' | 'stone';
  label: string;
}) {
  const colors: Record<string, string> = {
    green: 'bg-green-50 text-green-800 border-green-200',
    red: 'bg-red-50 text-red-800 border-red-200',
    blue: 'bg-blue-50 text-blue-800 border-blue-200',
    purple: 'bg-purple-50 text-purple-800 border-purple-200',
    amber: 'bg-amber-50 text-amber-800 border-amber-200',
    gray: 'bg-gray-100 text-gray-700 border-gray-200',
    stone: 'bg-stone-100 text-stone-600 border-stone-200',
  };
  return <span className={`text-xs px-2 py-1 rounded-md border font-medium ${colors[color]}`}>{label}</span>;
}

function StatusBadge({
  myEvent,
  global,
  volunteerId,
}: {
  myEvent?: string;
  global?: ItemStatus;
  volunteerId: string;
}) {
  if (myEvent === 'merged') return <Badge color="green" label="✓ Merged" />;
  if (myEvent === 'declined') return <Badge color="red" label="Declined" />;
  if (myEvent === 'abandoned') return <Badge color="gray" label="Abandoned" />;
  if (myEvent === 'responded') return <Badge color="purple" label="Editor responded" />;
  if (myEvent === 'posted') return <Badge color="green" label="✓ Posted by you" />;
  if (myEvent === 'claimed') return <Badge color="blue" label="Claimed by you" />;
  if (global?.claimed_by && global.claimed_by !== volunteerId) {
    return (
      <Badge
        color="amber"
        label={`Claimed by ${shortVolunteer(global.claimed_by)} ${timeAgo(global.claimed_at)}`}
      />
    );
  }
  if (global?.merged_count) return <Badge color="green" label={`✓ Merged (${global.merged_count})`} />;
  if (global?.posted_count) return <Badge color="green" label={`Posted (${global.posted_count})`} />;
  return <Badge color="stone" label="Unclaimed" />;
}

function ActionButtons({
  myEvent,
  onEvent,
  busy,
}: {
  myEvent?: string;
  onEvent: (e: Event) => void;
  busy: boolean;
}) {
  const terminal = new Set(['merged', 'declined', 'abandoned']);
  if (terminal.has(myEvent ?? '')) return null;
  const buttons: { event: Event; label: string; primary?: boolean }[] = [];
  if (!myEvent) {
    buttons.push({ event: 'claimed', label: "I'll post this", primary: true });
  } else if (myEvent === 'claimed') {
    buttons.push({ event: 'posted', label: "I've posted it", primary: true });
    buttons.push({ event: 'released', label: 'Release claim' });
  } else if (myEvent === 'posted') {
    buttons.push({ event: 'merged', label: '✓ Merged', primary: true });
    buttons.push({ event: 'responded', label: 'Editor responded' });
    buttons.push({ event: 'declined', label: 'Declined' });
    buttons.push({ event: 'abandoned', label: 'Abandon' });
  } else if (myEvent === 'responded') {
    buttons.push({ event: 'merged', label: '✓ Merged', primary: true });
    buttons.push({ event: 'declined', label: 'Declined' });
    buttons.push({ event: 'abandoned', label: 'Abandon' });
  }
  return (
    <div className="flex flex-wrap gap-2">
      {buttons.map(b => (
        <button
          key={b.event}
          onClick={() => onEvent(b.event)}
          disabled={busy}
          className={
            b.primary
              ? 'px-3 py-1.5 rounded-md text-sm bg-accent-rust text-white hover:opacity-90 disabled:opacity-50'
              : 'px-3 py-1.5 rounded-md text-sm border border-border-light hover:bg-stone-50 disabled:opacity-50 text-secondary'
          }
        >
          {b.label}
        </button>
      ))}
    </div>
  );
}

function TalkPageCard({
  post,
  index,
  volunteerId,
  status,
  myEvent,
  onEvent,
  busy,
}: {
  post: TalkPagePost;
  index: number;
  volunteerId: string;
  status?: ItemStatus;
  myEvent?: string;
  onEvent: (e: Event) => void;
  busy: boolean;
}) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div className="bg-white rounded-xl border border-border-light overflow-hidden">
      <div
        className="flex items-center gap-4 p-5 cursor-pointer hover:bg-stone-50 transition-colors"
        onClick={() => setExpanded(!expanded)}
      >
        <span className="flex-shrink-0 w-8 h-8 rounded-full bg-cream text-primary text-sm font-medium flex items-center justify-center">
          {index + 1}
        </span>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-medium text-primary">{post.title}</span>
            <span className="text-muted text-sm">
              {post.author}, {post.year}
            </span>
            <StatusBadge myEvent={myEvent} global={status} volunteerId={volunteerId} />
          </div>
          <div className="text-sm text-muted mt-0.5">
            {post.pages.toLocaleString()} pages · {post.pct}% translated
          </div>
        </div>
        <span className="text-muted text-xl">{expanded ? '−' : '+'}</span>
      </div>

      {expanded && (
        <div className="border-t border-border-light p-5 space-y-4">
          <div className="flex flex-wrap gap-3">
            <CopyButton text={post.wikiText} label="Copy wiki text" />
            <a
              href={post.talkPageUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="px-4 py-2 rounded-lg text-sm font-medium border border-border-light text-primary hover:bg-stone-50 transition-colors inline-flex items-center gap-1.5"
            >
              Open Talk page
              <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                <path
                  d="M11 7.5V11.5C11 12.0523 10.5523 12.5 10 12.5H2.5C1.94772 12.5 1.5 12.0523 1.5 11.5V4C1.5 3.44772 1.94772 3 2.5 3H6.5M8.5 1.5H12.5V5.5M6 8L12.25 1.75"
                  stroke="currentColor"
                  strokeWidth="1.2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            </a>
            <a
              href={post.bookUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="px-4 py-2 rounded-lg text-sm font-medium text-accent-rust hover:underline inline-flex items-center gap-1"
            >
              View book
            </a>
          </div>

          <div className="bg-stone-50 rounded-lg p-4">
            <div className="text-xs text-muted mb-2 font-medium uppercase tracking-wide">
              Preview of wiki text to paste:
            </div>
            <pre className="text-sm text-secondary whitespace-pre-wrap font-mono leading-relaxed">{post.wikiText}</pre>
          </div>

          <div className="text-sm text-muted bg-cream rounded-lg p-3">
            <strong>How:</strong> Click &ldquo;Copy wiki text&rdquo;, then &ldquo;Open Talk page&rdquo;. On
            Wikipedia, click &ldquo;New section&rdquo; (or &ldquo;Add topic&rdquo;), paste, and save. Then come
            back here and mark it posted so others know it&rsquo;s done.
          </div>

          <div className="pt-2 border-t border-border-light">
            <div className="text-xs text-muted uppercase tracking-wide mb-2 font-medium">Track your progress</div>
            <ActionButtons myEvent={myEvent} onEvent={onEvent} busy={busy} />
          </div>
        </div>
      )}
    </div>
  );
}

function MySidebar({ posts, mine }: { posts: TalkPagePost[]; mine: Record<string, MyEvent> }) {
  const active = posts.filter(p => {
    const m = mine[p.slug];
    return m && !['merged', 'declined', 'abandoned'].includes(m.latest_event);
  });
  const done = posts.filter(p => {
    const m = mine[p.slug];
    return m && ['merged', 'declined', 'abandoned'].includes(m.latest_event);
  });
  if (active.length === 0 && done.length === 0) {
    return (
      <aside className="bg-cream rounded-xl p-5 border border-border-light text-sm text-muted">
        <h3 className="text-primary font-semibold mb-2">Your contributions</h3>
        Pick an item below and claim it to start. Your progress saves automatically (per-browser).
      </aside>
    );
  }
  return (
    <aside className="bg-cream rounded-xl p-5 border border-border-light">
      <h3 className="text-primary font-semibold mb-3">Your contributions</h3>
      {active.length > 0 && (
        <div className="mb-4">
          <div className="text-xs text-muted uppercase tracking-wide mb-2 font-medium">Active</div>
          <ul className="space-y-2 text-sm">
            {active.map(p => (
              <li key={p.slug} className="flex items-baseline justify-between gap-2">
                <span className="text-secondary truncate">
                  {p.title.slice(0, 36)}
                  {p.title.length > 36 ? '…' : ''}
                </span>
                <span className="text-xs text-muted shrink-0">{mine[p.slug].latest_event}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
      {done.length > 0 && (
        <div>
          <div className="text-xs text-muted uppercase tracking-wide mb-2 font-medium">Done</div>
          <ul className="space-y-2 text-sm">
            {done.map(p => (
              <li key={p.slug} className="flex items-baseline justify-between gap-2">
                <span className="text-secondary truncate">
                  {p.title.slice(0, 36)}
                  {p.title.length > 36 ? '…' : ''}
                </span>
                <span className="text-xs text-muted shrink-0">{mine[p.slug].latest_event}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </aside>
  );
}

function GlobalTotals({ totals }: { totals: Record<string, number> }) {
  const items: { key: string; label: string }[] = [
    { key: 'claimed', label: 'claimed' },
    { key: 'posted', label: 'posted' },
    { key: 'responded', label: 'responses' },
    { key: 'merged', label: 'merged' },
  ];
  const hasAny = items.some(i => (totals[i.key] ?? 0) > 0);
  if (!hasAny) return null;
  return (
    <div className="flex flex-wrap gap-4 text-sm text-muted">
      {items.map(i => (
        <span key={i.key}>
          <b className="text-primary">{totals[i.key] ?? 0}</b> {i.label}
        </span>
      ))}
    </div>
  );
}

function Step({ n, text }: { n: number; text: string }) {
  return (
    <div className="bg-white rounded-lg p-4 text-center">
      <div className="text-2xl mb-2 text-primary font-display">{n}</div>
      <div className="text-sm text-secondary">{text}</div>
    </div>
  );
}

// ── Main ──

export function WikipediaPlaybook({ posts }: { posts: TalkPagePost[] }) {
  const [volunteerId, setVolunteerId] = useState('');
  const [state, setState] = useState<StateResponse | null>(null);
  const [busy, setBusy] = useState(false);

  const fetchState = useCallback(async (id: string) => {
    try {
      const r = await fetch(`/api/contribute/wikipedia/state?volunteer_id=${id}`);
      const data = (await r.json()) as StateResponse;
      setState(data);
    } catch (e) {
      // Soft-fail: page still works without tracking; just no badges.
      console.warn('[wikipedia state] fetch failed', e);
    }
  }, []);

  useEffect(() => {
    const id = getOrCreateVolunteerId();
    setVolunteerId(id);
    fetchState(id);
  }, [fetchState]);

  const sendEvent = useCallback(
    async (slug: string, event: Event) => {
      if (!volunteerId || busy) return;
      setBusy(true);
      try {
        await fetch('/api/contribute/wikipedia/event', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ item_id: slug, event, volunteer_id: volunteerId }),
        });
        await fetchState(volunteerId);
      } finally {
        setBusy(false);
      }
    },
    [volunteerId, busy, fetchState],
  );

  const tier1 = useMemo(() => posts.filter(p => p.tier === 1), [posts]);
  const tier2 = useMemo(() => posts.filter(p => p.tier === 2), [posts]);
  const tier3 = useMemo(() => posts.filter(p => p.tier === 3), [posts]);

  const mine = state?.mine ?? {};
  const global = state?.global ?? {};
  const totals = state?.totals ?? {};

  function renderCard(post: TalkPagePost, idx: number) {
    return (
      <TalkPageCard
        key={post.slug}
        post={post}
        index={idx}
        volunteerId={volunteerId}
        status={global[post.slug]}
        myEvent={mine[post.slug]?.latest_event}
        onEvent={e => sendEvent(post.slug, e)}
        busy={busy}
      />
    );
  }

  return (
    <div className="space-y-10">
      <div className="prose-content max-w-none">
        <p className="text-xl text-secondary leading-relaxed">
          Source Library has thousands of translated historical texts: Copernicus, Galileo, Euclid, the Corpus
          Hermeticum, and more. Wikipedia readers should be able to find them. Claim an item, post it on the
          Talk page, and track your contribution — so volunteers don&rsquo;t duplicate work and we can see the
          impact.
        </p>
      </div>

      <MySidebar posts={posts} mine={mine} />
      <GlobalTotals totals={totals} />

      <section className="bg-white rounded-xl p-6 border border-border-light">
        <h2 className="text-xl text-primary mb-4">Before you start</h2>
        <ol className="text-secondary space-y-3 list-decimal list-inside">
          <li>
            <strong>Create a Wikimedia account</strong> (if you don&rsquo;t have one) &mdash;{' '}
            <a
              href="https://en.wikipedia.org/wiki/Special:CreateAccount"
              target="_blank"
              rel="noopener noreferrer"
              className="text-accent-rust hover:underline"
            >
              create account
            </a>
            . One account works for Wikipedia, Wikidata, and Commons.
          </li>
          <li>
            <strong>Disclose your affiliation</strong> on your user Talk page: write &ldquo;I am affiliated with
            Source Library&rdquo; or add{' '}
            <code className="text-sm bg-stone-100 px-1.5 py-0.5 rounded">
              {'{{Wikipedia:Conflict of interest/Statement|Source Library}}'}
            </code>
          </li>
          <li>
            <strong>Post no more than 5 per day</strong> to avoid looking like spam. Quality over quantity.
          </li>
          <li>
            <strong>Claim an item below before you post</strong> so others can see it&rsquo;s in progress and
            don&rsquo;t duplicate. Mark it Posted once you&rsquo;ve made the Talk-page contribution, and Merged
            when an editor accepts it.
          </li>
        </ol>
      </section>

      <section className="bg-cream rounded-xl p-6 border border-border-light">
        <h2 className="text-xl text-primary mb-3">How this works</h2>
        <p className="text-secondary mb-4">
          Because Source Library is affiliated with these contributions, Wikipedia policy asks us to{' '}
          <em>suggest</em> edits on article Talk pages rather than editing articles directly. Each card below
          contains pre-written text. The process for each one is:
        </p>
        <div className="grid sm:grid-cols-4 gap-4">
          <Step n={1} text='Click "I&apos;ll post this" to claim it' />
          <Step n={2} text="Copy wiki text + open Talk page" />
          <Step n={3} text="Paste as a new section on Wikipedia" />
          <Step n={4} text="Mark Posted (then Merged when accepted)" />
        </div>
      </section>

      <section>
        <div className="mb-4">
          <h2 className="text-2xl text-primary font-display">Tier 1 &mdash; Highest-Traffic Articles</h2>
          <p className="text-muted text-sm mt-1">Start here. These Wikipedia articles get the most readers.</p>
        </div>
        <div className="space-y-3">{tier1.map((p, i) => renderCard(p, i))}</div>
      </section>

      <section>
        <div className="mb-4">
          <h2 className="text-2xl text-primary font-display">Tier 2 &mdash; Strong Candidates</h2>
          <p className="text-muted text-sm mt-1">Post these after Tier 1, once you see some responses.</p>
        </div>
        <div className="space-y-3">{tier2.map((p, i) => renderCard(p, tier1.length + i))}</div>
      </section>

      <section>
        <div className="mb-4">
          <h2 className="text-2xl text-primary font-display">Tier 3 &mdash; Major Author Articles</h2>
          <p className="text-muted text-sm mt-1">
            These link to the author&rsquo;s Wikipedia article rather than a specific work article.
          </p>
        </div>
        <div className="space-y-3">{tier3.map((p, i) => renderCard(p, tier1.length + tier2.length + i))}</div>
      </section>

      <section className="bg-white rounded-xl p-6 border border-border-light">
        <h2 className="text-xl text-primary mb-4">Tips</h2>
        <ul className="text-secondary space-y-2 list-disc list-inside">
          <li>
            <strong>Be patient.</strong> Some Talk page suggestions take days or weeks to get a response.
            That&rsquo;s normal.
          </li>
          <li>
            <strong>Respond to feedback.</strong> If an editor asks a question, engage respectfully.
          </li>
          <li>
            <strong>Never edit articles directly</strong> when you have a conflict of interest. Always use Talk
            pages.
          </li>
          <li>
            <strong>Don&rsquo;t game it.</strong> Source Library is genuinely useful. Let the quality speak.
          </li>
          <li>
            <strong>Mark Merged honestly.</strong> Only when an editor actually updates the article — not when
            you post on Talk. The merged counter helps us prove impact to funders.
          </li>
        </ul>
      </section>

      <div className="text-sm text-muted text-center pb-8">
        Questions? Contact{' '}
        <a href="mailto:team@sourcelibrary.org" className="text-accent-rust hover:underline">
          team@sourcelibrary.org
        </a>
      </div>
    </div>
  );
}
