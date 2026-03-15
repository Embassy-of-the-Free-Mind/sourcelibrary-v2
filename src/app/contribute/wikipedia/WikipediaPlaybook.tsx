'use client';

import { useState } from 'react';

// ── Data ──

const TALK_PAGE_POSTS: {
  title: string;
  author: string;
  talkPageUrl: string;
  bookUrl: string;
  year: number | string;
  pages: number;
  pct: number;
  tier: 1 | 2 | 3;
  wikiText: string;
}[] = [
  {
    title: 'De Revolutionibus',
    author: 'Copernicus',
    talkPageUrl: 'https://en.wikipedia.org/wiki/Talk:De_revolutionibus_orbium_coelestium',
    bookUrl: 'https://sourcelibrary.org/book/de-revolutionibus-1543-first-edition-copernicus',
    year: 1543,
    pages: 426,
    pct: 100,
    tier: 1,
    wikiText: `== External link suggestion: English translation at Source Library ==

{{edit COI}} I'm affiliated with Source Library.

* [https://sourcelibrary.org/book/de-revolutionibus-1543-first-edition-copernicus De Revolutionibus (1543 First Edition)] — page-by-page English translation of the complete 1543 first edition. 426 pages, 100% complete. Original Latin alongside translation. Free access, CC-BY-4.0.

~~~~`,
  },
  {
    title: 'Sidereus Nuncius',
    author: 'Galileo',
    talkPageUrl: 'https://en.wikipedia.org/wiki/Talk:Sidereus_Nuncius',
    bookUrl: 'https://sourcelibrary.org/book/sidereus-nuncius-1610-venice-galilei',
    year: 1610,
    pages: 72,
    pct: 100,
    tier: 1,
    wikiText: `== External link suggestion: English translation at Source Library ==

{{edit COI}} I'm affiliated with Source Library.

* [https://sourcelibrary.org/book/sidereus-nuncius-1610-venice-galilei Sidereus Nuncius (1610 Venice)] — page-by-page English translation of Galileo's 1610 text. 72 pages, 100% complete. Original Latin alongside translation. Free access, CC-BY-4.0.

~~~~`,
  },
  {
    title: 'Astronomia Nova',
    author: 'Kepler',
    talkPageUrl: 'https://en.wikipedia.org/wiki/Talk:Astronomia_nova',
    bookUrl: 'https://sourcelibrary.org/book/kepler-astronomia-nova-1609-prague-kepler',
    year: 1609,
    pages: 388,
    pct: 100,
    tier: 1,
    wikiText: `== External link suggestion: English translation at Source Library ==

{{edit COI}} I'm affiliated with Source Library.

* [https://sourcelibrary.org/book/kepler-astronomia-nova-1609-prague-kepler Astronomia Nova (1609 Prague)] — page-by-page English translation of Kepler's 1609 text. 388 pages, 100% complete. Original Latin alongside translation. Free access, CC-BY-4.0.

~~~~`,
  },
  {
    title: 'De Humani Corporis Fabrica',
    author: 'Vesalius',
    talkPageUrl: 'https://en.wikipedia.org/wiki/Talk:De_Humani_Corporis_Fabrica_Libri_Septem',
    bookUrl: 'https://sourcelibrary.org/book/vesalius-de-humani-corporis-fabrica-1555-vesalius',
    year: 1555,
    pages: 863,
    pct: 96,
    tier: 1,
    wikiText: `== External link suggestion: English translation at Source Library ==

{{edit COI}} I'm affiliated with Source Library.

* [https://sourcelibrary.org/book/vesalius-de-humani-corporis-fabrica-1555-vesalius De Humani Corporis Fabrica (1555)] — page-by-page English translation. 863 pages, 96% complete. Original Latin alongside translation. Free access, CC-BY-4.0.

~~~~`,
  },
  {
    title: "Euclid's Elements",
    author: 'Euclid',
    talkPageUrl: 'https://en.wikipedia.org/wiki/Talk:Euclid%27s_Elements',
    bookUrl: 'https://sourcelibrary.org/book/elements-euclid',
    year: 1482,
    pages: 278,
    pct: 100,
    tier: 1,
    wikiText: `== External link suggestion: English translation at Source Library ==

{{edit COI}} I'm affiliated with Source Library.

* [https://sourcelibrary.org/book/elements-euclid Elements (1482 edition)] — page-by-page English translation of the 1482 first printed edition. 278 pages, 100% complete. Original language alongside translation. Free access, CC-BY-4.0.

~~~~`,
  },
  {
    title: 'Three Books of Occult Philosophy',
    author: 'Agrippa',
    talkPageUrl: 'https://en.wikipedia.org/wiki/Talk:Three_Books_of_Occult_Philosophy',
    bookUrl: 'https://sourcelibrary.org/book/three-books-of-occult-philosophy-nettesheim',
    year: 1550,
    pages: 626,
    pct: 100,
    tier: 1,
    wikiText: `== External link suggestion: English translation at Source Library ==

{{edit COI}} I'm affiliated with Source Library.

* [https://sourcelibrary.org/book/three-books-of-occult-philosophy-nettesheim Three Books of Occult Philosophy (1550)] — page-by-page English translation. 626 pages, 100% complete. Original Latin alongside translation. Free access, CC-BY-4.0.

~~~~`,
  },
  {
    title: 'Monas Hieroglyphica',
    author: 'John Dee',
    talkPageUrl: 'https://en.wikipedia.org/wiki/Talk:Monas_Hieroglyphica',
    bookUrl: 'https://sourcelibrary.org/book/the-hieroglyphic-monad-dee',
    year: 1564,
    pages: 61,
    pct: 100,
    tier: 1,
    wikiText: `== External link suggestion: English translation at Source Library ==

{{edit COI}} I'm affiliated with Source Library.

* [https://sourcelibrary.org/book/the-hieroglyphic-monad-dee Monas Hieroglyphica (1564)] — page-by-page English translation of John Dee's 1564 text. 61 pages, 100% complete. Original Latin alongside translation. Free access, CC-BY-4.0.

~~~~`,
  },
  {
    title: 'De gli eroici furori',
    author: 'Giordano Bruno',
    talkPageUrl: 'https://en.wikipedia.org/wiki/Talk:De_gli_eroici_furori',
    bookUrl: 'https://sourcelibrary.org/book/of-heroic-frenzies-bruno',
    year: 1585,
    pages: 294,
    pct: 100,
    tier: 1,
    wikiText: `== External link suggestion: English translation at Source Library ==

{{edit COI}} I'm affiliated with Source Library.

* [https://sourcelibrary.org/book/of-heroic-frenzies-bruno De gli eroici furori (Of Heroic Frenzies, 1585)] — page-by-page English translation. 294 pages, 100% complete. Original Italian alongside translation. Free access, CC-BY-4.0.

~~~~`,
  },
  {
    title: 'Ars Magna Lucis et Umbrae',
    author: 'Kircher',
    talkPageUrl: 'https://en.wikipedia.org/wiki/Talk:Ars_Magna_Lucis_et_Umbrae',
    bookUrl: 'https://sourcelibrary.org/book/the-great-art-of-light-and-shadow-kircher',
    year: 1671,
    pages: 760,
    pct: 100,
    tier: 2,
    wikiText: `== External link suggestion: English translation at Source Library ==

{{edit COI}} I'm affiliated with Source Library.

* [https://sourcelibrary.org/book/the-great-art-of-light-and-shadow-kircher Ars Magna Lucis et Umbrae (1671)] — page-by-page English translation. 760 pages, 100% complete. Original Latin alongside translation. Free access, CC-BY-4.0.

~~~~`,
  },
  {
    title: 'Lives of the Eminent Philosophers',
    author: 'Diogenes Laertius',
    talkPageUrl: 'https://en.wikipedia.org/wiki/Talk:Lives_and_Opinions_of_Eminent_Philosophers',
    bookUrl: 'https://sourcelibrary.org/book/lives-and-opinions-of-eminent-philosophers-laertius',
    year: 1570,
    pages: 555,
    pct: 100,
    tier: 2,
    wikiText: `== External link suggestion: 1570 Latin edition translation at Source Library ==

{{edit COI}} I'm affiliated with Source Library.

* [https://sourcelibrary.org/book/lives-and-opinions-of-eminent-philosophers-laertius Lives and Opinions of Eminent Philosophers (1570 edition)] — page-by-page English translation of the 1570 Latin text. 555 pages, 100% complete. Original alongside translation. Free access, CC-BY-4.0.

~~~~`,
  },
  {
    title: 'Mysterium Cosmographicum',
    author: 'Kepler',
    talkPageUrl: 'https://en.wikipedia.org/wiki/Talk:Mysterium_Cosmographicum',
    bookUrl: 'https://sourcelibrary.org/book/mysterium-cosmographicum-1596-first-edition-kepler',
    year: 1596,
    pages: 194,
    pct: 100,
    tier: 2,
    wikiText: `== External link suggestion: English translation at Source Library ==

{{edit COI}} I'm affiliated with Source Library.

* [https://sourcelibrary.org/book/mysterium-cosmographicum-1596-first-edition-kepler Mysterium Cosmographicum (1596 First Edition)] — page-by-page English translation. 194 pages, 100% complete. Original Latin alongside translation. Free access, CC-BY-4.0.

~~~~`,
  },
  {
    title: 'Magia Naturalis',
    author: 'Della Porta',
    talkPageUrl: 'https://en.wikipedia.org/wiki/Talk:Magia_Naturalis',
    bookUrl: 'https://sourcelibrary.org/book/magia-naturalis-libri-xx-1607-porta',
    year: 1607,
    pages: 714,
    pct: 100,
    tier: 2,
    wikiText: `== External link suggestion: English translation at Source Library ==

{{edit COI}} I'm affiliated with Source Library.

* [https://sourcelibrary.org/book/magia-naturalis-libri-xx-1607-porta Magia Naturalis Libri XX (1607)] — page-by-page English translation. 714 pages, 100% complete. Original Latin alongside translation. Free access, CC-BY-4.0.

~~~~`,
  },
  {
    title: 'Orbis Sensualium Pictus',
    author: 'Comenius',
    talkPageUrl: 'https://en.wikipedia.org/wiki/Talk:Orbis_Pictus',
    bookUrl: 'https://sourcelibrary.org/book/orbis-sensualium-pictus-1659-first-english-comenius',
    year: 1659,
    pages: 351,
    pct: 99,
    tier: 2,
    wikiText: `== External link suggestion: English translation at Source Library ==

{{edit COI}} I'm affiliated with Source Library.

* [https://sourcelibrary.org/book/orbis-sensualium-pictus-1659-first-english-comenius Orbis Sensualium Pictus (1659 First English Edition)] — page-by-page scan with translation. 351 pages, 99% complete. Free access, CC-BY-4.0.

~~~~`,
  },
  {
    title: 'Arcana Coelestia',
    author: 'Swedenborg',
    talkPageUrl: 'https://en.wikipedia.org/wiki/Talk:Arcana_Coelestia',
    bookUrl: 'https://sourcelibrary.org/book/arcana-coelestia-heavenly-arcana-swedenborg',
    year: 1749,
    pages: 587,
    pct: 100,
    tier: 2,
    wikiText: `== External link suggestion: English translation at Source Library ==

{{edit COI}} I'm affiliated with Source Library.

* [https://sourcelibrary.org/book/arcana-coelestia-heavenly-arcana-swedenborg Arcana Coelestia (1749)] — page-by-page English translation. 587 pages, 100% complete. Original Latin alongside translation. Free access, CC-BY-4.0.

~~~~`,
  },
  {
    title: 'Emblemata',
    author: 'Alciato',
    talkPageUrl: 'https://en.wikipedia.org/wiki/Talk:Emblemata',
    bookUrl: 'https://sourcelibrary.org/book/alciato-emblemata-1548-lyon-alciato',
    year: 1548,
    pages: 182,
    pct: 100,
    tier: 2,
    wikiText: `== External link suggestion: English translation at Source Library ==

{{edit COI}} I'm affiliated with Source Library.

* [https://sourcelibrary.org/book/alciato-emblemata-1548-lyon-alciato Emblemata (1548 Lyon edition)] — page-by-page English translation with original woodcuts. 182 pages, 100% complete. Free access, CC-BY-4.0.

~~~~`,
  },
  {
    title: 'Corpus Hermeticum',
    author: 'Hermes Trismegistus',
    talkPageUrl: 'https://en.wikipedia.org/wiki/Talk:Corpus_Hermeticum',
    bookUrl: 'https://sourcelibrary.org/book/pymander-de-potestate-et-sapientia-dei-hermes-trismegistus',
    year: 1532,
    pages: 336,
    pct: 100,
    tier: 3,
    wikiText: `== External link suggestion: 1532 Latin edition at Source Library ==

{{edit COI}} I'm affiliated with Source Library.

* [https://sourcelibrary.org/book/pymander-de-potestate-et-sapientia-dei-hermes-trismegistus Pymander, de potestate et sapientia Dei (1532)] — page-by-page English translation of the 1532 Latin Corpus Hermeticum. 336 pages, 100% complete. Free access, CC-BY-4.0.

~~~~`,
  },
  {
    title: "Leonardo's Notebooks",
    author: 'Leonardo da Vinci',
    talkPageUrl: 'https://en.wikipedia.org/wiki/Talk:Leonardo_da_Vinci',
    bookUrl: 'https://sourcelibrary.org/book/the-notebooks-of-leonardo-da-vinci-richter',
    year: 1883,
    pages: 1272,
    pct: 100,
    tier: 3,
    wikiText: `== External link suggestion: Richter's Notebooks of Leonardo at Source Library ==

{{edit COI}} I'm affiliated with Source Library.

* [https://sourcelibrary.org/book/the-notebooks-of-leonardo-da-vinci-richter The Notebooks of Leonardo da Vinci (Richter, 1883)] — complete digitized edition of Jean Paul Richter's compilation. 1,272 pages, 100% complete. Free access, CC-BY-4.0.

~~~~`,
  },
  {
    title: 'Enneads (Ficino)',
    author: 'Plotinus',
    talkPageUrl: 'https://en.wikipedia.org/wiki/Talk:Enneads',
    bookUrl: 'https://sourcelibrary.org/book/enneads-1580-basel-editio-princeps-plotinus-ficino',
    year: 1580,
    pages: 860,
    pct: 100,
    tier: 3,
    wikiText: `== External link suggestion: 1580 Ficino translation at Source Library ==

{{edit COI}} I'm affiliated with Source Library.

* [https://sourcelibrary.org/book/enneads-1580-basel-editio-princeps-plotinus-ficino Plotini Enneades (1580 Basel)] — page-by-page English translation of Ficino's Latin Enneads. 860 pages, 100% complete. Original alongside translation. Free access, CC-BY-4.0.

~~~~`,
  },
  {
    title: 'Opera Omnia',
    author: 'Pico della Mirandola',
    talkPageUrl: 'https://en.wikipedia.org/wiki/Talk:Giovanni_Pico_della_Mirandola',
    bookUrl: 'https://sourcelibrary.org/book/complete-works-1557-basel-edition-pico-della-mirandola',
    year: 1557,
    pages: 797,
    pct: 100,
    tier: 3,
    wikiText: `== External link suggestion: 1557 Opera Omnia at Source Library ==

{{edit COI}} I'm affiliated with Source Library.

* [https://sourcelibrary.org/book/complete-works-1557-basel-edition-pico-della-mirandola Opera Omnia (1557 Basel edition)] — page-by-page English translation of Pico's complete works. 797 pages, 100% complete. Original Latin alongside translation. Free access, CC-BY-4.0.

~~~~`,
  },
  {
    title: 'Utriusque Cosmi Historia',
    author: 'Robert Fludd',
    talkPageUrl: 'https://en.wikipedia.org/wiki/Talk:Robert_Fludd',
    bookUrl: 'https://sourcelibrary.org/book/history-of-both-worlds-macrocosm-fludd',
    year: 1617,
    pages: 1036,
    pct: 100,
    tier: 3,
    wikiText: `== External link suggestion: Utriusque Cosmi Historia at Source Library ==

{{edit COI}} I'm affiliated with Source Library.

* [https://sourcelibrary.org/book/history-of-both-worlds-macrocosm-fludd Utriusque Cosmi Historia Vol. 1 (1617)] — page-by-page English translation with all illustrations. 1,036 pages, 100% complete. Original Latin alongside translation. Free access, CC-BY-4.0.
* [https://sourcelibrary.org/book/history-of-both-worlds-microcosm-fludd Utriusque Cosmi Historia Vol. 2 (1619)] — 700 pages, 100% complete.

~~~~`,
  },
];

// ── Components ──

function CopyButton({ text, label }: { text: string; label?: string }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Fallback
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
  post: (typeof TALK_PAGE_POSTS)[number];
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
            {post.pages} pages, {post.pct}% translated
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

export function WikipediaPlaybook() {
  const tier1 = TALK_PAGE_POSTS.filter((p) => p.tier === 1);
  const tier2 = TALK_PAGE_POSTS.filter((p) => p.tier === 2);
  const tier3 = TALK_PAGE_POSTS.filter((p) => p.tier === 3);

  return (
    <div className="space-y-10">
      {/* Intro */}
      <div className="prose-content max-w-none">
        <p className="text-xl text-secondary leading-relaxed">
          Source Library has over 1,100 fully translated historical texts &mdash;
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
