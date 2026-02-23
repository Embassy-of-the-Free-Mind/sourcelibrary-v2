#!/usr/bin/env node

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  Tool,
} from "@modelcontextprotocol/sdk/types.js";
import * as Astronomy from "astronomy-engine";
import { Solar, Lunar } from "lunar-typescript";

// ── Constants ───────────────────────────────────────────────────────────

const WESTERN_ZODIAC = [
  { name: "Aries", symbol: "\u2648", element: "Fire", modality: "Cardinal", start: 0 },
  { name: "Taurus", symbol: "\u2649", element: "Earth", modality: "Fixed", start: 30 },
  { name: "Gemini", symbol: "\u264A", element: "Air", modality: "Mutable", start: 60 },
  { name: "Cancer", symbol: "\u264B", element: "Water", modality: "Cardinal", start: 90 },
  { name: "Leo", symbol: "\u264C", element: "Fire", modality: "Fixed", start: 120 },
  { name: "Virgo", symbol: "\u264D", element: "Earth", modality: "Mutable", start: 150 },
  { name: "Libra", symbol: "\u264E", element: "Air", modality: "Cardinal", start: 180 },
  { name: "Scorpio", symbol: "\u264F", element: "Water", modality: "Fixed", start: 210 },
  { name: "Sagittarius", symbol: "\u2650", element: "Fire", modality: "Mutable", start: 240 },
  { name: "Capricorn", symbol: "\u2651", element: "Earth", modality: "Cardinal", start: 270 },
  { name: "Aquarius", symbol: "\u2652", element: "Air", modality: "Fixed", start: 300 },
  { name: "Pisces", symbol: "\u2653", element: "Water", modality: "Mutable", start: 330 },
] as const;

const CHINESE_ANIMALS: Record<string, string> = {
  "\u9F20": "Rat", "\u725B": "Ox", "\u864E": "Tiger", "\u5154": "Rabbit",
  "\u9F99": "Dragon", "\u86C7": "Snake", "\u9A6C": "Horse", "\u7F8A": "Goat",
  "\u7334": "Monkey", "\u9E21": "Rooster", "\u72D7": "Dog", "\u732A": "Pig",
};

const HEAVENLY_STEMS: Record<string, { pinyin: string; element: string }> = {
  "\u7532": { pinyin: "Ji\u01CE", element: "Wood" },
  "\u4E59": { pinyin: "Y\u01D0", element: "Wood" },
  "\u4E19": { pinyin: "B\u01D0ng", element: "Fire" },
  "\u4E01": { pinyin: "D\u012Bng", element: "Fire" },
  "\u620A": { pinyin: "W\u00F9", element: "Earth" },
  "\u5DF1": { pinyin: "J\u01D0", element: "Earth" },
  "\u5E9A": { pinyin: "G\u0113ng", element: "Metal" },
  "\u8F9B": { pinyin: "X\u012Bn", element: "Metal" },
  "\u58EC": { pinyin: "R\u00E9n", element: "Water" },
  "\u7678": { pinyin: "Gu\u01D0", element: "Water" },
};

