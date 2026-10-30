#!/usr/bin/env node
// PRIOR ART: scripts/maintenance/import-concept-histories.mjs — its decodeQ() is the /q/ shortlink decoder copied here;
//   it writes the claims but knows nothing of the maps. scripts/maintenance/import-atlas-maps.mjs writes the maps but
//   knows nothing of the claims. Neither can do the join alone, and each runs without the other's source repo, so the
//   join is its own step that both call. Looked in scripts/maintenance, scripts/audit, scripts/lib for a claims→works
//   join: none.
//
// Which works on a concept's map its conceptual history cites (#7646). For every concept whose history has a map
// (index.json `map`, its sources view), each shown claim's Source Library sources (/q/<code> or /book/<id>) are decoded to a book id and
// matched against the map's editions (works[].eds[].id) and anthologies (anth[].id, whose `c` names the works it
// holds). Writes public/data/maps/<slug>-cited.json, read by the sources view, so nothing is joined at request time:
//   { concept, generated, claims, linked, works: { "<work>|||<tradition>": [[claimId, domain, statement], ...] } }
// A book the history cites that is on no edition of the map is counted (unmatched) and not shown: the map's canon is
// the frame, and a cited book outside it has no dot to light.
//
// Offline: reads only files in this repo, no Mongo. Run after either importer (both call it):
//   node scripts/maintenance/link-history-sources.mjs [--dry-run]
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const REPO = path.resolve(new URL('../..', import.meta.url).pathname);
const CONTENT = path.join(REPO, 'src/app/explore/histories/content');
const MAPS = path.join(REPO, 'public/data/maps');

// ---- shortlinks (src/lib/shortlinks.ts decodeShortlink; same as import-concept-histories.mjs) -------------------
const B62 = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';
function b62bytes(s, n) { let x = 0n; for (const ch of s) { const i = B62.indexOf(ch); if (i < 0) throw new Error(`bad base62 ${s}`); x = x * 62n + BigInt(i); } const out = new Array(n).fill(0); for (let i = n - 1; i >= 0; i--) { out[i] = Number(x & 255n); x >>= 8n; } return out; }
const hex = (b, n) => b.slice(0, n).map((x) => x.toString(16).padStart(2, '0')).join('');
function decodeQ(code) {
  if (code.length === 26 && code.startsWith('u')) { const h = hex(b62bytes(code.slice(1), 18), 16); return [h.slice(0, 8), h.slice(8, 12), h.slice(12, 16), h.slice(16, 20), h.slice(20)].join('-'); }
  return hex(b62bytes(code, 14), 12);
}
/** The book a claim source's site-relative url points at, or null. */
export function bookOf(u) {
  const m = String(u || '').match(/^\/(q|book)\/([^/?#]+)/);
  if (!m) return null;
  try { return m[1] === 'q' ? decodeQ(m[2]) : decodeURIComponent(m[2]); } catch { return null; }
}

/** A claim's statement cut to a line for the work panel; the full claim is one click away. */
const short = (s, n = 200) => { if (s.length <= n) return s; const cut = s.slice(0, n); return cut.slice(0, cut.lastIndexOf(' ')).replace(/[,;:(—–-]+$/, '') + '…'; };

export function linkHistorySources({ dryRun = false } = {}) {
  const index = JSON.parse(fs.readFileSync(path.join(CONTENT, 'index.json'), 'utf8'));
  const out = {};
  for (const c of index.concepts) {
    if (!c.map) continue;
    const slug = c.slug; // the map's slug is the concept's (src/lib/explore-maps.ts)
    const mapFile = path.join(MAPS, `${slug}.json`);
    if (!fs.existsSync(mapFile)) { console.log(`${c.slug}: map ${slug}.json not found, skipped`); continue; }
    const map = JSON.parse(fs.readFileSync(mapFile, 'utf8'));
    const key = (w) => `${w.n}|||${w.tr}`;
    const worksOf = new Map(); // book id -> work keys
    const add = (id, k) => { if (!worksOf.has(id)) worksOf.set(id, new Set()); worksOf.get(id).add(k); };
    for (const w of map.works) for (const e of w.eds || []) add(e.id, key(w));
    const byName = new Map(); for (const w of map.works) { if (!byName.has(w.n)) byName.set(w.n, []); byName.get(w.n).push(key(w)); }
    for (const a of map.anth || []) for (const n of a.c || []) for (const k of byName.get(n) || []) add(a.id, k);

    const claims = JSON.parse(fs.readFileSync(path.join(CONTENT, `${c.slug}-claims.json`), 'utf8'));
    const works = {}; let linked = 0; const unmatched = new Set();
    for (const cl of claims) {
      const hit = new Set();
      for (const s of cl.src) { const b = bookOf(s.u); if (!b) continue; const ks = worksOf.get(b); if (ks) ks.forEach((k) => hit.add(k)); else unmatched.add(b); }
      if (!hit.size) continue;
      linked++;
      for (const k of hit) (works[k] ||= []).push([cl.id, cl.d, short(cl.s)]);
    }
    const data = { concept: c.slug, generated: index.generated, claims: claims.length, linked, works };
    out[slug] = data;
    console.log(`${c.slug}: ${claims.length} claims, ${linked} cite a work on the map; ${Object.keys(works).length} of ${map.works.length} works cited; ${unmatched.size} cited books are on no edition of the map`);
    if (!dryRun) fs.writeFileSync(path.join(MAPS, `${slug}-cited.json`), JSON.stringify(data));
  }
  return out;
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) linkHistorySources({ dryRun: process.argv.includes('--dry-run') });
