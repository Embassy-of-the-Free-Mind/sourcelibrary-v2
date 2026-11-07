#!/usr/bin/env node
/**
 * Generic OAI-PMH (Dublin Core) discovery harvester — one config per repository.
 *
 * PRIOR ART: scripts/iiif-discovery/sources/erara.mjs — same OAI-DC loop, but
 * hard-wired to e-rara's identifier and manifest shape; this lifts the loop and
 * keeps the per-repository parts (id pattern, record URL, rights rule) in a
 * config table. scripts/catalog-coverage/harvest-oai-libraries.mjs is METS/MODS
 * only and writes a different row shape; these repositories serve oai_dc.
 *
 * Writes `import_candidates` rows ONLY (status 'discovered'), idempotently keyed on
 * (source, source_id) via upsertCandidates(). Never touches `books`. Nothing
 * consumes import_candidates on a schedule: rows sit until a person runs an
 * import (import-workflow.md), so a harvest here is a record, not an actuation.
 *
 * Polite: one request per --delay ms (default 1100) to one host; a repeated
 * identical failure stops the run instead of grinding (#7294 "fail twice → blocked").
 *
 * Usage:
 *   node --env-file=.env.production.local scripts/iiif-discovery/sources/oai-dc.mjs --repo=bvpb
 *   … --repo=alvin --set=old_prints
 *   … --repo=bnp
 *   … --dry-run --max-records=300         parse, print counts, write nothing
 *   … --resume-token=…                    continue from a printed token
 *
 * Repositories (probed 2026-10-24, #7294; see library-harvest-registry.md):
 *   bvpb   Biblioteca Virtual del Patrimonio Bibliográfico (Spain), 141,775 records, CC BY 4.0
 *   alvin  Alvin (Uppsala + Swedish libraries); sets text / manuscript / old_prints
 *   bnp    Biblioteca Nacional Digital (Portugal), 50,788 records, title-only DC
 */

import { withMongo } from '../../lib/mongo.mjs';
import { ensureIndexes, upsertCandidates } from '../lib/candidate-store.mjs';
import { parseDateRange, normalizeLanguage } from '../lib/iiif-metadata.mjs';

const args = Object.fromEntries(process.argv.slice(2).filter(a => a.startsWith('--')).map(a => {
  const [k, ...v] = a.slice(2).split('=');
  return [k, v.length ? v.join('=') : true];
}));
const DRY_RUN = 'dry-run' in args;
const MAX_RECORDS = parseInt(args['max-records']) || Infinity;
const DELAY = parseInt(args.delay) || 1100;
const UA = 'SourceLibrary/1.0 (https://sourcelibrary.org; derek@sourcelibrary.org) oai-pmh-harvest';

const REPOS = {
  bvpb: {
    source: 'bvpb',
    base: 'https://bvpb.mcu.es/i18n/oai/oai_bvpb.mcu.es.do',
    prefix: 'oai_dc',
    origin: 'Biblioteca Virtual del Patrimonio Bibliográfico (Spain)',
    idRe: /^oai:bvpb\.mcu\.es:(\d+)$/,
    recordUrl: (id) => `https://bvpb.mcu.es/es/consulta/registro.do?id=${id}`,
    // Every record carries its licence in dc:rights (CC BY 4.0 on the sample);
    // the text's own PD status is still a date question.
    rights: (dc) => dc.rights?.[0] || null,
  },
  alvin: {
    source: 'alvin',
    base: 'https://www.alvin-portal.org/oai/oai',
    prefix: 'oai_dc',
    origin: 'Alvin (Uppsala University Library and partners)',
    idRe: /^oai:ALVIN\.org:(\d+)$/,
    recordUrl: (id) => `https://www.alvin-portal.org/alvin/view.jsf?pid=alvin-record:${id}`,
    rights: (dc) => dc.rights?.[0] || null,
  },
  bnp: {
    source: 'bnp',
    base: 'https://bndigital.bnportugal.gov.pt/oai',
    // The repository's oai_dc is called `oai_dc_duplicate` and carries only a
    // title; `test` carries shelfmark + catalogue id + rights. Title is enough to
    // rank; a date needs the Porbase record (metadata.porbase_id) — see registry.
    prefix: 'oai_dc_duplicate',
    origin: 'Biblioteca Nacional de Portugal (BND)',
    idRe: /^oai:limbgalm\.bn\.pt:1:(\d+)$/,
    recordUrl: (id) => `https://bndigital.bnportugal.gov.pt/records/item/${id}`,
    rights: () => null,
    // Measured 2026-10-24: any User-Agent containing "OAI-PMH harvest" gets HTTP 502
    // here; the same request naming us without that phrase gets 200.
    ua: 'SourceLibrary/1.0 (https://sourcelibrary.org; derek@sourcelibrary.org)',
  },
};

const repo = REPOS[args.repo];
if (!repo) {
  console.error(`--repo=<${Object.keys(REPOS).join('|')}> required`);
  process.exit(1);
}
const SET = args.set || null;

const sleep = ms => new Promise(r => setTimeout(r, ms));
const unescape = s => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&');

