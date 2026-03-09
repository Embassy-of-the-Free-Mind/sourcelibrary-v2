/**
 * ATF reading → Unicode cuneiform character mapping.
 *
 * ATF (ASCII Transliteration Format) uses syllabic readings in lowercase.
 * This maps the most common ~150 readings to their Unicode cuneiform signs
 * (U+12000–U+1236E block). Unmapped readings render as transliteration text.
 *
 * Sources:
 * - CDLI experiment sign chart (verified against P250675)
 * - Unicode Standard cuneiform block
 * - ePSD2 sign list (Sumerian readings)
 */

// Primary reading → cuneiform character
// Keys are lowercase ATF readings (as they appear in corpus)
const SIGN_MAP: Record<string, string> = {
  // ---- Verified from experiment sign chart ----
  a: '𒀀',
  ab: '𒀊',
  ad: '𒀝',
  an: '𒀭',
  ba: '𒁀',
  bad: '𒁁',
  bu: '𒁍',
  da: '𒁲',
  du: '𒁺',
  en: '𒂗',
  e2: '𒂠',
  ga: '𒃻',
  gal: '𒄀',
  gesz: '𒄑',
  gisz: '𒄑',
  gu2: '𒄞',
  ha: '𒄷',
  igi: '𒅆',
  im: '𒅎',
  ka: '𒅗',
  ki: '𒆠',
  ku: '𒆪',
  li: '𒇷',
  lu: '𒇻',
  lugal: '𒈗',
  ma: '𒈠',
  me: '𒈨',
  mu: '𒈬',
  na: '𒈾',
  ne: '𒉈',
  ni: '𒉌',
  nun: '𒉣',
  ra: '𒊏',
  sag: '𒊕',
  sar: '𒊬',
  szu: '𒋗',
  si: '𒋛',
  sig: '𒋝',
  tu: '𒌅',
  tur: '𒌇',
  u2: '𒌈',
  u: '𒌋',
  ur: '𒌑',
  ud: '𒌓',
  utu: '𒌓',
  u4: '𒌓',
  um: '𒌦',
  zi: '𒍣',
  zu: '𒍪',
  sze: '𒊺',
  ta: '𒋾',
  kur: '𒆳',
  i: '𒄿',

  // ---- Additional common readings ----
  // Core syllabary
  a2: '𒀉',
  ag: '𒀝',
  ak: '𒀉',
  al: '𒀠',
  am: '𒄠',
  ar: '𒌓',
  asz: '𒀸',
  az: '𒊍',

  bal: '𒁇',
  bar: '𒁈',
  bi: '𒁉',
  bi2: '𒁉',

  dam: '𒁮',
  de: '𒌓',
  di: '𒁲',
  dub: '𒁾',
  dug: '𒂁',
  dumu: '𒌉',
  dun: '𒂄',
  dur: '𒌅',

  e: '𒂊',
  e3: '𒂊',
  e11: '𒂊',

  gab: '𒃮',
  gaba: '𒃮',
  gar: '𒃻',
  ge: '𒄀',
  ge6: '𒈪',
  gi: '𒄀',
  gi4: '𒄀',
  gid2: '𒁍',
  gin: '𒁺',
  gin2: '𒂆',
  gir2: '𒄉',
  gir3: '𒄊',
  giri3: '𒄊',
  gu: '𒄖',
  gu4: '𒄞',
  gu7: '𒅥',
  gub: '𒁺',
  gur: '𒄥',

  hal: '𒄬',
  hi: '𒄭',
  hu: '𒄷',
  hul: '𒄳',

  i3: '𒉌',
  i7: '𒀀',
  ib: '𒅁',
  id: '𒀀',
  il: '𒅋',
  il2: '𒅍',
  in: '𒅔',
  ir: '𒅕',
  iti: '𒌗',
  iz: '𒅖',

  ka2: '𒆍',
  kal: '𒆗',
  kam: '𒆚',
  kam2: '𒆚',
  kar: '𒆜',
  kasz: '𒁉',
  kesz2: '𒆟',
  kid: '𒆤',
  kin: '𒆥',
  ku3: '𒆬',
  ku4: '𒆭',
  ku6: '𒄩',
  kusz: '𒆮',

  la: '𒆷',
  la2: '𒇲',
  lag: '𒇴',
  lal: '𒇲',
  lal2: '𒇲',
  lal3: '𒇲',
  le: '𒇷',
  lu2: '𒇽',
  luh: '𒈖',
  lum: '𒈝',

  ma2: '𒈣',
  mah: '𒈤',
  mar: '𒈥',
  masz: '𒈦',
  masz2: '𒈧',
  mes: '𒈨',
  mi: '𒈬',
  mi2: '𒊩',
  min: '𒈫',
  mun: '𒈬',
  mur: '𒄷',
  musz: '𒈲',

  na2: '𒈾',
  na4: '𒈾',
  nag: '𒅘',
  nam: '𒉆',
  nar: '𒉇',
  ne2: '𒁉',
  nig2: '𒃻',
  niga: '𒃻',
  nim: '𒉏',
  nin: '𒊩',
  ninda: '𒃻',
  nu: '𒉡',

  pa: '𒉺',
  pap: '𒉽',
  pi: '𒉿',

  ri: '𒊑',
  ri2: '𒊒',
  ru: '𒊒',

  sa: '𒁲',
  sa2: '𒁲',
  sa6: '𒊕',
  sa10: '𒉆',
  sag11: '𒊕',
  sal: '𒊩',
  se: '𒊺',
  se3: '𒊺',
  sza: '𒊮',
  sza3: '𒊮',
  szag: '𒊮',
  szar: '𒊬',
  szar2: '𒊬',
  sze3: '𒊺',
  szesz: '𒋀',
  szesz2: '𒋀',
  szi: '𒅆',
  szim: '𒋆',
  szu2: '𒋗',
  szub: '𒋗',
  szul: '𒋗',

  su: '𒋢',
  su3: '𒋤',
  sud: '𒋤',
  sud2: '𒋤',
  sug: '𒋢',
  sun: '𒋢',
  sur: '𒋤',

  tab: '𒋰',
  tag: '𒋳',
  tam: '𒋾',
  tar: '𒋻',
  te: '𒋼',
  ti: '𒋾',
  til: '𒌀',
  tir: '𒌁',
  tu2: '𒌅',
  tug2: '𒌆',
  tuku: '𒌇',
  tum: '𒌈',
  tum2: '𒌈',
  tur2: '𒌇',

  u3: '𒌋',
  u5: '𒌋',
  ub: '𒌒',
  ug: '𒌔',
  ugula: '𒌜',
  uh: '𒌔',
  uk: '𒌔',
  ul: '𒌌',
  un: '𒌦',
  ur2: '𒌫',
  ur3: '𒌫',
  ur5: '𒌫',
  us: '𒍑',
  us2: '𒍑',
  usz: '𒍑',
  usz2: '𒍑',
  uz: '𒍑',

  za: '𒍝',
  za3: '𒍝',
  zal: '𒍝',
  ze2: '𒍣',

  // ---- Determinatives (rendered as superscript markers) ----
  dingir: '𒀭',

  // ---- Logograms common in Ur III ----
  amar: '𒀫',
  arad2: '𒅕',
  ensi2: '𒑐',
  gin7: '𒁺',
  iri: '𒌷',
  iri11: '𒌷',
  ninda2: '𒃻',
  sukkal: '𒈛',
  suen: '𒂗',
  bala: '𒁇',
  nibru: '𒂗',
  umma: '𒌝',
};

