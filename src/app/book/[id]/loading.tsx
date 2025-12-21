import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';
import RotatingText from '@/components/ui/RotatingText';

function SkeletonPageThumbnail() {
  return (
    <div>
      <div className="aspect-[3/4] bg-white border border-stone-200 rounded-lg overflow-hidden">
        <div className="w-full h-full bg-gradient-to-r from-stone-200 via-stone-100 to-stone-200 bg-[length:200%_100%] animate-shimmer" />
      </div>
      <div className="h-3 w-6 bg-stone-100 rounded mx-auto mt-1" />
    </div>
  );
}

export default function BookDetailLoading() {
  return (
    <div className="min-h-screen bg-stone-50">
      {/* Header - visible immediately */}
      <header className="bg-white border-b border-stone-200">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4">
          <Link href="/" className="inline-flex items-center gap-2 text-stone-600 hover:text-stone-900">
            <ArrowLeft className="w-4 h-4" />
            Back to Library
          </Link>
        </div>
      </header>

      {/* Book Info - Text visible, cover shimmers */}
      <div className="bg-gradient-to-b from-stone-800 to-stone-900 text-white">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 sm:py-12">
          <div className="flex flex-col sm:flex-row gap-6 sm:gap-8">
            {/* Thumbnail - Shimmer only */}
            <div className="flex-shrink-0 flex justify-center sm:justify-start">
              <div className="w-32 sm:w-48 aspect-[3/4] rounded-lg overflow-hidden bg-stone-700">
                <div className="w-full h-full bg-gradient-to-r from-stone-700 via-stone-600 to-stone-700 bg-[length:200%_100%] animate-shimmer" />
              </div>
            </div>

            {/* Details - Text visible immediately */}
            <div className="flex-1 text-center sm:text-left">
              <h1 className="text-2xl sm:text-3xl font-serif font-bold text-white">
                <RotatingText
                  words={['Loading', 'Preparing', 'Opening', 'Retrieving']}
                  interval={1800}
                  className="text-white"
                />
              </h1>
              <p className="text-stone-400 mt-2">
                Your reading experience awaits
              </p>

              {/* Meta placeholders */}
              <div className="flex flex-wrap items-center justify-center sm:justify-start gap-3 sm:gap-6 mt-4 sm:mt-6">
                <div className="h-5 w-20 bg-stone-700 rounded" />
                <div className="h-5 w-16 bg-stone-700 rounded" />
                <div className="h-5 w-24 bg-stone-700 rounded" />
              </div>

              {/* Stats placeholders */}
              <div className="flex flex-wrap items-center justify-center sm:justify-start gap-3 sm:gap-6 mt-4 sm:mt-6">
                <div className="w-20 h-16 rounded-lg bg-stone-700/50" />
                <div className="w-20 h-16 rounded-lg bg-stone-700/50" />
                <div className="w-20 h-16 rounded-lg bg-stone-700/50" />
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Pages Grid - Title visible, images shimmer */}
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
        <h2 className="text-xl font-semibold text-stone-900 mb-6">Pages</h2>

        <div className="grid grid-cols-3 sm:grid-cols-5 md:grid-cols-6 lg:grid-cols-8 xl:grid-cols-10 gap-3 sm:gap-4">
          {Array.from({ length: 20 }).map((_, i) => (
            <SkeletonPageThumbnail key={i} />
          ))}
        </div>
      </main>
    </div>
  );
}