const ZODIAC_TRAITS: Record<string, {
  personality: string;
  strengths: string[];
  compatible: string[];
  incompatible: string[];
  lucky_numbers: number[];
  lucky_colors: string[];
}> = {
  Rat: {
    personality: "Quick-witted, resourceful, and versatile. Rats are clever and adaptable, with strong intuition and a keen eye for opportunity.",
    strengths: ["Intelligence", "Adaptability", "Charm", "Resourcefulness"],
    compatible: ["Dragon", "Monkey", "Ox"],
    incompatible: ["Horse", "Goat"],
    lucky_numbers: [2, 3],
    lucky_colors: ["blue", "gold", "green"],
  },
  Ox: {
    personality: "Diligent, dependable, and determined. The Ox is patient and methodical, building success through steady effort.",
    strengths: ["Reliability", "Patience", "Honesty", "Determination"],
    compatible: ["Rat", "Snake", "Rooster"],
    incompatible: ["Tiger", "Dragon", "Horse", "Goat"],
    lucky_numbers: [1, 4],
    lucky_colors: ["white", "yellow", "green"],
  },
  Tiger: {
    personality: "Brave, confident, and competitive. Tigers are natural leaders who inspire others with their courage and passion.",
    strengths: ["Courage", "Confidence", "Charisma", "Leadership"],
    compatible: ["Dragon", "Horse", "Pig"],
    incompatible: ["Ox", "Tiger", "Snake", "Monkey"],
    lucky_numbers: [1, 3, 4],
    lucky_colors: ["blue", "grey", "orange"],
  },
  Rabbit: {
    personality: "Gentle, quiet, and elegant. Rabbits are diplomatic and compassionate, with a refined artistic sensibility.",
    strengths: ["Gentleness", "Sensitivity", "Compassion", "Elegance"],
    compatible: ["Goat", "Monkey", "Dog", "Pig"],
    incompatible: ["Snake", "Rooster"],
    lucky_numbers: [3, 4, 6],
    lucky_colors: ["red", "pink", "purple", "blue"],
  },
  Dragon: {
    personality: "Confident, ambitious, and energetic. Dragons are charismatic visionaries who pursue their goals with fiery determination.",
    strengths: ["Ambition", "Energy", "Courage", "Charisma"],
    compatible: ["Rooster", "Rat", "Monkey"],
    incompatible: ["Ox", "Goat", "Dog"],
    lucky_numbers: [1, 6, 7],
    lucky_colors: ["gold", "silver", "grey"],
  },
  Snake: {
    personality: "Enigmatic, intelligent, and wise. Snakes are deep thinkers with strong intuition and a talent for seeing beneath the surface.",
    strengths: ["Wisdom", "Intelligence", "Intuition", "Elegance"],
    compatible: ["Dragon", "Rooster"],
    incompatible: ["Tiger", "Rabbit", "Snake", "Goat", "Pig"],
    lucky_numbers: [2, 8, 9],
    lucky_colors: ["black", "red", "yellow"],
  },
  Horse: {
    personality: "Energetic, free-spirited, and warm-hearted. Horses are independent adventurers with infectious enthusiasm.",
    strengths: ["Energy", "Independence", "Warmth", "Enthusiasm"],
    compatible: ["Tiger", "Goat", "Rabbit"],
    incompatible: ["Rat", "Ox", "Rooster"],
    lucky_numbers: [2, 3, 7],
    lucky_colors: ["brown", "yellow", "purple"],
  },
  Goat: {
    personality: "Calm, gentle, and sympathetic. Goats are creative souls with a deep appreciation for beauty and harmony.",
    strengths: ["Creativity", "Gentleness", "Sympathy", "Perseverance"],
    compatible: ["Rabbit", "Horse", "Pig"],
    incompatible: ["Ox", "Tiger", "Dog"],
    lucky_numbers: [2, 7],
    lucky_colors: ["brown", "red", "purple"],
  },
  Monkey: {
    personality: "Sharp, clever, and curious. Monkeys are inventive problem-solvers with a mischievous sense of humor.",
    strengths: ["Cleverness", "Curiosity", "Wit", "Versatility"],
    compatible: ["Ox", "Rabbit"],
    incompatible: ["Tiger", "Pig"],
    lucky_numbers: [4, 9],
    lucky_colors: ["white", "blue", "gold"],
  },
  Rooster: {
    personality: "Observant, hardworking, and courageous. Roosters are honest and detail-oriented, with strong convictions.",
    strengths: ["Honesty", "Diligence", "Communication", "Courage"],
    compatible: ["Ox", "Snake"],
    incompatible: ["Rat", "Rabbit", "Horse", "Rooster", "Dog"],
    lucky_numbers: [5, 7, 8],
    lucky_colors: ["gold", "brown", "yellow"],
  },
  Dog: {
    personality: "Loyal, honest, and amiable. Dogs are faithful companions who value justice and stand by those they love.",
    strengths: ["Loyalty", "Honesty", "Bravery", "Kindness"],
    compatible: ["Rabbit"],
    incompatible: ["Dragon", "Goat", "Rooster"],
    lucky_numbers: [3, 4, 9],
    lucky_colors: ["red", "green", "purple"],
  },
  Pig: {
    personality: "Compassionate, generous, and diligent. Pigs are warm-hearted optimists who enjoy life's pleasures and share freely.",
    strengths: ["Generosity", "Compassion", "Diligence", "Optimism"],
    compatible: ["Tiger", "Rabbit", "Goat"],
    incompatible: ["Snake", "Monkey"],
    lucky_numbers: [2, 5, 8],
    lucky_colors: ["yellow", "grey", "brown", "gold"],
  },
};

const PHASE_NAMES = [
  { name: "New Moon", emoji: "\uD83C\uDF11", min: 0, max: 45 },
  { name: "Waxing Crescent", emoji: "\uD83C\uDF12", min: 45, max: 90 },
  { name: "First Quarter", emoji: "\uD83C\uDF13", min: 90, max: 135 },
  { name: "Waxing Gibbous", emoji: "\uD83C\uDF14", min: 135, max: 180 },
  { name: "Full Moon", emoji: "\uD83C\uDF15", min: 180, max: 225 },
  { name: "Waning Gibbous", emoji: "\uD83C\uDF16", min: 225, max: 270 },
  { name: "Third Quarter", emoji: "\uD83C\uDF17", min: 270, max: 315 },
  { name: "Waning Crescent", emoji: "\uD83C\uDF18", min: 315, max: 360 },
] as const;

const QUARTER_NAMES = ["New Moon", "First Quarter", "Full Moon", "Third Quarter"] as const;
const QUARTER_EMOJIS = ["\uD83C\uDF11", "\uD83C\uDF13", "\uD83C\uDF15", "\uD83C\uDF17"] as const;

// ── Helper Functions ────────────────────────────────────────────────────

function parseDate(dateStr?: string): Date {
  if (!dateStr) return new Date();
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) throw new Error(`Invalid date: ${dateStr}`);
  return d;
}

