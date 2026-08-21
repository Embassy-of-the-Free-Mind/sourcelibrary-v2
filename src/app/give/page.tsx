import { Metadata } from 'next';
import { headers } from 'next/headers';
import Link from 'next/link';
import SiteHeader from '@/components/layout/SiteHeader';
import GiveForm from '@/components/donate/GiveForm';
import { defaultRouteForCountry } from '@/lib/give-routes';

/**
 * The short path to giving: one screen, no scrolling, no database.
 *
 * This is the header's "Support" destination and the target for any printed QR
 * code, which is why the URL is one word. `/support` still exists and still
 * makes the longer case — it mounts the same <GiveForm> so the two can't drift.
 *
 * NO DATA FETCHING, deliberately. Every other surface can degrade; the page that
 * takes money cannot. `/support` reads corpus stats from Mongo and falls back to
 * hardcoded numbers on failure — fine there, pointless here, and one more thing
 * between a donor and a payment form. The only server work is reading the
 * request country to pick a default route, which cannot fail: an unknown country
 * is a valid answer (see defaultRouteForCountry).
 *
 * No `openGraph` block here on purpose. Defining one would REPLACE the root
 * layout's entire openGraph object including its images, shipping a card with no
 * image at all — the failure that hit three surfaces in one day (PRs #3149/
 * #3151/#3152). Inheriting the root block is correct until this page earns a
 * bespoke card, which would then also need its own `twitter.images`.
 */

export const metadata: Metadata = {
  title: 'Give — Source Library',
  description:
    'Fund the digitization and translation of rare historical texts. Choose an amount and give in two taps — US tax-deductible or international.',
  alternates: { canonical: '/give' },
};

export default async function GivePage() {
  // Vercel resolves the visitor's country at the edge. Absent locally and on any
  // non-Vercel host, which the default handles.
  const country = (await headers()).get('x-vercel-ip-country');

  return (
    <div className="min-h-screen bg-[#f6f3ee] flex flex-col">
      <SiteHeader variant="light" />

      <main className="flex-1 px-6 py-10 md:py-16">
        <div className="max-w-lg mx-auto">
          <h1 className="text-3xl md:text-4xl font-display text-stone-900 mb-3 leading-tight">
            Give to Source Library
          </h1>
          <p className="text-stone-600 leading-relaxed mb-8">
            We digitize rare historical texts, translate them — many for the first
            time in English — and publish them free for anyone to read and quote.
            Your gift pays for scanning and translation.
          </p>

          <GiveForm defaultRoute={defaultRouteForCountry(country)} surface="give" />

          <p className="mt-6 text-sm text-stone-500 leading-relaxed">
            Want the longer version — where the money goes, giving through a
            business, or becoming a sponsor?{' '}
            <Link
              href="/support"
              className="text-accent-rust hover:text-accent-gold-dark underline underline-offset-2"
            >
              Read more about supporting the library
            </Link>
            .
          </p>
          <p className="mt-2 text-sm text-stone-500 leading-relaxed">
            Not everyone gives money — some give time.{' '}
            <Link
              href="/contribute"
              className="text-accent-rust hover:text-accent-gold-dark underline underline-offset-2"
            >
              Participate
            </Link>{' '}
            as a translator, reviewer, or volunteer.
          </p>
        </div>
      </main>
    </div>
  );
}
