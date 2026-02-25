// Astronomy calculation wrappers — extracted from lunar-mcp src/index.ts
// Uses astronomy-engine for all calculations (client-side, ~50KB)

import * as Astronomy from "astronomy-engine";
import { PHASE_NAMES, WESTERN_ZODIAC, SYNODIC_MONTH } from "./constants";

export function getPhaseName(angle: number): { name: string; emoji: string } {
  const normalized = ((angle % 360) + 360) % 360;
  const phase = PHASE_NAMES.find((p) => normalized >= p.min && normalized < p.max);
  return phase ?? PHASE_NAMES[0];
}

export function getZodiacSign(longitude: number) {
  const normalized = ((longitude % 360) + 360) % 360;
  const index = Math.floor(normalized / 30);
  const sign = WESTERN_ZODIAC[index];
  const degrees = normalized - sign.start;
  return {
    ...sign,
    degrees: Math.round(degrees * 100) / 100,
    longitude: Math.round(normalized * 100) / 100,
  };
}

export function getMoonAge(date: Date): number {
  const prevNew = Astronomy.SearchMoonPhase(0, new Date(date.getTime() - 30 * 86400000), 35);
  if (!prevNew) return 0;
  const diffMs = date.getTime() - prevNew.date.getTime();
  return Math.round((diffMs / 86400000) * 100) / 100;
}

export function isSupermoon(date: Date): boolean {
  const perigee = Astronomy.SearchLunarApsis(new Date(date.getTime() - 15 * 86400000));
  if (perigee.kind !== Astronomy.ApsisKind.Pericenter) return false;
  const diffDays = Math.abs(date.getTime() - perigee.time.date.getTime()) / 86400000;
  return diffDays < 2;
}

export function getMoonPhase(date: Date) {
  const angle = Astronomy.MoonPhase(date);
  const illum = Astronomy.Illumination(Astronomy.Body.Moon, date);
  const phase = getPhaseName(angle);
  const age = getMoonAge(date);

  return {
    phase_name: phase.name,
    phase_emoji: phase.emoji,
    phase_angle: Math.round(angle * 100) / 100,
    illumination: Math.round(illum.phase_fraction * 10000) / 100,
    moon_age: age,
    trend: angle < 180 ? ("waxing" as const) : ("waning" as const),
  };
}

export function getMoonSign(date: Date) {
  const ecl = Astronomy.EclipticGeoMoon(date);
  return getZodiacSign(ecl.lon);
}

export function getMoonCycle(date: Date) {
  const angle = Astronomy.MoonPhase(date);
  const phase = getPhaseName(angle);
  const age = getMoonAge(date);
  const illum = Astronomy.Illumination(Astronomy.Body.Moon, date);

  const prevNew = Astronomy.SearchMoonPhase(0, new Date(date.getTime() - 30 * 86400000), 35);
  const nextNew = Astronomy.SearchMoonPhase(0, date, 30);
  const nextQuarter = Astronomy.SearchMoonQuarter(date);

  return {
    phase_name: phase.name,
    phase_emoji: phase.emoji,
    moon_age: age,
    progress: Math.round((age / SYNODIC_MONTH) * 1000) / 10,
    trend: angle < 180 ? ("waxing" as const) : ("waning" as const),
    illumination: Math.round(illum.phase_fraction * 10000) / 100,
    lunation_start: prevNew?.date ?? null,
    lunation_end: nextNew?.date ?? null,
    next_phase: nextQuarter
      ? {
          quarter: nextQuarter.quarter,
          date: nextQuarter.time.date,
          days_away: Math.round(((nextQuarter.time.date.getTime() - date.getTime()) / 86400000) * 10) / 10,
        }
      : null,
  };
}

export interface Lunation {
  num: number;
  newMoon: Date;
  firstQuarter: Date;
  fullMoon: Date;
  thirdQuarter: Date;
  nextNewMoon: Date;
  length: number;
  chineseMonth: number | null;
  isLeap: boolean;
}

