// Share cards for /about in every language, taken from the page's own hero.
// Run with the dev server up:  node scripts/one-off/generate-about-og.mjs [port]
// Writes public/og-about.jpg and public/og-about-<lang>.jpg at 2400x1260.
import { chromium } from 'playwright';
import sharp from 'sharp';

const port = process.argv[2] ?? '3000';
const HEADER = 64;
const b = await chromium.launch({ channel: 'chrome' });
for (const lang of ['en', 'es', 'la', 'nl', 'zh']) {
  const p = await b.newPage({ viewport: { width: 1200, height: 630 + HEADER }, deviceScaleFactor: 2 });
  await p.goto(`http://localhost:${port}/${lang === 'en' ? '' : `${lang}/`}about`, { waitUntil: 'load', timeout: 180000 });
  await p.waitForTimeout(1500);
  // Dismiss the cookie banner; its button text differs per language, so click the first of its two.
  await p.evaluate(() => {
    const bar = [...document.querySelectorAll('body *')].filter((el) => getComputedStyle(el).position === 'fixed' && el.querySelector('a[href*="privacy"]'));
    bar.forEach((el) => el.remove());
  });
  await p.addStyleTag({
    content: `.hero-wall ul, nextjs-portal, .hw-hero p { display: none !important; }
      header { visibility: hidden !important; }
      #og-mark { position: fixed; left: 48px; top: ${HEADER + 36}px; z-index: 2147483647; color: #fff; font: 600 24px/1 Inter, system-ui, sans-serif; letter-spacing: .1em; text-shadow: 0 1px 12px rgba(0,0,0,.6); }`,
  });
  await p.evaluate(() => {
    const m = document.createElement('div');
    m.id = 'og-mark';
    m.textContent = 'SOURCE LIBRARY';
    document.documentElement.appendChild(m);
    for (const el of document.querySelectorAll('body *')) {
      if (getComputedStyle(el).position === 'fixed' && /^Mode:/.test(el.textContent ?? '')) el.remove();
    }
  });
  await p.waitForTimeout(4500);
  const shot = await p.screenshot({ clip: { x: 0, y: HEADER, width: 1200, height: 630 } });
  const out = `public/og-about${lang === 'en' ? '' : `-${lang}`}.jpg`;
  await sharp(shot).jpeg({ quality: 80, mozjpeg: true }).toFile(out);
  console.log(out);
  await p.close();
}
await b.close();
