/**
 * Generate SVG figures for the translation census paper.
 *
 * 1. Funnel diagram: USTC → distinct works → translated → complete
 * 2. Catalog Venn: LOC MARC vs existing catalog overlap (by author)
 * 3. Histogram: translations published by decade (when was translation done?)
 * 4. Language bar chart: USTC works vs translations by language
 * 5. Author coverage chart: top authors, works vs translations
 */

import { writeFileSync, mkdirSync } from 'fs';

const OUT = 'papers/figures';

// ── 1. Funnel ──────────────────────────────────────────────────────────

function makeFunnel() {
  const stages = [
    { label: 'USTC editions (1450-1700)', value: '1,628,578', width: 500, color: '#e8e4df' },
    { label: 'Non-English editions', value: '1,464,217', width: 460, color: '#ddd8d0' },
    { label: 'Distinct works', value: '~693,135', width: 380, color: '#c9c1b6' },
    { label: 'With any English translation', value: '~31,361 (4.5%)', width: 120, color: '#b87333' },
    { label: 'With complete modern translation', value: '~21,000 (3.0%)', width: 80, color: '#8b4513' },
  ];

  const h = 60, gap = 8, padX = 50, padY = 40;
  const totalH = stages.length * (h + gap) - gap + padY * 2 + 30;
  const svgW = 600;

  let svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${svgW} ${totalH}" font-family="Georgia, serif">\n`;
  svg += `<rect width="${svgW}" height="${totalH}" fill="white"/>\n`;
  svg += `<text x="${svgW/2}" y="28" text-anchor="middle" font-size="16" font-weight="bold" fill="#1a1a1a">The Translation Funnel</text>\n`;

  for (let i = 0; i < stages.length; i++) {
    const s = stages[i];
    const y = padY + 30 + i * (h + gap);
    const x = (svgW - s.width) / 2;

    // Trapezoid connecting to next stage
    if (i < stages.length - 1) {
      const next = stages[i + 1];
      const nx = (svgW - next.width) / 2;
      const ny = y + h;
      svg += `<polygon points="${x},${y + h} ${x + s.width},${y + h} ${nx + next.width},${ny + gap} ${nx},${ny + gap}" fill="${s.color}" opacity="0.3"/>\n`;
    }

    // Bar
    svg += `<rect x="${x}" y="${y}" width="${s.width}" height="${h}" rx="4" fill="${s.color}"/>\n`;

    // Text
    const textColor = i >= 3 ? 'white' : '#1a1a1a';
    svg += `<text x="${svgW/2}" y="${y + h/2 - 8}" text-anchor="middle" font-size="13" fill="${textColor}" font-weight="bold">${s.value}</text>\n`;
    svg += `<text x="${svgW/2}" y="${y + h/2 + 10}" text-anchor="middle" font-size="11" fill="${textColor}" opacity="0.85">${s.label}</text>\n`;
  }

  svg += '</svg>';
  writeFileSync(`${OUT}/funnel.svg`, svg);
  console.log('Created funnel.svg');
}

// ── 2. Catalog overlap ─────────────────────────────────────────────────

function makeCatalogOverlap() {
  // Data: 12,612 only LOC, 1,669 only existing, 718 both
  const svgW = 500, svgH = 320;
  const cx1 = 190, cx2 = 310, cy = 160, r = 120;

  let svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${svgW} ${svgH}" font-family="Georgia, serif">\n`;
  svg += `<rect width="${svgW}" height="${svgH}" fill="white"/>\n`;
  svg += `<text x="${svgW/2}" y="28" text-anchor="middle" font-size="16" font-weight="bold" fill="#1a1a1a">Catalog Overlap by Author</text>\n`;

  // Circles
  svg += `<circle cx="${cx1}" cy="${cy}" r="${r}" fill="#b87333" opacity="0.25" stroke="#b87333" stroke-width="2"/>\n`;
  svg += `<circle cx="${cx2}" cy="${cy}" r="${r}" fill="#4a6fa5" opacity="0.25" stroke="#4a6fa5" stroke-width="2"/>\n`;

  // Labels
  svg += `<text x="${cx1 - 45}" y="${cy - 15}" text-anchor="middle" font-size="28" font-weight="bold" fill="#8b4513">1,669</text>\n`;
  svg += `<text x="${cx1 - 45}" y="${cy + 8}" text-anchor="middle" font-size="11" fill="#8b4513">only in existing</text>\n`;
  svg += `<text x="${cx1 - 45}" y="${cy + 22}" text-anchor="middle" font-size="11" fill="#8b4513">catalogs</text>\n`;

  svg += `<text x="${svgW/2}" y="${cy - 15}" text-anchor="middle" font-size="28" font-weight="bold" fill="#333">718</text>\n`;
  svg += `<text x="${svgW/2}" y="${cy + 8}" text-anchor="middle" font-size="11" fill="#333">in both</text>\n`;

  svg += `<text x="${cx2 + 45}" y="${cy - 15}" text-anchor="middle" font-size="28" font-weight="bold" fill="#2c5282">12,612</text>\n`;
  svg += `<text x="${cx2 + 45}" y="${cy + 8}" text-anchor="middle" font-size="11" fill="#2c5282">only in</text>\n`;
  svg += `<text x="${cx2 + 45}" y="${cy + 22}" text-anchor="middle" font-size="11" fill="#2c5282">LOC MARC</text>\n`;

  // Legend
  svg += `<text x="${cx1}" y="${svgH - 20}" text-anchor="middle" font-size="12" fill="#8b4513">UNESCO + 45 catalogs</text>\n`;
  svg += `<text x="${cx2}" y="${svgH - 20}" text-anchor="middle" font-size="12" fill="#2c5282">Library of Congress</text>\n`;

  svg += '</svg>';
  writeFileSync(`${OUT}/catalog-overlap.svg`, svg);
  console.log('Created catalog-overlap.svg');
}

