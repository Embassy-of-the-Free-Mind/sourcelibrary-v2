import { Metadata } from 'next';
import SupportView from '@/app/support/SupportView';
import { SUPPORT_STRINGS } from '@/lib/funnel-i18n';

// Spanish edition of /support — a real, server-rendered, indexable route that
// shares the same body as /support (thin i18n, #2763).
export const revalidate = 600;
export const maxDuration = 60;

export const metadata: Metadata = {
  title: SUPPORT_STRINGS.es.metaTitle,
  description: SUPPORT_STRINGS.es.metaDescription,
  alternates: {
    canonical: '/es/support',
    languages: { en: '/support', es: '/es/support', 'x-default': '/support' },
  },
};

export default function SupportPageEs() {
  return <SupportView locale="es" />;
}
