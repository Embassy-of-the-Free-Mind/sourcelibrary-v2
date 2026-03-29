'use client';

import { useRouter } from 'next/navigation';
import { useMemo, useState, useCallback, useRef } from 'react';
import { treemap, treemapSquarify, hierarchy, type HierarchyRectangularNode } from 'd3-hierarchy';

export interface SubDomain {
  id: string;
  label: string;
  count: number;
}

export interface DomainData {
  id: string;
  label: string;
  count: number;
  groupId: string;
  groupLabel: string;
  subDomains?: SubDomain[];
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

// Lighten a hex color by a factor (0-1)
function lighten(hex: string, factor: number): string {
  const h = hex.replace('#', '');
  const r = Math.min(255, parseInt(h.substring(0, 2), 16) + Math.round((255 - parseInt(h.substring(0, 2), 16)) * factor));
  const g = Math.min(255, parseInt(h.substring(2, 4), 16) + Math.round((255 - parseInt(h.substring(2, 4), 16)) * factor));
  const b = Math.min(255, parseInt(h.substring(4, 6), 16) + Math.round((255 - parseInt(h.substring(4, 6), 16)) * factor));
  return `#${r.toString(16).padStart(2,'0')}${g.toString(16).padStart(2,'0')}${b.toString(16).padStart(2,'0')}`;
}

interface TreeNode {
  name: string;
  groupId?: string;
  domainId?: string;
  subDomainId?: string;
  groupLabel?: string;
  value?: number;
  children?: TreeNode[];
}

interface TooltipState {
  x: number;
  y: number;
  label: string;
  count: number;
  group: string;
  domain?: string;
}

export default function DomainTreemap({ domains, totalBooks }: Props) {
  const router = useRouter();
  const [tooltip, setTooltip] = useState<TooltipState | null>(null);
  const [hovered, setHovered] = useState<string | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const WIDTH = 960;
  const HEIGHT = 560;

  // Build 3-level hierarchy: root → groups → domains → sub-domains
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
        children: items.map(d => {
          // If domain has sub-domains, nest them; otherwise leaf node
          if (d.subDomains && d.subDomains.length > 1) {
            const subTotal = d.subDomains.reduce((s, sd) => s + sd.count, 0);
            const pureCount = Math.max(0, d.count - subTotal);
            const children: TreeNode[] = [];
            if (pureCount > 0) {
              children.push({
                name: d.label,
                domainId: d.id,
                subDomainId: '__pure__',
                groupId: d.groupId,
                groupLabel: d.groupLabel,
                value: pureCount,
              });
            }
            for (const sd of d.subDomains) {
              children.push({
                name: sd.label,
                domainId: d.id,
                subDomainId: sd.id,
                groupId: d.groupId,
                groupLabel: d.groupLabel,
                value: sd.count,
              });
            }
            return {
              name: d.label,
              domainId: d.id,
              groupId: d.groupId,
              groupLabel: d.groupLabel,
              children,
            };
          }
          return {
            name: d.label,
            domainId: d.id,
            groupId: d.groupId,
            groupLabel: d.groupLabel,
            value: d.count,
          };
        }),
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
      .paddingOuter(8)
      .paddingTop(24)
      .paddingInner(2)
      (h);

    return h;
  }, [treeData]);

  const handleMouseMove = useCallback((e: React.MouseEvent, info: TooltipState) => {
    if (!containerRef.current) return;
    const rect = containerRef.current.getBoundingClientRect();
    setTooltip({ ...info, x: e.clientX - rect.left, y: e.clientY - rect.top });
  }, []);

  const handleMouseLeave = useCallback(() => {
    setTooltip(null);
    setHovered(null);
  }, []);

  type RNode = HierarchyRectangularNode<TreeNode>;

  // Render all leaves (deepest cells)
  const leaves = root.leaves() as RNode[];

  return (
    <div ref={containerRef} className="relative w-full">
      <svg
        viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
        className="w-full h-auto rounded-lg"
        style={{ background: '#f5f0e8' }}
        role="img"
        aria-label={`${totalBooks.toLocaleString()} books across ${domains.length} knowledge domains`}
      >
        {/* Level 1: Group backgrounds + headers */}
        {(root.children as RNode[] | undefined)?.map((group) => {
          const gd = group.data;
          const color = GROUP_COLORS[gd.groupId || ''] || '#8a8078';
          const x = group.x0, y = group.y0;
          const w = group.x1 - x, h = group.y1 - y;
          if (w < 1 || h < 1) return null;
          const hdrH = Math.min(22, h);
          return (
            <g key={gd.groupId}>
              <rect x={x} y={y} width={w} height={h} rx={5} fill={color} opacity={0.06} />
              <rect x={x} y={y} width={w} height={hdrH} rx={5} fill={color} opacity={0.15} />
              {hdrH > 5 && <rect x={x} y={y+5} width={w} height={Math.max(0,hdrH-5)} fill={color} opacity={0.15} />}
              {w > 60 && (
                <text x={x+8} y={y+hdrH/2+1} dominantBaseline="central" fill={color}
                  fontSize={10} fontWeight={600} letterSpacing="0.03em" opacity={0.85}
                  fontFamily="var(--font-serif, 'Cormorant Garamond'), serif"
                  style={{ pointerEvents: 'none' }}>
                  {gd.name}
                </text>
              )}
            </g>
          );
        })}

        {/* Level 2: Domain backgrounds + headers (for domains with children) */}
        {(root.children as RNode[] | undefined)?.flatMap(group =>
          (group.children as RNode[] | undefined)?.filter(d => d.children && d.children.length > 0).map(domain => {
            const dd = domain.data;
            const color = GROUP_COLORS[dd.groupId || ''] || '#8a8078';
            const x = domain.x0, y = domain.y0;
            const w = domain.x1 - x, h = domain.y1 - y;
            if (w < 1 || h < 1) return null;
            const hdrH = Math.min(20, h);
            return (
              <g key={`dom-${dd.domainId}`}>
                <rect x={x} y={y} width={w} height={hdrH} rx={3} fill={color} opacity={0.2} />
                {hdrH > 4 && <rect x={x} y={y+3} width={w} height={Math.max(0,hdrH-3)} fill={color} opacity={0.2} />}
                {w > 40 && (
                  <text x={x+6} y={y+hdrH/2+1} dominantBaseline="central" fill={color}
                    fontSize={9} fontWeight={600} opacity={0.9}
                    fontFamily="var(--font-display, 'Playfair Display'), serif"
                    style={{ pointerEvents: 'none' }}>
                    {dd.name} ({(domain.value || 0).toLocaleString()})
                  </text>
                )}
              </g>
            );
          }) || []
        )}

        {/* Level 3: Leaf cells (sub-domains or flat domains) */}
        {leaves.map((leaf) => {
          const d = leaf.data;
          const gid = d.groupId || '';
          const color = GROUP_COLORS[gid] || '#8a8078';
          const x = leaf.x0, y = leaf.y0;
          const w = leaf.x1 - x, h = leaf.y1 - y;
          if (w < 3 || h < 3) return null;

          const isSub = !!d.subDomainId;
          const isPure = d.subDomainId === '__pure__';
          // Sub-domains get lighter shade; pure domain gets full color
          const cellColor = isSub && !isPure ? lighten(color, 0.25) : color;
          const key = `${d.domainId}-${d.subDomainId || 'leaf'}`;
          const isHov = hovered === key;
          const area = w * h;
          const showLabel = area > 800 && w > 30 && h > 16;
          const showCount = area > 3000 && w > 45 && h > 30;
          const fontSize = area > 10000 ? 13 : area > 4000 ? 11 : 9;
          const txtCol = textColor(cellColor);
          const maxChars = Math.floor(w / (fontSize * 0.52));
          const label = d.name.length > maxChars
            ? d.name.slice(0, Math.max(3, maxChars - 1)) + '\u2026'
            : d.name;

          const navTarget = d.subDomainId && d.subDomainId !== '__pure__'
            ? `/topics/domain--${d.subDomainId}`
            : `/topics/domain--${d.domainId}`;

          return (
            <g key={key} className="cursor-pointer"
              onClick={() => router.push(navTarget)}
              onMouseMove={(e) => {
                setHovered(key);
                handleMouseMove(e, {
                  label: d.name,
                  count: leaf.value || 0,
                  group: d.groupLabel || '',
                  domain: isSub ? (leaf.parent?.data.name || '') : undefined,
                  x: 0, y: 0,
                });
              }}
              onMouseLeave={handleMouseLeave}
              role="link" tabIndex={0}
              onKeyDown={(e) => { if (e.key === 'Enter') router.push(navTarget); }}
              aria-label={`${d.name}: ${leaf.value} books`}
            >
              <rect x={x} y={y} width={w} height={h} rx={3}
                fill={cellColor} opacity={isHov ? 1 : 0.75}
                style={{ transition: 'opacity 150ms ease' }} />
              {isHov && (
                <rect x={x+1} y={y+1} width={w-2} height={h-2} rx={2}
                  fill="none" stroke="rgba(255,255,255,0.4)" strokeWidth={1.5} />
              )}
              {showLabel && (
                <text x={x+5} y={y+(showCount ? h*0.36 : h/2)}
                  dominantBaseline="central" fill={txtCol}
                  fontSize={fontSize} fontWeight={isPure || !isSub ? 600 : 500}
                  fontFamily="var(--font-display, 'Playfair Display'), serif"
                  style={{ pointerEvents: 'none', textShadow: '0 1px 2px rgba(0,0,0,0.2)' }}>
                  {isPure ? `${label} (core)` : label}
                </text>
              )}
              {showCount && (
                <text x={x+5} y={y+h*0.36+fontSize+3}
                  dominantBaseline="central" fill={txtCol}
                  fontSize={fontSize-2} opacity={0.6}
                  fontFamily="var(--font-sans, Inter), sans-serif"
                  style={{ pointerEvents: 'none', textShadow: '0 1px 1px rgba(0,0,0,0.1)' }}>
                  {(leaf.value || 0).toLocaleString()}
                </text>
              )}
            </g>
          );
        })}
      </svg>

      {tooltip && (
        <div className="absolute z-50 pointer-events-none px-3 py-2 rounded-md shadow-lg border border-border-light"
          style={{
            left: Math.min(tooltip.x + 14, (containerRef.current?.clientWidth || 960) - 220),
            top: Math.max(0, tooltip.y - 70),
            background: 'rgba(253, 252, 249, 0.96)',
            backdropFilter: 'blur(8px)',
          }}>
          <div className="text-[10px] uppercase tracking-wider"
            style={{ color: GROUP_COLORS[domains.find(d => d.label === (tooltip.domain || tooltip.label))?.groupId || ''] || '#8a8078' }}>
            {tooltip.group}
          </div>
          {tooltip.domain && (
            <div className="text-xs text-secondary">{tooltip.domain}</div>
          )}
          <div className="font-display font-semibold text-primary text-sm leading-tight">
            {tooltip.label}
          </div>
          <div className="text-xs text-secondary mt-0.5">
            {tooltip.count.toLocaleString()} books
          </div>
        </div>
      )}
    </div>
  );
}
