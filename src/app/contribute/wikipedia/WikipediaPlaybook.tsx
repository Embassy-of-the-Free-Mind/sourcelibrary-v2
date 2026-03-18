'use client';

import { useState } from 'react';

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
};

// ── Components ──

function CopyButton({ text, label }: { text: string; label?: string }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      const ta = document.createElement('textarea');
      ta.value = text;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      document.body.removeChild(ta);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  return (
    <button
      onClick={handleCopy}
      className={`px-4 py-2 rounded-lg text-sm font-medium transition-all ${
        copied
          ? 'bg-green-100 text-green-800 border border-green-300'
          : 'bg-accent-rust text-white hover:opacity-90'
      }`}
    >
      {copied ? 'Copied!' : label || 'Copy text'}
    </button>
  );
}

function TalkPageCard({
  post,
  index,
}: {
  post: TalkPagePost;
  index: number;
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
          </div>
          <div className="text-sm text-muted mt-0.5">
            {post.pages.toLocaleString()} pages, {post.pct}% translated
          </div>
        </div>
        <span
          className={`flex-shrink-0 text-muted transition-transform ${
            expanded ? 'rotate-180' : ''
          }`}
        >
          <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
            <path
              d="M5 7.5L10 12.5L15 7.5"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </span>
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
            <pre className="text-sm text-secondary whitespace-pre-wrap font-mono leading-relaxed">
              {post.wikiText}
            </pre>
          </div>

          <div className="text-sm text-muted bg-cream rounded-lg p-3">
            <strong>How:</strong> Click &ldquo;Copy wiki text&rdquo;, then
            &ldquo;Open Talk page&rdquo;. On Wikipedia, click &ldquo;New
            section&rdquo; (or &ldquo;Add topic&rdquo;), paste, and save.
          </div>
        </div>
      )}
    </div>
  );
}

// ── Main ──

export function WikipediaPlaybook({ posts }: { posts: TalkPagePost[] }) {
  const tier1 = posts.filter((p) => p.tier === 1);
  const tier2 = posts.filter((p) => p.tier === 2);
  const tier3 = posts.filter((p) => p.tier === 3);

  return (
    <div className="space-y-10">
      {/* Intro */}
      <div className="prose-content max-w-none">
        <p className="text-xl text-secondary leading-relaxed">
          Source Library has thousands of translated historical texts —
          Copernicus, Galileo, Euclid, the Corpus Hermeticum, and more. Wikipedia
          readers should be able to find them. This page makes it easy to help.
        </p>
      </div>

      {/* Prerequisites */}
      <section className="bg-white rounded-xl p-6 border border-border-light">
        <h2 className="text-xl text-primary mb-4">Before you start</h2>
        <ol className="text-secondary space-y-3 list-decimal list-inside">
          <li>
            <strong>Create a Wikimedia account</strong> (if you don&rsquo;t have
            one) &mdash;{' '}
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
            <strong>Disclose your affiliation</strong> on your user Talk page:
            write &ldquo;I am affiliated with Source Library&rdquo; or add{' '}
            <code className="text-sm bg-stone-100 px-1.5 py-0.5 rounded">
              {'{{Wikipedia:Conflict of interest/Statement|Source Library}}'}
            </code>
          </li>
          <li>
            <strong>Post no more than 5 per day</strong> to avoid looking like
            spam. Quality over quantity.
          </li>
        </ol>
      </section>

      {/* How it works */}
      <section className="bg-cream rounded-xl p-6 border border-border-light">
        <h2 className="text-xl text-primary mb-3">How this works</h2>
        <p className="text-secondary mb-4">
          Because Source Library is affiliated with these contributions, Wikipedia
          policy asks us to <em>suggest</em> edits on article Talk pages rather than
          editing articles directly. Each card below contains pre-written text. The
          process for each one is:
        </p>
        <div className="grid sm:grid-cols-3 gap-4">
          <div className="bg-white rounded-lg p-4 text-center">
            <div className="text-2xl mb-2 text-primary font-display">1</div>
            <div className="text-sm text-secondary">
              Click <strong>&ldquo;Copy wiki text&rdquo;</strong>
            </div>
          </div>
          <div className="bg-white rounded-lg p-4 text-center">
            <div className="text-2xl mb-2 text-primary font-display">2</div>
            <div className="text-sm text-secondary">
              Click <strong>&ldquo;Open Talk page&rdquo;</strong>
            </div>
          </div>
          <div className="bg-white rounded-lg p-4 text-center">
            <div className="text-2xl mb-2 text-primary font-display">3</div>
            <div className="text-sm text-secondary">
              Click <strong>&ldquo;New section&rdquo;</strong>, paste, save
            </div>
          </div>
        </div>
      </section>

      {/* Tier 1 */}
      <section>
        <div className="mb-4">
          <h2 className="text-2xl text-primary font-display">
            Tier 1 &mdash; Highest-Traffic Articles
          </h2>
          <p className="text-muted text-sm mt-1">
            Start here. These Wikipedia articles get the most readers.
          </p>
        </div>
        <div className="space-y-3">
          {tier1.map((post, i) => (
            <TalkPageCard key={post.bookUrl} post={post} index={i} />
          ))}
        </div>
      </section>

      {/* Tier 2 */}
      <section>
        <div className="mb-4">
          <h2 className="text-2xl text-primary font-display">
            Tier 2 &mdash; Strong Candidates
          </h2>
          <p className="text-muted text-sm mt-1">
            Post these after Tier 1, once you see some responses.
          </p>
        </div>
        <div className="space-y-3">
          {tier2.map((post, i) => (
            <TalkPageCard
              key={post.bookUrl}
              post={post}
              index={tier1.length + i}
            />
          ))}
        </div>
      </section>

      {/* Tier 3 */}
      <section>
        <div className="mb-4">
          <h2 className="text-2xl text-primary font-display">
            Tier 3 &mdash; Major Author Articles
          </h2>
          <p className="text-muted text-sm mt-1">
            These link to the author&rsquo;s Wikipedia article rather than a
            specific work article.
          </p>
        </div>
        <div className="space-y-3">
          {tier3.map((post, i) => (
            <TalkPageCard
              key={post.bookUrl}
              post={post}
              index={tier1.length + tier2.length + i}
            />
          ))}
        </div>
      </section>

      {/* Tips */}
      <section className="bg-white rounded-xl p-6 border border-border-light">
        <h2 className="text-xl text-primary mb-4">Tips</h2>
        <ul className="text-secondary space-y-2 list-disc list-inside">
          <li>
            <strong>Be patient.</strong> Some Talk page suggestions take days or
            weeks to get a response. That&rsquo;s normal.
          </li>
          <li>
            <strong>Respond to feedback.</strong> If an editor asks a question,
            engage respectfully.
          </li>
          <li>
            <strong>Never edit articles directly</strong> when you have a conflict
            of interest. Always use Talk pages.
          </li>
          <li>
            <strong>Don&rsquo;t game it.</strong> Source Library is genuinely
            useful. Let the quality speak.
          </li>
        </ul>
      </section>

      {/* Footer */}
      <div className="text-sm text-muted text-center pb-8">
        Questions? Contact{' '}
        <a
          href="mailto:derek@ancientwisdomtrust.org"
          className="text-accent-rust hover:underline"
        >
          derek@ancientwisdomtrust.org
        </a>
      </div>
    </div>
  );
}
