import Image from 'next/image';
import { WelcomeHero as WelcomeHeroData } from '@/lib/welcome-hero';

type Props = {
  firstName: string | null;
  hero: WelcomeHeroData;
};

export default function WelcomeHero({ firstName, hero }: Props) {
  return (
    <div className="relative w-full min-h-[44vh] md:min-h-[50vh] overflow-hidden bg-stone-900">
      <Image
        src={hero.imageUrl}
        alt={hero.description || hero.bookTitle || 'A page from the collection'}
        fill
        priority
        sizes="100vw"
        className="object-cover opacity-90"
        unoptimized
      />
      {/* Warm overlay — keeps text legible and ties the image to the cream page below */}
      <div className="absolute inset-0 bg-gradient-to-b from-stone-900/30 via-stone-900/20 to-cream pointer-events-none" />
      <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-cream via-cream/80 to-transparent h-32 pointer-events-none" />

      <div className="relative max-w-3xl mx-auto px-6 pt-20 md:pt-28 pb-16 md:pb-20">
        <p className="text-white/80 text-sm tracking-[0.2em] uppercase mb-4 font-medium">
          ad fontes
        </p>
        <h1 className="font-serif text-4xl md:text-5xl text-white leading-tight drop-shadow-md">
          {firstName ? `Welcome, ${firstName}.` : 'Welcome.'}
        </h1>
        <p className="font-serif italic text-white/90 text-lg md:text-xl mt-4 max-w-xl drop-shadow-md leading-relaxed">
          You&rsquo;re inside a working library — thousands of rare books, scanned, translated, and read aloud by anyone who wanders in.
        </p>
        {(hero.bookTitle || hero.bookYear) && (
          <p className="absolute bottom-3 right-4 text-[11px] text-white/60 tracking-wide">
            {[hero.bookTitle, hero.bookYear].filter(Boolean).join(' · ')}
          </p>
        )}
      </div>
    </div>
  );
}
