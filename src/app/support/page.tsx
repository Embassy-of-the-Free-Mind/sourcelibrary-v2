import { Metadata } from 'next';
import { headers } from 'next/headers';
import SupportView, { fetchSupportStats } from '@/components/donate/SupportView';
import { defaultRouteForCountry } from '@/lib/give-routes';

// Dynamic, not ISR, since #3639: the giving form defaults its tax route from the
// visitor's country, and a cached page would serve one country's default to
// everyone. The trade is trivial here — this page drew 60 pageviews in the 30
// days to 2026-08-05 — and getting the route right matters more, because only
// the NAF route carries the US 501(c)(3) deduction.
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export const metadata: Metadata = {
  title: 'Support — Source Library',
  description: 'Support the digitization and translation of rare historical texts from the Bibliotheca Philosophica Hermetica.',
  alternates: { canonical: '/support', languages: { en: '/support', es: '/es/support' } },
};

export default async function SupportPage() {
  const [stats, requestHeaders] = await Promise.all([fetchSupportStats(), headers()]);
  return (
    <SupportView
      stats={stats}
      locale="en"
      defaultRoute={defaultRouteForCountry(requestHeaders.get('x-vercel-ip-country'))}
    />
  );
}
