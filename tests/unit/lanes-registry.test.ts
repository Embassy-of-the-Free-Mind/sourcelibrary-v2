/**
 * The lane registry (scripts/lib/lanes.mjs, #5480) against the code it describes.
 *
 * 1. Coverage: every script a schedule runs — the committed snapshot of EVERY box's live crontab
 *    (CRONTAB_SNAPSHOTS: main's crontab.production, gex45, l7a; live lines), the scheduler's WORKERS, vercel.json
 *    crons, and the routes cron-caller.mjs hits — that writes `books` or `pages`, itself or through a local import,
 *    is a registered lane or an EXEMPT entry with a reason. A program a snapshot runs from OUTSIDE the repo is a
 *    lane's `cron` line or an OFF_REPO_CRON entry with a reason, so a lane that exists only on a box fails CI (#7301).
 * 2. Claims: a declared pause key is present in the lane's source, and a `marker` hold claim is too. A
 *    lane that skips a check says why.
 * 3. Pause names: no lane claims a name nothing reads (DEAD_PAUSE_NAMES). Keys are pause.mjs's (#5492).
 * 4. Subscription lanes (#7301): a `quota-share` budget names a meter and a share, its files gate on the meter, and
 *    none of them can reach a paid model client — out of quota, the lane idles and the book waits.
 * 5. Routes: the routing rows that hand a lane its books (the CLI holds, the cli translation engines, the OCR table's
 *    lane files) all land on a registered lane.
 *
 * Static by design — importing a worker runs it. The write detector is a regex over source, so it can
 * miss a writer that builds a collection name at runtime; it errs toward flagging (a read-only importer
 * of a module that also exports a writer is flagged and has to be EXEMPTed with a reason).
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
// @ts-expect-error — scripts-side module, no types
import { LANES, EXEMPT, PAUSE_KEYS, DEAD_PAUSE_NAMES, HOLD_MARKER_TEST, LANE_STEPS, registeredFiles, CRONTAB_SNAPSHOTS, OFF_REPO_CRON, QUOTA_METERS } from '../../scripts/lib/lanes.mjs';

type Lane = {
  name: string; serves: string; files: string[]; budget: string; respectsHold: string | false; pause: string | null; reason?: string;
  quota?: { meter: string; share: number; paced?: boolean }; stamps?: { field: string; call_site: string; engine?: string }[];
  routes?: { hold?: string; engines?: string[] }; cron?: string[];
};

const BUDGETS = ['dial', 'dial (scoped)', 'envelope', 'committed', 'gpu-lease', 'owned-gpu', 'free-cpu', 'quota-share', 'unmetered', 'none'];

const ROOT = path.resolve(__dirname, '../..');
const read = (f: string) => fs.readFileSync(path.join(ROOT, f), 'utf8');

const WRITE = '(?:updateOne|updateMany|bulkWrite|insertOne|insertMany|replaceOne|findOneAndUpdate|findOneAndReplace|deleteOne|deleteMany)';
// A collection argument that names books/pages: the literal, a `booksCol`-style variable, or `x || 'books'`.
const ARG = `(?:['"\`](?:books|pages)['"\`]|[A-Za-z_]*(?:[Bb]ook|[Pp]age)s?(?:Col|Coll|Collection)\\b[\\w.]*|[\\w.]*\\s*\\|\\|\\s*['"\`](?:books|pages)['"\`])`;

/** Does this source write `books` or `pages` itself? */
export function directWrites(src: string): boolean {
  if (new RegExp(`(?:collection|getCollection)\\(\\s*${ARG}\\s*\\)\\s*\\.\\s*${WRITE}\\(`).test(src)) return true;
  const vars = new Set<string>();
  for (const m of src.matchAll(new RegExp(`(?:const|let|var)\\s+(\\w+)\\s*=\\s*[^;\\n=]*?(?:collection|getCollection)\\(\\s*${ARG}\\s*\\)`, 'g'))) vars.add(m[1]);
  for (const m of src.matchAll(new RegExp(`(\\w+)\\s*:\\s*[^;\\n=,{]*?collection\\(\\s*${ARG}\\s*\\)`, 'g'))) vars.add(m[1]);
  for (const v of vars) if (new RegExp(`\\b${v}\\s*\\.\\s*${WRITE}\\(`).test(src)) return true;
  return false;
}

function resolveImport(from: string, spec: string): string | null {
  let p: string;
  if (spec.startsWith('@/')) p = path.join(ROOT, 'src', spec.slice(2));
  else if (spec.startsWith('.')) p = path.resolve(path.dirname(from), spec);
  else return null;
  for (const c of [p, `${p}.ts`, `${p}.tsx`, `${p}.mjs`, `${p}.js`, path.join(p, 'index.ts')]) {
    if (fs.existsSync(c) && fs.statSync(c).isFile()) return c;
  }
  return null;
}

