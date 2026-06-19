import Link from 'next/link';
import { Metadata } from 'next';
import SiteHeader from '@/components/layout/SiteHeader';
import { getReadDb } from '@/lib/mongodb';

export const revalidate = 600;
export const maxDuration = 60;

export const metadata: Metadata = {
  title: 'Our Vision & Plan — Source Library',
  description:
    'Source Library is building a world-class humanist institution to connect people and AI with the source knowledge of ages past. Our five-year plan to bring ancient wisdom into the future.',
  alternates: { canonical: '/vision' },
};

const PICO_QUOTE_URL =
  '/book/ioannis-pici-mirandulae-omnia-opera-mirandola/page/695906974953388fe7ac6d15';
const CONTACT_EMAIL = 'derek@sourcelibrary.org';

// Five-year organizational goals (illustrative allocation toward the ~$15M target)
const ORG_GOALS = [
  {
    title: 'A founding-donor circle',
    detail: 'Convene a network of 10–50 founding donors to anchor the institution.',
    amount: '$100K',
  },
  {
    title: 'Translate 250,000+ ancient works',
    detail: 'Extend the corpus across dozens of source languages, originals preserved alongside.',
    amount: '$1M',
  },
  {
    title: 'Scan 50,000+ inaccessible works',
    detail: 'Digitize books and manuscripts that have never been available online.',
    amount: '$3M',
  },
  {
    title: 'A scalable technical foundation',
    detail: 'Pipeline, search, API and MCP infrastructure built to last.',
    amount: '$1M',
  },
  {
    title: 'Partner with 1,000+ libraries',
    detail: 'A global network of contributing libraries and archives.',
    amount: '$2M',
  },
  {
    title: 'A braintrust of scholars',
    detail: 'Linguists and scholars who steward and verify the corpus.',
    amount: '$2M',
  },
];

// Recurring annual programs
const YEARLY_GOALS = [
  {
    title: '3 global gatherings each year',
    detail: 'Convenings in Amsterdam, the Americas, and the East to activate the community.',
    amount: '$150K / yr',
  },
  {
    title: '2 expeditions each year',
    detail: 'Field trips to gather and scan materials at their source.',
    amount: '$200K / yr',
  },
  {
    title: 'A full-time team',
    detail: 'Four full-time staff sustaining the work.',
    amount: '$800K / yr',
  },
  {
    title: 'Support for partner libraries',
    detail: 'Direct funding and support for libraries around the world.',
    amount: '$2M / yr',
  },
];

const DONE = [
  'Established a legal entity with 501(c)(3) tax-deductible status',
  'Translated 15,000+ books — over 6,000 for the first time in history',
  'Built an API and MCP connection so AI can research within the library',
  'Stood up a technical team, a marketing team, and an organizational structure',
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
    return { totalBooks: 15000, firstTranslations: 6000, pagesTranslated: 2400000 };
  }
}

