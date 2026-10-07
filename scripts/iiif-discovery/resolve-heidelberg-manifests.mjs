#!/usr/bin/env node
/**
 * PRIOR ART: scripts/catalog-coverage/harvest-oai-libraries.mjs (the harvester that WROTE these rows — it
 *   builds the Heidelberg manifest URL from the numeric OAI id, which is the bug; re-running it would
 *   re-upsert every field of 16K rows to fix one); scripts/iiif-discovery/harvest-manifests.mjs (stage 2 —
 *   it fetches manifest_url as given, so it cannot repair one). Neither resolves an id to its real manifest.
 *
 * Repair `import_candidates.manifest_url` for source:heidelberg (#5457).
 *
 * harvest-oai-libraries.mjs built every Heidelberg URL as
 *   https://digi.ub.uni-heidelberg.de/diglit/iiif3/<numeric oai id>/manifest.json
 * which answers 400 "Bad request syntax" — Heidelberg addresses manifests by SLUG (cpg1, salXII5), not by
 * the OAI number. Measured 2026-10-01: all 15,083 discovered heidelberg candidates carry the numeric form,
 * so stage 2 would have errored on every one. The OAI record (oai_dc, ~2 KB) names the real manifest in
 * `dc:hasFormat`, plus `dc:rights`, `dc:title` and `dc:language`.
 *
 * Writes only to the staging collection: manifest_url (the broken one is kept in manifest_url_numeric),
 * rights (when the record has one), title when blank, heidelberg_resolved_at (the resume marker). A record
 * whose manifest lives on another portal (archivum-laureshamense-digital.de, the Lorsch charters) is
 * resolved the same way — the URL is whatever Heidelberg's own record says.
 *
 * Polite by construction: serial, one request per --delay-ms (default 1000), contact-carrying user agent.
 *
 *   node --env-file=.env.production.local scripts/iiif-discovery/resolve-heidelberg-manifests.mjs --limit=20 --dry-run
 *   node --env-file=.env.production.local scripts/iiif-discovery/resolve-heidelberg-manifests.mjs
 */
import { getScriptClient } from '../lib/mongo.mjs';

const args = Object.fromEntries(process.argv.slice(2).filter(a => a.startsWith('--')).map(a => { const [k, v] = a.slice(2).split('='); return [k, v ?? true]; }));
const LIMIT = parseInt(args.limit) || 0;
const DELAY = parseInt(args['delay-ms']) || 1000;
const DRY = 'dry-run' in args;
const UA = 'SourceLibrary/1.0 (https://sourcelibrary.org; j.d.lomas@tudelft.nl)';
const OAI = 'https://digi.ub.uni-heidelberg.de/cgi-bin/digioai.cgi';
const sleep = ms => new Promise(r => setTimeout(r, ms));
const unxml = s => s.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").trim();
const all = (xml, tag) => [...xml.matchAll(new RegExp(`<${tag}>([^<]*)</${tag}>`, 'g'))].map(m => unxml(m[1]));

async function getRecord(oaiId) {
  for (let t = 0; t < 4; t++) {
    try {
      const r = await fetch(`${OAI}?verb=GetRecord&metadataPrefix=oai_dc&identifier=${encodeURIComponent(oaiId)}`, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(30000) });
      if (r.status === 429 || r.status >= 500) { await sleep(DELAY * 5 * (t + 1)); continue; }
      if (!r.ok) return { error: `http ${r.status}` };
      const xml = await r.text();
      if (/<error code=/.test(xml)) return { error: (xml.match(/<error code='?"?([^'"]+)/) || [])[1] || 'oai-error' };
      return { xml };
    } catch (e) { await sleep(DELAY * 3 * (t + 1)); }
  }
  return { error: 'fetch-failed' };
}

const { client, db } = await getScriptClient({ noTimeout: true });
const col = db.collection('import_candidates');
const filter = { source: 'heidelberg', status: 'discovered', heidelberg_resolved_at: { $exists: false } };
const total = await col.countDocuments(filter);
const cur = col.find(filter, { projection: { oai_id: 1, manifest_url: 1, title: 1, language: 1 } }).sort({ _id: 1 });
console.log(`[resolve-heidelberg] ${total} unresolved candidates${LIMIT ? `, limit ${LIMIT}` : ''}${DRY ? ' (dry run)' : ''}, 1 req / ${DELAY}ms`);

let n = 0, ok = 0, noManifest = 0, err = 0, dupUrl = 0;
const hosts = {};
for await (const c of cur) {
  if (LIMIT && n >= LIMIT) break;
  n++;
  const res = await getRecord(c.oai_id);
  await sleep(DELAY);
  if (res.error) { err++; if (err <= 10) console.log(`  [err] ${c.oai_id} → ${res.error}`); continue; }
  const manifests = all(res.xml, 'dc:hasFormat').filter(u => /manifest/.test(u));
  const set = { heidelberg_resolved_at: new Date() };
  const rights = all(res.xml, 'dc:rights')[0];
  if (rights) set.rights = rights;
  const title = all(res.xml, 'dc:title')[0];
  if ((!c.title || !c.title.trim()) && title) set.title = title.slice(0, 500);
  if (manifests.length) {
    set.manifest_url = manifests[0];
    set.manifest_url_numeric = c.manifest_url;
    try { hosts[new URL(manifests[0]).hostname] = (hosts[new URL(manifests[0]).hostname] || 0) + 1; } catch {}
  } else {
    noManifest++;
    set.heidelberg_resolve_note = 'no dc:hasFormat manifest in the OAI record';
  }
  if (DRY) { if (n <= 20) console.log(`  ${c.oai_id} → ${set.manifest_url || '(none)'} | ${rights || '-'} | ${(set.title || c.title || '').slice(0, 60)}`); ok++; continue; }
  try { await col.updateOne({ _id: c._id }, { $set: set }); ok++; }
  catch (e) {
    // manifest_url is unique: the resolved URL may already belong to another candidate (a duplicate row).
    if (/E11000/.test(e.message)) { dupUrl++; await col.updateOne({ _id: c._id }, { $set: { heidelberg_resolved_at: set.heidelberg_resolved_at, heidelberg_resolve_note: `duplicate of candidate with manifest ${manifests[0]}` } }); }
    else throw e;
  }
  if (n % 250 === 0) console.log(`  ${new Date().toISOString().slice(11, 19)} ${n}/${total} resolved ${ok}, no-manifest ${noManifest}, dup ${dupUrl}, err ${err} | hosts ${JSON.stringify(hosts)}`);
}
console.log(`[resolve-heidelberg] done: ${n} looked up, ${ok} written, ${noManifest} without a manifest, ${dupUrl} duplicate URLs, ${err} errors | hosts ${JSON.stringify(hosts)}`);
await client.close();
