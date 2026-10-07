// The headline findings, shared by the paper (/research/quality) and its one-page summary
// (/research/quality/summary) so the two cannot disagree. Hrefs are anchors on the paper.
// PRIOR ART: none — the list lived inline in page.tsx until the summary page needed it too.
import type { ReactNode } from 'react';

export const KEY_FINDINGS: { figure: string; text: ReactNode; href: string }[] = [
  { figure: '89%', text: <>of served pages rated faithful to their transcription by a model judge (CI 85–92); 71% for non-Latin scripts.</>, href: '#s4' },
  { figure: '⅔', text: <>of translated pages are Latin, English or German, where transcription error is measured at 0.6–5.3%.</>, href: '#by-language' },
  { figure: 'Greek', text: <>is the largest gap: a tenth of the library, 11% character error on the current engine, 75% rated faithful. Against published translations, a wrong transcription causes 16 of 22 bad pages.</>, href: '#against-references' },
  { figure: '13%', text: <>of translated pages (French, Italian, Dutch, Spanish) have no transcription measurement yet.</>, href: '#by-language' },
  { figure: '0', text: <>results checked by a person who reads the language. A reader panel is preregistered.</>, href: '#s6' },
];
