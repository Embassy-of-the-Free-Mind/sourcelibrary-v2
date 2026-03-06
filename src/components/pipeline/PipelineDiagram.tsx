'use client';

import { useState, useRef } from 'react';

/* ── Types ── */

export interface StageData {
  id: string;
  name: string;
  color: string;       // CSS color value
  textColor: string;   // text color for badges
  count: number;       // book count in this stage group
  substages?: { status: string; count: number }[];
  icon: string;        // lucide-style label
}

interface TooltipState {
  visible: boolean;
  x: number;
  y: number;
  stage: StageData | null;
}

/* ── Component ── */

export default function PipelineDiagram({ stages }: { stages: StageData[] }) {
  const [tooltip, setTooltip] = useState<TooltipState>({ visible: false, x: 0, y: 0, stage: null });
  const svgRef = useRef<SVGSVGElement>(null);

  const handleMouseEnter = (stage: StageData, e: React.MouseEvent<SVGGElement>) => {
    const svg = svgRef.current;
    if (!svg) return;
    const pt = svg.createSVGPoint();
    pt.x = e.clientX;
    pt.y = e.clientY;
    const svgPt = pt.matrixTransform(svg.getScreenCTM()?.inverse());
    setTooltip({ visible: true, x: svgPt.x, y: svgPt.y - 10, stage });
  };

  const handleMouseLeave = () => {
    setTooltip({ visible: false, x: 0, y: 0, stage: null });
  };

  const handleClick = (stage: StageData) => {
    const el = document.getElementById(`stage-${stage.id}`);
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  /* ── Layout constants ── */
  const nodeW = 88;
  const nodeH = 62;
  const gap = 14;
  const startX = 20;
  const nodeY = 40;
  const totalW = startX + stages.length * (nodeW + gap);

  // Cron ownership bands
  const cronBands = [
    { label: 'post-import-pipeline', subtitle: 'every 10 min', startIdx: 0, endIdx: 6, color: '#e8e4dc' },
    { label: 'enrich-books', subtitle: 'every 10 min', startIdx: 7, endIdx: 8, color: '#ede9fe' },
  ];

  // Infrastructure connections
  const infraItems = [
    { label: 'Lambda Workers', subtitle: 'OCR + Translation + Images', connectTo: [2, 5, 9], color: '#f59e0b' },
    { label: 'Gemini Batch API', subtitle: '50% cheaper OCR', connectTo: [2], color: '#10b981', dashed: true },
    { label: 'FIFO Queue', subtitle: 'Sequential pages', connectTo: [5], color: '#ef4444' },
    { label: 'Writer Lambda', subtitle: '50 concurrency cap', connectTo: [2, 5, 9], color: '#8b5cf6' },
  ];

  return (
    <>
      {/* ── Desktop: horizontal SVG ── */}
      <div className="hidden md:block overflow-x-auto pb-2">
        <svg
          ref={svgRef}
          viewBox={`0 0 ${totalW + 20} 340`}
          preserveAspectRatio="xMidYMin meet"
          className="w-full min-w-[900px]"
          role="img"
          aria-label="Pipeline architecture diagram showing 10 processing stages"
        >
          <defs>
            <marker id="arrowHead" markerWidth="6" markerHeight="4" refX="6" refY="2" orient="auto">
              <path d="M0,0 L6,2 L0,4" fill="#9ca3af" />
            </marker>
            <filter id="nodeShadow" x="-4%" y="-4%" width="108%" height="120%">
              <feDropShadow dx="0" dy="1" stdDeviation="2" floodOpacity="0.08" />
            </filter>
          </defs>

          {/* ── Cron ownership bands ── */}
          {cronBands.map((band) => {
            const x1 = startX + band.startIdx * (nodeW + gap) - 6;
            const x2 = startX + band.endIdx * (nodeW + gap) + nodeW + 6;
            const bandY = nodeY + nodeH + 20;
            return (
              <g key={band.label}>
                <rect
                  x={x1} y={bandY} width={x2 - x1} height={38}
                  rx={6} fill={band.color} opacity={0.5}
                />
                <text x={x1 + 8} y={bandY + 16} fontSize="10" fill="#6b6560" fontWeight="600" fontFamily="monospace">
                  {band.label}
                </text>
                <text x={x1 + 8} y={bandY + 30} fontSize="9" fill="#8a8480">
                  {band.subtitle}
                </text>
              </g>
            );
          })}

          {/* ── Arrows between nodes ── */}
          {stages.slice(0, -1).map((_, i) => {
            const x1 = startX + i * (nodeW + gap) + nodeW;
            const x2 = startX + (i + 1) * (nodeW + gap);
            const cy = nodeY + nodeH / 2;
            return (
              <line
                key={`arrow-${i}`}
                x1={x1 + 2} y1={cy}
                x2={x2 - 2} y2={cy}
                stroke="#9ca3af" strokeWidth={1.5}
                markerEnd="url(#arrowHead)"
              />
            );
          })}

          {/* ── Stage nodes ── */}
          {stages.map((stage, i) => {
            const x = startX + i * (nodeW + gap);
            return (
              <g
                key={stage.id}
                className="cursor-pointer"
                onMouseEnter={(e) => handleMouseEnter(stage, e)}
                onMouseLeave={handleMouseLeave}
                onClick={() => handleClick(stage)}
                role="button"
                tabIndex={0}
                aria-label={`${stage.name}: ${stage.count} books`}
              >
                <rect
                  x={x} y={nodeY} width={nodeW} height={nodeH}
                  rx={8} fill="white" stroke={stage.color} strokeWidth={1.5}
                  filter="url(#nodeShadow)"
                />
                {/* Color bar at top */}
                <rect x={x} y={nodeY} width={nodeW} height={4} rx={2} fill={stage.color} />
                {/* Stage name */}
                <text
                  x={x + nodeW / 2} y={nodeY + 26}
                  textAnchor="middle" fontSize="11" fontWeight="600" fill="#1a1612"
                >
                  {stage.name}
                </text>
                {/* Count badge */}
                <rect
                  x={x + nodeW / 2 - 18} y={nodeY + 34}
                  width={36} height={18} rx={9}
                  fill={stage.color} opacity={0.15}
                />
                <text
                  x={x + nodeW / 2} y={nodeY + 47}
                  textAnchor="middle" fontSize="10" fontWeight="600" fill={stage.color}
                >
                  {stage.count.toLocaleString()}
                </text>
              </g>
            );
          })}

          {/* ── Infrastructure layer ── */}
          <text x={startX} y={165} fontSize="11" fontWeight="700" fill="#6b6560" letterSpacing="0.05em" style={{ textTransform: 'uppercase' }}>
            Infrastructure
          </text>
          {infraItems.map((item, i) => {
            const boxW = 140;
            const boxH = 40;
            const boxX = startX + i * (boxW + 20);
            const boxY = 178;

            return (
              <g key={item.label}>
                <rect
                  x={boxX} y={boxY} width={boxW} height={boxH}
                  rx={6} fill="white" stroke="#d4cfc4" strokeWidth={1}
                  strokeDasharray={item.dashed ? '4 2' : 'none'}
                />
                <text x={boxX + 8} y={boxY + 16} fontSize="10" fontWeight="600" fill="#1a1612">
                  {item.label}
                </text>
                <text x={boxX + 8} y={boxY + 30} fontSize="9" fill="#8a8480">
                  {item.subtitle}
                </text>
                {/* Dashed lines to connected stages */}
                {item.connectTo.map((stageIdx) => {
                  const stageX = startX + stageIdx * (nodeW + gap) + nodeW / 2;
                  const fromX = boxX + boxW / 2;
                  return (
                    <line
                      key={`infra-${item.label}-${stageIdx}`}
                      x1={fromX} y1={boxY}
                      x2={stageX} y2={nodeY + nodeH + 58 + 4}
                      stroke={item.color} strokeWidth={1}
                      strokeDasharray="3 3" opacity={0.4}
                    />
                  );
                })}
              </g>
            );
          })}

          {/* ── Write Queue mini-diagram ── */}
          <g transform="translate(20, 240)">
            <text x={0} y={0} fontSize="11" fontWeight="700" fill="#6b6560" letterSpacing="0.05em">
              Write Queue Pattern
            </text>
            {/* AI Workers box */}
            <rect x={0} y={12} width={100} height={32} rx={5} fill="#fef3c7" stroke="#f59e0b" strokeWidth={1} />
            <text x={50} y={32} textAnchor="middle" fontSize="9" fontWeight="600" fill="#92400e">AI Workers (600+)</text>

            {/* Arrow */}
            <line x1={102} y1={28} x2={138} y2={28} stroke="#9ca3af" strokeWidth={1.2} markerEnd="url(#arrowHead)" />

            {/* SQS box */}
            <rect x={140} y={12} width={90} height={32} rx={5} fill="#fae8ff" stroke="#a855f7" strokeWidth={1} />
            <text x={185} y={32} textAnchor="middle" fontSize="9" fontWeight="600" fill="#7e22ce">SQS Write Queue</text>

            {/* Arrow */}
            <line x1={232} y1={28} x2={268} y2={28} stroke="#9ca3af" strokeWidth={1.2} markerEnd="url(#arrowHead)" />

            {/* Writer Lambda box */}
            <rect x={270} y={12} width={110} height={32} rx={5} fill="#ede9fe" stroke="#8b5cf6" strokeWidth={1} />
            <text x={325} y={32} textAnchor="middle" fontSize="9" fontWeight="600" fill="#5b21b6">Writer Lambda (50)</text>

            {/* Arrow */}
            <line x1={382} y1={28} x2={418} y2={28} stroke="#9ca3af" strokeWidth={1.2} markerEnd="url(#arrowHead)" />

            {/* MongoDB box */}
            <rect x={420} y={12} width={90} height={32} rx={5} fill="#dcfce7" stroke="#22c55e" strokeWidth={1} />
            <text x={465} y={32} textAnchor="middle" fontSize="9" fontWeight="600" fill="#15803d">MongoDB Atlas</text>

            <text x={0} y={62} fontSize="9" fill="#8a8480">
              AI workers never write directly to MongoDB — prevents connection storms during large batch jobs
            </text>
          </g>

          {/* ── Tooltip ── */}
          {tooltip.visible && tooltip.stage && (
            <g>
              <rect
                x={tooltip.x - 80} y={tooltip.y - 80}
                width={160} height={tooltip.stage.substages?.length ? 20 + tooltip.stage.substages.length * 16 : 36}
                rx={6} fill="#1a1612" opacity={0.95}
              />
              <text x={tooltip.x} y={tooltip.y - 62} textAnchor="middle" fontSize="11" fontWeight="700" fill="white">
                {tooltip.stage.name}
              </text>
              {tooltip.stage.substages?.map((sub, i) => (
                <text key={sub.status} x={tooltip.x - 68} y={tooltip.y - 46 + i * 16} fontSize="9" fill="#d1d5db">
                  <tspan fill="#9ca3af">{sub.status}:</tspan>{' '}
                  <tspan fill="white" fontWeight="600">{sub.count}</tspan>
                </text>
              ))}
            </g>
          )}
        </svg>
      </div>

      {/* ── Mobile: vertical flow ── */}
      <div className="md:hidden space-y-1">
        {stages.map((stage, i) => (
          <div key={stage.id} className="flex items-start gap-3">
            <div className="flex flex-col items-center">
              <div
                className="w-9 h-9 rounded-lg flex items-center justify-center text-xs font-bold border-2"
                style={{ borderColor: stage.color, color: stage.color }}
              >
                {stage.count}
              </div>
              {i < stages.length - 1 && (
                <div className="w-px h-5 bg-border-medium mt-1" />
              )}
            </div>
            <div className="pt-1.5">
              <button
                className="text-sm font-semibold text-primary hover:underline"
                onClick={() => handleClick(stage)}
              >
                {stage.name}
              </button>
              {stage.substages && stage.substages.length > 0 && (
                <div className="flex flex-wrap gap-1.5 mt-1">
                  {stage.substages.map((sub) => (
                    <span key={sub.status} className="text-xs text-muted">
                      {sub.status}: {sub.count}
                    </span>
                  ))}
                </div>
              )}
            </div>
          </div>
        ))}
      </div>
    </>
  );
}
