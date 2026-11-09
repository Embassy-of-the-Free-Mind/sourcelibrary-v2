/** Fills for the bar and the blocks beside it on the hero, to compare (?tone=). All dark. */
export const TONES: [string, string, string][] = [
  ['ink', 'A Ink', 'rgba(20,16,12,.88)'],
  ['smoke', 'B Smoked glass', 'rgba(0,0,0,.5)'],
];
export const fill = (tone: string) => TONES.find((t) => t[0] === tone)?.[2] ?? TONES[0][2];
/** Shared look: white text, blur behind, hover lightens a step. */
export const GLASS = 'text-white backdrop-blur-md transition-[filter] hover:brightness-150';