function getPhaseName(angle: number): { name: string; emoji: string } {
  const normalized = ((angle % 360) + 360) % 360;
  const phase = PHASE_NAMES.find((p) => normalized >= p.min && normalized < p.max);
  return phase ?? PHASE_NAMES[0];
}

function getZodiacSign(longitude: number) {
  const normalized = ((longitude % 360) + 360) % 360;
  const index = Math.floor(normalized / 30);
  const sign = WESTERN_ZODIAC[index];
  const degrees = normalized - sign.start;
  return { ...sign, degrees: Math.round(degrees * 100) / 100, longitude: Math.round(normalized * 100) / 100 };
}

function translateAnimal(chinese: string): string {
  return CHINESE_ANIMALS[chinese] ?? chinese;
}

function getStemElement(stem: string): string {
  return HEAVENLY_STEMS[stem]?.element ?? "Unknown";
}

function formatDateTime(d: Date): string {
  return d.toISOString().replace("T", " ").replace(/\.\d+Z$/, " UTC");
}

function formatDate(d: Date): string {
  return d.toISOString().split("T")[0];
}

function getMoonAge(date: Date): number {
  // Find the most recent new moon before this date
  const prevNew = Astronomy.SearchMoonPhase(0, new Date(date.getTime() - 30 * 86400000), 35);
  if (!prevNew) return 0;
  const diffMs = date.getTime() - prevNew.date.getTime();
  return Math.round((diffMs / 86400000) * 100) / 100;
}

function isSupermoon(date: Date): boolean {
  // A supermoon occurs when a full moon coincides with perigee (within ~2 days)
  const perigee = Astronomy.SearchLunarApsis(new Date(date.getTime() - 15 * 86400000));
  if (perigee.kind !== Astronomy.ApsisKind.Pericenter) return false;
  const diffDays = Math.abs(date.getTime() - perigee.time.date.getTime()) / 86400000;
  return diffDays < 2;
}

// ── Tool Definitions ────────────────────────────────────────────────────

const TOOLS: Tool[] = [
  {
    name: "get_moon_phase",
    description:
      "Get the current moon phase including phase name, illumination percentage, moon age in days, and emoji. Optionally specify a date.",
    inputSchema: {
      type: "object" as const,
      properties: {
        date: {
          type: "string",
          description: "Date in YYYY-MM-DD format (default: today)",
        },
      },
      required: [],
    },
  },
  {
    name: "get_lunar_birthday",
    description:
      "Calculate someone's Chinese lunar birthday from their Gregorian birth date. Returns the lunar month and day, zodiac animal, and when the next lunar birthday falls.",
    inputSchema: {
      type: "object" as const,
      properties: {
        birth_date: {
          type: "string",
          description: "Birth date in YYYY-MM-DD format",
        },
      },
      required: ["birth_date"],
    },
  },
  {
    name: "get_lunar_calendar",
    description:
      "Get all moon phases (new, first quarter, full, third quarter) for a given month and year.",
    inputSchema: {
      type: "object" as const,
      properties: {
        year: {
          type: "number",
          description: "Year (default: current year)",
        },
        month: {
          type: "number",
          description: "Month 1-12 (default: current month)",
        },
      },
      required: [],
    },
  },
  {
    name: "get_moon_sign",
    description:
      "Get the Western zodiac sign the Moon is currently in, based on its ecliptic longitude. Includes sign name, symbol, element, modality, and position in degrees.",
    inputSchema: {
      type: "object" as const,
      properties: {
        date: {
          type: "string",
          description: "Date in YYYY-MM-DD format (default: today)",
        },
      },
      required: [],
    },
  },
  {
    name: "get_lunar_events",
    description:
      "Get upcoming lunar events including new moons, full moons, supermoons, and eclipses for the next N days.",
    inputSchema: {
      type: "object" as const,
      properties: {
        date: {
          type: "string",
          description: "Start date in YYYY-MM-DD format (default: today)",
        },
        days: {
          type: "number",
          description: "Number of days to look ahead (default: 90, max: 365)",
        },
      },
      required: [],
    },
  },
  {
    name: "get_moonrise_moonset",
    description:
      "Get moonrise and moonset times for a specific location and date. Requires latitude and longitude.",
    inputSchema: {
      type: "object" as const,
      properties: {
        latitude: {
          type: "number",
          description: "Latitude in degrees (-90 to 90, north positive)",
        },
        longitude: {
          type: "number",
          description: "Longitude in degrees (-180 to 180, east positive)",
        },
        date: {
          type: "string",
          description: "Date in YYYY-MM-DD format (default: today)",
        },
      },
      required: ["latitude", "longitude"],
    },
  },
  {
    name: "get_moon_cycle",
    description:
      "Get details about the current lunation (moon cycle): age in days, trend (waxing/waning), current phase, and timing of the next phase transition.",
    inputSchema: {
      type: "object" as const,
      properties: {
        date: {
          type: "string",
          description: "Date in YYYY-MM-DD format (default: today)",
        },
      },
      required: [],
    },
  },
  {
    name: "get_eclipse_forecast",
    description:
      "Get upcoming lunar and solar eclipses with type (penumbral, partial, total, annular) and visibility details.",
    inputSchema: {
      type: "object" as const,
      properties: {
        date: {
          type: "string",
          description: "Start date in YYYY-MM-DD format (default: today)",
        },
        count: {
          type: "number",
          description: "Number of eclipses to find (default: 5, max: 20)",
        },
      },
      required: [],
    },
  },
  {
    name: "convert_lunar_date",
    description:
      "Convert between Gregorian (solar) and Chinese lunar calendar dates. Specify either a solar date to get the lunar equivalent, or a lunar date to get the solar equivalent.",
    inputSchema: {
      type: "object" as const,
      properties: {
        solar_date: {
          type: "string",
          description: "Gregorian date in YYYY-MM-DD format (converts to lunar)",
        },
        lunar_year: {
          type: "number",
          description: "Lunar year (converts to solar)",
        },
        lunar_month: {
          type: "number",
          description: "Lunar month 1-12 (converts to solar)",
        },
        lunar_day: {
          type: "number",
          description: "Lunar day 1-30 (converts to solar)",
        },
      },
      required: [],
    },
  },
  {
    name: "get_zodiac_info",
    description:
      "Get Chinese zodiac information for a year or birth date. Returns the zodiac animal, element, personality traits, compatibility, and lucky attributes.",
    inputSchema: {
      type: "object" as const,
      properties: {
        year: {
          type: "number",
          description: "Year to look up (default: current year)",
        },
        date: {
          type: "string",
          description: "Birth date in YYYY-MM-DD format (overrides year if provided)",
        },
      },
      required: [],
    },
  },
  {
    name: "get_13_month_calendar",
    description:
      "Get a 13-lunation calendar for a given year. Each lunation spans from one new moon to the next (~29.5 days). Returns all 4 quarter dates per lunation, length in days, and Chinese calendar leap month info. Optionally highlights the lunar birthday if a birth date is provided.",
    inputSchema: {
      type: "object" as const,
      properties: {
        year: {
          type: "number",
          description: "Year (default: current year)",
        },
        birth_date: {
          type: "string",
          description: "Birth date in YYYY-MM-DD format — highlights which lunation contains the lunar birthday and the Gregorian date it falls on this year",
        },
      },
      required: [],
    },
  },
];

