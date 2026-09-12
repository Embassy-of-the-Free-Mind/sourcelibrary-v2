/**
 * Generates Open Graph share-card variants from hero-video frames.
 *
 * Inputs:  scripts/one-off/og-sources/{cosmological,zodiac,illuminated,arcani}.jpg
 * Outputs: public/og-image-{name}.jpg     (English, 1200x630, brand-overlaid)
 *          public/og-image-es-{name}.jpg  (Spanish copy, same frames)
 *
 * One card per frame per locale: a Spanish link shared into a Spanish
 * conversation should not preview in English (#4162). The Spanish headline is
 * the authored line the /es homepage hero already uses (src/lib/home-i18n.ts),
 * so the card and the page a reader lands on say the same thing.
 *
 * Each variant uses the same typography overlay:
 * - SOURCELIBRARY wordmark + Beta sup (Inter)
 * - Display headline (Playfair Display)
 * - Subhead (Newsreader)
 * - Footer URL (Inter)
 *
 * A left-to-right dark gradient ensures the text reads cleanly against any
 * background. Tweak GRADIENT_OPACITY per variant if a particular frame
 * needs more or less darkening.
 */

import { chromium } from 'playwright';
import fs from 'fs';
import path from 'path';

const SOURCES = path.resolve('scripts/one-off/og-sources');
const OUT = path.resolve('public');

// The four background frames. Copy is per-locale (COPY below), so each frame
// produces one card per locale.
const VARIANTS = [
  { name: 'cosmological', gradientOpacity: 0.88 },
  { name: 'zodiac', gradientOpacity: 0.82 },
  { name: 'illuminated', gradientOpacity: 0.80 },
  { name: 'arcani', gradientOpacity: 0.85 },
];

// Locale copy. `prefix` is the filename infix: '' for English (the historical
// og-image-{name}.jpg names, which are already live), 'es-' for Spanish.
const COPY = [
  {
    lang: 'en',
    prefix: '',
    headline: 'Unlock a New Renaissance of Ancient Knowledge',
    subhead: 'Rare Hermetic and esoteric texts, digitized and translated for scholars, seekers, and AI.',
  },
  {
    lang: 'es',
    prefix: 'es-',
    headline: 'Un nuevo Renacimiento de la sabiduría antigua',
    subhead: 'Textos herméticos y esotéricos raros, digitalizados y traducidos para estudiosos, buscadores y sistemas de IA.',
  },
];

const renderHtml = ({ bgDataUrl, headline, subhead, gradientOpacity }) => `
<!doctype html>
<html>
<head>
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600&family=Newsreader:opsz,wght@6..72,400;6..72,500&family=Playfair+Display:wght@400;600;700&display=swap" rel="stylesheet">
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { width: 1200px; height: 630px; overflow: hidden; }
    .card {
      width: 1200px;
      height: 630px;
      position: relative;
      background: url('${bgDataUrl}') center/cover no-repeat;
      color: #fff;
    }
    .gradient {
      position: absolute;
      inset: 0;
      background:
        linear-gradient(90deg, rgba(15,10,8,${gradientOpacity}) 0%, rgba(15,10,8,${gradientOpacity * 0.85}) 30%, rgba(15,10,8,0.15) 75%, rgba(15,10,8,0.05) 100%),
        linear-gradient(180deg, rgba(15,10,8,0.30) 0%, rgba(15,10,8,0) 35%, rgba(15,10,8,0) 70%, rgba(15,10,8,0.45) 100%);
    }
    .content {
      position: relative;
      padding: 60px 72px;
      height: 100%;
      display: flex;
      flex-direction: column;
      justify-content: space-between;
      max-width: 720px;
    }
    .logo {
      display: flex;
      align-items: center;
      gap: 14px;
    }
    .logo svg { width: 36px; height: 36px; }
    .logo .wm {
      font-family: 'Inter', sans-serif;
      font-size: 22px;
      text-transform: uppercase;
      letter-spacing: 0.05em;
      color: #fff;
    }
    .logo .wm .s { font-weight: 600; }
    .logo .wm .l { font-weight: 300; }
    .logo .wm .beta {
      font-size: 0.6em;
      font-weight: 300;
      letter-spacing: normal;
      text-transform: none;
      margin-left: 0.25em;
      opacity: 0.8;
      position: relative;
      top: -0.5em;
      vertical-align: baseline;
    }
    .headline {
      font-family: 'Playfair Display', Georgia, serif;
      font-weight: 600;
      font-size: 58px;
      line-height: 1.06;
      letter-spacing: -0.01em;
      color: #fefdfb;
      max-width: 640px;
      text-shadow: 0 2px 24px rgba(0,0,0,0.55);
    }
    .subhead {
      font-family: 'Newsreader', Georgia, serif;
      font-weight: 400;
      font-size: 22px;
      line-height: 1.45;
      color: #e8e1d4;
      max-width: 580px;
      margin-top: 18px;
      text-shadow: 0 1px 12px rgba(0,0,0,0.55);
    }
    .footer {
      font-family: 'Inter', sans-serif;
      font-size: 16px;
      font-weight: 400;
      letter-spacing: 0.04em;
      color: #c9a86c;
      text-shadow: 0 1px 8px rgba(0,0,0,0.7);
    }
    .middle { display: flex; flex-direction: column; }
  </style>
</head>
<body>
  <div class="card">
    <div class="gradient"></div>
    <div class="content">
      <div class="logo">
        <svg viewBox="0 0 24 24" fill="none">
          <circle cx="12" cy="12" r="10" stroke="#fff" stroke-width="1"/>
          <circle cx="12" cy="12" r="7" stroke="#fff" stroke-width="1"/>
          <circle cx="12" cy="12" r="4" stroke="#fff" stroke-width="1"/>
        </svg>
        <span class="wm"><span class="s">Source</span><span class="l">Library</span><sup class="beta">Beta</sup></span>
      </div>
      <div class="middle">
        <h1 class="headline">${headline}</h1>
        <p class="subhead">${subhead}</p>
      </div>
      <div class="footer">sourcelibrary.org</div>
    </div>
  </div>
</body>
</html>
`;

