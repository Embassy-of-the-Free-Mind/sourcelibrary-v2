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
  'logo-full-beta': {
    desc: 'Full logo with Beta superscript (matches live site header)',
    html: (fg, bg) => `
      <div class="logo" style="background:${bg};padding:24px;display:inline-flex;align-items:center;gap:12px;">
        <svg style="width:48px;height:48px;" viewBox="0 0 24 24" fill="none">
          <circle cx="12" cy="12" r="10" stroke="${fg}" stroke-width="1"/>
          <circle cx="12" cy="12" r="7" stroke="${fg}" stroke-width="1"/>
          <circle cx="12" cy="12" r="4" stroke="${fg}" stroke-width="1"/>
        </svg>
        <span class="wm" style="color:${fg};">
          <span style="font-weight:600;">Source</span><span style="font-weight:300;">Library</span><sup style="font-size:0.6em;font-weight:300;letter-spacing:normal;text-transform:none;margin-left:0.25em;opacity:0.8;position:relative;top:-0.5em;">Beta</sup>
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
  'white-on-dark':  { fg: 'white',   bg: '#1a1612', invertForTrace: true },
  'black-on-white': { fg: '#1a1612', bg: 'white',   invertForTrace: false },
  'white-on-transparent': { fg: 'white',   bg: 'transparent', invertForTrace: true,  transparentBg: true },
  'black-on-transparent': { fg: '#1a1612', bg: 'transparent', invertForTrace: false, transparentBg: true },
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
    <link href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600&family=Newsreader:ital,opsz,wght@0,6..72,400;0,6..72,500;0,6..72,600;1,6..72,400;1,6..72,500&family=Cormorant+Garamond:wght@400;500;600&family=Playfair+Display:wght@400;600;700&display=swap" rel="stylesheet">
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
| Beta-branded header (dark bg) | \`svg/logo-full-beta--white-on-dark.svg\` |
| Beta-branded header (light bg) | \`svg/logo-full-beta--black-on-white.svg\` |
| Favicon | \`png/icon-only--black-on-white--32h.png\` |
| Social media avatar | \`png/icon-only--white-on-dark--512h.png\` |
| Social media banner | \`png/logo-full--white-on-dark--512h.png\` |
| Print (dark bg) | \`svg/logo-full--white-on-dark.svg\` |
| Print (light bg) | \`svg/logo-full--black-on-white.svg\` |
| Watermark / overlay | \`png/logo-full--white-on-transparent--256h.png\` |
| Email signature | \`png/logo-compact--black-on-transparent--48h.png\` |
| App icon | \`png/icon-only--white-on-dark--192h.png\` |

## Brand Colors

Sourced from \`src/app/globals.css\` (CSS variables under \`:root\`).

### Neutrals

| Name | Hex | Variable | Usage |
|------|-----|----------|-------|
| Cream | \`#fdfcf9\` | \`--bg-cream\` | Primary page background |
| Warm | \`#f5f0e8\` | \`--bg-warm\` | Secondary surface (cards, panels) |
| Dark | \`#1a1612\` | \`--bg-dark\` / \`--text-primary\` | Dark backgrounds, primary text |
| White | \`#ffffff\` | — | Light text on dark, light surfaces |

### Accents

| Name | Hex | Variable | Usage |
|------|-----|----------|-------|
| Rust | \`#9e4a3a\` | \`--accent-rust\` | Primary CTA, links, key actions |
| Gold | \`#c9a86c\` | \`--accent-gold\` | Highlights, decorative emphasis |
| Gold (dark) | \`#9e7c3c\` | \`--accent-gold-dark\` | Gold on light backgrounds |
| Sage | \`#8b9a7d\` | \`--accent-sage\` | Secondary accents, success-adjacent |
| Sage (dark) | \`#5e6d52\` | \`--accent-sage-dark\` | Sage on light backgrounds |
| Violet | \`#7c5db5\` | \`--accent-violet\` | Special-case accent (rarely used) |

### Borders

| Name | Hex | Variable | Usage |
|------|-----|----------|-------|
| Border light | \`#e8e4dc\` | \`--border-light\` | Hairlines, subtle dividers |
| Border medium | \`#d4cfc4\` | \`--border-medium\` | Stronger dividers, card edges |

### Text

| Name | Hex | Variable | Usage |
|------|-----|----------|-------|
| Primary | \`#1a1612\` | \`--text-primary\` | Body, headings |
| Muted | \`#6b6560\` | \`--text-muted\` | Captions, secondary text (5.2:1 on cream) |
| Faint | \`#8a8480\` | \`--text-faint\` | Tertiary text (4.5:1 on cream) |

## Typography

The site uses four font families from Google Fonts, each with a distinct role.

| Role | Family | Variable | Weights | Used for |
|------|--------|----------|---------|----------|
| Sans | **Inter** | \`--font-sans\` | 300, 400, 500, 600 | UI, navigation, **logo**, buttons, headers |
| Body serif | **Newsreader** | \`--font-body\` | 400, 500, italic 400/500 (opsz 6–72) | Long-form reading prose, book pages |
| Display serif | **Cormorant Garamond** | \`--font-serif\` | 400, 500, 600 | Section headings, editorial display |
| Hero display | **Playfair Display** | \`--font-display\` | 400, 600, 700 | Top-of-page hero titles, large display |

### Logo wordmark specifics

- **Family**: Inter
- **"Source"**: weight 600 (semibold)
- **"Library"**: weight 300 (light)
- **"Beta"** (when shown): weight 300, 0.6em, normal case, tracking-normal, opacity 0.8, vertical offset −0.5em
- **Case**: uppercase
- **Tracking**: 0.05em (Tailwind \`tracking-wider\`)

### Script fonts (content, not brand)

Used inside the reader for non-Latin scripts; not part of brand identity:

- **Noto Naskh Arabic** / **Noto Sans Arabic** — Arabic text
- **Noto Sans Hebrew** / **Noto Rashi Hebrew** — Hebrew text
`;

fs.writeFileSync(`${OUT}/README.md`, readme);

console.log(`\nDone: ${generated.svg.length} SVGs, ${generated.png.length} PNGs`);
console.log(`Output: ${OUT}`);
