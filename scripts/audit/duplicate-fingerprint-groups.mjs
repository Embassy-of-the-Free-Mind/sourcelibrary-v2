#!/usr/bin/env node
/**
 * Report every group of `books` records that share a source fingerprint —
 * the same digital object held more than once.
 *
 * THIS SCRIPT READS AND REPORTS. IT NEVER WRITES.
 * No deletions, no visibility flips, no `duplicate_of`, no merges. Deciding
 * what happens to a duplicate is a human's call: `duplicate_of` HIDES a book,
 * and hiding a real book is the expensive error. This tool exists so that the
 * decision has a list in front of it instead of a guess.
 *
 * Two modes:
 *   (report, default)  write the full group listing to JSON + Markdown
 *   --detect           exit 2 if a group appeared that is not in the baseline,
 *                      exit 0 otherwise. This is the standing detector: run it
 *                      from cron so a NEW same-fingerprint pair stops being
 *                      invisible. Baseline: scripts/audit/baselines/duplicate-fingerprints.json
 *   --update-baseline  rewrite the baseline from the current state (a deliberate
 *                      act: it says "these groups are known and accepted").
 *
 * Grouping uses the fingerprint SET (`source_fingerprints`, see
 * `sourceFingerprints()` in src/lib/dedup.ts), falling back to computing it, so
 * the same object imported as `ia:<id>` and as `iiif:…/iiif/<id>/manifest.json`
 * lands in ONE group. Measured 2026-08-30: the scalar `source_fingerprint`
 * finds 139 groups / 280 docs; the set finds 268 groups / 539 docs.
 *
 * Usage:
 *   set -a; source .env.production.local; set +a
 *   node scripts/audit/duplicate-fingerprint-groups.mjs
 *   node scripts/audit/duplicate-fingerprint-groups.mjs --detect
 */
import { MongoClient } from 'mongodb';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { sourceFingerprints } from '../lib/source-fingerprints.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const BASELINE = path.join(HERE, 'baselines', 'duplicate-fingerprints.json');
const OUT_DIR = path.join(HERE, '..', '..', '.claude', 'docs', 'archive');

const DETECT = process.argv.includes('--detect');
const UPDATE = process.argv.includes('--update-baseline');
const argAt = (n) => { const i = process.argv.indexOf(n); return i >= 0 ? process.argv[i + 1] : null; };
const OUT = argAt('--out');

const uri = process.env.MONGODB_URI;
if (!uri) { console.error('MONGODB_URI is not set — source .env.production.local with SEMICOLONS, not &&'); process.exit(2); }

const mc = new MongoClient(uri);
await mc.connect();
const db = mc.db('bookstore');

const PROJECTION = {
  id: 1, title: 1, author: 1, year: 1, published: 1, visible: 1, hidden: 1,
  created_at: 1, pages_count: 1, pages_ocr: 1, duplicate_of: 1,
  source_fingerprint: 1, source_fingerprints: 1,
  ia_identifier: 1, gallica_ark: 1, bodleian_uuid: 1, mdz_id: 1, bsb_id: 1,
  google_books_id: 1, image_source: 1, dublin_core: 1,
};

// ---- collect --------------------------------------------------------------
const byFingerprint = new Map();
const info = new Map();
let scanned = 0;
for await (const b of db.collection('books').find({}, { projection: PROJECTION })) {
  scanned++;
  const id = b.id || String(b._id);
  const fps = Array.isArray(b.source_fingerprints) && b.source_fingerprints.length
    ? b.source_fingerprints
    : sourceFingerprints(b);
  const keys = [...new Set([...fps, ...(b.source_fingerprint ? [b.source_fingerprint] : [])])];
  if (keys.length === 0) continue;
  info.set(id, {
    id,
    title: b.title || null,
    author: b.author || null,
    year: b.year ?? null,
    published: b.published ?? null,
    provider: b.image_source?.provider ?? null,
    visible: b.visible === true,
    hidden: b.hidden === true,
    duplicate_of: b.duplicate_of ?? null,
    pages_count: b.pages_count ?? 0,
    pages_ocr: b.pages_ocr ?? 0,
    created_at: b.created_at ?? null,
    scalar_fingerprint: b.source_fingerprint ?? null,
    fingerprints: keys,
  });
  for (const k of keys) {
    if (!byFingerprint.has(k)) byFingerprint.set(k, []);
    byFingerprint.get(k).push(id);
  }
}

