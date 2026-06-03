/*
 * Blurry-image audit — paste into the browser DevTools console on ANY page.
 *
 * Flags every <img> (and CSS background-image) the browser is UPSCALING:
 * intrinsic pixels (naturalWidth) well below the displayed size × the device
 * pixel ratio. Those are the ones that look soft / blurry on screen.
 *
 * Usage: open the page, open DevTools (Cmd+Opt+J), paste, Enter.
 * Lower `RATIO` to be stricter (0.5 = only badly upscaled), raise toward 1.0
 * to catch anything not pixel-perfect on this display.
 */
(() => {
  const DPR = window.devicePixelRatio || 1;
  const RATIO = 0.66; // intrinsic must be >= RATIO * (cssWidth * DPR) to pass
  const rows = [];
  for (const img of document.querySelectorAll('img')) {
    const cssW = img.clientWidth;
    if (!cssW || !img.naturalWidth) continue;        // hidden / not loaded
    const needed = cssW * DPR;
    const ratio = img.naturalWidth / needed;
    if (ratio < RATIO) {
      rows.push({
        upscale: `${(needed / img.naturalWidth).toFixed(1)}x`,
        shownPx: Math.round(cssW),
        intrinsicPx: img.naturalWidth,
        src: (img.currentSrc || img.src || '').slice(0, 120),
        alt: (img.alt || '').slice(0, 40),
      });
    }
  }
  rows.sort((a, b) => parseFloat(b.upscale) - parseFloat(a.upscale));
  console.log(`%cBlurry/upscaled images: ${rows.length}  (DPR=${DPR}, threshold ${RATIO})`,
    'font-weight:bold');
  console.table(rows);
  return rows;
})();
