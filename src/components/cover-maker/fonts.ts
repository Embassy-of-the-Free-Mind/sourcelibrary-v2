import { Cinzel, EB_Garamond, IM_Fell_English, Inter, UnifrakturMaguntia } from 'next/font/google';
import { aldineAetna, cardo } from '@/lib/fonts/aldine';
import type { FontKey } from './types';

/**
 * Faces offered for cover lettering. Loaded with next/font so they are
 * self-hosted (the CSP allows no other font host) and cost nothing outside
 * the cover maker. Canvas needs the real family name, which next/font hashes,
 * so we read it from `.style.fontFamily`.
 */
const fell = IM_Fell_English({ weight: '400', style: ['normal', 'italic'], subsets: ['latin'], display: 'swap' });
const garamond = EB_Garamond({ weight: ['400', '700'], style: ['normal', 'italic'], subsets: ['latin', 'latin-ext'], display: 'swap' });
const fraktur = UnifrakturMaguntia({ weight: '400', subsets: ['latin'], display: 'swap' });
const cinzel = Cinzel({ weight: ['400', '700'], subsets: ['latin', 'latin-ext'], display: 'swap' });
const sans = Inter({ weight: ['400', '700'], subsets: ['latin', 'latin-ext'], display: 'swap' });

export const FONTS: Record<FontKey, { label: string; family: string; className: string; bold: boolean }> = {
  cardo: { label: 'Cardo (Aldine revival)', family: cardo.style.fontFamily, className: cardo.className, bold: true },
  aldine: { label: 'Aldine 1496 facsimile', family: aldineAetna.style.fontFamily, className: aldineAetna.className, bold: false },
  fell: { label: 'Fell types', family: fell.style.fontFamily, className: fell.className, bold: false },
  garamond: { label: 'Garamond', family: garamond.style.fontFamily, className: garamond.className, bold: true },
  cinzel: { label: 'Roman capitals', family: cinzel.style.fontFamily, className: cinzel.className, bold: true },
  fraktur: { label: 'Fraktur', family: fraktur.style.fontFamily, className: fraktur.className, bold: false },
  sans: { label: 'Sans', family: sans.style.fontFamily, className: sans.className, bold: true },
};

/** Canvas draws with whatever is loaded at that moment; wait for every face first. */
export async function loadCoverFonts(): Promise<void> {
  if (typeof document === 'undefined' || !document.fonts) return;
  const loads: Promise<unknown>[] = [];
  for (const f of Object.values(FONTS)) {
    loads.push(document.fonts.load(`400 40px ${f.family}`));
    loads.push(document.fonts.load(`italic 400 40px ${f.family}`));
    if (f.bold) loads.push(document.fonts.load(`700 40px ${f.family}`));
  }
  await Promise.allSettled(loads);
}
