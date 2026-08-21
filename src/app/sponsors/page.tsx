import Link from 'next/link';
import OutboundLink from '@/components/analytics/OutboundLink';
import { Metadata } from 'next';
import SiteHeader from '@/components/layout/SiteHeader';
import { getReadDb } from '@/lib/mongodb';

export const revalidate = 3600;
export const maxDuration = 60;

export const metadata: Metadata = {
  title: 'Corporate Sponsorship — Source Library',
  description:
    'Sponsor the translation of the Renaissance. Half a million Latin works survive from 1450–1700; fewer than 3% have been read in English. Source Library is fixing that, openly.',
  alternates: { canonical: '/sponsors' },
};

const PARTNERSHIP_EMAIL = 'team@sourcelibrary.org';
const PARTNERSHIP_SUBJECT = 'Corporate%20partnership%20inquiry%20%E2%80%94%20Source%20Library';

const MEMBERSHIP_INCLUDES = [
  'Explicit licence covering current translations for commercial model training, with attribution',
  'Quarterly briefings on the translation roadmap; nominate priority authors, traditions, or manuscripts',
  'Named recognition as a Member on the library and in published volumes',
  'Annual convening at the Bibliotheca Philosophica Hermetica in Amsterdam with project leadership and scholarly advisors',
];

const SPONSORSHIP_EXAMPLES = [
  {
    label: 'Scholar-in-Residence',
    range: '$25K – $75K',
    description:
      'Fund a year of work by a named expert on a specific collection — vetting translations, writing critical apparatus, contributing a foreword and launch lecture. Both the scholar’s name and yours appear on the collection. Concrete deliverable, real scholarship — not just a name on a page.',
  },
  {
    label: 'Annual gathering at the BPH',
    range: '$10K – $25K',
    description:
      'Sponsor a scholar convening, lecture series, or launch event in Amsterdam. Branding on materials, speaking opportunity, recorded session published openly.',
  },
  {
    label: 'Digitisation expedition',
    range: '$50K+',
    description:
      'Fund the digitisation of a specific archive or partner library. Permanent attribution on every page produced from that source.',
  },
  {
    label: 'Podcast season or research publication',
    range: '$10K – $25K',
    description:
      'Sponsor a season of the Source Library podcast, a public-facing research essay, or a dataset publication. Attribution on the produced work.',
  },
];