// ---- union-find over shared fingerprints ----------------------------------
const parent = new Map();
const find = (x) => { while (parent.get(x) !== x) { parent.set(x, parent.get(parent.get(x))); x = parent.get(x); } return x; };
const union = (a, b) => { const ra = find(a), rb = find(b); if (ra !== rb) parent.set(ra, rb); };
for (const [, ids] of byFingerprint) {
  const uniq = [...new Set(ids)];
  if (uniq.length < 2) continue;
  for (const x of uniq) if (!parent.has(x)) parent.set(x, x);
  for (let i = 1; i < uniq.length; i++) union(uniq[0], uniq[i]);
}
const components = new Map();
for (const id of parent.keys()) {
  const r = find(id);
  if (!components.has(r)) components.set(r, []);
  components.get(r).push(id);
}

const groups = [];
for (const ids of components.values()) {
  if (ids.length < 2) continue;
  const members = ids.map((i) => info.get(i)).sort((a, b) => String(a.created_at) < String(b.created_at) ? -1 : 1);
  // Which fingerprints actually bind this component together. A component is
  // built only from shared fingerprints, so every holder of such a key is
  // already inside it — the `idSet` check is a cheap assertion of that.
  const idSet = new Set(ids);
  const sharedByAll = [...new Set(members.flatMap((m) => m.fingerprints))]
    .filter((k) => new Set(byFingerprint.get(k) || []).size > 1 && (byFingerprint.get(k) || []).every((x) => idSet.has(x)));
  const scalars = members.map((m) => m.scalar_fingerprint);
  const times = members.map((m) => (m.created_at ? new Date(m.created_at).getTime() : null)).filter((t) => t != null).sort((a, b) => a - b);
  const spreadMs = times.length > 1 ? times[times.length - 1] - times[0] : null;
  groups.push({
    key: sharedByAll.sort()[0] || scalars.find(Boolean) || members[0].id,
    size: members.length,
    shared_fingerprints: sharedByAll.sort(),
    /** True when the legacy scalar already caught this group; false means the
     *  set matching is the only thing that sees it (the cross-form catch). */
    caught_by_scalar: scalars.every(Boolean) && new Set(scalars).size === 1,
    /** All members created within 5s of one another = a concurrency race
     *  between parallel importers, not a missing check. */
    race: spreadMs != null && spreadMs <= 5000,
    spread_ms: spreadMs,
    any_visible: members.some((m) => m.visible),
    members,
  });
}
groups.sort((a, b) => b.size - a.size || String(a.key).localeCompare(String(b.key)));

const stats = {
  scanned,
  groups: groups.length,
  docs: groups.reduce((a, g) => a + g.size, 0),
  caught_by_scalar: groups.filter((g) => g.caught_by_scalar).length,
  cross_form_only: groups.filter((g) => !g.caught_by_scalar).length,
  concurrency_races: groups.filter((g) => g.race).length,
  groups_with_a_visible_member: groups.filter((g) => g.any_visible).length,
};

