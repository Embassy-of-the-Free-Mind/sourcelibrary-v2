import type { Metadata } from 'next';
import Link from 'next/link';
import ContentPageLayout, { ContentHeader } from '@/components/layout/ContentPageLayout';

// Lab-facing overview of the corpus (Derek, 2026-10-23). Copy drafted with Derek in a review
// artifact. Figures measured 2026-10-23, refreshed 2026-10-28, and stated as dated on the page: a snapshot, not live stats.

export const metadata: Metadata = {
  title: 'AI Partners | Source Library',
  description:
    'A digital archive of 129,000 historical books in more than fifty languages, over 20,000 of them translated into English, each translation set beside its original page.',
  alternates: { canonical: '/ai-partners' },
  robots: { index: false, follow: true },
};

const POINTS = [
  { label: 'Collected', fact: '129,000 books from more than 30 libraries' },
  { label: 'Transcribed', fact: '9.6 million pages in the original language' },
  { label: 'Translated', fact: '5.7 million pages in English' },
  { label: 'Checked', fact: 'Language by language, with scholars' },
  { label: 'Rights cleared', fact: 'Checked book by book' },
  { label: 'Immediately available', fact: 'Through our API and MCP server' },
];

const HOLDINGS = [
  { label: 'Books digitally archived', value: '129,166' },
  { label: 'Public on the site', value: '70,874' },
  { label: 'Readable in English', value: '21,502' },
  { label: 'Translated into English for the first time', value: '4,557' },
  { label: 'Page images', value: '28.9 million' },
  { label: 'Images held: page scans, artworks and illustrations', value: '32 TB' },
  { label: 'Books from the Ritman Library, found only here', value: '2,347' },
];

// Translated pages by the date of the book, in millions.
const CENTURIES = [
  { label: 'Before 1400', pages: 0.17 },
  { label: '1400s', pages: 0.4 },
  { label: '1500s', pages: 1.0 },
  { label: '1600s', pages: 0.9 },
  { label: '1700s', pages: 0.9 },
  { label: '1800s', pages: 0.9 },
  { label: '1900–1930', pages: 0.5 },
];

const EXAMPLES = [
  { href: '/book/history-of-both-worlds-macrocosm-fludd', title: 'History of the Two Worlds', by: 'Robert Fludd', note: 'Latin, 1617' },
  { href: '/book/mundus-subterraneus-kircher', title: 'Mundus Subterraneus', by: 'Athanasius Kircher', note: 'Latin, 1678' },
  { href: '/book/imperial-collection-of-mathematical-essentials-vol-2', title: 'Collected Essentials of Mathematics', by: 'compiled for the Kangxi emperor', note: 'Chinese, 1723' },
  { href: '/book/siddhanta-tattva-viveka-bhatta', title: 'Discernment of the Principles of Astronomy', by: 'Kamalākara', note: 'Sanskrit, 1658' },
  { href: '/book/collected-works-of-the-8th-gyalwang-drukpa-kunzik-chokyi-1768-1822', title: 'Collected Works', by: 'the eighth Gyalwang Drukpa', note: 'Tibetan, c. 1800' },
];

// Named with their agreement (Derek, 2026-10-28).
const SCHOLARS = [
  { reads: 'Yucatec Maya', name: 'David Stuart' },
  { reads: 'Latin and Sanskrit', name: 'Peter J. Forshaw' },
  { reads: 'Latin, and early printed books', name: 'Paul Dijstelberge' },
];

// Measured 2026-10-28 from the site's logs; the edge figure is the 26–27 October average from Cloudflare.
const TRAFFIC = [
  { label: 'Page views by readers, last 7 days', value: '103K' },
  { label: 'Pages fetched by ChatGPT and Claude for their users, last 30 days', value: '1.8M' },
  { label: 'Automated requests stopped at our network edge, per day', value: '~800K' },
  { label: 'Bulk requests rate-limited by the site, last 30 days', value: '1.9M' },
];

const PROGRESS = [
  { label: 'translated into English', millions: 5.7, className: 'bg-[#9e4a3a]' },
  { label: 'transcribed, awaiting translation', millions: 3.7, className: 'bg-[#c9a86c]' },
  { label: 'scanned, waiting to be read', millions: 19.6, className: 'bg-[#e4dccd]' },
];

const OFFERS = [
  { title: 'An open release', body: 'A partner’s support funds the reading of the remaining pages and their release to the public, as AI laboratories have done for other major libraries.' },
  { title: 'Early access', body: 'The partner receives each release in advance, with held-back test sets and scholarly review in the languages it needs.' },
  { title: 'Acknowledgement', body: 'The partner is credited on each release, alongside the Embassy of the Free Mind and the contributing libraries.' },
];

const label = 'text-xs uppercase tracking-[0.15em] text-[#999] mb-6';
const prose = 'text-[#444] leading-[1.75] mb-6 max-w-2xl';

