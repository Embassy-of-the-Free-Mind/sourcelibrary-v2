import { Metadata } from 'next';
import Image from 'next/image';
import SiteHeader from '@/components/layout/SiteHeader';
import WelcomeForm from '@/components/welcome/WelcomeForm';
import { getWelcomeHero } from '@/lib/welcome-hero';

export const metadata: Metadata = {
  title: 'Welcome preview — Source Library',
  robots: { index: false, follow: false },
};

// Temporary preview route — renders the welcome page UI without the auth gate,
// so the design can be reviewed regardless of account state.
export default async function WelcomePreviewPage() {
  const hero = await getWelcomeHero();

  return (
    <div className="relative min-h-screen bg-stone-900">
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

      <div className="relative z-20">
        <SiteHeader variant="dark" />
      </div>

      <div className="relative z-10 max-w-2xl mx-auto px-6 pt-6 md:pt-10 pb-24">
        <div className="mb-3 px-2">
          <span className="inline-block rounded-full bg-white/15 backdrop-blur-sm text-white px-3 py-1 text-xs font-medium uppercase tracking-wider border border-white/20">
            Preview only
          </span>
        </div>
        <p className="font-serif text-white text-xl md:text-2xl mb-4 px-2 drop-shadow-md">
          Welcome, Derek.
        </p>
        <WelcomeForm />
      </div>

      {(hero.bookTitle || hero.bookYear) && (
        <p className="absolute bottom-3 right-4 z-10 text-[11px] text-white/70 tracking-wide drop-shadow">
          {[hero.bookTitle, hero.bookYear].filter(Boolean).join(' · ')}
        </p>
      )}
    </div>
  );
}
