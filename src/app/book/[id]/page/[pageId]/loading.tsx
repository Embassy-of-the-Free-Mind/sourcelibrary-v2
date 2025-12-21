import { Skeleton } from '@/components/ui/Skeleton';
import { BookLoader } from '@/components/ui/BookLoader';

export default function PageEditorLoading() {
  return (
    <div className="h-screen flex bg-stone-100">
      {/* Left panel - Image placeholder */}
      <div className="w-1/2 p-4 flex items-center justify-center bg-stone-200">
        <div className="w-full max-w-lg aspect-[3/4] bg-gradient-to-r from-stone-300 via-stone-200 to-stone-300 bg-[length:200%_100%] animate-shimmer rounded-lg shadow-lg" />
      </div>

      {/* Right panel - Editor with book loader */}
      <div className="w-1/2 flex flex-col border-l border-stone-200 bg-white">
        {/* Header */}
        <div className="p-4 border-b border-stone-200 animate-fade-in-up">
          <div className="flex items-center justify-between">
            <Skeleton className="h-6 w-32" />
            <div className="flex gap-2">
              <Skeleton className="h-8 w-8 rounded" />
              <Skeleton className="h-8 w-8 rounded" />
            </div>
          </div>
        </div>

        {/* Tabs */}
        <div className="flex border-b border-stone-200 animate-fade-in-up" style={{ animationDelay: '100ms' }}>
          <div className="flex gap-1 p-2">
            <Skeleton className="h-9 w-20 rounded" />
            <Skeleton className="h-9 w-24 rounded" />
            <Skeleton className="h-9 w-20 rounded" />
          </div>
        </div>

        {/* Content area with book loader */}
        <div className="flex-1 flex items-center justify-center">
          <BookLoader label="Opening page..." />
        </div>

        {/* Bottom nav */}
        <div className="p-4 border-t border-stone-200 flex justify-between animate-fade-in-up" style={{ animationDelay: '200ms' }}>
          <Skeleton className="h-10 w-24 rounded" />
          <Skeleton className="h-10 w-24 rounded" />
        </div>
      </div>
    </div>
  );
}
