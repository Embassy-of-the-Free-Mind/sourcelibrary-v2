// Chinese lunar calendar wrappers — extracted from lunar-mcp src/index.ts
// Uses lunar-typescript for Chinese calendar conversions

import { Solar, Lunar, LunarYear } from "lunar-typescript";
import { CHINESE_ANIMALS, HEAVENLY_STEMS } from "./constants";

function translateAnimal(chinese: string): string {
  return CHINESE_ANIMALS[chinese] ?? chinese;
}

function getStemElement(stem: string): string {
  return HEAVENLY_STEMS[stem]?.element ?? "Unknown";
}

export function getLunarBirthday(birthDate: Date) {
  const solar = Solar.fromDate(birthDate);
  const lunar = solar.getLunar();

  const lunarMonth = lunar.getMonth();
  const lunarDay = lunar.getDay();
  const animal = translateAnimal(lunar.getYearShengXiao());
  const element = getStemElement(lunar.getYearGan());
  const ganZhi = lunar.getYearInGanZhi();

  // Find next occurrence
  const now = new Date();
  const currentYear = now.getFullYear();
  let nextOccurrence: Date | null = null;

  for (let y = currentYear; y <= currentYear + 2; y++) {
    try {
      const nextLunar = Lunar.fromYmd(y, lunarMonth, lunarDay);
      const nextSolar = nextLunar.getSolar();
      const nextDate = new Date(nextSolar.getYear(), nextSolar.getMonth() - 1, nextSolar.getDay());
      if (nextDate >= now) {
        nextOccurrence = nextDate;
        break;
      }
    } catch {
      continue;
    }
  }

  return {
    lunar_month: lunarMonth,
    lunar_day: lunarDay,
    month_chinese: lunar.getMonthInChinese(),
    day_chinese: lunar.getDayInChinese(),
    animal,
    animal_chinese: lunar.getYearShengXiao(),
    element,
    gan_zhi: ganZhi,
    next_lunar_birthday: nextOccurrence,
  };
}

export function getZodiacInfo(year: number, birthDate?: Date) {
  let lunar: ReturnType<typeof Solar.prototype.getLunar>;
  let effectiveYear = year;

  if (birthDate) {
    const solar = Solar.fromDate(birthDate);
    lunar = solar.getLunar();
    effectiveYear = lunar.getYear();
  } else {
    const solar = Solar.fromYmd(year, 6, 15);
    lunar = solar.getLunar();
  }

  const animalChinese = lunar.getYearShengXiao();
  const animal = translateAnimal(animalChinese);
  const stem = lunar.getYearGan();
  const element = getStemElement(stem);
  const ganZhi = lunar.getYearInGanZhi();

  return {
    year: effectiveYear,
    animal,
    animal_chinese: animalChinese,
    element,
    heavenly_stem: stem,
    earthly_branch: lunar.getYearZhi(),
    gan_zhi: ganZhi,
    full_name: `${element} ${animal}`,
  };
}

export function convertSolarToLunar(date: Date) {
  const solar = Solar.fromDate(date);
  const lunar = solar.getLunar();
  return {
    year: lunar.getYear(),
    month: lunar.getMonth(),
    day: lunar.getDay(),
    year_chinese: lunar.getYearInChinese(),
    month_chinese: lunar.getMonthInChinese(),
    day_chinese: lunar.getDayInChinese(),
    animal: translateAnimal(lunar.getYearShengXiao()),
    gan_zhi: lunar.getYearInGanZhi(),
  };
}

export function hasLeapMonth(year: number): boolean {
  try {
    const ly = LunarYear.fromYear(year);
    return ly.getLeapMonth() > 0;
  } catch {
    return false;
  }
}

export function getLeapMonth(year: number): number {
  try {
    const ly = LunarYear.fromYear(year);
    return ly.getLeapMonth();
  } catch {
    return 0;
  }
}
