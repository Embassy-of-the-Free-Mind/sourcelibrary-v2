import { Metadata } from 'next';
import SupportView, { fetchSupportStats } from '@/components/donate/SupportView';

// ISR and request-independent, for the reason spelled out in the English twin
// (src/app/support/page.tsx): `/support` sits in the static-pages CDN rule, so a
// `force-dynamic` page is still edge-cached for 24h and cannot personalise.
export const revalidate = 600;
export const maxDuration = 60;

export const metadata: Metadata = {
  title: 'Apoya — Source Library',
  description: 'Apoya la digitalización y traducción de textos históricos raros de la Bibliotheca Philosophica Hermetica.',
  alternates: { canonical: '/es/support', languages: { en: '/support', es: '/es/support' } },
};

// Spanish twin of /support — the acquisition front door for Spanish-speaking
// donors and Instagram/webview visitors who have no browser translate (#2763).
export default async function SupportPageEs() {
  const stats = await fetchSupportStats();
  return <SupportView stats={stats} locale="es" />;
}
