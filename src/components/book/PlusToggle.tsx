/**
 * A "+" toggle icon for <details className="group"> summaries. The vertical bar
 * rotates to lie flat when the parent details is open, so the plus animates into
 * a single horizontal line (a minus).
 */
export default function PlusToggle({ color = '#948d80', className = '' }: { color?: string; className?: string }) {
  return (
    <span className={`relative inline-block w-4 h-4 shrink-0 ${className}`} aria-hidden="true">
      <span className="absolute left-0 right-0 top-1/2 h-[1.6px] -translate-y-1/2 rounded-full" style={{ background: color }} />
      <span className="absolute top-0 bottom-0 left-1/2 w-[1.6px] -translate-x-1/2 rounded-full transition-transform duration-300 group-open:rotate-90" style={{ background: color }} />
    </span>
  );
}
