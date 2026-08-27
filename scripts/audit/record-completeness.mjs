#!/usr/bin/env node
/**
 * Two questions a reader's complaint usually turns out to be:
 *
 *   1. Is this record COMPLETE where the site actually looks?
 *   2. Is this the copy the reader should have landed on?
 *
 * Both failures are invisible from the writing side. An importer fills every
 * field it knows about; a record with a provider outside `ImageSourceProvider`
 * still saves cleanly and simply never credits the holding library. A duplicate
 * with no illustrations still renders; it just isn't the copy with the plates.
 * Neither throws, neither shows up in a count of books, and both are only
 * findable by asking the READ path what it needs.
 *
 * ## Report 1 — read-path completeness
 *
 * For every live book, the fields the site branches on:
 *
 *   provider    outside `ImageSourceProvider`, or with no `LIBRARY_PARTNERS`
 *               entry ⇒ no `/libraries/<slug>` page and no credit anywhere
 *   license     a value that does not RESOLVE — neither an `IMAGE_LICENSES` id
 *               nor a `LICENSE_ALIASES` entry — so the book page shows the
 *               source's raw string. Counted against what the renderer can
 *               resolve, not against the id list: `licenseDisplay()` maps the
 *               rights-statement URIs and CC deed URLs that most sources
 *               actually record, and an audit that ignored that would report a
 *               fixed problem as broken forever. A check that cannot go green
 *               is one people learn to ignore.
 *   thumbnail   absent ⇒ no cover in any grid
 *   categories  empty ⇒ absent from every subject facet
 *
 * Grouped by provider, because these come from importers and therefore arrive
 * in provider-shaped batches — one bad importer is one row of the report.
 *
 * ## Report 2 — duplicate clusters that diverge
 *
 * Copies of ONE edition (`edition_key`), where the copies differ in how much
 * they carry. Redundancy alone is harmless; the harm is a reader landing on the
 * thinner copy, which is what "there were so many dupes and the one with the
 * picture wasn't extracted" means. So a cluster is only reported when its
 * members actually differ, and it is ranked by how much is lost by landing
 * wrong.
 *
 *   node --env-file=.env.production.local scripts/audit/record-completeness.mjs [--limit=N] [--json=path]
 */
import { MongoClient } from 'mongodb';
import { readFileSync, writeFileSync } from 'node:fs';

const arg = (n) => (process.argv.find((a) => a.startsWith(`--${n}=`)) || '').split('=').slice(1).join('=');
const LIMIT = Number(arg('limit') || 15);
const JSON_OUT = arg('json');

/**
 * Read the vocabularies out of the TypeScript rather than restating them, and
 * CHECK THE PARSE. The first version of this regex captured 18 of ~60 providers
 * because a `;` inside a trailing comment ("public-domain scores; re-host")
 * ended the lazy match — which would have reported three quarters of the corpus
 * as having an invalid provider. A parser that silently under-reads is worse
 * than no parser: it manufactures findings.
 */