// ── 3. Translation timeline ────────────────────────────────────────────

function makeTimeline() {
  // Translations published by decade (from LOC MARC data)
  const data = [
    [1550, 11], [1560, 17], [1570, 29], [1580, 30], [1590, 32],
    [1600, 34], [1610, 42], [1620, 32], [1630, 56], [1640, 14],
    [1650, 21], [1660, 10], [1670, 20], [1680, 36], [1690, 27],
    [1700, 24], [1710, 24], [1720, 31], [1730, 44], [1740, 29],
    [1750, 35], [1760, 27], [1770, 37], [1780, 73], [1790, 195],
    [1800, 108], [1810, 78], [1820, 109], [1830, 94], [1840, 120],
    [1850, 130], [1860, 73], [1870, 79], [1880, 129], [1890, 158],
    [1900, 172], [1910, 136], [1920, 244], [1930, 278], [1940, 230],
    [1950, 518], [1960, 1230], [1970, 917], [1980, 2011],
    [1990, 10773], [2000, 12009], [2010, 3916],
  ];

  const svgW = 700, svgH = 400;
  const padL = 60, padR = 20, padT = 50, padB = 60;
  const chartW = svgW - padL - padR;
  const chartH = svgH - padT - padB;
  const maxVal = Math.max(...data.map(d => d[1]));
  const barW = chartW / data.length - 1;

  let svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${svgW} ${svgH}" font-family="Georgia, serif">\n`;
  svg += `<rect width="${svgW}" height="${svgH}" fill="white"/>\n`;
  svg += `<text x="${svgW/2}" y="28" text-anchor="middle" font-size="16" font-weight="bold" fill="#1a1a1a">When Were Translations Published?</text>\n`;
  svg += `<text x="${svgW/2}" y="44" text-anchor="middle" font-size="11" fill="#666">English translations of pre-1800 works, by decade of publication (LOC MARC data)</text>\n`;

  // Use log scale for the huge range
  const logMax = Math.log10(maxVal);

  for (let i = 0; i < data.length; i++) {
    const [decade, count] = data[i];
    const x = padL + i * (barW + 1);
    const logH = count > 0 ? (Math.log10(count) / logMax) * chartH : 0;
    const y = padT + chartH - logH;

    const color = decade < 1700 ? '#b87333' : (decade < 1900 ? '#8b6914' : '#4a6fa5');
    svg += `<rect x="${x}" y="${y}" width="${barW}" height="${logH}" fill="${color}" opacity="0.8"/>\n`;

    // Decade labels (every 50 years)
    if (decade % 50 === 0) {
      svg += `<text x="${x + barW/2}" y="${padT + chartH + 18}" text-anchor="middle" font-size="10" fill="#666">${decade}</text>\n`;
    }
  }

  // Y-axis labels (log scale)
  for (const val of [10, 100, 1000, 10000]) {
    const y = padT + chartH - (Math.log10(val) / logMax) * chartH;
    svg += `<line x1="${padL - 5}" y1="${y}" x2="${padL + chartW}" y2="${y}" stroke="#ddd" stroke-width="0.5"/>\n`;
    svg += `<text x="${padL - 10}" y="${y + 4}" text-anchor="end" font-size="10" fill="#666">${val.toLocaleString()}</text>\n`;
  }

  // Axis lines
  svg += `<line x1="${padL}" y1="${padT}" x2="${padL}" y2="${padT + chartH}" stroke="#999" stroke-width="1"/>\n`;
  svg += `<line x1="${padL}" y1="${padT + chartH}" x2="${padL + chartW}" y2="${padT + chartH}" stroke="#999" stroke-width="1"/>\n`;

  // Annotations
  svg += `<text x="${padL + 20}" y="${padT + 20}" font-size="10" fill="#b87333">Pre-1700</text>\n`;
  svg += `<text x="${padL + chartW * 0.45}" y="${padT + 20}" font-size="10" fill="#8b6914">18th-19th c.</text>\n`;
  svg += `<text x="${padL + chartW * 0.8}" y="${padT + 20}" font-size="10" fill="#4a6fa5">20th-21st c.</text>\n`;

  svg += `<text x="${padL - 5}" y="${padT + chartH + 45}" font-size="10" fill="#666">Note: log scale. Translation activity exploded after 1950.</text>\n`;

  svg += '</svg>';
  writeFileSync(`${OUT}/translation-timeline.svg`, svg);
  console.log('Created translation-timeline.svg');
}

