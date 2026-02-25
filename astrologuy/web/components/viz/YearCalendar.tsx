"use client";

import { useMemo, useState } from "react";
import { useAppState } from "@/lib/store";
import { useLunarCalendar, formatMonthDay, daysBetween } from "@/lib/hooks";
import { findBirthLunation, getIlluminationForDate, compute13MonthCalendar } from "@/lib/astro";
import { SYNODIC_MONTH } from "@/lib/constants";
import { MiniMoon } from "./MiniMoon";

type ViewMode = "ideal" | "astronomical" | "solar";

// Gold tint based on continuous illumination (0..100)
function illumBg(illum: number): string {
  const frac = illum / 100;
  const alpha = 0.03 + frac * 0.15;
  return `rgba(201, 168, 108, ${alpha.toFixed(3)})`;
}

export function YearCalendar() {
  const { year, birthDate } = useAppState();
  const lunations = useLunarCalendar(year);
  const [viewMode, setViewMode] = useState<ViewMode>("ideal");
  const today = useMemo(() => new Date(), []);

  // Birth info
  const birthInfo = useMemo(() => {
    if (!birthDate) return null;
    return findBirthLunation(birthDate);
  }, [birthDate]);

  const birthdayPositions = useMemo(() => {
    if (!birthInfo || !birthDate) return new Map<number, Date>();
    const positions = new Map<number, Date>();
    const { lunationIndex, lunarDay } = birthInfo;
    if (lunationIndex < lunations.length) {
      const lun = lunations[lunationIndex];
      const bdayDate = new Date(lun.newMoon.getTime() + (lunarDay - 1) * 86400000);
      if (bdayDate < lun.nextNewMoon) {
        positions.set(lunationIndex, bdayDate);
      }
    }
    return positions;
  }, [birthInfo, birthDate, lunations]);

  // Precompute illumination for each day in ideal view (28 days per lunation)
  const idealIllumCache = useMemo(() => {
    if (viewMode !== "ideal") return [];
    return lunations.map((lun) =>
      Array.from({ length: 28 }, (_, d) => {
        const date = new Date(lun.newMoon.getTime() + d * 86400000);
        return getIlluminationForDate(date);
      })
    );
  }, [lunations, viewMode]);

  // Precompute illumination for astronomical view
  const astroIllumCache = useMemo(() => {
    if (viewMode !== "astronomical") return [];
    return lunations.map((lun) => {
      const days = Math.round(lun.length);
      return Array.from({ length: days }, (_, d) => {
        const date = new Date(lun.newMoon.getTime() + d * 86400000);
        return getIlluminationForDate(date);
      });
    });
  }, [lunations, viewMode]);

  const totalDays = lunations.reduce((s, l) => s + l.length, 0);
  const leapCount = lunations.filter((l) => l.isLeap).length;

  const DAYS_LABELS = ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"];

  return (
    <div>
      {/* View mode toggle */}
      <div className="flex items-center justify-between mb-6 flex-wrap gap-3">
        <div className="text-muted text-sm">
          <span className="text-accent-gold font-medium">{lunations.length}</span> lunations &middot;{" "}
          <span className="text-accent-gold font-medium">{Math.round(totalDays)}</span> days
          {leapCount > 0 && (
            <>
              {" "}&middot; <span className="text-accent-violet font-medium">{leapCount}</span> leap month{leapCount > 1 ? "s" : ""}
            </>
          )}
        </div>
        <div className="flex bg-bg-card border border-border rounded-lg overflow-hidden">
          {(["ideal", "astronomical", "solar"] as ViewMode[]).map((mode) => (
            <button
              key={mode}
              onClick={() => setViewMode(mode)}
              className={`px-3 py-1.5 text-xs transition-colors ${
                viewMode === mode ? "bg-accent-gold/15 text-accent-gold" : "text-muted hover:text-cream"
              }`}
            >
              {mode === "ideal" ? "Ideal (13x28)" : mode === "astronomical" ? "Astronomical" : "Solar"}
            </button>
          ))}
        </div>
      </div>

      {/* Birthday banner */}
      {birthDate && birthdayPositions.size > 0 && (
        <div className="mb-6 bg-gradient-to-r from-accent-rust/15 to-accent-gold/15 border border-accent-gold/25 rounded-lg px-5 py-3 text-sm text-center">
          Lunar birthday falls on{" "}
          <strong className="text-accent-gold">
            {formatMonthDay(Array.from(birthdayPositions.values())[0])}, {year}
          </strong>{" "}
          (day {birthInfo?.lunarDay} of lunation)
        </div>
      )}

      {/* ═══ IDEAL VIEW ═══ */}
      {viewMode === "ideal" && (
        <>
          <div className="grid gap-4 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {lunations.map((lun, lunIdx) => {
              const birthdayDate = birthdayPositions.get(lunIdx);
              const birthdayDay = birthdayDate ? Math.round(daysBetween(lun.newMoon, birthdayDate)) : -1;
              const todayDay = today >= lun.newMoon && today < lun.nextNewMoon
                ? Math.round(daysBetween(lun.newMoon, today))
                : -1;
              const illums = idealIllumCache[lunIdx] ?? [];
              // Lunation progress (how far into the year this lunation sits)
              const progressPct = ((lun.length / SYNODIC_MONTH) * 100).toFixed(0);

              return (
                <div
                  key={lunIdx}
                  className={`bg-bg-card border rounded-xl p-4 ${
                    birthdayDay >= 0
                      ? "border-accent-rust bg-gradient-to-br from-bg-card to-accent-rust/5"
                      : lun.isLeap
                      ? "border-accent-violet/30"
                      : "border-border"
                  }`}
                >
                  {/* Month header + progress bar */}
                  <div className="flex items-baseline justify-between mb-1">
                    <div>
                      <span className="font-serif text-lg font-semibold text-accent-gold">
                        {lun.isLeap ? "Leap" : `Month ${lun.num}`}
                      </span>
                      {lun.chineseMonth && !lun.isLeap && (
                        <span className="text-faint text-xs ml-2">Ch. {lun.chineseMonth}</span>
                      )}
                    </div>
                    <span className="text-faint text-xs">{formatMonthDay(lun.newMoon)}</span>
                  </div>

                  {/* Thin lunation progress bar */}
                  <div className="w-full h-0.5 bg-white/5 rounded-full mb-3 overflow-hidden">
                    <div
                      className="h-full bg-accent-gold/40 rounded-full"
                      style={{ width: `${Math.min(100, parseFloat(progressPct))}%` }}
                    />
                  </div>

                  {/* Day labels */}
                  <div className="grid grid-cols-7 gap-0.5 mb-1">
                    {DAYS_LABELS.map((d) => (
                      <div key={d} className="text-center text-[10px] text-faint">{d}</div>
                    ))}
                  </div>

                  {/* Day grid */}
                  <div className="grid grid-cols-7 gap-0.5">
                    {Array.from({ length: 28 }, (_, d) => {
                      const isPhaseMarker = d === 0 || d === 7 || d === 14 || d === 21;
                      const isFull = d === 14;
                      const isBirthday = d === birthdayDay;
                      const isToday = d === todayDay;
                      const illum = illums[d] ?? 0;
                      const phaseDate = new Date(lun.newMoon.getTime() + d * 86400000);

                      return (
                        <div
                          key={d}
                          className={`relative aspect-square flex items-center justify-center rounded text-xs cursor-default transition-colors ${
                            isBirthday
                              ? "ring-1 ring-accent-rust"
                              : isToday
                              ? "ring-1 ring-accent-sage"
                              : ""
                          }`}
                          style={{
                            background: isBirthday
                              ? "rgba(158, 74, 58, 0.25)"
                              : isToday
                              ? "rgba(139, 154, 125, 0.25)"
                              : illumBg(illum),
                            boxShadow: isFull && !isBirthday && !isToday
                              ? "0 0 12px rgba(201, 168, 108, 0.4)"
                              : undefined,
                          }}
                          title={`Day ${d + 1} — ${illum.toFixed(0)}% illuminated`}
                        >
                          {isPhaseMarker ? (
                            <MiniMoon date={phaseDate} size={18} glow={isFull} />
                          ) : (
                            <span className={`text-[11px] ${isBirthday ? "text-accent-rust font-bold" : isToday ? "text-accent-sage font-bold" : "text-muted"}`}>
                              {d + 1}
                            </span>
                          )}
                        </div>
                      );
                    })}
                  </div>

                  {/* Meta tags */}
                  <div className="flex gap-2 mt-3 flex-wrap">
                    <span className="text-[10px] bg-white/5 rounded px-2 py-0.5 text-muted">
                      {Math.round(lun.length * 10) / 10}d
                    </span>
                    {lun.isLeap && (
                      <span className="text-[10px] bg-accent-violet/15 rounded px-2 py-0.5 text-accent-violet">Leap</span>
                    )}
                    {birthdayDay >= 0 && (
                      <span className="text-[10px] bg-accent-rust/15 rounded px-2 py-0.5 text-accent-rust font-medium">
                        Birthday: {formatMonthDay(birthdayDate!)}
                      </span>
                    )}
                    {todayDay >= 0 && (
                      <span className="text-[10px] bg-accent-sage/15 rounded px-2 py-0.5 text-accent-sage">Today</span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>

          {/* Day Out of Time note */}
          <div className="mt-6 text-center text-sm text-muted">
            <span className="text-accent-gold">13 &times; 28 = 364</span> days + 1 &ldquo;Day Out of Time&rdquo; = 365
            <br />
            <span className="text-faint text-xs mt-1 block">
              Real lunations average {SYNODIC_MONTH} days. The ~1.5 extra days per month accumulate across the year.
            </span>
          </div>
        </>
      )}

      {/* ═══ ASTRONOMICAL VIEW ═══ */}
      {viewMode === "astronomical" && (
        <div className="grid gap-4 grid-cols-1">
          {lunations.map((lun, lunIdx) => {
            const days = Math.round(lun.length);
            const birthdayDate = birthdayPositions.get(lunIdx);
            const birthdayDay = birthdayDate ? Math.round(daysBetween(lun.newMoon, birthdayDate)) : -1;
            const todayDay = today >= lun.newMoon && today < lun.nextNewMoon
              ? Math.round(daysBetween(lun.newMoon, today))
              : -1;
            const illums = astroIllumCache[lunIdx] ?? [];

            return (
              <div
                key={lunIdx}
                className={`bg-bg-card border rounded-xl p-4 ${
                  birthdayDay >= 0
                    ? "border-accent-rust bg-gradient-to-r from-bg-card to-accent-rust/5"
                    : lun.isLeap
                    ? "border-accent-violet/30"
                    : "border-border"
                }`}
              >
                <div className="flex items-center gap-4">
                  {/* Lunation number */}
                  <div className="flex-shrink-0 w-14 text-center">
                    <div className={`font-serif text-2xl font-bold ${lun.isLeap ? "text-accent-violet" : "text-accent-gold"}`}>
                      {lun.num}
                    </div>
                    <div className="text-[10px] text-faint uppercase tracking-wider">
                      {lun.isLeap ? "Leap" : `Mo. ${lun.chineseMonth ?? lun.num}`}
                    </div>
                  </div>

                  {/* Phase timeline with MiniMoon */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1 mb-2">
                      {[
                        { date: lun.newMoon, label: "New" },
                        { date: lun.firstQuarter, label: "1st Qtr" },
                        { date: lun.fullMoon, label: "Full" },
                        { date: lun.thirdQuarter, label: "3rd Qtr" },
                        { date: lun.nextNewMoon, label: "New" },
                      ].map((p, pi) => (
                        <div key={pi} className="flex items-center flex-1">
                          <div className="flex flex-col items-center flex-1">
                            <MiniMoon date={p.date} size={24} glow={pi === 2} />
                            <span className="text-[10px] text-faint mt-0.5">{formatMonthDay(p.date)}</span>
                            <span className="text-[9px] text-muted uppercase tracking-wider">{p.label}</span>
                          </div>
                          {pi < 4 && <div className="w-4 h-px bg-border flex-shrink-0" />}
                        </div>
                      ))}
                    </div>

                    {/* Day intensity bar with illumination */}
                    <div className="flex gap-px">
                      {Array.from({ length: days }, (_, d) => {
                        const isBday = d === birthdayDay;
                        const isTod = d === todayDay;
                        const illum = illums[d] ?? 0;
                        return (
                          <div
                            key={d}
                            className={`flex-1 rounded-sm ${
                              isBday ? "h-1.5" : isTod ? "h-1.5" : "h-1"
                            }`}
                            style={{
                              background: isBday
                                ? "var(--color-accent-rust)"
                                : isTod
                                ? "var(--color-accent-sage)"
                                : illumBg(illum),
                            }}
                          />
                        );
                      })}
                    </div>

                    {/* Tags */}
                    <div className="flex gap-2 mt-2 flex-wrap">
                      <span className="text-[10px] bg-white/5 rounded px-2 py-0.5 text-muted">
                        {Math.round(lun.length * 10) / 10} days
                      </span>
                      {lun.isLeap && (
                        <span className="text-[10px] bg-accent-violet/15 rounded px-2 py-0.5 text-accent-violet">Leap month</span>
                      )}
                      {birthdayDay >= 0 && birthdayDate && (
                        <span className="text-[10px] bg-accent-rust/15 rounded px-2 py-0.5 text-accent-rust font-medium">
                          Lunar birthday: {formatMonthDay(birthdayDate)}
                        </span>
                      )}
                      {todayDay >= 0 && (
                        <span className="text-[10px] bg-accent-sage/15 rounded px-2 py-0.5 text-accent-sage">Today</span>
                      )}
                    </div>
                  </div>

                  {/* Date range */}
                  <div className="hidden sm:block flex-shrink-0 text-right">
                    <div className="text-sm text-cream">
                      {formatMonthDay(lun.newMoon)} &ndash; {formatMonthDay(lun.nextNewMoon)}
                    </div>
                    <div className="text-[11px] text-faint">{year}</div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* ═══ SOLAR OVERLAY VIEW ═══ */}
      {viewMode === "solar" && (
        <SolarOverlay year={year} lunations={lunations} today={today} />
      )}
    </div>
  );
}

// ─────────────────────────────────────────────
// Solar Overlay: Gregorian grid + lunar ribbons
// ─────────────────────────────────────────────

function SolarOverlay({
  year,
  lunations,
  today,
}: {
  year: number;
  lunations: ReturnType<typeof compute13MonthCalendar>;
  today: Date;
}) {
  const MONTH_NAMES = ["January","February","March","April","May","June","July","August","September","October","November","December"];
  const DOW = ["Su","Mo","Tu","We","Th","Fr","Sa"];

  // Precompute lunation lookup: for each day of the year, which lunation index?
  const lunationMap = useMemo(() => {
    const map = new Map<string, { lunIdx: number; illum: number }>();
    const jan1 = new Date(year, 0, 1);
    const dec31 = new Date(year, 11, 31);

    for (let d = new Date(jan1); d <= dec31; d = new Date(d.getTime() + 86400000)) {
      const key = `${d.getMonth()}-${d.getDate()}`;
      const illum = getIlluminationForDate(d);

      // Find which lunation this day falls in
      let lunIdx = -1;
      for (let i = 0; i < lunations.length; i++) {
        if (d >= lunations[i].newMoon && d < lunations[i].nextNewMoon) {
          lunIdx = i;
          break;
        }
      }
      map.set(key, { lunIdx, illum });
    }
    return map;
  }, [year, lunations]);

  // Precompute phase events on Gregorian dates
  const phaseEvents = useMemo(() => {
    const events = new Map<string, { type: "new" | "fq" | "full" | "tq"; date: Date }>();
    for (const lun of lunations) {
      const addEvent = (d: Date, type: "new" | "fq" | "full" | "tq") => {
        if (d.getFullYear() === year) {
          events.set(`${d.getMonth()}-${d.getDate()}`, { type, date: d });
        }
      };
      addEvent(lun.newMoon, "new");
      addEvent(lun.firstQuarter, "fq");
      addEvent(lun.fullMoon, "full");
      addEvent(lun.thirdQuarter, "tq");
    }
    return events;
  }, [lunations, year]);

  return (
    <>
      <div className="grid gap-4 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
        {Array.from({ length: 12 }, (_, monthIdx) => {
          const firstDay = new Date(year, monthIdx, 1);
          const startDow = firstDay.getDay(); // 0=Sun
          const daysInMonth = new Date(year, monthIdx + 1, 0).getDate();

          return (
            <div key={monthIdx} className="bg-bg-card border border-border rounded-xl p-4">
              <div className="font-serif text-lg font-semibold text-cream mb-3">
                {MONTH_NAMES[monthIdx]}
              </div>

              {/* DOW headers */}
              <div className="grid grid-cols-7 gap-0.5 mb-1">
                {DOW.map((d) => (
                  <div key={d} className="text-center text-[10px] text-faint">{d}</div>
                ))}
              </div>

              {/* Calendar grid */}
              <div className="grid grid-cols-7 gap-0.5">
                {/* Empty cells before first day */}
                {Array.from({ length: startDow }, (_, i) => (
                  <div key={`empty-${i}`} className="aspect-square" />
                ))}

                {/* Day cells */}
                {Array.from({ length: daysInMonth }, (_, d) => {
                  const dayNum = d + 1;
                  const key = `${monthIdx}-${dayNum}`;
                  const info = lunationMap.get(key);
                  const phase = phaseEvents.get(key);
                  const isToday =
                    today.getFullYear() === year &&
                    today.getMonth() === monthIdx &&
                    today.getDate() === dayNum;

                  // Alternating lunation colors: gold for odd, sage for even
                  const lunIdx = info?.lunIdx ?? -1;
                  const isOddLunation = lunIdx % 2 === 1;
                  const tintColor = lunIdx >= 0
                    ? isOddLunation
                      ? "rgba(201, 168, 108, 0.08)"
                      : "rgba(139, 154, 125, 0.08)"
                    : "transparent";

                  // Check if this is the first day of a new lunation in this month
                  const prevKey = dayNum > 1 ? `${monthIdx}-${dayNum - 1}` : null;
                  const prevInfo = prevKey ? lunationMap.get(prevKey) : null;
                  const isLunationStart = prevInfo && info && prevInfo.lunIdx !== info.lunIdx && info.lunIdx >= 0;

                  const cellDate = new Date(year, monthIdx, dayNum);

                  return (
                    <div
                      key={d}
                      className={`relative aspect-square flex items-center justify-center rounded text-xs cursor-default ${
                        isToday ? "ring-1 ring-accent-sage" : ""
                      } ${isLunationStart ? "border-l-2 border-accent-gold/40" : ""}`}
                      style={{ background: isToday ? "rgba(139, 154, 125, 0.25)" : tintColor }}
                      title={`${MONTH_NAMES[monthIdx]} ${dayNum}${lunIdx >= 0 ? ` — Lunation ${lunIdx + 1}` : ""}${info ? ` — ${info.illum.toFixed(0)}%` : ""}`}
                    >
                      {phase ? (
                        <MiniMoon date={cellDate} size={18} glow={phase.type === "full"} />
                      ) : (
                        <span className={`text-[11px] ${isToday ? "text-accent-sage font-bold" : "text-muted"}`}>
                          {dayNum}
                        </span>
                      )}

                      {/* Lunation number label at start of lunar month */}
                      {isLunationStart && lunIdx >= 0 && (
                        <span className="absolute -top-0.5 -left-0.5 text-[7px] text-accent-gold font-bold leading-none">
                          {lunIdx + 1}
                        </span>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>

      {/* Legend */}
      <div className="mt-6 flex flex-wrap items-center justify-center gap-4 text-xs text-muted">
        <div className="flex items-center gap-1.5">
          <div className="w-3 h-3 rounded" style={{ background: "rgba(201, 168, 108, 0.08)", border: "1px solid rgba(201,168,108,0.3)" }} />
          <span>Odd lunations</span>
        </div>
        <div className="flex items-center gap-1.5">
          <div className="w-3 h-3 rounded" style={{ background: "rgba(139, 154, 125, 0.08)", border: "1px solid rgba(139,154,125,0.3)" }} />
          <span>Even lunations</span>
        </div>
        <div className="flex items-center gap-1.5">
          <div className="w-0.5 h-3 bg-accent-gold/40" />
          <span>Lunar month boundary</span>
        </div>
        <div className="flex items-center gap-1.5">
          <MiniMoon date={new Date(year, 0, 15)} size={14} />
          <span>Phase marker</span>
        </div>
      </div>

      <div className="mt-4 text-center text-sm text-muted">
        <span className="text-faint text-xs block">
          Lunar months don&rsquo;t align with Gregorian months &mdash; the colored bands drift ~11 days earlier each year.
          The diagonal color-change lines show where each lunation begins and ends.
        </span>
      </div>
    </>
  );
}
