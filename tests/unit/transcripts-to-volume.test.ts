// disk-steward.sh step 1g (#367): idle Claude Code transcript folders move to the job disk and leave a link.
// On 2026-11-15 main's root disk held 17 GB of transcripts, 15.5 GB written in two days, and main refused job starts
// for two days. These tests hold the move to its safety rules: a folder with an open file or a recent write stays
// where it is; a moved folder is byte-identical at its destination and linked from where it was; a second run does
// nothing. Plus disk-alarm.sh's "what grew" line, which names the folder that grew.
import { describe, it, expect, afterEach } from 'vitest';
import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const MOVER = path.resolve(__dirname, '../../scripts/workers/transcripts-to-volume.py');
const ALARM = path.resolve(__dirname, '../../scripts/workers/disk-alarm.sh');

const tmps: string[] = [];
const kids: ChildProcess[] = [];
afterEach(() => {
  kids.splice(0).forEach((k) => k.kill('SIGKILL'));
  tmps.splice(0).forEach((t) => fs.rmSync(t, { recursive: true, force: true }));
});

const walk = (d: string): string[] =>
  fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(d, e.name);
    return e.isDirectory() ? [p, ...walk(p)] : [p];
  });
const age = (dir: string, hours: number) => {
  const t = new Date(Date.now() - hours * 3600e3);
  for (const p of [...walk(dir), dir]) fs.lutimesSync(p, t, t);
};
// A home with a projects/ folder holding three transcript folders, and a separate destination.
const setup = () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ttv-'));
  tmps.push(root);
  const proj = path.join(root, 'home', '.claude', 'projects');
  const dest = path.join(root, 'vol', 'claude-projects');
  const mk = (name: string, hours: number) => {
    const d = path.join(proj, name);
    fs.mkdirSync(path.join(d, 'sess', 'subagents'), { recursive: true });
    fs.writeFileSync(path.join(d, 'a.jsonl'), '{"type":"user"}\n'.repeat(500));
    fs.writeFileSync(path.join(d, 'sess', 'subagents', 'b.jsonl'), Buffer.alloc(70000, 7));
    fs.symlinkSync('a.jsonl', path.join(d, 'link-to-a'));
    age(d, hours);
    return d;
  };
  return { root, proj, dest, mk };
};
const run = (dest: string, proj: string, apply = true) => {
  const r = spawnSync('python3', [MOVER, '--dest', dest, ...(apply ? ['--apply'] : []), '--verbose', proj], { encoding: 'utf8' });
  return { rc: r.status, out: r.stdout + r.stderr };
};
const tree = (d: string) =>
  walk(d).sort().map((p) => {
    const st = fs.lstatSync(p), rel = path.relative(d, p);
    if (st.isSymbolicLink()) return `${rel} -> ${fs.readlinkSync(p)}`;
    if (st.isDirectory()) return `${rel}/`;
    return `${rel} ${st.size} ${st.mtimeMs} ${fs.readFileSync(p).toString('base64')}`;
  });

describe('transcripts-to-volume.py (disk-steward step 1g, #367)', () => {
  it('moves a folder idle 13 h: byte-identical at the destination, linked from where it was', () => {
    const { proj, dest, mk } = setup();
    const src = mk('-mnt-HC-Volume-105839809-jobs-x-w1', 13);
    const before = tree(src);
    const r = run(dest, proj);
    expect(r.rc).toBe(0);
    const dst = path.join(dest, 'claude', path.basename(src));
    expect(fs.lstatSync(src).isSymbolicLink()).toBe(true);
    expect(fs.readlinkSync(src)).toBe(dst);
    expect(tree(dst)).toEqual(before);
    expect(fs.readFileSync(path.join(src, 'a.jsonl'), 'utf8')).toContain('"type":"user"'); // readable through the link
    expect(fs.readdirSync(proj)).toEqual([path.basename(src)]); // no temp link or held original left behind
    expect(fs.readdirSync(path.join(dest, 'claude'))).toEqual([path.basename(src)]); // no .moving- copy left
    expect(r.out).toMatch(/moved 1 folders/);
  });

  it('keeps a folder written 1 h ago', () => {
    const { proj, dest, mk } = setup();
    const src = mk('recent', 1);
    const r = run(dest, proj);
    expect(r.out).toMatch(/keep .*recent .*written 1\.0 h ago/);
    expect(fs.lstatSync(src).isDirectory()).toBe(true);
    expect(fs.existsSync(path.join(dest, 'claude', 'recent'))).toBe(false);
  });

  it('keeps an idle folder in which a process holds a file open', async () => {
    const { proj, dest, mk } = setup();
    const src = mk('held', 30);
    const f = path.join(src, 'a.jsonl');
    const k = spawn('bash', ['-c', `exec 3<"${f}"; echo ready; exec sleep 60`], { stdio: ['ignore', 'pipe', 'ignore'] });
    kids.push(k);
    await new Promise<void>((res) => k.stdout!.once('data', () => res()));
    const r = run(dest, proj);
    expect(r.out).toMatch(/keep .*held .*a file in it is open/);
    expect(fs.lstatSync(src).isDirectory()).toBe(true);
  });

  it('a second run is a no-op, and a dry run changes nothing', () => {
    const { proj, dest, mk } = setup();
    mk('old', 20);
    mk('new', 0.5);
    const dry = run(dest, proj, false);
    expect(dry.out).toMatch(/would move 1 folders/);
    expect(fs.existsSync(dest + '/claude/old')).toBe(false);
    expect(run(dest, proj).out).toMatch(/moved 1 folders/);
    const snap = [tree(proj), tree(dest)];
    const again = run(dest, proj);
    expect(again.rc).toBe(0);
    expect(again.out).toMatch(/moved 0 folders/);
    expect([tree(proj), tree(dest)]).toEqual(snap);
  });

  it('keeps a folder whose destination already exists', () => {
    const { proj, dest, mk } = setup();
    const src = mk('dup', 20);
    fs.mkdirSync(path.join(dest, 'claude', 'dup'), { recursive: true });
    expect(run(dest, proj).out).toMatch(/keep .*dup .*exists/);
    expect(fs.lstatSync(src).isDirectory()).toBe(true);
  });
});

describe('disk-alarm.sh grew_since_last (#367)', () => {
  it('names the deepest folder that grew, not its parents', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dag-'));
    tmps.push(root);
    const m = path.join(root, 'm');
    fs.mkdirSync(path.join(m, 'root', '.claude', 'projects', 'job-a'), { recursive: true });
    fs.mkdirSync(path.join(m, 'other'), { recursive: true });
    const body = [
      `DISK_ALARM_LIB=1 source "${ALARM}"`,
      `epoch=$(date +%s); grew_since_last "${m}" "${root}/snap"`,
      `head -c 230000000 /dev/urandom > "${m}/root/.claude/projects/job-a/t.jsonl"`,
      `epoch=$((epoch + 7200)); grew_since_last "${m}" "${root}/snap"`,
    ].join('\n');
    const out = spawnSync('bash', ['-c', body], { encoding: 'utf8' }).stdout.trim();
    expect(out).toBe(`over 2.0 h: ${m}/root/.claude/projects/job-a +0.2 GB`);
  });
});
