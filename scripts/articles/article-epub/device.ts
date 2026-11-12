// Source Library's printer's device for the colophon, drawn once in the manner of a Renaissance press mark:
// the house rings within a laurel wreath, a ribbon with the name, the city in Latin above. Returns SVG text.
export function deviceSvg(ink = '#2b2118', accent = '#9e4a3a'): string {
  const cx = 300, cy = 290, R = 172;
  // One branch (the left), mirrored for the right: a stem on an arc from the foot to near the head, with
  // pointed leaves in pairs along it, each tilted off the stem's direction.
  const leaf = 'M0 0 Q 9 -15 0 -34 Q -9 -15 0 0 Z';
  const parts: string[] = [];
  // Angles from straight down, turning through the left: 0 = foot, 90 = left, 180 = head.
  const pt = (deg: number) => { const t = deg * Math.PI / 180; return [cx - Math.sin(t) * R, cy + Math.cos(t) * R]; };
  // Screen direction of travel up the branch, as an SVG rotation for a leaf drawn pointing up.
  const along = (deg: number) => { const t = deg * Math.PI / 180; return Math.atan2(-Math.sin(t), -Math.cos(t)) * 180 / Math.PI + 90; };
  const start = 14, end = 150;
  const [sx, sy] = pt(start), [ex, ey] = pt(end);
  parts.push(`<path d="M${sx.toFixed(1)} ${sy.toFixed(1)} A ${R} ${R} 0 0 1 ${ex.toFixed(1)} ${ey.toFixed(1)}" fill="none" stroke="${ink}" stroke-width="3"/>`);
  for (let d = start + 8; d <= end - 6; d += 12) {
    const [x, y] = pt(d);
    for (const side of [-1, 1]) {
      parts.push(`<path d="${leaf}" transform="translate(${x.toFixed(1)} ${y.toFixed(1)}) rotate(${(along(d) + side * 40).toFixed(1)})" fill="${ink}"/>`);
    }
  }
  parts.push(`<path d="${leaf}" transform="translate(${ex.toFixed(1)} ${ey.toFixed(1)}) rotate(${along(end).toFixed(1)}) scale(1.1)" fill="${ink}"/>`);
  const branch = parts.join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 600 640" width="600" height="640">
  <text x="${cx}" y="62" text-anchor="middle" font-family="P052, 'Nimbus Roman', serif" font-size="32" letter-spacing="10" fill="${ink}">AMSTELODAMI</text>
  <g fill="none">
    <circle cx="${cx}" cy="${cy}" r="138" stroke="${ink}" stroke-width="3"/>
    <circle cx="${cx}" cy="${cy}" r="130" stroke="${ink}" stroke-width="1"/>
    <circle cx="${cx}" cy="${cy}" r="92" stroke="${accent}" stroke-width="7"/>
    <circle cx="${cx}" cy="${cy}" r="64" stroke="${accent}" stroke-width="7"/>
    <circle cx="${cx}" cy="${cy}" r="36" stroke="${accent}" stroke-width="7"/>
  </g>
  <g>${branch}</g>
  <g transform="translate(${2 * cx} 0) scale(-1 1)">${branch}</g>
  <circle cx="${cx}" cy="${cy + R - 4}" r="7" fill="${ink}"/>
  <path d="M40 540 L90 522 L510 522 L560 540 L510 558 L510 588 L90 588 L90 558 Z" fill="#f6efe1" stroke="${ink}" stroke-width="2.5"/>
  <path d="M40 540 L90 558 M560 540 L510 558" stroke="${ink}" stroke-width="2" fill="none"/>
  <text x="${cx}" y="566" text-anchor="middle" font-family="P052, 'Nimbus Roman', serif" font-size="27" letter-spacing="7" fill="${ink}">SOURCE LIBRARY</text>
  <text x="${cx}" y="626" text-anchor="middle" font-family="P052, 'Nimbus Roman', serif" font-size="24" letter-spacing="6" fill="${ink}">MMXXVI</text>
</svg>`;
}
