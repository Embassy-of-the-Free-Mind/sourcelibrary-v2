'use client';

import { useState } from 'react';
import FeedbackWidget from './FeedbackWidget';

/**
 * A warm callout section inviting visitors to share feedback.
 * Rendered above the footer on every page via GlobalFooter.
 */
export default function FeedbackCallout() {
  const [dismissed, setDismissed] = useState(() => {
    if (typeof window === 'undefined') return false;
    return localStorage.getItem('sl_feedback_callout_dismissed') === '1';
  });

  if (dismissed) return null;

  return (
    <section
      className="border-t"
      style={{
        background: 'var(--bg-warm, #f5f3f0)',
        borderColor: 'var(--border-light, #e8e5e0)',
      }}
    >
      <div className="max-w-2xl mx-auto px-6 py-12 text-center">
        <p
          className="font-serif text-xl sm:text-2xl leading-relaxed mb-2"
          style={{ color: 'var(--text-primary, #2c2824)' }}
        >
          This library is built in the open.
        </p>
        <p
          className="text-sm sm:text-base mb-6 max-w-lg mx-auto"
          style={{ color: 'var(--text-muted, #8a8480)' }}
        >
          If you spot an error, have a suggestion, or just want to say hello
          &mdash; we&rsquo;d love to hear from you.
        </p>
        <div className="flex items-center justify-center gap-4">
          <FeedbackWidget
            className="inline-flex items-center gap-2 px-5 py-2.5 rounded-lg text-sm font-medium text-white transition-all hover:opacity-90"
            style={{ background: 'var(--text-primary, #2c2824)' }}
          />
          <button
            onClick={() => {
              localStorage.setItem('sl_feedback_callout_dismissed', '1');
              setDismissed(true);
            }}
            className="text-xs transition-colors"
            style={{ color: 'var(--text-faint, #c4c0b8)' }}
          >
            Dismiss
          </button>
        </div>
      </div>
    </section>
  );
}