// Number signs: N(system) → rendered as digit
const NUMBER_SYSTEMS: Record<string, string> = {
  disz: '𒁹', // single vertical wedge
  u: '𒌋', // ten (corner wedge)
  asz: '𒀸', // one (horizontal)
  ban2: '𒁏', // capacity measure
  barig: '𒁀', // capacity measure
  gesz2: '𒐖', // sixty (numeric)
  "gesz'u": '𒐜', // 600
  szar2: '𒊹', // 3600
  "bur'u": '𒐝',
};

export interface AtfToken {
  /** Unicode cuneiform character, if mapped */
  sign: string | null;
  /** Original ATF reading */
  reading: string;
  /** Whether this is a determinative like {d}, {ki} */
  isDeterminative: boolean;
  /** Whether this is a number like 1(disz) */
  isNumber: boolean;
  /** Numeric value if isNumber */
  numValue?: string;
}

/**
 * Parse an ATF transliteration line into tokens with cuneiform signs.
 *
 * ATF conventions:
 * - Words separated by spaces
 * - Signs within words separated by hyphens
 * - Determinatives in braces: {d}, {ki}, {gesz}
 * - Numbers: N(system) e.g. 1(disz), 2(u)
 * - Damage markers: # (damaged), ! (collation), ? (uncertain)
 * - Missing: [...] or x
 */
