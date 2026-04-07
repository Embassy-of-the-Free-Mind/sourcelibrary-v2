import Link from 'next/link';
import { Metadata } from 'next';
import SiteHeader from '@/components/layout/SiteHeader';
import { getDb } from '@/lib/mongodb';

export const revalidate = 600;
export const maxDuration = 60;

export const metadata: Metadata = {
  title: 'Support — Source Library',
  description: 'Support the digitization and translation of rare historical texts from the Bibliotheca Philosophica Hermetica.',
  alternates: { canonical: '/support' },
};

const MOLLIE_URL = 'https://payment-links.mollie.com/en/payment/ug24y6U3mtCvzCwUhfPHD/details';
const DONORPERFECT_URL = 'https://form-renderer-app.donorperfect.io/give/naf/embassyofthefreemind';
const CONTACT_EMAIL = 'derek@sourcelibrary.org';

const PHASES = [
  {
    label: 'Phase 1',
    name: 'Foundation',
    status: 'current' as const,
    items: [
      'Digitize and OCR the core BPH collection',
      'AI-assisted translation of Latin, Greek, and German texts',
      'Build the open-access platform and reading interface',
      'Scholarly review pipeline for translation verification',
    ],
  },
  {
    label: 'Phase 2',
    name: 'Expansion',
    status: 'upcoming' as const,
    items: [
      'Expand to partner libraries across Europe',
      'Add Sanskrit, Arabic, and Hebrew source traditions',
      'Community tools for collaborative annotation',
      'Comprehensive search across all translated texts',
    ],
  },
  {
    label: 'Phase 3',
    name: 'Community',
    status: 'upcoming' as const,
    items: [
      'Build a scholarly community around the collection',
      'Educational programs and guided reading paths',
      'API access for researchers and AI developers',
      'Full integration with global digital humanities infrastructure',
    ],
  },
];