// ── 4. Language comparison ─────────────────────────────────────────────

function makeLanguageChart() {
  const data = [
    { lang: 'Latin', ustc: 362263, translated: 5000, color: '#b87333' },
    { lang: 'German', ustc: 124394, translated: 10500, color: '#8b6914' },
    { lang: 'Italian', ustc: 70284, translated: 4500, color: '#2d6a4f' },
    { lang: 'French', ustc: 65266, translated: 13000, color: '#4a6fa5' },
    { lang: 'Spanish', ustc: 37484, translated: 4500, color: '#9c4dcc' },
    { lang: 'Dutch', ustc: 29649, translated: 2200, color: '#d45d00' },
    { lang: 'Portuguese', ustc: 3795, translated: 700, color: '#666' },
  ];

  const svgW = 600, svgH = 380;
  const padL = 90, padR = 100, padT = 50, padB = 30;
  const chartW = svgW - padL - padR;
  const rowH = 40, gap = 8;
  const maxVal = Math.max(...data.map(d => d.ustc));

  let svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${svgW} ${svgH}" font-family="Georgia, serif">\n`;
  svg += `<rect width="${svgW}" height="${svgH}" fill="white"/>\n`;
  svg += `<text x="${svgW/2}" y="28" text-anchor="middle" font-size="16" font-weight="bold" fill="#1a1a1a">Works vs. Translations by Language</text>\n`;

  for (let i = 0; i < data.length; i++) {
    const d = data[i];
    const y = padT + 10 + i * (rowH + gap);
    const barW = (d.ustc / maxVal) * chartW;
    const transW = (d.translated / maxVal) * chartW;
    const pct = (d.translated / d.ustc * 100).toFixed(1);

    // Label
    svg += `<text x="${padL - 8}" y="${y + rowH/2 + 4}" text-anchor="end" font-size="13" fill="#333">${d.lang}</text>\n`;

    // USTC bar (full width, light)
    svg += `<rect x="${padL}" y="${y}" width="${barW}" height="${rowH/2 - 1}" rx="2" fill="${d.color}" opacity="0.2"/>\n`;
    svg += `<text x="${padL + barW + 5}" y="${y + rowH/4 + 3}" font-size="10" fill="#999">${d.ustc.toLocaleString()} works</text>\n`;

    // Translation bar (overlay, solid)
    svg += `<rect x="${padL}" y="${y + rowH/2}" width="${Math.max(transW, 2)}" height="${rowH/2 - 1}" rx="2" fill="${d.color}" opacity="0.8"/>\n`;
    svg += `<text x="${padL + Math.max(transW, 2) + 5}" y="${y + rowH * 3/4 + 3}" font-size="10" fill="${d.color}" font-weight="bold">${d.translated.toLocaleString()} translated (${pct}%)</text>\n`;
  }

  svg += '</svg>';
  writeFileSync(`${OUT}/language-comparison.svg`, svg);
  console.log('Created language-comparison.svg');
}

// ── 5. Author coverage ─────────────────────────────────────────────────

