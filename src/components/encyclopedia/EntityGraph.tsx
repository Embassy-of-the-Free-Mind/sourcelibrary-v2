'use client';

import { useRouter } from 'next/navigation';
import { useState, useMemo, useRef, useEffect } from 'react';

interface GraphNode {
  id: string;
  name: string;
  type: 'person' | 'place' | 'concept';
  bookCount: number;
  isCenter: boolean;
}

interface GraphEdge {
  source: string;
  target: string;
  weight: number;
}

const TYPE_COLORS: Record<string, string> = {
  person: 'var(--accent-rust)',
  place: 'var(--accent-sage)',
  concept: 'var(--accent-violet)',
};

const TYPE_LABELS: Record<string, string> = {
  person: 'People',
  place: 'Places',
  concept: 'Concepts',
};

export default function EntityGraph({ nodes, edges }: { nodes: GraphNode[]; edges: GraphEdge[] }) {
  const router = useRouter();
  const containerRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  const [hovered, setHovered] = useState<string | null>(null);
  const HEIGHT = 360;

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    setWidth(el.clientWidth);
    const ro = new ResizeObserver(([entry]) => setWidth(entry.contentRect.width));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const center = nodes.find(n => n.isCenter)!;
  const related = useMemo(() => {
    const order: Record<string, number> = { person: 0, place: 1, concept: 2 };
    return nodes.filter(n => !n.isCenter).sort((a, b) => (order[a.type] ?? 3) - (order[b.type] ?? 3));
  }, [nodes]);

  // Compute radial positions
  const positions = useMemo(() => {
    const map = new Map<string, [number, number]>();
    if (!width) return map;
    const cx = width / 2;
    const cy = HEIGHT / 2;
    const rx = Math.min(width * 0.36, 220);
    const ry = HEIGHT * 0.34;
    map.set(center.id, [cx, cy]);
    related.forEach((node, i) => {
      const angle = (2 * Math.PI * i) / related.length - Math.PI / 2;
      map.set(node.id, [cx + Math.cos(angle) * rx, cy + Math.sin(angle) * ry]);
    });
    return map;
  }, [center, related, width]);

  // Nodes connected to hovered entity
  const hoveredNeighbors = useMemo(() => {
    if (!hovered) return null;
    const s = new Set<string>([hovered]);
    edges.forEach(e => {
      if (e.source === hovered) s.add(e.target);
      if (e.target === hovered) s.add(e.source);
    });
    return s;
  }, [hovered, edges]);

  // Separate center edges from cross-edges
  const centerEdges = useMemo(
    () => edges.filter(e => e.source === center.id || e.target === center.id),
    [edges, center]
  );
  const crossEdges = useMemo(
    () => edges.filter(e => e.source !== center.id && e.target !== center.id),
    [edges, center]
  );

  const maxCenterWeight = Math.max(...centerEdges.map(e => e.weight), 1);

  const nodeRadius = (n: GraphNode) => {
    if (n.isCenter) return 20;
    return Math.max(5, Math.min(13, 3 + Math.log2(n.bookCount + 1) * 2.5));
  };

  // Label positioning based on angle from center
  const labelProps = (node: GraphNode): { x: number; y: number; anchor: 'start' | 'middle' | 'end'; dy: string } => {
    const [nx, ny] = positions.get(node.id) || [0, 0];
    if (node.isCenter) return { x: nx, y: ny + nodeRadius(node) + 14, anchor: 'middle', dy: '0' };
    const cx = width / 2;
    const cy = HEIGHT / 2;
    const angle = Math.atan2(ny - cy, nx - cx);
    const offset = nodeRadius(node) + 8;
    const lx = nx + Math.cos(angle) * offset;
    const ly = ny + Math.sin(angle) * offset;
    const absAngle = Math.abs(angle);
    const anchor: 'start' | 'middle' | 'end' = absAngle < Math.PI / 3 ? 'start' : absAngle > 2 * Math.PI / 3 ? 'end' : 'middle';
    const dy = angle > Math.PI / 6 && angle < 5 * Math.PI / 6 ? '1em' : angle < -Math.PI / 6 && angle > -5 * Math.PI / 6 ? '-0.5em' : '0.35em';
    return { x: lx, y: ly, anchor, dy };
  };

  // Type legend entries (only show types present in the graph)
  const typesPresent = useMemo(() => {
    const types = new Set(nodes.map(n => n.type));
    return ['person', 'place', 'concept'].filter(t => types.has(t as GraphNode['type']));
  }, [nodes]);

  if (!width) {
    return <div ref={containerRef} className="w-full h-[360px]" />;
  }

  const isEdgeHovered = (e: GraphEdge) => hovered && (e.source === hovered || e.target === hovered);

  return (
    <div ref={containerRef} className="w-full">
      <svg width={width} height={HEIGHT} className="select-none">
        {/* Center edges — always visible */}
        {centerEdges.map((edge, i) => {
          const [sx, sy] = positions.get(edge.source) || [0, 0];
          const [tx, ty] = positions.get(edge.target) || [0, 0];
          const otherNode = nodes.find(n => n.id === (edge.source === center.id ? edge.target : edge.source));
          const dim = hovered && !isEdgeHovered(edge);
          return (
            <line
              key={`ce-${i}`}
              x1={sx} y1={sy} x2={tx} y2={ty}
              stroke={TYPE_COLORS[otherNode?.type || 'person']}
              strokeWidth={1 + (edge.weight / maxCenterWeight) * 2}
              opacity={dim ? 0.06 : 0.2 + (edge.weight / maxCenterWeight) * 0.3}
              style={{ transition: 'opacity 150ms' }}
            />
          );
        })}

        {/* Cross-edges — visible only when their node is hovered */}
        {hovered && crossEdges.map((edge, i) => {
          if (!isEdgeHovered(edge)) return null;
          const [sx, sy] = positions.get(edge.source) || [0, 0];
          const [tx, ty] = positions.get(edge.target) || [0, 0];
          // Curve through center region for visual distinction
          const cx = width / 2;
          const cy = HEIGHT / 2;
          const mx = (sx + tx) / 2 + (cx - (sx + tx) / 2) * 0.3;
          const my = (sy + ty) / 2 + (cy - (sy + ty) / 2) * 0.3;
          return (
            <path
              key={`xe-${i}`}
              d={`M${sx},${sy} Q${mx},${my} ${tx},${ty}`}
              fill="none"
              stroke="var(--text-muted)"
              strokeWidth={1}
              opacity={0.35}
              strokeDasharray="4,3"
            />
          );
        })}

        {/* Nodes — center rendered last (on top) */}
        {[...related, center].map(node => {
          const [nx, ny] = positions.get(node.id) || [0, 0];
          const r = nodeRadius(node);
          const dim = hoveredNeighbors && !hoveredNeighbors.has(node.id);
          const isHov = hovered === node.id;
          const label = labelProps(node);
          const showLabel = node.isCenter || isHov || (!hovered && related.length <= 8);
          const truncName = node.name.length > 22 ? node.name.slice(0, 20) + '\u2026' : node.name;

          return (
            <g
              key={node.id}
              className={node.isCenter ? '' : 'cursor-pointer'}
              onMouseEnter={() => setHovered(node.id)}
              onMouseLeave={() => setHovered(null)}
              onClick={() => {
                if (!node.isCenter) router.push(`/encyclopedia/${encodeURIComponent(node.name)}`);
              }}
              opacity={dim ? 0.15 : 1}
              style={{ transition: 'opacity 150ms' }}
            >
              <circle
                cx={nx}
                cy={ny}
                r={isHov ? r + 3 : r}
                fill={TYPE_COLORS[node.type]}
                stroke="white"
                strokeWidth={node.isCenter ? 2.5 : 1.5}
                style={{ transition: 'all 150ms' }}
              />
              {showLabel && (
                <text
                  x={label.x}
                  y={label.y}
                  textAnchor={label.anchor}
                  dy={label.dy}
                  fill="var(--text-primary)"
                  fontSize={node.isCenter ? 13 : 10.5}
                  fontWeight={node.isCenter ? 600 : 400}
                  pointerEvents="none"
                  style={{ fontFamily: 'var(--font-sans)' }}
                >
                  {truncName}
                </text>
              )}
            </g>
          );
        })}

        {/* Legend */}
        <g transform={`translate(8, ${HEIGHT - 12})`}>
          {typesPresent.map((type, i) => (
            <g key={type} transform={`translate(${i * 80}, 0)`}>
              <circle cx={6} cy={-4} r={4} fill={TYPE_COLORS[type]} />
              <text x={14} y={0} fontSize={10} fill="var(--text-muted)" style={{ fontFamily: 'var(--font-sans)' }}>
                {TYPE_LABELS[type]}
              </text>
            </g>
          ))}
        </g>
      </svg>
    </div>
  );
}
