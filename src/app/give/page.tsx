import { Metadata } from 'next';
import { headers } from 'next/headers';
import Link from 'next/link';
import SiteHeader from '@/components/layout/SiteHeader';
import GiveForm from '@/components/donate/GiveForm';
import { defaultRouteForCountry } from '@/lib/give-routes';

/**
 * The short path to giving: the ask and the case for it on one page, no database.
 *
 * This is the header's "Donate" destination and the target for any printed QR
 * code, which is why the URL is one word. `/support` still exists and still
 * makes the longer case — it mounts the same <GiveForm> so the two can't drift.
 *
 * Layout: on a wide screen the form sits beside the case and stays in view; on a
 * phone the headline and form come first and the case follows, so nobody has to
 * scroll past an argument to reach the button.
 *
 * NO DATA FETCHING, deliberately. Every other surface can degrade; the page that
 * takes money cannot. The figures below are therefore constants, measured on
 * 2026-10-29 and rounded DOWN so they stay true as the library grows:
 *   books live       70,970  (visible && pages_count > 0)
 *   first English     6,556  (is_first_translation && pages_translated > 0)
 *   /book/* views   302,821  (analytics_pageviews, 30 days to 2026-10-29)
 * Re-measure before changing any of these. No per-book cost figure on purpose:
 * model cost alone (under a dollar a book) tells a donor the work is nearly free.
 * The only server work is reading the request country to pick a default route,
 * which cannot fail: an unknown country is a valid answer (defaultRouteForCountry).
 *
 * No `openGraph` block here on purpose. Defining one would REPLACE the root
 * layout's entire openGraph object including its images, shipping a card with no
 * image at all — the failure that hit three surfaces in one day (PRs #3149/
 * #3151/#3152). Inheriting the root block is correct until this page earns a
 * bespoke card, which would then also need its own `twitter.images`.
 */

export const metadata: Metadata = {
  title: 'Donate | Source Library',
  description:
    'Help put rare books on alchemy, astrology, magic and early science into English, free for anyone to read. Give in two taps, US tax-deductible or international.',
  alternates: { canonical: '/give' },
};

// Apian's eclipse dial, the Astronomicum Caesareum (1540), whose first English
// translation is on the site. Checked by eye 2026-10-29.
const FEATURE_IMAGE =
  'https://images.sourcelibrary.org/gallery/6990688d249ce014347d6e76/6990688d249ce014347d6eb2-0.jpg';
const FEATURE_BOOK = '/book/6990688d249ce014347d6e76';

const STATS = [
  { value: '70,000+', label: 'books, free to read' },
  { value: '6,500+', label: 'translated into English for the first time' },
  { value: '300,000', label: 'visits to its books last month' },
];

const USES = [
  {
    title: 'Reading the page',
    text: 'Transcribing each page from Latin, Greek, German and other languages, and translating it into English, so the text can be searched and quoted.',
  },
  {
    title: 'Checking it',
    text: 'Readings are checked against the page images. Pages we find wrong are corrected or held back until they are.',
  },
  {
    title: 'Keeping it free',
    text: 'Scans, storage and hosting, so every page stays open to read, search and quote, with no paywall.',
  },
];

const link = 'text-accent-rust hover:text-accent-gold-dark underline underline-offset-2';

export default async function GivePage() {
  // Vercel resolves the visitor's country at the edge. Absent locally and on any
  // non-Vercel host, which the default handles.
  const country = (await headers()).get('x-vercel-ip-country');

  return (
    <div className="min-h-screen bg-[#f6f3ee] flex flex-col">
      <SiteHeader variant="light" />

      <main className="flex-1 px-6 py-10 md:py-16">
        <div className="max-w-5xl mx-auto grid grid-cols-1 lg:grid-cols-[1fr_26rem] gap-10 lg:gap-14 items-start">
          {/* Headline: first on every screen */}
          <div className="lg:col-start-1 lg:row-start-1">
            <h1 className="text-3xl md:text-[2.6rem] font-display text-stone-900 mb-4 leading-tight">
              Help translate the books no one ever translated
            </h1>
            <p className="text-lg text-stone-700 leading-relaxed">
              Source Library publishes rare books on alchemy, astrology, magic,
              medicine and early science, in the original and in English, free for
              anyone to read and cite. Your gift puts more of them into English.
            </p>
          </div>

          {/* The form: second on a phone, a sticky right column on a wide screen */}
          <div className="lg:col-start-2 lg:row-start-1 lg:row-span-2 lg:sticky lg:top-6">
            <GiveForm defaultRoute={defaultRouteForCountry(country)} surface="give" />
            <p className="mt-4 text-xs text-stone-500 leading-relaxed">
              Source Library is a project of the{' '}
              <a href="https://embassyofthefreemind.com" target="_blank" rel="noopener noreferrer" className={link}>
                Embassy of the Free Mind
              </a>{' '}
              in Amsterdam, home of the Bibliotheca Philosophica Hermetica.
            </p>
          </div>

          {/* The case */}
          <div className="lg:col-start-1 lg:row-start-2 space-y-10">
            <dl className="grid grid-cols-3 gap-4 border-y border-stone-300 py-5">
              {STATS.map((s) => (
                <div key={s.label}>
                  <dt className="sr-only">{s.label}</dt>
                  <dd className="font-display text-2xl md:text-3xl text-stone-900">{s.value}</dd>
                  <dd className="text-xs md:text-sm text-stone-600 leading-snug mt-1">{s.label}</dd>
                </div>
              ))}
            </dl>

            <figure className="grid grid-cols-[7rem_1fr] sm:grid-cols-[10rem_1fr] gap-5 items-start">
              <Link href={FEATURE_BOOK} className="block">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={FEATURE_IMAGE}
                  alt="A hand-coloured paper dial with a green dragon coiled around its centre, from Apian's Astronomicum Caesareum"
                  width={1983}
                  height={2803}
                  className="w-full h-auto shadow-md"
                />
              </Link>
              <figcaption className="text-stone-700 leading-relaxed">
                <p className="font-display text-xl text-stone-900 mb-1">The Emperor&rsquo;s Astronomy</p>
                <p className="text-sm text-stone-500 mb-3">Peter Apian, Ingolstadt, 1540</p>
                <p className="text-sm mb-3">
                  Apian printed paper dials that turn on silk threads, so a reader
                  could work out eclipses and the planets&rsquo; positions without
                  tables. The dragon marks where the Moon&rsquo;s path crosses the
                  Sun&rsquo;s. Written in Latin for Charles V, it had no English
                  translation until this one.
                </p>
                <Link href={FEATURE_BOOK} className={`text-sm ${link}`}>
                  Read it free
                </Link>
              </figcaption>
            </figure>

            <section>
              <h2 className="text-xl font-display text-stone-900 mb-4">Where a gift goes</h2>
              <ul className="space-y-4">
                {USES.map((u) => (
                  <li key={u.title} className="border-l-2 border-accent-rust pl-4">
                    <p className="font-semibold text-stone-900">{u.title}</p>
                    <p className="text-stone-600 leading-relaxed">{u.text}</p>
                  </li>
                ))}
              </ul>
            </section>

            <div className="text-sm text-stone-500 leading-relaxed space-y-2">
              <p>
                Giving through a business, or becoming a sponsor?{' '}
                <Link href="/support" className={link}>More ways to support the library</Link>.
              </p>
              <p>
                Not everyone gives money; some give time.{' '}
                <Link href="/contribute" className={link}>Help as a translator, reviewer or volunteer</Link>.
              </p>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
