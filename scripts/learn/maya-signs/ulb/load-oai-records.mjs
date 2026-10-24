#!/usr/bin/env node
// Upsert every record of the ULB Bonn Maya archive (OAI-PMH set ulbbnmaya, oai_dc) into `maya_archive` (#6980).
// PRIOR ART: ./load-maya-archive.mjs loads full METS records with their images, one monument at a time; this
// loads the whole catalogue as an index, records only, no images. Same _id (`ulb:<record>`), and it only
// fills fields a doc does not have yet ($setOnInsert) plus the raw `oai_dc`, so a richer METS doc keeps its fields.
// Input: records.jsonl from the harvester (one {oai_id, datestamp, sets, deleted, dc} per line).
//   node --env-file=.env.production.local scripts/learn/maya-signs/ulb/load-oai-records.mjs <records.jsonl> [--apply]
import { readFileSync } from 'node:fs';
import { MongoClient } from 'mongodb';

const [file, flag] = process.argv.slice(2);
if (!file) { console.error('usage: load-oai-records.mjs <records.jsonl> [--apply]'); process.exit(2); }
const HOST = 'https://digitale-sammlungen.ulb.uni-bonn.de';
const KINDS = ['artifact', 'illustration_document', 'object_part', 'object_group', 'document', 'journal_volume'];

const seen = new Map();
for (const line of readFileSync(file, 'utf8').trim().split('\n')) {
  const r = JSON.parse(line);
  seen.set(r.oai_id, r); // a re-harvested record replaces the earlier copy
}
const recs = [...seen.values()];
const counts = {};
const ops = recs.map((r) => {
  const id = r.oai_id.split(':').pop();
  const title = r.dc.title?.[0] ?? null;
  let kind = r.sets.find((s) => KINDS.includes(s)) ?? 'other';
  if (kind === 'illustration_document') kind = /drawing\s*$/i.test(title ?? '') ? 'drawing' : 'photograph';
  if (r.deleted) kind = 'deleted';
  counts[kind] = (counts[kind] || 0) + 1;
  const lic = r.dc.rights?.[0] ?? null;
  return {
    updateOne: {
      filter: { _id: `ulb:${id}` },
      update: {
        $set: { oai_dc: r.dc, oai_sets: r.sets, oai_datestamp: r.datestamp, oai_deleted: r.deleted, updated_at: new Date() },
        $setOnInsert: {
          source: 'ulb-maya-archive', ulb_id: id, url: `${HOST}/maya/content/titleinfo/${id}`, kind, title,
          creator: r.dc.creator?.[0] ?? null, date: r.dc.date?.[0] ?? null,
          rights: { holder: r.dc.creator?.[0] ?? 'Universitäts- und Landesbibliothek Bonn', terms: lic,
            credit: `Maya Hieroglyphic Text and Image Archive, ULB Bonn${lic ? `, ${lic}` : ''}` },
          created_at: new Date(),
        },
      },
      upsert: true,
    },
  };
});
const lic = recs.reduce((m, r) => ((m[r.dc.rights?.[0] ?? '(none)'] = (m[r.dc.rights?.[0] ?? '(none)'] || 0) + 1), m), {});
console.log(`${recs.length} records`, JSON.stringify(counts), 'rights:', JSON.stringify(lic));
if (flag !== '--apply') { console.log('dry run; pass --apply to write'); process.exit(0); }

const client = await MongoClient.connect(process.env.MONGODB_URI);
const col = client.db('bookstore').collection('maya_archive');
let up = 0, mod = 0;
for (let i = 0; i < ops.length; i += 2000) {
  const res = await col.bulkWrite(ops.slice(i, i + 2000), { ordered: false });
  up += res.upsertedCount; mod += res.modifiedCount;
}
await col.createIndex({ kind: 1, title: 1 });
console.log(`mongo upserted=${up} modified=${mod}; total docs=${await col.countDocuments()}`);
await client.close();
