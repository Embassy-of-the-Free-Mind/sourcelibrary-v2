'use client';

import { useState, useEffect } from 'react';
import {
  History, ChevronDown, ChevronUp, Loader2,
  Download, Archive, FileText, Languages,
  BookOpen, ListTree, Images, Award, RotateCcw,
} from 'lucide-react';
import { books } from '@/lib/api-client';

interface HistoryEvent {
  type: string;
  timestamp: string;
  description: string;
  pages?: number;
  cost_usd?: number;
  model?: string;
  status?: string;
  provider?: string;
  source_url?: string;
  version?: string;
  doi?: string;
  action?: string;
}

interface HistoryResponse {
  book_id: string;
  book_title: string;
  events: HistoryEvent[];
  summary: {
    total_ai_cost_usd: number;
    first_event: string | null;
    last_event: string | null;
  };
}

interface BookHistoryProps {
  bookId: string;
}

const eventConfig: Record<string, { label: string; icon: typeof FileText; color: string }> = {
  imported:           { label: 'Import',           icon: Download,   color: '#78716c' }, // stone
  archived:           { label: 'Archive',          icon: Archive,    color: '#f59e0b' }, // amber
  ocr:                { label: 'OCR',              icon: FileText,   color: '#3b82f6' }, // blue
  translation:        { label: 'Translation',      icon: Languages,  color: '#22c55e' }, // green
  summary:            { label: 'Summary',          icon: BookOpen,   color: '#a855f7' }, // purple
  index:              { label: 'Index',            icon: ListTree,   color: '#6366f1' }, // indigo
  image_extraction:   { label: 'Image Extraction', icon: Images,     color: '#ec4899' }, // pink
  edition_published:  { label: 'Edition',          icon: Award,      color: '#10b981' }, // emerald
  admin_action:       { label: 'Admin',            icon: RotateCcw,  color: '#ef4444' }, // red
};

function formatDate(dateStr: string): string {
  const d = new Date(dateStr);
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function formatCost(usd: number): string {
  if (usd < 0.01) return `$${usd.toFixed(4)}`;
  return `$${usd.toFixed(2)}`;
}

function monthKey(dateStr: string): string {
  const d = new Date(dateStr);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

function monthLabel(key: string): string {
  const [year, month] = key.split('-');
  const d = new Date(parseInt(year), parseInt(month) - 1);
  return d.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
}

export default function BookHistory({ bookId }: BookHistoryProps) {
  const [expanded, setExpanded] = useState(false);
  const [data, setData] = useState<HistoryResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (expanded && !data) {
      setLoading(true);
      setError(null);
      books.history(bookId)
        .then(setData)
        .catch((err: Error) => setError(err.message))
        .finally(() => setLoading(false));
    }
  }, [expanded, bookId, data]);

  // Group events by month
  const groupedEvents: Array<{ month: string; label: string; events: HistoryEvent[] }> = [];
  if (data?.events) {
    const groups = new Map<string, HistoryEvent[]>();
    for (const event of data.events) {
      const mk = monthKey(event.timestamp);
      if (!groups.has(mk)) groups.set(mk, []);
      groups.get(mk)!.push(event);
    }
    for (const [key, events] of groups) {
      groupedEvents.push({ month: key, label: monthLabel(key), events });
    }
  }

  const eventCount = data?.events?.length || 0;

  return (
    <div className="bg-white rounded-xl border border-stone-200">
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center justify-between p-4 hover:bg-stone-50 transition-colors"
      >
        <div className="flex items-center gap-2 text-stone-700">
          <History className="w-5 h-5" />
          <span className="font-medium">Book History</span>
          {eventCount > 0 && (
            <span className="text-xs text-stone-400">({eventCount} events)</span>
          )}
        </div>
        {expanded ? (
          <ChevronUp className="w-5 h-5 text-stone-400" />
        ) : (
          <ChevronDown className="w-5 h-5 text-stone-400" />
        )}
      </button>

      {expanded && (
        <div className="border-t border-stone-200">
          {loading ? (
            <div className="flex items-center justify-center py-8 text-stone-400">
              <Loader2 className="w-5 h-5 animate-spin mr-2" />
              Loading history...
            </div>
          ) : error ? (
            <div className="text-center py-8 text-red-500 text-sm">
              Failed to load history: {error}
            </div>
          ) : !data || data.events.length === 0 ? (
            <div className="text-center py-8 text-stone-400">
              No history yet
            </div>
          ) : (
            <div className="px-4 pb-4">
              {/* Timeline */}
              {groupedEvents.map((group) => (
                <div key={group.month}>
                  {/* Month header */}
                  <div className="sticky top-0 bg-white pt-3 pb-1 z-10">
                    <span className="text-xs font-medium text-stone-400 uppercase tracking-wider">
                      {group.label}
                    </span>
                  </div>

                  {/* Events in this month */}
                  <div className="relative ml-3 border-l-2 border-stone-100 pl-4 space-y-3 pb-2">
                    {group.events.map((event, idx) => {
                      const config = eventConfig[event.type] || eventConfig.imported;
                      const Icon = config.icon;

                      return (
                        <div key={`${event.type}-${event.timestamp}-${idx}`} className="relative">
                          {/* Timeline dot */}
                          <div
                            className="absolute -left-[23px] top-1 w-3 h-3 rounded-full border-2 border-white"
                            style={{ backgroundColor: config.color }}
                          />

                          <div className="flex items-start gap-3">
                            {/* Icon */}
                            <div
                              className="w-7 h-7 rounded-md flex items-center justify-center flex-shrink-0 mt-0.5"
                              style={{ backgroundColor: `${config.color}12` }}
                            >
                              <Icon className="w-3.5 h-3.5" style={{ color: config.color }} />
                            </div>

                            {/* Content */}
                            <div className="flex-1 min-w-0">
                              <div className="flex items-baseline gap-2 flex-wrap">
                                <span className="text-sm text-stone-800">
                                  {event.description}
                                </span>
                                {event.source_url && (
                                  <a
                                    href={event.source_url}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="text-xs text-blue-500 hover:text-blue-600 truncate max-w-[200px]"
                                  >
                                    source
                                  </a>
                                )}
                              </div>
                              <div className="flex items-center gap-2 text-xs text-stone-400 mt-0.5 flex-wrap">
                                <span>{formatDate(event.timestamp)}</span>
                                {event.model && (
                                  <>
                                    <span className="text-stone-300">·</span>
                                    <span>{event.model}</span>
                                  </>
                                )}
                                {event.cost_usd != null && event.cost_usd > 0 && (
                                  <>
                                    <span className="text-stone-300">·</span>
                                    <span>{formatCost(event.cost_usd)}</span>
                                  </>
                                )}
                                {event.doi && (
                                  <>
                                    <span className="text-stone-300">·</span>
                                    <a
                                      href={`https://doi.org/${event.doi}`}
                                      target="_blank"
                                      rel="noopener noreferrer"
                                      className="text-blue-500 hover:text-blue-600"
                                    >
                                      DOI
                                    </a>
                                  </>
                                )}
                              </div>
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              ))}

              {/* Cost summary footer */}
              {data.summary.total_ai_cost_usd > 0 && (
                <div className="mt-4 pt-3 border-t border-stone-100 flex items-center justify-between text-xs text-stone-400">
                  <span>Total AI cost: {formatCost(data.summary.total_ai_cost_usd)}</span>
                  {data.summary.first_event && data.summary.last_event && (
                    <span>
                      {formatDate(data.summary.first_event)} — {formatDate(data.summary.last_event)}
                    </span>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
