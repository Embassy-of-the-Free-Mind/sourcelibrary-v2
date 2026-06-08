'use client';

/**
 * Self-contained deep-zoom affordance for a book page scan (issue #2411).
 *
 * Renders the "Deep zoom" button and owns its own open/close state + overlay.
 * Kept as a small standalone client component (rather than wiring state into the
 * 2400-line TranslationEditor) so the open-state and the lazily-imported overlay
 * live in one simple, self-contained render — the same shape that works on the
 * artwork hero. Mounting it twice (one per reader layout) is fine; each instance
 * is independent and only one layout is visible at a time.
 */

import { useState, lazy, Suspense } from 'react';
import { Search } from 'lucide-react';
import type { DeepZoomManifest } from '@/lib/types/book';

const DeepZoomOverlay = lazy(() => import('@/components/artwork/DeepZoomOverlay'));

export default function PageDeepZoomButton({
  manifest,
  title,
}: {
  manifest: DeepZoomManifest;
  title: string;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="absolute top-2 right-2 z-10 flex items-center gap-1.5 px-2.5 py-1.5 bg-black/55 hover:bg-black/80 text-white text-xs rounded-lg backdrop-blur-sm transition-colors"
        title="Open deep zoom — stream this page at full resolution"
      >
        <Search className="w-3.5 h-3.5" />
        Deep zoom
      </button>
      {open && (
        <Suspense fallback={null}>
          <DeepZoomOverlay manifest={manifest} title={title} onClose={() => setOpen(false)} />
        </Suspense>
      )}
    </>
  );
}