// ---- detector mode --------------------------------------------------------
if (DETECT || UPDATE) {
  const current = groups.map((g) => g.members.map((m) => m.id).sort().join('+')).sort();
  if (UPDATE) {
    fs.mkdirSync(path.dirname(BASELINE), { recursive: true });
    fs.writeFileSync(BASELINE, JSON.stringify({ generated_at: new Date().toISOString(), stats, groups: current }, null, 2));
    console.log(`baseline written: ${BASELINE} (${current.length} groups)`);
    await mc.close();
    process.exit(0);
  }
  if (!fs.existsSync(BASELINE)) {
    console.error(`no baseline at ${BASELINE} — run with --update-baseline first`);
    await mc.close();
    process.exit(2);
  }
  const known = new Set(JSON.parse(fs.readFileSync(BASELINE, 'utf8')).groups);
  const fresh = current.filter((g) => !known.has(g));
  console.log(JSON.stringify(stats));
  if (fresh.length > 0) {
    console.error(`NEW same-fingerprint group(s) since the baseline: ${fresh.length}`);
    for (const g of fresh.slice(0, 25)) {
      const grp = groups.find((x) => x.members.map((m) => m.id).sort().join('+') === g);
      console.error(`  ${grp.key}  [${grp.race ? 'RACE' : 'gate-miss'}]  ${grp.members.map((m) => `${m.id} "${String(m.title).slice(0, 45)}"`).join(' | ')}`);
    }
    console.error('These were NOT merged or hidden — a human decides. Re-baseline with --update-baseline once reviewed.');
    await mc.close();
    process.exit(2);
  }
  console.log('no new same-fingerprint groups');
  await mc.close();
  process.exit(0);
}

// ---- report mode ----------------------------------------------------------
const stamp = new Date().toISOString().slice(0, 10);
const base = OUT || path.join(OUT_DIR, `duplicate-fingerprint-groups-${stamp}`);
fs.mkdirSync(path.dirname(base), { recursive: true });
fs.writeFileSync(`${base}.json`, JSON.stringify({ generated_at: new Date().toISOString(), stats, groups }, null, 2));

const md = [];
md.push(`# Same-fingerprint duplicate groups in \`books\` — ${stamp}`);
md.push('');
md.push('Snapshot, not doctrine. **Nothing here has been merged, hidden, or deleted** —');
md.push('this is a list for a human to decide over. Regenerate with');
md.push('`node scripts/audit/duplicate-fingerprint-groups.mjs`.');
md.push('');
md.push('| metric | value |');
md.push('| --- | --- |');
for (const [k, v] of Object.entries(stats)) md.push(`| ${k} | ${v} |`);
md.push('');
md.push('`cross_form_only` = the group is invisible to the legacy scalar `source_fingerprint`');
md.push('(the same object under two identifier forms). `concurrency_races` = every member was');
md.push('created within 5 seconds, i.e. parallel importers each passed the check before any inserted.');
md.push('');
for (const g of groups) {
  md.push(`### ${g.key}  (${g.size} records)`);
  const tags = [g.caught_by_scalar ? 'scalar-visible' : 'cross-form only', g.race ? 'concurrency race' : `spread ${g.spread_ms == null ? '?' : Math.round(g.spread_ms / 86400000) + 'd'}`, g.any_visible ? 'has a VISIBLE member' : 'all hidden'];
  md.push(`_${tags.join(' · ')}_`);
  md.push('');
  md.push('| id | title | provider | year | visible | pages | ocr | created | scalar fingerprint |');
  md.push('| --- | --- | --- | --- | --- | --- | --- | --- | --- |');
  for (const m of g.members) {
    md.push(`| \`${m.id}\` | ${String(m.title || '').replace(/\|/g, '\\|').slice(0, 70)} | ${m.provider || ''} | ${m.year ?? m.published ?? ''} | ${m.visible ? 'yes' : 'no'} | ${m.pages_count} | ${m.pages_ocr} | ${m.created_at ? new Date(m.created_at).toISOString().slice(0, 10) : ''} | \`${m.scalar_fingerprint || ''}\` |`);
  }
  md.push('');
}
fs.writeFileSync(`${base}.md`, md.join('\n'));

console.log(JSON.stringify(stats, null, 2));
console.log(`\nwrote ${base}.json`);
console.log(`wrote ${base}.md`);
await mc.close();
