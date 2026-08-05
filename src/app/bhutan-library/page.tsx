import Link from 'next/link';
import OutboundLink from '@/components/analytics/OutboundLink';
import { Metadata } from 'next';
import SiteHeader from '@/components/layout/SiteHeader';
import DonationIntentionForm from '@/components/donate/DonationIntentionForm';
import { getReadDb } from '@/lib/mongodb';

export const revalidate = 3600;
export const maxDuration = 60;

export const metadata: Metadata = {
  title: "The Bhutanese Buddhist Library — Source Library",
  description:
    "Bhutan's endangered Buddhist manuscripts — rescued from its monasteries, written in classical Tibetan — translated faithfully into English for the first time. Dedicated to His Majesty the King of Bhutan.",
  alternates: { canonical: '/bhutan-library' },
  openGraph: {
    title: 'The Bhutanese Buddhist Library',
    description:
      "Endangered manuscripts from Bhutan's monasteries, translated faithfully into English for the first time. Help us complete the work.",
    url: '/bhutan-library',
    type: 'article',
    images: [{ url: 'https://images.sourcelibrary.org/pages/69e787904a6785cfd60cc297/0095.jpg' }],
  },
  twitter: { card: 'summary_large_image', title: 'The Bhutanese Buddhist Library' },
};

const EFM_STRIPE_URL = 'https://donate.stripe.com/9B67sLbO1bOg2GxfxP9fW08';
// Source Library designation at NAF, not general Embassy support — see the note in
// src/components/donate/SupportView.tsx.
const DONORPERFECT_URL = 'https://form-renderer-app.donorperfect.io/give/embassyofthefreemindsourcelibrary';
const CONTACT_EMAIL = 'team@sourcelibrary.org';

// Three pecha leaves on a dark ground — the manuscript story at a glance.
const HERO_IMAGE = 'https://images.sourcelibrary.org/pages/69e787904a6785cfd60cc297/0095.jpg';

// Real folios from the collection, used in the gallery strip.
const GALLERY: { url: string; caption: string }[] = [
  {
    url: 'https://images.sourcelibrary.org/pages/69dfee83ce6bb8619e07f177/0249.jpg',
    caption: 'Zhi khro dgongs pa rang grol — the Bardo Thödol cycle',
  },
  {
    url: 'https://images.sourcelibrary.org/pages/69dfee85ce6bb8619e07f5d8/0001.jpg',
    caption: 'A weathered pecha folio with red margin rulings',
  },
  {
    url: 'https://images.sourcelibrary.org/pages/69e77a6c0fc6fc955e35fc9b/0081.jpg',
    caption: "Bla ma dgongs 'dus — a lineage supplication",
  },
  {
    url: 'https://images.sourcelibrary.org/pages/69e78ae14a6785cfd60d4d44/0013.jpg',
    caption: 'A sādhana with gold ground and red rubrication',
  },
  {
    url: 'https://images.sourcelibrary.org/pages/69e78b614a6785cfd60d553c/0088.jpg',
    caption: 'Three distinct folios, photographed as one archive plate',
  },
  {
    url: 'https://images.sourcelibrary.org/pages/69dfee87ce6bb8619e07f806/0001.jpg',
    caption: 'A Heart Sūtra commentary, modern blockprint',
  },
];