function getChineseMonthInfo(newMoonDate: Date, nextNewMoonDate: Date) {
  const principalTerms: { lon: number; month: number; date: Date }[] = [];
  for (let i = 0; i < 12; i++) {
    const lon = i * 30;
    try {
      const t = Astronomy.SearchSunLongitude(lon, newMoonDate, 35);
      if (t && t.date >= newMoonDate && t.date < nextNewMoonDate) {
        let month = ((lon / 30) + 2) % 12;
        if (month === 0) month = 12;
        principalTerms.push({ lon, month, date: t.date });
      }
    } catch { /* ignore */ }
  }
  if (principalTerms.length === 0) {
    return { month: null, isLeap: true };
  }
  return { month: principalTerms[0].month, isLeap: false };
}

export function compute13MonthCalendar(year: number): Lunation[] {
  const jan1 = new Date(year, 0, 1);
  let searchStart = new Date(jan1.getTime() - 2 * 86400000);
  let firstNew = Astronomy.SearchMoonPhase(0, searchStart, 35);
  if (!firstNew || firstNew.date < jan1) {
    firstNew = Astronomy.SearchMoonPhase(0, jan1, 35);
  }
  if (!firstNew) return [];

  const lunations: Lunation[] = [];
  let currentNew = firstNew;
  let lastMonthAssigned = 0;

  for (let i = 0; i < 13; i++) {
    const fq = Astronomy.SearchMoonPhase(90, currentNew.date, 30);
    const fm = Astronomy.SearchMoonPhase(180, currentNew.date, 30);
    const tq = Astronomy.SearchMoonPhase(270, currentNew.date, 30);
    const nextNew = Astronomy.SearchMoonPhase(0, new Date(currentNew.date.getTime() + 20 * 86400000), 15);

    if (!fq || !fm || !tq || !nextNew) break;

    const length = Math.round(((nextNew.date.getTime() - currentNew.date.getTime()) / 86400000) * 100) / 100;

    const chInfo = getChineseMonthInfo(currentNew.date, nextNew.date);
    let displayMonth = chInfo.month;
    const isLeap = chInfo.isLeap;

    if (isLeap && lastMonthAssigned > 0) {
      displayMonth = lastMonthAssigned;
    } else if (displayMonth !== null) {
      lastMonthAssigned = displayMonth;
    }

    lunations.push({
      num: i + 1,
      newMoon: currentNew.date,
      firstQuarter: fq.date,
      fullMoon: fm.date,
      thirdQuarter: tq.date,
      nextNewMoon: nextNew.date,
      length,
      chineseMonth: displayMonth,
      isLeap,
    });

    currentNew = nextNew;
  }

  return lunations;
}

export function getIlluminationForDate(date: Date): number {
  const illum = Astronomy.Illumination(Astronomy.Body.Moon, date);
  return Math.round(illum.phase_fraction * 10000) / 100;
}

export function getLunarEvents(startDate: Date, days: number) {
  const endDate = new Date(startDate.getTime() + days * 86400000);
  const events: Array<{
    date: Date;
    type: string;
    name: string;
    emoji: string;
    details?: Record<string, unknown>;
  }> = [];

  // Quarter phases
  let mq = Astronomy.SearchMoonQuarter(startDate);
  while (mq.time.date <= endDate) {
    const evt = {
      date: mq.time.date,
      type: mq.quarter === 0 ? "new_moon" : mq.quarter === 2 ? "full_moon" : "quarter",
      name: ["New Moon", "First Quarter", "Full Moon", "Third Quarter"][mq.quarter],
      emoji: ["\uD83C\uDF11", "\uD83C\uDF13", "\uD83C\uDF15", "\uD83C\uDF17"][mq.quarter],
    };

    if (mq.quarter === 2 && isSupermoon(mq.time.date)) {
      evt.type = "supermoon";
      evt.name = "Supermoon";
      evt.emoji = "\uD83C\uDF1D";
    }

    events.push(evt);
    mq = Astronomy.NextMoonQuarter(mq);
  }

  return events.sort((a, b) => a.date.getTime() - b.date.getTime());
}