// ── Tool Implementations ────────────────────────────────────────────────

function handleGetMoonPhase(args: Record<string, unknown>) {
  const date = parseDate(args.date as string | undefined);
  const angle = Astronomy.MoonPhase(date);
  const illum = Astronomy.Illumination(Astronomy.Body.Moon, date);
  const phase = getPhaseName(angle);
  const age = getMoonAge(date);

  return {
    date: formatDate(date),
    phase_name: phase.name,
    phase_emoji: phase.emoji,
    phase_angle: Math.round(angle * 100) / 100,
    illumination_percent: Math.round(illum.phase_fraction * 10000) / 100,
    moon_age_days: age,
    trend: angle < 180 ? "waxing" : "waning",
  };
}

function handleGetLunarBirthday(args: Record<string, unknown>) {
  const birthDate = parseDate(args.birth_date as string);
  const solar = Solar.fromDate(birthDate);
  const lunar = solar.getLunar();

  const lunarMonth = lunar.getMonth();
  const lunarDay = lunar.getDay();
  const animal = translateAnimal(lunar.getYearShengXiao());
  const ganZhi = lunar.getYearInGanZhi();
  const stem = lunar.getYearGan();
  const element = getStemElement(stem);

  // Find next occurrence of this lunar birthday
  const now = new Date();
  const currentYear = now.getFullYear();
  let nextOccurrence: string | null = null;

  for (let y = currentYear; y <= currentYear + 2; y++) {
    try {
      const nextLunar = Lunar.fromYmd(y, lunarMonth, lunarDay);
      const nextSolar = nextLunar.getSolar();
      const nextDate = new Date(nextSolar.getYear(), nextSolar.getMonth() - 1, nextSolar.getDay());
      if (nextDate >= now) {
        nextOccurrence = formatDate(nextDate);
        break;
      }
    } catch {
      // Skip years where this lunar date doesn't exist
      continue;
    }
  }

  return {
    birth_date_solar: formatDate(birthDate),
    birth_date_lunar: {
      year: lunar.getYear(),
      month: lunarMonth,
      day: lunarDay,
      month_chinese: lunar.getMonthInChinese(),
      day_chinese: lunar.getDayInChinese(),
    },
    zodiac: {
      animal,
      animal_chinese: lunar.getYearShengXiao(),
      element,
      gan_zhi: ganZhi,
    },
    next_lunar_birthday: nextOccurrence,
  };
}

