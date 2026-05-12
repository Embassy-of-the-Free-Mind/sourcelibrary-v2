import Image from 'next/image';
import { WelcomeHero as WelcomeHeroData } from '@/lib/welcome-hero';

type Props = {
  hero: WelcomeHeroData;
};

export default function WelcomeHero({ hero }: Props) {
  return (
    <div className="relative w-full h-[44vh] md:h-[52vh] overflow-hidden bg-stone-900">
      <Image
        src={hero.imageUrl}
        alt={hero.description || hero.bookTitle || 'A page from the collection'}
        fill
        priority
        sizes="100vw"
        className="object-cover"
        unoptimized
      />
      {/* Soft fade into the cream page below so the form feels stitched to the image */}
      <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-cream via-cream/70 to-transparent h-40 md:h-56 pointer-events-none" />
      {(hero.bookTitle || hero.bookYear) && (
        <p className="absolute bottom-2 right-3 text-[11px] text-stone-700/70 tracking-wide">
          {[hero.bookTitle, hero.bookYear].filter(Boolean).join(' · ')}
        </p>
      )}
    </div>
  );
}
