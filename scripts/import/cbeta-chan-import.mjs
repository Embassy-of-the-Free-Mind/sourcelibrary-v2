#!/usr/bin/env node
// PRIOR ART: scripts/import/derge-tengyur-import.mjs (#5497) — the importer shape copied here
// (insertBookIfNew, initialPublication hidden, hold BEFORE pages, makePageDoc, resumable adopt-the-
// shell, text written only where the alignment was measured). It aligns by BDRC folio LABELS; a
// woodblock print of another edition has none, so the claim here is the neighbour-anchor fit in
// scripts/lib/cbeta-fit.mjs. scripts/works-catalog/import-cbeta-text.mjs (#2554) writes CBETA text
// as scanless pages — the model #2554 rejected. scripts/batch/eternity-ab-5513.mjs is the
// release → chained-enrol driver the `translate` command follows.
//
// Fit CBETA's typed Chan texts to open scans, verify every page, publish after a by-eye check (#5566).
//
//   measure   --text T2076         FREE  fit + verify every page; writes <work>/<text>/fit.json
//   apply     --text T2076         DB    create the hidden, held books (one per scan volume) through
//                                        the acquisition gate; insert pages; write ocr on the pages
//                                        that passed — never over existing text
//   eyecheck  --text T2076         FREE  pick 2 written pages per book, fetch their images and texts
//                                        into <work>/<text>/eyecheck/ for a by-eye read
//   verdict   --text T2076 --book ID --page N --ok|--bad --note "…"   record one by-eye read
//   release   --text T2076         DB    books whose 2 pages passed by eye: release the hold
//                                        (→ ocr_complete) and publish
//   translate --text T2076         PAID  enrol written, untranslated pages in the chained Batch lane
//                                        under envelope cbeta-chan-2026-10 (cap $15)
//   report    --text T2076         FREE  the per-book row for #5566
//
// Every page written carries: ocr.source 'cbeta-xml-p5', the CBETA work id, the xml-p5 commit, the
// Taishō/Xuzangjing line range, the licence "CC BY-NC-SA 4.0 (CBETA)", content_hash, and the
// alignment evidence (identity, coverage, wrong-page control, rules version). ocr.engine is the
// specialist-engine shape the reader's page panel renders, so the licence shows on the page.
//
// Usage (Hetzner; never through a Vercel function):
//   node --env-file=/root/sourcelibrary/.env.production.local scripts/import/cbeta-chan-import.mjs measure --text T2076

import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { MongoClient, ObjectId } from 'mongodb';
import { insertBookIfNew } from '../lib/acquire-book.mjs';
import { makePageDoc } from '../lib/book-docs.mjs';
import { holdBook, releaseBook, isHeld } from '../lib/pipeline-hold.mjs';
import { initialPublication, setPublication } from '../lib/publication.mjs';
import { isHumanEdited } from '../lib/syriac-kraken-lane.mjs';
import { recountBook } from '../lib/page-counts.mjs';
import { contentHash } from '../lib/write-provenance.mjs';
import { callGemini } from '../lib/gemini-script-client.mjs';
import { costOf } from '../lib/model-pricing.mjs';
import {
  extractTei, foldHan, buildIndex, fitBook, verifyPage, spanText, changeAt, edgeColumn, FIT_RULES,
} from '../lib/cbeta-fit.mjs';

const argv = process.argv.slice(2);
const cmd = argv[0];
const val = (n, d = null) => { const i = argv.indexOf(`--${n}`); return i >= 0 ? argv[i + 1] : d; };
const has = (n) => argv.includes(`--${n}`);
const WORK = val('work', '/root/cbeta-5566');
const ISSUE = 5566;
const IMPORTER = 'script:cbeta-chan-import';
const CAMPAIGN = 'cbeta-chan-5566';
const HOLD = {
  reason: 'cbeta-chan-5566',
  issue: ISSUE,
  release: 'two pages of the book are read by eye against the image and match the fitted CBETA text ("read from image", #5566)',
  source: 'cbeta-chan-import',
};
const TEXT_SOURCE = 'cbeta-xml-p5';
const TRANSLATE_HOLD = 'cbeta-chan-translate-5566';
const PIPELINE = 'cbeta-chan-fit-5566';
const LICENCE = 'CC BY-NC-SA 4.0 (CBETA)';
const LICENCE_URL = 'https://www.cbeta.org/copyright.php';
const ENVELOPE_TAG = 'cbeta-chan-2026-10';
const ENVELOPE_CAP = 15;
const TR_RATE = 0.0012;   // chained AUTO_APPROVAL_USD_PER_PAGE (2× measured), as eternity-ab-5513.mjs

/**
 * The texts. `source.kind` names the scan adapter; `volumes` are in reading order. Rights are
 * checked per source before a text is added here (and recorded in `rights`).
 */
