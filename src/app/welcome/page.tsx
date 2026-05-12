import { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { auth } from '@/lib/auth';
import SiteHeader from '@/components/layout/SiteHeader';
import WelcomeForm from '@/components/welcome/WelcomeForm';

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

  return (
    <div className="min-h-screen bg-cream">
      <SiteHeader variant="light" />
      <div className="max-w-2xl mx-auto px-6 py-12 md:py-16">
        <h1 className="font-serif text-3xl md:text-4xl text-primary mb-3">
          Welcome{firstName ? `, ${firstName}` : ''}.
        </h1>
        <p className="text-secondary leading-relaxed mb-8 max-w-xl">
          Source Library is built in the open by readers. Two quick questions so we can point you at texts you&rsquo;ll care about &mdash; or skip and start browsing.
        </p>
        <WelcomeForm />
      </div>
    </div>
  );
}
