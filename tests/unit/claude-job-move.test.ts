// claude-job.sh move <name> [box] (v3 #70 step 4): the weekly-cap move, by hand.
// The wrapper's functions are sourced, the box mesh (box.sh) is a recording stub, and the job's worktree is a real
// git repo with a bare "origin", so the checkpoint push and the brief the far box receives are the real ones.
import { describe, it, expect } from 'vitest';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const SCRIPT = path.resolve(__dirname, '../../scripts/workers/claude-job.sh');
const git = (cwd: string, ...a: string[]) => {
  const r = spawnSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@x', '-c', 'commit.gpgsign=false', ...a], { cwd, encoding: 'utf8' });
  if (r.status !== 0) throw new Error(`git ${a.join(' ')}: ${r.stderr}`);
  return r.stdout.trim();
};

type Opts = { job?: string; where?: string; pick?: string; startRc?: number; done?: boolean; noBrief?: boolean; dirty?: boolean; noOrigin?: boolean };
function setup(o: Opts = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cjm-'));
  const job = o.job ?? 'j1';
  for (const d of ['jd', 'log', 'wt', 'old']) fs.mkdirSync(path.join(root, d));
  if (!o.noBrief) fs.writeFileSync(path.join(root, 'jd', `${job}.brief.txt`), 'Lands: #70\nPR: no\n\n# the brief\n');
  if (o.done) fs.writeFileSync(path.join(root, 'jd', `${job}.done`), '');
  fs.writeFileSync(path.join(root, 'jd', `${job}.state.md`), 'step 1 done\n');
  // origin + worktree on branch job-<name>
  const origin = path.join(root, 'origin.git');
  spawnSync('git', ['init', '-q', '--bare', '-b', 'main', origin]);
  const wt = path.join(root, 'wt', `job-${job}`);
  spawnSync('git', ['clone', '-q', origin, wt]);
  git(wt, 'checkout', '-q', '-b', 'main');
  fs.writeFileSync(path.join(wt, 'a.txt'), 'a\n');
  git(wt, 'add', '.'); git(wt, 'commit', '-q', '-m', 'base'); git(wt, 'push', '-q', 'origin', 'main');
  git(wt, 'checkout', '-q', '-b', `job-${job}`);
  if (o.dirty) fs.writeFileSync(path.join(wt, 'work.txt'), 'half done\n');
  if (o.noOrigin) git(wt, 'remote', 'set-url', '--push', 'origin', path.join(root, 'nowhere.git'));
  // box.sh stub: records every call; `start` saves the brief it was sent
  const boxsh = path.join(root, 'box.sh');
  fs.writeFileSync(boxsh, `#!/usr/bin/env bash
echo "$*" >> "${root}/calls"
case "$1" in
  self) echo main ;;
  pick) echo "${o.pick ?? ''}" ;;
  *) case "$2" in
       where) echo "${o.where ?? 'host=x cores=16 load5=1 ready=yes pace=-'}" ;;
       start) cat > "${root}/sent-brief"; exit ${o.startRc ?? 0} ;;
     esac ;;
esac
`, { mode: 0o755 });
  return { root, job, wt, origin };
}
function move(t: ReturnType<typeof setup>, ...args: string[]) {
  const pre = [
    `CLAUDE_JOB_LIB=1 source "${SCRIPT}" 2>/dev/null`,
    `JD="${t.root}/jd"; LOGD="${t.root}/log"; WT="${t.root}/wt"; WT_OLD="${t.root}/old"; BOX_SH="${t.root}/box.sh"; HOST=hetzner`,
    `tmux() { echo "tmux $*" >> "${t.root}/calls"; }`,
    `ledger() { echo "ledger $*" >> "${t.root}/calls"; }`,
    `move_by_hand ${args.join(' ')}; echo "rc=$?"`,
  ].join('\n');
  const r = spawnSync('bash', ['-c', pre], { encoding: 'utf8', env: { ...process.env, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@x', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@x' } });
  const calls = fs.existsSync(path.join(t.root, 'calls')) ? fs.readFileSync(path.join(t.root, 'calls'), 'utf8').trim().split('\n') : [];
  const sent = fs.existsSync(path.join(t.root, 'sent-brief')) ? fs.readFileSync(path.join(t.root, 'sent-brief'), 'utf8') : '';
  return { out: r.stdout.trim(), rc: Number((r.stdout.match(/rc=(\d+)\s*$/) || [])[1]), calls, sent,
    stopped: fs.existsSync(path.join(t.root, 'jd', `${t.job}.stopped`)) };
}

