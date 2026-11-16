// The lane table (infrastructure/lanes.tsv) written into one marked block of a box's crontab (#70).
// scripts/workers/lanes-crontab.mjs will write production crontabs, so each test pins one way it must not hurt:
// lose a hand-kept line, run a lane twice, act on a half-read table, or apply from the installer.
import { describe, it, expect } from 'vitest';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
// @ts-expect-error — scripts-side module, no types
import {
  planCrontab, parseTable, guardOutside, outsideLines, runApply, describePlan, exitCode, boxOfHostname,
  BOXES, HOSTNAME_BOX, BEGIN, END, TABLE_HEADER, TABLE_PATH,
} from '../../scripts/workers/lanes-crontab.mjs';

const ROOT = path.resolve(__dirname, '../..');
const TOOL = path.join(ROOT, 'scripts/workers/lanes-crontab.mjs');
const table = (...rows: string[][]) => [TABLE_HEADER, ...rows.map((r) => r.join('\t'))].join('\n') + '\n';

// A crontab shaped like the live ones: a VAR= line, comments with non-ASCII, blank lines, a paused line, percent escapes.
const READ = 'cd /root/sourcelibrary && flock -n /tmp/read.lock node scripts/batch/cli-ocr-lane.mjs run --out=/root/jobs/first/$(date +\\%F) >> /var/log/sourcelibrary/read.log 2>&1';
const FIX = 'cd /root/sourcelibrary && flock -n /tmp/fix.lock node scripts/batch/cli-ocr-lane.mjs latin-first --apply >> /var/log/sourcelibrary/fix.log 2>&1';
const HAND = [
  'PATH=/root/bin:/usr/bin:/bin',
  '',
  '# ── plumbing ──',
  '17 * * * * flock -n /tmp/sl-auto-pull.lock /root/sourcelibrary/scripts/workers/auto-pull.sh >> /var/log/sourcelibrary/auto-pull.log 2>&1',
  '#PAUSED-2026-11-04 35 * * * * /root/bin/paused-lane.sh',
  '  */10 * * * *   /root/bin/claude-job.sh sweep   ',
  '',
].join('\n') + '\n';
const ROWS = table(['first-read', 'gex45', '50 * * * *', READ], ['latin-fix', 'gex45', '20 */2 * * *', FIX]);
const plan = (crontab: string, t: string, box: string) => planCrontab({ crontab, table: t, box });

