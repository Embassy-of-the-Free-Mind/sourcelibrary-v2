import { FileText, Languages } from 'lucide-react';

interface BookPagesStatsProps {
  pagesWithOcr: number;
  pagesWithTranslation: number;
  totalPages: number;
  lastOcrDate?: Date | string;
  lastTranslationDate?: Date | string;
}

// Format relative time
function formatRelativeTime(date: Date | string | undefined): string {
  if (!date) return 'Never';
  const d = new Date(date);
  const now = new Date();
  const diffMs = now.getTime() - d.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffMs / 86400000);

  if (diffMins < 1) return 'Just now';
  if (diffMins < 60) return `${diffMins}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  if (diffDays < 7) return `${diffDays}d ago`;
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

export default function BookPagesStats({
  pagesWithOcr,
  pagesWithTranslation,
  totalPages,
  lastOcrDate,
  lastTranslationDate
}: BookPagesStatsProps) {
  return (
    <div className="flex flex-wrap items-center gap-6">
      {/* OCR stat */}
      <div className="flex items-center gap-3">
        <div className="w-10 h-10 rounded-lg flex items-center justify-center" style={{ backgroundColor: '#eff6ff' }}>
          <FileText className="w-5 h-5" style={{ color: '#3b82f6' }} />
        </div>
        <div>
          <div className="flex items-baseline gap-1.5">
            <span className="text-xl font-semibold text-stone-900">{pagesWithOcr}</span>
            <span className="text-sm text-stone-400">/ {totalPages}</span>
          </div>
          <div className="text-xs text-stone-500">OCR {lastOcrDate ? `· ${formatRelativeTime(lastOcrDate)}` : ''}</div>
        </div>
      </div>

      {/* Translation stat */}
      <div className="flex items-center gap-3">
        <div className="w-10 h-10 rounded-lg flex items-center justify-center" style={{ backgroundColor: '#f0fdf4' }}>
          <Languages className="w-5 h-5" style={{ color: '#22c55e' }} />
        </div>
        <div>
          <div className="flex items-baseline gap-1.5">
            <span className="text-xl font-semibold text-stone-900">{pagesWithTranslation}</span>
            <span className="text-sm text-stone-400">/ {totalPages}</span>
          </div>
          <div className="text-xs text-stone-500">Translated {lastTranslationDate ? `· ${formatRelativeTime(lastTranslationDate)}` : ''}</div>
        </div>
      </div>
    </div>
  );
}
