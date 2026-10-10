/**
 * The RunPod watchdog's per-pod decision (scripts/maintenance/runpod-pod-watchdog.mjs). Why (#5660,
 * 2026-10-03): judged only by files pulled to Hetzner, it killed an olmOCR pod reading at 1.6 s/page
 * because that pod's driver wrote elsewhere. Idleness now comes from the pod's own GPU first.
 */
import { describe, it, expect } from 'vitest';
// @ts-expect-error — plain .mjs module without type declarations
import { decidePod, gpuReading, deadlineOf } from '../../scripts/maintenance/runpod-pod-watchdog.mjs';

const now = new Date('2026-10-03T12:00:00Z');
const minsAgo = (m: number) => new Date(now.getTime() - m * 60000);
const name = 'sl-5600-olmocr-until-20261003T1500Z';
const busy = { uptimeInSeconds: 7200, gpus: [{ id: 'g0', gpuUtilPercent: 87 }] };
const loadedIdle = { uptimeInSeconds: 7200, gpus: [{ id: 'g0', gpuUtilPercent: 0 }] };
const cpuPod = { uptimeInSeconds: 7200, gpus: [] };

describe('deadlineOf', () => {
  it('reads the UTC deadline in the name', () => {
    expect(deadlineOf(name)?.toISOString()).toBe('2026-10-03T15:00:00.000Z');
    expect(deadlineOf('sl-5600-x')).toBeNull();
  });
});

describe('gpuReading', () => {
  it('is busy at or above the threshold, on any GPU', () => {
    expect(gpuReading(busy).busy).toBe(true);
    expect(gpuReading({ gpus: [{ gpuUtilPercent: 0 }, { gpuUtilPercent: 40 }] }).busy).toBe(true);
    expect(gpuReading(loadedIdle).busy).toBe(false);
  });
  it('is never busy without telemetry or without a GPU', () => {
    expect(gpuReading(null).busy).toBe(false);
    expect(gpuReading(cpuPod).busy).toBe(false);
  });
});

describe('decidePod', () => {
  it('POSITIVE CONTROL: keeps a GPU pod under load with no local output at all', () => {
    const d = decidePod({ now, name, runningSince: minsAgo(120), runtime: busy, lastLocalOutputAt: null });
    expect(d.action).toBe('keep');
    expect(d.lastGpuBusyAt).toEqual(now);
  });
  it('NEGATIVE CONTROL: kills a CPU pod with no GPU work and no output past grace + idle', () => {
    const d = decidePod({ now, name, runningSince: minsAgo(60), runtime: cpuPod, lastLocalOutputAt: null });
    expect(d.action).toBe('kill');
    expect(d.why).toMatch(/^idle — no GPU work or local output/);
  });
  it('kills a loaded-but-unused model (GPU memory is not activity) once GPU work is older than the window', () => {
    expect(decidePod({ now, name, runningSince: minsAgo(300), runtime: loadedIdle, lastGpuBusyAt: minsAgo(45) }).action).toBe('kill');
    expect(decidePod({ now, name, runningSince: minsAgo(300), runtime: loadedIdle, lastGpuBusyAt: minsAgo(15) }).action).toBe('keep');
  });
  it('keeps a pod between GPU bursts when the last busy pass is inside the window', () => {
    const d = decidePod({ now, name, runningSince: minsAgo(300), runtime: loadedIdle, lastGpuBusyAt: minsAgo(10), lastLocalOutputAt: minsAgo(200) });
    expect(d.action).toBe('keep');
    expect(d.lastGpuBusyAt).toEqual(minsAgo(10));
  });
  it('still counts local output as activity (a CPU pod whose driver pulls output)', () => {
    expect(decidePod({ now, name, runningSince: minsAgo(300), runtime: cpuPod, lastLocalOutputAt: minsAgo(5) }).action).toBe('keep');
  });
  it('keeps a pod in start-up grace', () => {
    expect(decidePod({ now, name, runningSince: minsAgo(10), runtime: cpuPod }).action).toBe('keep');
  });
  it('never kills as idle when the telemetry query failed, but still enforces the deadline', () => {
    expect(decidePod({ now, name, runningSince: minsAgo(300), runtime: null, telemetryOk: false }).action).toBe('keep');
    const late = decidePod({ now, name: 'sl-5600-x-until-20261003T1100Z', runningSince: minsAgo(300), runtime: busy, telemetryOk: false });
    expect(late.action).toBe('kill');
    expect(late.why).toMatch(/deadline .* passed 60 min ago/);
  });
  it('the deadline is a hard stop even for a busy pod, and a missing deadline fails closed', () => {
    expect(decidePod({ now, name: 'sl-5600-x-until-20261003T1159Z', runningSince: minsAgo(30), runtime: busy }).action).toBe('kill');
    expect(decidePod({ now, name: 'sl-5600-x', runningSince: minsAgo(1), runtime: busy }).why).toBe('no parseable deadline in the name');
  });
});
