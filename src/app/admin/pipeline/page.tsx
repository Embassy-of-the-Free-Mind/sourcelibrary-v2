import type { Metadata } from 'next';
import { getLatestPipelineNextReport, getLaneJobBooks, type PipelineNextReport, type LaneJobBooks } from '@/lib/pipeline-next-report';
import { buildLine, getLineInputs, type Line } from '@/lib/pipeline-line';
import PipelineDashboard from './PipelineHealth';
import { NextStepPanel } from './NextStepPanel';
import { WholeLine } from './WholeLine';
import { PriorityQueue, getPriorityQueueReport, type PriorityQueueReport } from './PriorityQueue';

/**
 * /admin/pipeline — server wrapper (#5480). Reads the daily pipeline-next snapshot (one findOne on
 * ops_reports) and the subscription lanes' recorded job book lists (lane_job_books, #7301), renders the
 * whole line (every stage in order, v3#421) and the "what work is left" panel on the server, then hands
 * them to the client dashboard, which keeps its 30 s poll of /api/admin/realtime and /api/analytics/pipeline.
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
  let laneJobs: LaneJobBooks[] = [];
  try {
    [report, laneJobs] = await Promise.all([getLatestPipelineNextReport(), getLaneJobBooks().catch(() => [])]);
  } catch (e) {
    error = e instanceof Error ? e.message : String(e);
  }
  // The line reads its own documents; a failure there leaves the rest of the page working.
  let line: Line | null = null;
  let lineError: string | null = null;
  try {
    line = buildLine(await getLineInputs(report));
  } catch (e) {
    lineError = e instanceof Error ? e.message : String(e);
  }
  // The priority queue (v3#461): its own document, its own failure.
  let queue: PriorityQueueReport | null = null;
  let queueError: string | null = null;
  try {
    queue = await getPriorityQueueReport();
  } catch (e) {
    queueError = e instanceof Error ? e.message : String(e);
  }
  return (
    <PipelineDashboard
      nextStep={(
        <>
          <WholeLine line={line} error={lineError} />
          <PriorityQueue report={queue} error={queueError} />
          <div id="work-left"><NextStepPanel report={report} error={error} laneJobs={laneJobs} /></div>
        </>
      )}
    />
  );
}
