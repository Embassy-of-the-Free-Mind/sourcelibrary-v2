import { Metadata } from 'next';
import SupportView, { fetchSupportStats } from '@/components/donate/SupportView';
import { siteOgImage } from '@/lib/og-locale';

// ISR and request-independent, for the reason spelled out in the English twin
// (src/app/support/page.tsx): `/support` sits in the static-pages CDN rule, so a
// `force-dynamic` page is still edge-cached for 24h and cannot personalise.
export const revalidate = 600;
export const maxDuration = 60;

const ES_SUPPORT_DESCRIPTION =
  'Apoya la digitalización y traducción de textos históricos raros de la Bibliotheca Philosophica Hermetica.';

export const metadata: Metadata = {
  title: 'Apoya — Source Library',
  description: ES_SUPPORT_DESCRIPTION,
  alternates: { canonical: '/es/support', languages: { en: '/support', es: '/es/support' } },
  // Spanish card, Spanish page: this link is pasted into WhatsApp and Instagram
  // by Spanish-speaking supporters, and the preview is the whole first
  // impression of the ask (#4162).
  openGraph: {
    title: 'Apoya — Source Library',
    description: ES_SUPPORT_DESCRIPTION,
    siteName: 'Source Library',
    type: 'website',
    locale: 'es_ES',
    url: 'https://sourcelibrary.org/es/support',
    images: [siteOgImage('es')],
  },
  twitter: {
    card: 'summary_large_image',
    site: '@SourceLibrary_',
    title: 'Apoya — Source Library',
    description: ES_SUPPORT_DESCRIPTION,
    images: [siteOgImage('es')],
  },
};

// Spanish twin of /support — the acquisition front door for Spanish-speaking
// donors and Instagram/webview visitors who have no browser translate (#2763).
export default async function SupportPageEs() {
  const stats = await fetchSupportStats();
  return <SupportView stats={stats} locale="es" />;
}