function handleGetLunarCalendar(args: Record<string, unknown>) {
  const now = new Date();
  const year = (args.year as number) ?? now.getFullYear();
  const month = (args.month as number) ?? now.getMonth() + 1;

  const startDate = new Date(year, month - 1, 1);
  const endDate = new Date(year, month, 0, 23, 59, 59);

  const phases: Array<{
    date: string;
    time: string;
    quarter: number;
    name: string;
    emoji: string;
  }> = [];

  // Search starting a few days before the month
  let mq = Astronomy.SearchMoonQuarter(new Date(startDate.getTime() - 8 * 86400000));
  for (let i = 0; i < 12; i++) {
    const phaseDate = mq.time.date;
    if (phaseDate >= startDate && phaseDate <= endDate) {
      phases.push({
        date: formatDate(phaseDate),
        time: formatDateTime(phaseDate),
        quarter: mq.quarter,
        name: QUARTER_NAMES[mq.quarter],
        emoji: QUARTER_EMOJIS[mq.quarter],
      });
    }
    if (phaseDate > endDate) break;
    mq = Astronomy.NextMoonQuarter(mq);
  }

  return {
    year,
    month,
    phases,
  };
}

function handleGetMoonSign(args: Record<string, unknown>) {
  const date = parseDate(args.date as string | undefined);
  const ecl = Astronomy.EclipticGeoMoon(date);
  const sign = getZodiacSign(ecl.lon);

  return {
    date: formatDate(date),
    sign: sign.name,
    symbol: sign.symbol,
    element: sign.element,
    modality: sign.modality,
    degrees_in_sign: sign.degrees,
    ecliptic_longitude: sign.longitude,
    position_description: `${sign.degrees.toFixed(1)}\u00B0 ${sign.name}`,
  };
}

function handleGetLunarEvents(args: Record<string, unknown>) {
  const date = parseDate(args.date as string | undefined);
  const days = Math.min((args.days as number) ?? 90, 365);
  const endDate = new Date(date.getTime() + days * 86400000);

  const events: Array<{
    date: string;
    time: string;
    type: string;
    name: string;
    emoji: string;
    details?: Record<string, unknown>;
  }> = [];

  // Find all quarter phases
  let mq = Astronomy.SearchMoonQuarter(date);
  while (mq.time.date <= endDate) {
    const evt: (typeof events)[0] = {
      date: formatDate(mq.time.date),
      time: formatDateTime(mq.time.date),
      type: mq.quarter === 0 ? "new_moon" : mq.quarter === 2 ? "full_moon" : "quarter",
      name: QUARTER_NAMES[mq.quarter],
      emoji: QUARTER_EMOJIS[mq.quarter],
    };

    if (mq.quarter === 2 && isSupermoon(mq.time.date)) {
      evt.type = "supermoon";
      evt.name = "Supermoon (Full Moon at perigee)";
      evt.emoji = "\uD83C\uDF1D";
    }

    events.push(evt);
    mq = Astronomy.NextMoonQuarter(mq);
  }

  // Find lunar eclipses
  let lunarEcl = Astronomy.SearchLunarEclipse(date);
  while (lunarEcl.peak.date <= endDate) {
    events.push({
      date: formatDate(lunarEcl.peak.date),
      time: formatDateTime(lunarEcl.peak.date),
      type: "lunar_eclipse",
      name: `${capitalize(lunarEcl.kind)} Lunar Eclipse`,
      emoji: "\uD83C\uDF11\uD83C\uDF15",
      details: {
        kind: lunarEcl.kind,
        obscuration: Math.round(lunarEcl.obscuration * 100) / 100,
        duration_minutes: Math.round(lunarEcl.sd_penum * 2),
      },
    });
    lunarEcl = Astronomy.NextLunarEclipse(lunarEcl.peak);
  }

  // Find solar eclipses
  let solarEcl = Astronomy.SearchGlobalSolarEclipse(date);
  while (solarEcl.peak.date <= endDate) {
    events.push({
      date: formatDate(solarEcl.peak.date),
      time: formatDateTime(solarEcl.peak.date),
      type: "solar_eclipse",
      name: `${capitalize(solarEcl.kind)} Solar Eclipse`,
      emoji: "\uD83C\uDF1E\uD83C\uDF11",
      details: {
        kind: solarEcl.kind,
        peak_latitude: solarEcl.latitude != null ? Math.round(solarEcl.latitude * 100) / 100 : null,
        peak_longitude: solarEcl.longitude != null ? Math.round(solarEcl.longitude * 100) / 100 : null,
      },
    });
    solarEcl = Astronomy.NextGlobalSolarEclipse(solarEcl.peak);
  }

  // Sort by date
  events.sort((a, b) => a.date.localeCompare(b.date));

  return {
    start_date: formatDate(date),
    days,
    event_count: events.length,
    events,
  };
}

