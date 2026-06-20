import Link from 'next/link';
import { Metadata } from 'next';
import SiteHeader from '@/components/layout/SiteHeader';
import DonationIntentionForm from '@/components/donate/DonationIntentionForm';
import { getReadDb } from '@/lib/mongodb';

export const revalidate = 600;
export const maxDuration = 60;

export const metadata: Metadata = {
  title: 'Support — Source Library',
  description: 'Support the digitization and translation of rare historical texts from the Bibliotheca Philosophica Hermetica.',
  alternates: { canonical: '/support' },
};

const EFM_STRIPE_URL = 'https://donate.stripe.com/9B67sLbO1bOg2GxfxP9fW08';
const DONORPERFECT_URL = 'https://form-renderer-app.donorperfect.io/give/naf/embassyofthefreemind';
const CONTACT_EMAIL = 'derek@sourcelibrary.org';

// Hand-coloured volvelle (perpetual calendar wheel) — a vivid, instantly
// recognizable engraving from the astrology collection.
const HERO_IMAGE =
  'https://3kwioilsplnmnkv8.public.blob.vercel-storage.com/gallery/6990688d249ce014347d6e76/6990688d249ce014347d6eb2-0.jpg';

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
    return { totalBooks: 10675, firstTranslations: 5607, pagesTranslated: 2400000 };
  }
}

