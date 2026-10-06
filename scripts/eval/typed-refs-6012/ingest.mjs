#!/usr/bin/env node
// #6012 steps 1–2: put a source's raw package in the private R2 bucket (sha256 read back), then derive
// per-text pages and one manifest row per text. Raw is never edited; derived rows carry PARSE_VERSION.
//
// PRIOR ART: /data/scratch latin-5126 camena-meta.py + camena-match.js (job-local, never committed: a
//   header scrape for #5126's 82 references, no hashes, no storage); scripts/eval/build-edition-refs.mjs
//   (#5488, one flattened edition file against one book). Neither keeps a corpus or a manifest.
//
//   node --env-file=/root/sourcelibrary/.env.production.local scripts/eval/typed-refs-6012/ingest.mjs --source=dta|camena|eebo [--work=DIR] [--no-upload]
// Local output (scratch): <work>/<source>/manifest.jsonl, <work>/<source>/derived/*.jsonl.gz
// Each derived line: { source, source_id, parse_version, pages: [{ n, facs, ref, text, notes, gaps }] }

import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { execFileSync } from 'node:child_process';
import { argOf, sha256, assertDisk, putVerified, head, keyOf, openZip, eachEntry, entryStream, decodeBytes, teiPages, PARSE_VERSION } from './lib.mjs';
import { metaDta, metaCamena, metaTcp } from './meta.mjs';

const SOURCE = argOf('source');
const WORK = argOf('work', '/data/scratch/sl/typed-refs-6012');
const UPLOAD = !process.argv.includes('--no-upload');
const RETRIEVED = argOf('retrieved', new Date().toISOString().slice(0, 10));
const dir = path.join(WORK, SOURCE);
fs.mkdirSync(path.join(dir, 'derived'), { recursive: true });

const SHARD = 150;                 // texts per derived shard
let shard = [], shardNo = 0, shardPrefix = SOURCE;
const manifest = fs.createWriteStream(path.join(dir, 'manifest.jsonl'));
let writeRow = (line) => manifest.write(line);
const pendingRows = [];
async function flushShard() {
  if (!shard.length) return;
  const name = `${shardPrefix}-${String(shardNo++).padStart(4, '0')}.jsonl.gz`;
  const file = path.join(dir, 'derived', name);
  fs.writeFileSync(file, zlib.gzipSync(shard.map((r) => JSON.stringify(r)).join('\n') + '\n', { level: 6 }));
  let up = { key: null };
  if (UPLOAD) up = await putVerified(`derived/${SOURCE}/${PARSE_VERSION}/${name}`, file, { contentType: 'application/gzip', meta: { parse_version: PARSE_VERSION } });
  for (const row of pendingRows) writeRow(JSON.stringify({ ...row, derived_shard: name, derived_key: up.key }) + '\n');
  shard = []; pendingRows.length = 0;
  assertDisk();
}
async function addText(row, buf) {
  const xml = decodeBytes(buf);
  const pages = teiPages(xml);
  const chars = pages.reduce((a, p) => a + p.text.length, 0);
  shard.push({ source: row.source, source_id: row.source_id, parse_version: PARSE_VERSION, pages });
  pendingRows.push({ ...row, sha256_raw: sha256(buf), bytes_raw: buf.length, retrieved_at: RETRIEVED, parse_version: PARSE_VERSION,
    n_pages: pages.filter((p) => p.n != null || p.facs != null).length, chars, gaps: pages.reduce((a, p) => a + p.gaps, 0) });
  if (shard.length >= SHARD) await flushShard();
  return xml;
}
const headerOf = (buf) => { const s = buf.subarray(0, Math.min(buf.length, 400000)).toString('latin1'); const i = s.search(/<\/(teiHeader|HEADER)>/); return decodeBytes(buf.subarray(0, i > 0 ? Buffer.byteLength(s.slice(0, i), 'latin1') : Math.min(buf.length, 60000))); };