const NDL_RIGHTS = 'NDL item rights code "pdm" (Public Domain Mark), permission rule "internet" (dl.ndl.go.jp/api/item/search, read 2026-10-01)';
const ndl = (volumes, edition, year) => ({ kind: 'ndl', volumes, edition, year, rights: NDL_RIGHTS });
const TEXTS = {
  T2076: {
    cbeta: 'T2076', xml: 'T/T51/T51n2076.xml', canonRef: 'T51n2076', work_id: 'kr:KR6q0003',
    title: '景德傳燈錄', english: 'Jingde Record of the Transmission of the Lamp', author: '道原 (Daoyuan)',
    source: ndl(['2569893', '2569894', '2569895', '2569896', '2569897', '2569898', '2569790', '2569813', '2569899', '2569900'], 'Gozan edition (五山版), 貞和4 [1348]; NDL call no. WA6-45', 1348),
  },
  T1988: {
    cbeta: 'T1988', xml: 'T/T47/T47n1988.xml', canonRef: 'T47n1988', work_id: 'kr:KR6q0073',
    title: '雲門匡真禪師廣錄', english: 'Extensive Record of Chan Master Yunmen Kuangzhen', author: '雲門文偃 (Yunmen Wenyan); 守堅 (Shoujian), comp.',
    source: ndl(['2544321', '2544322', '2544323'], 'old movable-type edition (古活字版), 慶長18 [1613], 宗鐵重刊', 1613),
  },
  T1985: {
    cbeta: 'T1985', xml: 'T/T47/T47n1985.xml', canonRef: 'T47n1985', work_id: 'kr:KR6q0053',
    title: '鎮州臨濟慧照禪師語錄', english: 'Record of Linji (Recorded Sayings of Chan Master Linji Huizhao of Zhenzhou)', author: '臨濟義玄 (Linji Yixuan); 慧然 (Huiran), comp.',
    source: ndl(['2532108'], 'Gozan edition (五山版), Nanbokuchō period [1336–1392]', null),
  },
  T1997: {
    cbeta: 'T1997', xml: 'T/T47/T47n1997.xml', canonRef: 'T47n1997', work_id: 'kr:KR6q0059',
    title: '圓悟佛果禪師語錄', english: 'Recorded Sayings of Chan Master Yuanwu Foguo', author: '圜悟克勤 (Yuanwu Keqin); 紹隆 (Shaolong) et al., comp.',
    source: ndl(['2559927', '2559928', '2559929'], '明暦3 [1657] edition', 1657),
  },
  T1999: {
    cbeta: 'T1999', xml: 'T/T47/T47n1999.xml', canonRef: 'T47n1999', work_id: 'kr:KR6q0064',
    title: '密菴和尚語錄', english: 'Recorded Sayings of Master Mi\'an', author: '密菴咸傑 (Mi\'an Xianjie); 崇岳 (Chongyue), 了悟 (Liaowu) et al., comp.',
    source: ndl(['2569889', '2569890'], 'Gozan edition (五山版), Nanbokuchō period [1336–1392]', null),
  },
  T2000: {
    cbeta: 'T2000', xml: 'T/T47/T47n2000.xml', canonRef: 'T47n2000', work_id: 'kr:KR6q0065',
    title: '虛堂和尚語錄', english: 'Recorded Sayings of Master Xutang', author: '虛堂智愚 (Xutang Zhiyu); 妙源 (Miaoyuan), comp.',
    // The 寛文9 [1669] print (2576515…24) is the annotated 犁耕 edition: 3/511 spreads fit. This is the plain text.
    source: ndl(['2543706', '2543707', '2543708', '2543709'], 'old movable-type edition (古活字版), Keichō era [1596–1615]', null),
  },
  T2003: {
    cbeta: 'T2003', xml: 'T/T48/T48n2003.xml', canonRef: 'T48n2003', work_id: 'kr:KR6q0078',
    title: '佛果圜悟禪師碧巖錄', english: 'Blue Cliff Record', author: '雪竇重顯 (Xuedou Chongxian), verses; 圜悟克勤 (Yuanwu Keqin), commentary',
    source: ndl(['2543612', '2543613', '2543614', '2543615', '2543616'], 'Gozan edition (五山版), Muromachi period', null),
  },
  T1998A: {
    cbeta: 'T1998A', xml: 'T/T47/T47n1998A.xml', canonRef: 'T47n1998A', work_id: 'kr:KR6q0060',
    title: '大慧普覺禪師語錄', english: 'Recorded Sayings of Chan Master Dahui Pujue', author: '大慧宗杲 (Dahui Zonggao); 蘊聞 (Yunwen), comp.',
    source: ndl(['2559970', '2559971', '2559972'], 'Edo-period edition, 12 juan', null),
  },
  X1359: {
    cbeta: 'X1359', xml: 'X/X69/X69n1359.xml', canonRef: 'X69n1359', work_id: 'kr:KR6q0293',
    title: '應菴曇華禪師語錄', english: 'Recorded Sayings of Chan Master Ying\'an Tanhua', author: '應菴曇華 (Ying\'an Tanhua); 守詮 (Shouquan) et al., comp.',
    source: ndl(['2543568'], 'Gozan edition (五山版), 正應元 [1288]', 1288),
  },
  X1381: {
    cbeta: 'X1381', xml: 'X/X70/X70n1381.xml', canonRef: 'X70n1381', work_id: 'kr:KR6q0314',
    title: '破菴祖先禪師語錄', english: 'Recorded Sayings of Chan Master Po\'an Zuxian', author: '破菴祖先 (Po\'an Zuxian); 圓照 (Yuanzhao) et al., comp.',
    source: ndl(['2532099'], 'Gozan edition (五山版), 應安3 [1370]', 1370),
  },
  X1377: {
    cbeta: 'X1377', xml: 'X/X70/X70n1377.xml', canonRef: 'X70n1377', work_id: 'kr:KR6q0311',
    title: '松源崇嶽禪師語錄', english: 'Recorded Sayings of Chan Master Songyuan Chongyue', author: '松源崇嶽 (Songyuan Chongyue); 善開 (Shankai) et al., comp.',
    source: ndl(['2537781'], '元祿4 [1691] edition', 1691),
  },
  X1367: {
    cbeta: 'X1367', xml: 'X/X69/X69n1367.xml', canonRef: 'X69n1367', work_id: 'kr:KR6q0301',
    title: '笑隱大訢禪師語錄', english: 'Recorded Sayings of Chan Master Xiaoyin Daxin', author: '笑隱大訢 (Xiaoyin Daxin); 延俊 (Yanjun) et al., comp.',
    source: ndl(['2532110'], 'Gozan edition (五山版), early Muromachi', null),
  },
  X1372: {
    cbeta: 'X1372', xml: 'X/X69/X69n1372.xml', canonRef: 'X69n1372', work_id: 'kr:KR6q0306',
    title: '無文道燦禪師語錄', english: 'Recorded Sayings of Chan Master Wuwen Daocan', author: '無文道燦 (Wuwen Daocan); 惟康 (Weikang), comp.',
    source: ndl(['2545279'], 'Song print (宋刊), bound with 無文印', null),
  },
  // ── mode 1: books we already hold ──
  T2003N: {
    cbeta: 'T2003', xml: 'T/T48/T48n2003.xml', canonRef: 'T48n2003', work_id: null,
    title: '佛果圜悟禪師碧巖錄', english: 'Blue Cliff Record', author: '雪竇重顯; 圜悟克勤',
    source: { kind: 'held', reader: 'ndl', books: ['69bd05f8e26ef4b094821d72', '69bd063ae26ef4b094821ddf'], edition: '新鐫碧巌集, 1894 (NDL)', rights: NDL_RIGHTS },
  },
  T2005N: {
    cbeta: 'T2005', xml: 'T/T48/T48n2005.xml', canonRef: 'T48n2005', work_id: null,
    title: '無門關', english: 'Gateless Gate', author: '無門慧開',
    source: { kind: 'held', reader: 'ndl', books: ['69bd068be26ef4b094821e3e'], edition: '冠註無門関, 1910 (NDL)', rights: NDL_RIGHTS },
  },
  X1565: {
    cbeta: 'X1565', xml: 'X/X80/X80n1565.xml', canonRef: 'X80n1565', work_id: null,
    title: '五燈會元', english: 'Compendium of the Five Lamps', author: '普濟 (Puji)',
    source: { kind: 'held', reader: 'gemini', books: ['6a3cc1baec254ff6cae0e99d', '6a3cc1bdec254ff6cae0eaf8', '6a3cc1bbf9474f825c172777', '6a3cc1beec254ff6cae0ebb5', '6a3cc1c1ec254ff6cae0edc2', '6a3cc1bfec254ff6cae0ec64', '6a3cc1c0ec254ff6cae0ecff', '6a3cc1c2ec254ff6cae0ee53', '6a3cc1c3ec254ff6cae0ef14', '6a3cc1c7ec254ff6cae0f042', '6a3cc1cbf9474f825c17281e', '6a3cc1c6ec254ff6cae0ef7f', '6a3cc1ccec254ff6cae0f113', '6a3cc1ccf9474f825c1728bb', '6a3cc1cff9474f825c17296e', '6a3cc1d0f9474f825c172a4b', '6a3cc1d1f9474f825c172bb9', '6a3cc1d0f9474f825c172a4c', '6a3cc1d4f9474f825c172c59', '6a3cc1d6f9474f825c172e49'], edition: 'IA/CADAL 五燈會元 (20 vols)', rights: 'Internet Archive, publicdomain (already held)' },
  },
  X1318: {
    cbeta: 'X1318', xml: 'X/X68/X68n1318.xml', canonRef: 'X68n1318', work_id: 'kr:KR6q0265',
    title: '續古尊宿語要', english: 'Further Essential Sayings of the Ancient Worthies', author: '師明 (Shiming), comp.',
    source: ndl(['2545267', '2545268', '2545269', '2545270', '2545271'], 'Song print, Fuzhou Gushan (福州鼓山寺版), 紹興9 [1139]; surviving juan 2, 4–6', 1139),
  },
};

const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);
const textKey = val('text');
const T = TEXTS[textKey];
if (cmd && !T) throw new Error(`--text must be one of ${Object.keys(TEXTS).join(', ')}`);
const TDIR = path.join(WORK, textKey || 'none');
fs.mkdirSync(TDIR, { recursive: true });
const STATE = path.join(TDIR, 'state.json');
const state = fs.existsSync(STATE) ? JSON.parse(fs.readFileSync(STATE, 'utf8')) : { books: {}, eyecheck: {} };
const saveState = () => { fs.writeFileSync(`${STATE}.tmp`, JSON.stringify(state, null, 1)); fs.renameSync(`${STATE}.tmp`, STATE); };

async function fetchRetry(url, tries = 4) {
  for (let i = 0; ; i++) {
    try {
      const r = await fetch(url, { signal: AbortSignal.timeout(90000) });
      if (r.ok) return r;
      if (r.status === 404 || r.status === 403 || i >= tries - 1) throw new Error(`${r.status} ${url}`);
    } catch (e) { if (i >= tries - 1) throw e; }
    await new Promise((res) => setTimeout(res, 3000 * (i + 1)));
  }
}
async function cached(file, url, kind = 'text') {
  if (fs.existsSync(file)) return kind === 'json' ? JSON.parse(fs.readFileSync(file, 'utf8')) : fs.readFileSync(file, 'utf8');
  const r = await fetchRetry(url);
  const body = await r.text();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, body);
  return kind === 'json' ? JSON.parse(body) : body;
}

