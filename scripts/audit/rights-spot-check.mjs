#!/usr/bin/env node
/**
 * Rights spot-check — one book per provider, our stored classification beside
 * the holding library's manifest as it reads TODAY, raw fields verbatim, so a
 * human can judge each provider by eye.
 *
 * PRIOR ART: none — scripts/audit/ has no rights check; the classification
 * measurement lived in ops rights/corpus-rights-classification-2026-09-18.md
 * with a single spot-check (Bodleian). The failure mode is per-importer, so
 * one book per PROVIDER is the right sample shape, not a random 1%.
 *
 * For each provider with readable books it picks the first book (by id) that
 * carries image_source.rights_normalized and a fetchable manifest (SLUB: OAI
 * METS), re-fetches it, and prints:
 *   stored image_source.license · rights_normalized.class / class_from / status
 *   · what a fresh read of the manifest classifies to · AGREE / DIFFER
 *   · the manifest's rights, license, requiredStatement, attribution and
 *     rights-labelled metadata, verbatim (capped)
 *
 *   node --env-file=.env.production.local scripts/audit/rights-spot-check.mjs --out scripts/output/rights-spot-check.md
 * Flags: --provider a,b · --out FILE (markdown; default stdout) · --prefer-manifest
 *        (pick a book whose class came from a manifest read, default) ·
 *        --prefer-stored (pick one whose class came from the stored value —
 *        tests whether the IMPORTER's value matches the manifest)
 */
import { MongoClient } from 'mongodb';
import { writeFileSync } from 'node:fs';
import { readManifestRights, readMetsRights, langValue, stripHtml, commercialUse } from '../lib/rights-normalize.mjs';

const args = process.argv.slice(2);
const opt = (n, d) => { const i = args.indexOf(`--${n}`); return i >= 0 && args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1] : d; };
const PROVIDERS = opt('provider', '') ? opt('provider').split(',') : null;
const OUT = opt('out', null);
const PREFER_STORED = args.includes('--prefer-stored');
const UA = 'SourceLibrary/1.0 (https://sourcelibrary.org; rights spot-check; derek@sourcelibrary.org)';

const client = new MongoClient(process.env.MONGODB_URI, { maxPoolSize: 4 });
await client.connect();
const books = client.db(process.env.MONGODB_DB || 'bookstore').collection('books');
const READABLE = { visible: true, pages_count: { $gt: 0 }, 'image_source.rights_normalized': { $exists: true } };

function fetchPlan(s) {
  const man = typeof s.iiif_manifest === 'string' && /^https?:/.test(s.iiif_manifest) ? s.iiif_manifest : null;
  const src = typeof s.source_url === 'string' && /^https?:/.test(s.source_url) ? s.source_url : null;
  if (s.provider === 'slub_dresden') { const m = (man || src || '').match(/digital\.slub-dresden\.de\/(?:id)?(\d+)/); return m ? { kind: 'mets', url: `https://digital.slub-dresden.de/oai?verb=GetRecord&metadataPrefix=mets&identifier=oai:de:slub-dresden:db:id-${m[1]}` } : null; }
  if (s.provider === 'harvard' && src && /nrs\.lib\.harvard\.edu\/.*MANIFEST/i.test(src)) return { kind: 'iiif', url: src };
  if (man) return { kind: 'iiif', url: man };
  if (src && /manifest/i.test(src)) return { kind: 'iiif', url: src };
  return null;
}

