// disk-alarm.sh names the owner of every path a page lists (#393): on 2026-11-15 gex45 paged four times about
// "/home/gha/runner-6/_work +2.3 GB" and "/root/jobs/..." with nothing to say whose they were or whether the steward
// handles them. These tests hold the lookup: a job folder with a brief names the job and its Lands: issue, a folder
// a crontab line names is a lane, the CI runner and /tmp name the steward step that cleans them, and a path no rule
// knows is left as it was (no invented owner).
import { describe, it, expect, afterEach } from 'vitest';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const ALARM = path.resolve(__dirname, '../../scripts/workers/disk-alarm.sh');
const tmps: string[] = [];
afterEach(() => tmps.splice(0).forEach((t) => fs.rmSync(t, { recursive: true, force: true })));

const annotate = (text: string) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dao-'));
  tmps.push(root);
  const jobs = path.join(root, 'jobs');
  const cj = path.join(root, 'claude-jobs');
  fs.mkdirSync(jobs);
  fs.mkdirSync(cj);
  fs.writeFileSync(path.join(cj, 'tib-wave3.brief.txt'), 'HEADLESS\nLands: #6740\nPR: no\n');
  fs.writeFileSync(path.join(cj, 'tib-wave3.done'), '');
  fs.writeFileSync(path.join(cj, 'live-job.brief.txt'), 'Lands: #393\n');
  const input = text.replaceAll('$J', jobs);
  const r = spawnSync('bash', ['-c', `source "${ALARM}"; printf '%s\\n' "$IN" | with_owners`], {
    encoding: 'utf8',
    env: {
      ...process.env,
      DISK_ALARM_LIB: '1',
      DISK_ALARM_JOBS_DIR: jobs,
      DISK_ALARM_CLAUDE_JOBS_DIR: cj,
      DISK_ALARM_CRONTAB_TEXT: `10 * * * * node lane.mjs --root=${jobs}/cli-ocr-first\n# 5 * * * * ${jobs}/retired-lane`,
      IN: input,
    },
  });
  expect(r.status).toBe(0);
  return r.stdout.trim().replaceAll(jobs, '$J');
};

describe('disk-alarm.sh owner_of (#393)', () => {
  it('names a job by its brief, with its issue and whether it is done', () => {
    expect(annotate('$J/tib-wave3/P1 +1.0 GB')).toBe('$J/tib-wave3/P1 [job tib-wave3 (#6740, done)] +1.0 GB');
    expect(annotate('$J/live-job +1.0 GB')).toBe('$J/live-job [job live-job (#393, running)] +1.0 GB');
  });

  it('names a lane from a live crontab line, not a commented one', () => {
    expect(annotate('$J/cli-ocr-first/2026-11-15 +0.5 GB')).toContain('[lane cli-ocr-first (crontab)');
    expect(annotate('$J/retired-lane-zzqx +0.5 GB')).toContain('[job folder retired-lane-zzqx, no brief, lane or process names it]');
  });

  it('names the steward step for CI runners and /tmp, and the job behind a transcript folder', () => {
    expect(annotate('over 6.0 h: /home/gha/runner-6/_work +2.3 GB; /tmp/abc123 +1 GB')).toBe(
      'over 6.0 h: /home/gha/runner-6/_work [CI runner-6 (steward step 1f resets its checkout)] +2.3 GB; /tmp/abc123 [/tmp (steward steps 1e, 1h)] +1 GB',
    );
    expect(annotate('/root/.claude/projects/-root-worktrees-job-live-job +3 GB')).toContain('[Claude transcripts of job live-job (#393, running) (steward step 1g)]');
  });

  it('leaves a path no rule knows unannotated', () => {
    expect(annotate('/root/greenroom 21.0 GB: open files')).toBe('/root/greenroom 21.0 GB: open files');
  });
});
