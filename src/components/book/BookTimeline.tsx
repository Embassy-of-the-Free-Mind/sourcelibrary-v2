import type { ReactNode } from 'react';
import PlusToggle from './PlusToggle';

export interface TimelineEvent {
  key: string;
  /** Human date string shown as the eyebrow (e.g. "1543", "c. 6th century CE", "March 2026"). */
  dateText: string;
  /** What happened. */
  label: string;
  /** Optional supporting line (place, version, provider, a DOI link…). */
  detail?: ReactNode;
  /** Optional nested content revealed under the entry (e.g. the full
   *  processing log under "Added to Source Library"). */
  extra?: ReactNode;
}

/**
 * "Book history" — a public, collapsible vertical timeline of the meaningful
 * dates we hold for a book: when it was published, when its English
 * edition(s)/translation(s) appeared, and when it joined Source Library.
 * Rendered as a dropdown card matching the other book-page dropdowns.
 */
export default function BookTimeline({ events, title = 'Book history' }: { events: TimelineEvent[]; title?: string }) {
  if (!events || events.length === 0) return null;

  return (
    <details className="card group sl-collapse">
      <summary className="p-4 md:p-6 cursor-pointer list-none [&::-webkit-details-marker]:hidden flex items-center justify-between gap-3 md:gap-4">
        <h3 className="font-display font-medium text-[17px] md:text-[22px]" style={{ color: '#2b2620' }}>{title}</h3>
        <PlusToggle />
      </summary>
      <div className="px-4 pb-5 md:px-6 md:pb-6">
        <ol className="relative ml-1.5 border-l" style={{ borderColor: '#e0d9ca' }}>
          {events.map((e) => (
            <li key={e.key} className="relative pl-5 pb-5 last:pb-0">
              {/* node */}
              <span
                className="absolute -left-[6px] top-[3px] w-[11px] h-[11px] rounded-full"
                style={{ background: '#a5503d', boxShadow: '0 0 0 3px #fdfcf9' }}
              />
              <div className="uppercase text-[11px] font-medium tracking-[0.08em]" style={{ color: '#a5503d' }}>{e.dateText}</div>
              <div className="text-[14.5px] md:text-[15px] font-medium mt-0.5 leading-snug" style={{ color: '#2b2620' }}>{e.label}</div>
              {e.detail && <div className="text-[13px] mt-0.5 leading-snug" style={{ color: '#7a7365' }}>{e.detail}</div>}
              {e.extra && <div className="mt-3">{e.extra}</div>}
            </li>
          ))}
        </ol>
      </div>
    </details>
  );
}
