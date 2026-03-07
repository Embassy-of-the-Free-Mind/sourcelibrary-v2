'use client';

import { useState } from 'react';
import { STAGE_DETAILS } from './PipelineStageCard';

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

/* ── Component ── */

export default function PipelineDiagram({ stages }: { stages: StageData[] }) {
  const [expandedStage, setExpandedStage] = useState<string | null>(null);

  // Cron ownership bands
  // post-import-pipeline owns: Import(0)→Translate(5) + Images(8)→Complete(9)
  // enrich-books owns: Enrich(6)→Chapters(7)
  const cronBands = [
    { label: 'post-import-pipeline', subtitle: 'every 10 min', startIdx: 0, endIdx: 5, color: 'bg-[#e8e4dc]/50' },
    { label: 'enrich-books', subtitle: 'every 10 min', startIdx: 6, endIdx: 7, color: 'bg-violet-100/50' },
    { label: 'post-import-pipeline', subtitle: 'priority pass', startIdx: 8, endIdx: 9, color: 'bg-[#e8e4dc]/50' },
  ];

  // Infrastructure items connected to specific stages
  const infraConnections: Record<number, string[]> = {
    2: ['Lambda Workers', 'Batch API', 'Writer Lambda'],
    5: ['Lambda Workers', 'FIFO Queue', 'Writer Lambda'],
    8: ['Lambda Workers', 'Writer Lambda'],
  };

  // Build a lookup from stage id to detail
  const detailMap = Object.fromEntries(STAGE_DETAILS.map(d => [d.id, d]));

  return (
    <div className="space-y-0">
      {/* ── Pipeline stages ── */}
      {stages.map((stage, i) => {
        const band = cronBands.find(b => i >= b.startIdx && i <= b.endIdx);
        const isFirstInBand = band && i === band.startIdx;
        const isLastInBand = band && i === band.endIdx;
        const infra = infraConnections[i];
        const isExpanded = expandedStage === stage.id;
        const detail = detailMap[stage.id];

        return (
          <div key={stage.id}>
            {/* Band label at start of group */}
            {isFirstInBand && band && (
              <div className={`${band.color} rounded-t-lg px-3 pt-2 pb-1 -mb-px`}>
                <span className="text-sm font-semibold text-muted font-mono">{band.label}</span>
                <span className="text-sm text-faint ml-2">{band.subtitle}</span>
              </div>
            )}

            <div className={`
              flex items-stretch
              ${band ? band.color : ''}
              ${isLastInBand ? 'rounded-b-lg pb-2' : ''}
              ${band ? 'px-3' : ''}
            `}>
              {/* Left: connector line */}
              <div className="flex flex-col items-center w-8 shrink-0">
                {i > 0 && (
                  <div className="w-px h-3 bg-stone-300" />
                )}
                <div
                  className="w-3.5 h-3.5 rounded-full shrink-0 border-2 border-white"
                  style={{ backgroundColor: stage.color }}
                />
                {i < stages.length - 1 && (
                  <div className="w-px flex-1 bg-stone-300 min-h-[12px]" />
                )}
              </div>

              {/* Right: stage card */}
              <div className="flex-1 pb-2 pt-0.5 min-w-0">
                <div
                  className={`bg-white rounded-lg border p-4 cursor-pointer transition-colors ${
                    isExpanded ? 'border-stone-300' : 'border-border-light hover:border-stone-300'
                  }`}
                  onClick={() => setExpandedStage(isExpanded ? null : stage.id)}
                >
                  {/* Header row */}
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2 min-w-0">
                      <span className="font-semibold text-base text-primary">{stage.name}</span>
                      {infra && (
                        <div className="hidden sm:flex gap-1">
                          {infra.map(label => (
                            <span key={label} className="text-xs px-1.5 py-0.5 rounded bg-stone-100 text-muted whitespace-nowrap">
                              {label}
                            </span>
                          ))}
                        </div>
                      )}
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <span
                        className="text-sm font-semibold px-2.5 py-0.5 rounded-full"
                        style={{
                          backgroundColor: stage.color + '20',
                          color: stage.textColor,
                        }}
                      >
                        {stage.count.toLocaleString()}
                      </span>
                      <svg
                        className={`w-4 h-4 text-muted transition-transform ${isExpanded ? 'rotate-180' : ''}`}
                        fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}
                      >
                        <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
                      </svg>
                    </div>
                  </div>

                  {/* Expanded: full details */}
                  {isExpanded && (
                    <div className="mt-3 pt-3 border-t border-stone-100 space-y-3">
                      {/* Description */}
                      {detail && (
                        <p className="text-secondary text-[15px] leading-relaxed">
                          {detail.description}
                        </p>
                      )}

                      {/* Metadata grid */}
                      {detail && (
                        <div className="grid sm:grid-cols-2 gap-x-6 gap-y-1.5 text-sm">
                          <div>
                            <span className="text-muted">Backend: </span>
                            <span className="text-secondary">{detail.backend}</span>
                          </div>
                          {detail.model && (
                            <div>
                              <span className="text-muted">Model: </span>
                              <code className="text-accent-rust text-xs">{detail.model}</code>
                            </div>
                          )}
                          {detail.costPerPage && (
                            <div>
                              <span className="text-muted">Cost: </span>
                              <span className="text-secondary">{detail.costPerPage}</span>
                            </div>
                          )}
                        </div>
                      )}

                      {/* Notes */}
                      {detail?.notes && detail.notes.length > 0 && (
                        <ul className="space-y-1 text-sm text-muted">
                          {detail.notes.map((note, j) => (
                            <li key={j} className="flex gap-2">
                              <span className="text-border-medium mt-0.5 shrink-0">&bull;</span>
                              <span>{note}</span>
                            </li>
                          ))}
                        </ul>
                      )}

                      {/* Substage breakdown */}
                      {stage.substages && stage.substages.length > 0 && (
                        <div className="pt-2 border-t border-stone-100">
                          <div className="text-xs font-semibold text-muted uppercase tracking-wide mb-1.5">Sub-statuses</div>
                          <div className="grid grid-cols-2 sm:grid-cols-3 gap-x-4 gap-y-1">
                            {stage.substages.map(sub => (
                              <div key={sub.status} className="flex justify-between text-sm">
                                <span className="text-muted truncate">{sub.status}</span>
                                <span className="text-secondary font-medium ml-2">{sub.count}</span>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </div>
            </div>

            {/* Band closing spacer */}
            {isLastInBand && i < stages.length - 1 && (
              <div className="h-1" />
            )}
          </div>
        );
      })}

      {/* ── Write Queue Pattern ── */}
      <div className="mt-6 pt-4 border-t border-border-light">
        <div className="text-sm font-bold text-muted tracking-wide uppercase mb-3">Write Queue Pattern</div>
        <div className="flex items-center gap-0 overflow-x-auto pb-1">
          {[
            { label: 'AI Workers (600+)', bg: 'bg-amber-50', border: 'border-amber-400', text: 'text-amber-800' },
            { label: 'SQS Write Queue', bg: 'bg-fuchsia-50', border: 'border-purple-400', text: 'text-purple-800' },
            { label: 'Writer Lambda (50)', bg: 'bg-violet-50', border: 'border-violet-500', text: 'text-violet-800' },
            { label: 'MongoDB Atlas', bg: 'bg-green-50', border: 'border-green-500', text: 'text-green-800' },
          ].map((box, j, arr) => (
            <div key={box.label} className="flex items-center shrink-0">
              <div className={`${box.bg} ${box.border} border rounded px-3 py-2 text-sm font-semibold ${box.text} whitespace-nowrap`}>
                {box.label}
              </div>
              {j < arr.length - 1 && (
                <svg className="w-5 h-5 text-stone-400 shrink-0 mx-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
                </svg>
              )}
            </div>
          ))}
        </div>
        <p className="text-sm text-muted mt-2">
          AI workers never write directly to MongoDB — prevents connection storms during large batch jobs
        </p>
      </div>
    </div>
  );
}