export function getEclipses(startDate: Date, count: number) {
  const eclipses: Array<{
    date: Date;
    type: "lunar" | "solar";
    kind: string;
    details: Record<string, unknown>;
  }> = [];

  let lunarEcl = Astronomy.SearchLunarEclipse(startDate);
  for (let i = 0; i < count; i++) {
    eclipses.push({
      date: lunarEcl.peak.date,
      type: "lunar",
      kind: lunarEcl.kind,
      details: {
        obscuration: Math.round(lunarEcl.obscuration * 10000) / 100,
        duration_minutes: Math.round(lunarEcl.sd_penum * 2),
      },
    });
    lunarEcl = Astronomy.NextLunarEclipse(lunarEcl.peak);
  }

  let solarEcl = Astronomy.SearchGlobalSolarEclipse(startDate);
  for (let i = 0; i < count; i++) {
    eclipses.push({
      date: solarEcl.peak.date,
      type: "solar",
      kind: solarEcl.kind,
      details: {
        latitude: solarEcl.latitude != null ? Math.round(solarEcl.latitude * 100) / 100 : null,
        longitude: solarEcl.longitude != null ? Math.round(solarEcl.longitude * 100) / 100 : null,
      },
    });
    solarEcl = Astronomy.NextGlobalSolarEclipse(solarEcl.peak);
  }

  eclipses.sort((a, b) => a.date.getTime() - b.date.getTime());
  return eclipses.slice(0, count);
}

export function computeDriftData(
  year: number,
  birthDate: Date,
  lunarBirthDay: number,
  birthLunationIndex: number,
) {
  const metonicYears = 19;
  const data: Array<{
    year: number;
    date: Date;
    dayOfYear: number;
    hasLeap: boolean;
    isCurrent: boolean;
  }> = [];

  for (let y = year; y < year + metonicYears; y++) {
    try {
      const yJan1 = new Date(y, 0, 1);
      let ySearchStart = new Date(yJan1.getTime() - 2 * 86400000);
      let yFirstNew = Astronomy.SearchMoonPhase(0, ySearchStart, 35);
      if (!yFirstNew || yFirstNew.date < yJan1) {
        yFirstNew = Astronomy.SearchMoonPhase(0, yJan1, 35);
      }
      if (!yFirstNew) continue;

      // Walk to the birth lunation index
      let yCur = yFirstNew;
      for (let j = 0; j < birthLunationIndex; j++) {
        const yNxt = Astronomy.SearchMoonPhase(0, new Date(yCur.date.getTime() + 20 * 86400000), 15);
        if (!yNxt) { yCur = null as never; break; }
        yCur = yNxt;
      }

      if (yCur) {
        const bdayDate = new Date(yCur.date.getTime() + (lunarBirthDay - 1) * 86400000);
        const yearStart = new Date(y, 0, 1);
        const dayOfYear = Math.floor((bdayDate.getTime() - yearStart.getTime()) / 86400000);

        // Check for leap month
        let hasLeap = false;
        let checkNew = yFirstNew;
        for (let k = 0; k < 13; k++) {
          const checkNext = Astronomy.SearchMoonPhase(0, new Date(checkNew.date.getTime() + 20 * 86400000), 15);
          if (!checkNext) break;
          const cInfo = getChineseMonthInfo(checkNew.date, checkNext.date);
          if (cInfo.isLeap) { hasLeap = true; break; }
          checkNew = checkNext;
        }

        data.push({ year: y, date: bdayDate, dayOfYear, hasLeap, isCurrent: y === year });
      }
    } catch { /* skip */ }
  }

  return data;
}

export function findBirthLunation(birthDate: Date) {
  const birthYear = birthDate.getFullYear();
  const birthJan1 = new Date(birthYear, 0, 1);
  let bSearchStart = new Date(birthJan1.getTime() - 2 * 86400000);
  let birthFirstNew = Astronomy.SearchMoonPhase(0, bSearchStart, 35);
  if (!birthFirstNew || birthFirstNew.date < birthJan1) {
    birthFirstNew = Astronomy.SearchMoonPhase(0, birthJan1, 35);
  }
  if (!birthFirstNew) return null;

  let bCurrent = birthFirstNew;
  for (let i = 0; i < 13; i++) {
    const bNext = Astronomy.SearchMoonPhase(0, new Date(bCurrent.date.getTime() + 20 * 86400000), 15);
    if (!bNext) break;
    if (birthDate >= bCurrent.date && birthDate < bNext.date) {
      const lunarDay = Math.floor((birthDate.getTime() - bCurrent.date.getTime()) / 86400000) + 1;
      return { lunationIndex: i, lunarDay };
    }
    bCurrent = bNext;
  }
  return null;
}

