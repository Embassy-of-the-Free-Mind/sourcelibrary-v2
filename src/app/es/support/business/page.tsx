import { Metadata } from 'next';
import BusinessGivingView from '@/components/donate/BusinessGivingView';
import { siteOgImage } from '@/lib/og-locale';

export const revalidate = 86400;

const ES_BUSINESS_DESCRIPTION =
  'Cómo pueden apoyar a Source Library los titulares de una BV neerlandesa y las empresas estadounidenses. Deducción por ANBI cultural, el multiplicador del 150%, donaciones periódicas y cuándo conviene más patrocinar que donar.';

export const metadata: Metadata = {
  title: 'Donar a través de tu empresa — Source Library',
  description: ES_BUSINESS_DESCRIPTION,
  alternates: {
    canonical: '/es/support/business',
    languages: { en: '/support/business', es: '/es/support/business' },
  },
  openGraph: {
    title: 'Donar a través de tu empresa — Source Library',
    description: ES_BUSINESS_DESCRIPTION,
    siteName: 'Source Library',
    type: 'website',
    locale: 'es_ES',
    url: 'https://sourcelibrary.org/es/support/business',
    images: [siteOgImage('es')],
  },
  twitter: {
    card: 'summary_large_image',
    site: '@SourceLibrary_',
    title: 'Donar a través de tu empresa — Source Library',
    description: ES_BUSINESS_DESCRIPTION,
    images: [siteOgImage('es')],
  },
};

// Spanish twin of /support/business. Same reason as /es/support (#2763): webview
// visitors get no browser translate, so an English-only page is a wall at the
// last step of the funnel — and this is the step where money changes hands.
export default function BusinessGivingPageEs() {
  return <BusinessGivingView locale="es" />;
}
