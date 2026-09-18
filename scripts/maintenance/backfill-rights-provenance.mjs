#!/usr/bin/env node
/**
 * Rights provenance backfill — writes `image_source.rights_normalized` (canonical class +
 * raw statement + per-field provenance) for every readable book, and re-reads
 * the holding library's manifest for the ones whose stored licence is 'unknown'.
 *
 * PRIOR ART: scripts/maintenance/backfill-image-licenses.mjs — overwrites
 * image_source.license with a truncated string (destroys the raw value), maps
 * three URI families, has no checkpoint, no per-host rate limit, and records
 * "no rights field" only as a console line, so a re-run cannot tell "manifest
 * silent" from "never looked at". This script never touches
 * image_source.license; it adds image_source.rights_normalized beside it.
 *
 * Two lanes (ops rights/corpus-rights-classification-2026-09-18.md, order of work 1–2):
 *   stored    every readable book with image_source: fold the importer's stored
 *             license / license_url / attribution into image_source.rights_normalized
 *             (source: importer-license-field). No network.
 *   manifest  every readable book whose rights.class is still 'unknown' and
 *             that has a manifest (or, for SLUB, an OAI METS record): fetch it
 *             and read license/rights/requiredStatement/attribution/metadata.
 *             Outcomes are DISTINCT: stated | manifest-silent | fetch-failed |
 *             no-manifest | stated-from-import (fetch failed today, but the
 *             importer captured the manifest's own field at import time —
 *             labelled as such, never silently promoted).
 *
 * Bulk runs go on Hetzner (import-cost-and-egress.md), one host at a time with
 * a per-host interval, hosts in parallel. Gallica blocks datacenter IPs → run
 * `--provider gallica` from the laptop. Harvard 429s every path today.
 *
 *   node --env-file=.env.production.local scripts/maintenance/backfill-rights-provenance.mjs --lane stored --plan
 *   node --env-file=.env.production.local scripts/maintenance/backfill-rights-provenance.mjs --lane manifest --provider mdz --limit 5 --plan
 *   node --env-file=.env.production.local scripts/maintenance/backfill-rights-provenance.mjs --lane all --write --out scripts/output/rights-backfill.jsonl
 *
 * Flags: --lane stored|manifest|all (default all) · --plan (default) | --write ·
 *        --provider a,b · --exclude-provider a,b · --limit N · --out FILE (JSONL,
 *        doubles as checkpoint: ids already in it are skipped) · --force (re-read
 *        books that already have rights.status=stated) · --concurrency N hosts
 *        (default 6) · --host-interval MS between requests to one host (default 400)
 *        · --all-books (include hidden / artwork; default = visible && pages_count>0)
 *        · --per-host N (sample at most N books per manifest host — smoke runs)
 *
 * Sweep rows: one `sweep_log` row per manifest-lane book (sweep
 * 'rights-provenance-2026-09'); the stored lane writes none — its provenance is
 * the field itself (class_from). Field-sprawl: image_source is an existing
 * top-level key; nothing new at top level.
 */
import { MongoClient } from 'mongodb';
import { appendFileSync, existsSync, readFileSync } from 'node:fs';
import { recordSweepAction } from '../lib/sweep-log.mjs';
import { readManifestRights, readMetsRights, classifyStored, commercialUse } from '../lib/rights-normalize.mjs';

const args = process.argv.slice(2);
const flag = (n) => args.includes(`--${n}`);
const opt = (n, d) => { const i = args.indexOf(`--${n}`); return i >= 0 && args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1] : d; };

const WRITE = flag('write');
const LANE = opt('lane', 'all');
const PROVIDERS = opt('provider', '') ? opt('provider').split(',') : null;
const EXCLUDE = opt('exclude-provider', '') ? opt('exclude-provider').split(',') : [];
const LIMIT = parseInt(opt('limit', '0'), 10) || 0;
const OUT = opt('out', null);
const FORCE = flag('force');
const CONCURRENCY = parseInt(opt('concurrency', '6'), 10);
const HOST_INTERVAL = parseInt(opt('host-interval', '400'), 10);
const ALL_BOOKS = flag('all-books');
const PER_HOST = parseInt(opt('per-host', '0'), 10) || 0; // sampling: at most N books per host (spot-checks, smoke runs)
const SWEEP = 'rights-provenance-2026-09';
const UA = 'SourceLibrary/1.0 (https://sourcelibrary.org; rights-provenance backfill; derek@sourcelibrary.org)';

