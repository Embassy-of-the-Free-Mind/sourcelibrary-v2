import type { ReactNode } from 'react';

/**
 * Wraps AI-generated prose so the "Hide AI introductions & summaries" / "Hide
 * reading guide" toggles in EmbedUserMenu can hide it via CSS. The toggles
 * write a cookie; an inline script in embed/layout.tsx reads the cookie on
 * page load and sets data-sl-hide-ai / data-sl-hide-guide on <html>. The
 * rules in globals.css then key off this wrapper's data-view-section.
 *
 * Use this anywhere AI-generated content renders (book summaries, reading
 * guides, AI-assigned category prose, etc.). Forgetting to wrap is the
 * failure mode: the toggle silently misses that surface.
 */
interface AISectionProps {
  // 'ai-summary' and 'reading-guide' hide under both the explicit and the
  // BPH-default "Hide AI" states. 'ai-summary-catalog' is shown under the BPH
  // default and hides only on an explicit opt-out (catalogue works are
  // editorially reviewed) — see VIEW_MODE_INIT_SCRIPT in src/app/layout.tsx
  // and the globals.css rules.
  kind?: 'ai-summary' | 'reading-guide' | 'ai-summary-catalog';
  className?: string;
  children: ReactNode;
}

export function AISection({ kind = 'ai-summary', className, children }: AISectionProps) {
  return (
    <div data-view-section={kind} className={className}>
      {children}
    </div>
  );
}
