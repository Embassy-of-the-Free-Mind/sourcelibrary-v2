import { Metadata } from 'next';
import SupportView, { fetchSupportStats } from '@/components/donate/SupportView';

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
