import Link from 'next/link';
import Image from 'next/image';
import RotatingText from '@/components/ui/RotatingText';

function SkeletonBookCard() {
  return (
    <div className="bg-white border border-stone-200 rounded-lg overflow-hidden">
      {/* Image area - shimmer only */}
      <div className="aspect-[3/4] relative bg-stone-100 overflow-hidden">
        <div className="absolute inset-0 bg-gradient-to-r from-stone-200 via-stone-100 to-stone-200 bg-[length:200%_100%] animate-shimmer" />
      </div>
      {/* Text skeleton - subtle, not shimmering */}
      <div className="p-4">
        <div className="h-5 bg-stone-100 rounded w-3/4 mb-2" />
        <div className="h-4 bg-stone-100 rounded w-1/2 mb-2" />
        <div className="flex gap-2">
          <div className="h-5 bg-stone-100 rounded w-16" />
          <div className="h-5 bg-stone-100 rounded w-12" />
        </div>
      </div>
    </div>
  );
}

export default function HomeLoading() {
  return (
    <div className="min-h-screen">
      {/* Hero Section - Header and text visible immediately */}
      <section className="relative h-screen w-full overflow-hidden bg-black">
        {/* Header Navigation - visible immediately */}
        <header className="relative z-50 flex items-center justify-between px-6 md:px-12 py-4">
          <Link href="/" className="text-white flex items-center gap-3">
            <Image src="/logo.svg" alt="Source Library" width={48} height={48} className="w-10 h-10 md:w-12 md:h-12" />
            <span className="text-xl md:text-2xl uppercase tracking-wider text-white">
              <span className="font-semibold text-white">Source</span>
              <span className="font-light text-white">Library</span>
            </span>
          </Link>
        </header>

        {/* Hero Content - text visible immediately */}
        <div className="relative z-10 h-full flex items-center">
          <div className="px-6 md:px-12 max-w-3xl">
            <h1
              className="text-4xl md:text-5xl lg:text-6xl text-white mb-6 leading-tight tracking-wide"
              style={{ fontFamily: 'Playfair Display, Georgia, serif' }}
            >
              Unlock a New Renaissance of Ancient Knowledge
            </h1>
            <p className="text-lg md:text-xl font-light text-white/90 leading-relaxed max-w-2xl">
              Source Library is scanning and translating rare Hermetic and esoteric texts to make them accessible to scholars, seekers, and AI systems.
            </p>
          </div>
        </div>

        {/* Scroll indicator */}
        <div className="absolute bottom-8 left-1/2 -translate-x-1/2 z-20">
          <svg className="w-6 h-6 text-white animate-bounce" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 14l-7 7m0 0l-7-7m7 7V3" />
          </svg>
        </div>
      </section>

      {/* Library Section - Text visible, images shimmer */}
      <section className="bg-gradient-to-b from-[#f6f3ee] to-[#f3ede6] py-16 md:py-24">
        <div className="px-6 md:px-12 max-w-7xl mx-auto">
          {/* Section Header with rotating text */}
          <div className="mb-8 flex flex-col sm:flex-row sm:items-baseline sm:justify-between gap-4">
            <h2
              className="text-3xl md:text-4xl lg:text-5xl text-gray-900 italic"
              style={{ fontFamily: 'Playfair Display, Georgia, serif' }}
            >
              Freshly Digitised & Translated Texts
            </h2>
            <span className="text-stone-500 text-lg italic">
              <RotatingText
                words={['Loading', 'Preparing', 'Curating', 'Gathering']}
                interval={2000}
              />
            </span>
          </div>

          {/* Book Grid - shimmer cards */}
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-6 md:gap-8">
            {Array.from({ length: 10 }).map((_, i) => (
              <SkeletonBookCard key={i} />
            ))}
          </div>
        </div>
      </section>
    </div>
  );
}
