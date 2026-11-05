/**
 * The spare lane's final stage: in an account's last 6 hours, quota left would expire unused, so the lane
 * runs on up to 99%. Accounts used to expire at 91-94%, because the lane stopped at 92% whatever the time.
 * Runs the real decide() under python3.
 */
import { spawnSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';

function decide(percent: number, hoursLeft: number, session = 0): string {
  const code = `
import importlib.util, json, datetime as dt
spec = importlib.util.spec_from_file_location("spare_lane", "scripts/workers/spare-lane.py")
m = importlib.util.module_from_spec(spec)
spec.loader.exec_module(m)
reset = (m.NOW + dt.timedelta(hours=${hoursLeft})).isoformat()
print(m.decide({"weekly_all": {"percent": ${percent}, "resets_at": reset}, "session": {"percent": ${session}}})[0])
`;
  const r = spawnSync('python3', ['-c', code], { encoding: 'utf8' });
  expect(r.stderr).toBe('');
  return r.stdout.trim();
}

describe('spare lane decide()', () => {
  it('starts at 91% with 5 hours left, where it used to sit idle', () => {
    expect(decide(91, 5)).toBe('start');
    expect(decide(95, 5)).toBe('start');
  });
  it('stops at 99%, and on a full session window', () => {
    expect(decide(99, 5)).toBe('stop');
    expect(decide(50, 5, 85)).toBe('stop');
  });
  it('starts nothing in the final hour, when a job would spill into the new week', () => {
    expect(decide(91, 0.5)).toBe('idle');
  });
  it('holds off while the session window is nearly full', () => {
    expect(decide(91, 5, 75)).toBe('idle');
  });
  it('keeps the old limits before the last 6 hours', () => {
    expect(decide(91, 7)).toBe('idle');
    expect(decide(93, 7)).toBe('stop');
    expect(decide(85, 7)).toBe('start');
  });
  it('does not treat a reset already past as a drain', () => {
    expect(decide(95, -1)).toBe('stop');
  });
});
