import puppeteer from 'puppeteer';
import sharp from 'sharp';
import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';

const OUT = path.resolve('public/brand');
fs.mkdirSync(`${OUT}/svg`, { recursive: true });
fs.mkdirSync(`${OUT}/png`, { recursive: true });

// ── Configurations ──────────────────────────────────────────────
const configs = {
  'logo-full': {
    desc: 'Full logo: icon + wordmark',
    html: (fg, bg) => `
      <div class="logo" style="background:${bg};padding:24px;display:inline-flex;align-items:center;gap:12px;">
        <svg style="width:48px;height:48px;" viewBox="0 0 24 24" fill="none">
          <circle cx="12" cy="12" r="10" stroke="${fg}" stroke-width="1"/>
          <circle cx="12" cy="12" r="7" stroke="${fg}" stroke-width="1"/>
          <circle cx="12" cy="12" r="4" stroke="${fg}" stroke-width="1"/>
        </svg>
        <span class="wm" style="color:${fg};">
          <span style="font-weight:600;">Source</span><span style="font-weight:300;">Library</span>
        </span>
      </div>`,
  },
  'logo-compact': {
    desc: 'Compact logo: icon + wordmark, tighter',
    html: (fg, bg) => `
      <div class="logo" style="background:${bg};padding:16px;display:inline-flex;align-items:center;gap:8px;">
        <svg style="width:32px;height:32px;" viewBox="0 0 24 24" fill="none">
          <circle cx="12" cy="12" r="10" stroke="${fg}" stroke-width="1"/>
          <circle cx="12" cy="12" r="7" stroke="${fg}" stroke-width="1"/>
          <circle cx="12" cy="12" r="4" stroke="${fg}" stroke-width="1"/>
        </svg>
        <span class="wm" style="font-size:16px;color:${fg};">
          <span style="font-weight:600;">Source</span><span style="font-weight:300;">Library</span>
        </span>
      </div>`,
  },
  'icon-only': {
    desc: 'Icon only: concentric circles',
    html: (fg, bg) => `
      <div class="logo" style="background:${bg};padding:12px;display:inline-flex;">
        <svg style="width:48px;height:48px;" viewBox="0 0 24 24" fill="none">
          <circle cx="12" cy="12" r="10" stroke="${fg}" stroke-width="1"/>
          <circle cx="12" cy="12" r="7" stroke="${fg}" stroke-width="1"/>
          <circle cx="12" cy="12" r="4" stroke="${fg}" stroke-width="1"/>
        </svg>
      </div>`,
  },
  'wordmark-only': {
    desc: 'Wordmark only: SOURCELIBRARY text',
    html: (fg, bg) => `
      <div class="logo" style="background:${bg};padding:16px 24px;display:inline-flex;align-items:center;">
        <span class="wm" style="color:${fg};">
          <span style="font-weight:600;">Source</span><span style="font-weight:300;">Library</span>
        </span>
      </div>`,
  },
  'logo-stacked': {
    desc: 'Stacked: icon above wordmark',
    html: (fg, bg) => `
      <div class="logo" style="background:${bg};padding:24px;display:inline-flex;flex-direction:column;align-items:center;gap:12px;">
        <svg style="width:64px;height:64px;" viewBox="0 0 24 24" fill="none">
          <circle cx="12" cy="12" r="10" stroke="${fg}" stroke-width="1"/>
          <circle cx="12" cy="12" r="7" stroke="${fg}" stroke-width="1"/>
          <circle cx="12" cy="12" r="4" stroke="${fg}" stroke-width="1"/>
        </svg>
        <span class="wm" style="font-size:18px;letter-spacing:0.08em;color:${fg};">
          <span style="font-weight:600;">Source</span><span style="font-weight:300;">Library</span>
        </span>
      </div>`,
  },
};

const schemes = {
  'white-on-dark':  { fg: 'white',   bg: '#1a1a1a', invertForTrace: true },
  'black-on-white': { fg: '#1a1a1a', bg: 'white',   invertForTrace: false },
  'white-on-transparent': { fg: 'white',   bg: 'transparent', invertForTrace: true,  transparentBg: true },
  'black-on-transparent': { fg: '#1a1a1a', bg: 'transparent', invertForTrace: false, transparentBg: true },
};

const pngSizes = [32, 48, 64, 96, 128, 192, 256, 512];

// ── Main ────────────────────────────────────────────────────────
const browser = await puppeteer.launch();
const page = await browser.newPage();
await page.setViewport({ width: 800, height: 400, deviceScaleFactor: 8 });

// Load fonts ONCE
await page.setContent(`
  <html>
  <head>
    <link href="https://fonts.googleapis.com/css2?family=Inter:wght@300;600&display=swap" rel="stylesheet">
    <style>
      * { margin: 0; padding: 0; }
      body { background: transparent; }
      .wm { font-family: Inter, sans-serif; font-size: 24px; text-transform: uppercase; letter-spacing: 0.05em; }
    </style>
  </head>
  <body>
    <span class="wm" style="font-weight:300">x</span>
    <span class="wm" style="font-weight:600">x</span>
  </body>
  </html>
`, { waitUntil: 'networkidle0' });
await new Promise(r => setTimeout(r, 500));
console.log('Fonts loaded');

let generated = { svg: [], png: [] };