function parseTs() {
  const strip = (s) => s.replace(/\/\/[^\n]*/g, '');
  const rawSrc = readFileSync('src/lib/types/image-source.ts', 'utf8');
  const src = strip(rawSrc);
  const union = src.match(/export type ImageSourceProvider\s*=([\s\S]*?);/);
  if (!union) throw new Error('could not find the ImageSourceProvider union');
  const providers = new Set([...union[1].matchAll(/'([^']+)'/g)].map((m) => m[1]));
  const licenses = new Set([...src.matchAll(/\{\s*id:\s*'([^']+)'/g)].map((m) => m[1]));
  // Everything `licenseDisplay()` can resolve, lower-cased the way it compares.
  // From the RAW source, not the comment-stripped copy. Stripping `//` to end
  // of line is fine for a union of bare identifiers and destroys this block:
  // every alias key is a URL, so `'http://creativecommons.org/…'` becomes
  // `'http:` and the parse silently loses nearly every entry. Second time in
  // this one function that a naive text transform has broken on content that
  // merely looks like syntax — the `;` inside a comment was the first.
  const aliasBlock = rawSrc.match(/const LICENSE_ALIASES[^{]*\{([\s\S]*?)\n\};/);
  if (!aliasBlock) throw new Error('could not find LICENSE_ALIASES');
  // Keys are quoted URLs (which contain ':') or bare identifiers, so match
  // both forms rather than one char class — the first attempt excluded ':'
  // and therefore missed every URL alias, i.e. nearly all of them.
  for (const m of aliasBlock[1].matchAll(/'([^']+)'\s*:/g)) licenses.add(m[1].trim().toLowerCase());
  for (const m of aliasBlock[1].matchAll(/^\s*([A-Za-z_][\w]*)\s*:/gm)) licenses.add(m[1].trim().toLowerCase());
  const partners = new Set(
    [...strip(readFileSync('src/lib/library-partners.ts', 'utf8')).matchAll(/providerKey:\s*'([^']+)'/g)].map((m) => m[1]),
  );
  // Self-check. These are lower bounds well under the real counts; if the parse
  // breaks again it fails here instead of in the findings.
  if (providers.size < 40) throw new Error(`parsed only ${providers.size} providers — the parse is broken, not the corpus`);
  if (licenses.size < 20) throw new Error(`parsed only ${licenses.size} licence ids + aliases — the parse is broken`);
  if (partners.size < 20) throw new Error(`parsed only ${partners.size} library partners`);
  return { providers, licenses, partners };
}

const { providers, licenses, partners } = parseTs();
console.log(`vocabularies: ${providers.size} providers · ${licenses.size} licences · ${partners.size} library partners\n`);

const client = new MongoClient(process.env.MONGODB_URI, { maxPoolSize: 5 });
await client.connect();
const db = client.db('bookstore');
const LIVE = { visible: true, pages_count: { $gt: 0 } };

// ── Report 1 ──────────────────────────────────────────────────────────
const books = await db.collection('books').find(LIVE)
  .project({ id: 1, title: 1, thumbnail: 1, categories: 1, image_source: 1, edition_key: 1 })
  .toArray();
console.log(`REPORT 1 — read-path completeness over ${books.length} live books\n`);

const byProvider = new Map();
for (const b of books) {
  const p = b.image_source?.provider || '(none)';
  if (!byProvider.has(p)) byProvider.set(p, { n: 0, notInUnion: 0, noPartner: 0, badLicense: 0, noThumb: 0, noCats: 0, example: null });
  const r = byProvider.get(p);
  r.n++;
  const bad = [];
  if (p === '(none)') { r.notInUnion++; bad.push('no provider'); }
  else if (!providers.has(p)) { r.notInUnion++; bad.push('provider not in union'); }
  else if (!partners.has(p)) { r.noPartner++; bad.push('no library page'); }
  const lic = b.image_source?.license;
  if (lic && !licenses.has(lic) && !licenses.has(String(lic).toLowerCase())) {
    r.badLicense++; bad.push(`license "${lic}"`);
  }
  if (!b.thumbnail) { r.noThumb++; bad.push('no cover'); }
  if (!(b.categories || []).length) { r.noCats++; bad.push('no categories'); }
  if (bad.length && !r.example) r.example = `${String(b.title).slice(0, 44)} — ${bad.join(', ')}`;
}
const rows = [...byProvider.entries()]
  .map(([p, r]) => ({ provider: p, ...r, affected: r.notInUnion + r.noPartner + r.badLicense + r.noThumb + r.noCats }))
  .filter((r) => r.affected > 0)
  .sort((a, b) => b.affected - a.affected);
console.log('provider           books   !union  !partner  !licence  !cover  !cats');
for (const r of rows.slice(0, 22)) {
  console.log(
    `${r.provider.padEnd(18)} ${String(r.n).padStart(5)}  ${String(r.notInUnion).padStart(6)}  ${String(r.noPartner).padStart(8)}  ` +
    `${String(r.badLicense).padStart(8)}  ${String(r.noThumb).padStart(6)}  ${String(r.noCats).padStart(5)}`);
}
const tot = (k) => rows.reduce((s, r) => s + r[k], 0);
console.log(`\nTOTALS  provider unusable ${tot('notInUnion')} · no library page ${tot('noPartner')} · bad licence id ${tot('badLicense')} · no cover ${tot('noThumb')} · no categories ${tot('noCats')}`);

// ── Report 2 ──────────────────────────────────────────────────────────
console.log('\n\nREPORT 2 — duplicate clusters whose copies DIFFER\n');
const all = await db.collection('books')
  .find({ edition_key: { $exists: true, $nin: [null, ''] } })
  .project({ id: 1, title: 1, edition_key: 1, visible: 1, pages_count: 1, pages_ocr: 1, pages_translated: 1, detected_images_count: 1, 'image_source.provider': 1 })
  .toArray();
const clusters = new Map();
for (const b of all) {
  if (!clusters.has(b.edition_key)) clusters.set(b.edition_key, []);
  clusters.get(b.edition_key).push(b);
}
const content = (b) => ({
  pages: b.pages_count || 0,
  ocr: b.pages_ocr || 0,
  imgs: b.detected_images_count || 0,
  tr: b.pages_translated || 0,
});
/** How much a reader loses by landing on `got` instead of the best copy. */
function shortfall(best, got) {
  const B = content(best), G = content(got);
  return (B.ocr - G.ocr) + (B.imgs - G.imgs) * 2 + (B.tr - G.tr);
}
const diverging = [];
for (const [key, members] of clusters) {
  if (members.length < 2) continue;
  const live = members.filter((m) => m.visible);
  if (!live.length) continue;
  const best = [...members].sort((a, b) => (content(b).ocr + content(b).imgs * 2) - (content(a).ocr + content(a).imgs * 2))[0];
  const worstLive = [...live].sort((a, b) => shortfall(best, b) - shortfall(best, a))[0];
  const loss = shortfall(best, worstLive);
  if (loss <= 0) continue;   // copies agree — redundant, not harmful
  diverging.push({ key, members, best, worstLive, loss, liveCount: live.length });
}
diverging.sort((a, b) => b.loss - a.loss);
console.log(`${clusters.size} editions with an edition_key; ${[...clusters.values()].filter((m) => m.length > 1).length} have more than one copy;`);
console.log(`${diverging.length} of those have copies that MATERIALLY DIFFER — a reader can land on the thinner one.\n`);
for (const d of diverging.slice(0, LIMIT)) {
  console.log(`${String(d.members[0].title).slice(0, 66)}   [${d.liveCount} live of ${d.members.length} copies]`);
  for (const m of [...d.members].sort((a, b) => (content(b).ocr + content(b).imgs * 2) - (content(a).ocr + content(a).imgs * 2))) {
    const cc = content(m);
    const mark = m.id === d.best.id ? 'BEST' : '    ';
    console.log(`   ${mark} ${m.visible ? 'LIVE  ' : 'hidden'} ${String(cc.pages).padStart(5)}pp ocr=${String(cc.ocr).padStart(5)} imgs=${String(cc.imgs).padStart(4)} tr=${String(cc.tr).padStart(5)}  ${String(m.image_source?.provider || '-').padEnd(17)} ${m.id}`);
  }
  console.log(`   → landing on the weakest LIVE copy costs ${d.loss} (ocr pages + 2x images + translations)\n`);
}

if (JSON_OUT) {
  writeFileSync(JSON_OUT, JSON.stringify({
    generated_at: new Date().toISOString(),
    completeness: rows,
    diverging_clusters: diverging.map((d) => ({
      edition_key: d.key, loss: d.loss, live: d.liveCount,
      best: d.best.id, weakest_live: d.worstLive.id,
      members: d.members.map((m) => ({ id: m.id, title: m.title, visible: !!m.visible, ...content(m) })),
    })),
  }, null, 2));
  console.log(`wrote ${JSON_OUT}`);
}
await client.close();