const eachZipEntry = async (where, fn) => eachEntry(await openZip(where), (entry, read) => fn(entry.fileName, read));

// ── DTA ─────────────────────────────────────────────────────────────────────
async function dta() {
  const zip = path.join(dir, 'dta_komplett_2026-02-10.zip');
  const version = '2026-02-10';
  // First run: the local zip is uploaded and read back. Later runs (a parse or metadata change) read the
  // package from R2; the local copy is deleted once verified.
  const local = fs.existsSync(zip);
  const raw = local && UPLOAD ? await putVerified('raw/dta/dta_komplett_2026-02-10.zip', zip, { contentType: 'application/zip', meta: { source_url: 'https://www.deutschestextarchiv.de/media/download/dta_komplett_2026-02-10.zip', version } })
    : { key: keyOf('raw/dta/dta_komplett_2026-02-10.zip'), sha256: (await head(keyOf('raw/dta/dta_komplett_2026-02-10.zip')))?.sha256 || null };
  if (!raw.sha256) throw new Error('DTA package is neither local nor on R2');
  console.log('raw', raw);
  let n = 0;
  await eachZipEntry(local ? { file: zip } : { r2Key: raw.key }, async (name, read) => {
    if (!name.endsWith('.xml')) return;
    const buf = await read();
    const m = metaDta(headerOf(buf));
    await addText({ source: 'dta', source_id: m.ids.dta_dirname || path.basename(name).replace(/\.TEI-P5\.xml$/, ''), ...m,
      url: m.ids.url || `https://www.deutschestextarchiv.de/${m.ids.dta_dirname}`, version, raw_key: raw.key, raw_member: name, raw_package_sha256: raw.sha256,
      licence_key: /by-sa\/4\.0/.test(m.licence_target || '') ? 'dta-cc-by-sa-4.0' : `dta-other:${m.licence_target || 'none stated'}` }, buf);
    if (++n % 500 === 0) console.log('dta', n);
  });
  await flushShard();
  console.log('dta texts', n);
}

