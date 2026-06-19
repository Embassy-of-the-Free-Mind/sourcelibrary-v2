'use client';

import { useSession } from 'next-auth/react';
import FeedbackWidget from '@/components/feedback/FeedbackWidget';

/**
 * Floating "Feedback" button for the BPH catalogue pages. Reuses the global
 * FeedbackWidget (POSTs to /api/feedback, capturing the current page path) but
 * only renders for signed-in users — the same audience that sees the Edit /
 * History toolbar — so the public reading room stays clean while cataloguers
 * (Paul, José) can flag anything from any catalogue page.
 *
 * Positioned bottom-LEFT so it never sits under the edit form's sticky
 * bottom-right Save bar. z below the widget's own modal (9999).
 */
export default function CatalogFeedbackButton() {
  const { data: session } = useSession();
  if (!session?.user) return null;
  return (
    <FeedbackWidget
      label="Feedback"
      className="fixed bottom-4 left-4 z-[60] inline-flex items-center px-3.5 py-2 rounded-full bg-stone-800 text-white text-sm font-medium shadow-lg hover:bg-stone-700 transition-colors"
    />
  );
}