/** Files (repo-relative) that write books/pages, reachable from `file` through local imports. */
function writersReachable(file: string, seen = new Set<string>()): string[] {
  if (seen.has(file) || /\.json$/.test(file)) return [];
  seen.add(file);
  const src = fs.readFileSync(file, 'utf8');
  const out = directWrites(src) ? [path.relative(ROOT, file)] : [];
  for (const m of src.matchAll(/(?:import|from)\s*\(?\s*['"]([^'"]+)['"]/g)) {
    const r = resolveImport(file, m[1]);
    if (r) out.push(...writersReachable(r, seen));
  }
  return out;
}

/** The live (uncommented) lines of every box's crontab snapshot. */
function cronLines(): { box: string; line: string }[] {
  return (CRONTAB_SNAPSHOTS as { box: string; file: string }[]).flatMap(({ box, file }) =>
    read(file).split('\n').filter((l) => l.trim() && !l.trim().startsWith('#') && !/^[A-Z_]+=/.test(l.trim())).map((line) => ({ box, line })));
}

/** Everything a schedule runs: crontab snapshots (uncommented lines), scheduler WORKERS, vercel crons, cron-caller targets. */
function scheduledTargets(): string[] {
  const t = new Set<string>();
  for (const { line: l } of cronLines()) {
    for (const m of l.matchAll(/scripts\/[A-Za-z0-9_./-]+\.(?:mjs|js|ts|sh)/g)) t.add(m[0]);
    for (const m of l.matchAll(/cron-caller\.mjs (\S+?)["'\s]/g)) {
      const a = m[1];
      t.add(`src/app${a.startsWith('/') ? a : `/api/cron/${a}`}/route.ts`);
    }
  }
  for (const m of read('scripts/workers/scheduler.mjs').matchAll(/cmd: '(?:node|npx tsx) (scripts\/[^ ']+)/g)) t.add(m[1]);
  for (const c of JSON.parse(read('vercel.json')).crons ?? []) t.add(`src/app${String(c.path).split('?')[0]}/route.ts`);
  return [...t].filter((f) => fs.existsSync(path.join(ROOT, f))).sort();
}

describe('lane registry — shape', () => {
  it('every lane names existing files, a known step, and a reason for every skipped check', () => {
    const problems: string[] = [];
    const names = new Set<string>();
    for (const l of LANES as Lane[]) {
      if (names.has(l.name)) problems.push(`${l.name}: duplicate name`);
      names.add(l.name);
      if (!LANE_STEPS.includes(l.serves)) problems.push(`${l.name}: unknown step ${l.serves}`);
      for (const f of l.files) if (!fs.existsSync(path.join(ROOT, f))) problems.push(`${l.name}: missing file ${f}`);
      if (!BUDGETS.includes(l.budget)) problems.push(`${l.name}: unknown budget ${l.budget}`);
      if (l.budget === 'quota-share') {
        if (!l.quota || !(QUOTA_METERS as Record<string, unknown>)[l.quota.meter]) problems.push(`${l.name}: quota-share without a known meter`);
        if (!(l.quota?.share! > 0 && l.quota!.share <= 1)) problems.push(`${l.name}: quota share must be in (0, 1]`);
      } else if (l.quota) problems.push(`${l.name}: a quota on a ${l.budget} lane`);
      const skips = [l.respectsHold === false && 'no hold check', l.pause == null && 'no pause key', l.budget === 'none' && 'no budget', l.respectsHold === 'status' && 'status-only hold']
        .filter(Boolean);
      if (skips.length && l.respectsHold !== 'status' && !l.reason?.trim()) problems.push(`${l.name}: ${skips.join(', ')} without a reason`);
      if (l.respectsHold === false && !l.reason?.trim()) problems.push(`${l.name}: respectsHold false without a reason`);
    }
    for (const e of EXEMPT as { file: string; reason: string }[]) {
      if (!fs.existsSync(path.join(ROOT, e.file))) problems.push(`EXEMPT: missing file ${e.file}`);
      if (!e.reason?.trim()) problems.push(`EXEMPT ${e.file}: no reason`);
    }
    expect(problems).toEqual([]);
  });
});

describe('lane registry — coverage', () => {
  it('every scheduled script that writes books or pages is a lane or exempt', () => {
    const registered: Set<string> = registeredFiles();
    const unregistered: string[] = [];
    for (const t of scheduledTargets()) {
      if (t.endsWith('.sh')) continue; // a shell wrapper is covered through the script it runs
      const w = writersReachable(path.join(ROOT, t));
      if (w.length && !registered.has(t)) unregistered.push(`${t} (writes via ${[...new Set(w)].slice(0, 3).join(', ')})`);
    }
    expect(unregistered, 'register these in scripts/lib/lanes.mjs (LANES, or EXEMPT with a reason)').toEqual([]);
  });

  it('every program a crontab snapshot runs from outside the repo is a lane\'s cron line or an OFF_REPO_CRON entry (#7301)', () => {
    const known = [...(LANES as Lane[]).flatMap((l) => l.cron ?? []), ...(OFF_REPO_CRON as { match: string }[]).map((o) => o.match)];
    const REPO = /^\/(?:root\/sourcelibrary|data\/scratch\/sl\/sourcelibrary)\//;
    const SYSTEM = /^\/(?:usr\/bin|bin|usr\/sbin)\//;
    const unknown: string[] = [];
    for (const { box, line } of cronLines()) {
      for (const m of line.matchAll(/(?:^|[\s;=('"])(\/(?:root|data|usr\/local|opt|home)\/[A-Za-z0-9_./-]+\.(?:mjs|js|ts|sh|py))(?![A-Za-z0-9])/g)) {
        const p = m[1];
        if (REPO.test(p) || SYSTEM.test(p)) continue;
        if (!known.some((k) => line.includes(k))) unknown.push(`${box}: ${p}`);
      }
      // A binary in /root/bin or /usr/local/bin that is not a script file (oura-digest, gpu-queue.sh is covered above).
      for (const m of line.matchAll(/(?:^|[\s;])(\/(?:root\/bin|usr\/local\/bin)\/[A-Za-z0-9_.-]+)(?=[\s;]|$)/g)) {
        if (!/\.(?:mjs|js|ts|sh|py)$/.test(m[1]) && !known.some((k) => line.includes(k))) unknown.push(`${box}: ${m[1]}`);
      }
    }
    expect([...new Set(unknown)], 'name it in a lane\'s `cron` (scripts/lib/lanes.mjs) or in OFF_REPO_CRON with a reason').toEqual([]);
  });

  it('every lane `cron` line and OFF_REPO_CRON entry still matches a live snapshot line (no stale entries)', () => {
    const lines = cronLines().map((c) => c.line);
    const stale = [...(LANES as Lane[]).flatMap((l) => (l.cron ?? []).map((c) => `${l.name}: ${c}`)), ...(OFF_REPO_CRON as { match: string }[]).map((o) => `OFF_REPO_CRON: ${o.match}`)]
      .filter((e) => !lines.some((l) => l.includes(e.replace(/^[^:]+: /, ''))));
    expect(stale).toEqual([]);
  });

  it('the write detector catches the shapes used in this repo (and not a read)', () => {
    expect(directWrites(`await db.collection('books').updateOne({ id }, { $set: x })`)).toBe(true);
    expect(directWrites(`const b = mc.db('bookstore').collection('books');\nawait b.updateMany({}, {})`)).toBe(true);
    expect(directWrites(`await db.collection(booksCol).updateOne({ id }, {})`)).toBe(true);
    expect(directWrites(`await db.collection(book._booksCol || 'books').updateOne({ id }, {})`)).toBe(true);
    expect(directWrites(`const P = db.collection('pages');\nawait P.bulkWrite(ops)`)).toBe(true);
    expect(directWrites(`await db.collection('books').find({}).toArray()`)).toBe(false);
    expect(directWrites(`await db.collection('ops_reports').replaceOne({ _id }, r)`)).toBe(false);
  });
});

describe('lane registry — claims match the source', () => {
  const sourceOf = (l: Lane) => l.files.map(read).join('\n');

  it('every declared pause key is one that exists, and its check is in the lane source', () => {
    const problems: string[] = [];
    for (const l of LANES as Lane[]) {
      if (l.pause == null) continue;
      const key = (PAUSE_KEYS as Record<string, { test: RegExp }>)[l.pause];
      if (!key) { problems.push(`${l.name}: unknown pause key ${l.pause}`); continue; }
      if (!key.test.test(sourceOf(l))) problems.push(`${l.name}: declares ${l.pause} but its files never check it`);
    }
    expect(problems).toEqual([]);
  });

  it('every step key here is a key of scripts/lib/pause.mjs (one vocabulary, #5492)', async () => {
    // @ts-expect-error — plain .mjs, no types
    const { PAUSE_KEYS: CANONICAL } = await import('../../scripts/lib/pause.mjs');
    const stray = Object.keys(PAUSE_KEYS).filter((k) => k !== 'paused' && !CANONICAL.includes(k));
    expect(stray).toEqual([]);
  });

  it('every documented pause key stops at least one lane', () => {
    const used = new Set((LANES as Lane[]).map((l) => l.pause));
    expect(Object.keys(PAUSE_KEYS).filter((k) => !used.has(k))).toEqual([]);
  });

  it('a pause NAME that nothing reads is never claimed, and no live lane file reads one', () => {
    for (const l of LANES as Lane[]) {
      for (const n of DEAD_PAUSE_NAMES) expect(l.pause).not.toBe(`paused_phases:${n}`);
      const src = sourceOf(l);
      for (const n of DEAD_PAUSE_NAMES) expect(src.includes(`paused_phases?.includes('${n}')`), `${l.name} reads paused_phases '${n}' — move it to PAUSE_KEYS`).toBe(false);
    }
  });

  it("a 'marker' hold claim is visible in the lane source", () => {
    const problems = (LANES as Lane[])
      .filter((l) => l.respectsHold === 'marker' && !HOLD_MARKER_TEST.test(sourceOf(l)))
      .map((l) => l.name);
    expect(problems).toEqual([]);
  });

  it('a quota-share lane gates on its meter and can reach no paid model client (#7301: out of quota it idles, never the API)', () => {
    const GATE = /agyBlocked\(|claudeBlocked\(|laneQuota\(|agyCall\(|gatedTextCall\(/;
    const PAID = /getGeminiClient|gemini-script-client|@google\/genai|@google\/generative-ai|@anthropic-ai\/sdk|generateContent\(/;
    const problems: string[] = [];
    for (const l of (LANES as Lane[]).filter((x) => x.budget === 'quota-share')) {
      const src = sourceOf(l);
      if (!GATE.test(src)) problems.push(`${l.name}: no meter gate in its files`);
      const scripts = l.files.filter((f) => !/\.sh$/.test(f));
      for (const f of scripts) {
        if (PAID.test(read(f))) problems.push(`${l.name}: ${f} names a paid model client`);
        for (const imp of read(f).matchAll(/from\s*['"](\.[^'"]+)['"]/g)) {
          const r = resolveImport(path.join(ROOT, f), imp[1]);
          if (r && /agy-cli|model-limits|lane-quota/.test(r) && PAID.test(fs.readFileSync(r, 'utf8'))) problems.push(`${l.name}: ${path.relative(ROOT, r)} names a paid model client`);
        }
      }
    }
    expect(problems).toEqual([]);
  });

  it('the routing rows land on registered lanes: CLI holds, cli translation engines, OCR table lane files', async () => {
    // @ts-expect-error — plain .mjs, no types
    const { CLI_FLASH_OCR_HOLD, OCR_ROUTING_TABLE } = await import('../../scripts/lib/ocr-routing.mjs');
    // @ts-expect-error — plain .mjs, no types
    const { CLI_TRANSLATE_HOLD, CLI_TRANSLATE_LANES } = await import('../../scripts/lib/translation-routing.mjs');
    const lanes = LANES as Lane[];
    const holds = new Set(lanes.map((l) => l.routes?.hold).filter(Boolean));
    const engines = new Set(lanes.flatMap((l) => l.routes?.engines ?? []));
    const problems: string[] = [];
    for (const h of [CLI_FLASH_OCR_HOLD.reason, CLI_TRANSLATE_HOLD.reason]) if (!holds.has(h)) problems.push(`hold ${h}: no lane drains it`);
    for (const h of holds) if (![CLI_FLASH_OCR_HOLD.reason, CLI_TRANSLATE_HOLD.reason].includes(h)) problems.push(`a lane names hold ${h}, which no router writes`);
    for (const e of Object.keys(CLI_TRANSLATE_LANES)) if (!engines.has(e)) problems.push(`cli translation engine ${e}: no lane reads for it`);
    // Every lane file the OCR routing table names is a registered lane's file. Two rows name hand-run writers that are
    // not lanes yet; each says why here, and the list fails when one of them is registered.
    const NOT_YET = {
      'scripts/maintenance/apply-reocr-verdicts.mjs': 'Tibetan Yigdzin re-OCR (#4523): a one-off adjudicated run, not a standing lane',
      'scripts/batch/ocr-convergence/driver.mjs': 'two-reads-disagree (#6694): an experiment driver, run by hand',
    } as Record<string, string>;
    const files = new Set(lanes.flatMap((l) => l.files));
    for (const row of OCR_ROUTING_TABLE.rows) {
      const named = [row.code?.file, ...((row.route?.fallback ?? []).map((f: { lane: string }) => f.lane.split(' ')[0]))].filter(Boolean);
      for (const f of named) {
        if (files.has(f)) { if (NOT_YET[f]) problems.push(`${f} is registered now: drop it from NOT_YET`); continue; }
        if (!NOT_YET[f]) problems.push(`routing row ${row.id} names ${f}, which no lane registers`);
      }
    }
    expect(problems).toEqual([]);
  });

  it('the admin API routes call assertLaneGuards', () => {
    const admin = (LANES as Lane[]).find((l) => l.name === 'admin-api')!;
    const missing = admin.files.filter((f) => f.startsWith('src/app/') && !read(f).includes('assertLaneGuards('));
    expect(missing).toEqual([]);
  });
});
