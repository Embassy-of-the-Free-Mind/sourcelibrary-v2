import { redirect } from 'next/navigation';

// Folded into the Readers section of the /admin dashboard, which reads the same
// system_config.metrics_snapshot (written daily by scripts/analytics/snapshot-metrics.mjs).
// Old links and bookmarks keep working.
export default function MetricsMoved() {
  redirect('/admin#readers');
}