describe('lanes-crontab: the core', () => {
  it('an empty table and no block give back the input, byte for byte', () => {
    for (const text of [HAND, '', 'no newline at the end', HAND + '\n\n']) {
      for (const box of BOXES as string[]) {
        const p = plan(text, table(), box);
        expect(p.ok).toBe(true);
        expect(p.changed).toBe(false);
        expect(p.text).toBe(text);
      }
    }
    // The committed table and the committed snapshots of all four boxes' crontabs.
    const committed = fs.readFileSync(path.join(ROOT, TABLE_PATH), 'latin1');
    const snaps: Record<string, string> = { main: 'scripts/workers/crontab.production', gex45: 'infrastructure/gex45-crontab', l7a: 'infrastructure/l7a-crontab', cloudlayer: 'infrastructure/cloudlayer-crontab' };
    for (const [box, f] of Object.entries(snaps)) {
      const text = fs.readFileSync(path.join(ROOT, f), 'latin1');
      const p = plan(text, committed, box);
      expect(p.errors, f).toEqual([]);
      expect(guardOutside(text, p.text), f).toBeNull();
      // A row for this box goes in below every hand line; none of them moves or changes.
      const q = plan(text, table(['probe', box, '@hourly', '/bin/true probe-lane-not-in-any-crontab']), box);
      expect(q.text.startsWith(text), f).toBe(true);
      expect(outsideLines(q.text), f).toEqual(outsideLines(text));
    }
  });

  it('writes only the rows for this box, between the markers, and keeps every outside line', () => {
    const p = plan(HAND, ROWS + ['on-main', 'main', '5 * * * *', '/root/bin/other.sh'].join('\t') + '\n', 'gex45');
    expect(p.ok).toBe(true);
    expect(p.text).toBe(`${HAND}${BEGIN}\n# lane: first-read\n50 * * * * ${READ}\n# lane: latin-fix\n20 */2 * * * ${FIX}\n${END}\n`);
    expect(p.installed.map((r: { lane: string }) => r.lane)).toEqual(['first-read', 'latin-fix']);
    expect(guardOutside(HAND, p.text)).toBeNull();
    // A crontab that does not end in a newline gets one, and nothing else changes above the block.
    expect(plan('0 0 * * * /bin/a', ROWS, 'gex45').text.startsWith(`0 0 * * * /bin/a\n${BEGIN}\n`)).toBe(true);
  });

  it('a block in the middle is rewritten in place; lines above and below it stay where they are', () => {
    const mid = `${HAND}${BEGIN}\n# lane: gone\n1 1 * * * /root/bin/gone.sh\n${END}\n# after the block\n9 9 * * * /root/bin/after.sh\n`;
    const p = plan(mid, ROWS, 'gex45');
    expect(p.text).toBe(`${HAND}${BEGIN}\n# lane: first-read\n50 * * * * ${READ}\n# lane: latin-fix\n20 */2 * * * ${FIX}\n${END}\n# after the block\n9 9 * * * /root/bin/after.sh\n`);
    expect(p.removed).toEqual(['# lane: gone', '1 1 * * * /root/bin/gone.sh']);
    // No rows left for this box: the markers stay (the block keeps its place), the lane lines go.
    expect(plan(mid, table(), 'gex45').text).toBe(`${HAND}${BEGIN}\n${END}\n# after the block\n9 9 * * * /root/bin/after.sh\n`);
  });

  it('a row moved from box A to box B leaves A and appears on B', () => {
    const onA = plan(HAND, ROWS, 'gex45').text;
    const onB = plan(HAND, ROWS, 'main').text;
    expect(onA).toContain(`50 * * * * ${READ}`);
    expect(onB).toBe(HAND);                                              // main has no row yet: untouched
    const moved = table(['first-read', 'main', '50 * * * *', READ], ['latin-fix', 'gex45', '20 */2 * * *', FIX]);
    const a2 = plan(onA, moved, 'gex45'); const b2 = plan(onB, moved, 'main');
    expect(a2.text).not.toContain(READ);
    expect(a2.text).toContain(`20 */2 * * * ${FIX}`);
    expect(a2.removed).toEqual(['# lane: first-read', `50 * * * * ${READ}`]);
    expect(b2.text).toBe(`${HAND}${BEGIN}\n# lane: first-read\n50 * * * * ${READ}\n${END}\n`);
    // `off` parks a lane on no box: it leaves A and reaches no one.
    const parked = table(['first-read', 'off', '50 * * * *', READ]);
    expect(plan(onA, parked, 'gex45').text).not.toContain(READ);
    for (const box of BOXES as string[]) expect(plan(HAND, parked, box).text).toBe(HAND);
  });

  it('a row whose command a hand line already runs is skipped and reported, so the lane cannot run twice', () => {
    const live = `${HAND}55   * * * *   ${READ}\n`;                       // same command by hand: other minute, other spacing
    const p = plan(live, ROWS, 'gex45');
    expect(p.skipped).toEqual([{ lane: 'first-read', line: 8 }]);
    expect(p.installed.map((r: { lane: string }) => r.lane)).toEqual(['latin-fix']);
    expect(p.text.split('\n').filter((l: string) => l.includes('/tmp/read.lock'))).toHaveLength(1);
    expect(describePlan(p, { box: 'gex45' }).join('\n')).toMatch(/SKIPPED lane first-read: already installed by hand \(crontab line 8\): remove the hand line first/);
    expect(exitCode(p)).toBe(1);
    // A hand line that wraps the command counts too; a commented-out one runs nothing and does not.
    expect(plan(`${HAND}55 * * * * export X=1; ${READ}\n`, ROWS, 'gex45').skipped).toHaveLength(1);
    expect(plan(`${HAND}#PAUSED 55 * * * * ${READ}\n`, ROWS, 'gex45').skipped).toHaveLength(0);
    // Once the hand line is removed, the next run installs the lane.
    expect(plan(HAND, ROWS, 'gex45').installed).toHaveLength(2);
    // The same line inside the block is the tool's own: not "by hand".
    expect(plan(plan(HAND, ROWS, 'gex45').text, ROWS, 'gex45').skipped).toEqual([]);
  });

  it('reports a lane the table puts elsewhere while a hand line here still runs it', () => {
    const live = `${HAND}55 * * * * ${READ}\n`;
    const p = plan(live, table(['first-read', 'main', '50 * * * *', READ]), 'gex45');
    expect(p.elsewhere).toEqual([{ lane: 'first-read', box: 'main', line: 8 }]);
    expect(p.text).toBe(live);                                           // nothing this box may write for it
    expect(exitCode(p)).toBe(1);
    expect(describePlan(p, { box: 'gex45' }).join('\n')).toMatch(/ELSEWHERE lane first-read: the table puts it on main, but crontab line 8 here still runs it by hand/);
  });

  it('a malformed table changes nothing and says why', () => {
    const live = plan(HAND, ROWS, 'gex45').text;
    const bad: Record<string, string> = {
      'no header': ['x', 'gex45', '1 * * * *', '/bin/x'].join('\t') + '\n',
      'three cells': table(['x', 'gex45', '1 * * * * /bin/x']),
      'a tab in the command': table(['x', 'gex45', '1 * * * *', '/bin/x', '--flag']),
      'spaces for tabs': `${TABLE_HEADER}\nx gex45 1 * * * * /bin/x\n`,
      'unknown box': table(['x', 'hetzner', '1 * * * *', '/bin/x']),
      'four schedule fields': table(['x', 'gex45', '1 * * *', '/bin/x']),
      'a bad lane name': table(['First Read', 'gex45', '1 * * * *', '/bin/x']),
      'the same lane twice': table(['x', 'gex45', '1 * * * *', '/bin/x'], ['x', 'main', '2 * * * *', '/bin/y']),
      'one command on two boxes': table(['x', 'gex45', '1 * * * *', '/bin/x'], ['y', 'main', '1 * * * *', '/bin/x']),
      'a commented command': table(['x', 'gex45', '1 * * * *', '#/bin/x']),
      'an empty cell': table(['x', 'gex45', '1 * * * *', '']),
      'Windows line endings': `${TABLE_HEADER}\r\nx\tgex45\t1 * * * *\t/bin/x\r\n`,
      'an empty file': '',
    };
    for (const [why, t] of Object.entries(bad)) {
      const p = plan(live, t, 'gex45');
      expect(p.ok, why).toBe(false);
      expect(p.errors.length, why).toBeGreaterThan(0);
      expect(p.text, why).toBe(live);                                    // the two installed lanes are still there
      expect(exitCode(p), why).toBe(2);
    }
    expect(plan(live, ROWS, 'laptop').ok).toBe(false);                   // an unknown box is refused, not treated as "no rows"
    expect(parseTable(ROWS).errors).toEqual([]);
  });

  it('refuses a crontab whose markers are broken, rather than guess where the block is', () => {
    for (const text of [`${HAND}${BEGIN}\n1 * * * * /bin/x\n`, `${HAND}${END}\n`, `${END}\n${BEGIN}\n`, `${BEGIN}\n${END}\n${BEGIN}\n${END}\n`, `# BEGIN lanes (hand-edited)\n${BEGIN}\n${END}\n`]) {
      const p = plan(text, ROWS, 'gex45');
      expect(p.ok, text).toBe(false);
      expect(p.text, text).toBe(text);
    }
    // A BEGIN line someone reworded is still the block (and is rewritten), so a second block is never appended.
    const p = plan(`${HAND}# BEGIN lanes (old wording)\n${END}\n`, ROWS, 'gex45');
    expect(p.text.match(/BEGIN lanes/g)).toHaveLength(1);
    expect(p.text).toContain(BEGIN);
  });

  it('is idempotent: a second run changes nothing', () => {
    for (const start of [HAND, '', `${HAND}55 * * * * ${READ}\n`, `${BEGIN}\n${END}\nMAILTO=""\n1 * * * * /bin/x\n`]) {
      for (const box of ['gex45', 'main']) {
        const once = plan(start, ROWS, box);
        const twice = plan(once.text, ROWS, box);
        expect(twice.text).toBe(once.text);
        expect(twice.changed).toBe(false);
        expect(twice.added).toEqual([]);
        expect(twice.removed).toEqual([]);
      }
    }
  });

  it('names the boxes as box.sh does', () => {
    const sh = fs.readFileSync(path.join(ROOT, 'scripts/workers/box.sh'), 'utf8');
    const names = /^BOXES="([^"]+)"/m.exec(sh)![1].split(' ').map((b) => b.split('=')[0]);
    expect([...(BOXES as string[])].sort()).toEqual([...names].sort());
    for (const [host, box] of Object.entries(HOSTNAME_BOX as Record<string, string>)) {
      expect(sh, host).toContain(`${host}) echo ${box} ;;`);
      expect(boxOfHostname(host)).toBe(box);
    }
    expect(boxOfHostname('gex45-1.example.org')).toBe('gex45');
    expect(boxOfHostname('MacBook-Pro')).toBeNull();
  });
});