// ── CAMENA ──────────────────────────────────────────────────────────────────
async function camena() {
  const repo = argOf('repo', '/data/scratch/sl/latin-5126/camena-xml');
  const commit = execFileSync('git', ['-C', repo, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
  const dirty = execFileSync('git', ['-C', repo, 'status', '--porcelain'], { encoding: 'utf8' }).trim();
  if (dirty) throw new Error(`CAMENA clone is not clean:\n${dirty.slice(0, 400)}`);
  const tar = path.join(dir, `camena-neolatinlit-${commit.slice(0, 7)}.tar.zst`);
  if (!fs.existsSync(tar)) {
    assertDisk(1);
    execFileSync('bash', ['-c', `git -C ${repo} archive --format=tar ${commit} | zstd -q -10 -T2 -o ${tar}`]);
  }
  const raw = UPLOAD ? await putVerified(`raw/camena/${path.basename(tar)}`, tar, { contentType: 'application/zstd', meta: { source_url: 'https://github.com/nevenjovanovic/camena-neolatinlit', version: commit } })
    : { key: null, sha256: null };
  console.log('raw', raw);
  let n = 0;
  for (const coll of ['poemata', 'historicapolitica', 'thesaurus', 'cera']) {
    for (const f of fs.readdirSync(path.join(repo, coll)).filter((x) => x.endsWith('.xml')).sort()) {
      const buf = fs.readFileSync(path.join(repo, coll, f));
      const m = metaCamena(headerOf(buf), coll, f);
      await addText({ source: 'camena', source_id: `${coll}/${f.replace(/\.xml$/, '')}`, ...m,
        url: `https://github.com/nevenjovanovic/camena-neolatinlit/blob/${commit}/${coll}/${f}`, version: commit, raw_key: raw.key, raw_member: `${coll}/${f}`, raw_package_sha256: raw.sha256,
        licence_key: 'camena-cc-by-sa' }, buf);
      n++;
    }
    console.log('camena', coll, n);
  }
  await flushShard();
  if (UPLOAD) fs.rmSync(tar);
  console.log('camena texts', n);
}

// ── EEBO-TCP ────────────────────────────────────────────────────────────────
// The raw package is ONE object on R2 (eebo-stream.mjs put it there; it never touched this disk). Its
// P4 XML members ("the version that we generally recommend", TCP FAQ) are zips of ~2,000 texts each:
// one inner zip at a time is pulled to scratch by range read, parsed, and deleted. The phase comes from
// the folder (eebo_phase1 / eebo_phase2), which is the TCP's own division. Resumable per inner zip.
async function eebo() {
  const rawKey = keyOf('raw/eebo-tcp/eebo_all.zip');
  const rawInfo = JSON.parse(fs.readFileSync(path.join(dir, 'raw.json'), 'utf8'));
  if (rawInfo.key !== rawKey || rawInfo.verified !== 'full read-back') throw new Error('eebo raw.json does not describe a verified upload');
  const partsDir = path.join(dir, 'manifest.parts'); fs.mkdirSync(partsDir, { recursive: true });
  const outer = await openZip({ r2Key: rawKey });
  const inners = [];
  await eachEntry(outer, async (entry) => { if (/^eebo_phase[12]\/P4_XML_TCP(_Ph2)?\/[A-Z]\d+\.zip$/.test(entry.fileName)) inners.push(entry); });
  console.log('inner zips', inners.length);
  let total = 0;
  for (const entry of inners.sort((x, y) => x.fileName.localeCompare(y.fileName))) {
    const phase = /^eebo_phase1\//.test(entry.fileName) ? 1 : 2;
    const tag = `p${phase}-${path.basename(entry.fileName, '.zip')}`;
    const part = path.join(partsDir, `${tag}.jsonl`);
    if (fs.existsSync(part)) { total += fs.readFileSync(part, 'utf8').split('\n').filter(Boolean).length; continue; }
    assertDisk(1);
    const tmp = path.join(dir, `${tag}.zip`);
    const w = fs.createWriteStream(tmp);
    for await (const chunk of await entryStream(outer, entry)) if (!w.write(chunk)) await new Promise((res) => w.once('drain', res));
    w.end(); await new Promise((res) => w.on('finish', res));
    const lines = [];
    writeRow = (line) => lines.push(line);
    shardPrefix = `eebo-${tag}`; shardNo = 0;
    let n = 0;
    await eachZipEntry({ file: tmp }, async (name, read) => {
      if (!/\.xml$/i.test(name)) return;
      const buf = await read();
      const m = metaTcp(headerOf(buf), name);
      await addText({ source: 'eebo-tcp', source_id: m.ids.tcp, ...m, phase, url: `https://quod.lib.umich.edu/e/eebo/${m.ids.tcp}.0001.001`, version: `eebo_all.zip retrieved ${rawInfo.retrieved_at.slice(0, 10)}`,
        raw_key: rawKey, raw_member: `${entry.fileName}!${name}`, raw_package_sha256: rawInfo.sha256, licence_key: phase === 1 ? 'eebo-tcp-phase1-cc0' : 'eebo-tcp-phase2-public-no-licence' }, buf);
      n++;
    });
    await flushShard();
    fs.rmSync(tmp);
    fs.writeFileSync(part, lines.join(''));
    total += n;
    console.log('eebo', tag, n, 'total', total);
  }
  writeRow = (line) => manifest.write(line);
  for (const f of fs.readdirSync(partsDir).sort()) manifest.write(fs.readFileSync(path.join(partsDir, f), 'utf8'));
  console.log('eebo texts', total);
}

const run = { dta, camena, eebo }[SOURCE];
if (!run) throw new Error('--source=dta|camena|eebo');
await run();
manifest.end(); await new Promise((r) => manifest.on('finish', r));
