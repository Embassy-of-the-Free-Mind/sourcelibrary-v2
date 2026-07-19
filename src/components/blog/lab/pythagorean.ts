/**
 * Shared Pythagorean interval arithmetic for the playable-facsimile demos
 * (/blog/playable-page, issue #3224). Everything is computed from exact
 * ratios (9:8 tone, 256:243 limma, 2187:2048 apotome), never from rounded
 * cents — that is what lets the Boethius ladder reproduce the manuscript's
 * canonical monochord integers (9216, 8192 … 2304) on the nose.
 */

export const LIMMA = 256 / 243;
export const APOTOME = 2187 / 2048;

export const cents = (ratio: number) => 1200 * Math.log2(ratio);

/** Just-interval names within the tolerance the demos display. */
const JUST_TABLE: [number, string][] = [
  [0, 'a unison'],
  [204, 'a whole tone'],
  [498, 'a pure fourth'],
  [702, 'a pure fifth'],
  [996, 'a minor seventh — two fourths'],
  [1200, 'the octave'],
  [1404, 'an octave and a tone — two fifths'],
  [1698, 'an octave and a fourth'],
  [1902, 'an octave and a fifth'],
  [2400, 'a double octave'],
];

export function justName(c: number): string | null {
  for (const [jc, name] of JUST_TABLE) {
    if (Math.abs(jc - c) <= 6) return name;
  }
  return null;
}

/** Display name for a bench outcome: just name, tritone, or honest nothing. */
export function outcomeName(c: number): { label: string; pure: boolean } {
  const name = justName(c);
  if (name) return { label: name, pure: true };
  if (Math.abs(c - 600) <= 6) return { label: 'the tritone — √2', pure: false };
  return { label: 'no name in the scale', pure: false };
}

const NOTE_NAMES = ['C', 'C♯', 'D', 'D♯', 'E', 'F', 'F♯', 'G', 'G♯', 'A', 'A♯', 'B'];

/** Nearest modern (12-TET, A440) note name with signed cent deviation ≥3¢. */
export function noteName(f: number): string {
  const midiF = 69 + 12 * Math.log2(f / 440);
  const midi = Math.round(midiF);
  const off = Math.round((midiF - midi) * 100);
  const label = NOTE_NAMES[((midi % 12) + 12) % 12] + (Math.floor(midi / 12) - 1);
  return Math.abs(off) < 3 ? label : `${label} ${off > 0 ? '+' : '−'}${Math.abs(off)}¢`;
}

/**
 * The Greater Perfect System: fifteen strings, Proslambanomenos → Nete
 * hyperboleon. Fixed strings carry exact ratios vs Proslambanomenos; movable
 * strings are genus offsets from their tetrachord's lowest fixed string.
 */
export const GPS_NAMES = [
  'Proslambanomenos', 'Hypate hypaton', 'Parhypate hypaton', 'Lichanos hypaton',
  'Hypate meson', 'Parhypate meson', 'Lichanos meson', 'Mese', 'Paramese',
  'Trite diezeugmenon', 'Paranete diezeug.', 'Nete diezeugmenon',
  'Trite hyperboleon', 'Paranete hyperb.', 'Nete hyperboleon',
];

const GPS_FIXED: Record<number, number> = { 0: 1, 1: 9 / 8, 4: 3 / 2, 7: 2, 8: 9 / 4, 11: 3, 14: 4 };
const GPS_TETRA: Record<number, [number, number]> = {
  2: [1, 0], 3: [1, 1], 5: [4, 0], 6: [4, 1],
  9: [8, 0], 10: [8, 1], 12: [11, 0], 13: [11, 1],
};

export type Genus = 'dia' | 'chr' | 'enh';

/**
 * Inner-note offsets per genus (ratio above the tetrachord base). The
 * enharmonic dieses are equal halves of the limma in log-pitch; Boethius
 * divides the ruler arithmetically — a hair's difference, noted in the copy.
 */
const GENUS_STEPS: Record<Genus, [number, number]> = {
  dia: [LIMMA, LIMMA * (9 / 8)],
  chr: [LIMMA, LIMMA * APOTOME],
  enh: [Math.sqrt(LIMMA), LIMMA],
};

export const GPS_RULER = 9216;

export function gpsRatios(genus: Genus): number[] {
  const steps = GENUS_STEPS[genus];
  const out: number[] = [];
  for (let i = 0; i < 15; i++) {
    const fixed = GPS_FIXED[i];
    if (fixed !== undefined) {
      out.push(fixed);
    } else {
      const [base, step] = GPS_TETRA[i];
      out.push(GPS_FIXED[base] * steps[step]);
    }
  }
  return out;
}

export const GPS_MOVABLE = new Set(Object.keys(GPS_TETRA).map(Number));
