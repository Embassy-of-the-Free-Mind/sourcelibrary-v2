/**
 * Translation-failure triage dashboard.
 *
 * confirmed_first first-translation candidates that are untranslated because
 * they failed / need attention in the pipeline — grouped by root cause, with
 * batch-retry on the genuinely-retryable buckets. See the API route for the
 * bucket taxonomy. Gated by the protected layout (requireSuperAdmin); data +
 * retry go through /api/admin/translation-failures.
 */
import { TranslationFailuresClient } from './TranslationFailuresClient';

export const dynamic = 'force-dynamic';

export default function TranslationFailuresPage() {
  return <TranslationFailuresClient />;
}