function handleGetMoonriseMoonset(args: Record<string, unknown>) {
  const lat = args.latitude as number;
  const lon = args.longitude as number;
  const date = parseDate(args.date as string | undefined);

  const observer = new Astronomy.Observer(lat, lon, 0);

  // Search for rise and set within +/- 1 day of the given date
  const rise = Astronomy.SearchRiseSet(Astronomy.Body.Moon, observer, +1, date, 1);
  const set = Astronomy.SearchRiseSet(Astronomy.Body.Moon, observer, -1, date, 1);

  // Also get the current moon position
  const illum = Astronomy.Illumination(Astronomy.Body.Moon, date);
  const angle = Astronomy.MoonPhase(date);
  const phase = getPhaseName(angle);

  return {
    date: formatDate(date),
    location: { latitude: lat, longitude: lon },
    moonrise: rise ? formatDateTime(rise.date) : "Moon does not rise on this date",
    moonset: set ? formatDateTime(set.date) : "Moon does not set on this date",
    current_phase: phase.name,
    illumination_percent: Math.round(illum.phase_fraction * 10000) / 100,
  };
}

function handleGetMoonCycle(args: Record<string, unknown>) {
  const date = parseDate(args.date as string | undefined);
  const angle = Astronomy.MoonPhase(date);
  const phase = getPhaseName(angle);
  const age = getMoonAge(date);
  const illum = Astronomy.Illumination(Astronomy.Body.Moon, date);

  // Find the last and next new moons to define the lunation
  const prevNew = Astronomy.SearchMoonPhase(0, new Date(date.getTime() - 30 * 86400000), 35);
  const nextNew = Astronomy.SearchMoonPhase(0, date, 30);

  // Find the next quarter phase
  const nextQuarter = Astronomy.SearchMoonQuarter(date);

  const synodicMonth = 29.53059;
  const lunationProgress = (age / synodicMonth) * 100;

  return {
    date: formatDate(date),
    current_phase: phase.name,
    phase_emoji: phase.emoji,
    moon_age_days: age,
    lunation_progress_percent: Math.round(lunationProgress * 10) / 10,
    synodic_month_days: synodicMonth,
    trend: angle < 180 ? "waxing" : "waning",
    illumination_percent: Math.round(illum.phase_fraction * 10000) / 100,
    current_lunation: {
      started: prevNew ? formatDateTime(prevNew.date) : null,
      ends: nextNew ? formatDateTime(nextNew.date) : null,
    },
    next_phase: {
      name: QUARTER_NAMES[nextQuarter.quarter],
      emoji: QUARTER_EMOJIS[nextQuarter.quarter],
      date: formatDate(nextQuarter.time.date),
      time: formatDateTime(nextQuarter.time.date),
      days_away: Math.round(((nextQuarter.time.date.getTime() - date.getTime()) / 86400000) * 10) / 10,
    },
  };
}

function handleGetEclipseForecast(args: Record<string, unknown>) {
  const date = parseDate(args.date as string | undefined);
  const count = Math.min((args.count as number) ?? 5, 20);

  const eclipses: Array<{
    date: string;
    time: string;
    type: "lunar" | "solar";
    kind: string;
    details: Record<string, unknown>;
  }> = [];

  // Find lunar eclipses
  let lunarEcl = Astronomy.SearchLunarEclipse(date);
  for (let i = 0; i < count; i++) {
    eclipses.push({
      date: formatDate(lunarEcl.peak.date),
      time: formatDateTime(lunarEcl.peak.date),
      type: "lunar",
      kind: lunarEcl.kind,
      details: {
        obscuration_percent: Math.round(lunarEcl.obscuration * 10000) / 100,
        penumbral_duration_minutes: Math.round(lunarEcl.sd_penum * 2),
        partial_duration_minutes: lunarEcl.sd_partial > 0 ? Math.round(lunarEcl.sd_partial * 2) : null,
        total_duration_minutes: lunarEcl.sd_total > 0 ? Math.round(lunarEcl.sd_total * 2) : null,
      },
    });
    lunarEcl = Astronomy.NextLunarEclipse(lunarEcl.peak);
  }

  // Find solar eclipses
  let solarEcl = Astronomy.SearchGlobalSolarEclipse(date);
  for (let i = 0; i < count; i++) {
    eclipses.push({
      date: formatDate(solarEcl.peak.date),
      time: formatDateTime(solarEcl.peak.date),
      type: "solar",
      kind: solarEcl.kind,
      details: {
        peak_latitude: solarEcl.latitude != null ? Math.round(solarEcl.latitude * 100) / 100 : null,
        peak_longitude: solarEcl.longitude != null ? Math.round(solarEcl.longitude * 100) / 100 : null,
        distance_km: Math.round(solarEcl.distance),
      },
    });
    solarEcl = Astronomy.NextGlobalSolarEclipse(solarEcl.peak);
  }

  // Sort by date and take only `count` total
  eclipses.sort((a, b) => a.date.localeCompare(b.date));

  return {
    start_date: formatDate(date),
    total_found: eclipses.length,
    eclipses: eclipses.slice(0, count),
  };
}