const providers = PROVIDERS || (await books.distinct('image_source.provider', READABLE)).filter(Boolean).sort();
const rows = [], details = [];
for (const prov of providers) {
  const base = { ...READABLE, 'image_source.provider': prov };
  const fromManifest = { 'image_source.rights_normalized.source': { $in: ['iiif-manifest', 'oai-mets'] } };
  const fromStored = { 'image_source.rights_normalized.source': 'importer-license-field' };
  const proj = { projection: { id: 1, title: 1, image_source: 1 } };
  let b = await books.findOne({ ...base, ...(PREFER_STORED ? fromStored : fromManifest), 'image_source.iiif_manifest': { $regex: '^http' } }, { ...proj, sort: { id: 1 } })
    || await books.findOne({ ...base, 'image_source.iiif_manifest': { $regex: '^http' } }, { ...proj, sort: { id: 1 } })
    || await books.findOne(base, { ...proj, sort: { id: 1 } });
  if (!b) continue;
  const s = b.image_source || {}, rn = s.rights_normalized || {};
  const plan = fetchPlan(s);
  let fresh = null, raw = null, http = null, err = null;
  if (plan) {
    try {
      const r = await fetch(plan.url, { headers: { 'User-Agent': UA, Accept: plan.kind === 'mets' ? 'application/xml' : 'application/ld+json, application/json;q=0.9, */*;q=0.1' }, signal: AbortSignal.timeout(25000) });
      http = r.status;
      const text = await r.text();
      if (r.ok) {
        if (plan.kind === 'mets') { fresh = readMetsRights(text); raw = fresh.raw; }
        else { const m = JSON.parse(text); fresh = readManifestRights(m); raw = { rights: m.rights, license: m.license, attribution: langValue(m.attribution), requiredStatement: m.requiredStatement ? `${langValue(m.requiredStatement.label)}: ${langValue(m.requiredStatement.value)}` : undefined, metadata: (m.metadata || []).map(e => [langValue(e.label), langValue(e.value)]).filter(([l]) => l && /right|licen|copyright|usage|terms|nutzung|access|attribution|credit|diritti|licencia/i.test(l)).map(([l, v]) => `${l}: ${stripHtml(v ?? '')}`) }; }
      } else err = `HTTP ${r.status}`;
    } catch (e) { err = e.name === 'TimeoutError' ? 'timeout' : (e.cause?.code || e.message).slice(0, 80); }
  } else err = 'no manifest';
  const verdict = !fresh ? (err || '?') : (fresh.class === rn.class ? 'AGREE' : `DIFFER (fresh: ${fresh.class})`);
  const n = await books.countDocuments(base);
  rows.push({ prov, n, id: b.id, title: (b.title || '').slice(0, 50), stored: s.license, cls: rn.class, from: rn.class_from, status: rn.status, verdict, url: plan?.url });
  details.push(`### ${prov} — ${b.id}\n**${(b.title || '').slice(0, 120)}**  \nmanifest: ${plan?.url || '—'} ${http ? `(HTTP ${http})` : ''} ${err ? `— ${err}` : ''}\n\n| field | value |\n|---|---|\n| stored image_source.license | \`${s.license}\` |\n| stored license_url | ${s.license_url || '—'} |\n| stored attribution | ${s.attribution ? stripHtml(s.attribution).slice(0, 200) : '—'} |\n| rights_normalized.class | **${rn.class}** (${commercialUse(rn.class)}) |\n| class_from | ${rn.class_from || '—'} |\n| status / source | ${rn.status} / ${rn.source} |\n| attribution_required | ${rn.attribution_required || '—'} |\n| terms_text | ${rn.terms_text || '—'} |\n| fresh read today | ${fresh ? `${fresh.class} from ${fresh.class_from || '—'}` : err} |\n\nManifest, verbatim (rights-related fields only):\n\`\`\`json\n${JSON.stringify(raw ?? { error: err }, null, 1).slice(0, 1800)}\n\`\`\`\n`);
  process.stderr.write(`${prov.padEnd(20)} ${String(rn.class).padEnd(14)} ${verdict}\n`);
}

const table = ['| provider | books | book | stored license | class | class_from | status | fresh read |', '|---|---|---|---|---|---|---|---|',
  ...rows.map(r => `| ${r.prov} | ${r.n} | [${r.id.slice(0, 8)}](https://sourcelibrary.org/book/${r.id}) | \`${r.stored}\` | **${r.cls}** | ${r.from || '—'} | ${r.status} | ${r.verdict} |`)].join('\n');
const md = `# Rights spot-check — one book per provider, ${new Date().toISOString().slice(0, 10)}\n\nGenerated by \`scripts/audit/rights-spot-check.mjs\`. "fresh read" re-fetches the manifest now and classifies it again; AGREE means it lands on the stored class. The verbatim manifest fields below are for a human to judge — the classifier can be wrong in ways that agree with itself.\n\n${table}\n\n## Details\n\n${details.join('\n')}`;
if (OUT) { writeFileSync(OUT, md); console.error(`wrote ${OUT}`); } else console.log(md);
await client.close();
