import { Metadata } from 'next';
import SupportView, { fetchSupportStats } from '@/components/donate/SupportView';

// ISR, and the giving form here must NOT depend on the request.
//
// #3646 briefly made this page `force-dynamic` so <GiveForm> could default its
// tax route from `x-vercel-ip-country`. That silently did nothing: `/support` is
// listed in the static-pages CDN rule in next.config.ts (`CDN-Cache-Control:
// public, max-age=86400`), which is a PATH rule and overrides the route's
// dynamic setting at the edge. Measured on production 2026-08-05, the page
// answered `cf-cache-status: HIT` with `age: 1202` — i.e. every visitor was
// getting whichever country's copy the edge happened to cache first, held for
// 24h, plus a per-request Mongo call that bought nothing.
//
// That TTL is load-bearing: a June 2026 scraper flood sent ~1.3M req/day at
// exactly these pages and all of it reached Vercel, which is why the rule exists.
// So the fix is to stop depending on request state here rather than to punch a
// hole in the edge cache for a page drawing ~2 views/day.
//
// `/give` is the country-aware surface — it carries no CDN-Cache-Control, answers
// BYPASS, and is where the header's Support button points. Here <GiveForm> falls
// back to the international route and shows its "Giving from the United States?"
// switch, which is one visible click. A cached page cannot honestly personalise.
export const revalidate = 600;
export const maxDuration = 60;

export const metadata: Metadata = {
  title: 'Support — Source Library',
  description: 'Support the digitization and translation of rare historical texts from the Bibliotheca Philosophica Hermetica.',
  alternates: { canonical: '/support', languages: { en: '/support', es: '/es/support' } },
};

export default async function SupportPage() {
  const stats = await fetchSupportStats();
  return <SupportView stats={stats} locale="en" />;
}