function handleConvertLunarDate(args: Record<string, unknown>) {
  const solarDateStr = args.solar_date as string | undefined;
  const lunarYear = args.lunar_year as number | undefined;
  const lunarMonth = args.lunar_month as number | undefined;
  const lunarDay = args.lunar_day as number | undefined;

  if (solarDateStr) {
    // Solar -> Lunar
    const date = parseDate(solarDateStr);
    const solar = Solar.fromDate(date);
    const lunar = solar.getLunar();
    const animal = translateAnimal(lunar.getYearShengXiao());

    return {
      direction: "solar_to_lunar",
      solar: {
        date: formatDate(date),
        year: solar.getYear(),
        month: solar.getMonth(),
        day: solar.getDay(),
      },
      lunar: {
        year: lunar.getYear(),
        month: lunar.getMonth(),
        day: lunar.getDay(),
        year_chinese: lunar.getYearInChinese(),
        month_chinese: lunar.getMonthInChinese(),
        day_chinese: lunar.getDayInChinese(),
        gan_zhi_year: lunar.getYearInGanZhi(),
        zodiac_animal: animal,
        zodiac_animal_chinese: lunar.getYearShengXiao(),
      },
    };
  } else if (lunarYear != null && lunarMonth != null && lunarDay != null) {
    // Lunar -> Solar
    const lunar = Lunar.fromYmd(lunarYear, lunarMonth, lunarDay);
    const solar = lunar.getSolar();
    const animal = translateAnimal(lunar.getYearShengXiao());

    return {
      direction: "lunar_to_solar",
      lunar: {
        year: lunarYear,
        month: lunarMonth,
        day: lunarDay,
        year_chinese: lunar.getYearInChinese(),
        month_chinese: lunar.getMonthInChinese(),
        day_chinese: lunar.getDayInChinese(),
        gan_zhi_year: lunar.getYearInGanZhi(),
        zodiac_animal: animal,
      },
      solar: {
        date: `${solar.getYear()}-${String(solar.getMonth()).padStart(2, "0")}-${String(solar.getDay()).padStart(2, "0")}`,
        year: solar.getYear(),
        month: solar.getMonth(),
        day: solar.getDay(),
      },
    };
  } else {
    throw new Error("Provide either solar_date OR lunar_year + lunar_month + lunar_day");
  }
}

function handleGetZodiacInfo(args: Record<string, unknown>) {
  const dateStr = args.date as string | undefined;
  let year = (args.year as number) ?? new Date().getFullYear();

  let lunar: ReturnType<typeof Solar.prototype.getLunar>;
  if (dateStr) {
    const date = parseDate(dateStr);
    const solar = Solar.fromDate(date);
    lunar = solar.getLunar();
    year = lunar.getYear();
  } else {
    // Use Feb 15 of the given year as a safe mid-year date
    const solar = Solar.fromYmd(year, 6, 15);
    lunar = solar.getLunar();
  }

  const animalChinese = lunar.getYearShengXiao();
  const animal = translateAnimal(animalChinese);
  const stem = lunar.getYearGan();
  const branch = lunar.getYearZhi();
  const element = getStemElement(stem);
  const ganZhi = lunar.getYearInGanZhi();
  const traits = ZODIAC_TRAITS[animal];

  return {
    year,
    zodiac: {
      animal,
      animal_chinese: animalChinese,
      element,
      heavenly_stem: stem,
      earthly_branch: branch,
      gan_zhi: ganZhi,
      full_name: `${element} ${animal}`,
    },
    traits: traits
      ? {
          personality: traits.personality,
          strengths: traits.strengths,
          compatible_animals: traits.compatible,
          incompatible_animals: traits.incompatible,
          lucky_numbers: traits.lucky_numbers,
          lucky_colors: traits.lucky_colors,
        }
      : null,
  };
}

