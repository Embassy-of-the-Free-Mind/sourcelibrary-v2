import Link from 'next/link';
import { Metadata } from 'next';
import SiteHeader from '@/components/layout/SiteHeader';
import DonationIntentionForm from '@/components/donate/DonationIntentionForm';
import { getReadDb } from '@/lib/mongodb';

export const revalidate = 3600;
export const maxDuration = 60;

export const metadata: Metadata = {
  title: 'The Tibetan & Bhutanese Buddhist Library — Source Library',
  description:
    'A restoration of 1,473 endangered Tibetan and Bhutanese Buddhist manuscripts — nearly 290,000 pages — made faithfully readable in English. A digital offering to a living tradition.',
  alternates: { canonical: '/tibet' },
  openGraph: {
    title: 'The Tibetan & Bhutanese Buddhist Library',
    description:
      '1,473 sacred manuscripts, nearly 290,000 pages, restored to a faithful English reading edition. Help us complete the work.',
    url: '/tibet',
    type: 'article',
    images: [{ url: 'https://images.sourcelibrary.org/pages/69e787904a6785cfd60cc297/0095.jpg' }],
  },
  twitter: { card: 'summary_large_image', title: 'The Tibetan & Bhutanese Buddhist Library' },
};

const EFM_STRIPE_URL = 'https://donate.stripe.com/9B67sLbO1bOg2GxfxP9fW08';
const DONORPERFECT_URL = 'https://form-renderer-app.donorperfect.io/give/naf/embassyofthefreemind';
const CONTACT_EMAIL = 'derek@sourcelibrary.org';

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
  const fallback = { books: 1473, pagesOcr: 289989, pagesTranslated: 273500 };
  try {
    const db = await getReadDb();
    const books = db.collection('books');
    const match = { language: 'Tibetan', visible: true, pages_translated: { $gt: 0 } };
    const [count, agg] = await Promise.all([
      books.countDocuments(match, { maxTimeMS: 15000 }),
      books
        .aggregate(
          [
            { $match: match },
            {
              $group: {
                _id: null,
                ocr: { $sum: { $ifNull: ['$pages_ocr', 0] } },
                translated: { $sum: { $ifNull: ['$pages_translated', 0] } },
              },
            },
          ],
          { maxTimeMS: 15000 },
        )
        .toArray(),
    ]);
    return {
      books: count || fallback.books,
      pagesOcr: agg[0]?.ocr || fallback.pagesOcr,
      pagesTranslated: agg[0]?.translated || fallback.pagesTranslated,
    };
  } catch {
    return fallback;
  }
}

