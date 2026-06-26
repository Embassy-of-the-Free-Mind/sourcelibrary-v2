import { Metadata } from 'next';
import SupportView from './SupportView';
import { SUPPORT_STRINGS } from '@/lib/funnel-i18n';

export const revalidate = 600;
export const maxDuration = 60;

export const metadata: Metadata = {
  title: SUPPORT_STRINGS.en.metaTitle,
  description: SUPPORT_STRINGS.en.metaDescription,
  alternates: {
    canonical: '/support',
    languages: { en: '/support', es: '/es/support', 'x-default': '/support' },
  },
};

export default function SupportPage() {
  return <SupportView locale="en" />;
}
