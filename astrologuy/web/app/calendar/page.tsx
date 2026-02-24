"use client";

import { YearCalendar } from "@/components/viz/YearCalendar";
import { MoonHeatmap } from "@/components/viz/MoonHeatmap";
import { YearPicker } from "@/components/ui/YearPicker";
import { BirthDateInput } from "@/components/ui/BirthDateInput";
import { useHydrated } from "@/lib/hooks";

export default function CalendarPage() {
  const hydrated = useHydrated();

  return (
    <div className="max-w-6xl mx-auto px-4 sm:px-6 py-8">
      <div className="text-center mb-8">
        <h1 className="font-serif text-3xl sm:text-4xl font-semibold mb-2">
          13-Month Lunar Calendar
        </h1>
        <p className="text-muted">
          Each month is one lunation &mdash; new moon to new moon
        </p>
      </div>

      {/* Controls */}
      <div className="flex justify-center items-center gap-6 mb-8 flex-wrap">
        <YearPicker />
        <BirthDateInput />
      </div>

      {/* The hero visualization */}
      {hydrated ? <YearCalendar /> : (
        <div className="w-full h-64 flex items-center justify-center text-faint text-sm">
          Building 13-month calendar&hellip;
        </div>
      )}

      {/* Heatmap */}
      <div className="mt-12 pt-8 border-t border-border">
        <h2 className="font-serif text-xl font-semibold mb-2">Illumination Heatmap</h2>
        <p className="text-muted text-sm mb-4">
          Moon illumination for every day of the year. Brighter = fuller moon.
        </p>
        {hydrated ? <MoonHeatmap /> : (
          <div className="w-full h-32 flex items-center justify-center text-faint text-sm">
            Computing illumination data&hellip;
          </div>
        )}
      </div>
    </div>
  );
}
