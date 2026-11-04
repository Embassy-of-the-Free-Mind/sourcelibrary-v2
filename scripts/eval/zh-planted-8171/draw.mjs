// PRIOR ART: zh-punct-8140/draw.mjs and draw-b.mjs on PR #8146 (the CBETA frame of #6101 and a Paddle-page draw: their
// page ids are the B pages here, read again from Mongo); scripts/eval/zh-skqs-5568-kanripo.mjs (workInfo / pbPages: the
// Kanripo WYG leaf of a Siku page, imported); scripts/eval/ground-truth-5935/kanripo.mjs (the qa_screen leaf rule, dice
// >= 0.6, reused for B-ext). zh-skqs-5568-kanripo.mjs runs its CLI on import (exits without a command), so its
// pbPages split (<pb:…> segments of a WYG juan file) is repeated here in four lines. None draws a famous / reference-covered / obscure frame for planted edits.
/**
 * #8171 draw. READ-ONLY: Mongo (books, pages, page_revisions by page_id), GitHub (kanripo org), page images.
 *
 *   node --env-file=… scripts/eval/zh-planted-8171/draw.mjs --priv=$JOB_SCRATCH/priv --dir=$JOB_SCRATCH/kr5568
 *        [--p8140=FILE draw-A.json of PR #8146] [--p5274=FILE sample.json of PR #8134]
 *
 * Writes <priv>/passages/<slug>.json { slug, group, ..., text (Han only), cands } — reference text, NEVER committed —
 * and <priv>/passages/<slug>.jpg for group C. The public record (ids, offsets, hashes, no text) is written by plant.mjs.
 */
import fs from 'fs'; import path from 'path'; import crypto from 'crypto'; import { execSync } from 'child_process';
import { MongoClient } from 'mongodb';
import { clean, hanCount, candidates, makeRng } from './lib.mjs';
import { stripMarkupTags } from '../../lib/strip-markup-tags.mjs';
import { getPageSource } from '../../lib/page-image-url.mjs';

const argOf = (n, d) => { const a = process.argv.find((x) => x.startsWith(`--${n}=`)); return a ? a.slice(n.length + 3) : d; };
const PRIV = path.join(argOf('priv'), 'passages'); fs.mkdirSync(PRIV, { recursive: true });
const CACHE = path.join(argOf('priv'), 'kr-cache'); fs.mkdirSync(CACHE, { recursive: true });
const SEED = 8171;
const seedOf = (s) => SEED ^ parseInt(crypto.createHash('sha256').update(String(s)).digest('hex').slice(0, 8), 16);
const WIN = 240, MAXLEN = 260, MINHAN = 100;
const TOKEN = (() => { try { return execSync('gh auth token', { encoding: 'utf8' }).trim(); } catch { return ''; } })();