// Get the moon phase angle for positioning light in 3D
export function getMoonPhaseAngle(date: Date): number {
  return Astronomy.MoonPhase(date);
}

/** Convert k = cos(phaseAngle) to illumination fraction 0..1 */
export function phaseToIllumFraction(k: number): number {
  return (1 + k) / 2;
}

/** Build SVG path for the illuminated portion of a moon disc. */
export function buildLitPath(cx: number, cy: number, r: number, k: number, waxing: boolean): string {
  const top = cy - r;
  const bottom = cy + r;
  const litSweep = waxing ? 1 : 0;
  const terminatorRx = Math.abs(k) * r;
  const gibbous = Math.abs(phaseToIllumFraction(k)) > 0.5;
  const terminatorSweep = (waxing === gibbous) ? 0 : 1;
  return `M ${cx} ${top} A ${r} ${r} 0 0 ${litSweep} ${cx} ${bottom} A ${terminatorRx} ${r} 0 0 ${terminatorSweep} ${cx} ${top}`;
}

// ═══════════════════════════════════════════════
// CRESCENT ORIENTATION — "wet moon" / bowl crescent predictor
// ═══════════════════════════════════════════════

export interface CrescentOrientation {
  tiltDeg: number;      // angle of bright limb from zenith (clockwise), 0-360
  cuspsUp: number;      // -cos(tilt): +1 = perfect bowl, -1 = perfect frown
  moonAlt: number;      // altitude above horizon (degrees)
  moonAz: number;       // azimuth (degrees)
  illumination: number; // percent illuminated (0-100)
  phaseAngle: number;   // moon phase angle (0-360)
}

/**
 * Compute the crescent orientation at a specific time and place.
 *
 * Returns the tilt of the bright limb relative to the zenith and a
 * "cuspsUp" score: +1 = perfect bowl (horns up), -1 = perfect frown.
 *
 * The math:
 * - Position Angle (PA): direction from moon to sun on the celestial sphere
 * - Parallactic Angle (q): rotation of celestial north from zenith at the moon
 * - Tilt = PA - q: how the bright limb is oriented relative to "up" for the observer
 */
export function getCrescentOrientation(date: Date, lat: number, lon: number): CrescentOrientation {
  const observer = new Astronomy.Observer(lat, lon, 0);

  // Equatorial coordinates (apparent, of-date)
  const moonEq = Astronomy.Equator(Astronomy.Body.Moon, date, observer, true, true);
  const sunEq = Astronomy.Equator(Astronomy.Body.Sun, date, observer, true, true);

  // Convert RA (hours) and Dec (degrees) to radians
  const raMoon = moonEq.ra * Math.PI / 12;
  const decMoon = moonEq.dec * Math.PI / 180;
  const raSun = sunEq.ra * Math.PI / 12;
  const decSun = sunEq.dec * Math.PI / 180;

  // Position angle of the bright limb
  const dRA = raSun - raMoon;
  const PA = Math.atan2(
    Math.cos(decSun) * Math.sin(dRA),
    Math.sin(decSun) * Math.cos(decMoon) - Math.cos(decSun) * Math.sin(decMoon) * Math.cos(dRA),
  );

  // Parallactic angle
  const gast = Astronomy.SiderealTime(date); // hours
  const lst = gast + lon / 15; // hours
  const H = (lst - moonEq.ra) * Math.PI / 12; // hour angle in radians
  const latRad = lat * Math.PI / 180;
  const q = Math.atan2(
    Math.sin(H),
    Math.tan(latRad) * Math.cos(decMoon) - Math.sin(decMoon) * Math.cos(H),
  );

  // Tilt of bright limb from zenith and cuspsUp score
  const tiltRad = PA - q;
  const tiltDeg = ((tiltRad * 180 / Math.PI) % 360 + 360) % 360;
  const cuspsUp = Math.round(-Math.cos(tiltRad) * 1000) / 1000;

  // Moon horizontal coordinates
  const horizon = Astronomy.Horizon(date, observer, moonEq.ra, moonEq.dec, "normal");

  // Phase info
  const phaseAngle = Astronomy.MoonPhase(date);
  const illum = Astronomy.Illumination(Astronomy.Body.Moon, date);

  return {
    tiltDeg,
    cuspsUp,
    moonAlt: Math.round(horizon.altitude * 100) / 100,
    moonAz: Math.round(horizon.azimuth * 100) / 100,
    illumination: Math.round(illum.phase_fraction * 10000) / 100,
    phaseAngle: Math.round(phaseAngle * 100) / 100,
  };
}