function handleGet13MonthCalendar(args: Record<string, unknown>) {
  const now = new Date();
  const year = (args.year as number) ?? now.getFullYear();
  const birthDateStr = args.birth_date as string | undefined;

  // Find the first new moon on or after Jan 1 of the given year
  const jan1 = new Date(year, 0, 1);
  let firstNew = Astronomy.SearchMoonPhase(0, new Date(jan1.getTime() - 2 * 86400000), 35);
  if (!firstNew || firstNew.date < jan1) {
    firstNew = Astronomy.SearchMoonPhase(0, jan1, 35);
  }
  if (!firstNew) throw new Error(`Could not find first new moon for ${year}`);

  // Determine lunar birthday info if birth_date provided
  let lunarBirthMonth: number | null = null;
  let lunarBirthDay: number | null = null;
  let lunarBirthdayGregorian: string | null = null;

  if (birthDateStr) {
    const birthDate = parseDate(birthDateStr);
    const solar = Solar.fromDate(birthDate);
    const lunar = solar.getLunar();
    lunarBirthMonth = lunar.getMonth();
    lunarBirthDay = lunar.getDay();

    // Find when this lunar birthday falls in the target year
    try {
      const targetLunar = Lunar.fromYmd(year, lunarBirthMonth, lunarBirthDay);
      const targetSolar = targetLunar.getSolar();
      lunarBirthdayGregorian = `${targetSolar.getYear()}-${String(targetSolar.getMonth()).padStart(2, "0")}-${String(targetSolar.getDay()).padStart(2, "0")}`;
    } catch {
      // Lunar date doesn't exist in this year (e.g. month 30 in a 29-day month)
      lunarBirthdayGregorian = null;
    }
  }

  // Build 13 lunations
  const lunations: Array<{
    lunation: number;
    new_moon: string;
    first_quarter: string;
    full_moon: string;
    third_quarter: string;
    next_new_moon: string;
    length_days: number;
    chinese_month: number | null;
    is_leap_month: boolean;
    contains_lunar_birthday: boolean;
    lunar_birthday_gregorian: string | null;
  }> = [];

  let currentNewMoon = firstNew;

  for (let i = 0; i < 13; i++) {
    // Find the 4 quarter phases within this lunation
    const firstQ = Astronomy.SearchMoonPhase(90, currentNewMoon.date, 30);
    const fullMoon = Astronomy.SearchMoonPhase(180, currentNewMoon.date, 30);
    const thirdQ = Astronomy.SearchMoonPhase(270, currentNewMoon.date, 30);
    const nextNew = Astronomy.SearchMoonPhase(0, new Date(currentNewMoon.date.getTime() + 20 * 86400000), 15);

    if (!firstQ || !fullMoon || !thirdQ || !nextNew) {
      break; // shouldn't happen but guard
    }

    const lengthDays = Math.round(((nextNew.date.getTime() - currentNewMoon.date.getTime()) / 86400000) * 100) / 100;

    // Map to Chinese calendar month using the new moon date + 1 day (mid-lunation start)
    let chineseMonth: number | null = null;
    let isLeapMonth = false;
    try {
      const midPoint = new Date(currentNewMoon.date.getTime() + 2 * 86400000);
      const solarMid = Solar.fromDate(midPoint);
      const lunarMid = solarMid.getLunar();
      chineseMonth = Math.abs(lunarMid.getMonth());
      // In lunar-typescript, negative month = leap month
      isLeapMonth = lunarMid.getMonth() < 0;
    } catch {
      // ignore
    }

    // Check if this lunation contains the lunar birthday
    let containsBirthday = false;
    let birthdayInThisLunation: string | null = null;
    if (lunarBirthMonth !== null && lunarBirthDay !== null && lunarBirthdayGregorian) {
      const bday = new Date(lunarBirthdayGregorian);
      if (bday >= currentNewMoon.date && bday < nextNew.date) {
        containsBirthday = true;
        birthdayInThisLunation = lunarBirthdayGregorian;
      }
    }

    lunations.push({
      lunation: i + 1,
      new_moon: formatDate(currentNewMoon.date),
      first_quarter: formatDate(firstQ.date),
      full_moon: formatDate(fullMoon.date),
      third_quarter: formatDate(thirdQ.date),
      next_new_moon: formatDate(nextNew.date),
      length_days: lengthDays,
      chinese_month: chineseMonth,
      is_leap_month: isLeapMonth,
      contains_lunar_birthday: containsBirthday,
      lunar_birthday_gregorian: birthdayInThisLunation,
    });

    currentNewMoon = nextNew;
  }

  const result: Record<string, unknown> = {
    year,
    lunation_count: lunations.length,
    total_days: Math.round(lunations.reduce((sum, l) => sum + l.length_days, 0) * 100) / 100,
    lunations,
  };

  if (birthDateStr) {
    result.birth_date = birthDateStr;
    result.lunar_birthday = {
      lunar_month: lunarBirthMonth,
      lunar_day: lunarBirthDay,
      gregorian_date_this_year: lunarBirthdayGregorian,
    };
  }

  return result;
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

// ── Server Setup ────────────────────────────────────────────────────────

const server = new Server(
  { name: "lunar-mcp", version: "1.1.0" },
  { capabilities: { tools: {} } }
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: TOOLS,
}));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args = {} } = request.params;

  try {
    let result: unknown;

    switch (name) {
      case "get_moon_phase":
        result = handleGetMoonPhase(args);
        break;
      case "get_lunar_birthday":
        result = handleGetLunarBirthday(args);
        break;
      case "get_lunar_calendar":
        result = handleGetLunarCalendar(args);
        break;
      case "get_moon_sign":
        result = handleGetMoonSign(args);
        break;
      case "get_lunar_events":
        result = handleGetLunarEvents(args);
        break;
      case "get_moonrise_moonset":
        result = handleGetMoonriseMoonset(args);
        break;
      case "get_moon_cycle":
        result = handleGetMoonCycle(args);
        break;
      case "get_eclipse_forecast":
        result = handleGetEclipseForecast(args);
        break;
      case "convert_lunar_date":
        result = handleConvertLunarDate(args);
        break;
      case "get_zodiac_info":
        result = handleGetZodiacInfo(args);
        break;
      case "get_13_month_calendar":
        result = handleGet13MonthCalendar(args);
        break;
      default:
        return {
          content: [{ type: "text" as const, text: `Unknown tool: ${name}` }],
          isError: true,
        };
    }

    return {
      content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      content: [{ type: "text" as const, text: `Error: ${message}` }],
      isError: true,
    };
  }
});

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});