// ── the typed text, pinned ─────────────────────────────────────────────────
async function pinnedSha(repo, file) {
  if (fs.existsSync(file)) return fs.readFileSync(file, 'utf8').trim();
  const r = await (await fetchRetry(`https://api.github.com/repos/${repo}/commits/master`)).json();
  fs.writeFileSync(file, r.sha);
  return r.sha;
}
async function loadText() {
  const sha = await pinnedSha('cbeta-org/xml-p5', path.join(WORK, 'xml-p5.sha'));
  const msha = await pinnedSha('DILA-edu/cbeta-metadata', path.join(WORK, 'metadata.sha'));
  const xml = await cached(path.join(WORK, 'xml', path.basename(T.xml)), `https://raw.githubusercontent.com/cbeta-org/xml-p5/${sha}/${T.xml}`);
  const gaiji = await cached(path.join(WORK, 'gaiji.json'), `https://raw.githubusercontent.com/DILA-edu/cbeta-metadata/${msha}/gaiji/gaiji.json`, 'json');
  const ex = extractTei(xml, gaiji);
  const { f: F, map } = foldHan(ex.text);
  const toF = (at) => { let lo = 0, hi = map.length; while (lo < hi) { const m = (lo + hi) >> 1; if (map[m] < at) lo = m + 1; else hi = m; } return lo; };
  const structural = [...new Set([0, F.length, ...ex.juans.map((j) => toF(j.at))])].sort((a, b) => a - b);
  return { sha, msha, ex, F, map, structural };
}

// ── scan sources ───────────────────────────────────────────────────────────
// NDL: the IIIF manifest gives the canvases; NDL's own OCR of each page (lab.ndl.go.jp full text,
// NDL classical-text OCR — an engine that has never seen CBETA) is the independent cheap read. It
// costs nothing, so no Gemini call is made for verification.
async function sourcePages(db) {
  if (T.source.kind === 'held') return heldPages(db);
  if (T.source.kind !== 'ndl') throw new Error(`no adapter for source kind ${T.source.kind}`);
  const pages = [];
  for (const [vi, pid] of T.source.volumes.entries()) {
    const manifest = await cached(path.join(WORK, 'ndl', `${pid}.manifest.json`), `https://dl.ndl.go.jp/api/iiif/${pid}/manifest.json`, 'json');
    const full = await cached(path.join(WORK, 'ndl', `${pid}.json`), `https://lab.ndl.go.jp/dl/api/book/fulltext-json/${pid}`, 'json');
    const canvases = manifest.sequences[0].canvases;
    const byPage = new Map(full.list.map((x) => [x.page, x]));
    if (full.list.length !== canvases.length) log(`  ${pid}: ${full.list.length} OCR pages for ${canvases.length} canvases`);
    canvases.forEach((c, ci) => {
      const service = c.images[0].resource.service?.['@id'] || c.images[0].resource['@id'].replace(/\/full\/.*$/, '');
      const x = byPage.get(ci + 1);
      const lines = JSON.parse(x?.coordjson || '[]').map((e) => ({ text: e.contenttext, box: [e.xmin, e.ymin, e.xmax, e.ymax], h: e.ymax - e.ymin }));
      pages.push({ vol: vi, pid, n: ci + 1, canvas: c['@id'], service, width: c.width, height: c.height, read: x?.contents || '', lines });
    });
  }
  return pages;
}
const NDL_READ = { name: 'NDL classical-text OCR (lab.ndl.go.jp full text)', url: 'https://lab.ndl.go.jp/dl/api/book/fulltext-json/' };
const PAGE_MODEL = 'gemini-3.1-flash-lite';
const GEMINI_READ = { name: `this library's OCR of the page where it has one, else a ${PAGE_MODEL} column read`, url: null };
const READ_ENGINE = T?.source?.reader === 'gemini' ? GEMINI_READ : NDL_READ;

