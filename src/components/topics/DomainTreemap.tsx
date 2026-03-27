'use client';

import { useRouter } from 'next/navigation';
import { useMemo, useState, useCallback, useRef } from 'react';
import { treemap, treemapSquarify, hierarchy, type HierarchyRectangularNode } from 'd3-hierarchy';

interface DomainData {
  id: string;
  label: string;
  count: number;
  groupId: string;
  groupLabel: string;
}

interface Props {
  domains: DomainData[];
  totalBooks: number;
}

const GROUP_COLORS: Record<string, string> = {
  'philosophy-thought':   '#9e4a3a',
  'science-nature':       '#7a8f6e',
  'hidden-arts':          '#7c5db5',
  'esoteric-currents':    '#5a4580',
  'sacred-devotional':    '#c9a86c',
  'world-knowledge':      '#5a8a8a',
  'human-affairs':        '#5a6878',
  'language-art-culture': '#a0622a',
  'reference':            '#8a8078',
  'material-manuscript':  '#6a5040',
};

function textColor(bg: string): string {
  const hex = bg.replace('#', '');
  const r = parseInt(hex.substring(0, 2), 16);
  const g = parseInt(hex.substring(2, 4), 16);
  const b = parseInt(hex.substring(4, 6), 16);
  return (0.299 * r + 0.587 * g + 0.114 * b) / 255 > 0.5 ? '#2a1f14' : '#faf5ef';
}

interface TreeNode {
  name: string;
  groupId?: string;
  domainId?: string;
  groupLabel?: string;
  value?: number;
  children?: TreeNode[];
}

interface TooltipState {
  x: number;
  y: number;
  domain: DomainData;
}

