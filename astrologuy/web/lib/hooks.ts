"use client";

import { useMemo } from "react";
import { getMoonPhase, getMoonSign, getMoonCycle, compute13MonthCalendar, type Lunation } from "./astro";

export function useMoonPhase(date?: Date) {
  return useMemo(() => getMoonPhase(date ?? new Date()), [date]);
}

export function useMoonSign(date?: Date) {
  return useMemo(() => getMoonSign(date ?? new Date()), [date]);
}

export function useMoonCycle(date?: Date) {
  return useMemo(() => getMoonCycle(date ?? new Date()), [date]);
}

export function useLunarCalendar(year: number): Lunation[] {
  return useMemo(() => compute13MonthCalendar(year), [year]);
}

export function formatMonthDay(d: Date): string {
  return `${d.toLocaleString("en", { month: "short" })} ${d.getDate()}`;
}

export function formatFullDate(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export function daysBetween(a: Date, b: Date): number {
  return Math.round(((b.getTime() - a.getTime()) / 86400000) * 100) / 100;
}
