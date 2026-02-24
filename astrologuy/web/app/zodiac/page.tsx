"use client";

import { ZodiacWheel } from "@/components/viz/ZodiacWheel";
import { BirthDateInput } from "@/components/ui/BirthDateInput";
import { YearPicker } from "@/components/ui/YearPicker";
import { useHydrated } from "@/lib/hooks";
import { useAppState } from "@/lib/store";
import { useMemo } from "react";
import { getZodiacInfo } from "@/lib/lunar";
import { ZODIAC_ANIMAL_EMOJIS } from "@/lib/constants";

export default function ZodiacPage() {
  const hydrated = useHydrated();
  const { year, birthDate } = useAppState();

  const yearZodiac = useMemo(() => {
    try {
      return getZodiacInfo(year);
    } catch {
      return null;
    }
  }, [year]);

  return (
    <div className="max-w-6xl mx-auto px-4 sm:px-6 py-8">
      <div className="text-center mb-8">
        <h1 className="font-serif text-3xl sm:text-4xl font-semibold mb-2">
          Chinese Zodiac
        </h1>
        <p className="text-muted">
          Twelve animals, five elements, sixty-year cycles. Click any animal to explore.
        </p>
      </div>

      {/* Controls */}
      <div className="flex justify-center items-center gap-6 mb-8 flex-wrap">
        <YearPicker />
        <BirthDateInput />
      </div>

      {/* Current year info */}
      {hydrated && yearZodiac && (
        <div className="bg-bg-card border border-border rounded-xl p-5 mb-8 max-w-md mx-auto text-center">
          <div className="text-faint text-xs uppercase tracking-wider mb-2">
            Year of the
          </div>
          <div className="flex items-center justify-center gap-3">
            <span className="text-4xl">
              {ZODIAC_ANIMAL_EMOJIS[yearZodiac.animal]}
            </span>
            <div className="text-left">
              <div className="text-cream font-serif text-2xl font-semibold">
                {yearZodiac.element} {yearZodiac.animal}
              </div>
              <div className="text-muted text-sm">
                {yearZodiac.heavenly_stem} {yearZodiac.earthly_branch} &middot; {year}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Zodiac wheel + traits */}
      {hydrated ? <ZodiacWheel /> : (
        <div className="w-full h-64 flex items-center justify-center text-faint text-sm">
          Drawing zodiac wheel&hellip;
        </div>
      )}
    </div>
  );
}