if (!process.env.MONGODB_URI) { console.error('MONGODB_URI not set'); process.exit(1); }
console.log(`${WRITE ? 'WRITE' : 'PLAN (no writes; add --write)'} · lane=${LANE} · providers=${PROVIDERS?.join(',') || 'all'}${EXCLUDE.length ? ' minus ' + EXCLUDE.join(',') : ''} · limit=${LIMIT || 'none'} · out=${OUT || '-'}`);

const client = new MongoClient(process.env.MONGODB_URI, { maxPoolSize: 8, ignoreUndefined: true }); // undefined raw sub-fields are omitted, not stored as null
await client.connect();
const db = client.db(process.env.MONGODB_DB || 'bookstore');
const books = db.collection('books');

const scope = ALL_BOOKS ? { image_source: { $exists: true } } : { visible: true, pages_count: { $gt: 0 }, image_source: { $exists: true } };
if (PROVIDERS) scope['image_source.provider'] = { $in: PROVIDERS };
if (EXCLUDE.length) scope['image_source.provider'] = { ...(scope['image_source.provider'] || {}), $nin: EXCLUDE };

const done = new Set();
if (OUT && existsSync(OUT)) {
  for (const line of readFileSync(OUT, 'utf8').split('\n')) { if (!line) continue; try { done.add(JSON.parse(line).id); } catch {} }
  console.log(`checkpoint: ${done.size} ids already in ${OUT}`);
}
const emit = (row) => { if (OUT) appendFileSync(OUT, JSON.stringify(row) + '\n'); };
const tally = {};
const count = (prov, status, cls) => { const k = `${prov}\t${status}\t${cls}`; tally[k] = (tally[k] || 0) + 1; };
const now = () => new Date().toISOString();

// ── Lane 1: stored value → canonical class ──────────────────────────────────
if (LANE === 'stored' || LANE === 'all') {
  const q = { ...scope };
  if (!FORCE) q['image_source.rights_normalized'] = { $exists: false };
  const cursor = books.find(q, { projection: { id: 1, image_source: 1 } });
  let n = 0, written = 0;
  const ops = [];
  const flush = async () => { if (!ops.length) return; const r = await books.bulkWrite(ops, { ordered: false }); written += r.modifiedCount; ops.length = 0; };
  for await (const b of cursor) {
    if (LIMIT && n >= LIMIT) break;
    n++;
    const s = b.image_source || {};
    const r = classifyStored({ license: s.license, license_url: s.license_url, attribution: s.attribution, rights: s.rights, provider: s.provider });
    const doc = { ...r, source: 'importer-license-field', manifest_url: null, read_at: now() };
    count(s.provider || 'null', `stored:${r.status}`, r.class);
    if (WRITE) { ops.push({ updateOne: { filter: { _id: b._id }, update: { $set: { 'image_source.rights_normalized': doc } } } }); if (ops.length >= 500) await flush(); }
  }
  await flush();
  console.log(`\nstored lane: ${n} books classified from the importer's stored value${WRITE ? `, ${written} written` : ''}`);
}

// ── Lane 2: manifest re-read for the still-unknown ─────────────────────────
function fetchPlan(s) {
  const man = typeof s.iiif_manifest === 'string' && /^https?:/.test(s.iiif_manifest) ? s.iiif_manifest : null;
  const src = typeof s.source_url === 'string' && /^https?:/.test(s.source_url) ? s.source_url : null;
  if (s.provider === 'slub_dresden') {
    const m = (man || src || '').match(/digital\.slub-dresden\.de\/(?:id)?(\d+)/);
    if (m) return { kind: 'mets', url: `https://digital.slub-dresden.de/oai?verb=GetRecord&metadataPrefix=mets&identifier=oai:de:slub-dresden:db:id-${m[1]}` };
    return null;
  }
  if (s.provider === 'harvard' && src && /nrs\.lib\.harvard\.edu\/.*MANIFEST/i.test(src)) return { kind: 'iiif', url: src };
  if (man) return { kind: 'iiif', url: man };
  if (src && /manifest/i.test(src)) return { kind: 'iiif', url: src };
  return null;
}

