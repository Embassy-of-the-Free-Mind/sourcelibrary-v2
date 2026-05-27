import Link from 'next/link';
import { Metadata } from 'next';
import SiteHeader from '@/components/layout/SiteHeader';
import { getReadDb } from '@/lib/mongodb';

export const revalidate = 3600;
export const maxDuration = 60;

export const metadata: Metadata = {
  title: 'Corporate Sponsorship — Source Library',
  description:
    'Partner with Source Library to translate, digitize, and open-access publish the half-million Latin works of the Renaissance and the wider canon of pre-modern knowledge.',
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
            The library AI needs.
          </h1>
          <p className="text-lg md:text-xl text-stone-600 leading-relaxed max-w-3xl">
            Source Library is an open, citable corpus of the foundational works of Western and
            comparative thought — already used by readers, scholars, and frontier AI systems.
            Corporate sponsorship sustains the public good: translation at scale,
            scholar-reviewed quality, and free open-access publication for every reader on earth.
          </p>
          <div className="mt-10 flex flex-wrap gap-3">
            <a
              href={mailto}
              className="inline-flex items-center px-6 py-3 rounded-md bg-[#9e4a3a] text-white text-sm font-semibold hover:bg-[#7e3a2e] transition-colors"
            >
              Start a conversation
            </a>
            <Link
              href="/collections"
              className="inline-flex items-center px-6 py-3 rounded-md border border-stone-300 text-stone-700 text-sm font-semibold hover:border-stone-500 transition-colors"
            >
              Explore the collection
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
            Frontier AI models are being trained today on datasets that will shape how they reason
            about philosophy, ethics, history, science, and meaning for decades. The Hermetic
            tradition, Renaissance natural philosophy, and 2,500 years of esoteric and scholastic
            thought are almost entirely absent from those datasets. Getting this corpus translated,
            citable, and openly licensed now means it shapes AI&apos;s understanding from the ground
            up — and remains public for every human reader.
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
            Four tiers, each combining public recognition, direct engagement with the project, and
            (at higher tiers) early access to the structured data the library produces. All tiers
            are tax-deductible in the US and the Netherlands.
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
            For AI labs and research organisations
          </div>
          <h2 className="text-3xl md:text-4xl text-stone-900 mb-6 leading-tight font-display">
            Reciprocal partnership, not branded charity.
          </h2>
          <p className="text-lg text-stone-600 leading-relaxed mb-8 max-w-3xl">
            For partners building or training frontier systems, sponsorship goes both directions.
            The library is built to be machine-readable: clean OCR, scholar-reviewed translations,
            structured metadata, citable page-level URIs, and parallel corpora across Latin, Greek,
            Hebrew, German, French, Italian, Dutch, and more.
          </p>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-x-12 gap-y-6 text-stone-700">
            <div>
              <div className="font-semibold text-stone-900 mb-1">Parallel corpora</div>
              <p className="text-sm leading-relaxed">
                Latin↔English (and other source languages↔English) at page and paragraph level —
                useful for translation evaluation, alignment research, and low-resource modelling.
              </p>
            </div>
            <div>
              <div className="font-semibold text-stone-900 mb-1">Structured metadata</div>
              <p className="text-sm leading-relaxed">
                Author authority files (VIAF/Wikidata-linked), USTC alignment, work-type
                classification, language detection, and subject tagging.
              </p>
            </div>
            <div>
              <div className="font-semibold text-stone-900 mb-1">Translation priorities</div>
              <p className="text-sm leading-relaxed">
                Sponsoring partners can nominate authors, traditions, or specific manuscripts for
                priority translation and scholarly review.
              </p>
            </div>
            <div>
              <div className="font-semibold text-stone-900 mb-1">Open licensing</div>
              <p className="text-sm leading-relaxed">
                Translations are published CC BY-SA. Sponsoring partners receive an explicit licence
                grant for commercial training use, with attribution to Source Library.
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
            Source Library is an initiative of the{' '}
            <a
              href="https://embassyofthefreemind.com"
              target="_blank"
              rel="noopener noreferrer"
              className="text-[#9e4a3a] hover:underline"
            >
              Embassy of the Free Mind
            </a>{' '}
            in Amsterdam — home of the Bibliotheca Philosophica Hermetica, inscribed on the
            UNESCO Memory of the World register. Sponsorships are received and administered
            through the appropriate fiscal entity in each jurisdiction.
          </p>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div className="bg-white rounded-lg border border-stone-200 p-6">
              <div className="text-xs uppercase tracking-wider text-stone-500 mb-2">
                United States
              </div>
              <div className="font-semibold text-stone-900 mb-1">501(c)(3) tax-deductible</div>
              <p className="text-sm text-stone-600 leading-relaxed">
                Fiscally sponsored by the Netherland-America Foundation (NAF), a US public
                charity. Wire, stock, donor-advised funds, and matching-gift programs all
                supported.
              </p>
            </div>
            <div className="bg-white rounded-lg border border-stone-200 p-6">
              <div className="text-xs uppercase tracking-wider text-stone-500 mb-2">
                Netherlands &amp; EU
              </div>
              <div className="font-semibold text-stone-900 mb-1">Cultural ANBI</div>
              <p className="text-sm text-stone-600 leading-relaxed">
                Received by Stichting Het Wereldhart (Embassy of the Free Mind), holding Cultural
                ANBI status — 125% deductibility for Dutch corporate donors under the Geefwet.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* CTA */}
      <section className="bg-stone-900 text-white py-16 md:py-24">
        <div className="px-6 md:px-12 max-w-3xl mx-auto text-center">
          <h2 className="text-3xl md:text-4xl text-white mb-6 leading-tight font-display">
            Start a conversation.
          </h2>
          <p className="text-base md:text-lg text-stone-300 leading-relaxed mb-10">
            Corporate sponsorships are bespoke. Tell us a little about your organisation and what
            you&apos;d like to achieve — named series, research access, dataset partnership, or
            something we haven&apos;t built yet — and we&apos;ll come back with a concrete proposal
            within five working days.
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
