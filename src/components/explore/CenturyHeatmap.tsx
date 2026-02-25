'use client';

import { useMemo, useState } from 'react';
import { ENTITY_TYPE_LABELS, type EntityType } from '@/lib/style-constants';

interface HeatmapCell {
  century: number;
  type: string;
  count: number;
}

interface CenturyHeatmapProps {
  data: HeatmapCell[];
}

// CSS variable color values for each entity type (hex for SVG fill)
const TYPE_COLORS: Record<string, string> = {
  person: '#9e4a3a',   // --accent-rust
  place: '#8b9a7d',    // --accent-sage
  concept: '#7c5db5',  // --accent-violet
};

function centuryLabel(c: number): string {
  if (c <= 0) return `${Math.abs(c) + 1} BCE`;
  const mod10 = c % 10;
  const mod100 = c % 100;
  const suffix =
    mod100 >= 11 && mod100 <= 13 ? 'th' : mod10 === 1 ? 'st' : mod10 === 2 ? 'nd' : mod10 === 3 ? 'rd' : 'th';
  return `${c}${suffix}`;
}

export default function CenturyHeatmap({ data }: CenturyHeatmapProps) {
  const [hoveredCell, setHoveredCell] = useState<{ century: number; type: string; count: number } | null>(null);

  const { centuries, types, maxCount, cellMap } = useMemo(() => {
    const centurySet = new Set<number>();
    const typeSet = new Set<string>();
    let max = 0;
    const map = new Map<string, number>();

    for (const cell of data) {
      centurySet.add(cell.century);
      typeSet.add(cell.type);
      const key = `${cell.century}:${cell.type}`;
      map.set(key, cell.count);
      if (cell.count > max) max = cell.count;
    }

    // Only show centuries with data, sorted
    const centuries = Array.from(centurySet).sort((a, b) => a - b);
    // Fixed type order
    const types = (['person', 'place', 'concept'] as const).filter(t => typeSet.has(t));

    return { centuries, types, maxCount: max, cellMap: map };
  }, [data]);

  if (centuries.length === 0) return null;

  const cellW = 56;
  const cellH = 40;
  const labelW = 80;
  const headerH = 32;
  const gap = 2;

  const svgW = labelW + centuries.length * (cellW + gap);
  const svgH = headerH + types.length * (cellH + gap);

  return (
    <div className="overflow-x-auto">
      <svg
        width={svgW}
        height={svgH}
        viewBox={`0 0 ${svgW} ${svgH}`}
        className="block"
        role="img"
        aria-label="Century by entity type heatmap"
      >
        {/* Column headers (centuries) */}
        {centuries.map((c, ci) => (
          <text
            key={`h-${c}`}
            x={labelW + ci * (cellW + gap) + cellW / 2}
            y={headerH - 8}
            textAnchor="middle"
            fill="var(--text-muted)"
            fontSize="11"
            fontFamily="var(--font-sans)"
          >
            {centuryLabel(c)}
          </text>
        ))}

        {/* Row labels (types) + cells */}
        {types.map((type, ri) => (
          <g key={type}>
            <text
              x={labelW - 8}
              y={headerH + ri * (cellH + gap) + cellH / 2 + 4}
              textAnchor="end"
              fill="var(--text-secondary)"
              fontSize="13"
              fontFamily="var(--font-sans)"
              fontWeight="500"
            >
              {ENTITY_TYPE_LABELS[type as EntityType] || type}
            </text>

            {centuries.map((c, ci) => {
              const count = cellMap.get(`${c}:${type}`) || 0;
              const opacity = maxCount > 0 ? Math.max(0.06, count / maxCount) : 0;
              const isHovered = hoveredCell?.century === c && hoveredCell?.type === type;

              return (
                <g key={`${c}-${type}`}>
                  <rect
                    x={labelW + ci * (cellW + gap)}
                    y={headerH + ri * (cellH + gap)}
                    width={cellW}
                    height={cellH}
                    rx={4}
                    fill={TYPE_COLORS[type] || '#999'}
                    fillOpacity={opacity}
                    stroke={isHovered ? (TYPE_COLORS[type] || '#999') : 'var(--border-light)'}
                    strokeWidth={isHovered ? 2 : 1}
                    style={{ cursor: count > 0 ? 'pointer' : 'default', transition: 'fill-opacity 0.15s' }}
                    onMouseEnter={() => setHoveredCell({ century: c, type, count })}
                    onMouseLeave={() => setHoveredCell(null)}
                    onClick={() => {
                      if (count > 0) {
                        const yearFrom = (c - 1) * 100;
                        const yearTo = c * 100;
                        window.open(`/search?q=&type=${type}&year_from=${yearFrom}&year_to=${yearTo}`, '_self');
                      }
                    }}
                  />
                  {count > 0 && (
                    <text
                      x={labelW + ci * (cellW + gap) + cellW / 2}
                      y={headerH + ri * (cellH + gap) + cellH / 2 + 4}
                      textAnchor="middle"
                      fill={opacity > 0.5 ? 'white' : 'var(--text-muted)'}
                      fontSize="12"
                      fontFamily="var(--font-sans)"
                      pointerEvents="none"
                    >
                      {count}
                    </text>
                  )}
                </g>
              );
            })}
          </g>
        ))}
      </svg>

      {/* Tooltip */}
      {hoveredCell && hoveredCell.count > 0 && (
        <div
          className="mt-2 text-sm"
          style={{ color: 'var(--text-secondary)' }}
        >
          {centuryLabel(hoveredCell.century)} century — {hoveredCell.count} {hoveredCell.type === 'person' ? 'people' : hoveredCell.type + 's'}
        </div>
      )}
    </div>
  );
}