const sleep = (ms) => new Promise(r => setTimeout(r, ms));
async function fetchOnce(url, kind) {
  const r = await fetch(url, { headers: { 'User-Agent': UA, Accept: kind === 'mets' ? 'application/xml, text/xml' : 'application/ld+json, application/json;q=0.9, */*;q=0.1' }, redirect: 'follow', signal: AbortSignal.timeout(25000) });
  const text = await r.text();
  return { status: r.status, text };
}
// Per-host circuit breaker: after 3 consecutive 429/403 answers a host is not asked again this run —
// every remaining book on it goes straight to fetch-failed / stated-from-import (Harvard 429s every
// path from every IP today; without this each of its 757 books would burn two 30 s waits).
const hostStrikes = new Map();
const BREAKER_AT = 3;
async function fetchManifest(plan) {
  const host = new URL(plan.url).host;
  if ((hostStrikes.get(host) || 0) >= BREAKER_AT) return { http_status: null, error: `host-tripped (${BREAKER_AT}× 429/403 earlier this run)` };
  let last = null;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const { status, text } = await fetchOnce(plan.url, plan.kind);
      if (status === 429 || status === 403 || status >= 500) {
        last = { http_status: status, error: `HTTP ${status}` };
        if (status === 429 || status === 403) { hostStrikes.set(host, (hostStrikes.get(host) || 0) + 1); if (hostStrikes.get(host) >= BREAKER_AT) { console.log(`  ${host}: breaker tripped after ${BREAKER_AT} ${status}s`); return last; } }
        await sleep(status === 429 ? 15000 : 5000); continue;
      }
      hostStrikes.set(host, 0);
      if (status !== 200) return { http_status: status, error: `HTTP ${status}` };
      if (plan.kind === 'mets') return { http_status: 200, mets: text };
      try { return { http_status: 200, manifest: JSON.parse(text) }; }
      catch { return { http_status: 200, error: 'not-json' }; }
    } catch (e) { last = { http_status: null, error: e.name === 'TimeoutError' ? 'timeout' : (e.cause?.code || e.message).slice(0, 120) }; await sleep(3000); }
  }
  return last;
}

