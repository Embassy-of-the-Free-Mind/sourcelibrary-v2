import { BookLoader } from '@/components/ui/BookLoader';

export default function PipelineLoading() {
  return (
    <div className="min-h-screen bg-stone-50">
      {/* Header skeleton */}
      <header className="bg-white border-b border-stone-200">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 py-4">
          <div className="h-6 w-32 bg-stone-200 rounded" />
        </div>
      </header>

      {/* Book info skeleton */}
      <div className="bg-gradient-to-b from-stone-800 to-stone-900 py-8">
        <div className="max-w-4xl mx-auto px-4 sm:px-6">
          <div className="h-8 w-64 bg-stone-700 rounded mb-2" />
          <div className="h-4 w-48 bg-stone-700 rounded" />
        </div>
      </div>

      {/* Content skeleton */}
      <main className="max-w-4xl mx-auto px-4 sm:px-6 py-8">
        <div className="bg-white rounded-xl border border-stone-200 p-6">
          <div className="flex items-center justify-center py-12">
            <BookLoader />
          </div>
        </div>
      </main>
    </div>
  );
}
