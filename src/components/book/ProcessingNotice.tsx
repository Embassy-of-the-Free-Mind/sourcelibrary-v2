/**
 * The reader-facing version of JobStatusBanner.
 *
 * A book being processed is worth telling everyone about — a half-filled page
 * grid otherwise reads as a broken book rather than a book still arriving. But
 * page counts, failure counts, Refresh, Cancel and Retry are operator controls,
 * and the endpoint behind them (`/api/jobs/[id]`) is authenticated anyway, so
 * anonymous visitors could never have driven them.
 *
 * So: staff get the full banner, everyone else gets this — the same fact,
 * stated calmly, with nothing to press.
 */
const LABELS: Record<string, string> = {
  ocr: 'The text of this book is being transcribed.',
  translation: 'This book is being translated.',
  image_extraction: 'The illustrations in this book are being prepared.',
  summary: 'A summary of this book is being written.',
};

export default function ProcessingNotice({ type }: { type?: string }) {
  return (
    <div
      className="mb-6 flex items-center gap-3 px-4 py-3 border text-[13.5px]"
      style={{ background: '#f5f0e8', borderColor: '#e8e4dc', color: '#6b6560' }}
      role="status"
    >
      {/* Slow, non-spinning pulse: this runs for hours, and a spinner implies
          something the reader is waiting on. */}
      <span
        aria-hidden
        className="inline-block w-1.5 h-1.5 rounded-full shrink-0"
        style={{ background: '#9e4a3a', animation: 'slPulse 2.4s ease-in-out infinite' }}
      />
      <span>
        {LABELS[type || ''] || 'This book is still being processed.'}{' '}
        <span style={{ color: '#8a8170' }}>Pages will appear here as they are finished.</span>
      </span>
      <style>{`@keyframes slPulse{0%,100%{opacity:.35}50%{opacity:1}}`}</style>
    </div>
  );
}
