"use client";

import { EclipseTimeline } from "@/components/viz/EclipseTimeline";
import { useHydrated } from "@/lib/hooks";

export default function EclipsesPage() {
  const hydrated = useHydrated();

  return (
    <div className="max-w-3xl mx-auto px-4 sm:px-6 py-8">
      <div className="text-center mb-8">
        <h1 className="font-serif text-3xl sm:text-4xl font-semibold mb-2">
          Eclipse Forecast
        </h1>
        <p className="text-muted">
          Upcoming lunar and solar eclipses, computed from orbital mechanics.
        </p>
      </div>

      {hydrated ? <EclipseTimeline count={15} /> : (
        <div className="w-full h-48 flex items-center justify-center text-faint text-sm">
          Computing eclipse forecast&hellip;
        </div>
      )}
    </div>
  );
}