export default async function SupportPage() {
  const stats = await fetchStats();

  return (
    <div className="min-h-screen">
      {/* Hero — image-backed, the ask up front */}
      <section className="relative overflow-hidden bg-stone-950">
        {/* Background engraving */}
        <img
          src={HERO_IMAGE}
          alt=""
          aria-hidden="true"
          className="absolute inset-0 w-full h-full object-cover object-center opacity-90"
        />
        {/* Readability overlays: a base wash plus a stronger bottom gradient */}
        <div className="absolute inset-0 bg-stone-950/60" />
        <div className="absolute inset-0 bg-gradient-to-t from-stone-950/90 via-stone-950/50 to-stone-950/70" />

        <div className="relative">
          <SiteHeader variant="transparent" />

          <div className="px-6 md:px-12 max-w-5xl mx-auto pt-12 pb-14 md:pt-20 md:pb-20">
            <h1 className="text-3xl md:text-4xl lg:text-5xl text-white mb-4 leading-tight font-display drop-shadow-sm">
              Support Source Library
            </h1>
            <p className="text-lg md:text-xl text-white/85 leading-relaxed max-w-3xl mb-8">
              Consider making a gift to support our work to digitize, translate, and freely publish rare historical texts. Source Library is a project of the{' '}
              <a
                href="https://embassyofthefreemind.com"
                target="_blank"
                rel="noopener noreferrer"
                className="text-accent-gold hover:text-white underline underline-offset-2"
              >
                Embassy of the Free Mind
              </a>{' '}
              (ANBI-registered) in Amsterdam, with 501(c)(3) tax-deductible options.
            </p>

            {/* Inline stats */}
            <div className="flex flex-wrap gap-x-10 gap-y-4 text-white/80">
              <span className="text-sm md:text-base">
                <strong className="font-display text-white text-lg md:text-xl">{formatStat(stats.totalBooks)}</strong> books digitized
              </span>
              <span className="text-sm md:text-base">
                <strong className="font-display text-white text-lg md:text-xl">{formatStat(stats.pagesTranslated)}</strong> pages translated
              </span>
              <span className="text-sm md:text-base">
                <strong className="font-display text-white text-lg md:text-xl">{formatStat(stats.firstTranslations)}</strong> first-ever English translations
              </span>
            </div>
          </div>
        </div>
      </section>

      {/* Give — options + form, the centerpiece */}
      <section className="bg-white py-12 md:py-16 border-t border-stone-200">
        <div className="px-6 md:px-12 max-w-5xl mx-auto">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-10 lg:gap-16 items-start">
            <div>
              <h2 className="text-2xl md:text-3xl text-stone-900 mb-3 leading-tight font-display">
                Make a Gift
              </h2>
              <p className="text-stone-600 leading-relaxed mb-6">
                Pick a route below to give now, or use the form and we&apos;ll follow up personally. Every gift, of any size, makes a difference.
              </p>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <a
                  href={DONORPERFECT_URL}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="bg-[#faf8f5] rounded-xl border border-stone-200 p-4 hover:border-stone-400 transition-colors block"
                >
                  <span className="block text-xs font-medium text-stone-400 uppercase tracking-wider mb-1">US tax-deductible</span>
                  <span className="block text-sm font-semibold text-stone-900">Donate via NAF</span>
                  <span className="block text-xs text-stone-500 mt-1">501(c)(3) public charity</span>
                </a>
                <a
                  href={EFM_STRIPE_URL}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="bg-[#faf8f5] rounded-xl border border-stone-200 p-4 hover:border-stone-400 transition-colors block"
                >
                  <span className="block text-xs font-medium text-stone-400 uppercase tracking-wider mb-1">International</span>
                  <span className="block text-sm font-semibold text-stone-900">Donate via EFM</span>
                  <span className="block text-xs text-stone-500 mt-1">ANBI-registered (NL)</span>
                </a>
                <div className="bg-[#faf8f5] rounded-xl border border-stone-200 p-4 sm:col-span-2">
                  <span className="block text-xs font-medium text-stone-400 uppercase tracking-wider mb-1">Large gifts — wire, stock, or donor-advised fund</span>
                  <a
                    href={`mailto:${CONTACT_EMAIL}?subject=Source%20Library%20%E2%80%94%20Donation%20Inquiry`}
                    className="text-base font-semibold text-accent-rust hover:text-accent-gold-dark underline break-all select-all"
                  >
                    {CONTACT_EMAIL}
                  </a>
                </div>
              </div>

              <p className="mt-5 text-xs text-stone-500 leading-relaxed">
                US donors giving through the Netherland-America Foundation receive full 501(c)(3) tax benefits. Receipts are issued automatically via Stripe or on request.
              </p>
            </div>

            <DonationIntentionForm />
          </div>
        </div>
      </section>

      {/* Where it goes — one tight strip */}
      <section className="bg-gradient-to-b from-[#f6f3ee] to-[#f3ede6] py-12 md:py-16">
        <div className="px-6 md:px-12 max-w-5xl mx-auto">
          <h2 className="text-xl md:text-2xl text-stone-900 mb-6 font-display">Where your support goes</h2>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-6">
            {[
              { title: 'Digitization', text: 'High-resolution scanning of fragile manuscripts and rare printed books.' },
              { title: 'Translation', text: 'AI-assisted translation of Latin, Greek, and German, with scholarly review. The largest cost.' },
              { title: 'Open platform', text: 'A free reading interface with bilingual pages, search, and image galleries.' },
            ].map((item) => (
              <div key={item.title}>
                <h3 className="text-base font-semibold text-stone-900 mb-1.5">{item.title}</h3>
                <p className="text-stone-600 text-sm leading-relaxed">{item.text}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="bg-white border-t border-stone-200 py-10">
        <div className="px-6 md:px-12 max-w-5xl mx-auto">
          <p className="text-stone-600 text-sm mb-6">
            Not everyone gives money — some give time.{' '}
            <Link href="/contribute" className="text-accent-rust hover:text-accent-gold-dark underline font-medium">
              Participate
            </Link>{' '}
            as a translator, reviewer, or volunteer.
          </p>
          <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-3 text-stone-500 text-sm">
            <span>&copy; {new Date().getFullYear()} Source Library — Embassy of the Free Mind</span>
            <div className="flex flex-wrap items-center gap-4">
              <Link href="/" className="hover:text-stone-900 transition-colors">Home</Link>
              <span>CC0 Public Domain</span>
              <a href={`mailto:${CONTACT_EMAIL}`} className="text-accent-rust hover:text-accent-gold-dark transition-colors">
                {CONTACT_EMAIL}
              </a>
            </div>
          </div>
        </div>
      </footer>
    </div>
  );
}
