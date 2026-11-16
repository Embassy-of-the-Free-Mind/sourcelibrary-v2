/**
 * Every website door into page TEXT is a registered lane or a listed door (v2#8590 item 1).
 *
 * WHY. From 11-06 to 11-11 about 1,900 pages were read and translated through two website routes, by hand, on a
 * model the router no longer names. The router never saw it: scripts/lib/lanes.mjs listed website routes by hand,
 * and nothing scanned src/app/api for routes that write `pages.ocr` / `pages.translation`. Those routes are retired
 * (retired-batch-routes.test.ts). This is the check that finds the next one.
 *
 * WHAT IT CHECKS. A live route file is a DOOR when (a) its own source writes or clears page text (the shared probe,
 * ./page-text-probe.ts), (b) it calls one of the library writers by name (TEXT_WRITER_CALL), or (c) a module it
 * imports, at any depth, does (a) or (b). Every door must be a file of a lane in LANES or an entry in
 * PAGE_TEXT_DOORS with a kind and a reason, and a `model` door outside a lane must name the issue that retires it
 * or makes it a lane. An entry that is no longer a door fails too, so the list cannot rot.
 *
 * WHAT IT DOES NOT SEE. The probe's blind spots (listed in page-text-probe.ts): a field name that arrives at run
 * time, and a write the probe's line patterns miss in a module no listed writer function lives in. A route that
 * reaches a model and returns text without writing a page is not a door here. Scripts are not covered: the cron
 * half is lanes-registry.test.ts, and hand-run scripts that submit a Gemini batch are script-page-text-doors.test.ts (v2#8590 item 3).
 *
 * (c) needs one allowance. SHARED_MODULES are imported widely for their readers, gates and predicates; importing
 * one is not a write, so for those only a call to a writer function by name counts.
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
// @ts-expect-error plain .mjs
import { LANES, PAGE_TEXT_DOORS, PAGE_TEXT_DOOR_KINDS, RETIRED_API_ROUTES } from '../../scripts/lib/lanes.mjs';
import { REPO, writesOrClearsPageText } from './page-text-probe';

type Door = { file: string; kind: string; reason: string; issue?: string };
const API = 'src/app/api';

/** Library functions that write page text. The probe cannot see the write from the file that calls them. */
const TEXT_WRITER_CALL = /\b(?:writePageText|writePageTranslation|restoreRevision)\s*\(/;
/**
 * Modules whose import alone is not a write: each holds a writer function AND readers, gates or predicates that
 * many routes use. A route that imports one is a door only if it calls a writer by name (TEXT_WRITER_CALL).
 */
const SHARED_MODULES: Record<string, string> = {
  'src/lib/translate-write.ts': 'writePageTranslation, beside the translation gates and predicates every reader uses',
  'src/lib/page-revisions.ts': 'restoreRevision, beside createRevision / getRevisions',
  'src/lib/page-text-writer.ts': 'writePageText itself',
  'src/lib/chat-page-search.ts': 'a reader the probe over-matches (grandfathered as such in page-text-writers-grandfathered.json)',
  'scripts/lib/lanes.mjs': 'the registry itself: its reasons describe writes in words the probe can match, and two routes import it',
};

const stripComments = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`])\/\/.*$/gm, '$1');

/** Does this source, on its own, write or clear page text or call a library writer? */
export function touchesPageText(src: string): boolean {
  return writesOrClearsPageText(src) || TEXT_WRITER_CALL.test(stripComments(src));
}

/** Live route files. Next.js does not route a folder whose name starts with `_` (src/app/api/cron/_archived). */
function routeFiles(dir = API, out: string[] = []): string[] {
  for (const e of fs.readdirSync(path.join(REPO, dir), { withFileTypes: true })) {
    if (e.isDirectory()) { if (!e.name.startsWith('_')) routeFiles(`${dir}/${e.name}`, out); }
    else if (/^route\.tsx?$/.test(e.name)) out.push(`${dir}/${e.name}`);
  }
  return out;
}

function resolveImport(from: string, spec: string): string | null {
  let p: string;
  if (spec.startsWith('@/')) p = path.join('src', spec.slice(2));
  else if (spec.startsWith('.')) p = path.normalize(path.join(path.dirname(from), spec));
  else return null;
  for (const c of [p, `${p}.ts`, `${p}.tsx`, `${p}.mjs`, `${p}.js`, `${p}/index.ts`]) {
    const abs = path.join(REPO, c);
    if (fs.existsSync(abs) && fs.statSync(abs).isFile()) return c;
  }
  return null;
}

const srcCache = new Map<string, string>();
const read = (f: string) => { if (!srcCache.has(f)) srcCache.set(f, fs.readFileSync(path.join(REPO, f), 'utf8')); return srcCache.get(f)!; };

/** Local modules `file` imports, at any depth (itself excluded). */
function imported(file: string, seen = new Set<string>()): Set<string> {
  for (const m of read(file).matchAll(/(?:import|from)\s*\(?\s*['"]([^'"]+)['"]/g)) {
    const r = resolveImport(file, m[1]);
    if (r && !seen.has(r) && !/\.json$/.test(r)) { seen.add(r); imported(r, seen); }
  }
  return seen;
}

const laneFiles = new Set<string>((LANES as { files: string[] }[]).flatMap((l) => l.files));
const doors = PAGE_TEXT_DOORS as Door[];
/** Listed as read-only (a probe over-match): importing one is not a write either. */
const readers = new Set(doors.filter((d) => d.kind === 'reader').map((d) => d.file));

/** Why `route` is a door, or null. `via` names the imported module that writes. */
export function doorReason(route: string): { own: boolean; via: string[] } | null {
  const own = touchesPageText(read(route));
  const via = [...imported(route)].filter((f) => !SHARED_MODULES[f] && !readers.has(f) && touchesPageText(read(f)));
  return own || via.length ? { own, via } : null;
}

describe('website doors into page text (v2#8590)', () => {
  const found = new Map<string, { own: boolean; via: string[] }>();
  for (const r of routeFiles()) { const why = doorReason(r); if (why) found.set(r, why); }

  it('every route that writes or clears page text is a lane or a listed door', () => {
    const listed = new Set(doors.map((d) => d.file));
    const unregistered = [...found].filter(([f]) => !laneFiles.has(f) && !listed.has(f))
      .map(([f, why]) => `${f}${why.own ? '' : `  (through ${why.via.join(', ')})`}`);
    expect(unregistered, [
      'These website routes write or clear pages.ocr / pages.translation and are not registered (v2#8590).',
      'Text a model produces belongs to a lane the router feeds: queue the book instead of writing from a route.',
      'If the route must exist, add it to a lane in scripts/lib/lanes.mjs, or to PAGE_TEXT_DOORS there with its kind and reason.',
    ].join(' ')).toEqual([]);
  });

  it('every listed door is still a door, has a known kind and a reason, and has one home', () => {
    const problems: string[] = [];
    const seen = new Set<string>();
    for (const d of doors) {
      if (seen.has(d.file)) problems.push(`${d.file}: listed twice`);
      seen.add(d.file);
      if (!fs.existsSync(path.join(REPO, d.file))) { problems.push(`${d.file}: file is gone — remove the entry`); continue; }
      if (!found.has(d.file)) problems.push(`${d.file}: no longer writes page text — remove the entry`);
      if (!PAGE_TEXT_DOOR_KINDS.includes(d.kind)) problems.push(`${d.file}: unknown kind ${d.kind}`);
      if (!d.reason?.trim()) problems.push(`${d.file}: no reason`);
      if (laneFiles.has(d.file)) problems.push(`${d.file}: is a lane's file too — a door has one home`);
    }
    expect(problems).toEqual([]);
  });

  it('a model door outside a lane names the issue that retires it or makes it a lane', () => {
    const open = doors.filter((d) => d.kind === 'model');
    expect(open.filter((d) => !/^v[23]#\d+$/.test(d.issue ?? '')).map((d) => d.file)).toEqual([]);
    // The count is the work left on v2#8590 item 2. It may only fall: a new model door is a lane, not an entry.
    expect(open.length, 'a new model door was listed: make it a lane the router feeds, or do not build it').toBeLessThanOrEqual(1);
  });

  it('a retired route is not a door, and the lane routes are found', () => {
    for (const dir of RETIRED_API_ROUTES as string[]) expect([...found.keys()].filter((f) => f.startsWith(`${dir}/`))).toEqual([]);
    // Positive control on the real tree: a check that finds nothing proves nothing.
    for (const f of ['src/app/api/process/route.ts', 'src/app/api/process/batch/route.ts', 'src/app/api/pages/[id]/route.ts', 'src/app/api/books/[id]/clear-ocr/route.ts']) {
      expect(found.has(f), `${f} should be found as a door`).toBe(true);
    }
    expect(found.size).toBeGreaterThan(15);
  });

  it('negative controls: an unregistered writer is caught in each idiom the codebase uses', () => {
    // Inline update, the idiom the probe was built against.
    expect(touchesPageText("await db.collection('pages').updateOne({ id }, { $set: { 'ocr.data': text, updated_at: now } });")).toBe(true);
    // Hoisted update document built by assignment: the dominant idiom in routes.
    expect(touchesPageText("const updateData: Record<string, unknown> = {};\nupdateData['translation.data'] = english;\nawait pages.updateOne({ id }, { $set: updateData });")).toBe(true);
    // Whole-field set under $set.
    expect(touchesPageText('await pages.updateOne({ id }, {\n  $set: {\n    ocr: {\n      data: text,\n      model,\n    },\n  },\n});')).toBe(true);
    // A clear.
    expect(touchesPageText("await db.collection('pages').updateMany({ book_id }, { $unset: { ocr: '', translation: '' } });")).toBe(true);
    // Through a library writer, where the route holds no update document at all.
    expect(touchesPageText("import { writePageText } from '@/lib/page-text-writer';\nawait writePageText(db, page, 'ocr', { data: text }, { by, reason });")).toBe(true);
    expect(touchesPageText('await restoreRevision(revisionId, session.user.name);')).toBe(true);
    // Readers and comments are not doors.
    expect(touchesPageText("const pages = await db.collection('pages').find({ 'ocr.data': { $exists: true, $ne: '' } }, { projection: { 'translation.data': 1 } }).toArray();")).toBe(false);
    expect(touchesPageText('// this route never calls writePageText(…); it queues the book')).toBe(false);
  });
});
