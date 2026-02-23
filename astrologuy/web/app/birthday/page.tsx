"use client";

import { useAppState } from "@/lib/store";
import { BirthDateInput } from "@/components/ui/BirthDateInput";
import { DriftChart } from "@/components/viz/DriftChart";
import { useMemo } from "react";
import { findBirthLunation, getMoonPhase } from "@/lib/astro";
import { getLunarBirthday, getZodiacInfo } from "@/lib/lunar";
import { ZODIAC_ANIMAL_EMOJIS } from "@/lib/constants";

export default function BirthdayPage() {
  const { birthDate } = useAppState();

  const birthInfo = useMemo(() => {
    if (!birthDate) return null;
    const birth = new Date(birthDate);

    // Moon phase at birth
    const phase = getMoonPhase(birth);

    // Lunar birthday
    let lunar = null;
    try {
      lunar = getLunarBirthday(birth);
    } catch {
      // lunar-typescript may not support all dates
    }

    // Zodiac info
    let zodiac = null;
    try {
      zodiac = getZodiacInfo(birth.getFullYear(), birth);
    } catch {
      // fallback
    }

    // Birth lunation
    const lunation = findBirthLunation(birth);

    return { phase, lunar, zodiac, lunation, birth };
  }, [birthDate]);

  return (
    <div className="max-w-6xl mx-auto px-4 sm:px-6 py-8">
      <div className="text-center mb-8">
        <h1 className="font-serif text-3xl sm:text-4xl font-semibold mb-2">
          Lunar Birthday
        </h1>
        <p className="text-muted">
          Your birthday in the lunar calendar drifts ~11 days each year, returning every 19 years.
        </p>
      </div>

      {/* Birth date input */}
      <div className="flex justify-center mb-8">
        <BirthDateInput />
      </div>

      {/* Birth info cards */}
      {birthInfo && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 mb-10">
          {/* Birth moon phase */}
          <div className="bg-bg-card border border-border rounded-xl p-5">
            <div className="text-faint text-xs uppercase tracking-wider mb-2">Birth Moon Phase</div>
            <div className="flex items-center gap-3">
              <span className="text-4xl">{birthInfo.phase.phase_emoji}</span>
              <div>
                <div className="text-cream font-medium text-lg">{birthInfo.phase.phase_name}</div>
                <div className="text-muted text-sm">
                  {birthInfo.phase.illumination.toFixed(1)}% illuminated
                </div>
              </div>
            </div>
          </div>

          {/* Lunar birthday */}
          {birthInfo.lunar && (
            <div className="bg-bg-card border border-border rounded-xl p-5">
              <div className="text-faint text-xs uppercase tracking-wider mb-2">Lunar Birthday</div>
              <div className="text-cream font-medium text-lg">
                Month {birthInfo.lunar.lunar_month}, Day {birthInfo.lunar.lunar_day}
              </div>
              {birthInfo.lunar.next_lunar_birthday && (
                <div className="text-muted text-sm mt-1">
                  Next: {birthInfo.lunar.next_lunar_birthday.toLocaleDateString("en", {
                    month: "long",
                    day: "numeric",
                    year: "numeric",
                  })}
                </div>
              )}
            </div>
          )}

          {/* Chinese zodiac */}
          {birthInfo.zodiac && (
            <div className="bg-bg-card border border-border rounded-xl p-5">
              <div className="text-faint text-xs uppercase tracking-wider mb-2">Chinese Zodiac</div>
              <div className="flex items-center gap-3">
                <span className="text-3xl">
                  {ZODIAC_ANIMAL_EMOJIS[birthInfo.zodiac.animal]}
                </span>
                <div>
                  <div className="text-cream font-medium text-lg">{birthInfo.zodiac.animal}</div>
                  <div className="text-muted text-sm">{birthInfo.zodiac.element} element</div>
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Drift chart */}
      <div className="mb-8">
        <h2 className="font-serif text-xl font-semibold mb-2">19-Year Metonic Cycle</h2>
        <p className="text-muted text-sm mb-4">
          Your lunar birthday drifts ~11 days earlier each year on the Gregorian calendar.
          After 19 years (the Metonic cycle), it returns to nearly the same date.
          Gold bars show the lunation containing your birthday. Violet bars indicate leap years with 13 months.
        </p>
        <DriftChart />
      </div>
    </div>
  );
}
