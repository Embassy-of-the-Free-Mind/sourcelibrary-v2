"use client";

import { useMemo, useState } from "react";
import { useAppState } from "@/lib/store";
import { useLunarCalendar, formatMonthDay, daysBetween } from "@/lib/hooks";
import { findBirthLunation } from "@/lib/astro";
import { getPhaseName } from "@/lib/astro";
import { SYNODIC_MONTH } from "@/lib/constants";

type ViewMode = "ideal" | "astronomical";

export function YearCalendar() {
  const { year, birthDate } = useAppState();
  const lunations = useLunarCalendar(year);
  const [viewMode, setViewMode] = useState<ViewMode>("ideal");
  const [hoveredDay, setHoveredDay] = useState<{
    lunation: number;
    day: number;
    gregorian: Date;
    phase: string;
    illumination: number;
  } | null>(null);

  const today = useMemo(() => new Date(), []);

  // Compute birthday info
  const birthInfo = useMemo(() => {
    if (!birthDate) return null;
    const info = findBirthLunation(birthDate);
    if (!info) return null;
    return info;
  }, [birthDate]);

  // Compute birthday positions in each lunation
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

  const totalDays = lunations.reduce((s, l) => s + l.length, 0);
  const leapCount = lunations.filter((l) => l.isLeap).length;

  const DAYS_LABELS = ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"];

  return (
    <div>
      {/* View mode toggle */}
      <div className="flex items-center justify-between mb-6">
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
          <button
            onClick={() => setViewMode("ideal")}
            className={`px-3 py-1.5 text-xs transition-colors ${
              viewMode === "ideal" ? "bg-accent-gold/15 text-accent-gold" : "text-muted hover:text-cream"
            }`}
          >
            Ideal (13x28)
          </button>
          <button
            onClick={() => setViewMode("astronomical")}
            className={`px-3 py-1.5 text-xs transition-colors ${
              viewMode === "astronomical" ? "bg-accent-gold/15 text-accent-gold" : "text-muted hover:text-cream"
            }`}
          >
            Astronomical
          </button>
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

      {/* Hover tooltip */}
      {hoveredDay && (
        <div className="fixed z-50 pointer-events-none bg-bg-card border border-border rounded-lg px-3 py-2 text-xs shadow-lg"
          style={{ top: "var(--tooltip-y, 0)", left: "var(--tooltip-x, 0)" }}>
          <div className="text-cream font-medium">{formatMonthDay(hoveredDay.gregorian)}</div>
          <div className="text-muted">{hoveredDay.phase} &middot; {hoveredDay.illumination}%</div>
        </div>
      )}

      {/* 13-month grid */}
      <div className={`grid gap-4 ${viewMode === "ideal"
        ? "grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4"
        : "grid-cols-1"
      }`}>
        {lunations.map((lun, lunIdx) => {
          const days = viewMode === "ideal" ? 28 : Math.round(lun.length);
          const fqDay = Math.round(daysBetween(lun.newMoon, lun.firstQuarter));
          const fmDay = Math.round(daysBetween(lun.newMoon, lun.fullMoon));
          const tqDay = Math.round(daysBetween(lun.newMoon, lun.thirdQuarter));
          const birthdayDate = birthdayPositions.get(lunIdx);
          const birthdayDay = birthdayDate
            ? Math.round(daysBetween(lun.newMoon, birthdayDate))
            : -1;
          const todayDay =
            today >= lun.newMoon && today < lun.nextNewMoon
              ? Math.round(daysBetween(lun.newMoon, today))
              : -1;

          if (viewMode === "ideal") {
            // Grid mode: 4 rows x 7 cols = 28 days
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
                {/* Month header */}
                <div className="flex items-baseline justify-between mb-3">
                  <div>
                    <span className="font-serif text-lg font-semibold text-accent-gold">
                      {lun.isLeap ? "Leap" : `Month ${lun.num}`}
                    </span>
                    {lun.chineseMonth && !lun.isLeap && (
                      <span className="text-faint text-xs ml-2">Ch. {lun.chineseMonth}</span>
                    )}
                  </div>
                  <span className="text-faint text-xs">
                    {formatMonthDay(lun.newMoon)}
                  </span>
                </div>

                {/* Day labels */}
                <div className="grid grid-cols-7 gap-0.5 mb-1">
                  {DAYS_LABELS.map((d) => (
                    <div key={d} className="text-center text-[10px] text-faint">
                      {d}
                    </div>
                  ))}
                </div>

                {/* Day grid: 4 weeks x 7 days */}
                <div className="grid grid-cols-7 gap-0.5">
                  {Array.from({ length: 28 }, (_, d) => {
                    const isNew = d === 0;
                    const isFQ = d === 7;
                    const isFull = d === 14;
                    const isTQ = d === 21;
                    const isBirthday = d === birthdayDay;
                    const isToday = d === todayDay;
                    const isWaxing = d < 14;

                    // Phase icon for key days
                    let phaseIcon = "";
                    if (isNew) phaseIcon = "\uD83C\uDF11";
                    else if (isFQ) phaseIcon = "\uD83C\uDF13";
                    else if (isFull) phaseIcon = "\uD83C\uDF15";
                    else if (isTQ) phaseIcon = "\uD83C\uDF17";

                    return (
                      <div
                        key={d}
                        className={`relative aspect-square flex items-center justify-center rounded text-xs cursor-default transition-colors ${
                          isBirthday
                            ? "bg-accent-rust/25 text-accent-rust ring-1 ring-accent-rust"
                            : isToday
                            ? "bg-accent-sage/25 text-accent-sage ring-1 ring-accent-sage"
                            : isFull
                            ? "bg-accent-gold/20 text-accent-gold"
                            : isWaxing
                            ? "bg-accent-gold/5 text-muted hover:bg-accent-gold/10"
                            : "bg-accent-sage/5 text-muted hover:bg-accent-sage/10"
                        }`}
                        title={phaseIcon ? `Day ${d + 1}` : `Day ${d + 1}`}
                      >
                        {phaseIcon ? (
                          <span className="text-sm leading-none">{phaseIcon}</span>
                        ) : (
                          <span className="text-[11px]">{d + 1}</span>
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
                    <span className="text-[10px] bg-accent-violet/15 rounded px-2 py-0.5 text-accent-violet">
                      Leap
                    </span>
                  )}
                  {birthdayDay >= 0 && (
                    <span className="text-[10px] bg-accent-rust/15 rounded px-2 py-0.5 text-accent-rust font-medium">
                      Birthday: {formatMonthDay(birthdayDate!)}
                    </span>
                  )}
                  {todayDay >= 0 && (
                    <span className="text-[10px] bg-accent-sage/15 rounded px-2 py-0.5 text-accent-sage">
                      Today
                    </span>
                  )}
                </div>
              </div>
            );
          }

          // Astronomical mode: horizontal lunation bars (like the HTML demo)
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

                {/* Phase timeline */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1 mb-2">
                    {[
                      { emoji: "\uD83C\uDF11", date: lun.newMoon, label: "New" },
                      { emoji: "\uD83C\uDF13", date: lun.firstQuarter, label: "1st Qtr" },
                      { emoji: "\uD83C\uDF15", date: lun.fullMoon, label: "Full" },
                      { emoji: "\uD83C\uDF17", date: lun.thirdQuarter, label: "3rd Qtr" },
                      { emoji: "\uD83C\uDF11", date: lun.nextNewMoon, label: "New" },
                    ].map((p, pi) => (
                      <div key={pi} className="flex items-center flex-1">
                        <div className="flex flex-col items-center flex-1">
                          <span className="text-xl">{p.emoji}</span>
                          <span className="text-[10px] text-faint mt-0.5">{formatMonthDay(p.date)}</span>
                          <span className="text-[9px] text-muted uppercase tracking-wider">{p.label}</span>
                        </div>
                        {pi < 4 && <div className="w-4 h-px bg-border flex-shrink-0" />}
                      </div>
                    ))}
                  </div>

                  {/* Day intensity bar */}
                  <div className="flex gap-px">
                    {Array.from({ length: days }, (_, d) => {
                      const isBday = d === birthdayDay;
                      const isTod = d === todayDay;
                      return (
                        <div
                          key={d}
                          className={`h-1 flex-1 rounded-sm ${
                            isBday
                              ? "bg-accent-rust h-1.5"
                              : isTod
                              ? "bg-accent-sage h-1.5"
                              : d === 0
                              ? "bg-white/15"
                              : d === fmDay
                              ? "bg-accent-gold"
                              : d < fmDay
                              ? "bg-accent-gold/20"
                              : "bg-accent-sage/20"
                          }`}
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
                      <span className="text-[10px] bg-accent-violet/15 rounded px-2 py-0.5 text-accent-violet">
                        Leap month
                      </span>
                    )}
                    {birthdayDay >= 0 && birthdayDate && (
                      <span className="text-[10px] bg-accent-rust/15 rounded px-2 py-0.5 text-accent-rust font-medium">
                        Lunar birthday: {formatMonthDay(birthdayDate)}
                      </span>
                    )}
                    {todayDay >= 0 && (
                      <span className="text-[10px] bg-accent-sage/15 rounded px-2 py-0.5 text-accent-sage">
                        Today
                      </span>
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

      {/* "Day Out of Time" note for ideal view */}
      {viewMode === "ideal" && (
        <div className="mt-6 text-center text-sm text-muted">
          <span className="text-accent-gold">13 &times; 28 = 364</span> days + 1 "Day Out of Time" = 365
          <br />
          <span className="text-faint text-xs mt-1 block">
            Real lunations average {SYNODIC_MONTH} days. The ~1.5 extra days per month accumulate across the year.
          </span>
        </div>
      )}
    </div>
  );
}
