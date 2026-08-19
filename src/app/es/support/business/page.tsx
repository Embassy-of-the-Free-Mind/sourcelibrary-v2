import { Metadata } from 'next';
import BusinessGivingView from '@/components/donate/BusinessGivingView';

export const revalidate = 86400;

export const metadata: Metadata = {
  title: 'Donar a través de tu empresa — Source Library',
  description:
    'Cómo pueden apoyar a Source Library los titulares de una BV neerlandesa y las empresas estadounidenses. Deducción por ANBI cultural, el multiplicador del 150%, donaciones periódicas y cuándo conviene más patrocinar que donar.',
  alternates: {
    canonical: '/es/support/business',
    languages: { en: '/support/business', es: '/es/support/business' },
  },
};

// Spanish twin of /support/business. Same reason as /es/support (#2763): webview
// visitors get no browser translate, so an English-only page is a wall at the
// last step of the funnel — and this is the step where money changes hands.
export default function BusinessGivingPageEs() {
  return <BusinessGivingView locale="es" />;
}