function formatStat(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`.replace('.0K', 'K');
  return n.toLocaleString('en-US');
}

async function fetchStats() {
  try {
    const db = await getDb();
    const books = db.collection('books');
    const match = { visible: true, pages_count: { $gt: 0 } };

    const [totalBooks, firstTranslations, agg] = await Promise.all([
      books.countDocuments(match, { maxTimeMS: 15000 }),
      books.countDocuments({ ...match, is_first_translation: true, pages_translated: { $gt: 0 } }, { maxTimeMS: 15000 }),
      books.aggregate([
        { $match: match },
        { $group: { _id: null, translated: { $sum: { $ifNull: ['$pages_translated', 0] } } } },
      ], { maxTimeMS: 15000 }).toArray(),
    ]);

    return {
      totalBooks,
      firstTranslations,
      pagesTranslated: agg[0]?.translated || 0,
    };
  } catch {
    return { totalBooks: 9900, firstTranslations: 5500, pagesTranslated: 2400000 };
  }
}

export default async function SupportPage() {
  const stats = await fetchStats();

  return (
    <div className="min-h-screen">
      <SiteHeader variant="light" />

      {/* Header */}
      <section className="bg-gradient-to-b from-[#f6f3ee] to-white pt-8 pb-16 md:pt-12 md:pb-24">
        <div className="px-6 md:px-12 max-w-5xl mx-auto">
          <h1 className="text-3xl md:text-4xl lg:text-5xl text-stone-900 mb-6 leading-tight font-display">
            Support Source Library
          </h1>
          <p className="text-lg md:text-xl text-stone-600 leading-relaxed max-w-3xl">
            Source Library is an initiative of the{' '}
            <a
              href="https://embassyofthefreemind.com"
              target="_blank"
              rel="noopener noreferrer"
              className="text-accent-rust hover:text-accent-gold-dark underline"
            >
              Embassy of the Free Mind
            </a>{' '}
            (EFM) in Amsterdam. All contributions are received by EFM and allocated specifically to the Source Library project — funding the digitization, translation, and open publication of rare historical texts.
          </p>
        </div>
      </section>

      {/* Stats */}
      <section className="bg-white border-b border-stone-200">
        <div className="px-6 md:px-12 max-w-5xl mx-auto py-12 md:py-16">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-8 md:gap-12">
            <div className="text-center md:text-left">
              <div className="text-4xl md:text-5xl font-display text-stone-900 mb-2">
                {formatStat(stats.totalBooks)}
              </div>
              <div className="text-sm text-stone-500 uppercase tracking-wider">
                Books digitized
              </div>
            </div>
            <div className="text-center md:text-left">
              <div className="text-4xl md:text-5xl font-display text-stone-900 mb-2">
                {formatStat(stats.pagesTranslated)}
              </div>
              <div className="text-sm text-stone-500 uppercase tracking-wider">
                Pages translated
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
          </div>
        </div>
      </section>

      {/* Example: Before & After */}
      <section className="bg-white py-16 md:py-24">
        <div className="px-6 md:px-12 max-w-5xl mx-auto">
          <h2 className="text-3xl md:text-4xl text-gray-900 mb-4 leading-tight font-display">
            What this looks like
          </h2>
          <p className="text-lg text-gray-600 mb-10 max-w-3xl">
            The opening of the <em>Pimander</em> — the foundational text of the Hermetic tradition — translated by Marsilio Ficino in 1481. This Venice edition had never been rendered into English until Source Library.
          </p>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 lg:gap-8">
            {/* Original scan */}
            <div className="rounded-xl overflow-hidden border border-stone-200 bg-stone-50">
              <div className="px-4 py-3 bg-stone-100 border-b border-stone-200">
                <span className="text-xs font-medium text-stone-500 uppercase tracking-wider">
                  Original &middot; Venice, 1481
                </span>
              </div>
              <Link href="/book/corpus-hermeticum-pimander-1481-venice-edition-hermes-trismegistus">
                <img
                  src="https://images.sourcelibrary.org/pages/694f3d6cbe37f451a5324e10/0015.jpg"
                  alt="Opening page of Ficino's 1481 Latin translation of the Pimander"
                  className="w-full h-auto"
                  loading="lazy"
                />
              </Link>
            </div>

            {/* Translation */}
            <div className="rounded-xl overflow-hidden border border-stone-200 bg-white flex flex-col">
              <div className="px-4 py-3 bg-stone-100 border-b border-stone-200">
                <span className="text-xs font-medium text-stone-500 uppercase tracking-wider">
                  English translation &middot; Source Library
                </span>
              </div>
              <div className="p-6 md:p-8 flex-1 flex flex-col">
                <h3 className="text-base font-semibold text-stone-900 mb-1 uppercase tracking-wide">
                  The Book of Mercury Trismegistus
                </h3>
                <p className="text-xs text-stone-500 mb-6 uppercase tracking-wide">
                  On the Power and Wisdom of God, translated from Greek into Latin by Marsilio Ficino the Florentine to Cosimo de&apos; Medici, Father of his Country
                </p>
                <h4 className="text-sm font-semibold text-stone-700 mb-4 uppercase tracking-wide">
                  The Pimander begins.
                </h4>
                <blockquote className="text-stone-700 text-base md:text-lg leading-relaxed flex-1 font-serif italic">
                  &ldquo;When I was meditating on the nature of things and raising the sharp point of my mind toward the heavens, the senses of my body were now put to sleep — just as it usually happens to those who are heavy with sleep due to fullness or exhaustion. Suddenly, I seemed to see someone of immense bodily stature, who, calling me by name, cried out in this manner: &lsquo;What is it, O Mercury, that you wish to hear and see, and having seen, to learn and know?&rsquo;&rdquo;
                </blockquote>
                <div className="mt-6 pt-4 border-t border-stone-100">
                  <Link
                    href="/book/corpus-hermeticum-pimander-1481-venice-edition-hermes-trismegistus"
                    className="text-accent-rust hover:text-accent-gold-dark text-sm font-medium"
                  >
                    Read the full text &rarr;
                  </Link>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Why Now */}
      <section className="bg-gradient-to-b from-[#f6f3ee] to-white py-16 md:py-24">
        <div className="px-6 md:px-12 max-w-5xl mx-auto">
          <h2 className="text-3xl md:text-4xl lg:text-5xl text-gray-900 mb-8 leading-tight font-display">
            Why now?
          </h2>
          <p className="text-lg md:text-xl text-gray-600 leading-relaxed">
            Foundation AI models are being trained today on datasets that will shape how artificial intelligence reasons about philosophy, ethics, consciousness, and meaning for years to come. The Hermetic tradition, Renaissance natural philosophy, and 2,500 years of esoteric thought are almost entirely absent from these datasets. Getting this material in now — verified, citable, linked to scans of original pages — means it shapes AI&apos;s understanding from the ground up.
          </p>
        </div>
      </section>

      {/* How to Donate — Two Routes */}
      <section className="bg-white py-16 md:py-24">
        <div className="px-6 md:px-12 max-w-5xl mx-auto">
          <h2 className="text-3xl md:text-4xl text-stone-900 mb-4 leading-tight font-display">
            How to Donate
          </h2>
          <p className="text-lg text-stone-600 mb-12 max-w-3xl">
            There are two ways to support Source Library, depending on your location and needs.
          </p>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
            {/* US Donors — NAF */}
            <div className="bg-[#faf8f5] rounded-2xl border border-stone-200 p-8 flex flex-col">
              <div className="flex items-center gap-3 mb-4">
                <span className="inline-flex items-center justify-center w-10 h-10 rounded-full bg-stone-200 text-stone-600 text-lg font-semibold shrink-0">
                  US
                </span>
                <h3 className="text-xl font-semibold text-stone-900">
                  US Tax-Deductible Donation
                </h3>
              </div>
              <p className="text-stone-600 text-sm leading-relaxed mb-4">
                For US-based donors and companies seeking tax benefits. Donations are processed through the{' '}
                <strong>Netherland-America Foundation</strong> (NAF), a 501(c)(3) public charity (EIN: 13-2989216).
              </p>
              <p className="text-stone-500 text-xs leading-relaxed mb-6">
                Tax-deductible to the full extent permitted by US law. Please write &ldquo;Source Library&rdquo; in the comments field.
              </p>
              <div className="mt-auto">
                <a
                  href={DONORPERFECT_URL}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="block w-full text-center bg-stone-900 text-white py-3 px-6 rounded-full hover:bg-stone-800 transition-colors text-base font-medium"
                >
                  Donate via NAF
                </a>
              </div>
            </div>

            {/* International Donors — EFM / Mollie */}
            <div className="bg-[#faf8f5] rounded-2xl border border-stone-200 p-8 flex flex-col">
              <div className="flex items-center gap-3 mb-4">
                <span className="inline-flex items-center justify-center w-10 h-10 rounded-full bg-stone-200 text-stone-600 text-lg font-semibold shrink-0">
                  EU
                </span>
                <h3 className="text-xl font-semibold text-stone-900">
                  Direct Donation via EFM
                </h3>
              </div>
              <p className="text-stone-600 text-sm leading-relaxed mb-4">
                For European and international donors. Your contribution goes directly to the Embassy of the Free Mind, earmarked for Source Library.
              </p>
              <p className="text-stone-500 text-xs leading-relaxed mb-2">
                Please include <strong>&ldquo;Source Library&rdquo;</strong> in the description of your donation so we can allocate your contribution correctly.
              </p>
              <p className="text-stone-500 text-xs leading-relaxed mb-6">
                Donation confirmations and receipts are available upon request.
              </p>
              <div className="mt-auto">
                <a
                  href={MOLLIE_URL}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="block w-full text-center bg-stone-900 text-white py-3 px-6 rounded-full hover:bg-stone-800 transition-colors text-base font-medium"
                >
                  Donate via EFM
                </a>
              </div>
            </div>
          </div>

          {/* Tax Benefits */}
          <div className="mt-10 bg-[#faf8f5] rounded-xl border border-stone-200 p-6">
            <h3 className="text-base font-semibold text-stone-900 mb-2">Tax Benefits</h3>
            <p className="text-stone-600 text-sm leading-relaxed">
              The Embassy of the Free Mind is a registered non-profit organization (ANBI-registered in the Netherlands). Your donation may be tax-deductible depending on your country of residence. US donors giving through the Netherland-America Foundation receive full 501(c)(3) tax benefits.
            </p>
          </div>

          {/* Large gifts */}
          <p className="text-stone-500 text-sm mt-8 text-center">
            For wire transfers, stock gifts, or donations over $10,000,{' '}
            <a
              href={`mailto:${CONTACT_EMAIL}?subject=Source%20Library%20%E2%80%94%20Large%20Gift%20Inquiry`}
              className="text-accent-rust hover:text-accent-gold-dark underline"
            >
              contact us directly
            </a>.
          </p>
        </div>
      </section>

      {/* Early Supporters */}
      <section className="bg-gradient-to-b from-[#f6f3ee] to-[#f3ede6] py-16 md:py-24">
        <div className="px-6 md:px-12 max-w-5xl mx-auto">
          <h2 className="text-3xl md:text-4xl text-stone-900 mb-4 leading-tight font-display">
            Become an Early Supporter
          </h2>
          <p className="text-lg text-stone-600 leading-relaxed mb-6 max-w-3xl">
            As an Early Supporter, you play a key role in kickstarting Source Library. Your contribution helps make the first phase of development possible — enabling us to build the foundation of the platform, curate and digitize essential sources, and produce the initial translations.
          </p>
          <p className="text-lg text-stone-600 leading-relaxed max-w-3xl">
            Early Supporters help us move from idea to reality. We are building toward a community around this work — and those who contribute now are its founding members.
          </p>
        </div>
      </section>

      {/* Where Your Support Goes */}
      <section className="bg-white py-16 md:py-24">
        <div className="px-6 md:px-12 max-w-5xl mx-auto">
          <h2 className="text-3xl md:text-4xl text-stone-900 mb-12 leading-tight font-display">
            Where Your Support Goes
          </h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-8 mb-16">
            {[
              {
                icon: '01',
                title: 'Research & Curation',
                text: 'Identifying, sourcing, and prioritizing the most important texts from rare book collections across Europe — building a roadmap of what to digitize, translate, and publish.',
              },
              {
                icon: '02',
                title: 'Digitization',
                text: 'High-resolution scanning of fragile manuscripts and rare printed books from the Bibliotheca Philosophica Hermetica and partner libraries, preserving them for future generations.',
              },
              {
                icon: '03',
                title: 'Translation & Editorial',
                text: 'AI-assisted translation of Latin, Greek, German, and other historical languages, followed by scholarly review to ensure accuracy. This is the core of the work and the largest cost.',
              },
              {
                icon: '04',
                title: 'Platform Development',
                text: 'Building and maintaining the open-access reading platform — page-by-page bilingual display, full-text search, image galleries, and integration with global digital humanities infrastructure.',
              },
            ].map((item) => (
              <div key={item.title} className="bg-[#faf8f5] rounded-xl border border-stone-200 p-6 md:p-8">
                <span className="inline-block text-xs font-semibold text-stone-400 tracking-wider uppercase mb-3">
                  {item.icon}
                </span>
                <h3 className="text-lg font-semibold text-stone-900 mb-3">{item.title}</h3>
                <p className="text-stone-600 text-sm leading-relaxed">{item.text}</p>
              </div>
            ))}
          </div>

          {/* Roadmap Phases */}
          <h3 className="text-2xl text-stone-900 mb-8 font-display">Roadmap</h3>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            {PHASES.map((phase) => (
              <div
                key={phase.name}
                className={`rounded-xl p-6 ${
                  phase.status === 'current'
                    ? 'bg-stone-900 text-white'
                    : 'bg-[#faf8f5] border border-stone-200'
                }`}
              >
                <span className="inline-block text-xs font-semibold text-stone-400 tracking-wider uppercase mb-1">
                  {phase.label}
                </span>
                <h4
                  className={`text-lg font-semibold mb-4 ${
                    phase.status === 'current' ? 'text-white' : 'text-stone-900'
                  }`}
                >
                  {phase.name}
                  {phase.status === 'current' && (
                    <span className="ml-2 inline-block text-xs font-medium bg-white/20 text-white/80 px-2 py-0.5 rounded-full">
                      Now
                    </span>
                  )}
                </h4>
                <ul
                  className={`text-sm space-y-2 ${
                    phase.status === 'current' ? 'text-stone-300' : 'text-stone-600'
                  }`}
                >
                  {phase.items.map((item) => (
                    <li key={item} className="flex gap-2">
                      <span
                        className={`mt-1 shrink-0 ${
                          phase.status === 'current' ? 'text-accent-gold' : 'text-stone-400'
                        }`}
                      >
                        &#10003;
                      </span>
                      {item}
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* How It All Connects */}
      <section className="bg-gradient-to-b from-[#f6f3ee] to-[#f3ede6] py-16 md:py-24">
        <div className="px-6 md:px-12 max-w-5xl mx-auto">
          <h2 className="text-3xl md:text-4xl text-stone-900 mb-8 leading-tight font-display">
            How It All Connects
          </h2>
          <div className="text-stone-600 text-lg leading-relaxed space-y-6">
            <p>
              Source Library is a project of the{' '}
              <a
                href="https://embassyofthefreemind.com"
                target="_blank"
                rel="noopener noreferrer"
                className="text-accent-rust hover:text-accent-gold-dark underline"
              >
                Embassy of the Free Mind
              </a>{' '}
              in Amsterdam — home to the Bibliotheca Philosophica Hermetica (BPH). The Embassy preserves and shares the physical collection. Source Library extends that mission digitally, making these texts freely accessible worldwide.
            </p>
            <p>
              If you are interested in becoming a member of the Embassy of the Free Mind or supporting the broader organization,{' '}
              <a
                href="https://embassyofthefreemind.com"
                target="_blank"
                rel="noopener noreferrer"
                className="text-accent-rust hover:text-accent-gold-dark underline"
              >
                visit the EFM website
              </a>.
            </p>
          </div>
        </div>
      </section>

      {/* Scan the Renaissance */}
      <section className="bg-white py-16 md:py-24">
        <div className="px-6 md:px-12 max-w-5xl mx-auto text-center">
          <h2 className="text-3xl md:text-4xl text-stone-900 mb-4 leading-tight font-display">
            Scan the Renaissance
          </h2>
          <p className="text-lg text-stone-600 mb-6 leading-relaxed">
            1.15 million Renaissance editions remain unscanned. A single gift can open an entire subject area.
          </p>
          <Link
            href="/contribute"
            className="inline-block bg-stone-900 text-white py-3 px-8 rounded-full hover:bg-stone-800 transition-colors text-base font-medium"
          >
            How to Contribute
          </Link>
        </div>
      </section>

      {/* Footer */}
      <footer className="bg-gradient-to-b from-[#f6f3ee] to-[#f3ede6] py-16 md:py-24">
        <div className="px-6 md:px-12 max-w-5xl mx-auto">
          {/* Partner Logos */}
          <div className="flex items-center gap-8 mb-12">
            <img
              src="https://images.sourcelibrary.org/assets/embassy-of-the-free-mind-logo.png"
              alt="Embassy of the Free Mind"
              className="h-16 md:h-20 w-auto object-contain"
            />
            <img
              src="https://images.sourcelibrary.org/assets/partners-unesco.avif"
              alt="UNESCO Memory of the World"
              className="h-20 md:h-24 w-auto object-contain"
            />
          </div>

          {/* Other Ways to Help */}
          <div className="mb-12 pb-12 border-b border-stone-300">
            <p className="text-stone-600 text-lg">
              Not everyone gives money — some give time and expertise.{' '}
              <Link
                href="/contribute"
                className="text-accent-rust hover:text-accent-gold-dark underline font-medium"
              >
                Participate
              </Link>{' '}
              as a translator, reviewer, or community volunteer.
            </p>
          </div>

          {/* Footer Links */}
          <div className="flex flex-col md:flex-row justify-between items-start md:items-center">
            <div className="mb-4 md:mb-0 text-stone-600">
              &copy; {new Date().getFullYear()} Source Library — Embassy of the Free Mind
            </div>
            <div className="flex flex-wrap items-center gap-4 md:gap-6 text-stone-600">
              <Link href="/" className="hover:text-stone-900 transition-colors">
                Home
              </Link>
              <span className="hidden md:inline">&middot;</span>
              <span>CC0 Public Domain</span>
              <span className="hidden md:inline">&middot;</span>
              <a
                href={`mailto:${CONTACT_EMAIL}`}
                className="text-accent-rust hover:text-accent-gold-dark transition-colors"
              >
                {CONTACT_EMAIL}
              </a>
            </div>
          </div>
        </div>
      </footer>
    </div>
  );
}