// Playwright, not puppeteer: playwright is already a devDependency here and
// its Chromium is installed, so this script runs from a plain `npm ci` checkout.
const browser = await chromium.launch();
const page = await browser.newPage({
  viewport: { width: 1200, height: 630 },
  deviceScaleFactor: 2,
});

// Warm up the page once so the font CSS loads — subsequent setContent calls
// reuse the cached fonts and don't re-hit the network.
await page.setContent(`
  <html><head>
    <link href="https://fonts.googleapis.com/css2?family=Inter:wght@300;600&family=Newsreader:opsz,wght@6..72,400&family=Playfair+Display:wght@600&display=swap" rel="stylesheet">
    <style>
      .a { font-family: Inter; font-weight: 600; }
      .b { font-family: Inter; font-weight: 300; }
      .c { font-family: 'Playfair Display'; font-weight: 600; }
      .d { font-family: Newsreader; }
    </style>
  </head><body>
    <span class="a">A</span><span class="b">B</span><span class="c">C</span><span class="d">D</span>
  </body></html>
`, { waitUntil: 'load', timeout: 60000 });
await page.evaluate(() => document.fonts.ready);
await new Promise(r => setTimeout(r, 500));
console.log('Fonts loaded');

// Only the locales named on the command line are rebuilt (default: all), so
// regenerating the Spanish set never silently reflows the live English cards.
const wanted = process.argv.slice(2).filter((a) => !a.startsWith('-'));
const locales = wanted.length ? COPY.filter((c) => wanted.includes(c.lang)) : COPY;
if (!locales.length) {
  console.error(`No matching locale. Known: ${COPY.map((c) => c.lang).join(', ')}`);
  process.exit(1);
}

for (const variant of VARIANTS) {
  const srcPath = path.join(SOURCES, `${variant.name}.jpg`);
  if (!fs.existsSync(srcPath)) {
    console.log(`SKIP ${variant.name}: source not found at ${srcPath}`);
    continue;
  }
  const bgBuf = fs.readFileSync(srcPath);
  const bgDataUrl = `data:image/jpeg;base64,${bgBuf.toString('base64')}`;

  for (const copy of locales) {
    await page.setContent(renderHtml({ ...variant, ...copy, bgDataUrl }), { waitUntil: 'load', timeout: 60000 });
    await page.evaluate(() => document.fonts.ready);
    await new Promise(r => setTimeout(r, 300));

    const outPath = path.join(OUT, `og-image-${copy.prefix}${variant.name}.jpg`);
    await page.screenshot({
      path: outPath,
      type: 'jpeg',
      quality: 88,
      clip: { x: 0, y: 0, width: 1200, height: 630 },
    });
    console.log(`✓ ${path.relative(process.cwd(), outPath)}`);
  }
}

await browser.close();
console.log('\nDone.');