// ── mode 1: books we already hold ──────────────────────────────────────────
// Pages come from our own `pages` rows (never re-created). The read is NDL's OCR when the scan is
// NDL's; otherwise the page's existing OCR (an independent read of the image — written before
// CBETA was ever fitted) and, for a page with no text, a flash-lite read laid out one printed column
// per line. Existing OCR is never overwritten: such pages are measured and their agreement with
// the fitted span is reported, nothing more.
const META_BLOCKS = /<(vocab|warning|page-num|language|script|page-type|columns|header|footer|sig|meta|image-desc|scan-quality|summary|keywords|detected-images)\b[^>]*>[\s\S]*?<\/\1>/gi;
const cleanOcr = (t) => String(t || '').replace(META_BLOCKS, '\n').replace(/<\/?[a-zA-Z][^<>]*>/g, ' ').replace(/^#+\s*/gm, '');
const PAGE_PROMPT = 'This is one page (or an opened spread) of a classical Chinese woodblock print. Transcribe the main text exactly as printed, column by column in reading order (right to left), writing ONE output line per printed column, top to bottom. A stretch of small double-line interlinear characters belongs to its column: read its right sub-column, then its left, in the same output line. Omit the block-centre margin (title, juan number, leaf number) and any stamps or handwritten notes. Output only the characters and line breaks — no punctuation, no commentary.';

async function pageRead(p, cache) {
  if (cache[p.pageId]) return cache[p.pageId];
  const img = Buffer.from(await (await fetchRetry(p.photo)).arrayBuffer());
  let r;
  try {
    r = await callGemini({ model: PAGE_MODEL, prompt: PAGE_PROMPT, imageParts: [img], endpoint: 'scripts/import/cbeta-chan-import.mjs', type: 'ocr', triggeredBy: 'cbeta-chan-5566 verification read', bookId: p.bookId, pageIds: [p.pageId], maxOutputTokens: 3000 });
  } catch (e) { r = { text: '', finishReason: `error: ${String(e.message).slice(0, 120)}`, inputTokens: 0, outputTokens: 0 }; }
  const out = { text: r.text || '', finish: r.finishReason, usd: costOf(PAGE_MODEL, r.inputTokens || 0, r.outputTokens || 0), at: new Date().toISOString() };
  if (!String(out.finish).startsWith('error')) cache[p.pageId] = out;
  return out;
}

async function heldPages(db) {
  if (!db) throw new Error('held source needs the database');
  const pages = [];
  const CACHE = path.join(TDIR, 'page-reads.json');
  const cache = fs.existsSync(CACHE) ? JSON.parse(fs.readFileSync(CACHE, 'utf8')) : {};
  const todo = [];
  const only = val('only') ? new Set(String(val('only')).split(',').map(Number)) : null;   // trial on some volumes (1-based)
  for (const [vi, bookId] of T.source.books.entries()) {
    if (only && !only.has(vi + 1)) continue;
    const book = await db.collection('books').findOne({ id: bookId }, { projection: { id: 1, image_source: 1 } });
    if (!book) throw new Error(`held book ${bookId} not found`);
    const rows = await db.collection('pages').find({ book_id: bookId, page_number: { $gt: 0 } }, { projection: { id: 1, page_number: 1, photo: 1, archived_photo: 1, image_width: 1, image_height: 1, ocr: 1 } }).sort({ page_number: 1 }).toArray();
    let ndlByPage = null;
    if (T.source.reader === 'ndl') {
      const pid = String(book.image_source?.source_url || book.image_source?.iiif_manifest || '').match(/iiif\/(\d+)\/manifest/)?.[1];
      if (!pid) throw new Error(`${bookId}: no NDL pid in image_source`);
      const full = await cached(path.join(WORK, 'ndl', `${pid}.json`), `https://lab.ndl.go.jp/dl/api/book/fulltext-json/${pid}`, 'json');
      ndlByPage = new Map(full.list.map((x) => [x.page, x]));
      book.ndl_pid = pid;
    }
    for (const r of rows) {
      const p = { vol: vi, pid: bookId, n: r.page_number, bookId, pageId: r.id, photo: r.archived_photo || r.photo, width: r.image_width, height: r.image_height,
        existing: !!(r.ocr?.data && r.ocr.source !== TEXT_SOURCE), ours: r.ocr?.source === TEXT_SOURCE };
      if (ndlByPage) {
        const m = String(r.photo || '').match(/\/R(\d{7})\//);
        const x = ndlByPage.get(m ? Number(m[1]) : r.page_number);
        p.read = x?.contents || '';
        p.lines = JSON.parse(x?.coordjson || '[]').map((e) => ({ text: e.contenttext, box: [e.xmin, e.ymin, e.xmax, e.ymax], h: e.ymax - e.ymin }));
        p.service = `https://dl.ndl.go.jp/api/iiif/${book.ndl_pid}/R${String(m ? Number(m[1]) : r.page_number).padStart(7, '0')}`;
        p.read_url = `${NDL_READ.url}${book.ndl_pid}`;
      } else if (p.existing) {
        p.read = cleanOcr(r.ocr.data);
        p.read_url = `existing ocr (${r.ocr.model || r.ocr.source || 'unknown'})`;
      } else {
        todo.push(p);
      }
      pages.push(p);
    }
  }
  // Pages with no text get the column read (cached; never paid twice).
  let done = 0;
  const queue = [...todo];
  const worker = async () => {
    for (let p = queue.shift(); p; p = queue.shift()) {
      const r = await pageRead(p, cache);
      p.read = r.text; p.read_url = `${PAGE_MODEL} column read`;
      if (++done % 50 === 0) { fs.writeFileSync(CACHE, JSON.stringify(cache)); log(`  page reads ${done}/${todo.length} ($${Object.values(cache).reduce((n, x) => n + (x.usd || 0), 0).toFixed(3)})`); }
    }
  };
  if (todo.length) { log(`${textKey}: ${todo.length} pages without text need a read`); await Promise.all([1, 2, 3, 4].map(worker)); fs.writeFileSync(CACHE, JSON.stringify(cache)); }
  for (const p of pages) if (!p.lines) p.lines = String(p.read || '').split('\n').filter((l) => l.trim()).map((l) => ({ text: l, box: [null, null, null, null], h: 0 }));
  return pages;
}

// ── measure ────────────────────────────────────────────────────────────────
const EDGE_MODEL = 'gemini-3.1-flash-lite';
const EDGE_PROMPT = 'This image is one vertical column (sometimes two adjacent columns) cut from a page of a classical Chinese woodblock print. It may include a stretch of small characters printed as two half-width sub-columns (an interlinear note). Transcribe every character in reading order — top to bottom, right column first; inside a small-character stretch read the right sub-column, then the left. Output only the characters — no punctuation, no spaces, no commentary.';

/**
 * A second engine's read of one edge column (only where the NDL column reads disagree on a
 * boundary): the column's box from NDL's own line layout, cut from the IIIF image server, read by
 * flash-lite through the metered script client. Cached per page and side; never paid twice.
 */
async function edgeRead(p, col, cache) {
  // The crop is the column's x-range over the FULL frame height — not NDL's line box — so the
  // second engine reads the whole column (notes, the characters after them) independently of how
  // NDL segmented it.
  const [x0, y0, x1, y1] = col.box;
  const key = `${p.pid}:${p.n}:col:${Math.round(x0)}-${Math.round(x1)}`;
  if (cache[key]) return cache[key];
  const w = x1 - x0, h = y1 - y0;
  const x = Math.max(0, Math.round(x0 - 0.12 * w)), y = Math.max(0, Math.round(y0 - 60));
  const region = `${x},${y},${Math.round(w * 1.24)},${Math.round(h + 140)}`;
  const url = `${p.service}/${region}/,1400/0/default.jpg`;
  const img = Buffer.from(await (await fetchRetry(url)).arrayBuffer());
  let r;
  try {
    r = await callGemini({ model: EDGE_MODEL, prompt: EDGE_PROMPT, imageParts: [img], endpoint: 'scripts/import/cbeta-chan-import.mjs', type: 'ocr', triggeredBy: `cbeta-chan-5566 edge column`, maxOutputTokens: 400 });
  } catch (e) { r = { text: '', finishReason: `error: ${String(e.message).slice(0, 120)}`, inputTokens: 0, outputTokens: 0 }; }
  const out = { text: r.text || '', finish: r.finishReason, usd: costOf(EDGE_MODEL, r.inputTokens || 0, r.outputTokens || 0), url, at: new Date().toISOString() };
  if (!String(out.finish).startsWith('error')) cache[key] = out;   // a 503 is retried next run, not remembered
  return out;
}

async function measure(db) {
  const { sha, ex, F, map, structural } = await loadText();
  const src = await sourcePages(db);
  const pages = src.map((p) => ({ read: foldHan(p.read).f, lines: p.lines.map((l) => ({ f: foldHan(l.text).f, h: l.h, x0: l.box[0] ?? undefined, y0: l.box[1] ?? undefined, x1: l.box[2] ?? undefined, y1: l.box[3] ?? undefined })) }));
  const idx = buildIndex(F);
  // Pass 1: NDL's reads alone. Pass 2: a second read of the edge columns where they disagree.
  let fit = fitBook(pages, F, idx, structural);
  const CACHE = path.join(TDIR, 'edge-reads.json');
  const cache = fs.existsSync(CACHE) ? JSON.parse(fs.readFileSync(CACHE, 'utf8')) : {};
  const needs = [...new Set(fit.boundaries.flatMap((b) => b.needs || []))];
  log(`${textKey}: pass 1 — ${fit.pages.filter((x) => x.span).length} pages fitted; ${needs.length} edge columns to read a second time`);
  const evidence = new Map();
  let done = 0;
  const queue = [...needs];
  const worker = async () => {
    for (let nd = queue.shift(); nd; nd = queue.shift()) {
      const [i, side] = nd.split(':');
      const col = edgeColumn(pages[Number(i)].lines, side);
      if (!col?.box) continue;
      const r = await edgeRead(src[Number(i)], col, cache);
      if (++done % 50 === 0) { fs.writeFileSync(CACHE, JSON.stringify(cache)); log(`  edge reads ${done}/${needs.length}`); }
      if (r.text) evidence.set(nd, foldHan(r.text).f);
    }
  };
  await Promise.all([1, 2, 3, 4].map(worker));
  fs.writeFileSync(CACHE, JSON.stringify(cache));
  if (needs.length) fit = fitBook(pages, F, idx, structural, evidence);
  const edgeUsd = Object.values(cache).reduce((n, r) => n + (r.usd || 0), 0);
  const spans = fit.pages.map((x) => x.span);
  const reads = pages.map((p) => p.read);
  const rows = src.map((p, i) => {
    const r = fit.pages[i];
    const row = { i, vol: p.vol, pid: p.pid, n: p.n, read_chars: reads[i].length, ...(T.source.kind === 'held' ? { page_id: p.pageId, existing_ocr: p.existing, read_url: p.read_url } : {}) };
    if (!r.span) return { ...row, written: false, why: r.why };
    const v = verifyPage(i, reads, spans, F);
    const text = spanText(ex.text, map, r.span[0], r.span[1], F);
    const a = map[r.span[0]], b = map[r.span[1] - 1];
    return {
      ...row, written: v.pass, why: v.pass ? null : v.reasons.join('; '), edges: r.edges,
      verify: v, span: r.span, chars: text.length, content_hash: contentHash(text),
      lines: [changeAt(ex.lbs, a, 'lb'), changeAt(ex.lbs, b, 'lb')], juan: [changeAt(ex.juans, a, 'n'), changeAt(ex.juans, b, 'n')],
    };
  });
  const out = {
    text: textKey, cbeta: T.cbeta, xml_sha: sha, rules: FIT_RULES, read_engine: READ_ENGINE.name, edge_engine: EDGE_MODEL,
    measured_at: new Date().toISOString(), edge_reads: Object.keys(cache).length, edge_usd: +edgeUsd.toFixed(4),
    typed: { chars: ex.text.length, han: F.length, unresolved_gaiji: ex.unresolvedGaiji },
    pages: rows.length, written: rows.filter((r) => r.written).length,
    ...(T.source.kind === 'held' ? { held: { writable: rows.filter((r) => r.written && !r.existing_ocr).length, existing_ocr_fitted: rows.filter((r) => r.written && r.existing_ocr).length, existing_ocr: rows.filter((r) => r.existing_ocr).length } } : {}),
    refused: Object.entries(rows.filter((r) => !r.written).reduce((m, r) => { const k = String(r.why).split(/[ ;]/)[0].replace(/-?\d+$/, ''); m[k] = (m[k] || 0) + 1; return m; }, {})),
    boundaries: Object.entries(fit.boundaries.reduce((m, b) => { const k = b.position != null ? (b.votes?.variant_gap ? 'set-variant-gap' : b.votes?.last2 != null || b.votes?.first2 != null ? 'set-with-second-read' : b.votes?.structural != null ? 'set-structural' : 'set-columns-agree') : String(b.why).replace(/-\d+$/, ''); m[k] = (m[k] || 0) + 1; return m; }, {})),
    controls: summarise(rows.filter((r) => r.verify)),
    rows,
  };
  fs.writeFileSync(path.join(TDIR, 'fit.json'), JSON.stringify(out));
  if (out.held) log(`${textKey}: held — ${JSON.stringify(out.held)}`);
  log(`${textKey}: ${out.written}/${out.pages} pages pass; refused ${JSON.stringify(out.refused)}; boundaries ${JSON.stringify(out.boundaries)}; ${JSON.stringify(out.controls)}; edge reads ${out.edge_reads} ($${out.edge_usd})`);
}
function summarise(rows) {
  const q = (xs, p) => { const s = [...xs].sort((a, b) => a - b); return s.length ? s[Math.min(s.length - 1, Math.floor(p * s.length))] : null; };
  const w = rows.filter((r) => r.written);
  return {
    written_identity_median: q(w.map((r) => r.verify.identity), 0.5), written_identity_p10: q(w.map((r) => r.verify.identity), 0.1),
    written_control_median: q(w.map((r) => r.verify.control), 0.5), written_control_max: q(w.map((r) => r.verify.control), 1 - 1e-9),
    written_margin_min: q(w.map((r) => r.verify.margin), 0),
  };
}

// ── apply ──────────────────────────────────────────────────────────────────
function volumeTitle(v, juanRange) {
  const n = T.source.volumes.length;
  const j = juanRange ? (juanRange[0] === juanRange[1] ? `卷${juanRange[0]}` : `卷${juanRange[0]}–${juanRange[1]}`) : null;
  if (n === 1) return { title: T.title, display_title: `${T.title} (${T.english})` };
  return {
    title: `${T.title}${j ? ` ${j}` : ''} (vol ${v + 1} of ${n})`,
    display_title: `${T.title} (${T.english})${j ? `, ${j.replace('卷', 'juan ')}` : ''} — vol. ${v + 1} of ${n}`,
  };
}

async function apply(db) {
  const fit = JSON.parse(fs.readFileSync(path.join(TDIR, 'fit.json'), 'utf8'));
  const { sha, ex, F, map } = await loadText();
  if (sha !== fit.xml_sha) throw new Error(`fit.json was measured on xml-p5 ${fit.xml_sha}, the pin is now ${sha} — re-measure`);
  if (T.source.kind === 'held') return applyHeld(db, fit, sha, ex, F, map);
  const pages = await sourcePages(db);
  const books = db.collection('books');
  const pagesC = db.collection('pages');
  const now = new Date();
  for (const [v, pid] of T.source.volumes.entries()) {
    const vp = pages.filter((p) => p.vol === v);
    const vr = fit.rows.filter((r) => r.vol === v);
    const juans = vr.filter((r) => r.written).flatMap((r) => r.juan).filter((x) => x != null);
    const jr = juans.length ? [Math.min(...juans), Math.max(...juans)] : null;
    const manifestUrl = `https://dl.ndl.go.jp/api/iiif/${pid}/manifest.json`;
    let book = await books.findOne({ 'image_source.provider': 'ndl_japan', 'image_source.identifier': pid }, { projection: { id: 1 } });
    if (!book) {
      const _id = new ObjectId();
      const { hidden_reason: hiddenReason, ...publication } = initialPublication({ state: 'hidden', reason: 'curation', note: `${HOLD.reason}: imported hidden; published after a by-eye check of two pages`, by: IMPORTER, issue: ISSUE, now });
      const t = volumeTitle(v, jr);
      const r = await insertBookIfNew(db, {
        _id: String(_id), id: String(_id),
        slug: `${T.cbeta.toLowerCase()}-ndl-${pid}`,
        title: t.title, display_title: t.display_title, original_title: T.title,
        author: T.author,
        language: 'Classical Chinese', languages: ['Classical Chinese'],
        ...(T.source.year ? { year: T.source.year } : {}), published: T.source.edition,
        content_type: 'book',
        collections: ['zen-chan', 'chinese-buddhist-texts'],
        work_id: T.work_id,
        description: `${T.title} (${T.english}), volume ${v + 1} of ${T.source.volumes.length} of the ${T.source.edition} in the National Diet Library. Page text: the CBETA digital edition (${T.canonRef}, ${LICENCE}), fitted page by page to this print and checked against an independent reading of each image; pages where the fit could not be verified carry no text.`,
        pages_count: vp.length, pages_ocr: 0, pages_translated: 0, pages_archived: 0,
        status: 'draft',
        ...publication,
        image_source: {
          provider: 'ndl_japan', provider_name: 'National Diet Library of Japan', identifier: pid,
          iiif_manifest: manifestUrl, source_url: `https://dl.ndl.go.jp/pid/${pid}`,
          license: 'publicdomain', license_url: 'https://creativecommons.org/publicdomain/mark/1.0/',
          attribution: '国立国会図書館 National Diet Library, JAPAN', access_date: now.toISOString(),
          contributing_library: 'National Diet Library of Japan', rights_note: T.source.rights,
        },
        contributing_library: 'National Diet Library of Japan',
        dublin_core: { dc_identifier: [`IIIF:${manifestUrl}`, `doi:10.11501/${pid}`], dc_source: manifestUrl },
        catalog_ids: { ndl_pid: pid, cbeta: T.cbeta, cbeta_canon_ref: T.canonRef },
        catalog_metadata: {
          source: 'ndl_iiif', volume: v + 1, volumes: T.source.volumes.length,
          text_edition: { name: 'CBETA XML P5', work: T.canonRef, repo: 'https://github.com/cbeta-org/xml-p5', commit: sha, path: T.xml, licence: LICENCE, licence_url: LICENCE_URL },
        },
        acquisition_campaign: CAMPAIGN,
        notes: `Imported by scripts/import/cbeta-chan-import.mjs (#${ISSUE}). Text: CBETA ${T.canonRef} @ ${sha.slice(0, 10)} (${LICENCE}); written only on pages whose fit passed rules v${fit.rules.version}.`,
        created_at: now, updated_at: now,
      }, { importer: IMPORTER, sourceIdentifier: `ndl:${pid}`, sourceUrl: manifestUrl });
      if (!r.inserted) { log(`vol ${v + 1} ${pid}: acquisition gate declined — ${r.message}`); state.books[pid] = { declined: r.message }; saveState(); continue; }
      book = { id: r.bookId };
      await books.updateOne({ id: book.id }, { $set: { hidden_reason: hiddenReason } });
      log(`vol ${v + 1} ${pid}: created ${book.id}`);
    } else log(`vol ${v + 1} ${pid}: adopting ${book.id}`);
    const h = await holdBook(db, book.id, { ...HOLD, detail: { text: T.cbeta, ndl_pid: pid } });
    if (!['held', 'already_held'].includes(h.outcome)) {
      // This job's own translation hold (cbeta-chan-translate-5566) keeps every lane off the book too.
      const cur = await books.findOne({ id: book.id }, { projection: { 'pipeline_auto.hold.reason': 1 } });
      if (cur?.pipeline_auto?.hold?.reason !== TRANSLATE_HOLD) throw new Error(`${pid}: hold ${h.outcome} — refusing to write pages`);
    }

    const existing = new Map((await pagesC.find({ book_id: book.id }, { projection: { page_number: 1, ocr: 1 } }).toArray()).map((p) => [p.page_number, p]));
    const toInsert = [];
    let written = 0, keptExisting = 0, refitted = 0, withdrawn = 0;
    for (const p of vp) {
      const row = vr.find((r) => r.n === p.n);
      const ocr = row?.written ? ocrFor(row, sha, ex, map, F, fit, p) : null;
      const ex0 = existing.get(p.n);
      if (ex0) {
        const ours = ex0.ocr?.source === TEXT_SOURCE && ex0.ocr?.pipeline === PIPELINE && !isHumanEdited(ex0.ocr);
        if (ocr && !ex0.ocr?.data && !isHumanEdited(ex0.ocr)) {
          const u = await pagesC.updateOne({ _id: ex0._id, $or: [{ 'ocr.data': { $exists: false } }, { 'ocr.data': null }, { 'ocr.data': '' }] }, { $set: { ocr, updated_at: now } });
          written += u.modifiedCount;
        } else if (ours && ocr && ex0.ocr.content_hash !== ocr.content_hash) {
          // This job's own text from an earlier rules version, on a hidden, held book: re-fit.
          await pagesC.updateOne({ _id: ex0._id, 'ocr.pipeline': PIPELINE }, { $set: { ocr, updated_at: now } });
          refitted++; written++;
        } else if (ours && !ocr) {
          // This job's own text on a page the current rules refuse: take it back.
          await pagesC.updateOne({ _id: ex0._id, 'ocr.pipeline': PIPELINE }, { $unset: { ocr: '' }, $set: { updated_at: now } });
          withdrawn++;
        } else if (ocr && ex0.ocr?.data && ex0.ocr.source !== TEXT_SOURCE) keptExisting++;
        else if (ex0.ocr?.source === TEXT_SOURCE) written++;
        continue;
      }
      const _id = new ObjectId();
      toInsert.push(makePageDoc({
        _id: String(_id), id: String(_id), book_id: book.id, page_number: p.n,
        photo: `${p.service}/full/2000,/0/default.jpg`, photo_original: `${p.service}/full/2000,/0/default.jpg`,
        thumbnail: `${p.service}/full/200,/0/default.jpg`,
        image_width: p.width, image_height: p.height,
        source_ref: p.service.replace(/^https:\/\/dl\.ndl\.go\.jp\/api\/iiif\//, 'ndl:'),
        catalog_metadata: { source: 'ndl_iiif', canvas: p.canvas },
        ...(ocr ? { ocr } : {}),
        created_at: now, updated_at: now,
      }));
      if (ocr) written++;
    }
    for (let k = 0; k < toInsert.length; k += 500) await pagesC.insertMany(toInsert.slice(k, k + 500), { ordered: false });
    await recountBook(db, book.id, { reason: IMPORTER });
    const nPages = await pagesC.countDocuments({ book_id: book.id });
    const nText = await pagesC.countDocuments({ book_id: book.id, 'ocr.source': TEXT_SOURCE });
    state.books[pid] = { ...(state.books[pid] || {}), book_id: book.id, vol: v + 1, pages: nPages, written: nText, refused: vr.filter((r) => !r.written).length, kept_existing: keptExisting, refitted, withdrawn, rules: fit.rules.version, juan: jr, at: now.toISOString() };
    saveState();
    log(`vol ${v + 1} ${pid} → ${book.id}: ${nPages} pages, ${nText} with fitted text, ${state.books[pid].refused} refused${refitted || withdrawn ? ` (re-fitted ${refitted}, withdrawn ${withdrawn})` : ''}`);
  }
}

function ocrFor(row, sha, ex, map, F, fit, p) {
  const text = spanText(ex.text, map, row.span[0], row.span[1], F);
  if (contentHash(text) !== row.content_hash) throw new Error(`page ${p.pid}/${p.n}: text differs from the measured fit — re-measure`);
  const now = new Date();
  return {
    data: text,
    content_hash: row.content_hash,
    language: 'Classical Chinese',
    source: TEXT_SOURCE,
    model: `cbeta-xml-p5@${sha.slice(0, 10)}`,
    pipeline: PIPELINE,
    licence: LICENCE,
    engine: {
      name: 'CBETA XML P5', version: sha.slice(0, 10),
      model: T.canonRef, model_label: `CBETA digital edition, ${T.canonRef} (${T.title}), fitted to this page`,
      model_url: `https://github.com/cbeta-org/xml-p5/blob/${sha}/${T.xml}`, revision: sha, revision_source: 'logged',
      licence: LICENCE, run: `${PIPELINE} ${now.toISOString().slice(0, 10)}`, issue: ISSUE,
    },
    text_edition: {
      name: 'CBETA XML P5', work: T.canonRef, cbeta_id: T.cbeta, repo: 'https://github.com/cbeta-org/xml-p5', commit: sha, path: T.xml,
      lines: row.lines, juan: row.juan, licence: LICENCE, licence_url: LICENCE_URL,
      conventions: 'CBETA reading text: inline notes (the print\'s small double-line characters) in （）; editorial notes and variant readings dropped (lemma kept); CBETA/Taishō punctuation; gaiji as Unicode, else CBETA\'s normalised form, else 〔composition〕.',
      issue: ISSUE,
    },
    alignment: {
      method: 'neighbour anchors: the page\'s boundaries are where the independent reads of the adjacent pages meet in the typed text (rules in scripts/lib/cbeta-fit.mjs)',
      read_engine: READ_ENGINE.name, read_url: p.read_url || `${READ_ENGINE.url}${p.pid}`,
      identity: row.verify.identity, coverage: row.verify.coverage, control: row.verify.control, margin: row.verify.margin,
      span_chars: row.verify.span_chars, read_chars: row.verify.read_chars, boundary_votes: row.edges,
      second_read_engine: fit.edge_engine,
      rules: fit.rules, measured_at: fit.measured_at,
    },
    generated_at: now, updated_at: now,
  };
}

/**
 * Mode 1: write fitted text onto our own pages that have NO text, in books whose two by-eye pages
 * passed (checked from the measured spans BEFORE anything is written — a held book may already be
 * public). Existing OCR is never touched; its agreement with the fitted span is reported.
 */
async function applyHeld(db, fit, sha, ex, F, map) {
  const pages = await sourcePages(db);
  const pagesC = db.collection('pages');
  const now = new Date();
  const med = (xs) => { const t = [...xs].sort((a, b) => a - b); return t.length ? t[Math.floor(t.length / 2)] : null; };
  for (const [v, bookId] of T.source.books.entries()) {
    const vp = pages.filter((p) => p.vol === v);
    const vr = fit.rows.filter((r) => r.vol === v);
    const hashes = new Map(vr.filter((r) => r.written).map((r) => [String(r.n), r.content_hash]));
    const ev = Object.entries(state.eyecheck[bookId] || {}).filter(([n, e]) => e.content_hash && hashes.get(n) === e.content_hash);
    const agree = vr.filter((r) => r.existing_ocr && r.verify).map((r) => r.verify.identity);
    const base = { book_id: bookId, vol: v + 1, mode: 'held', pages: vp.length, existing_ocr: vp.filter((p) => p.existing).length,
      existing_fitted: vr.filter((r) => r.existing_ocr && r.written).length, existing_identity_median: med(agree),
      writable: vr.filter((r) => r.written && !r.existing_ocr).length, rules: fit.rules.version };
    if (ev.length < 2 || ev.some(([, e]) => e.verdict !== 'pass')) {
      state.books[bookId] = { ...(state.books[bookId] || {}), ...base, awaiting: 'by-eye check of 2 measured pages' };
      saveState();
      log(`${bookId}: by-eye check not passed on the measured text (${ev.map(([n, e]) => `p${n}:${e.verdict}`).join(' ') || 'none'}) — nothing written`);
      continue;
    }
    const h = await holdBook(db, bookId, { ...HOLD, detail: { text: T.cbeta, mode: 'held' } });
    if (!['held', 'already_held'].includes(h.outcome)) { log(`${bookId}: hold ${h.outcome} — skipped`); continue; }
    let written = 0, refitted = 0, withdrawn = 0, keptExisting = 0;
    for (const p of vp) {
      if (p.existing) continue;
      const row = vr.find((r) => r.n === p.n);
      const ocr = row?.written ? ocrFor(row, sha, ex, map, F, fit, p) : null;
      const cur = await pagesC.findOne({ id: p.pageId }, { projection: { ocr: 1 } });
      if (cur?.ocr?.data && cur.ocr.source !== TEXT_SOURCE) { keptExisting++; continue; }   // text arrived since the measure
      if (isHumanEdited(cur?.ocr)) continue;
      if (ocr && !cur?.ocr?.data) {
        const u = await pagesC.updateOne({ id: p.pageId, $or: [{ 'ocr.data': { $exists: false } }, { 'ocr.data': null }, { 'ocr.data': '' }] }, { $set: { ocr, updated_at: now } });
        written += u.modifiedCount;
      } else if (ocr && cur.ocr.pipeline === PIPELINE && cur.ocr.content_hash !== ocr.content_hash) {
        await pagesC.updateOne({ id: p.pageId, 'ocr.pipeline': PIPELINE }, { $set: { ocr, updated_at: now } }); refitted++;
      } else if (!ocr && cur?.ocr?.pipeline === PIPELINE) {
        await pagesC.updateOne({ id: p.pageId, 'ocr.pipeline': PIPELINE }, { $unset: { ocr: '' }, $set: { updated_at: now } }); withdrawn++;
      }
    }
    await recountBook(db, bookId, { reason: IMPORTER });
    const nText = await pagesC.countDocuments({ book_id: bookId, 'ocr.source': TEXT_SOURCE });
    state.books[bookId] = { ...(state.books[bookId] || {}), ...base, awaiting: null, written: nText, refused: vr.filter((r) => !r.written && !r.existing_ocr).length, kept_existing: keptExisting, refitted, withdrawn, at: now.toISOString() };
    saveState();
    log(`${bookId}: ${vp.length} pages; ${nText} with fitted text (+${written}, re-fitted ${refitted}, withdrawn ${withdrawn}); existing OCR on ${base.existing_ocr} pages, ${base.existing_fitted} of them fit (median identity ${base.existing_identity_median})`);
  }
}

/** Held books: the by-eye pages are cut from the MEASURED fit, before anything is written. */
async function eyecheckHeld(db) {
  const fit = JSON.parse(fs.readFileSync(path.join(TDIR, 'fit.json'), 'utf8'));
  const { ex, F, map } = await loadText();
  const dir = path.join(TDIR, 'eyecheck');
  fs.mkdirSync(dir, { recursive: true });
  for (const [v, bookId] of T.source.books.entries()) {
    const cand = fit.rows.filter((r) => r.vol === v && r.written && !r.existing_ocr);
    if (cand.length < 2) { log(`${bookId}: only ${cand.length} writable pages`); continue; }
    const ent = state.eyecheck[bookId] || {};
    const hashNow = new Map(cand.map((r) => [String(r.n), r.content_hash]));
    for (const n of Object.keys(ent)) if (ent[n].content_hash !== hashNow.get(n)) delete ent[n];
    state.eyecheck[bookId] = ent;
    if (Object.keys(ent).length >= 2) { log(`${bookId}: 2 pages already checked on their current text`); continue; }
    const seed = parseInt(bookId.slice(-6), 16);
    const picks = [cand[seed % Math.ceil(cand.length / 2)], cand[Math.ceil(cand.length / 2) + (seed % Math.floor(cand.length / 2))]]
      .filter((r) => !ent[String(r.n)]).slice(0, 2 - Object.keys(ent).length);
    for (const r of picks) {
      const pg = await db.collection('pages').findOne({ id: r.page_id }, { projection: { photo: 1, archived_photo: 1 } });
      const stem = path.join(dir, `${bookId}-p${r.n}`);
      const url = pg.archived_photo || pg.photo;
      if (!fs.existsSync(`${stem}.jpg`)) fs.writeFileSync(`${stem}.jpg`, Buffer.from(await (await fetchRetry(url)).arrayBuffer()));
      fs.writeFileSync(`${stem}.txt`, spanText(ex.text, map, r.span[0], r.span[1], F));
      ent[String(r.n)] = { pid: bookId, image: `${stem}.jpg`, content_hash: r.content_hash, verdict: null };
      log(`${bookId} p${r.n}: ${stem}.jpg / .txt`);
    }
  }
  saveState();
}

// ── by-eye check ───────────────────────────────────────────────────────────
async function eyecheck(db) {
  if (T.source.kind === 'held') return eyecheckHeld(db);
  const dir = path.join(TDIR, 'eyecheck');
  fs.mkdirSync(dir, { recursive: true });
  for (const [pid, b] of Object.entries(state.books)) {
    if (!b.book_id) continue;
    const ps = await db.collection('pages').find({ book_id: b.book_id, 'ocr.source': TEXT_SOURCE }, { projection: { page_number: 1, photo: 1, 'ocr.data': 1, 'ocr.content_hash': 1 } }).sort({ page_number: 1 }).toArray();
    if (ps.length < 2) { log(`${pid}: only ${ps.length} written pages`); continue; }
    // A verdict counts while the page still carries the text that was read; drop the rest.
    const hashNow = new Map(ps.map((p) => [String(p.page_number), p.ocr.content_hash]));
    const ent = state.eyecheck[b.book_id] || {};
    for (const n of Object.keys(ent)) if (ent[n].content_hash !== hashNow.get(n)) delete ent[n];
    state.eyecheck[b.book_id] = ent;
    const valid = Object.keys(ent).length;
    if (valid >= 2) { log(`${pid}: ${valid} pages already checked on their current text`); continue; }
    // Deterministic, spread: one from each half of the book.
    const seed = parseInt(b.book_id.slice(-6), 16);
    const picks = [ps[seed % Math.ceil(ps.length / 2)], ps[Math.ceil(ps.length / 2) + (seed % Math.floor(ps.length / 2))]]
      .filter((p) => !ent[String(p.page_number)]).slice(0, 2 - valid);
    for (const p of picks) {
      const stem = path.join(dir, `${pid}-p${p.page_number}`);
      if (!fs.existsSync(`${stem}.jpg`)) fs.writeFileSync(`${stem}.jpg`, Buffer.from(await (await fetchRetry(p.photo.replace('/full/2000,/', '/full/1600,/'))).arrayBuffer()));
      fs.writeFileSync(`${stem}.txt`, p.ocr.data);
      const prior = state.eyecheck[b.book_id]?.[p.page_number];
      // A verdict is about one text: a re-fit page is read again.
      if (!prior || prior.content_hash !== p.ocr.content_hash) (state.eyecheck[b.book_id] ||= {})[p.page_number] = { pid, image: `${stem}.jpg`, content_hash: p.ocr.content_hash, verdict: null };
      log(`${pid} p${p.page_number}: ${stem}.jpg / .txt`);
    }
  }
  saveState();
}
function verdict() {
  const bookId = val('book'), n = val('page');
  const e = state.eyecheck[bookId]?.[n];
  if (!e) throw new Error(`no eyecheck entry for ${bookId} p${n}`);
  e.verdict = has('ok') ? 'pass' : has('bad') ? 'fail' : null;
  e.note = val('note');
  e.by = 'claude (headless job cbeta-5566), read from image';
  e.at = new Date().toISOString();
  saveState();
  log(`${bookId} p${n}: ${e.verdict} — ${e.note}`);
}

// ── release + publish ──────────────────────────────────────────────────────
async function release(db) {
  for (const [pid, b] of Object.entries(state.books)) {
    if (!b.book_id) continue;
    const evAll = Object.entries(state.eyecheck[b.book_id] || {});
    const cur = new Map((await db.collection('pages').find({ book_id: b.book_id, page_number: { $in: evAll.map(([n]) => Number(n)) } }, { projection: { page_number: 1, 'ocr.content_hash': 1 } }).toArray()).map((p) => [String(p.page_number), p.ocr?.content_hash]));
    const ev = evAll.filter(([n, e]) => e.content_hash && cur.get(n) === e.content_hash).map(([, e]) => e);
    if (ev.length < 2 || ev.some((e) => e.verdict !== 'pass')) { log(`${pid}: by-eye check not passed (${ev.map((e) => e.verdict).join(',')}) — stays hidden and held`); continue; }
    const book = await db.collection('books').findOne({ id: b.book_id }, { projection: { pipeline_auto: 1, visible: 1, hidden_reason: 1 } });
    if (b.mode === 'held') {
      if (b.awaiting) { log(`${pid}: ${b.awaiting} — not released`); continue; }
      // Our own books keep their pipeline position: the hold restores the status they held at.
      if (isHeld(book) && book.pipeline_auto.hold.reason === HOLD.reason) {
        const r = await releaseBook(db, b.book_id, { note: `CBETA fit written; by-eye check passed on 2 pages (#${ISSUE})`, source: HOLD.source });
        log(`${pid}: release ${r.outcome} → ${r.to}`);
      }
      // Visibility of a book this job did not create is not this job's decision: it was hidden by
      // another process (unprocessed, curation…), and only part of it now carries text.
      b.published = book.visible === true ? 'already-public' : 'left-hidden'; b.released_at = new Date().toISOString(); saveState();
      log(`${pid}: visibility unchanged (${b.published})`);
      continue;
    }
    if (isHeld(book) && book.pipeline_auto.hold.reason === HOLD.reason) {
      // ocr_complete, not the held-from status: the pages carry their text, and the OCR queue
      // (archive_complete) must not re-read the refused pages on the general dial.
      const r = await releaseBook(db, b.book_id, { note: `by-eye check passed on 2 pages (#${ISSUE})`, to: 'ocr_complete', source: HOLD.source });
      log(`${pid}: release ${r.outcome} → ${r.to}`);
    }
    const p = await setPublication(db, b.book_id, { state: 'public', by: IMPORTER, issue: ISSUE, note: `CBETA fit verified; by-eye check of 2 pages passed (#${ISSUE})` });
    b.published = p.status; b.released_at = new Date().toISOString();
    saveState();
    log(`${pid}: publication ${p.status}`);
  }
}

// ── translation: chained Batch lane, page-level targeting, envelope ───────
async function translate(db) {
  const { readScopeEnvelopes, getScopeSpendUsd } = await import('../lib/spend-guard.mjs');
  const { translatablePageFilter } = await import('../lib/translate-core.mjs');
  const ids = Object.values(state.books).filter((b) => b.book_id && b.published).map((b) => b.book_id);
  if (!ids.length) { log('translate: no published books'); return; }
  const control = await db.collection('system_config').findOne({ _id: 'processing_control' });
  let env = readScopeEnvelopes(control).find((e) => e.tag === ENVELOPE_TAG);
  const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../..');
  if (!env || ids.some((id) => !(env.books || []).includes(id))) {
    const out = execFileSync(process.execPath, ['scripts/maintenance/set-scope.mjs', '--tag', ENVELOPE_TAG, '--books', ids.join(','), '--budget', String(ENVELOPE_CAP),
      '--lanes', 'translate-batch-chained', '--by', `derek 2026-10-01 (#${ISSUE} brief: CBETA Chan drafts, chained Batch lane, cap $${ENVELOPE_CAP})`], { cwd: ROOT, env: process.env, encoding: 'utf8' });
    log(out.trim().split('\n').slice(-2).join(' | '));
    env = readScopeEnvelopes(await db.collection('system_config').findOne({ _id: 'processing_control' })).find((e) => e.tag === ENVELOPE_TAG);
  }
  const allIds = Object.values(state.books).filter((b) => b.book_id).map((b) => b.book_id);
  const sp = await getScopeSpendUsd(db, { ids: allIds, since: env?.created_at ? new Date(env.created_at) : new Date(Date.now() - 864e5) });
  if (sp.meterError) throw new Error(`meter unreadable: ${sp.meterError}`);
  let committed = sp.usd;
  for (const bookId of ids) {
    const ps = await db.collection('pages').find({ book_id: bookId, 'ocr.source': TEXT_SOURCE, ...translatablePageFilter({ extraSkipTypes: ['illustration'] }),
      $or: [{ 'translation.data': { $exists: false } }, { 'translation.data': null }, { 'translation.data': '' }] }, { projection: { _id: 0, id: 1 } }).toArray();
    if (!ps.length) { log(`${bookId}: nothing to translate`); continue; }
    const est = ps.length * TR_RATE;
    if (committed + est > ENVELOPE_CAP) { log(`translate: CAP — committed $${committed.toFixed(2)} + $${est.toFixed(2)} > $${ENVELOPE_CAP}`); break; }
    const pf = path.join(TDIR, `tr-pages-${bookId}.json`);
    fs.writeFileSync(pf, JSON.stringify({ [bookId]: ps.map((p) => p.id) }));
    const approved = Math.max(0.05, +(ps.length * 0.003).toFixed(2));
    let out = '';
    try {
      out = execFileSync(process.execPath, ['scripts/workers/translate-batch-worker.mjs', '--chained', '--enrol', `--pages-file=${pf}`, `--approved-usd=${approved}`], { cwd: ROOT, env: process.env, encoding: 'utf8', timeout: 600000 });
    } catch (e) { out = `${e.stdout || ''}\n${e.stderr || ''}\nEXIT ${e.status}`; }
    fs.appendFileSync(path.join(TDIR, 'enrol.log'), `=== ${new Date().toISOString()} ${bookId}\n${out}\n`);
    const m = out.match(/run (\S+) est \$([\d.]+)/);
    log(`${bookId}: ${ps.length} pages → ${m ? `run ${m[1]} est $${m[2]}` : out.trim().split('\n').slice(-2).join(' | ')}`);
    if (m) { committed += Number(m[2]); (state.runs ||= {})[bookId] = [...((state.runs || {})[bookId] || []), m[1]]; saveState(); }
  }
}

async function report(db) {
  const rows = [];
  for (const [pid, b] of Object.entries(state.books)) {
    if (!b.book_id) { rows.push({ pid, declined: b.declined }); continue; }
    const bk = await db.collection('books').findOne({ id: b.book_id }, { projection: { visible: 1, pages_count: 1, pages_ocr: 1, pages_translated: 1 } });
    const tr = await db.collection('pages').countDocuments({ book_id: b.book_id, 'ocr.source': TEXT_SOURCE, 'translation.data': { $nin: [null, ''], $exists: true } });
    rows.push({ pid, book_id: b.book_id, vol: b.vol, juan: b.juan, pages: bk.pages_count, fitted: b.written, refused: b.refused, translated: tr, visible: bk.visible === true, eye: Object.entries(state.eyecheck[b.book_id] || {}).map(([n, e]) => `p${n}:${e.verdict}`).join(' ') });
  }
  console.log(JSON.stringify(rows, null, 1));
}

const COMMANDS = { measure, apply, eyecheck, verdict, release, translate, report };
if (!COMMANDS[cmd]) { console.error(`usage: ${Object.keys(COMMANDS).join('|')} --text <${Object.keys(TEXTS).join('|')}>`); process.exit(2); }
if (cmd === 'verdict' || (cmd === 'measure' && T.source.kind !== 'held')) await COMMANDS[cmd]();
else {
  if (!process.env.MONGODB_URI) throw new Error('MONGODB_URI missing — run with node --env-file=/root/sourcelibrary/.env.production.local');
  const client = new MongoClient(process.env.MONGODB_URI);
  await client.connect();
  try { await COMMANDS[cmd](client.db('bookstore')); } finally { await client.close(); }
}
