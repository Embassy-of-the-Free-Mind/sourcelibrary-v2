// Maya calendar arithmetic for the "How the Maya Counted" article.
// Every count is a remainder of one day number n: the days since the era base,
// 13.0.0.0.0 4 Ajaw 8 Kumk'u. A correlation constant (the Julian Day Number of
// that base) ties n to our calendar. 584283 (Goodman-Martinez-Thompson) is the
// standard one; 584285 is the two-day variant some astronomers use.

export const GMT = 584283;
export const CORRELATIONS = [
  { value: 584283, name: 'GMT (584283)' },
  { value: 584285, name: 'GMT + 2 (584285)' },
] as const;

export const DAY_NAMES = [
  'Imix', "Ik'", "Ak'b'al", "K'an", 'Chikchan', 'Kimi', "Manik'", 'Lamat', 'Muluk', 'Ok',
  "Chuwen", "Eb'", "B'en", 'Ix', 'Men', "Kib'", "Kab'an", "Etz'nab'", 'Kawak', 'Ajaw',
];
// The same names as Landa and the colonial books spell them.
export const DAY_NAMES_COLONIAL = [
  'Imix', 'Ik', 'Akbal', 'Kan', 'Chicchan', 'Cimi', 'Manik', 'Lamat', 'Muluc', 'Oc',
  'Chuen', 'Eb', 'Ben', 'Ix', 'Men', 'Cib', 'Caban', 'Etznab', 'Cauac', 'Ahau',
];
export const MONTHS = [
  'Pop', "Wo'", 'Sip', "Sotz'", 'Sek', 'Xul', "Yaxk'in", 'Mol', "Ch'en", 'Yax',
  "Sak'", 'Keh', 'Mak', "K'ank'in", 'Muwan', 'Pax', "K'ayab'", "Kumk'u", "Wayeb'",
];

/** Place values of the Long Count: k'in, winal, tun, k'atun, b'ak'tun. */
export const LONG_COUNT_UNITS = [
  { name: "b'ak'tun", days: 144000 },
  { name: "k'atun", days: 7200 },
  { name: 'tun', days: 360 },
  { name: 'winal', days: 20 },
  { name: "k'in", days: 1 },
];

const mod = (a: number, m: number) => ((a % m) + m) % m;

/** Julian Day Number of a proleptic Gregorian date (year, month 1-12, day). */
export function jdnFromGregorian(y: number, m: number, d: number): number {
  const a = Math.floor((14 - m) / 12);
  const yy = y + 4800 - a;
  const mm = m + 12 * a - 3;
  return d + Math.floor((153 * mm + 2) / 5) + 365 * yy + Math.floor(yy / 4) - Math.floor(yy / 100) + Math.floor(yy / 400) - 32045;
}

export function gregorianFromJdn(j: number): { y: number; m: number; d: number } {
  const a = j + 32044;
  const b = Math.floor((4 * a + 3) / 146097);
  const c = a - Math.floor((146097 * b) / 4);
  const d = Math.floor((4 * c + 3) / 1461);
  const e = c - Math.floor((1461 * d) / 4);
  const m = Math.floor((5 * e + 2) / 153);
  return {
    d: e - Math.floor((153 * m + 2) / 5) + 1,
    m: m + 3 - 12 * Math.floor(m / 10),
    y: 100 * b + d - 4800 + Math.floor(m / 10),
  };
}

/** Long Count digits [b'ak'tun, k'atun, tun, winal, k'in] for day n >= 0. */
export function longCount(n: number): number[] {
  let r = n;
  return LONG_COUNT_UNITS.map((u) => {
    const q = Math.floor(r / u.days);
    r -= q * u.days;
    return q;
  });
}

export function tzolkin(n: number): { number: number; index: number } {
  return { number: mod(n + 3, 13) + 1, index: mod(n + 19, 20) };
}

/** Position in the 365-day year: day 0-19 of month 0-18 (month 18 is the five-day Wayeb'). */
export function haab(n: number): { day: number; month: number } {
  const p = mod(n + 348, 365);
  return { day: p % 20, month: Math.floor(p / 20) };
}

/** Lord of the Night, G1-G9; the era base falls on G9. */
export function lordOfNight(n: number): number {
  return mod(n, 9) || 9;
}

/** Plain base-20 digits, most significant first. */
export function vigesimal(x: number): number[] {
  if (x <= 0) return [0];
  const out: number[] = [];
  let r = x;
  while (r > 0) {
    out.unshift(r % 20);
    r = Math.floor(r / 20);
  }
  return out;
}

/** Calendar place values (1, 20, 360, 7200, 144000), most significant first. */
export function calendrical(x: number): number[] {
  if (x <= 0) return [0];
  const digits = longCount(x);
  const first = digits.findIndex((d) => d !== 0);
  return digits.slice(first);
}

export function gcd(a: number, b: number): number {
  return b === 0 ? a : gcd(b, a % b);
}
export function lcm(a: number, b: number): number {
  return (a / gcd(a, b)) * b;
}