function formatStat(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(0)}K`;
  return n.toLocaleString('en-US');
}

async function fetchStats() {
  const fallback = { books: 1470, pagesOcr: 289989, firstTranslations: 829 };
  try {
    const db = await getReadDb();
    const books = db.collection('books');
    const match = { language: 'Tibetan', visible: true, pages_translated: { $gt: 0 } };
    const [count, firstTranslations, agg] = await Promise.all([
      books.countDocuments(match, { maxTimeMS: 15000 }),
      books.countDocuments({ ...match, is_first_translation: true }, { maxTimeMS: 15000 }),
      books
        .aggregate(
          [
            { $match: match },
            { $group: { _id: null, ocr: { $sum: { $ifNull: ['$pages_ocr', 0] } } } },
          ],
          { maxTimeMS: 15000 },
        )
        .toArray(),
    ]);
    return {
      books: count || fallback.books,
      pagesOcr: agg[0]?.ocr || fallback.pagesOcr,
      firstTranslations: firstTranslations || fallback.firstTranslations,
    };
  } catch {
    return fallback;
  }
}

export default async function BhutanLibraryPage() {
  const stats = await fetchStats();

  return (
    <div className="min-h-screen bg-stone-50">
      {/* Hero */}
      <section className="relative overflow-hidden bg-stone-950">
        <img
          src={HERO_IMAGE}
          alt=""
          aria-hidden="true"
          className="absolute inset-0 w-full h-full object-cover object-center opacity-80"
        />
        <div className="absolute inset-0 bg-stone-950/55" />
        <div className="absolute inset-0 bg-gradient-to-t from-stone-950/95 via-stone-950/45 to-stone-950/70" />

        <div className="relative">
          <SiteHeader variant="transparent" />

          <div className="px-6 md:px-12 max-w-5xl mx-auto pt-12 pb-16 md:pt-20 md:pb-24">
            <p className="text-accent-gold/90 text-sm md:text-base uppercase tracking-[0.2em] mb-4">
              Dedicated to His Majesty the King of Bhutan
            </p>
            <h1 className="text-3xl md:text-5xl lg:text-6xl text-white mb-5 leading-[1.1] font-display drop-shadow-sm">
              The Bhutanese
              <br className="hidden md:block" /> Buddhist Library
            </h1>
            <p className="text-lg md:text-xl text-white/85 leading-relaxed max-w-3xl mb-8">
              {formatStat(stats.books)} sacred manuscripts — nearly{' '}
              {formatStat(stats.pagesOcr)} pages — rescued from the monasteries of Bhutan and written
              in classical Tibetan, most never read in English. We are translating them for the first
              time with a high-quality model,{' '}
              <em className="text-white not-italic font-display">proven faithful</em> to the
              originals.
            </p>

            <div className="flex flex-wrap gap-x-10 gap-y-4 text-white/80 mb-9">
              <span className="text-sm md:text-base">
                <strong className="font-display text-white text-lg md:text-xl">
                  {formatStat(stats.books)}
                </strong>{' '}
                manuscripts
              </span>
              <span className="text-sm md:text-base">
                <strong className="font-display text-white text-lg md:text-xl">
                  {formatStat(stats.pagesOcr)}
                </strong>{' '}
                pages digitized
              </span>
              <span className="text-sm md:text-base">
                <strong className="font-display text-white text-lg md:text-xl">
                  {formatStat(stats.firstTranslations)}+
                </strong>{' '}
                first-ever English translations
              </span>
            </div>

            <div className="flex flex-wrap gap-3">
              <a
                href="#support"
                className="bg-accent-gold text-stone-950 font-semibold py-3 px-7 rounded-full hover:bg-white transition-colors"
              >
                Support this work
              </a>
              <Link
                href="/collections/bhutan"
                className="bg-white/10 text-white font-medium py-3 px-7 rounded-full border border-white/30 hover:bg-white/20 transition-colors"
              >
                Explore the texts
              </Link>
            </div>
          </div>
        </div>
      </section>

      {/* An endangered library */}
      <section className="bg-white py-14 md:py-20 border-t border-stone-200">
        <div className="px-6 md:px-12 max-w-3xl mx-auto">
          <h2 className="text-2xl md:text-3xl text-stone-900 mb-5 font-display leading-tight">
            An endangered library
          </h2>
          <div className="prose-content text-stone-700 leading-relaxed space-y-4 text-[1.05rem]">
            <p>
              Most of these books are not famous printed editions. They are{' '}
              <strong>hand-copied pecha</strong> — loose-leaf folios from the temple and monastery
              collections of Bhutan: Drametse, Ogyen Choling, Gangtey, Thadrak, Tshamdrak and
              Nyephug. Written by hand in classical Tibetan and digitized through endangered-archives
              efforts, ninety-six percent of the collection is handwritten, and many of these
              manuscripts survive in few other places on earth.
            </p>
            <p>
              We have already digitized and made machine-readable every one of these manuscripts.
              The next step — the one that opens them to the world — is translating them faithfully
              into English, most for the very first time. For sacred texts that means getting it
              right: a garbled line in a Dzogchen pith-instruction or a Madhyamaka commentary is not
              a typo, it is a distortion of the teaching.
            </p>
          </div>
        </div>

        {/* Gallery strip */}
        <div className="px-6 md:px-12 max-w-6xl mx-auto mt-12">
          <div className="grid grid-cols-2 md:grid-cols-3 gap-3 md:gap-4">
            {GALLERY.map((g) => (
              <figure
                key={g.url}
                className="overflow-hidden rounded-lg bg-stone-100 border border-stone-200"
              >
                <img
                  src={g.url}
                  alt={g.caption}
                  loading="lazy"
                  className="w-full h-44 md:h-52 object-cover hover:scale-[1.03] transition-transform duration-500"
                />
                <figcaption className="text-xs text-stone-500 px-3 py-2 leading-snug">
                  {g.caption}
                </figcaption>
              </figure>
            ))}
          </div>
        </div>
      </section>

      {/* What we tested — the case for a premium model */}
      <section className="bg-gradient-to-b from-[#f6f3ee] to-[#f3ede6] py-14 md:py-20">
        <div className="px-6 md:px-12 max-w-3xl mx-auto">
          <h2 className="text-2xl md:text-3xl text-stone-900 mb-5 font-display leading-tight">
            A high-quality model, proven faithful
          </h2>
          <div className="prose-content text-stone-700 leading-relaxed space-y-4 text-[1.05rem]">
            <p>
              We didn&apos;t guess at this — we tested it. Independent AI reviewers checked
              transcriptions against the original page images across the collection, and we compared
              models head to head.
            </p>
            <p>
              We took famous texts that already have published scholarly translations — Tsongkhapa&apos;s{' '}
              <em>Essence of True Eloquence</em>, a Heart Sūtra commentary, Candrakīrti&apos;s{' '}
              <em>Entering the Middle Way</em> — and ran a blind comparison. Two independent expert
              reviewers judged the <strong>high-quality model</strong> translations to be on par with the
              published editions. The cheap model they judged unusable — it fabricated citations and
              dropped whole passages while still reading smoothly, the most dangerous kind of error in a
              sacred text.
            </p>
            <p>
              The method is proven. What&apos;s left is to translate the rest — most for the first
              time.
            </p>
          </div>
        </div>
      </section>

      {/* The offering */}
      <section className="bg-stone-950 py-14 md:py-20">
        <div className="px-6 md:px-12 max-w-3xl mx-auto text-center">
          <h2 className="text-2xl md:text-3xl text-white mb-5 font-display leading-tight">
            Dedicated to His Majesty the King of Bhutan
          </h2>
          <p className="text-white/80 leading-relaxed text-[1.05rem] max-w-2xl mx-auto">
            This work is offered in honor of His Majesty Jigme Khesar Namgyel Wangchuck, Druk Gyalpo,
            and the people of Bhutan. We aim to return these teachings — faithfully, freely, and
            openly — to the monasteries and temples that preserved them, and to scholars and
            practitioners everywhere who cherish Bhutan&apos;s living Buddhist heritage.
          </p>
        </div>
      </section>

      {/* Support */}
      <section id="support" className="bg-white py-14 md:py-20 border-t border-stone-200 scroll-mt-4">
        <div className="px-6 md:px-12 max-w-5xl mx-auto">
          <div className="max-w-3xl mb-8">
            <h2 className="text-2xl md:text-3xl text-stone-900 mb-3 font-display leading-tight">
              Help us complete the work
            </h2>
            <p className="text-stone-600 leading-relaxed text-[1.05rem]">
              A high-quality AI model costs many times more per page than a basic one. Translating all{' '}
              {formatStat(stats.pagesOcr)} pages this way — plus Tibetan-literate review — comes to
              about <strong>$10,000</strong> for the whole library.
            </p>
          </div>

          {/* Cost breakdown */}
          <div className="max-w-3xl mb-12 rounded-2xl border border-stone-200 bg-[#faf8f5] overflow-hidden">
            {[
              {
                label: 'Digitized & scanned',
                detail: `All ${formatStat(stats.pagesOcr)} pages, machine-readable`,
                cost: 'Done',
                muted: true,
              },
              {
                label: 'High-quality translation',
                detail: 'A premium AI model across the full corpus',
                cost: '~$7,000',
              },
              {
                label: 'Scholarly review',
                detail: 'Tibetan-literate validation of the result',
                cost: '~$3,000',
              },
            ].map((row) => (
              <div
                key={row.label}
                className="flex items-center justify-between gap-4 px-5 py-4 border-b border-stone-200/70"
              >
                <div>
                  <span className="block text-sm font-semibold text-stone-900">{row.label}</span>
                  <span className="block text-xs text-stone-500 mt-0.5">{row.detail}</span>
                </div>
                <span
                  className={`text-sm font-semibold whitespace-nowrap ${
                    row.muted ? 'text-stone-400' : 'text-stone-900'
                  }`}
                >
                  {row.cost}
                </span>
              </div>
            ))}
            <div className="flex items-center justify-between gap-4 px-5 py-4 bg-stone-900">
              <span className="text-sm font-semibold text-white">A faithful, citable edition</span>
              <span className="text-base font-bold text-accent-gold whitespace-nowrap">~$10,000</span>
            </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-10 lg:gap-16 items-start">
            <div>
              <h3 className="text-lg text-stone-900 mb-3 font-display">Make a gift</h3>
              <p className="text-stone-600 leading-relaxed mb-6 text-sm">
                Give now through one of the routes below, or use the form and we&apos;ll follow up
                personally.
              </p>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <OutboundLink
                  href={DONORPERFECT_URL}
                  surface="bhutan_library"
                  channel="naf_donorperfect"
                  className="bg-[#faf8f5] rounded-xl border border-stone-200 p-4 hover:border-stone-400 transition-colors block"
                >
                  <span className="block text-xs font-medium text-stone-400 uppercase tracking-wider mb-1">
                    US tax-deductible
                  </span>
                  <span className="block text-sm font-semibold text-stone-900">Donate via NAF</span>
                  <span className="block text-xs text-stone-500 mt-1">501(c)(3) public charity</span>
                </OutboundLink>
                <OutboundLink
                  href={EFM_STRIPE_URL}
                  surface="bhutan_library"
                  channel="efm_stripe"
                  className="bg-[#faf8f5] rounded-xl border border-stone-200 p-4 hover:border-stone-400 transition-colors block"
                >
                  <span className="block text-xs font-medium text-stone-400 uppercase tracking-wider mb-1">
                    International
                  </span>
                  <span className="block text-sm font-semibold text-stone-900">Donate via EFM</span>
                  <span className="block text-xs text-stone-500 mt-1">ANBI-registered (NL)</span>
                </OutboundLink>
                <div className="bg-[#faf8f5] rounded-xl border border-stone-200 p-4 sm:col-span-2">
                  <span className="block text-xs font-medium text-stone-400 uppercase tracking-wider mb-1">
                    Sponsor the campaign — wire, stock, or donor-advised fund
                  </span>
                  <OutboundLink
                    href={`mailto:${CONTACT_EMAIL}?subject=Bhutan%20Library%20Restoration%20%E2%80%94%20Donation%20Inquiry`}
                    surface="bhutan_library"
                    channel="email"
                    className="text-base font-semibold text-accent-rust hover:text-accent-gold-dark underline break-all select-all"
                  >
                    {CONTACT_EMAIL}
                  </OutboundLink>
                </div>
              </div>

              <p className="mt-5 text-xs text-stone-500 leading-relaxed">
                Source Library is a project of the{' '}
                <a
                  href="https://embassyofthefreemind.com"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-accent-rust hover:text-accent-gold-dark underline"
                >
                  Embassy of the Free Mind
                </a>{' '}
                (ANBI-registered, Amsterdam), with 501(c)(3) tax-deductible options for US donors.
              </p>
            </div>

            <DonationIntentionForm />
          </div>
        </div>
      </section>

      {/* Explore */}
      <section className="bg-gradient-to-b from-[#f6f3ee] to-[#f3ede6] py-12 md:py-16">
        <div className="px-6 md:px-12 max-w-5xl mx-auto">
          <h2 className="text-xl md:text-2xl text-stone-900 mb-6 font-display">
            Explore the collection
          </h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Link
              href="/collections/vajrayana"
              className="bg-white rounded-xl border border-stone-200 p-5 hover:border-stone-400 transition-colors block"
            >
              <span className="block text-base font-semibold text-stone-900 mb-1">
                Vajrayāna &amp; Tibetan Buddhism
              </span>
              <span className="block text-sm text-stone-500">
                Tantras, sādhanas, and commentaries of the diamond vehicle.
              </span>
            </Link>
            <Link
              href="/collections/bhutan"
              className="bg-white rounded-xl border border-stone-200 p-5 hover:border-stone-400 transition-colors block"
            >
              <span className="block text-base font-semibold text-stone-900 mb-1">Bhutan</span>
              <span className="block text-sm text-stone-500">
                Endangered manuscripts from the Bhutanese Buddhist tradition.
              </span>
            </Link>
          </div>
        </div>
      </section>

      {/* Credits — who digitized these */}
      <section className="bg-white py-12 md:py-16 border-t border-stone-200">
        <div className="px-6 md:px-12 max-w-3xl mx-auto">
          <h2 className="text-xl md:text-2xl text-stone-900 mb-3 font-display">Digitized by</h2>
          <p className="text-stone-600 leading-relaxed text-sm mb-6">
            These manuscripts were rescued from loss by the archives that scanned them. Source Library
            re-hosts and translates them with gratitude to:
          </p>
          <div className="space-y-4 text-sm">
            <div>
              <a
                href="https://eap.bl.uk"
                target="_blank"
                rel="noopener noreferrer"
                className="font-semibold text-stone-900 hover:text-accent-rust underline underline-offset-2"
              >
                British Library — Endangered Archives Programme
              </a>
              <p className="text-stone-500 leading-relaxed mt-1">
                The Bhutanese temple and monastery collections of Drametse &amp; Ogyen Choling
                (EAP105), Thadrak, Tshamdrak &amp; Nyephug (EAP310), and Gangtey (EAP039) — the bulk
                of this library.
              </p>
            </div>
            <div>
              <a
                href="https://www.bdrc.io"
                target="_blank"
                rel="noopener noreferrer"
                className="font-semibold text-stone-900 hover:text-accent-rust underline underline-offset-2"
              >
                Buddhist Digital Resource Center (BDRC)
              </a>
              <p className="text-stone-500 leading-relaxed mt-1">
                Canonical Tibetan works, including several of the texts in our translation benchmark.
              </p>
            </div>
            <div>
              <a
                href="https://archive.org"
                target="_blank"
                rel="noopener noreferrer"
                className="font-semibold text-stone-900 hover:text-accent-rust underline underline-offset-2"
              >
                Internet Archive
              </a>
            </div>
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="bg-white border-t border-stone-200 py-10">
        <div className="px-6 md:px-12 max-w-5xl mx-auto flex flex-col md:flex-row justify-between items-start md:items-center gap-3 text-stone-500 text-sm">
          <span>&copy; {new Date().getFullYear()} Source Library — Embassy of the Free Mind</span>
          <div className="flex flex-wrap items-center gap-4">
            <Link href="/" className="hover:text-stone-900 transition-colors">
              Home
            </Link>
            <Link href="/support" className="hover:text-stone-900 transition-colors">
              Support
            </Link>
            <a
              href={`mailto:${CONTACT_EMAIL}`}
              className="text-accent-rust hover:text-accent-gold-dark transition-colors"
            >
              {CONTACT_EMAIL}
            </a>
          </div>
        </div>
      </footer>
    </div>
  );
}