describe('claude-job.sh move', () => {
  it('stops the job, pushes its uncommitted work as the checkpoint branch, and starts <name>-mv on the named box', () => {
    const t = setup({ dirty: true });
    const r = move(t, 'j1', 'l7a');
    expect(r.rc).toBe(0);
    expect(r.out).toContain('moved j1 to l7a as j1-mv; it continues from branch job-j1');
    expect(r.stopped).toBe(true);
    expect(r.calls).toEqual(['self', 'l7a where', 'tmux kill-session -t =job-j1', 'l7a start j1-mv', expect.stringMatching(/^ledger record moved j1 /)]);
    // the work is on origin, on the branch the new brief names
    expect(git(t.origin, 'show', 'job-j1:work.txt')).toBe('half done');
    expect(r.sent).toContain('# the brief');
    expect(r.sent).toContain('## Moved from hetzner when it was moved by hand');
    expect(r.sent).toContain('git fetch origin job-j1 && git merge --no-edit FETCH_HEAD');
    expect(r.sent).toContain('step 1 done');
  });

  it('with no box named, takes the one box.sh pick names, excluding this box', () => {
    const t = setup({ pick: 'cloudlayer' });
    const r = move(t, 'j1');
    expect(r.rc).toBe(0);
    expect(r.calls).toContain('pick --exclude main');
    expect(r.calls).toContain('cloudlayer start j1-mv');
    // no commits of its own and no branch on origin: the new job is told to start from main
    expect(r.sent).toContain('git fetch origin main');
  });

  const refusals: [string, Opts, string[], number, string][] = [
    ['there is no such job', { noBrief: true }, ['j1', 'l7a'], 1, 'no job named j1'],
    ['the job is already a -mv job (one move per job)', { job: 'j1-mv' }, ['j1-mv', 'l7a'], 3, 'already moved once'],
    ['the job has finished', { done: true }, ['j1', 'l7a'], 3, 'has finished'],
    ['the target is this box', {}, ['j1', 'main'], 3, 'already on main'],
    ['the target says it is not ready', { where: 'host=x load5=90 ready=no:root-13pct-free,load-4.78-per-core pace=-' }, ['j1', 'gex45'], 3, 'gex45 is not ready for a job (ready=no:root-13pct-free,load-4.78-per-core)'],
    ['the target does not answer', { where: '' }, ['j1', 'l7a'], 3, 'no answer from its where'],
    ['no box is named and no other box is ready', { pick: '' }, ['j1'], 3, 'no other box is ready'],
  ];
  for (const [what, opts, args, rc, says] of refusals) {
    it(`refuses when ${what}, and leaves the job running`, () => {
      const t = setup({ dirty: true, ...opts });
      const r = move(t, ...args);
      expect(r.rc).toBe(rc);
      expect(r.out).toContain('REFUSED');
      expect(r.out).toContain(says);
      expect(r.stopped).toBe(false);
      expect(r.calls.some((c) => c.startsWith('tmux kill-session') || / start /.test(c))).toBe(false);
    });
  }

  it('says NOT MOVED, and starts nothing, when the work cannot be pushed', () => {
    const t = setup({ dirty: true, noOrigin: true });
    const r = move(t, 'j1', 'l7a');
    expect(r.rc).toBe(4);
    expect(r.out).toContain('NOT MOVED');
    expect(r.out).toContain('claude-job.sh resume j1');
    expect(r.calls.some((c) => / start /.test(c))).toBe(false);
  });

  it('says NOT MOVED, with the branch and the resume line, when the far box refuses the start', () => {
    const t = setup({ dirty: true, startRc: 5 });
    const r = move(t, 'j1', 'l7a');
    expect(r.rc).toBe(4);
    expect(r.out).toContain('NOT MOVED: j1 is stopped and its work is on branch job-j1');
    expect(r.calls.some((c) => c.startsWith('ledger record moved'))).toBe(false);
  });

  it('the weekly-cap move is unchanged: move_job with two arguments picks the box and says why', () => {
    const t = setup({ pick: 'l7a' });
    const pre = `CLAUDE_JOB_LIB=1 source "${SCRIPT}" 2>/dev/null; JD="${t.root}/jd"; LOGD="${t.root}/log"; BOX_SH="${t.root}/box.sh"; HOST=hetzner; move_job j1 job-j1`;
    const r = spawnSync('bash', ['-c', pre], { encoding: 'utf8' });
    expect(r.stdout.trim()).toBe('l7a');
    const sent = fs.readFileSync(path.join(t.root, 'sent-brief'), 'utf8');
    expect(sent).toContain('## Moved from hetzner on its weekly usage cap');
    expect(sent).toContain('An earlier run of this brief stopped on the weekly cap. Its work is on branch job-j1');
  });
});
