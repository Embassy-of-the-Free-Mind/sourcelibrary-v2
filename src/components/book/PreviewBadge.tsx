import { Eye } from 'lucide-react';

/**
 * "Preview" badge for partial scans.
 *
 * A book flagged `preview` is a partial scan of a larger work — the source
 * (e.g. museumsofindia) hosts only a handful of page images where the physical
 * manuscript has many more. The badge is deliberately a quiet note, not an
 * alert: the book is genuine and public, just incomplete.
 *
 * The component renders a neutral, label-only span; the caller supplies the
 * tone via `className`/`style` so it can sit on the dark reader hero or on a
 * card cover. `lang` picks the copy (English / Spanish).
 */
export default function PreviewBadge({ lang = 'en', className = '', title }: {
  lang?: 'en' | 'es';
  className?: string;
  title?: string;
}) {
  const label = lang === 'es' ? 'Vista previa' : 'Preview';
  const tooltip = title ?? (lang === 'es'
    ? 'Este registro muestra solo algunas páginas de una obra más extensa.'
    : 'This record shows only a few pages of a larger work.');
  return (
    <span
      className={`inline-flex items-center gap-1 ${className}`}
      title={tooltip}
    >
      <Eye className="h-3 w-3" aria-hidden />
      {label}
    </span>
  );
}
