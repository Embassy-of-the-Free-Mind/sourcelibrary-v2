/**
 * /platform/admin/ocr-evidence/read-surface/live — the read-surface experiment as it runs (#6740): the design filling
 * in, and a response surface refitted in the browser after every run and every control change.
 *
 * Reads ops_reports `read-surface-6740:live`, which the experiment job replaces after each scored run
 * (scripts/eval/read-surface-6740/publish-live.mjs); the client polls /api/admin/read-surface-live every 30 s.
 * Gated by the protected layout (requireSuperAdmin) and again here, since the doc is read server-side.
 */
import Link from 'next/link';
import { requireSuperAdmin } from '@/lib/auth-helpers';
import { getReadDb } from '@/lib/mongodb';
import { LIVE_REPORT_ID } from './shape';
import LiveSurface from './LiveSurface';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Read settings, live response surface (#6740)' };

export default async function ReadSurfaceLivePage() {
  await requireSuperAdmin();
  const db = await getReadDb();
  const doc = await db.collection<{ _id: string }>('ops_reports').findOne({ _id: LIVE_REPORT_ID });
  return (
    <main className="max-w-6xl mx-auto px-1 sm:px-4 py-6 text-[#e6edf3]">
      <p className="text-sm text-[#8b949e]">
        <Link href="/platform/admin/ocr-evidence" className="underline decoration-[#30363d] hover:text-[#58a6ff]">OCR evidence</Link> /{' '}
        <Link href="/platform/admin/ocr-evidence/read-surface" className="underline decoration-[#30363d] hover:text-[#58a6ff]">read settings</Link> / live
      </p>
      <h1 className="text-2xl font-semibold text-[#f0f6fc] mt-1">The read-settings experiment, live</h1>
      <p className="mt-3 max-w-3xl">
        Four knobs set how the agy first read works: how many pages go into one call, how large the page image is (its long
        edge in pixels), how much the model thinks (low, medium, high), and an optional line added to the prompt. A response
        surface fits a smooth curved model through a few well-placed runs and reads the best point off it, instead of trying
        every combination. This page refits that surface in your browser each time a run lands and each time you change a
        control. The surface only points; the confirmation run on fresh queue pages decides whether anything switches.
      </p>
      <LiveSurface initial={JSON.parse(JSON.stringify(doc))} />
    </main>
  );
}