describe('lanes-crontab: --apply', () => {
  const NOW = new Date('2026-11-13T04:05:06.789Z');
  // The command holds a crontab as latin1 (one character a byte), so the fake crontab here is the same bytes read that way.
  const LIVE = Buffer.from(HAND, 'utf8').toString('latin1');
  const setup = (live: string) => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lanes-'));
    const state = { live, installs: 0 };
    return {
      state, dir,
      io: {
        box: 'gex45', table: ROWS, backupDir: dir, now: NOW,
        readCrontab: () => state.live,
        installCrontab: (f: string) => { state.installs += 1; state.live = fs.readFileSync(f, 'latin1'); return { ok: true }; },
      },
    };
  };

  it('backs up the old crontab in a dated folder, installs, and reads back', () => {
    const { state, dir, io } = setup(LIVE);
    const r = runApply(io);
    expect(r.code).toBe(0);
    expect(state.installs).toBe(1);
    expect(state.live).toBe(plan(LIVE, ROWS, 'gex45').text);
    expect(r.backup).toBe(path.join(dir, '2026-11-13', 'crontab-2026-11-13T04-05-06Z.before'));
    expect(fs.readFileSync(r.backup as string, 'latin1')).toBe(LIVE);
    // Second run: nothing to do, no install, no new backup.
    const again = runApply(io);
    expect(again.code).toBe(0);
    expect(state.installs).toBe(1);
    expect(fs.readdirSync(path.join(dir, '2026-11-13'))).toHaveLength(2);
  });

  it('refuses a result that loses a line outside the block, and installs nothing', () => {
    const { state, dir, io } = setup(LIVE);
    // A planner with a bug: it drops the auto-pull line while adding the block.
    const buggy = (a: { crontab: string; table: string; box: string }) => {
      const p = planCrontab(a);
      return { ...p, text: p.text.split('\n').filter((l: string) => !l.includes('auto-pull')).join('\n') };
    };
    const r = runApply({ ...io, plan: buggy });
    expect(r.code).toBe(2);
    expect(r.lines.join('\n')).toMatch(/REFUSED: the new crontab would have 6 lines outside the lanes block and the live one has 7: 1 line\(s\) would be lost/);
    expect(state.installs).toBe(0);
    expect(state.live).toBe(LIVE);
    expect(fs.readdirSync(dir)).toEqual([]);
    // The guard on its own: fewer lines, a changed line, and an added line are all refused; a block-only change passes.
    expect(guardOutside('a\nb\n', 'a\n')).toMatch(/1 line\(s\) would be lost/);
    expect(guardOutside('a\nb\n', 'a\nB\n')).toMatch(/would change/);
    expect(guardOutside('a\nb\n', `a\nb\nc\n${BEGIN}\n${END}\n`)).toMatch(/would change/);
    expect(guardOutside('a\nb', `a\nb\n${BEGIN}\n1 * * * * x\n${END}\n`)).toBeNull();
  });

  it('writes nothing for a malformed table, or when the crontab is edited mid-run', () => {
    const a = setup(LIVE);
    expect(runApply({ ...a.io, table: 'not a table\n' }).code).toBe(2);
    expect(a.state.installs).toBe(0);
    const b = setup(LIVE);
    let reads = 0;
    const r = runApply({ ...b.io, readCrontab: () => (++reads === 1 ? LIVE : `${LIVE}1 2 3 4 5 /root/bin/added-by-hand-meanwhile.sh\n`) });
    expect(r.code).toBe(2);
    expect(r.lines.join('\n')).toMatch(/changed while this ran/);
    expect(b.state.installs).toBe(0);
  });

  it('says so when crontab refuses the file or the read-back differs', () => {
    const a = setup(LIVE);
    const refused = runApply({ ...a.io, installCrontab: () => ({ ok: false, err: 'errors in crontab file, can\'t install.' }) });
    expect(refused.code).toBe(3);
    expect(refused.lines.join('\n')).toMatch(/did not accept .*The live crontab is unchanged/);
    const b = setup(LIVE);
    const mangled = runApply({ ...b.io, installCrontab: (f: string) => { b.state.live = fs.readFileSync(f, 'latin1').replace('first-read', 'first-raed'); return { ok: true }; } });
    expect(mangled.code).toBe(3);
    expect(mangled.lines.join('\n')).toMatch(/does not read back .*Restore with: crontab .*\.before/);
  });
});

