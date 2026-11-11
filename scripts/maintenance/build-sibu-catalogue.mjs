#!/usr/bin/env node
/**
 * Build src/lib/sibu-catalogue.json: every live Chinese book, as one row per WORK, under the
 * class Kanripo's catalogue gives it. This is the data behind /sibu and /zh/sibu.
 *
 * Why a snapshot: the class is already in `work_id` (`kr:KR3k0059`, written by the
 * work-identity lane), so nothing new is stored on `books`, and the page costs no query over
 * 13K rows on a request path. It goes stale only as Chinese books are added; re-run and commit.
 *
 * How a work gets a class:
 *   kanripo  its work_id is kr:<id>. Title and author come from the catalogue.
 *   title    its work_id is local, but its title matches a catalogue entry AND the author
 *            agrees. Authorless title matches stay unclassified: two works can share a title.
 *   confirmed the author test failed on spelling or role, and the pair was read by hand (CONFIRMED).
 *   none     neither. These are listed as outside the catalogue, which is often simply true:
 *            vernacular fiction, drama, works banned from the Siku.
 *
 * Kanripo (https://github.com/kanripo/KR-Catalog) follows the Siku's own classes for KR1-KR4
 * and adds KR5 Daoist and KR6 Buddhist canons.
 *
 * PRIOR ART: src/lib/canon-works.ts and /works — group editions by work_id, but know nothing
 * about classes. scripts/import/enumerate-dedupe-source.ts reads a catalogue to acquire, not
 * to classify what is held.
 *
 *   git clone --depth 1 https://github.com/kanripo/KR-Catalog /tmp/kr
 *   node --env-file=.env.production.local scripts/maintenance/build-sibu-catalogue.mjs --catalog=/tmp/kr
 */
import { MongoClient } from 'mongodb';
import fs from 'node:fs';
import path from 'node:path';

const arg = (n) => process.argv.find((a) => a.startsWith(`--${n}=`))?.split('=')[1];
const CATALOG = arg('catalog');
const OUT = 'src/lib/sibu-catalogue.json';
if (!CATALOG) { console.error('need --catalog=<KR-Catalog checkout>'); process.exit(1); }

const norm = (t) => String(t || '').replace(/[\s·・，,。:：《》〈〉「」『』\-—_[\]［］()（）]/g, '');
const entries = new Map(), byTitle = new Map();
const krDir = path.join(CATALOG, 'KR');
for (const f of fs.readdirSync(krDir)) {
  for (const line of fs.readFileSync(path.join(krDir, f), 'utf8').split('\n')) {
    const m = line.match(/^\*\*\* (KR\d[a-z]\d{4}[a-z]?) (.+)$/);
    if (!m) continue;
    const [title, dynasty, author] = m[2].split('-');
    const e = { kr: m[1], title, dynasty: dynasty || '', author: author || '' };
    entries.set(m[1], e);
    const k = norm(title);
    if (k) { if (!byTitle.has(k)) byTitle.set(k, []); byTitle.get(k).push(e); }
  }
}