function parse(xml) {
  const records = [];
  for (const m of xml.matchAll(/<record>([\s\S]*?)<\/record>/g)) {
    const rec = m[1];
    if (/status="deleted"/.test(rec)) continue;
    const oaiId = rec.match(/<identifier>([^<]+)<\/identifier>/)?.[1]?.trim();
    const id = oaiId?.match(repo.idRe)?.[1];
    if (!id) continue;
    const dc = {};
    for (const f of rec.matchAll(/<dc:(\w+)[^>]*>([^<]*)<\/dc:\1>/g)) {
      const v = unescape(f[2].trim());
      if (v) (dc[f[1]] ??= []).push(v);
    }
    if (!dc.title) continue;
    const sets = [...rec.matchAll(/<setSpec>([^<]+)<\/setSpec>/g)].map(s => s[1]);
    const date = dc.date?.[0] || null;
    const { earliest, latest } = parseDateRange(date);
    const langRaw = dc.language?.[0] || null;
    records.push({
      source: repo.source,
      source_id: id,
      manifest_url: null,
      origin_library: repo.origin,
      provider_name: repo.origin,
      title: dc.title[0].replace(/\s*\[Manuscrito\]\s*$/i, '').trim(),
      author: dc.creator?.[0] || dc.contributor?.[0] || 'Unknown',
      // Alvin writes "Svensk Swedish"; keep the last word, which is the English name.
      language: langRaw ? normalizeLanguage(langRaw.split(/\s+/).pop()) : 'Unknown',
      date_text: date,
      date_earliest: earliest,
      date_latest: latest,
      subjects: dc.subject || [],
      source_url: repo.recordUrl(id),
      metadata: {
        oai_id: oaiId,
        oai_sets: sets,
        dc_type: dc.type || [],
        rights: repo.rights(dc),
        languages: dc.language || [],
        identifiers: dc.identifier || [],
      },
    });
  }
  const token = xml.match(/<resumptionToken[^>]*>([^<]+)<\/resumptionToken>/)?.[1]?.trim() || null;
  const size = xml.match(/completeListSize="(\d+)"/)?.[1];
  return { records, token, total: size ? parseInt(size) : null };
}

await withMongo(async (db) => {
  if (!DRY_RUN) await ensureIndexes(db);
  let url = args['resume-token']
    ? `${repo.base}?verb=ListRecords&resumptionToken=${encodeURIComponent(args['resume-token'])}`
    : `${repo.base}?verb=ListRecords&metadataPrefix=${repo.prefix}${SET ? `&set=${SET}` : ''}`;
  let seen = 0, inserted = 0, batch = 0, lastError = null, sameErrors = 0, failures = 0;
  const langs = {}, decades = {};
  console.log(`=== OAI-DC harvest: ${repo.source}${SET ? ` set=${SET}` : ''}${DRY_RUN ? ' (dry run)' : ''} ===`);
  while (url && seen < MAX_RECORDS) {
    batch++;
    let xml;
    try {
      const res = await fetch(url, { headers: { 'User-Agent': repo.ua || UA }, signal: AbortSignal.timeout(90000) });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      xml = await res.text();
      const err = xml.match(/<error code="([^"]+)">([^<]*)/);
      if (err && err[1] !== 'noRecordsMatch') throw new Error(`OAI ${err[1]}: ${err[2]}`);
      sameErrors = 0; lastError = null; failures = 0;
    } catch (e) {
      sameErrors = e.message === lastError ? sameErrors + 1 : 1;
      lastError = e.message;
      console.error(`batch ${batch}: ${e.message}`);
      // Two identical failures, or five of any kind in a row, ends the run.
      if (sameErrors >= 2 || ++failures >= 5) { console.error(`STOP: repeated failures — record ${repo.source} as blocked at this token.`); break; }
      await sleep(15000);
      continue;
    }
    const { records, token, total } = parse(xml);
    if (batch === 1 && total) console.log(`completeListSize ${total.toLocaleString()}`);
    seen += records.length;
    for (const r of records) {
      langs[r.language] = (langs[r.language] || 0) + 1;
      const d = r.date_earliest ? `${Math.floor(r.date_earliest / 100)}xx` : 'undated';
      decades[d] = (decades[d] || 0) + 1;
    }
    if (!DRY_RUN && records.length) inserted += (await upsertCandidates(db, records)).inserted;
    if (batch % 25 === 0 || !token) console.log(`batch ${batch}: seen ${seen.toLocaleString()}, new ${inserted.toLocaleString()} | token ${token || '-'}`);
    url = token ? `${repo.base}?verb=ListRecords&resumptionToken=${encodeURIComponent(token)}` : null;
    await sleep(DELAY);
  }
  const top = o => Object.entries(o).sort((a, b) => b[1] - a[1]).slice(0, 12).map(([k, v]) => `${k}:${v}`).join(' ');
  console.log(`done: ${seen.toLocaleString()} records, ${inserted.toLocaleString()} new rows`);
  console.log(`languages: ${top(langs)}`);
  console.log(`centuries: ${top(decades)}`);
}, { noTimeout: true });