describe('lanes-crontab: the command and its wiring', () => {
  const run = (args: string[], input: Buffer | string = '') => spawnSync('node', [TOOL, ...args], { input, encoding: 'latin1' });

  it('check mode: exit 0 and the same bytes for the committed table; exit 1 when the block would change; exit 2 on a bad table', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lanes-cli-'));
    const cron = path.join(dir, 'crontab'); const out = path.join(dir, 'out'); const t = path.join(dir, 'lanes.tsv');
    fs.writeFileSync(cron, Buffer.concat([Buffer.from(HAND, 'utf8'), Buffer.from([0x23, 0x20, 0xff, 0xfe, 0x0a])]));  // ends in a line that is not UTF-8
    const same = run(['--box=gex45', `--crontab=${cron}`, `--out=${out}`]);
    expect(same.status, same.stdout).toBe(0);
    expect(same.stdout).toMatch(/check box=gex45: in sync, nothing to write/);
    expect(fs.readFileSync(out).equals(fs.readFileSync(cron))).toBe(true);
    fs.writeFileSync(t, ROWS);
    const would = run(['--box=gex45', '--crontab=-', `--table=${t}`, `--out=${out}`], fs.readFileSync(cron));
    expect(would.status, would.stdout).toBe(1);
    expect(would.stdout).toMatch(/WOULD CHANGE the lanes block, \+6 -0 line\(s\) \(2 lane\(s\) in the table, 2 in this box's block\)/);
    expect(fs.readFileSync(out).subarray(0, fs.statSync(cron).size).equals(fs.readFileSync(cron))).toBe(true);
    fs.writeFileSync(t, 'lane\tbox\n');
    expect(run(['--box=gex45', `--crontab=${cron}`, `--table=${t}`]).status).toBe(2);
    expect(run(['--apply', '--box=gex45']).status).toBe(2);              // --apply never takes a box, a file or a table
    expect(run(['--box=gex45', `--crontab=${cron}`, '--aply']).status).toBe(2);
  });

  it('the committed table parses', () => {
    expect(parseTable(fs.readFileSync(path.join(ROOT, TABLE_PATH), 'utf8')).errors).toEqual([]);
  });

  it('the installer that runs after every pull only checks: it never applies', () => {
    const sh = fs.readFileSync(path.join(ROOT, 'scripts/workers/install-claude-job.sh'), 'utf8');
    const calls = sh.split('\n').filter((l) => l.includes('lanes-crontab.mjs') && !l.trim().startsWith('#'));
    expect(calls).toHaveLength(1);
    expect(calls[0]).toContain('--check');
    expect(sh).not.toMatch(/lanes-crontab\.mjs[^\n#]*--apply/);
  });
});
