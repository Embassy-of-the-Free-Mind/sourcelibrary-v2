/**
 * The daily meter-gap detector has to be able to FAIL.
 *
 * An alarm nobody has ever seen go off is not known to work, and this one
 * cannot be exercised end to end in CI: it needs a Google credential, Cloud
 * Monitoring, Supabase and Mongo. So the judgement lives in one pure function,
 * `gapVerdict()`, and these tests drive it with the shape of real days.
 *
 * The numbers below are measured, not invented (output tokens, in millions):
 *
 *   2026-09-11   billed 18.18   metered realtime 1.90   <- the 140,013-call
 *                experience-map classifier ran on Hetzner against the TIER3
 *                key and wrote no usage row (#4599). This is the day the
 *                detector exists to catch.
 *   2026-09-06   billed  1.43   metered realtime 1.10
 *   2026-09-07   billed  3.17   metered realtime 2.90
 *   2026-09-08   billed 10.85   metered realtime 10.00  <- ordinary days, where
 *                the residual is the handful of scripts still unlogged.
 *
 * The batch column is carried but never compared:
 * `generate_content_usage_output_token_count` does not count batch generation
 * (measured 2026-09-14 — on 09-09 it reported 5.60M for the whole day while our
 * rows hold 19.29M of batch alone). Summing batch into the metered side would
 * hide a real gap behind tokens the billed side never claimed.
 */
import { describe, it, expect } from 'vitest';
// @ts-expect-error — plain .mjs audit script, imported for its pure helper
import { gapVerdict } from '../../scripts/audit/spend-reconcile.mjs';

const M = (n: number) => n * 1e6;

const quietWindow = {
  billedByDay: { '2026-09-06': M(1.43), '2026-09-07': M(3.17), '2026-09-08': M(10.85) },
  meteredByDay: {
    '2026-09-06': { realtimeOutTok: M(1.10), batchOutTok: M(4.67) },
    '2026-09-07': { realtimeOutTok: M(2.90), batchOutTok: M(3.92) },
    '2026-09-08': { realtimeOutTok: M(10.00), batchOutTok: M(27.35) },
  },
};

const burstWindow = {
  billedByDay: { '2026-09-09': M(5.60), '2026-09-10': M(4.79), '2026-09-11': M(18.18) },
  meteredByDay: {
    '2026-09-09': { realtimeOutTok: M(5.20), batchOutTok: M(19.29) },
    '2026-09-10': { realtimeOutTok: M(4.60), batchOutTok: M(14.40) },
    '2026-09-11': { realtimeOutTok: M(1.90), batchOutTok: M(8.43) },
  },
};

describe('gapVerdict', () => {
  it('FAILS on the day 140,013 unlogged calls ran', () => {
    const v = gapVerdict(burstWindow);
    expect(v.verdict).toBe('gap');
    expect(Math.round(v.gapPct)).toBeGreaterThan(50);
    const day = v.rows.find((r: { day: string }) => r.day === '2026-09-11');
    expect(day.over, 'the detector must name the day, not only the window').toBe(true);
  });

  it('passes a window whose realtime calls were logged', () => {
    expect(gapVerdict(quietWindow).verdict).toBe('ok');
  });

  it('never counts batch tokens as metered — the billed metric cannot see them', () => {
    // Batch dwarfs realtime on these days. If it were summed in, the burst
    // window would "reconcile" and the alarm would never fire again.
    const v = gapVerdict(burstWindow);
    expect(v.meterTok).toBeLessThan(v.batchTok);
    expect(v.verdict).toBe('gap');
  });

  it('reports an empty billed side as UNREADABLE, never as no gap', () => {
    const v = gapVerdict({ billedByDay: {}, meteredByDay: quietWindow.meteredByDay });
    expect(v.verdict).toBe('unreadable');
  });

  it('credits ai_usage-only features, which write no gemini_usage row', () => {
    // The librarian and podcast meter in `ai_usage` alone. Leaving them out
    // invents a gap; adding /api/explain and /api/search/ai-expand — which
    // write BOTH stores — would hide one. The split is drawn at the caller.
    const withLibrarian = gapVerdict({
      billedByDay: { '2026-09-07': M(3.17) },
      meteredByDay: { '2026-09-07': { realtimeOutTok: M(2.70), batchOutTok: 0 } },
      requestByDay: { '2026-09-07': M(0.30) },
    });
    expect(withLibrarian.verdict).toBe('ok');

    const withoutLibrarian = gapVerdict({
      billedByDay: { '2026-09-07': M(3.17) },
      meteredByDay: { '2026-09-07': { realtimeOutTok: M(2.70), batchOutTok: 0 } },
    });
    expect(withoutLibrarian.verdict).toBe('gap');
  });

  it('honours a looser tolerance without changing what it counts', () => {
    const strict = gapVerdict({ ...quietWindow, tolerancePct: 5 });
    const loose = gapVerdict({ ...quietWindow, tolerancePct: 25 });
    expect(strict.verdict).toBe('gap');
    expect(loose.verdict).toBe('ok');
    expect(strict.meterTok).toBe(loose.meterTok);
  });
});