export default function DomainTreemap({ domains, totalBooks }: Props) {
  const router = useRouter();
  const [tooltip, setTooltip] = useState<TooltipState | null>(null);
  const [hovered, setHovered] = useState<string | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const WIDTH = 960;
  const HEIGHT = 520;

  const treeData = useMemo((): TreeNode => {
    const groupMap = new Map<string, DomainData[]>();
    for (const d of domains) {
      const arr = groupMap.get(d.groupId) || [];
      arr.push(d);
      groupMap.set(d.groupId, arr);
    }
    return {
      name: 'root',
      children: Array.from(groupMap.entries()).map(([groupId, items]) => ({
        name: items[0]?.groupLabel || groupId,
        groupId,
        children: items.map(d => ({
          name: d.label,
          domainId: d.id,
          groupId: d.groupId,
          groupLabel: d.groupLabel,
          value: d.count,
        })),
      })),
    };
  }, [domains]);

  const root = useMemo(() => {
    const h = hierarchy<TreeNode>(treeData)
      .sum(d => d.value || 0)
      .sort((a, b) => (b.value || 0) - (a.value || 0));

    treemap<TreeNode>()
      .size([WIDTH, HEIGHT])
      .tile(treemapSquarify)
      .paddingOuter(10)
      .paddingTop(26)
      .paddingInner(3)
      (h);

    return h;
  }, [treeData]);

  const domainMap = useMemo(() => {
    const m = new Map<string, DomainData>();
    for (const d of domains) m.set(d.id, d);
    return m;
  }, [domains]);

  const handleMouseMove = useCallback((e: React.MouseEvent, domain: DomainData) => {
    if (!containerRef.current) return;
    const rect = containerRef.current.getBoundingClientRect();
    setTooltip({ x: e.clientX - rect.left, y: e.clientY - rect.top, domain });
    setHovered(domain.id);
  }, []);

  const handleMouseLeave = useCallback(() => {
    setTooltip(null);
    setHovered(null);
  }, []);

  type RNode = HierarchyRectangularNode<TreeNode>;

  return (
    <div ref={containerRef} className="relative w-full">
      <svg
        viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
        className="w-full h-auto rounded-lg"
        style={{ background: '#f5f0e8' }}
        role="img"
        aria-label={`${totalBooks.toLocaleString()} books across ${domains.length} knowledge domains`}
      >
        {(root.children as RNode[] | undefined)?.map((group) => {
          const gd = group.data;
          const color = GROUP_COLORS[gd.groupId || ''] || '#8a8078';
          const x = group.x0;
          const y = group.y0;
          const w = group.x1 - group.x0;
          const h = group.y1 - group.y0;
          if (w < 1 || h < 1) return null;
          const headerH = Math.min(24, h);

          return (
            <g key={gd.groupId}>
              <rect x={x} y={y} width={w} height={h} rx={6} fill={color} opacity={0.08} />
              <rect x={x} y={y} width={w} height={headerH} rx={6} fill={color} opacity={0.18} />
              {headerH > 6 && (
                <rect x={x} y={y + 6} width={w} height={Math.max(0, headerH - 6)} fill={color} opacity={0.18} />
              )}
              {w > 70 && (
                <text
                  x={x + 10} y={y + headerH / 2 + 1}
                  dominantBaseline="central" fill={color}
                  fontSize={11} fontWeight={600}
                  fontFamily="var(--font-serif, 'Cormorant Garamond'), serif"
                  letterSpacing="0.02em" opacity={0.9}
                  style={{ pointerEvents: 'none' }}
                >
                  {gd.name}
                </text>
              )}
            </g>
          );
        })}

        {(root.leaves() as RNode[]).map((leaf) => {
          const d = leaf.data;
          if (!d.domainId) return null;
          const domain = domainMap.get(d.domainId);
          if (!domain) return null;

          const x = leaf.x0;
          const y = leaf.y0;
          const w = leaf.x1 - leaf.x0;
          const h = leaf.y1 - leaf.y0;
          if (w < 3 || h < 3) return null;

          const color = GROUP_COLORS[domain.groupId] || '#8a8078';
          const isHov = hovered === domain.id;
          const area = w * h;
          const showLabel = area > 1200 && w > 36 && h > 20;
          const showCount = area > 4000 && w > 50 && h > 36;
          const fontSize = area > 12000 ? 14 : area > 6000 ? 12 : 10;
          const txtCol = textColor(color);
          const maxChars = Math.floor(w / (fontSize * 0.55));
          const label = domain.label.length > maxChars
            ? domain.label.slice(0, Math.max(3, maxChars - 1)) + '\u2026'
            : domain.label;

          return (
            <g
              key={domain.id} className="cursor-pointer"
              onClick={() => router.push(`/topics/domain--${domain.id}`)}
              onMouseMove={(e) => handleMouseMove(e, domain)}
              onMouseLeave={handleMouseLeave}
              role="link" tabIndex={0}
              onKeyDown={(e) => { if (e.key === 'Enter') router.push(`/topics/domain--${domain.id}`); }}
              aria-label={`${domain.label}: ${domain.count} books`}
            >
              <rect
                x={x} y={y} width={w} height={h} rx={4}
                fill={color} opacity={isHov ? 1 : 0.78}
                style={{ transition: 'opacity 150ms ease' }}
              />
              {isHov && (
                <rect
                  x={x + 1.5} y={y + 1.5} width={w - 3} height={h - 3}
                  rx={3} fill="none" stroke="rgba(255,255,255,0.45)" strokeWidth={2}
                />
              )}
              {showLabel && (
                <text
                  x={x + 7} y={y + (showCount ? h * 0.38 : h / 2)}
                  dominantBaseline="central" fill={txtCol}
                  fontSize={fontSize} fontWeight={600}
                  fontFamily="var(--font-display, 'Playfair Display'), serif"
                  style={{ pointerEvents: 'none', textShadow: '0 1px 2px rgba(0,0,0,0.25)' }}
                >
                  {label}
                </text>
              )}
              {showCount && (
                <text
                  x={x + 7} y={y + h * 0.38 + fontSize + 5}
                  dominantBaseline="central" fill={txtCol}
                  fontSize={fontSize - 2} opacity={0.6}
                  fontFamily="var(--font-sans, Inter), sans-serif"
                  style={{ pointerEvents: 'none', textShadow: '0 1px 2px rgba(0,0,0,0.15)' }}
                >
                  {domain.count.toLocaleString()}
                </text>
              )}
            </g>
          );
        })}
      </svg>

      {tooltip && (
        <div
          className="absolute z-50 pointer-events-none px-3 py-2 rounded-md shadow-lg border border-border-light"
          style={{
            left: Math.min(tooltip.x + 14, (containerRef.current?.clientWidth || 960) - 220),
            top: Math.max(0, tooltip.y - 64),
            background: 'rgba(253, 252, 249, 0.96)',
            backdropFilter: 'blur(8px)',
          }}
        >
          <div className="text-[10px] uppercase tracking-wider" style={{ color: GROUP_COLORS[tooltip.domain.groupId] }}>
            {tooltip.domain.groupLabel}
          </div>
          <div className="font-display font-semibold text-primary text-sm leading-tight">
            {tooltip.domain.label}
          </div>
          <div className="text-xs text-secondary mt-0.5">
            {tooltip.domain.count.toLocaleString()} books
          </div>
        </div>
      )}
    </div>
  );
}