export interface CrescentEvent {
  date: Date;
  type: "evening" | "morning";
  daysFromNew: number;
  cuspsUp: number;
  moonAlt: number;
  illumination: number;
  tiltDeg: number;
  phaseAngle: number;
  newMoonDate: Date;
}

/**
 * Find upcoming crescent viewing opportunities at a given location.
 * Returns events sorted by date, covering both evening (waxing) and morning (waning) crescents.
 */
export function findCrescentEvents(lat: number, lon: number, monthsAhead: number = 6): CrescentEvent[] {
  const events: CrescentEvent[] = [];
  const observer = new Astronomy.Observer(lat, lon, 0);
  let searchDate = new Date();

  for (let n = 0; n < monthsAhead; n++) {
    const newMoonResult = Astronomy.SearchMoonPhase(0, searchDate, 35);
    if (!newMoonResult) break;
    const nm = newMoonResult.date;

    // Waxing crescents: evenings 1-5 days after new moon
    for (let d = 1; d <= 5; d++) {
      const dayDate = new Date(nm.getTime() + d * 86400000);
      const noon = new Date(dayDate.getFullYear(), dayDate.getMonth(), dayDate.getDate(), 12, 0, 0);
      try {
        const sunset = Astronomy.SearchRiseSet(Astronomy.Body.Sun, observer, -1, noon, 1);
        if (!sunset) continue;
        const viewTime = new Date(sunset.date.getTime() + 40 * 60000);
        const orient = getCrescentOrientation(viewTime, lat, lon);
        if (orient.moonAlt > 3 && orient.illumination > 0.3 && orient.illumination < 35) {
          events.push({
            date: viewTime, type: "evening", daysFromNew: d,
            cuspsUp: orient.cuspsUp, moonAlt: orient.moonAlt,
            illumination: orient.illumination, tiltDeg: orient.tiltDeg,
            phaseAngle: orient.phaseAngle, newMoonDate: nm,
          });
        }
      } catch { /* polar region, no sunset */ }
    }

    // Waning crescents: mornings 1-5 days before this new moon
    for (let d = 1; d <= 5; d++) {
      const dayDate = new Date(nm.getTime() - d * 86400000);
      const midnight = new Date(dayDate.getFullYear(), dayDate.getMonth(), dayDate.getDate(), 0, 0, 0);
      try {
        const sunrise = Astronomy.SearchRiseSet(Astronomy.Body.Sun, observer, +1, midnight, 1);
        if (!sunrise) continue;
        const viewTime = new Date(sunrise.date.getTime() - 40 * 60000);
        const orient = getCrescentOrientation(viewTime, lat, lon);
        if (orient.moonAlt > 3 && orient.illumination > 0.3 && orient.illumination < 35) {
          events.push({
            date: viewTime, type: "morning", daysFromNew: -d,
            cuspsUp: orient.cuspsUp, moonAlt: orient.moonAlt,
            illumination: orient.illumination, tiltDeg: orient.tiltDeg,
            phaseAngle: orient.phaseAngle, newMoonDate: nm,
          });
        }
      } catch { /* polar region, no sunrise */ }
    }

    searchDate = new Date(nm.getTime() + 20 * 86400000);
  }

  events.sort((a, b) => a.date.getTime() - b.date.getTime());
  return events;
}

/**
 * Compute cuspsUp across latitudes for a given time and longitude.
 * Shows how the bowl crescent effect varies by latitude at one moment.
 */
export function getLatitudeBand(date: Date, lon: number): Array<{ lat: number; cuspsUp: number; moonAlt: number }> {
  const band = [];
  for (let lat = -60; lat <= 60; lat += 2) {
    const orient = getCrescentOrientation(date, lat, lon);
    band.push({ lat, cuspsUp: orient.cuspsUp, moonAlt: orient.moonAlt });
  }
  return band;
}
