/**
 * Small amber "AI" chip marking AI-generated content.
 *
 * Shared provenance marker: use it anywhere AI-generated text (descriptions,
 * inferred metadata, summaries) renders next to catalog data, so readers can
 * tell which is which. Pair with a `title` naming the generating model when
 * known. Originally inline in ArtworkInfo.tsx; extracted for the gallery
 * image provenance work (issue #2406).
 */
export default function AiBadge({ title, className }: { title?: string; className?: string }) {
  return (
    <span
      className={`inline-flex items-center px-1 py-px text-[9px] font-medium rounded bg-amber-100 text-amber-700 align-middle ${className || ''}`}
      title={title || 'AI-generated — may require verification'}
    >
      AI
    </span>
  );
}

/** Human-readable model label: "gemini-3-flash-preview" → "Gemini 3 Flash". */
export function formatModelName(model: string): string {
  return model
    .replace(/-preview$/, '')
    .split('-')
    .map((w) => (/^\d/.test(w) ? w : w.charAt(0).toUpperCase() + w.slice(1)))
    .join(' ');
}
