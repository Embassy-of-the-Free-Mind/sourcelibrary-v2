import { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { auth } from '@/lib/auth';
import SiteHeader from '@/components/layout/SiteHeader';
import WelcomeForm from '@/components/welcome/WelcomeForm';
import WelcomeHero from '@/components/welcome/WelcomeHero';
import { getWelcomeHero } from '@/lib/welcome-hero';

export const metadata: Metadata = {
  title: 'Welcome — Source Library',
  robots: { index: false, follow: false },
};

export default async function WelcomePage() {
  const session = await auth();
  if (!session?.user?.id) {
    redirect('/auth/signin?callbackUrl=%2Fwelcome');
  }

  const firstName = session.user.name?.split(' ')[0] || null;
  const hero = await getWelcomeHero();

  return (
    <div className="min-h-screen bg-cream">
      <div className="absolute inset-x-0 top-0 z-10">
        <SiteHeader variant="dark" />
      </div>
      <WelcomeHero firstName={firstName} hero={hero} />
      <div className="max-w-2xl mx-auto px-6 pb-16 -mt-6 md:-mt-10 relative">
        <WelcomeForm />
      </div>
    </div>
  );
}
