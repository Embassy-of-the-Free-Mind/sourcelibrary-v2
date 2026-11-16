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

/** Runs the real main() with the box stubbed out, and reports which kind of work it chose. */
function chooses(percent: number, hoursLeft: number, digest: string | null = null): string {
  const code = `
import importlib.util, datetime as dt
spec = importlib.util.spec_from_file_location("spare_lane", "scripts/workers/spare-lane.py")
m = importlib.util.module_from_spec(spec)
spec.loader.exec_module(m)
reset = (m.NOW + dt.timedelta(hours=${hoursLeft})).isoformat()
limits = {"weekly_all": {"percent": ${percent}, "resets_at": reset}, "session": {"percent": 0}}
m.STATE = "/nonexistent/state.json"
m.DRY = True
m.this_box_account = lambda: "a@x"
m.account_limits = lambda: ("a@x", limits)
m.lane_jobs = lambda: []
m.box_ready = lambda: "yes"  # the lane asks claude-job.sh where, which a CI runner or a laptop does not have
m.pick_from_needs = lambda tried, area: ({"number": 1, "title": "an issue"}, "needs")
m.pick_issue = lambda tried: {"number": 1, "title": "an issue"}
m.pending_digest = lambda state: ${digest ? JSON.stringify(digest) : 'None'}
m.log = lambda s: print(s.split(" ")[0] + " " + s.split(" ")[1])
m.main()
`;
  const r = spawnSync('python3', ['-c', code], { encoding: 'utf8' });
  expect(r.stderr).toBe('');
  return r.stdout.trim();
}

describe('what the drain runs', () => {
  it('is an Opus QA round in the last 6 hours, though an issue is eligible', () => {
    expect(chooses(91, 5)).toContain('spare-pf-');
  });
  it('is still an issue before then', () => {
    expect(chooses(85, 7)).toBe('start spare-1');
  });
});

describe('the weekly reflection (#8632)', () => {
  const d = '/mnt/x/loop/2099-01-05/digest.md';
  it('runs once a new digest is waiting, in the last 48 hours, before an eligible issue', () => {
    expect(chooses(60, 30, d)).toMatch(/^start spare-reflect-\d{8}$/);
  });
  it('waits outside the last 48 hours and inside the last 12, and gives way to the drain', () => {
    expect(chooses(30, 72, d)).toBe('start spare-1');
    expect(chooses(80, 10, d)).toBe('start spare-1');
    expect(chooses(91, 5, d)).toContain('spare-pf-');
  });
  it('is not started when no digest is waiting', () => {
    expect(chooses(60, 30)).toBe('start spare-1');
  });
});

describe('pending_digest', () => {
  it('names the newest week once, none after it is recorded or for an older week re-finished; never on gex45 or a guest', () => {
    const code = `
import importlib.util, os, tempfile, time
spec = importlib.util.spec_from_file_location("spare_lane", "scripts/workers/spare-lane.py")
m = importlib.util.module_from_spec(spec)
spec.loader.exec_module(m)
root = tempfile.mkdtemp()
for i, day in enumerate(["2099-01-05", "2099-01-12"]):
    os.makedirs(os.path.join(root, day)); p = os.path.join(root, day, "digest.md"); open(p, "w").write("x")
    os.utime(p, (time.time() + i, time.time() + i))
m.LOOP_DIR, m.GUEST, m.GEX45 = root, False, False
newest = m.pending_digest({})
print(newest.endswith("2099-01-12/digest.md"), m.pending_digest({"reflect": {"last_digest": newest}}))
# an older week finished again (fresh mtime) is not a new digest
os.utime(os.path.join(root, "2099-01-05", "digest.md"), (time.time() + 99, time.time() + 99))
print(m.pending_digest({"reflect": {"last_digest": newest}}))
m.GEX45 = True
print(m.pending_digest({}))
`;
    const r = spawnSync('python3', ['-c', code], { encoding: 'utf8' });
    expect(r.stderr).toBe('');
    expect(r.stdout.trim().split('\n')).toEqual(['True None', 'None', 'None']);
  });
});

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

