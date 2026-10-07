import type { Metadata } from 'next';
import { getLatestPipelineNextReport, type PipelineNextReport } from '@/lib/pipeline-next-report';
import PipelineDashboard from './PipelineHealth';
import { NextStepPanel } from './NextStepPanel';

/**
 * /admin/pipeline — server wrapper (#5480). Reads the daily pipeline-next snapshot (one findOne on
 * ops_reports) and renders the "what work is left" panel on the server, then hands it to the client
 * dashboard, which keeps its 30 s poll of /api/admin/realtime and /api/analytics/pipeline.
 * Gate: the admin layout's requireAdmin().
 */
export const metadata: Metadata = {
  title: 'Pipeline',
  robots: { index: false, follow: false, nocache: true, googleBot: { index: false, follow: false } },
};
export const dynamic = 'force-dynamic';

export default async function PipelinePage() {
  let report: PipelineNextReport | null = null;
  let error: string | null = null;
  try {
    report = await getLatestPipelineNextReport();
  } catch (e) {
    error = e instanceof Error ? e.message : String(e);
  }
  return <PipelineDashboard nextStep={<NextStepPanel report={report} error={error} />} />;
}
