import { Metadata } from 'next';
import { headers } from 'next/headers';
import SupportView, { fetchSupportStats } from '@/components/donate/SupportView';
import { defaultRouteForCountry } from '@/lib/give-routes';

// Dynamic for the same reason as the English twin — see src/app/support/page.tsx.
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export const metadata: Metadata = {
  title: 'Apoya — Source Library',
  description: 'Apoya la digitalización y traducción de textos históricos raros de la Bibliotheca Philosophica Hermetica.',
  alternates: { canonical: '/es/support', languages: { en: '/support', es: '/es/support' } },
};

// Spanish twin of /support — the acquisition front door for Spanish-speaking
// donors and Instagram/webview visitors who have no browser translate (#2763).
export default async function SupportPageEs() {
  const [stats, requestHeaders] = await Promise.all([fetchSupportStats(), headers()]);
  return (
    <SupportView
      stats={stats}
      locale="es"
      defaultRoute={defaultRouteForCountry(requestHeaders.get('x-vercel-ip-country'))}
    />
  );
}