export default async function TibetPage() {
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
              A Restoration Campaign
            </p>
            <h1 className="text-3xl md:text-5xl lg:text-6xl text-white mb-5 leading-[1.1] font-display drop-shadow-sm">
              The Tibetan &amp; Bhutanese
              <br className="hidden md:block" /> Buddhist Library
            </h1>
            <p className="text-lg md:text-xl text-white/85 leading-relaxed max-w-3xl mb-8">
              {formatStat(stats.books)} sacred manuscripts — nearly{' '}
              {formatStat(stats.pagesOcr)} pages of an endangered tradition — made readable in
              English for the first time. Now we are going back, folio by folio, to make them{' '}
              <em className="text-white not-italic font-display">faithful</em>.
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
                <strong className="font-display text-white text-lg md:text-xl">~99%</strong>{' '}
                translated to English
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
                href="/collections/vajrayana"
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
              <strong>hand-copied pecha</strong> — loose-leaf folios of Vajrayāna and Bhutanese
              Buddhism, written by hand and digitized through endangered-archives efforts. Ninety-six
              percent of the collection is handwritten. Many of these manuscripts survive in few
              other places on earth.
            </p>
            <p>
              We have already made every one of them machine-readable and translated into English —
              a reader anywhere in the world can open these texts today. That is real, and it
              matters. But for sacred texts, making them <em>readable</em> and making them{' '}
              <em>trustworthy</em> are not the same thing. A garbled line in a Dzogchen
              pith-instruction or a Madhyamaka commentary is not a typo — it is a distortion of the
              teaching.
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

      {/* Readable is not faithful — the work */}
      <section className="bg-gradient-to-b from-[#f6f3ee] to-[#f3ede6] py-14 md:py-20">
        <div className="px-6 md:px-12 max-w-3xl mx-auto">
          <h2 className="text-2xl md:text-3xl text-stone-900 mb-5 font-display leading-tight">
            Readable is not the same as faithful
          </h2>
          <div className="prose-content text-stone-700 leading-relaxed space-y-4 text-[1.05rem]">
            <p>
              To make 290,000 pages readable quickly, we used a fast, inexpensive AI model. On clean
              printed pages it does well. But on the handwritten manuscripts that make up the bulk of
              this collection, a meaningful share of pages came out wrong — and wrong in a way that{' '}
              <em>reads</em> convincingly.
            </p>
            <p>
              We audited it carefully: three independent AI reviewers examined the page images
              against the transcriptions, alongside a corpus-wide scan. The failures were real and
              specific — pages where the model silently repeated one folio across several, or
              transcribed Tibetan in the wrong alphabet entirely. These are exactly the errors that a
              casual reader could never catch.
            </p>
            <p>
              The good news: we have already <strong>proven the fix</strong>. Separating each folio
              and re-reading the hard pages with a stronger model corrects them. The plan is a careful
              second pass — re-transcribe, re-translate, and have Tibetan-literate reviewers validate
              the result — so that every page can be quoted with confidence.
            </p>
          </div>
        </div>
      </section>

      {/* The offering */}
      <section className="bg-stone-950 py-14 md:py-20">
        <div className="px-6 md:px-12 max-w-3xl mx-auto text-center">
          <h2 className="text-2xl md:text-3xl text-white mb-5 font-display leading-tight">
            An offering to a living tradition
          </h2>
          <p className="text-white/80 leading-relaxed text-[1.05rem] max-w-2xl mx-auto">
            These teachings belong to a living lineage and its keepers. Our aim is to return them —
            faithfully, freely, and openly — to the Tibetan Buddhist community and to scholars
            everywhere, in honor of His Holiness the Dalai Lama and all who have preserved these
            words across centuries of exile and care.
          </p>
        </div>
      </section>

      {/* Support */}
      <section id="support" className="bg-white py-14 md:py-20 border-t border-stone-200 scroll-mt-4">
        <div className="px-6 md:px-12 max-w-5xl mx-auto">
          <div className="max-w-3xl mb-10">
            <h2 className="text-2xl md:text-3xl text-stone-900 mb-3 font-display leading-tight">
              Help us complete the work
            </h2>
            <p className="text-stone-600 leading-relaxed text-[1.05rem]">
              We are raising <strong>$10,000</strong> to fund the faithful restoration of this entire
              corpus — re-transcribing and re-translating every manuscript through a stronger,
              carefully validated pipeline, with Tibetan-literate scholarly review. Every gift, of any
              size, moves a sacred text closer to being read as it was written.
            </p>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-10 lg:gap-16 items-start">
            <div>
              <h3 className="text-lg text-stone-900 mb-3 font-display">Make a gift</h3>
              <p className="text-stone-600 leading-relaxed mb-6 text-sm">
                Give now through one of the routes below, or use the form and we&apos;ll follow up
                personally.
              </p>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <a
                  href={DONORPERFECT_URL}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="bg-[#faf8f5] rounded-xl border border-stone-200 p-4 hover:border-stone-400 transition-colors block"
                >
                  <span className="block text-xs font-medium text-stone-400 uppercase tracking-wider mb-1">
                    US tax-deductible
                  </span>
                  <span className="block text-sm font-semibold text-stone-900">Donate via NAF</span>
                  <span className="block text-xs text-stone-500 mt-1">501(c)(3) public charity</span>
                </a>
                <a
                  href={EFM_STRIPE_URL}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="bg-[#faf8f5] rounded-xl border border-stone-200 p-4 hover:border-stone-400 transition-colors block"
                >
                  <span className="block text-xs font-medium text-stone-400 uppercase tracking-wider mb-1">
                    International
                  </span>
                  <span className="block text-sm font-semibold text-stone-900">Donate via EFM</span>
                  <span className="block text-xs text-stone-500 mt-1">ANBI-registered (NL)</span>
                </a>
                <div className="bg-[#faf8f5] rounded-xl border border-stone-200 p-4 sm:col-span-2">
                  <span className="block text-xs font-medium text-stone-400 uppercase tracking-wider mb-1">
                    Sponsor the campaign — wire, stock, or donor-advised fund
                  </span>
                  <a
                    href={`mailto:${CONTACT_EMAIL}?subject=Tibetan%20Library%20Restoration%20%E2%80%94%20Donation%20Inquiry`}
                    className="text-base font-semibold text-accent-rust hover:text-accent-gold-dark underline break-all select-all"
                  >
                    {CONTACT_EMAIL}
                  </a>
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