/** A volume title down to its work title: 周禮注疏·卷十八~卷十九 (vol 53) -> 周禮注疏 */
function stem(raw) {
  let t = String(raw || '').split(/[:：]/)[0].replace(/\s*\(.*$/, '').replace(/（.*$/, '');
  t = t.split('·').filter((p) => !/^(卷|目錄|目录|首|提要|附)/.test(p))[0] || t.split('·')[0];
  return t.replace(/\s*[卷第]+[一二三四五六七八九十百千〇零\d]+.*$/, '').replace(/\[.*$/, '').replace(/\s*Vol\..*$/i, '').replace(/[,，]\s*Volume.*$/i, '').trim();
}
const CN = { 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9 };
function cnNumber(s) {
  let n = 0, cur = 0;
  for (const ch of s) {
    if (CN[ch]) cur = CN[ch];
    else if (ch === '十') { n += (cur || 1) * 10; cur = 0; }
    else if (ch === '百') { n += (cur || 1) * 100; cur = 0; }
  }
  return n + cur;
}
const volNumber = (t) => {
  const m = String(t).match(/\(vol (\d+)/i) || String(t).match(/Vol\. ?(\d+)/i) || String(t).match(/Volume (\d+)/i) || String(t).match(/\((\d+)\)/);
  if (m) return Number(m[1]);
  const c = String(t).match(/[(（]([一二三四五六七八九十百]+)[)）]/);
  return c ? cnNumber(c[1]) : Number.MAX_SAFE_INTEGER;
};

/**
 * Read by hand 2026-11-04: the title match is right and the author test failed only on
 * spelling (romanised on our record, 賈思勰 in the catalogue) or on a role (translator,
 * commentator). 山海經 follows the Siku, which files it under 小說家.
 */
const CONFIRMED = {
  韓非子: 'KR3c0005', 晉書: 'KR2a0015', 九章算術: 'KR3f0032', 孫子算經: 'KR3f0033', 齊民要術: 'KR3d0001',
  大般若波羅蜜多經: 'KR6c0001', 太乙金鏡式經: 'KR3g0047', 夢溪筆談: 'KR3j0092', 宣和畫譜: 'KR3h0025',
  救荒本草: 'KR3d0006', 道藏目錄詳註: 'KR5g0239', 周易洗心: 'KR1a0153', 墨子: 'KR3j0002', 楞嚴經要解: 'KR6j0678',
  禪宗頌古聯珠通集: 'KR6q0243', 幾何原本: 'KR3f0047', 渾蓋通憲圖說: 'KR3f0015', 測量法義: 'KR3f0014',
  奇器圖說: 'KR3i0001', 易象圖說: 'KR3g0015', 山海經: 'KR3l0090', 六祖大師法寶壇經: 'KR6q0083',
  御纂醫宗金鑑: 'KR3e0090', 欽定儀象考成: 'KR3f0020', 周髀算經: 'KR3f0001', 農政全書: 'KR3d0007',
  周元公集: 'KR4d0065', 論語: 'KR1h0005', 孟子: 'KR1h0002', 佛國記: 'KR2k0136', 格致鏡原: 'KR3k0061', 諸蕃志: 'KR2k0139',
};

const client = new MongoClient(process.env.MONGODB_URI);
await client.connect();
const cursor = client.db('bookstore').collection('books').find(
  { visible: true, pages_count: { $gt: 0 }, language: /^(chinese|classical chinese|literary chinese)/i },
  { projection: { _id: 0, id: 1, slug: 1, title: 1, display_title: 1, author: 1, work_id: 1, pages_count: 1 }, batchSize: 2000 },
);
const works = new Map();
for await (const b of cursor) {
  const key = b.work_id || `book:${b.id}`;
  const w = works.get(key) || { key, vols: [], pages: 0, author: b.author };
  w.vols.push(b); w.pages += b.pages_count || 0;
  works.set(key, w);
}
await client.close();

const rows = [];
const tally = { kanripo: 0, title: 0, confirmed: 0, none: 0 };
// One row per work, whatever split it in `work_id`: 本草綱目 arrives as about 30 local ids.
const merged = new Map();
const addRow = (row, firstVol) => {
  const k = row.kr || `title:${norm(row.title)}`;
  const m = merged.get(k);
  if (!m) { merged.set(k, { ...row, firstVol }); return; }
  m.vols += row.vols; m.pages += row.pages;
  if (row.source === 'kanripo') m.source = 'kanripo';
  if (firstVol < m.firstVol) { m.firstVol = firstVol; m.first = row.first; m.gloss = row.gloss; }
};
const rejected = [];
for (const w of works.values()) {
  w.vols.sort((a, b) => volNumber(a.title) - volNumber(b.title) || String(a.title).localeCompare(String(b.title), 'zh'));
  const first = w.vols[0];
  const s = stem(first.title);
  let e = w.key.startsWith('kr:') ? entries.get(w.key.slice(3)) : null;
  let source = e ? 'kanripo' : 'none';
  if (!e && CONFIRMED[s]) { e = entries.get(CONFIRMED[s]); source = 'confirmed'; }
  if (!e) {
    const hits = byTitle.get(norm(s)) || [];
    const agree = hits.filter((h) => h.author && String(w.author || '').includes(h.author));
    if (agree.length && new Set(agree.map((h) => h.kr.slice(0, 4))).size === 1) { e = agree[0]; source = 'title'; }
    else if (hits.length) rejected.push(`${s} [${w.author}] vs ${hits.map((h) => `${h.kr} ${h.author}`).join(' / ')}`);
  }
  tally[source]++;
  addRow({
    cls: e ? e.kr.slice(0, 4) : null,
    kr: e?.kr ?? null,
    source,
    title: e?.title || s,
    gloss: String(first.display_title || '').replace(/,?\s*(juan|vol|Vol\.|Volume)\b.*$/i, '').trim() || null,
    dynasty: e?.dynasty || null,
    author: e?.author || (w.author && w.author !== 'Unknown' ? String(w.author).slice(0, 60) : null),
    vols: w.vols.length,
    pages: w.pages,
    first: first.slug || first.id,
  }, volNumber(first.title));
}
for (const { firstVol: _f, ...row } of merged.values()) rows.push(row);
rows.sort((a, b) => (a.kr || 'ZZ').localeCompare(b.kr || 'ZZ') || b.vols - a.vols);
const volumes = rows.reduce((n, r) => n + r.vols, 0);
fs.writeFileSync(OUT, `${JSON.stringify({ generated: new Date().toISOString().slice(0, 10), volumes, works: rows.length, rows })}\n`);
console.log(`${OUT}: ${rows.length} works, ${volumes} volumes; ${JSON.stringify(tally)}; ${fs.statSync(OUT).size} bytes`);
const part = {};
for (const r of rows) { const k = r.cls ? r.cls.slice(0, 3) : 'none'; part[k] = part[k] || { works: 0, vols: 0 }; part[k].works++; part[k].vols += r.vols; }
console.log(JSON.stringify(part));
console.log(`title matches refused, author disagrees or absent: ${rejected.length}`);
for (const x of rejected.slice(0, 60)) console.log(`  ${x}`);
console.log('title-matched:');
for (const r of rows.filter((x) => x.source === 'title')) console.log(`  ${r.kr} ${r.title} | ${r.author} | ${r.vols}`);
