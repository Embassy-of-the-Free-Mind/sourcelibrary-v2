/**
 * The lane registry (scripts/lib/lanes.mjs, #5480) against the code it describes.
 *
 * 1. Coverage: every script a schedule runs — scripts/workers/crontab.production (live lines), the
 *    scheduler's WORKERS, vercel.json crons, and the routes cron-caller.mjs hits — that writes `books` or
 *    `pages`, itself or through a local import, is a registered lane or an EXEMPT entry with a reason.
 * 2. Claims: a declared pause key is present in the lane's source, and a `marker` hold claim is too. A
 *    lane that skips a check says why.
 * 3. Pause names: no lane claims a name nothing reads (DEAD_PAUSE_NAMES). Keys are pause.mjs's (#5492).
 *
 * Static by design — importing a worker runs it. The write detector is a regex over source, so it can
 * miss a writer that builds a collection name at runtime; it errs toward flagging (a read-only importer
 * of a module that also exports a writer is flagged and has to be EXEMPTed with a reason).
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
// @ts-expect-error — scripts-side module, no types
import { LANES, EXEMPT, PAUSE_KEYS, DEAD_PAUSE_NAMES, HOLD_MARKER_TEST, LANE_STEPS, registeredFiles } from '../../scripts/lib/lanes.mjs';

type Lane = { name: string; serves: string; files: string[]; budget: string; respectsHold: string | false; pause: string | null; reason?: string };

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

/** Everything a schedule runs: crontab (uncommented lines), scheduler WORKERS, vercel crons, cron-caller targets. */
function scheduledTargets(): string[] {
  const t = new Set<string>();
  const cron = read('scripts/workers/crontab.production').split('\n').filter((l) => l.trim() && !l.trim().startsWith('#'));
  for (const l of cron) {
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

  it('the admin API routes call assertLaneGuards', () => {
    const admin = (LANES as Lane[]).find((l) => l.name === 'admin-api')!;
    const missing = admin.files.filter((f) => f.startsWith('src/app/') && !read(f).includes('assertLaneGuards('));
    expect(missing).toEqual([]);
  });
});
