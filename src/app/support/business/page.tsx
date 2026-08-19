import { Metadata } from 'next';
import BusinessGivingView from '@/components/donate/BusinessGivingView';

export const revalidate = 86400;

// NOTE: src/app/support/layout.tsx sets alternates.canonical = '/support' for every child.
// Metadata merges per top-level key, so this page must declare its own `alternates` or it
// would advertise /support as its canonical and drop itself from the index.
export const metadata: Metadata = {
  title: 'Giving through your company — Source Library',
  description:
    'How Dutch BV owners and US companies can support Source Library. Cultural ANBI deduction, the 150% multiplier, periodic gifts, and when sponsorship beats a donation.',
  alternates: {
    canonical: '/support/business',
    languages: { en: '/support/business', es: '/es/support/business' },
  },
};

export default function BusinessGivingPage() {
  return <BusinessGivingView locale="en" />;
}
