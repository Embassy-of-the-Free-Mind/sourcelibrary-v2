import Link from 'next/link';
import SiteHeader from '@/components/layout/SiteHeader';
import DonationIntentionForm from '@/components/donate/DonationIntentionForm';
import QuickSubscribe from '@/components/donate/QuickSubscribe';
import { getReadDb } from '@/lib/mongodb';
import { SUPPORT_STRINGS } from '@/lib/funnel-i18n';
import type { Locale } from '@/lib/i18n';

const EFM_STRIPE_URL = 'https://donate.stripe.com/9B67sLbO1bOg2GxfxP9fW08';
const DONORPERFECT_URL = 'https://form-renderer-app.donorperfect.io/give/naf/embassyofthefreemind';
const CONTACT_EMAIL = 'derek@sourcelibrary.org';

// Hand-coloured volvelle (perpetual calendar wheel) — a vivid, instantly
// recognizable engraving from the astrology collection.
const HERO_IMAGE =
  'https://3kwioilsplnmnkv8.public.blob.vercel-storage.com/gallery/6990688d249ce014347d6e76/6990688d249ce014347d6eb2-0.jpg';

function formatStat(n: number, locale: Locale): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`.replace('.0K', 'K');
  return n.toLocaleString(locale === 'es' ? 'es-ES' : 'en-US');
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

/** Shared Support page body. `/support` renders it `en`; `/es/support` renders it `es`. */
export default async function SupportView({ locale = 'en' }: { locale?: Locale }) {
  const stats = await fetchStats();
  const t = SUPPORT_STRINGS[locale];

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
              {t.heroTitle}
            </h1>
            <p className="text-lg md:text-xl text-white/85 leading-relaxed max-w-3xl mb-8">
              {t.heroLeadBeforeLink}
              <a
                href="https://embassyofthefreemind.com"
                target="_blank"
                rel="noopener noreferrer"
                className="text-accent-gold hover:text-white underline underline-offset-2"
              >
                Embassy of the Free Mind
              </a>
              {t.heroLeadAfterLink}
            </p>

            {/* Inline stats */}
            <div className="flex flex-wrap gap-x-10 gap-y-4 text-white/80">
              <span className="text-sm md:text-base">
                <strong className="font-display text-white text-lg md:text-xl">{formatStat(stats.totalBooks, locale)}</strong> {t.statBooks}
              </span>
              <span className="text-sm md:text-base">
                <strong className="font-display text-white text-lg md:text-xl">{formatStat(stats.pagesTranslated, locale)}</strong> {t.statPages}
              </span>
              <span className="text-sm md:text-base">
                <strong className="font-display text-white text-lg md:text-xl">{formatStat(stats.firstTranslations, locale)}</strong> {t.statFirst}
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
                {t.giftTitle}
              </h2>
              <p className="text-stone-600 leading-relaxed mb-6">
                {t.giftLead}
              </p>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <a
                  href={DONORPERFECT_URL}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="bg-[#faf8f5] rounded-xl border border-stone-200 p-4 hover:border-stone-400 transition-colors block"
                >
                  <span className="block text-xs font-medium text-stone-400 uppercase tracking-wider mb-1">{t.nafKicker}</span>
                  <span className="block text-sm font-semibold text-stone-900">{t.nafTitle}</span>
                  <span className="block text-xs text-stone-500 mt-1">{t.nafSub}</span>
                </a>
                <a
                  href={EFM_STRIPE_URL}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="bg-[#faf8f5] rounded-xl border border-stone-200 p-4 hover:border-stone-400 transition-colors block"
                >
                  <span className="block text-xs font-medium text-stone-400 uppercase tracking-wider mb-1">{t.intlKicker}</span>
                  <span className="block text-sm font-semibold text-stone-900">{t.efmTitle}</span>
                  <span className="block text-xs text-stone-500 mt-1">{t.efmSub}</span>
                </a>
                <div className="bg-[#faf8f5] rounded-xl border border-stone-200 p-4 sm:col-span-2">
                  <span className="block text-xs font-medium text-stone-400 uppercase tracking-wider mb-1">{t.largeKicker}</span>
                  <a
                    href={`mailto:${CONTACT_EMAIL}?subject=Source%20Library%20%E2%80%94%20Donation%20Inquiry`}
                    className="text-base font-semibold text-accent-rust hover:text-accent-gold-dark underline break-all select-all"
                  >
                    {CONTACT_EMAIL}
                  </a>
                </div>
              </div>

              <p className="mt-5 text-xs text-stone-500 leading-relaxed">
                {t.taxNote}
              </p>
            </div>

            <DonationIntentionForm locale={locale} />
          </div>
        </div>
      </section>

      {/* Where it goes — one tight strip */}
      <section className="bg-gradient-to-b from-[#f6f3ee] to-[#f3ede6] py-12 md:py-16">
        <div className="px-6 md:px-12 max-w-5xl mx-auto">
          <h2 className="text-xl md:text-2xl text-stone-900 mb-6 font-display">{t.whereTitle}</h2>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-6">
            {t.whereCards.map((item) => (
              <div key={item.title}>
                <h3 className="text-base font-semibold text-stone-900 mb-1.5">{item.title}</h3>
                <p className="text-stone-600 text-sm leading-relaxed">{item.text}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Not ready to give? Follow the work. */}
      <section className="bg-white border-t border-stone-200 py-12 md:py-16">
        <div className="px-6 md:px-12 max-w-5xl mx-auto">
          <h2 className="text-xl md:text-2xl text-stone-900 mb-2 font-display">{t.followTitle}</h2>
          <p className="text-stone-600 text-sm leading-relaxed mb-6 max-w-md">
            {t.followLead}
          </p>
          <QuickSubscribe source="support" locale={locale} />
        </div>
      </section>

      {/* Footer */}
      <footer className="bg-white border-t border-stone-200 py-10">
        <div className="px-6 md:px-12 max-w-5xl mx-auto">
          <p className="text-stone-600 text-sm mb-6">
            {t.footerLeadBeforeLink}
            <Link href="/contribute" className="text-accent-rust hover:text-accent-gold-dark underline font-medium">
              {t.footerParticipate}
            </Link>
            {t.footerLeadAfterLink}
          </p>
          <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-3 text-stone-500 text-sm">
            <span>&copy; {new Date().getFullYear()} {t.footerOrg}</span>
            <div className="flex flex-wrap items-center gap-4">
              <Link href={locale === 'es' ? '/es' : '/'} className="hover:text-stone-900 transition-colors">{t.home}</Link>
              <span>{t.cc0}</span>
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
