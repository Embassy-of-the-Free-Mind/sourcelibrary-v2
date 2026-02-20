import Link from 'next/link';
import type { CuratorSessionListItem } from '@/lib/api-client/types/research';

const TYPE_COLORS: Record<string, string> = {
  acquisition: 'border-l-accent-rust',
  research: 'border-l-accent-sage',
  gap_analysis: 'border-l-accent-violet',
  mixed: 'border-l-accent-gold',
};

const TYPE_LABELS: Record<string, string> = {
  acquisition: 'Acquisition',
  research: 'Research',
  gap_analysis: 'Gap Analysis',
  mixed: 'Mixed',
};

export default function SessionCard({ session }: { session: CuratorSessionListItem }) {
  const date = new Date(session.date);
  const dateStr = date.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });

  const borderColor = TYPE_COLORS[session.session_type] || TYPE_COLORS.mixed;

  return (
    <Link href={`/research/${session.id}`}>
      <div className={`border-l-4 ${borderColor} bg-white rounded-lg border border-border-light p-4 hover:shadow-sm transition-shadow`}>
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0 flex-1">
            <h3 className="font-medium text-primary truncate">{session.title}</h3>
            <div className="flex flex-wrap items-center gap-2 mt-1.5">
              <span className="text-sm text-muted">{dateStr}</span>
              <span className="text-stone-300">|</span>
              <span className="text-sm text-muted">
                {session.message_count} messages
              </span>
              <span className="text-stone-300">|</span>
              <span className="text-sm text-muted">
                {session.word_count.toLocaleString()} words
              </span>
              {session.duration_minutes > 1 && (
                <>
                  <span className="text-stone-300">|</span>
                  <span className="text-sm text-muted">
                    {session.duration_minutes} min
                  </span>
                </>
              )}
            </div>
          </div>

          <div className="flex flex-col items-end gap-1 shrink-0">
            <span className="text-xs px-2 py-0.5 rounded bg-stone-100 text-stone-500">
              {TYPE_LABELS[session.session_type] || session.session_type}
            </span>
            {session.books_imported.length > 0 && (
              <span className="text-xs text-accent-rust">
                {session.books_imported.length} imported
              </span>
            )}
          </div>
        </div>

        {session.themes.length > 0 && (
          <div className="flex flex-wrap gap-1.5 mt-2">
            {session.themes.map(theme => (
              <span
                key={theme}
                className="text-xs px-2 py-0.5 rounded-full bg-stone-50 text-stone-500"
              >
                {theme.replace(/_/g, ' ')}
              </span>
            ))}
          </div>
        )}
      </div>
    </Link>
  );
}
