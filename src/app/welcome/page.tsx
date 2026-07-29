import { Metadata } from 'next';
import Image from 'next/image';
import { redirect } from 'next/navigation';
import { auth } from '@/lib/auth';
import SiteHeader from '@/components/layout/SiteHeader';
import WelcomeForm from '@/components/welcome/WelcomeForm';
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
    <div className="relative min-h-screen bg-stone-900">
      {/* Full-bleed background image */}
      <Image
        src={hero.imageUrl}
        alt={hero.description || hero.bookTitle || 'A page from the collection'}
        fill
        priority
        sizes="100vw"
        className="object-cover"
        unoptimized
      />
      <div className="absolute inset-0 bg-stone-900/30 pointer-events-none" />

      {/* Header sits over the image */}
      <div className="relative z-20">
        <SiteHeader variant="light" />
      </div>

      {/* Form pinned just below the header */}
      <div className="relative z-10 max-w-2xl mx-auto px-6 pt-6 md:pt-10 pb-24">
        <p className="font-serif text-white text-xl md:text-2xl mb-4 px-2 drop-shadow-md">
          {firstName ? `Welcome, ${firstName}.` : 'Welcome.'}
        </p>
        <WelcomeForm initialName={session.user.name || ''} />
      </div>

      {(hero.bookTitle || hero.bookYear) && (
        <p className="absolute bottom-3 right-4 z-10 text-[11px] text-white/70 tracking-wide drop-shadow">
          {[hero.bookTitle, hero.bookYear].filter(Boolean).join(' · ')}
        </p>
      )}
    </div>
  );
}
