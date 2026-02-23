"use client";

import { YearCalendar } from "@/components/viz/YearCalendar";
import { MoonHeatmap } from "@/components/viz/MoonHeatmap";
import { YearPicker } from "@/components/ui/YearPicker";
import { BirthDateInput } from "@/components/ui/BirthDateInput";

export default function CalendarPage() {
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
      <YearCalendar />

      {/* Heatmap */}
      <div className="mt-12 pt-8 border-t border-border">
        <h2 className="font-serif text-xl font-semibold mb-2">Illumination Heatmap</h2>
        <p className="text-muted text-sm mb-4">
          Moon illumination for every day of the year. Brighter = fuller moon.
        </p>
        <MoonHeatmap />
      </div>
    </div>
  );
}