export function tokenizeAtfLine(line: string): AtfToken[] {
  const tokens: AtfToken[] = [];

  // Split on spaces (word boundaries) and hyphens (sign boundaries)
  // Keep determinatives together
  const raw = line.trim();
  if (!raw) return tokens;

  // Split by spaces first (words), then by hyphens (signs within words)
  const words = raw.split(/\s+/);

  for (const word of words) {
    // Handle numbers: N(system) pattern
    const numMatch = word.match(/^(\d+)\(([^)]+)\)(.*)/);
    if (numMatch) {
      const [, count, system, suffix] = numMatch;
      const baseSign = NUMBER_SYSTEMS[system.replace(/@\w+/, '')];
      tokens.push({
        sign: baseSign || null,
        reading: `${count}(${system})`,
        isDeterminative: false,
        isNumber: true,
        numValue: count,
      });
      // Handle suffix like -sze3 after number
      if (suffix) {
        const suffixParts = suffix.replace(/^-/, '').split('-').filter(Boolean);
        for (const part of suffixParts) {
          tokens.push(...tokenizeSignGroup(part));
        }
      }
      continue;
    }

    // Split word on hyphens but keep determinatives together
    const signs = splitAtfWord(word);
    for (const sign of signs) {
      tokens.push(...tokenizeSignGroup(sign));
    }
  }

  return tokens;
}

function splitAtfWord(word: string): string[] {
  const parts: string[] = [];
  let current = '';
  let braceDepth = 0;

  for (let i = 0; i < word.length; i++) {
    const ch = word[i];
    if (ch === '{') {
      braceDepth++;
      current += ch;
    } else if (ch === '}') {
      braceDepth--;
      current += ch;
    } else if (ch === '-' && braceDepth === 0) {
      if (current) parts.push(current);
      current = '';
    } else {
      current += ch;
    }
  }
  if (current) parts.push(current);
  return parts;
}

function tokenizeSignGroup(raw: string): AtfToken[] {
  // Strip damage markers for lookup
  const clean = raw.replace(/[#!?*⸢⸣\[\]]/g, '');

  // Check for determinative: {d}szul-gi or {ki}
  const detMatch = clean.match(/^\{([^}]+)\}(.*)$/);
  if (detMatch) {
    const [, det, rest] = detMatch;
    const tokens: AtfToken[] = [
      {
        sign: SIGN_MAP[det] || null,
        reading: `{${det}}`,
        isDeterminative: true,
        isNumber: false,
      },
    ];
    if (rest) {
      tokens.push(...tokenizeSignGroup(rest));
    }
    return tokens;
  }

  // Check for trailing determinative: umma{ki}
  const trailingDetMatch = clean.match(/^(.+)\{([^}]+)\}$/);
  if (trailingDetMatch) {
    const [, word, det] = trailingDetMatch;
    return [
      {
        sign: SIGN_MAP[word.toLowerCase()] || null,
        reading: word,
        isDeterminative: false,
        isNumber: false,
      },
      {
        sign: SIGN_MAP[det] || null,
        reading: `{${det}}`,
        isDeterminative: true,
        isNumber: false,
      },
    ];
  }

  // Check for embedded determinative: {d}en-lil2
  // Already handled above

  // Plain sign reading
  const lookup = clean.toLowerCase().replace(/@\w+/g, ''); // strip @c, @g etc.
  if (lookup === 'x' || lookup === 'n' || lookup === '...') {
    return [
      {
        sign: null,
        reading: raw,
        isDeterminative: false,
        isNumber: false,
      },
    ];
  }

  return [
    {
      sign: SIGN_MAP[lookup] || null,
      reading: raw,
      isDeterminative: false,
      isNumber: false,
    },
  ];
}

/**
 * Get coverage stats for a set of ATF lines.
 */
export function getSignCoverage(lines: string[]): {
  total: number;
  mapped: number;
  unmapped: string[];
} {
  const unmappedSet = new Set<string>();
  let total = 0;
  let mapped = 0;

  for (const line of lines) {
    const tokens = tokenizeAtfLine(line);
    for (const t of tokens) {
      if (t.isDeterminative || t.isNumber) continue;
      total++;
      if (t.sign) {
        mapped++;
      } else {
        unmappedSet.add(t.reading);
      }
    }
  }

  return { total, mapped, unmapped: [...unmappedSet].sort() };
}