for (const [configName, config] of Object.entries(configs)) {
  for (const [schemeName, scheme] of Object.entries(schemes)) {
    const name = `${configName}--${schemeName}`;
    process.stdout.write(`${name} ...`);

    // Inject HTML without reloading (preserve fonts)
    await page.evaluate((html) => {
      document.body.innerHTML = html;
    }, config.html(scheme.fg, scheme.bg));
    await new Promise(r => setTimeout(r, 100));

    const el = await page.$('.logo');
    if (!el) { console.log(' SKIP (no element)'); continue; }

    const hiresPath = `/tmp/brand-${name}.png`;
    await el.screenshot({ path: hiresPath, omitBackground: !!scheme.transparentBg });

    // ── SVG (only for non-transparent variants) ──
    if (!scheme.transparentBg) {
      try {
        const invertedPath = `/tmp/brand-${name}-inv.png`;
        if (scheme.invertForTrace) {
          await sharp(hiresPath).negate({ alpha: false }).toFile(invertedPath);
        } else {
          fs.copyFileSync(hiresPath, invertedPath);
        }

        const pbmPath = `/tmp/brand-${name}.pbm`;
        const svgPath = `${OUT}/svg/${name}.svg`;
        execSync(`magick "${invertedPath}" -threshold 50% "${pbmPath}"`);
        execSync(`potrace "${pbmPath}" -s -o "${svgPath}" --tight`);

        let svg = fs.readFileSync(svgPath, 'utf8');
        svg = svg.replace(/<\?xml[^?]*\?>\n?/, '');
        svg = svg.replace(/<!DOCTYPE[^>]*>\n?/, '');
        svg = svg.replace(/<metadata>[\s\S]*?<\/metadata>\n?/, '');

        if (scheme.invertForTrace) {
          svg = svg.replace(/(<svg[^>]*>)/, `$1\n<rect width="100%" height="100%" fill="${scheme.bg}"/>`);
          svg = svg.replace(/fill="#000000"/, 'fill="#ffffff"');
        } else {
          svg = svg.replace(/(<svg[^>]*>)/, `$1\n<rect width="100%" height="100%" fill="${scheme.bg}"/>`);
        }

        fs.writeFileSync(svgPath, svg);
        generated.svg.push(`svg/${name}.svg`);
      } catch (e) {
        process.stdout.write(` SVG-ERR(${e.message.slice(0,40)})`);
      }
    }

    // ── PNGs at various sizes ──
    const meta = await sharp(hiresPath).metadata();
    const aspect = meta.width / meta.height;

    for (const h of pngSizes) {
      const w = Math.round(h * aspect);
      const pngName = `${name}--${h}h.png`;
      const pngPath = `${OUT}/png/${pngName}`;
      await sharp(hiresPath).resize(w, h, { fit: 'inside' }).png().toFile(pngPath);
      generated.png.push(`png/${pngName}`);
    }
    console.log(` done`);
  }
}

await browser.close();

// ── README ──────────────────────────────────────────────────────
const readme = `# Source Library Brand Kit

Generated ${new Date().toISOString().split('T')[0]}

## Configurations

| Name | Description |
|------|-------------|
${Object.entries(configs).map(([k, v]) => `| \`${k}\` | ${v.desc} |`).join('\n')}

## Color Schemes

| Name | Foreground | Background |
|------|-----------|------------|
${Object.entries(schemes).map(([k, v]) => `| \`${k}\` | ${v.fg} | ${v.bg} |`).join('\n')}

## SVG Files (${generated.svg.length})

Vector outlines, font-independent.

${generated.svg.map(f => `- \`${f}\``).join('\n')}

## PNG Files (${generated.png.length})

Heights: ${pngSizes.join(', ')}px. Naming: \`{config}--{scheme}--{height}h.png\`

## Quick Reference

| Use case | Recommended file |
|----------|-----------------|
| Website header (dark bg) | \`svg/logo-full--white-on-dark.svg\` |
| Website header (light bg) | \`svg/logo-full--black-on-white.svg\` |
| Favicon | \`png/icon-only--black-on-white--32h.png\` |
| Social media avatar | \`png/icon-only--white-on-dark--512h.png\` |
| Social media banner | \`png/logo-full--white-on-dark--512h.png\` |
| Print (dark bg) | \`svg/logo-full--white-on-dark.svg\` |
| Print (light bg) | \`svg/logo-full--black-on-white.svg\` |
| Watermark / overlay | \`png/logo-full--white-on-transparent--256h.png\` |
| Email signature | \`png/logo-compact--black-on-transparent--48h.png\` |
| App icon | \`png/icon-only--white-on-dark--192h.png\` |

## Brand Colors

| Name | Hex | Usage |
|------|-----|-------|
| Dark | \`#1a1a1a\` | Backgrounds, dark text |
| White | \`#ffffff\` | Light text, light backgrounds |
| Amber | \`#d97706\` | Accent (CTAs, highlights) |

## Typography

- **Font**: Inter (Google Fonts)
- **"Source"**: Weight 600 (semibold)
- **"Library"**: Weight 300 (light)
- **Case**: Uppercase
- **Tracking**: 0.05em
`;

fs.writeFileSync(`${OUT}/README.md`, readme);

console.log(`\nDone: ${generated.svg.length} SVGs, ${generated.png.length} PNGs`);
console.log(`Output: ${OUT}`);
