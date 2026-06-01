/**
 * Curator "Translate Next" dashboard.
 *
 * Disposition queue over every `confirmed_first` first-translation candidate.
 * A curator filters by language / collection / translation status / read count
 * and acts on each book: queue it for translation (a scheduled run consumes
 * `translation_queue.status: 'queued'` in priority order), defer it, or mark it
 * already-translated (a prior English translation exists — flips it out of the
 * first-translation set).
 *
 * Gated by the platform-protected layout (requireSuperAdmin). All data + writes
 * go through /api/admin/translate-queue (editor role).
 */
import { TranslateQueueClient } from './TranslateQueueClient';

export const dynamic = 'force-dynamic';

export default function TranslateQueuePage() {
  return <TranslateQueueClient />;
}