async function cachedFetch(url, key) {
  const f = path.join(CACHE, key.replace(/[^\w.-]/g, '_'));
  if (fs.existsSync(f)) return fs.readFileSync(f, 'utf8');
  const r = await fetch(url, { headers: TOKEN && url.includes('api.github.com') ? { Authorization: `token ${TOKEN}` } : {} });
  const t = r.ok ? await r.text() : '';
  fs.writeFileSync(f, t); return t;
}
/** A Kanripo text, master branch: every juan file, header / heading / comment lines and （…） notes removed. */
async function kanripoText(id) {
  const list = JSON.parse(await cachedFetch(`https://api.github.com/repos/kanripo/${id}/contents?ref=master`, `${id}.list.json`) || '[]');
  const files = list.map((x) => x.name).filter((n) => new RegExp(`^${id}_\\d{3}\\.txt$`).test(n)).sort();
  let all = '';
  for (const n of files) {
    const raw = await cachedFetch(`https://raw.githubusercontent.com/kanripo/${id}/master/${n}`, n);
    all += raw.split('\n').filter((l) => !/^\s*[#*]/.test(l)).join('\n').replace(/<pb:[^>]+>/g, '').replace(/（[^（）]*）|\([^()]*\)/g, '');
  }
  return clean(all);
}
const window = (t, rng) => { const c = [...t]; if (c.length <= MAXLEN) return { text: t, offset: 0 }; const o = Math.floor(rng() * (c.length - WIN)); return { text: c.slice(o, o + WIN).join(''), offset: o }; };
const save = (p) => { fs.writeFileSync(path.join(PRIV, `${p.slug}.json`), JSON.stringify(p)); return p; };
const sha = (t) => crypto.createHash('sha256').update(t, 'utf8').digest('hex');

// ── A: positive control. Anchor = the passage starts at that string; null = a seeded offset in the whole work. ──
export const A_WORKS = [
  ['論語', 'KR1h0004', null], ['孟子', 'KR1h0001', null], ['老子', 'KR5c0057', null], ['莊子·逍遙遊', 'KR5c0126', '北冥有魚'],
  ['詩經', 'KR1c0001', null], ['大學', 'KR1d0052', '大學之道在明明德'], ['中庸', 'KR1d0052', '天命之謂性'], ['孝經', 'KR1f0001', null],
  ['周易', 'KR1a0001', null], ['尚書', 'KR1b0001', null], ['孫子', 'KR3b0003', null], ['般若心經', 'KR6c0128', '觀自在菩薩'],
  ['金剛經', 'KR6c0023', null], ['法華經·普門品', 'KR6d0001', '爾時無盡意菩薩'], ['阿彌陀經', 'KR6f0082', null], ['六祖壇經', 'KR6q0083', '菩提自性'],
  ['離騷', 'KR4a0001', '帝高陽之苗裔'], ['禮運·大同', 'KR1d0052', '大道之行也'], ['桃花源記', 'KR4b0008', '晉太元中'], ['左傳·鄭伯克段于鄢', 'KR1e0001', '初鄭武公娶于申'],
];
async function drawA() {
  const rows = [];
  for (const [work, id, anchor] of A_WORKS) {
    const t = await kanripoText(id); const c = [...t];
    const rng = makeRng(seedOf(`A:${work}`));
    let pick = null;
    for (let tries = 0; tries < 30 && !pick; tries++) {
      let o;
      if (anchor) { o = [...t.slice(0, t.indexOf(clean(anchor)))].length; if (t.indexOf(clean(anchor)) < 0) break; } else o = Math.floor(rng() * Math.max(1, c.length - WIN));
      const text = c.slice(o, o + (anchor ? 200 : WIN)).join('');
      if (hanCount(text) >= MINHAN && candidates(text).length >= 2) pick = { text, offset: o };
      else if (anchor) { const text2 = c.slice(o, o + MAXLEN).join(''); if (candidates(text2).length >= 2) pick = { text: text2, offset: o }; break; }
    }
    if (!pick) { console.log(`A ${work}: no passage (${anchor ? 'anchor' : 'random'}, ${c.length} chars)`); rows.push({ group: 'A', work, kr: id, status: 'no-passage' }); continue; }
    rows.push(save({ slug: `A-${id}-${pick.offset}`, group: 'A', work, source: 'kanripo', kr: id, anchor, offset: pick.offset, text: pick.text, han: hanCount(pick.text), sha256: sha(pick.text) }));
  }
  return rows;
}

// ── B-strict: the CBETA pages of #6101 / #8140 (one per work) and the #8134 test 2 pages (one per work) ──
const workOf = (title) => String(title || '').replace(/[·・].*$|\s*\(vol.*$/, '').replace(/\s*卷.*$/, '').trim();
async function drawBcbeta(db) {
  const d = JSON.parse(fs.readFileSync(argOf('p8140'), 'utf8'));
  const byWork = new Map();
  for (const p of d.pages.filter((x) => x.slug)) { const w = workOf(p.title); if (!byWork.has(w)) byWork.set(w, []); byWork.get(w).push(p); }
  const rows = [];
  for (const [work, ps] of [...byWork].sort((a, b) => a[0].localeCompare(b[0]))) {
    const rng = makeRng(seedOf(`B:${work}`));
    const order = ps.map((p) => [rng(), p]).sort((a, b) => a[0] - b[0]).map(([, p]) => p);
    let done = false;
    for (const p of order) {
      const pg = await db.collection('pages').findOne({ _id: (await import('mongodb')).ObjectId.createFromHexString(p.page_id) }, { projection: { 'ocr.source': 1, 'ocr.data': 1 } }) ||
        await db.collection('pages').findOne({ id: p.page_id }, { projection: { 'ocr.source': 1, 'ocr.data': 1 } });
      let text = pg?.ocr?.source === 'cbeta-xml-p5' ? pg.ocr.data : null;
      if (!text) { const rv = await db.collection('page_revisions').find({ page_id: p.page_id, field: 'ocr', source: 'cbeta-xml-p5' }).sort({ created_at: -1 }).limit(1).toArray(); text = rv[0]?.data ?? null; }
      if (!text) continue;
      const h = String(text).replace(/〔[^〔〕]{1,12}〕/g, '〓');
      const w = window(clean(h), rng);
      if (hanCount(w.text) < MINHAN || candidates(w.text).length < 2) continue;
      rows.push(save({ slug: `B-${p.slug}`, group: 'B', sub: 'cbeta', work, source: 'cbeta', book_id: p.book_id, page_id: p.page_id, page_number: p.page_number, offset: w.offset, text: w.text, han: hanCount(w.text), sha256: sha(w.text) }));
      done = true; break;
    }
    if (!done) rows.push({ group: 'B', sub: 'cbeta', work, status: 'no-passage' });
  }
  return rows;
}
/** The Kanripo WYG leaf `pb` (e.g. KR3k0059_WYG_131-60a), Han only; inline notes kept: the leaf is what a page is scored against. */
async function leafText(krId, pb) {
  const juan = (pb.match(/_(\d{3})-/) || [])[1];
  const raw = await cachedFetch(`https://raw.githubusercontent.com/kanripo/${krId}/WYG/${krId}_${juan}.txt`, `${krId}_WYG_${juan}.txt`);
  const parts = raw.replace(/^#.*$/gm, '').split(/<pb:([^>]+)>/);
  for (let i = 1; i < parts.length; i += 2) if (parts[i] === pb) return clean(parts[i + 1]) || null;
  return null;
}
async function drawBpwyf(db) {
  const d = JSON.parse(fs.readFileSync(argOf('p5274'), 'utf8'));
  const rows = [];
  for (const fam of [...new Set(d.pages.map((p) => p.family))].sort()) {
    const rng = makeRng(seedOf(`B:${fam}`));
    const order = d.pages.filter((p) => p.family === fam && p.pb).map((p) => [rng(), p]).sort((a, b) => a[0] - b[0]).map(([, p]) => p);
    let done = false;
    for (const p of order) {
      const book = await db.collection('books').findOne({ id: p.book_id }, { projection: { work_id: 1 } });
      const kr = String(book?.work_id || '').replace(/^kr:/, '') || (p.pb.match(/^(KR\w+?)_/) || [])[1];
      const t = await leafText(kr, p.pb); if (!t) continue;
      const w = window(t, rng);
      if (hanCount(w.text) < MINHAN || candidates(w.text).length < 2) continue;
      rows.push(save({ slug: `B-${p.slug}`, group: 'B', sub: 'kanripo-8134', work: fam, source: 'kanripo', kr, pb: p.pb, book_id: p.book_id, page_id: p.page_id, page_number: p.page_number, offset: w.offset, text: w.text, han: hanCount(w.text), sha256: sha(w.text) }));
      done = true; break;
    }
    if (!done) rows.push({ group: 'B', sub: 'kanripo-8134', work: fam, status: 'no-passage' });
  }
  return rows;
}
// ── B-ext: Kanripo-screened Siku works (the qa_screen instrument: #5935, #7503), seeded, to make 40 works ──
async function drawBext(db, need, exclude) {
  const books = await db.collection('books').find({ work_id: /^kr:/, visible: true, pages_count: { $gt: 0 } }, { projection: { id: 1, title: 1, work_id: 1 } }).toArray();
  const byWork = new Map(); for (const b of books) { if (exclude.has(b.work_id.slice(3))) continue; if (!byWork.has(b.work_id)) byWork.set(b.work_id, []); byWork.get(b.work_id).push(b); }
  const rng = makeRng(seedOf('B-ext'));
  const works = [...byWork.keys()].sort().map((w) => [rng(), w]).sort((a, b) => a[0] - b[0]).map(([, w]) => w);
  const rows = []; let looked = 0;
  for (const wid of works) {
    if (rows.length >= need) break; looked++;
    const bs = byWork.get(wid).sort((a, b) => a.id.localeCompare(b.id)); const b = bs[Math.floor(rng() * bs.length)];
    const ps = await db.collection('pages').find({ book_id: b.id, 'ocr.qa_screen.status': 'screened' }, { projection: { id: 1, page_number: 1, 'ocr.qa_screen': 1 }, maxTimeMS: 60000 }).toArray();
    const ok = ps.filter((p) => p.ocr.qa_screen.dice >= 0.6 && p.ocr.qa_screen.pb).sort((x, y) => x.page_number - y.page_number);
    if (!ok.length) continue;
    const p = ok[Math.floor(rng() * ok.length)];
    const kr = wid.slice(3);
    const t = await leafText(kr, p.ocr.qa_screen.pb).catch(() => null); if (!t) continue;
    const w = window(t, rng);
    if (hanCount(w.text) < MINHAN || candidates(w.text).length < 2) continue;
    rows.push(save({ slug: `B-${b.id.slice(-6)}-p${p.page_number}`, group: 'B', sub: 'kanripo-screen', work: workOf(b.title), source: 'kanripo', kr, pb: p.ocr.qa_screen.pb, dice: p.ocr.qa_screen.dice, book_id: b.id, page_id: p.id, page_number: p.page_number, offset: w.offset, text: w.text, han: hanCount(w.text), sha256: sha(w.text) }));
    process.stdout.write('b');
  }
  console.log(`\nB-ext: ${rows.length} after ${looked} works of ${works.length}`);
  return rows;
}

// ── C: obscure. Non-Siku works whose title is in no Kanripo catalogue entry and not CBETA, and not famous (the list is
// the pre-registered frame, chosen by title before any text was read). The web-search check runs after this draw. ──
export const C_FRAME = ['萬國葯方', '華陽金仙證論', '道宗六書', '呂祖全書', '道言內外秘訣全書', '養生類纂', '泰定養生主論', '養生月覽', '淮南天文訓補注', '校註婦人良方大全',
  '崑曲粹存初集', '玉茗堂集', '盛明雜劇', '陳道翁就正篇', '瓊琯白先生集', '三才圖會', '重校韓夫人題紅記', '寰有詮', '新鐫節義鴛鴦塚嬌紅記', '陳眉公先生批評繡襦記',
  '新刻出相音註勸善目連救母行孝戲文', '欽定新曆測驗紀略', '西洋新法曆書', '靈臺儀象志', '歷學會通', '河工書', '增訂本草備要', '本草求真', '湖北安襄鄖道水利紀案', '重刊天文秘略',
  '天文初學考', '新制諸器圖說', '列子鬳齋口義', '天文圖註祥異賦', '新鐫神峰張先生通考闢謬命理正宗大全', '新鐫全像評釋古今情談萬選', '圖像本草蒙筌', '釋氏源流應化事蹟', '繪事發微', '程氏墨苑',
  '觀象玩占', '武備志', '考工記考辨', '考工記析疑', '御製數理精蘊', '蠶桑輯要', '銅人腧穴鍼灸圖經', '考工創物小記', '考工記車制圖解', '周禮圖說',
  '類經圖翼', '新編纂圖增類羣書類要事林廣記', '新編直指算法統宗', '灸法秘傳', '華氏中藏經', '玉靈照膽經', '河洛真數', '地球圖說', '新刊指南臺司袁天罡先生五星三命大全', '五行大義',
  '五百石洞天揮塵', '洞天奧旨', '景祐太乙福應經', '天文書', '太乙統宗寶鑑', '周天星位經緯宿度考', '植物名實圖考', '蘇東坡詩集注', '大明嘉靖三年大統曆', '臺灣番社風俗'];
const BODY_DROP = /^\s*<(header|footer|language|script|page-num|pagenum|folio|margin|meta|note-margin|scan-quality|page-type|warning|vocab|image-desc|figure)[^>]*>.*<\/\1>\s*$/i;
const bodyOf = (t) => stripMarkupTags(String(t || '').split('\n').filter((l) => !BODY_DROP.test(l) && !/^\s*<(language|script|scan-quality|page-type)\b/i.test(l)).join('\n'), '');
async function drawC(db, nonsiku) {
  const rows = []; const rng = makeRng(seedOf('C'));
  const works = C_FRAME.map((w) => [rng(), w]).sort((a, b) => a[0] - b[0]).map(([, w]) => w);
  for (const work of works) {
    const bs = nonsiku.filter((b) => (b.title || '').includes(work) || (b.core || '').startsWith(work.slice(0, 6))).sort((a, b) => a.id.localeCompare(b.id));
    if (!bs.length) { rows.push({ group: 'C', work, status: 'no-book' }); continue; }
    const wr = makeRng(seedOf(`C:${work}`));
    const order = bs.map((b) => [wr(), b]).sort((a, b) => a[0] - b[0]).map(([, b]) => b);
    let done = false;
    for (const b of order.slice(0, 3)) {
      const ps = await db.collection('pages').find({ book_id: b.id, page_number: { $gt: 2 }, 'ocr.data': { $exists: true } }, { projection: { id: 1, page_number: 1, 'ocr.data': 1, 'ocr.model': 1, photo: 1, archived_photo: 1, cropped_photo: 1, enhanced_photo: 1, photo_original: 1, split_from_spread: 1 }, maxTimeMS: 60000 }).sort({ page_number: 1 }).toArray();
      const sh = ps.map((p) => [wr(), p]).sort((a, b) => a[0] - b[0]).map(([, p]) => p);
      for (const p of sh.slice(0, 25)) {
        const raw = p.ocr?.data || '';
        if (/<table|<td|\|/i.test(raw)) continue;
        const t = clean(bodyOf(raw));
        if (hanCount(t) < 120) continue;
        const w = window(t, wr);
        if (candidates(w.text).length < 2) continue;
        const url = getPageSource(p); let img = null;
        try { const r = await fetch(url); if (r.ok) img = Buffer.from(await r.arrayBuffer()); } catch { /* none */ }
        if (!img) continue;
        const slug = `C-${b.id.slice(-6)}-p${p.page_number}`;
        fs.writeFileSync(path.join(PRIV, `${slug}.jpg`), img);
        rows.push(save({ slug, group: 'C', work, source: 'ours', ocr_model: p.ocr?.model || null, book_id: b.id, page_id: p.id, page_number: p.page_number, image_url: url, offset: w.offset, text: w.text, han: hanCount(w.text), sha256: sha(w.text) }));
        done = true; break;
      }
      if (done) break;
    }
    if (!done) rows.push({ group: 'C', work, status: 'no-page' });
    process.stdout.write(done ? 'c' : '.');
  }
  console.log('');
  return rows;
}

const c = await MongoClient.connect(process.env.MONGODB_URI); const db = c.db('bookstore');
const only = argOf('only', 'A,B,C').split(',');
const all = [];
if (only.includes('A')) { const a = await drawA(); all.push(...a); console.log(`A: ${a.filter((r) => r.slug).length}/${a.length}`); }
if (only.includes('B')) {
  const b1 = await drawBcbeta(db); const b2 = await drawBpwyf(db);
  const have = [...b1, ...b2].filter((r) => r.slug).length;
  const excl = new Set([...A_WORKS.map((x) => x[1]), ...b2.map((r) => r.kr).filter(Boolean)]);
  const b3 = await drawBext(db, 40 - have, excl);
  all.push(...b1, ...b2, ...b3); console.log(`B: cbeta ${b1.filter((r) => r.slug).length}, 8134 ${b2.filter((r) => r.slug).length}, ext ${b3.length}`);
}
if (only.includes('C')) { const nons = JSON.parse(fs.readFileSync(argOf('nonsiku'), 'utf8')); const cc = await drawC(db, nons); all.push(...cc); console.log(`C: ${cc.filter((r) => r.slug).length}/${cc.length}`); }
await c.close();
fs.writeFileSync(path.join(argOf('priv'), `draw-${only.join('')}.json`), JSON.stringify(all.map(({ text, ...r }) => r), null, 1));
