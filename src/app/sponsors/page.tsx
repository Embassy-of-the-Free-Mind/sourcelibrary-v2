import Link from 'next/link';
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

const PARTNERSHIP_EMAIL = 'derek@sourcelibrary.org';
const PARTNERSHIP_SUBJECT = 'Corporate%20partnership%20inquiry%20%E2%80%94%20Source%20Library';

const TIERS = [
  {
    name: 'Patron of the Renaissance',
    amount: '$100,000+',
    accent: 'border-t-4 border-t-amber-700',
    recognition: [
      'Named translation series ("The [Company] Renaissance Library")',
      'Logo on all campaign materials and on sourcelibrary.org',
      'Recognition in press releases',
      'Permanent acknowledgment in published translations',
    ],
    engagement: [
      'Private tour of the Bibliotheca Philosophica Hermetica for up to 20 guests',
      'Exclusive preview of translations before public release',
      'Keynote speaking opportunity at the annual event',
      'Quarterly briefings with project leadership',
    ],
    reciprocity: [
      'Early API access to parallel corpora and structured metadata',
      'Collaboration on dataset and research initiatives',
      'Input on translation priorities',
    ],
  },
  {
    name: 'Keeper of Knowledge',
    amount: '$50,000 – $99,999',
    accent: 'border-t-4 border-t-[#9e4a3a]',
    recognition: [
      'Sponsored translation volume',
      'Logo on the sponsors page at sourcelibrary.org',
      'Recognition in the annual report',
    ],
    engagement: [
      'Private BPH tour for up to 10 guests',
      'VIP access to launch and partner events',
      'Bi-annual briefings',
    ],
    reciprocity: ['Early access to datasets and research previews'],
  },
  {
    name: 'Guardian of Wisdom',
    amount: '$25,000 – $49,999',
    accent: 'border-t-4 border-t-stone-600',
    recognition: [
      'Logo on the sponsors page (partner tier)',
      'Recognition in the annual report',
    ],
    engagement: [
      'Private BPH tour for up to 5 guests',
      'Invitation to the annual event',
      'Annual briefing',
    ],
    reciprocity: [],
  },
  {
    name: 'Friend of Source Library',
    amount: '$10,000 – $24,999',
    accent: 'border-t-4 border-t-stone-400',
    recognition: [
      'Name listed on the sponsors page (supporter tier)',
      'Recognition in the annual report',
    ],
    engagement: [
      'Group tour of the Bibliotheca',
      'Invitation to public events',
    ],
    reciprocity: [],
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
            <a
              href={mailto}
              className="inline-flex items-center px-6 py-3 rounded-md bg-[#9e4a3a] text-white text-sm font-semibold hover:bg-[#7e3a2e] transition-colors"
            >
              Talk to us
            </a>
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
            scholar-reviewed translations published openly under CC BY-SA.
          </p>
        </div>
      </section>

      {/* Tier table */}
      <section className="bg-[#faf8f5] py-16 md:py-24">
        <div className="px-6 md:px-12 max-w-6xl mx-auto">
          <h2 className="text-3xl md:text-4xl text-stone-900 mb-4 leading-tight font-display">
            Sponsorship tiers
          </h2>
          <p className="text-base md:text-lg text-stone-600 leading-relaxed max-w-3xl mb-12">
            Public credit, real access to the project, and (above $25K) a working relationship with
            the team and the data we produce. Tax-deductible in the US and the Netherlands.
          </p>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {TIERS.map((tier) => (
              <div
                key={tier.name}
                className={`bg-white rounded-xl border border-stone-200 p-6 md:p-8 ${tier.accent}`}
              >
                <div className="mb-5">
                  <h3 className="text-xl md:text-2xl font-display text-stone-900 mb-1">
                    {tier.name}
                  </h3>
                  <div className="text-sm font-semibold text-[#9e4a3a]">{tier.amount}</div>
                </div>

                <div className="space-y-5 text-sm">
                  <div>
                    <div className="text-xs uppercase tracking-wider text-stone-500 mb-2">
                      Recognition
                    </div>
                    <ul className="space-y-1.5 text-stone-700 leading-relaxed">
                      {tier.recognition.map((line) => (
                        <li key={line} className="flex gap-2">
                          <span className="text-stone-400">&middot;</span>
                          <span>{line}</span>
                        </li>
                      ))}
                    </ul>
                  </div>

                  <div>
                    <div className="text-xs uppercase tracking-wider text-stone-500 mb-2">
                      Engagement
                    </div>
                    <ul className="space-y-1.5 text-stone-700 leading-relaxed">
                      {tier.engagement.map((line) => (
                        <li key={line} className="flex gap-2">
                          <span className="text-stone-400">&middot;</span>
                          <span>{line}</span>
                        </li>
                      ))}
                    </ul>
                  </div>

                  {tier.reciprocity.length > 0 && (
                    <div>
                      <div className="text-xs uppercase tracking-wider text-stone-500 mb-2">
                        Data &amp; research access
                      </div>
                      <ul className="space-y-1.5 text-stone-700 leading-relaxed">
                        {tier.reciprocity.map((line) => (
                          <li key={line} className="flex gap-2">
                            <span className="text-stone-400">&middot;</span>
                            <span>{line}</span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* AI-lab reciprocity */}
      <section className="bg-white py-16 md:py-24">
        <div className="px-6 md:px-12 max-w-5xl mx-auto">
          <div className="text-xs uppercase tracking-[0.2em] text-stone-500 mb-3">
            For AI labs
          </div>
          <h2 className="text-3xl md:text-4xl text-stone-900 mb-6 leading-tight font-display">
            We&apos;re building this for you to use.
          </h2>
          <p className="text-lg text-stone-600 leading-relaxed mb-8 max-w-3xl">
            The library is structured for machine reading from day one: clean OCR, scholar-reviewed
            translations, page-level citable URIs, and aligned Latin/Greek/Hebrew/German/French/
            Italian/Dutch ↔ English parallel corpora. If you train models, this is data you
            don&apos;t have access to anywhere else.
          </p>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-x-12 gap-y-6 text-stone-700">
            <div>
              <div className="font-semibold text-stone-900 mb-1">Parallel corpora</div>
              <p className="text-sm leading-relaxed">
                Page- and paragraph-level alignments between the original language and English.
                Useful for translation eval, alignment work, and low-resource fine-tuning.
              </p>
            </div>
            <div>
              <div className="font-semibold text-stone-900 mb-1">Structured metadata</div>
              <p className="text-sm leading-relaxed">
                VIAF- and Wikidata-linked author authority files, USTC alignment, work-type and
                language classification, subject tags.
              </p>
            </div>
            <div>
              <div className="font-semibold text-stone-900 mb-1">A say in what gets translated</div>
              <p className="text-sm leading-relaxed">
                Sponsors can nominate authors, traditions, or specific manuscripts to jump the
                translation queue.
              </p>
            </div>
            <div>
              <div className="font-semibold text-stone-900 mb-1">Clear training licence</div>
              <p className="text-sm leading-relaxed">
                Translations are CC BY-SA. Sponsors get an explicit grant covering commercial
                model training, with attribution.
              </p>
            </div>
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
              <div className="font-semibold text-stone-900 mb-1">501(c)(3) via NAF</div>
              <p className="text-sm text-stone-600 leading-relaxed">
                Netherland-America Foundation handles the US side. Wire, stock, DAF, and corporate
                matching all work.
              </p>
            </div>
            <div className="bg-white rounded-lg border border-stone-200 p-6">
              <div className="text-xs uppercase tracking-wider text-stone-500 mb-2">
                Netherlands &amp; EU
              </div>
              <div className="font-semibold text-stone-900 mb-1">Cultural ANBI</div>
              <p className="text-sm text-stone-600 leading-relaxed">
                Stichting Het Wereldhart holds Cultural ANBI status — 125% deductibility for Dutch
                corporate donors under the Geefwet.
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
            Tell us what you&apos;d like to do — a named translation series, dataset access, a
            specific author or tradition, or something we haven&apos;t built yet. We&apos;ll come
            back inside a week with a concrete proposal.
          </p>
          <a
            href={mailto}
            className="inline-flex items-center px-8 py-4 rounded-md bg-[#c9a86c] text-stone-900 text-sm font-semibold hover:bg-[#b8975b] transition-colors"
          >
            {PARTNERSHIP_EMAIL}
          </a>
          <p className="text-xs text-stone-500 mt-8">
            For individual donations and small gifts, see{' '}
            <Link href="/support" className="underline hover:text-stone-300">
              /support
            </Link>
            . For founding-donor programs, see{' '}
            <Link href="/founding-donors" className="underline hover:text-stone-300">
              /founding-donors
            </Link>
            .
          </p>
        </div>
      </section>
    </div>
  );
}