if (LANE === 'manifest' || LANE === 'all') {
  const q = { ...scope };
  if (!FORCE) q.$or = [{ 'image_source.rights_normalized': { $exists: false } }, { 'image_source.rights_normalized.class': 'unknown' }, { 'image_source.rights_normalized.status': { $in: ['fetch-failed', 'stated-from-import'] } }];
  const list = await books.find(q, { projection: { id: 1, title: 1, image_source: 1 } }).toArray();
  // a book with no rights_normalized yet (stored lane not run) only belongs here if its stored value is unknown
  const stillUnknown = (b) => FORCE || b.image_source?.rights_normalized ? true : classifyStored({ license: b.image_source?.license, license_url: b.image_source?.license_url, attribution: b.image_source?.attribution, rights: b.image_source?.rights, provider: b.image_source?.provider }).class === 'unknown';
  const todo = list.filter(b => !done.has(b.id) && stillUnknown(b)).slice(0, PER_HOST ? undefined : (LIMIT || undefined));
  console.log(`\nmanifest lane: ${list.length} candidates, ${todo.length} to do`);

  // group by host so each host is sequential with an interval; hosts run in parallel
  const byHost = new Map();
  for (const b of todo) {
    const plan = fetchPlan(b.image_source || {});
    const host = plan ? new URL(plan.url).host : '(no-manifest)';
    if (!byHost.has(host)) byHost.set(host, []);
    byHost.get(host).push({ b, plan });
  }
  if (PER_HOST) for (const [h, l] of byHost) byHost.set(h, l.slice(0, PER_HOST));
  console.log([...byHost.entries()].map(([h, l]) => `  ${h}: ${l.length}`).join('\n'));
  const total = [...byHost.values()].reduce((a, l) => a + l.length, 0);

  let processed = 0;
  async function handle({ b, plan }) {
    const s = b.image_source || {};
    const prov = s.provider || 'null';
    let doc, row;
    if (!plan) {
      doc = { class: 'unknown', statement_uri: null, class_from: null, attribution_required: s.attribution ? String(s.attribution) : null, attribution_from: s.attribution ? 'image_source.attribution' : null, terms_text: null, raw: { license: s.license, license_url: s.license_url || undefined, attribution: s.attribution || undefined }, status: 'no-manifest', source: 'importer-license-field', manifest_url: null, read_at: now() };
    } else {
      const res = await fetchManifest(plan);
      if (res.manifest || res.mets) {
        const r = res.mets ? readMetsRights(res.mets) : readManifestRights(res.manifest);
        doc = { ...r, source: res.mets ? 'oai-mets' : 'iiif-manifest', manifest_url: plan.url, read_at: now(), http_status: 200 };
      } else {
        // fetch failed: fall back to what the importer captured from the manifest at import time, labelled as such
        const fb = classifyStored({ license: s.license, license_url: s.license_url, attribution: s.attribution, rights: s.rights, provider: s.provider }, { captured: true });
        if (fb.class !== 'unknown') {
          doc = { ...fb, class_from: `${fb.class_from} (manifest re-read failed: ${res.error})`, status: 'stated-from-import', source: 'importer-captured-manifest-field', manifest_url: plan.url, read_at: now(), http_status: res.http_status, error: res.error };
        } else {
          doc = { ...fb, status: 'fetch-failed', source: 'iiif-manifest', manifest_url: plan.url, read_at: now(), http_status: res.http_status, error: res.error };
        }
      }
    }
    row = { id: b.id, provider: prov, status: doc.status, class: doc.class, commercial: commercialUse(doc.class), class_from: doc.class_from, statement_uri: doc.statement_uri, attribution_required: doc.attribution_required, manifest_url: doc.manifest_url, http_status: doc.http_status, error: doc.error, title: (b.title || '').slice(0, 60) };
    if (WRITE) {
      const r = await books.updateOne({ _id: b._id }, { $set: { 'image_source.rights_normalized': doc } });
      if (r.matchedCount !== 1) throw new Error(`book ${b.id} vanished mid-run`);
      await recordSweepAction(db, { sweep: SWEEP, book_id: b.id, action: doc.status, detail: { class: doc.class, class_from: doc.class_from, provider: prov, manifest_url: doc.manifest_url, http_status: doc.http_status ?? null, error: doc.error ?? null } });
    }
    emit(row);
    count(prov, doc.status, doc.class);
    processed++;
    if (processed % 100 === 0) console.log(`  ${now()} ${processed}/${total}`);
  }

  const hosts = [...byHost.entries()].sort((a, b) => b[1].length - a[1].length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, hosts.length) }, async () => {
    while (next < hosts.length) {
      const [host, items] = hosts[next++];
      for (const it of items) {
        const t0 = Date.now();
        try { await handle(it); } catch (e) { console.error(`  ${host} ${it.b.id}: ${e.message}`); emit({ id: it.b.id, provider: it.b.image_source?.provider, status: 'script-error', error: e.message }); }
        const wait = HOST_INTERVAL - (Date.now() - t0);
        if (wait > 0 && host !== '(no-manifest)') await sleep(wait);
      }
    }
  }));
  console.log(`manifest lane: ${processed} processed`);
}

console.log('\nprovider\tstatus\tclass\tn');
for (const [k, n] of Object.entries(tally).sort((a, b) => b[1] - a[1])) console.log(`${k}\t${n}`);
await client.close();