export default async function VisionPage() {
  const stats = await fetchStats();

  return (
    <div className="min-h-screen">
      <SiteHeader variant="light" />

      {/* ───────────── HERO ───────────── */}
      <section className="bg-gradient-to-b from-[#f6f3ee] to-white pt-10 pb-16 md:pt-16 md:pb-24">
        <div className="px-6 md:px-12 max-w-5xl mx-auto">
          <p className="text-sm uppercase tracking-widest text-stone-500 mb-4">
            Our Vision &amp; Plan
          </p>
          <h1 className="text-3xl md:text-5xl lg:text-6xl text-stone-900 mb-6 leading-tight font-display">
            Bringing ancient wisdom into the future
          </h1>
          <p className="text-lg md:text-2xl text-stone-600 leading-relaxed max-w-3xl">
            Source Library is the world&rsquo;s largest online library of translated ancient
            sources. We are building a world-class humanist institution to connect people
            &mdash; and AI &mdash; with the source knowledge of ages past, and to help spark
            the next renaissance.
          </p>
        </div>
      </section>

      {/* ───────────── LIVE STATS ───────────── */}
      <section className="bg-white border-b border-stone-200">
        <div className="px-6 md:px-12 max-w-5xl mx-auto py-12 md:py-16">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-8 md:gap-12">
            <div className="text-center md:text-left">
              <div className="text-4xl md:text-5xl font-display text-stone-900 mb-2">
                {formatStat(stats.totalBooks)}
              </div>
              <div className="text-sm text-stone-500 uppercase tracking-wider">
                Books translated
              </div>
            </div>
            <div className="text-center md:text-left">
              <div className="text-4xl md:text-5xl font-display text-stone-900 mb-2">
                {formatStat(stats.firstTranslations)}
              </div>
              <div className="text-sm text-stone-500 uppercase tracking-wider">
                First-ever English translations
              </div>
            </div>
            <div className="text-center md:text-left">
              <div className="text-4xl md:text-5xl font-display text-stone-900 mb-2">50+</div>
              <div className="text-sm text-stone-500 uppercase tracking-wider">
                Source languages
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ───────────── THE WHY ───────────── */}
      <section className="bg-white py-16 md:py-24">
        <div className="px-6 md:px-12 max-w-3xl mx-auto">
          <h2 className="text-3xl md:text-4xl text-stone-900 mb-8 leading-tight font-display">
            Why this matters
          </h2>
          <div className="text-lg text-stone-600 leading-relaxed space-y-6">
            <p>
              The first Renaissance was triggered by the translation of classical wisdom texts
              &mdash; Plato, the Hermetic writings &mdash; from Greek into Latin. Throughout
              history, the recovery of ancient works has consistently inspired humanity&rsquo;s
              most profound and enduring insights.
            </p>
            <p>
              Yet the Renaissance itself was mostly written in Latin, and{' '}
              <strong className="text-stone-900">less than 3% of it has ever been translated
              into English</strong>. The rest is legible only to specialists. Beyond it lie
              thousands upon thousands of texts in Chinese, Sanskrit, Arabic, Hebrew, Egyptian,
              and more &mdash; and most are missing from the datasets that train AI.
            </p>
            <p>
              As we enter an uncertain age, a strong foundation in wisdom &mdash; and the
              preservation of our full heritage &mdash; has never been more pressing. Ancient
              and lost knowledge, made accessible, can create enormous social impact. Maybe,
              just maybe, translating the world&rsquo;s ancient wisdom could make a global AI
              renaissance more likely than an AI apocalypse.
            </p>
          </div>

          {/* Pico pull-quote */}
          <figure className="my-12 pl-8 border-l-2 border-accent-rust">
            <blockquote className="font-serif italic text-2xl md:text-[1.625rem] text-stone-900 leading-snug">
              &ldquo;Magic is the absolute consummation of natural philosophy.&rdquo;
            </blockquote>
            <figcaption className="mt-4 text-sm tracking-wide uppercase text-stone-500">
              <Link href={PICO_QUOTE_URL} className="hover:text-accent-rust underline">
                Giovanni Pico della Mirandola &mdash; from the source
              </Link>
            </figcaption>
          </figure>
        </div>
      </section>

      {/* ───────────── WHAT WE'VE DONE ───────────── */}
      <section className="bg-gradient-to-b from-[#f6f3ee] to-white py-16 md:py-24">
        <div className="px-6 md:px-12 max-w-5xl mx-auto">
          <h2 className="text-3xl md:text-4xl text-stone-900 mb-4 leading-tight font-display">
            What we&rsquo;ve done already
          </h2>
          <p className="text-lg text-stone-600 mb-10 max-w-3xl leading-relaxed">
            Supported by seed funds from two major donors, we have built the foundation of a
            lasting institution &mdash; our word count has already exceeded English Wikipedia.
          </p>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {DONE.map((item, i) => (
              <div
                key={item}
                className="bg-white rounded-xl border border-stone-200 p-6 flex gap-4 items-start"
              >
                <span className="text-sm font-semibold text-stone-400 tabular-nums mt-0.5">
                  0{i + 1}
                </span>
                <p className="text-stone-700 leading-relaxed">{item}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ───────────── THE PLAN / BUDGET ───────────── */}
      <section className="bg-white py-16 md:py-24">
        <div className="px-6 md:px-12 max-w-5xl mx-auto">
          <h2 className="text-3xl md:text-4xl lg:text-5xl text-stone-900 mb-6 leading-tight font-display">
            The plan: $15M over five years
          </h2>
          <p className="text-lg text-stone-600 mb-12 max-w-3xl leading-relaxed">
            We are raising $15 million in philanthropic funding over five years to grow Source
            Library into a global humanist institution &mdash; conserving our heritage and
            putting primary sources into the hands of people and AI alike. The allocations
            below are illustrative of the work ahead.
          </p>

          {/* Five-year goals */}
          <h3 className="text-2xl text-stone-900 mb-6 font-display">Five-year goals</h3>
          <dl className="mb-16 divide-y divide-stone-200 border-y border-stone-200">
            {ORG_GOALS.map((goal) => (
              <div
                key={goal.title}
                className="grid grid-cols-1 md:grid-cols-[1fr_auto] gap-2 md:gap-8 py-5 items-baseline"
              >
                <dt>
                  <div className="text-lg font-semibold text-stone-900">{goal.title}</div>
                  <div className="text-stone-600 text-sm mt-1 leading-relaxed">{goal.detail}</div>
                </dt>
                <dd className="text-accent-rust font-display text-2xl md:text-right whitespace-nowrap">
                  {goal.amount}
                </dd>
              </div>
            ))}
          </dl>

          {/* Annual programs */}
          <h3 className="text-2xl text-stone-900 mb-6 font-display">Annual programs</h3>
          <dl className="divide-y divide-stone-200 border-y border-stone-200">
            {YEARLY_GOALS.map((goal) => (
              <div
                key={goal.title}
                className="grid grid-cols-1 md:grid-cols-[1fr_auto] gap-2 md:gap-8 py-5 items-baseline"
              >
                <dt>
                  <div className="text-lg font-semibold text-stone-900">{goal.title}</div>
                  <div className="text-stone-600 text-sm mt-1 leading-relaxed">{goal.detail}</div>
                </dt>
                <dd className="text-accent-rust font-display text-2xl md:text-right whitespace-nowrap">
                  {goal.amount}
                </dd>
              </div>
            ))}
          </dl>
        </div>
      </section>

      {/* ───────────── INVITATION ───────────── */}
      <section className="bg-[#2a1f17] text-white py-16 md:py-24">
        <div className="px-6 md:px-12 max-w-3xl mx-auto text-center">
          <h2 className="text-3xl md:text-4xl mb-6 leading-tight font-display">
            Join the founding circle
          </h2>
          <p className="text-lg text-white/80 leading-relaxed mb-10">
            Source Library is entirely supported by personal donors. We are convening a circle
            of founding donors to create a global institution devoted to the stewardship of
            ancient wisdom &mdash; from books to oral histories to archaeological expeditions.
            The wisdom is more than the books.
          </p>
          <div className="flex flex-col sm:flex-row gap-4 justify-center">
            <Link
              href="/founding-donors"
              className="inline-block bg-accent-rust text-white py-3 px-8 rounded-full hover:bg-accent-rust/90 transition-colors text-base font-medium"
            >
              Become a founding donor
            </Link>
            <Link
              href="/support"
              className="inline-block bg-white/10 text-white py-3 px-8 rounded-full hover:bg-white/20 transition-colors text-base font-medium border border-white/20"
            >
              Make a gift
            </Link>
          </div>
          <p className="mt-8 text-sm text-white/60">
            For major gifts and corporate sponsorship, write to{' '}
            <a href={`mailto:${CONTACT_EMAIL}`} className="text-white underline hover:text-white/80">
              {CONTACT_EMAIL}
            </a>
            . Derek reads every message.
          </p>
        </div>
      </section>

      {/* ───────────── INSTITUTIONAL HOME ───────────── */}
      <section className="bg-gradient-to-b from-[#f6f3ee] to-[#f3ede6] py-16 md:py-24">
        <div className="px-6 md:px-12 max-w-3xl mx-auto">
          <div className="flex items-center gap-8 mb-10">
            <img
              src="https://images.sourcelibrary.org/assets/partners-unesco.avif"
              alt="UNESCO Memory of the World"
              className="h-20 md:h-24 w-auto object-contain"
            />
          </div>
          <p className="text-stone-600 text-lg leading-relaxed mb-6">
            Source Library is embedded within one of the world&rsquo;s greatest collections of
            ancient texts: the{' '}
            <a
              href="https://embassyofthefreemind.com"
              target="_blank"
              rel="noopener noreferrer"
              className="text-accent-rust hover:text-accent-gold-dark underline"
            >
              Embassy of the Free Mind
            </a>{' '}
            in Amsterdam, home to the Bibliotheca Philosophica Hermetica &mdash; a UNESCO
            &ldquo;Memory of the World&rdquo; rare-book library. The Embassy preserves and
            shares the physical collection; Source Library extends that mission digitally,
            making these texts freely accessible worldwide.
          </p>
          <p className="text-stone-500 text-sm leading-relaxed">
            Source Library is an open-source initiative of the Embassy of the Free Mind, a Dutch
            nonprofit with 501(c)(3) status, created with the support of the Wisdom Frontiers
            Society of La Jolla, California. Learn more on our{' '}
            <Link href="/about" className="text-accent-rust hover:underline">
              about page
            </Link>{' '}
            or{' '}
            <Link href="/support" className="text-accent-rust hover:underline">
              support page
            </Link>
            .
          </p>
        </div>
      </section>
    </div>
  );
}
