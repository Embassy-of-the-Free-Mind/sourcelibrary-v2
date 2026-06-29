/**
 * Bulk-harvest the e-rara catalog via OAI-PMH into Mongo `erara_catalog`
 * (id, title, author, year, lang, manifest_url). ~162k records, 10/page.
 * Resumable: persists the resumptionToken so a kill continues where it left off.
 * The IIIF manifest is derivable: https://www.e-rara.ch/i3f/v20/{id}/manifest
 */
import { MongoClient } from 'mongodb';
import fs from 'fs';

const STATE = 'scripts/output/erara-harvest-state.json';
const PROG = 'scripts/output/erara-harvest.log';
const BASE = 'https://www.e-rara.ch/oai/';
const mc = new MongoClient(process.env.MONGODB_URI); await mc.connect();
const cat = mc.db('bookstore').collection('erara_catalog');
await cat.createIndex({ id: 1 }, { unique: true }).catch(() => {});

const dec = s => (s || '').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&#(\d+);/g, (_, n) => String.fromCharCode(+n)).replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCharCode(parseInt(h, 16))).trim();
function parseRecords(xml) {
  const out = [];
  for (const rec of xml.split('<record>').slice(1)) {
    const id = (rec.match(/<identifier>oai:www\.e-rara\.ch:(\d+)<\/identifier>/) || [])[1];
    if (!id) continue;
    if (/<header status="deleted">/.test(rec)) continue;
    const title = dec((rec.match(/<(?:mods:)?title>([^<]+)<\/(?:mods:)?title>/) || [])[1]);
    const name = dec((rec.match(/<(?:mods:)?name[^>]*type="personal"[^>]*>[\s\S]*?<(?:mods:)?namePart>([^<]+)<\/(?:mods:)?namePart>/) || [])[1]);
    const year = (rec.match(/<(?:mods:)?dateIssued[^>]*>(\d{3,4})/) || [])[1];
    const lang = (rec.match(/<(?:mods:)?languageTerm[^>]*>(\w+)</) || [])[1];
    out.push({ id, title, author: name, year: year ? +year : null, lang, manifest_url: `https://www.e-rara.ch/i3f/v20/${id}/manifest` });
  }
  return out;
}

let token = fs.existsSync(STATE) ? JSON.parse(fs.readFileSync(STATE, 'utf8')).token : null;
let page = fs.existsSync(STATE) ? JSON.parse(fs.readFileSync(STATE, 'utf8')).page : 0;
let total = await cat.countDocuments({});
fs.appendFileSync(PROG, `\n=== harvest start ${new Date().toISOString()} (resume token=${token ? 'yes' : 'no'}, have ${total}) ===\n`);

for (;;) {
  const url = token ? `${BASE}?verb=ListRecords&resumptionToken=${encodeURIComponent(token)}` : `${BASE}?verb=ListRecords&metadataPrefix=mods`;
  let xml;
  try { const r = await fetch(url, { signal: AbortSignal.timeout(40000) }); xml = await r.text(); }
  catch (e) { fs.appendFileSync(PROG, `fetch error p${page}: ${e.message} — retry in 10s\n`); await new Promise(r => setTimeout(r, 10000)); continue; }
  const recs = parseRecords(xml);
  if (recs.length) {
    const ops = recs.map(r => ({ updateOne: { filter: { id: r.id }, update: { $set: r }, upsert: true } }));
    try { await cat.bulkWrite(ops, { ordered: false }); total += recs.length; } catch {}
  }
  token = (xml.match(/<resumptionToken[^>]*>([^<]+)<\/resumptionToken>/) || [])[1] || null;
  page++;
  fs.writeFileSync(STATE, JSON.stringify({ token, page }));
  if (page % 50 === 0) fs.appendFileSync(PROG, `${new Date().toISOString().slice(11, 19)} page ${page} | catalog ~${total}\n`);
  if (!token) { fs.appendFileSync(PROG, `=== DONE: ${total} records harvested ===\n`); break; }
}
console.log('erara harvest complete, total', total);
await mc.close();