export default function AiPartnersPage() {
  const maxCentury = Math.max(...CENTURIES.map((c) => c.pages));
  const totalPages = PROGRESS.reduce((sum, p) => sum + p.millions, 0);

  return (
    <ContentPageLayout
      header={
        <ContentHeader
          title="AI Partners"
          subtitle="A digital archive of 129,000 historical books in more than fifty languages, over 20,000 of them translated into English, each translation set beside the page it came from."
        />
      }
      maxWidth="standard"
      bg="bg-[#faf9f7]"
    >
      <section className="mb-20">
        <p className="font-serif text-2xl md:text-[28px] text-[#1a1a18] leading-[1.5] max-w-2xl">
          Source Library is the largest library of translated historical sources. Every line of
          English can be checked against the scan of the original page.
        </p>
      </section>

      <section className="mb-20">
        <dl className="grid grid-cols-2 md:grid-cols-3 gap-x-12 gap-y-6">
          {POINTS.map((p) => (
            <div key={p.label} className="border-t border-[#e8e6e3] pt-3">
              <dt className="font-serif text-xl text-[#1a1a18]">{p.label}</dt>
              <dd className="text-[#666] text-[15px] mt-1">{p.fact}</dd>
            </div>
          ))}
        </dl>
      </section>

      <section className="mb-20 grid md:grid-cols-[3fr_2fr] gap-10 items-start">
        <div>
          <p className={label}>The untranslated record</p>
          <p className={prose}>
            The translation of ancient texts in fifteenth-century Florence helped give rise to the
            Renaissance. Yet 90% of Renaissance Latin itself has never been translated, and the gaps
            in Chinese, Sanskrit, Tibetan, Arabic and Hebrew are wider still.
          </p>
        </div>
        <figure>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/ai-partners/hero.jpg" alt="An early printed Latin page naming Marsilio Ficino and Pico della Mirandola" className="w-full border border-[#e8e6e3]" />
          <figcaption className="text-[#999] text-xs mt-2">An early printed page naming Marsilio Ficino and Giovanni Pico della Mirandola.</figcaption>
        </figure>
      </section>

      <section className="mb-20" id="collected">
        <p className={label}>Collected</p>
        <p className={prose}>
          Assembled from more than thirty of the world’s great libraries, and catalogued by work,
          edition and author.
        </p>
        <div className="max-w-xl">
          {HOLDINGS.map((h) => (
            <div key={h.label} className="flex justify-between items-baseline border-b border-[#e8e6e3] py-2">
              <span className="text-[#1a1a18] text-[15px]">{h.label}</span>
              <span className="text-[#1a1a18] text-[15px] tabular-nums">{h.value}</span>
            </div>
          ))}
        </div>
        <p className="text-[#999] text-sm mt-4">Counted 28 October 2026.</p>
      </section>

      <section className="mb-20" id="transcribed">
        <p className={label}>Transcribed</p>
        <p className={prose}>
          9.6 million pages transcribed in their original language and script, mostly Latin and
          classical Chinese, with German, French, Italian, Greek, Hebrew, Arabic, Syriac, Sanskrit,
          Tibetan and Yucatec Maya. Each page is indexed by the people, places and ideas it names,
          so an idea can be followed from book to book.
        </p>
      </section>

      <section className="mb-20" id="translated">
        <p className={label}>Translated</p>
        <p className={prose}>
          5.7 million pages in English, each aligned with its original. 4,557 books appear in English
          for the first time.
        </p>
        <div className="max-w-xl">
          <p className="text-[#666] text-sm mb-3">Translated pages, by date of the book</p>
          {CENTURIES.map((c) => (
            <div key={c.label} className="grid grid-cols-[96px_1fr_48px] items-center gap-3 mb-2 text-sm">
              <span className="text-[#444]">{c.label}</span>
              <span className="block h-3 bg-[#9e4a3a] rounded-sm" style={{ width: `${(c.pages / maxCentury) * 100}%` }} />
              <span className="text-[#999] text-right tabular-nums">{c.pages}M</span>
            </div>
          ))}
        </div>
      </section>

      <section className="mb-20 grid md:grid-cols-[3fr_2fr] gap-10 items-start" id="checked">
        <div>
          <p className={label}>Checked</p>
          <p className={prose}>
            Each language has its own scripts, abbreviations and habits, and models read some far
            better than others. So each one is worked out separately, and scholars who read it check
            the hard cases.
          </p>
          <div className="max-w-xl mb-6">
            {SCHOLARS.map((s) => (
              <div key={s.name} className="flex justify-between items-baseline gap-6 border-b border-[#e8e6e3] py-2 text-[15px]">
                <span className="text-[#666]">{s.reads}</span>
                <span className="text-[#1a1a18]">{s.name}</span>
              </div>
            ))}
          </div>
          <p className={prose}>
            What they find goes back into how that language is read: which model, which
            instructions, and when a page needs a second reading. We have logged 427 experiments on
            reading and translation quality. Translations are tested against published human
            translations in fourteen languages, errors are sorted into 44 kinds, and the error rates
            are published. 1,535 people have offered to help, and readers report what they find.
          </p>
        </div>
        <figure>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/ai-partners/bibliotheca.jpg" alt="Guests in the Bibliotheca Philosophica Hermetica" className="w-full aspect-[4/3] object-cover" />
          <figcaption className="text-[#999] text-xs mt-2">The Embassy of the Free Mind, Amsterdam, home of the Ritman Library.</figcaption>
        </figure>
      </section>

      <section className="mb-20" id="rights">
        <p className={label}>Rights cleared</p>
        <p className={prose}>
          The original texts are in the public domain. Each book’s date and imprint are examined,
          and any work of uncertain status is withheld. Translations, notes and indexes are original
          to Source Library and published under a Creative Commons share-alike licence; other uses
          may be licensed directly.
        </p>
      </section>

      <section className="mb-20" id="available">
        <p className={label}>Immediately available</p>
        <p className={prose}>
          The public corpus is available now through our streaming API and MCP server, with a stable
          citation link for every passage: about 18 billion tokens, 11.5 billion of them
          transcription and translation aligned to the page. A sample of ten books is available on
          request. A few of the books:
        </p>
        <ul className="max-w-xl">
          {EXAMPLES.map((e) => (
            <li key={e.href} className="flex justify-between items-baseline gap-6 border-b border-[#e8e6e3] py-2 text-[15px]">
              <span>
                <Link href={e.href} className="text-[#1a1a18] underline decoration-[#ccc] underline-offset-4 hover:decoration-[#9e4a3a]">
                  {e.title}
                </Link>
                <span className="text-[#666]">, {e.by}</span>
              </span>
              <span className="text-[#999] text-sm whitespace-nowrap">{e.note}</span>
            </li>
          ))}
        </ul>
        <p className="text-[#999] text-sm mt-4">
          More on the data format and access: <Link href="/dataset" className="underline">the dataset</Link>.
        </p>
        <div className="max-w-xl mt-10">
          {TRAFFIC.map((t) => (
            <div key={t.label} className="flex justify-between items-baseline gap-6 border-b border-[#e8e6e3] py-2">
              <span className="text-[#1a1a18] text-[15px]">{t.label}</span>
              <span className="text-[#1a1a18] text-[15px] tabular-nums">{t.value}</span>
            </div>
          ))}
        </div>
        <p className="text-[#999] text-sm mt-4 max-w-xl">
          Search engines and assistants acting for a user read freely. Training crawlers get the
          licence terms and a preview of each book. Counted 28 October 2026 from the site’s logs;
          the edge figure is the average of 26–27 October, from Cloudflare.
        </p>
      </section>

      <section className="mb-20">
        <p className={label}>The remaining work</p>
        <p className="font-serif text-2xl md:text-[28px] text-[#1a1a18] leading-[1.4] max-w-2xl mb-6">
          19.6 million pages remain to be read. They are scanned, catalogued and ready.
        </p>
        <div
          className="flex h-4 rounded-sm overflow-hidden max-w-3xl"
          role="img"
          aria-label="Of 28.9 million scanned pages: 5.7 million translated, 3.7 million transcribed, 19.6 million waiting"
        >
          {PROGRESS.map((p) => (
            <span key={p.label} className={p.className} style={{ flex: p.millions / totalPages }} />
          ))}
        </div>
        <div className="flex flex-wrap gap-x-8 gap-y-2 mt-3 text-sm text-[#666]">
          {PROGRESS.map((p) => (
            <span key={p.label} className="inline-flex items-center gap-2">
              <span className={`inline-block w-3 h-3 rounded-sm ${p.className}`} />
              <b className="text-[#1a1a18] font-medium tabular-nums">{p.millions}M</b> {p.label}
            </span>
          ))}
        </div>
        <div className="grid md:grid-cols-3 gap-8 mt-12">
          {OFFERS.map((o) => (
            <div key={o.title} className="border-t border-[#e8e6e3] pt-3">
              <p className="font-serif text-xl text-[#1a1a18] mb-2">{o.title}</p>
              <p className="text-[#444] text-[15px] leading-[1.7]">{o.body}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="mb-8 border-t border-[#e8e6e3] pt-10 max-w-2xl">
        <p className={prose}>
          Source Library is a non-profit project of Wisdom Frontiers and the Embassy of the Free Mind
          in Amsterdam. We welcome conversations with partners who wish to see the remaining pages
          read and released.
        </p>
        <p className="font-serif text-xl text-[#1a1a18]">Derek Lomas</p>
        <p className="text-[#666] text-sm">Founder, Source Library · derek@sourcelibrary.org</p>
      </section>
    </ContentPageLayout>
  );
}
