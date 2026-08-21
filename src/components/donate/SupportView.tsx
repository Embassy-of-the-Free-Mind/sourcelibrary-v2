import Link from 'next/link';
import SiteHeader from '@/components/layout/SiteHeader';
import DonationIntentionForm from '@/components/donate/DonationIntentionForm';
import QuickSubscribe from '@/components/donate/QuickSubscribe';
import GiveForm from '@/components/donate/GiveForm';
import { getReadDb } from '@/lib/mongodb';
import type { Locale } from '@/lib/i18n';

// The two payment destinations, the NAF-form ambiguity, and the amount-carrying
// URL params all live in src/lib/give-routes.ts now — this page and /give mount
// the same <GiveForm>, so neither holds its own copy of a destination URL.
const CONTACT_EMAIL = 'team@sourcelibrary.org';

// Hand-coloured volvelle (perpetual calendar wheel) from the astrology collection.
const HERO_IMAGE =
  'https://images.sourcelibrary.org/gallery/6990688d249ce014347d6e76/6990688d249ce014347d6eb2-0.jpg';

export interface SupportStats {
  totalBooks: number;
  firstTranslations: number;
  pagesTranslated: number;
}

export function formatStat(n: number, locale: Locale = 'en'): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`.replace('.0K', 'K');
  return n.toLocaleString(locale === 'es' ? 'es-ES' : 'en-US');
}

export async function fetchSupportStats(): Promise<SupportStats> {
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

interface SupportStrings {
  heroTitle: string;
  heroLeadPre: string;
  heroLeadPost: string;
  statBooks: string;
  statPages: string;
  statFirst: string;
  giveTitle: string;
  giveLead: string;
  usLabel: string; usTitle: string; usSub: string;
  intlLabel: string; intlTitle: string; intlSub: string;
  largeLabel: string;
  taxNote: string;
  businessPre: string; businessLink: string; businessPost: string;
  whereTitle: string;
  where: { title: string; text: string }[];
  followTitle: string;
  followLead: string;
  footerPre: string; participate: string; footerPost: string;
  home: string;
}

const STRINGS: Record<Locale, SupportStrings> = {
  en: {
    heroTitle: 'Support Source Library',
    heroLeadPre: 'Consider making a gift to support our work to digitize, translate, and freely publish rare historical texts. Source Library is a project of the',
    heroLeadPost: '(ANBI-registered) in Amsterdam, with 501(c)(3) tax-deductible options.',
    statBooks: 'books digitized',
    statPages: 'pages translated',
    statFirst: 'first-ever English translations',
    giveTitle: 'Make a Gift',
    giveLead: "Pick a route below to give now, or use the form and we'll follow up personally. Every gift, of any size, makes a difference.",
    usLabel: 'US tax-deductible', usTitle: 'Netherland-America Foundation', usSub: '501(c)(3) public charity',
    intlLabel: 'International', intlTitle: 'Donate via EFM', intlSub: 'ANBI-registered (NL)',
    largeLabel: 'Large gifts — wire, stock, or donor-advised fund',
    taxNote: 'US donors giving through the Netherland-America Foundation (NAF) receive full 501(c)(3) tax benefits, with receipts issued by NAF. International gifts go to Stichting Het Wereldhart (Cultural ANBI), where Stripe issues the receipt automatically.',
    businessPre: 'Business owners:', businessLink: 'giving through your company', businessPost: 'is usually cheaper than giving personally.',
    whereTitle: 'Where your support goes',
    where: [
      { title: 'Digitization', text: 'High-resolution scanning of fragile manuscripts and rare printed books.' },
      { title: 'Translation', text: 'AI-assisted translation of Latin, Greek, and German, with scholarly review. The largest cost.' },
      { title: 'Open platform', text: 'A free reading interface with bilingual pages, search, and image galleries.' },
    ],
    followTitle: 'Follow the work',
    followLead: "Not ready to give? Leave your email and we'll send word as new first-ever translations come online. No account needed.",
    footerPre: 'Not everyone gives money — some give time.',
    participate: 'Participate',
    footerPost: 'as a translator, reviewer, or volunteer.',
    home: 'Home',
  },
  es: {
    heroTitle: 'Apoya a Source Library',
    heroLeadPre: 'Considera hacer una donación para apoyar nuestro trabajo de digitalizar, traducir y publicar gratuitamente textos históricos raros. Source Library es un proyecto de la',
    heroLeadPost: '(registrada como ANBI) en Ámsterdam, con opciones deducibles de impuestos 501(c)(3).',
    statBooks: 'libros digitalizados',
    statPages: 'páginas traducidas',
    statFirst: 'primeras traducciones al inglés',
    giveTitle: 'Haz una donación',
    giveLead: 'Elige una opción abajo para donar ahora, o usa el formulario y te contactaremos personalmente. Cada donación, de cualquier tamaño, marca la diferencia.',
    usLabel: 'Deducible en EE. UU.', usTitle: 'Netherland-America Foundation', usSub: 'Entidad benéfica 501(c)(3)',
    intlLabel: 'Internacional', intlTitle: 'Donar vía EFM', intlSub: 'Registrada ANBI (NL)',
    largeLabel: 'Donaciones grandes — transferencia, acciones o fondo asesorado',
    taxNote: 'Los donantes de EE. UU. que donan a través de la Netherland-America Foundation (NAF) reciben beneficios fiscales 501(c)(3) completos, con recibos emitidos por la NAF. Las donaciones internacionales van a Stichting Het Wereldhart (ANBI Cultural), donde Stripe emite el recibo automáticamente.',
    businessPre: 'Para empresas:', businessLink: 'donar a través de tu empresa', businessPost: 'suele ser más económico que donar personalmente.',
    whereTitle: 'Adónde va tu apoyo',
    where: [
      { title: 'Digitalización', text: 'Escaneo de alta resolución de manuscritos frágiles y libros impresos raros.' },
      { title: 'Traducción', text: 'Traducción asistida por IA del latín, griego y alemán, con revisión académica. El mayor coste.' },
      { title: 'Plataforma abierta', text: 'Una interfaz de lectura gratuita con páginas bilingües, búsqueda y galerías de imágenes.' },
    ],
    followTitle: 'Sigue el trabajo',
    followLead: '¿Aún no quieres donar? Déjanos tu correo y te avisaremos cuando salgan nuevas primeras traducciones. No necesitas cuenta.',
    footerPre: 'No todos donan dinero — algunos donan tiempo.',
    participate: 'Participa',
    footerPost: 'como traductor, revisor o voluntario.',
    home: 'Inicio',
  },
};

export default function SupportView({
  stats,
  locale = 'en',
}: {
  stats: SupportStats;
  locale?: Locale;
}) {
  const s = STRINGS[locale];
  const homeHref = locale === 'es' ? '/es' : '/';
  return (
    <div className="min-h-screen">
      {/* Hero */}
      <section className="relative overflow-hidden bg-stone-950">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={HERO_IMAGE} alt="" aria-hidden="true" className="absolute inset-0 w-full h-full object-cover object-center opacity-90" />
        <div className="absolute inset-0 bg-stone-950/60" />
        <div className="absolute inset-0 bg-gradient-to-t from-stone-950/90 via-stone-950/50 to-stone-950/70" />

        <div className="relative">
          <SiteHeader variant="transparent" homeLocale={locale} />

          <div className="px-6 md:px-12 max-w-5xl mx-auto pt-12 pb-14 md:pt-20 md:pb-20">
            <h1 className="text-3xl md:text-4xl lg:text-5xl text-white mb-4 leading-tight font-display drop-shadow-sm">
              {s.heroTitle}
            </h1>
            <p className="text-lg md:text-xl text-white/85 leading-relaxed max-w-3xl mb-8">
              {s.heroLeadPre}{' '}
              <a href="https://embassyofthefreemind.com" target="_blank" rel="noopener noreferrer" className="text-accent-gold hover:text-white underline underline-offset-2">
                Embassy of the Free Mind
              </a>{' '}
              {s.heroLeadPost}
            </p>

            <div className="flex flex-wrap gap-x-10 gap-y-4 text-white/80">
              <span className="text-sm md:text-base">
                <strong className="font-display text-white text-lg md:text-xl">{formatStat(stats.totalBooks, locale)}</strong> {s.statBooks}
              </span>
              <span className="text-sm md:text-base">
                <strong className="font-display text-white text-lg md:text-xl">{formatStat(stats.pagesTranslated, locale)}</strong> {s.statPages}
              </span>
              <span className="text-sm md:text-base">
                <strong className="font-display text-white text-lg md:text-xl">{formatStat(stats.firstTranslations, locale)}</strong> {s.statFirst}
              </span>
            </div>
          </div>
        </div>
      </section>

      {/* Give */}
      <section className="bg-white py-12 md:py-16 border-t border-stone-200">
        <div className="px-6 md:px-12 max-w-5xl mx-auto">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-10 lg:gap-16 items-start">
            <div>
              <h2 className="text-2xl md:text-3xl text-stone-900 mb-3 leading-tight font-display">{s.giveTitle}</h2>
              <p className="text-stone-600 leading-relaxed mb-6">{s.giveLead}</p>

              {/* The same picker /give serves, so the fast path and the long
                  path can never disagree about amounts, routes, or which NAF
                  form is the Source Library one. This replaced a pair of cards
                  that linked out with no amount attached, leaving the donor to
                  meet a $0.00 field on arrival — the anchor is the strongest
                  lever on gift size and we were forfeiting it. */}
              {/* Hardcoded `international`, NOT resolved from the request
                  country — this page is edge-cached for 24h by the static-pages
                  rule in next.config.ts, so any per-visitor default would be
                  frozen to whoever warmed the cache (measured: cf-cache-status
                  HIT, age 1202, on a page marked force-dynamic). `/give` is the
                  country-aware surface and is not edge-cached; here the donor
                  gets a visible "Giving from the United States?" switch. */}
              <GiveForm defaultRoute="international" locale={locale} surface="support" contactEmail={CONTACT_EMAIL} />

              <p className="mt-5 text-xs text-stone-500 leading-relaxed">{s.taxNote}</p>
              <p className="mt-2 text-xs text-stone-500 leading-relaxed">
                <span className="font-semibold text-stone-600">{s.businessPre}</span>{' '}
                <Link href={locale === 'es' ? '/es/support/business' : '/support/business'} className="text-accent-rust underline hover:text-accent-gold-dark">
                  {s.businessLink}
                </Link>{' '}
                {s.businessPost}
              </p>
            </div>

            <DonationIntentionForm />
          </div>
        </div>
      </section>

      {/* Where it goes */}
      <section className="bg-gradient-to-b from-[#f6f3ee] to-[#f3ede6] py-12 md:py-16">
        <div className="px-6 md:px-12 max-w-5xl mx-auto">
          <h2 className="text-xl md:text-2xl text-stone-900 mb-6 font-display">{s.whereTitle}</h2>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-6">
            {s.where.map((item) => (
              <div key={item.title}>
                <h3 className="text-base font-semibold text-stone-900 mb-1.5">{item.title}</h3>
                <p className="text-stone-600 text-sm leading-relaxed">{item.text}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Follow the work */}
      <section className="bg-white border-t border-stone-200 py-12 md:py-16">
        <div className="px-6 md:px-12 max-w-5xl mx-auto">
          <h2 className="text-xl md:text-2xl text-stone-900 mb-2 font-display">{s.followTitle}</h2>
          <p className="text-stone-600 text-sm leading-relaxed mb-6 max-w-md">{s.followLead}</p>
          <QuickSubscribe source="support" />
        </div>
      </section>

      {/* Footer */}
      <footer className="bg-white border-t border-stone-200 py-10">
        <div className="px-6 md:px-12 max-w-5xl mx-auto">
          <p className="text-stone-600 text-sm mb-6">
            {s.footerPre}{' '}
            <Link href="/contribute" className="text-accent-rust hover:text-accent-gold-dark underline font-medium">
              {s.participate}
            </Link>{' '}
            {s.footerPost}
          </p>
          <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-3 text-stone-500 text-sm">
            <span>&copy; {new Date().getFullYear()} Source Library — Embassy of the Free Mind</span>
            <div className="flex flex-wrap items-center gap-4">
              <Link href={homeHref} className="hover:text-stone-900 transition-colors">{s.home}</Link>
              <Link href="/licensing" className="hover:text-stone-900 transition-colors">
                Public domain originals · CC BY-SA translations
              </Link>
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
