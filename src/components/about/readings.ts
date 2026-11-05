/**
 * Openings read in the /about "What we do" demo. Same data as the folium-studio.com
 * homepage hero (assets/hero-bph.js): boxes are % of the opening image, and the
 * text is the page's own transcription and translation, cut to the marked line.
 * Scans: public/about/readings/<img>-{m,l}.jpg.
 *
 * The data lives in readings.json so the box editor (/about?edit, dev only) can save it.
 */
export type Box = { l: number; t: number; w: number; h: number; side?: "l" | "r" };
export type Reading = {
  img: string; ar: number; title: string; meta: string; lang: string;
  line: Box; orig: string; en: string;
  ents: (Box & { k: string; v: string })[];
  terms: string[];
  plate: Box & { k: string; tags: string[] };
};

import data from './readings.json';

export const READINGS = data as Reading[];
