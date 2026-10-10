'use client';

import { useState } from 'react';

// PRIOR ART: src/app/quality/ParetoCharts.tsx — the figures were server-only, with exact values on
// native <title> tooltips, which never show on touch and take a second to appear on hover (#6217).
// This is the one interactive layer on top of that server SVG: a hit target per dot, bigger than the
// mark, and a box with the dot's numbers. All text arrives composed; nothing is computed here.

export type Tip = { x: number; y: number; lines: string[] };

export default function ParetoTips({ tips, W, H, f, hit, ink, muted, surface, border }: {
  tips: Tip[]; W: number; H: number; f: number; hit: number;
  ink: string; muted: string; surface: string; border: string;
}) {
  const [on, setOn] = useState<number | null>(null);
  const t = on == null ? null : tips[on];
  let box = null;
  if (t) {
    const fs = f * 0.9, lh = fs * 1.35, pad = fs * 0.6;
    // Width by character count: the box has to be placed before the browser can measure it.
    const w = Math.max(...t.lines.map((l, i) => l.length * fs * (i === 0 ? 0.6 : 0.55))) + pad * 2;
    const h = t.lines.length * lh + pad * 1.4;
    const right = t.x + hit + w <= W;
    const x = right ? t.x + hit : Math.max(0, t.x - hit - w);
    const y = Math.min(Math.max(0, t.y - h / 2), H - h);
    box = (
      <g pointerEvents="none" aria-hidden="true">
        <rect x={x} y={y} width={w} height={h} rx={3} fill={surface} stroke={border} strokeWidth={1} />
        {t.lines.map((l, i) => (
          <text key={i} x={x + pad} y={y + pad + lh * (i + 0.75)} fontSize={fs} fontWeight={i === 0 ? 600 : 400} fill={i === 0 ? ink : muted}>{l}</text>
        ))}
      </g>
    );
  }
  return (
    <g onPointerLeave={() => setOn(null)}>
      {tips.map((p, i) => (
        <circle key={i} cx={p.x} cy={p.y} r={hit} fill="transparent" tabIndex={0} role="img" aria-label={p.lines.join('; ')}
          style={{ cursor: 'pointer', outline: 'none' }}
          onPointerEnter={() => setOn(i)} onFocus={() => setOn(i)} onBlur={() => setOn(o => (o === i ? null : o))}
          onClick={() => setOn(i)} />
      ))}
      {t && <circle cx={t.x} cy={t.y} r={hit * 0.7} fill="none" stroke={muted} strokeWidth={1} pointerEvents="none" />}
      {box}
    </g>
  );
}
