/** The hero bar is the nav's own colour (bg-dark, --color-dark), solid, so the page reads top to bottom as one frame. */
export const NAV_DARK = 'var(--color-dark, #1a1612)';
// eslint-disable-next-line @typescript-eslint/no-unused-vars
export const fill = (_tone?: string) => NAV_DARK;
/** Shared look for blocks on the hero: white text, hover lightens a step. */
export const GLASS = 'text-white transition-[filter] hover:brightness-150';

/** Hover on the strip's search field, to compare (?sh=). Each is slight; on focus the icon turns white (no underline). */
export const HOVERS: [string, string][] = [['edge', 'A Edge line'], ['slide', 'B Slide'], ['lift', 'C Strip lifts'], ['hint', 'D Hint'], ['none', 'E None']];