function formatStat(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`.replace('.0K', 'K');
  return n.toLocaleString('en-US');
}

async function fetchStats() {
  try {
    const db = await getReadDb();
    const books = db.collection('books');
    const match = { visible: true, pages_count: { $gt: 0 } };
    const [totalBooks, firstTranslations, agg] = await Promise.all([
      books.countDocuments(match, { maxTimeMS: 15000 }),
      books.countDocuments(
        { ...match, is_first_translation: true, pages_translated: { $gt: 0 } },
        { maxTimeMS: 15000 }
      ),
      books
        .aggregate(
          [
            { $match: match },
            { $group: { _id: null, translated: { $sum: { $ifNull: ['$pages_translated', 0] } } } },
          ],
          { maxTimeMS: 15000 }
        )
        .toArray(),
    ]);
    return {
      totalBooks,
      firstTranslations,
      pagesTranslated: agg[0]?.translated || 0,
    };
  } catch {
    return { totalBooks: 14000, firstTranslations: 5600, pagesTranslated: 2400000 };
  }
}

export default async function SponsorsPage() {
  const stats = await fetchStats();
  const mailto = `mailto:${PARTNERSHIP_EMAIL}?subject=${PARTNERSHIP_SUBJECT}`;

  return (
    <div className="min-h-screen">
      <SiteHeader variant="light" />

      {/* Hero */}
      <section className="bg-gradient-to-b from-[#f6f3ee] to-white pt-10 pb-16 md:pt-16 md:pb-24">
        <div className="px-6 md:px-12 max-w-5xl mx-auto">
          <div className="text-xs uppercase tracking-[0.2em] text-stone-500 mb-4">
            Corporate Sponsorship
          </div>
          <h1 className="text-3xl md:text-5xl lg:text-6xl text-stone-900 mb-6 leading-tight font-display">
            Translate the Renaissance.
          </h1>
          <p className="text-lg md:text-xl text-stone-600 leading-relaxed max-w-3xl">
            Half a million Latin works survive from 1450–1700. Fewer than three percent have ever
            been read in English. Source Library is fixing that — and publishing the results free
            for anyone who wants to read them.
          </p>
          <div className="mt-10 flex flex-wrap gap-3">
            <OutboundLink
              href={mailto}
              surface="sponsors_hero"
              channel="email"
              intent="inquiry"
              className="inline-flex items-center px-6 py-3 rounded-md bg-[#9e4a3a] text-white text-sm font-semibold hover:bg-[#7e3a2e] transition-colors"
            >
              Talk to us
            </OutboundLink>
            <Link
              href="/collections"
              className="inline-flex items-center px-6 py-3 rounded-md border border-stone-300 text-stone-700 text-sm font-semibold hover:border-stone-500 transition-colors"
            >
              See what we&apos;ve translated
            </Link>
          </div>
        </div>
      </section>

      {/* Why now / scale */}
      <section className="bg-white border-y border-stone-200">
        <div className="px-6 md:px-12 max-w-5xl mx-auto py-12 md:py-16">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-8 md:gap-12 mb-12">
            <div>
              <div className="text-4xl md:text-5xl font-display text-stone-900 mb-2">533K</div>
              <div className="text-sm text-stone-500 uppercase tracking-wider">
                Latin editions printed 1450–1700
              </div>
            </div>
            <div>
              <div className="text-4xl md:text-5xl font-display text-stone-900 mb-2">
                &lt; 3%
              </div>
              <div className="text-sm text-stone-500 uppercase tracking-wider">
                Translated into English
              </div>
            </div>
            <div>
              <div className="text-4xl md:text-5xl font-display text-stone-900 mb-2">
                {formatStat(stats.firstTranslations)}+
              </div>
              <div className="text-sm text-stone-500 uppercase tracking-wider">
                First-ever English translations published by Source Library
              </div>
            </div>
          </div>
          <p className="text-lg text-stone-600 leading-relaxed max-w-3xl">
            Ficino, Bruno, Della Porta, Cardano, Kircher, Della Mirandola — most of the figures who
            actually shaped Renaissance thought have never been read in English. They wrote in
            Latin, and modern publishing never caught up. The same is true for Sanskrit, Classical
            Arabic, Hebrew, and Tibetan. We&apos;re working through them, book by book, with
            AI-assisted translation and scholarly review, all published openly under CC BY-SA.
          </p>
        </div>
      </section>

      {/* Annual Stewardship Membership */}
      <section className="bg-[#faf8f5] py-16 md:py-24">
        <div className="px-6 md:px-12 max-w-5xl mx-auto">
          <div className="text-xs uppercase tracking-[0.2em] text-stone-500 mb-3">
            For AI labs and model providers
          </div>
          <h2 className="text-3xl md:text-4xl text-stone-900 mb-6 leading-tight font-display">
            Annual Stewardship Membership.
          </h2>
          <p className="text-lg text-stone-600 leading-relaxed mb-4 max-w-3xl">
            One ongoing relationship covering training-data licence, translation priorities, and a
            permanent named seat on the project. Suited to model providers, infrastructure
            companies, and labs that depend on high-quality scholarly text data.
          </p>
          <p className="text-lg text-stone-700 leading-relaxed mb-10 max-w-3xl font-semibold">
            Sourcing scholarly training data the right way is now a board-level concern, not a
            research preference. Stewardship Members get on that side of the line.
          </p>

          <div className="bg-white rounded-xl border border-stone-200 overflow-hidden">
            <div className="grid grid-cols-1 lg:grid-cols-3">
              <div className="lg:col-span-2 p-6 md:p-10 border-b lg:border-b-0 lg:border-r border-stone-200">
                <div className="text-xs uppercase tracking-wider text-stone-500 mb-2">
                  What you get
                </div>
                <ul className="space-y-3 text-stone-700 leading-relaxed">
                  {MEMBERSHIP_INCLUDES.map((line) => (
                    <li key={line} className="flex gap-3">
                      <span className="text-[#9e4a3a] mt-1.5 shrink-0">▸</span>
                      <span>{line}</span>
                    </li>
                  ))}
                </ul>
                <div className="mt-6 pt-5 border-t border-stone-100 text-xs text-stone-500 leading-relaxed">
                  <span className="font-semibold text-stone-600">Scope:</span> first-ever English
                  translations with the original-language source aligned at the page level — see
                  the live count in the stats above. Languages with working translation pipelines:
                  Latin, Greek, Hebrew, German, French, Italian, Dutch. Sanskrit, Classical
                  Arabic, and Tibetan in progress.
                </div>
              </div>
              <div className="p-6 md:p-10 bg-[#faf8f5]">
                <div className="text-xs uppercase tracking-wider text-stone-500 mb-2">
                  Commitment
                </div>
                <div className="font-display text-2xl text-stone-900 mb-1">From $250K / yr</div>
                <div className="text-xs text-stone-500 mb-3">Multi-year preferred</div>
                <p className="text-sm text-stone-600 leading-relaxed mb-6">
                  Scope set in conversation. Wire, stock, DAF, or annual invoice — whatever your
                  procurement team prefers.
                </p>
                <OutboundLink
                  href={mailto}
                  surface="sponsors_stewardship"
                  channel="email"
                  intent="inquiry"
                  className="inline-flex items-center px-5 py-3 rounded-md bg-[#9e4a3a] text-white text-sm font-semibold hover:bg-[#7e3a2e] transition-colors"
                >
                  Open a conversation
                </OutboundLink>
              </div>
            </div>
          </div>

          {/* Founding Steward */}
          <div className="mt-6 bg-stone-900 text-white rounded-xl overflow-hidden">
            <div className="grid grid-cols-1 lg:grid-cols-3">
              <div className="lg:col-span-2 p-6 md:p-10 border-b lg:border-b-0 lg:border-r border-stone-800">
                <div className="flex items-center gap-3 mb-3">
                  <span className="text-xs uppercase tracking-[0.2em] text-[#c9a86c]">
                    Founding Steward
                  </span>
                  <span className="text-[10px] uppercase tracking-wider text-stone-400 border border-stone-700 px-2 py-0.5 rounded-full">
                    2 seats only
                  </span>
                </div>
                <h3 className="font-display text-2xl md:text-3xl mb-4 leading-snug">
                  The first two labs to commit at $1M / yr take a permanent named seat in the
                  project&apos;s origin.
                </h3>
                <p className="text-sm text-stone-300 leading-relaxed">
                  Founding Stewards are named in every published volume, on the library, and in
                  the project&apos;s history — not just for the term of their membership, but
                  permanently. Once two are named, the door closes; no third Founding Steward,
                  ever. After that, the regular Stewardship Membership is the way in.
                </p>
              </div>
              <div className="p-6 md:p-10 bg-stone-950 flex flex-col justify-center">
                <div className="text-xs uppercase tracking-wider text-stone-400 mb-2">
                  Commitment
                </div>
                <div className="font-display text-2xl text-[#c9a86c] mb-1">$1M / yr</div>
                <div className="text-xs text-stone-400 mb-6">Multi-year, by arrangement</div>
                <OutboundLink
                  href={mailto}
                  surface="sponsors_founding_steward"
                  channel="email"
                  intent="inquiry"
                  className="inline-flex items-center px-5 py-3 rounded-md bg-[#c9a86c] text-stone-900 text-sm font-semibold hover:bg-[#b8975b] transition-colors"
                >
                  Be the first
                </OutboundLink>
              </div>
            </div>
          </div>

          <p className="text-sm text-stone-500 leading-relaxed mt-6 max-w-3xl">
            Translations are published under CC BY-SA. Membership doesn&apos;t buy exclusivity —
            it buys an explicit grant for commercial use, a working channel into translation
            priorities, and permanent recognition for the company that helped pay to bring the
            corpus into the open.
          </p>
        </div>
      </section>

      {/* Event & Collection Sponsorship */}
      <section className="bg-white py-16 md:py-24">
        <div className="px-6 md:px-12 max-w-5xl mx-auto">
          <div className="text-xs uppercase tracking-[0.2em] text-stone-500 mb-3">
            For one-off support
          </div>
          <h2 className="text-3xl md:text-4xl text-stone-900 mb-6 leading-tight font-display">
            Sponsor an event or a collection.
          </h2>
          <p className="text-lg text-stone-600 leading-relaxed mb-10 max-w-3xl">
            For companies that want concrete attribution on a specific deliverable, not a recurring
            commitment. Pick something we&apos;re already doing or propose your own.
          </p>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {SPONSORSHIP_EXAMPLES.map((ex) => (
              <div
                key={ex.label}
                className="bg-[#faf8f5] rounded-lg border border-stone-200 p-6"
              >
                <div className="flex items-baseline justify-between gap-4 mb-2">
                  <div className="font-semibold text-stone-900">{ex.label}</div>
                  <div className="text-xs font-semibold text-[#9e4a3a] whitespace-nowrap">
                    {ex.range}
                  </div>
                </div>
                <p className="text-sm text-stone-600 leading-relaxed">{ex.description}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Institutional structure */}
      <section className="bg-[#faf8f5] py-16 md:py-24">
        <div className="px-6 md:px-12 max-w-5xl mx-auto">
          <h2 className="text-3xl md:text-4xl text-stone-900 mb-6 leading-tight font-display">
            Institutional structure
          </h2>
          <p className="text-base md:text-lg text-stone-600 leading-relaxed mb-8 max-w-3xl">
            Source Library runs out of the{' '}
            <a
              href="https://embassyofthefreemind.com"
              target="_blank"
              rel="noopener noreferrer"
              className="text-[#9e4a3a] hover:underline"
            >
              Embassy of the Free Mind
            </a>{' '}
            in Amsterdam — home of the Bibliotheca Philosophica Hermetica (UNESCO Memory of the
            World). Sponsorships are received through the right fiscal entity for your jurisdiction:
          </p>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div className="bg-white rounded-lg border border-stone-200 p-6">
              <div className="text-xs uppercase tracking-wider text-stone-500 mb-2">
                United States
              </div>
              <div className="font-semibold text-stone-900 mb-1">Business expense, or 501(c)(3)</div>
              <p className="text-sm text-stone-600 leading-relaxed">
                From 2026 a C corporation deducts charitable gifts only above 1% of taxable income,
                capped at 10%; a sponsorship with real consideration behind it is a business expense
                with neither floor nor cap, so for most companies that is now the better structure.
                Where a charitable gift is the right call, the Netherland-America Foundation handles
                the US side — wire, stock, DAF, and corporate matching all work.
              </p>
            </div>
            <div className="bg-white rounded-lg border border-stone-200 p-6">
              <div className="text-xs uppercase tracking-wider text-stone-500 mb-2">
                Netherlands &amp; EU
              </div>
              <div className="font-semibold text-stone-900 mb-1">Cultural ANBI</div>
              <p className="text-sm text-stone-600 leading-relaxed">
                Stichting Het Wereldhart holds Cultural ANBI status. A Dutch company deducts gifts
                against profit up to 50% of profit (€100,000/year), and the first €5,000 counts at
                150%. See{' '}
                <Link
                  href="/support/business"
                  className="text-[#9e4a3a] underline hover:text-[#7e3a2e]"
                >
                  giving through your company
                </Link>
                .
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* CTA */}
      <section className="bg-stone-900 text-white py-16 md:py-24">
        <div className="px-6 md:px-12 max-w-3xl mx-auto text-center">
          <h2 className="text-3xl md:text-4xl text-white mb-6 leading-tight font-display">
            Get in touch.
          </h2>
          <p className="text-base md:text-lg text-stone-300 leading-relaxed mb-10">
            Tell us what you&apos;d like to do — annual membership, funding a Scholar-in-Residence on
            a collection you care about, an expedition, or something we haven&apos;t built yet.
            We&apos;ll come back inside a week with a concrete proposal.
          </p>
          <OutboundLink
            href={mailto}
            surface="sponsors_footer_cta"
            channel="email"
            intent="inquiry"
            className="inline-flex items-center px-8 py-4 rounded-md bg-[#c9a86c] text-stone-900 text-sm font-semibold hover:bg-[#b8975b] transition-colors"
          >
            {PARTNERSHIP_EMAIL}
          </OutboundLink>
          <p className="text-xs text-stone-500 mt-8">
            For individual donations and small gifts, see{' '}
            <Link href="/support" className="underline hover:text-stone-300">
              /support
            </Link>
            . For our vision and founding-donor plan, see{' '}
            <Link href="/vision" className="underline hover:text-stone-300">
              /vision
            </Link>
            .
          </p>
        </div>
      </section>
    </div>
  );
}