/**
 * The lane asks before it starts (v3 #70). On 2026-11-12 gex45 had 13% of its root disk free: the lane checked only
 * the 1-minute load, called `claude-job.sh start` every 30 minutes, and each refusal paged Derek at high priority.
 * Runs the real main(), not in dry-run, with every command the lane would run recorded instead of run.
 */
function runsWith(where: string, percent = 85, hoursLeft = 7): { log: string; calls: string[][]; limitOff: boolean } {
  const code = `
import importlib.util, json, os, tempfile, datetime as dt
spec = importlib.util.spec_from_file_location("spare_lane", "scripts/workers/spare-lane.py")
m = importlib.util.module_from_spec(spec)
spec.loader.exec_module(m)
reset = (m.NOW + dt.timedelta(hours=${hoursLeft})).isoformat()
limits = {"weekly_all": {"percent": ${percent}, "resets_at": reset}, "session": {"percent": 0}}
d = tempfile.mkdtemp()
m.STATE = os.path.join(d, "state.json")
m.AUDIT_BASE = os.path.join(d, "audit")
m.PF_BASE = os.path.join(d, "pf")
m.DRY = False
os.environ.pop("JOB_IGNORE_LIMIT", None)
m.this_box_account = lambda: "a@x"
m.account_limits = lambda: ("a@x", limits)
m.lane_jobs = lambda: []
m.pick_from_needs = lambda tried, area: ({"number": 1, "title": "an issue"}, "needs")
calls, seen = [], {}
def sh(*cmd, timeout=60):
    calls.append([c for c in cmd][:3])
    if cmd[1:2] == ("where",):
        seen["limit_off"] = os.environ.get("JOB_IGNORE_LIMIT") == "1"
        return ${JSON.stringify(where)}
    return ""
m.sh = sh
logs = []
m.log = logs.append
m.main()
print(json.dumps({"log": " | ".join(logs), "calls": calls, "limitOff": seen.get("limit_off", False)}))
`;
  const r = spawnSync('python3', ['-c', code], { encoding: 'utf8' });
  expect(r.stderr).toBe('');
  return JSON.parse(r.stdout.trim().split('\n').pop()!);
}
const WHERE = 'host=gex45 cores=20 load1=109.56 load5=95.57 mem_free_mb=25152 job_disk_free_gb=74 root_free_gb=56 root_free_pct=13 live_jobs=2 weekly_pct=5 account=a@x';
const verbs = (calls: string[][]) => calls.map((c) => c.slice(1, 3).join(' '));

describe('the spare lane asks claude-job.sh where before it starts a job', () => {
  it('starts when the box says ready=yes, after asking', () => {
    const r = runsWith(`${WHERE} ready=yes pace=-\n`);
    expect(verbs(r.calls)).toEqual(['where', 'issue edit', 'start spare-1']);
    expect(r.log).toContain('start spare-1');
  });
  it('waits when the box says no: no start to be refused and paged, and the issue is not claimed', () => {
    const r = runsWith(`${WHERE} ready=no:root-13pct-free,load-4.78-per-core pace=-\n`);
    expect(verbs(r.calls)).toEqual(['where']);
    expect(r.log).toContain('but this box is not ready for a job (no:root-13pct-free,load-4.78-per-core)');
  });
  it('waits when the wrapper gives no answer', () => {
    const r = runsWith('');
    expect(verbs(r.calls)).toEqual(['where']);
    expect(r.log).toContain('no:where-gave-no-answer');
  });
  it('asks with the weekly limit switched off while it drains, so the drain is not held at 90%', () => {
    const r = runsWith(`${WHERE} ready=yes pace=-\n`, 93, 5);
    expect(r.limitOff).toBe(true);
    expect(verbs(r.calls)[0]).toBe('where');
    expect(verbs(r.calls).some((v) => v.startsWith('start spare-pf-'))).toBe(true);
  });
});
