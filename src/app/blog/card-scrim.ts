// The dark gradient a blog lead card sets its title on. It sits behind the text
// block, not across the whole picture, so the text is legible over any image:
// everything below the top FADE_PX of the block is at least MIN_ALPHA dark.
// Worst case (white paper under the text): white title ≈ 8.5:1, stone-300 meta
// ≈ 5.7:1, both above WCAG AA (4.5:1). scripts/audit/blog-card-legibility.ts
// measures it on every real image and must agree.
// Colour is the site's dark ink (--color-primary), as in ContentHeader's scrim.

export const SCRIM_RGB = [26, 22, 18] as const;
export const SCRIM_MIN_ALPHA = 0.78; // at the top of the text
export const SCRIM_MAX_ALPHA = 0.92; // at the bottom edge
export const FADE_PX = 64; // soft edge above the text, where the picture shows through

const rgba = (a: number) => `rgba(${SCRIM_RGB.join(',')},${a})`;

export const CARD_SCRIM = `linear-gradient(to top, ${rgba(SCRIM_MAX_ALPHA)} 0, ${rgba(SCRIM_MIN_ALPHA)} calc(100% - ${FADE_PX}px), ${rgba(0)} 100%)`;