function makeAuthorCoverage() {
  const authors = [
    { name: 'Cicero', works: 3448, translated: 300 },
    { name: 'Erasmus', works: 1945, translated: 120 },
    { name: 'Aristotle', works: 1318, translated: 100 },
    { name: 'Melanchthon', works: 1222, translated: 10 },
    { name: 'Ovid', works: 1075, translated: 120 },
    { name: 'Virgil', works: 836, translated: 70 },
    { name: 'Augustine', works: 763, translated: 150 },
    { name: 'Aquinas', works: 722, translated: 224 },
    { name: 'Horace', works: 633, translated: 90 },
    { name: 'Luther', works: 621, translated: 20 },
    { name: 'Seneca', works: 471, translated: 60 },
    { name: 'Lipsius', works: 427, translated: 3 },
    { name: 'Galen', works: 416, translated: 5 },
  ];

  const svgW = 550, svgH = 440;
  const padL = 100, padR = 40, padT = 50, padB = 30;
  const chartW = svgW - padL - padR;
  const rowH = 24, gap = 4;
  const maxWorks = Math.max(...authors.map(a => a.works));

  let svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${svgW} ${svgH}" font-family="Georgia, serif">\n`;
  svg += `<rect width="${svgW}" height="${svgH}" fill="white"/>\n`;
  svg += `<text x="${svgW/2}" y="24" text-anchor="middle" font-size="16" font-weight="bold" fill="#1a1a1a">Even the Famous Authors Are Barely Translated</text>\n`;
  svg += `<text x="${svgW/2}" y="42" text-anchor="middle" font-size="11" fill="#666">USTC works (light) vs. known English translations (dark)</text>\n`;

  for (let i = 0; i < authors.length; i++) {
    const a = authors[i];
    const y = padT + 10 + i * (rowH + gap);
    const fullW = (a.works / maxWorks) * chartW;
    const transW = (a.translated / maxWorks) * chartW;
    const pct = (a.translated / a.works * 100).toFixed(0);

    svg += `<text x="${padL - 8}" y="${y + rowH/2 + 4}" text-anchor="end" font-size="12" fill="#333">${a.name}</text>\n`;

    // Full works bar
    svg += `<rect x="${padL}" y="${y}" width="${fullW}" height="${rowH}" rx="2" fill="#e8e4df"/>\n`;

    // Translated bar (overlay)
    svg += `<rect x="${padL}" y="${y}" width="${Math.max(transW, 2)}" height="${rowH}" rx="2" fill="#b87333"/>\n`;

    // Percentage label
    svg += `<text x="${padL + fullW + 5}" y="${y + rowH/2 + 4}" font-size="10" fill="#666">${pct}%</text>\n`;
  }

  svg += '</svg>';
  writeFileSync(`${OUT}/author-coverage.svg`, svg);
  console.log('Created author-coverage.svg');
}

// ── 6. Accessibility spectrum ──────────────────────────────────────────

function makeAccessibilitySpectrum() {
  const svgW = 500, svgH = 180;
  const padL = 30, padR = 30, padT = 50, barH = 50;
  const chartW = svgW - padL - padR;

  const segments = [
    { label: 'Complete translation', pct: 35.3, color: '#2d6a4f' },
    { label: 'Partial only', pct: 18.2, color: '#b87333' },
    { label: 'Never translated', pct: 42.4, color: '#8b4513' },
    { label: 'Unclear', pct: 4.1, color: '#ccc' },
  ];

  let svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${svgW} ${svgH}" font-family="Georgia, serif">\n`;
  svg += `<rect width="${svgW}" height="${svgH}" fill="white"/>\n`;
  svg += `<text x="${svgW/2}" y="24" text-anchor="middle" font-size="16" font-weight="bold" fill="#1a1a1a">The Spectrum of Accessibility</text>\n`;
  svg += `<text x="${svgW/2}" y="42" text-anchor="middle" font-size="11" fill="#666">Source Library's 4,083 verified books</text>\n`;

  let xOffset = padL;
  for (const seg of segments) {
    const w = (seg.pct / 100) * chartW;
    svg += `<rect x="${xOffset}" y="${padT}" width="${w}" height="${barH}" fill="${seg.color}"/>\n`;

    if (w > 40) {
      svg += `<text x="${xOffset + w/2}" y="${padT + barH/2 - 4}" text-anchor="middle" font-size="14" font-weight="bold" fill="white">${seg.pct}%</text>\n`;
      svg += `<text x="${xOffset + w/2}" y="${padT + barH/2 + 12}" text-anchor="middle" font-size="9" fill="white" opacity="0.9">${seg.label}</text>\n`;
    }

    xOffset += w;
  }

  // Legend below
  let legendX = padL;
  const legendY = padT + barH + 30;
  for (const seg of segments) {
    svg += `<rect x="${legendX}" y="${legendY}" width="12" height="12" fill="${seg.color}" rx="2"/>\n`;
    svg += `<text x="${legendX + 16}" y="${legendY + 10}" font-size="10" fill="#333">${seg.label} (${seg.pct}%)</text>\n`;
    legendX += 130;
  }

  svg += '</svg>';
  writeFileSync(`${OUT}/accessibility-spectrum.svg`, svg);
  console.log('Created accessibility-spectrum.svg');
}

// ── Run all ─────────────────────────────────────────────────────────────

try { mkdirSync(OUT, { recursive: true }); } catch {}

makeFunnel();
makeCatalogOverlap();
makeTimeline();
makeLanguageChart();
makeAuthorCoverage();
makeAccessibilitySpectrum();

console.log('\nAll figures generated in ' + OUT + '/');
