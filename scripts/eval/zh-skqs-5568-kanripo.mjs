#!/usr/bin/env node
/**
 * PRIOR ART: scripts/eval/benchmark-refs.mjs (`kanripoSearch --wide` — finds ONE best window for
 * ONE probe page in a work's juan files; it strips the `<pb:…>` markers, so it cannot say which
 * Kanripo page a scan page IS, only that its text occurs somewhere); the #5547 job's
 * zh-cohort-5547-duplicates.mjs (`juanRange` — the title juan parser, copied below because that
 * file is not on main yet). Neither answers #5568 test 1: how many held books Kanripo already
 * carries, and whether a scan page maps to a Kanripo page (`<pb:KRxxxx_WYG_jjj-NNa>`) closely
 * enough to use the text instead of OCR.
 *
 * #5568 test 1 — Kanripo instead of OCR for the held Siku Quanshu cohort. READ-ONLY: Mongo reads
 * (books), GitHub reads (kanripo org), local files from the #5547 job. Writes only under --dir.
 *
 *   coverage   every held book → its work's Kanripo repo: WYG branch, else master; juan files
 *              covering the title's juan range; the repo's own licence field and Readme licence line
 *   align      the sealed-set sample (40 held manuscript books, seed 5568): Paddle's read of the
 *              page against every Kanripo page (`<pb>` segment) of the work — best Dice, runner-up
 *   drift      the #5547 Paddle pilot volumes (whole books): every page aligned, and the
 *              page → pb offset tracked across the volume (does one anchor per juan predict the rest?)
 *
 *   node --env-file=/root/sourcelibrary/.env.production.local scripts/eval/zh-skqs-5568-kanripo.mjs coverage
 *   node scripts/eval/zh-skqs-5568-kanripo.mjs align|drift
 */
import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';
import { makeRng } from './lib/paired-stats.mjs';

const argOf = (n, d) => { const a = process.argv.find(x => x.startsWith(`--${n}=`)); return a ? a.slice(n.length + 3) : d; };
const CMD = process.argv[2];
const DIR = argOf('dir', '/root/zh-skqs-5568');
const SIB = argOf('sibling', '/root/sourcelibrary/.claude/worktrees/job-zh-ocr-eval-5547');
const BENCH_OUT = argOf('bench-out', '/root/ocr-bench/images/chinese-cohort-5547/out');
const PILOT = argOf('pilot', '/root/zh-ocr-eval-5547/pilot');
const HELD = argOf('held', '/root/preview-stubs-4719/ids-chinese-held-5481.txt');
const N_SAMPLE = +argOf('n', 40);
const SEED = 5568;
const THRESH = 0.6;
fs.mkdirSync(path.join(DIR, 'gh'), { recursive: true });

// ── text ──
export const han = s => [...String(s || '').normalize('NFC')].filter(c => /\p{Script=Han}/u.test(c)).join('');
// Variant pairs seen between Kanripo's WYG transcription and modern-form OCR (徳/德 …). Folded on both
// sides before any comparison; the list is short on purpose — it only stops a systematic glyph
// convention from reading as disagreement.
const VARIANTS = { 徳: '德', 増: '增', 䘮: '喪', 録: '錄', 説: '說', 衞: '衛', 庿: '廟', 蔵: '藏', 逺: '遠', 嵗: '歲', 圎: '圓', 曽: '曾', 黄: '黃', 爲: '為', 𤣥: '玄', 摠: '總', 盖: '蓋', 却: '卻', 卽: '即', 旣: '既', 敎: '教', 毎: '每', 靑: '青', 呉: '吳', 别: '別', 兾: '冀', 竒: '奇', 着: '著', 隂: '陰', 恊: '協' };
export const fold = s => [...han(s)].map(c => VARIANTS[c] || c).join('');
const bigrams = s => { const m = new Map(); for (let i = 0; i + 1 < s.length; i++) { const g = s.slice(i, i + 2); m.set(g, (m.get(g) || 0) + 1); } return m; };
export function dice(a, b) {
  const A = bigrams(a), B = bigrams(b);
  let inter = 0, na = 0, nb = 0;
  for (const v of A.values()) na += v;
  for (const v of B.values()) nb += v;
  for (const [g, v] of A) if (B.has(g)) inter += Math.min(v, B.get(g));
  return na + nb ? (2 * inter) / (na + nb) : 0;
}
export function cer(hyp, ref) {
  const a = [...hyp], b = [...ref];
  if (!b.length) return a.length ? 1 : 0;
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    prev = cur;
  }
  return prev[b.length] / b.length;
}
export const wilson = (k, n, z = 1.96) => {
  if (!n) return [null, null];
  const p = k / n, d = 1 + z * z / n, c = p + z * z / (2 * n), h = z * Math.sqrt(p * (1 - p) / n + z * z / (4 * n * n));
  return [+((c - h) / d).toFixed(3), +((c + h) / d).toFixed(3)];
};

// ── juan from the title (copied from #5547's zh-cohort-5547-duplicates.mjs) ──
const DIG = { 〇: 0, 零: 0, 一: 1, 二: 2, 兩: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9 };
function cnNum(s) {
  if (/^\d+$/.test(s)) return +s;
  let total = 0, cur = 0;
  for (const ch of s) {
    if (ch in DIG) cur = DIG[ch];
    else if (ch === '十') { total += (cur || 1) * 10; cur = 0; }
    else if (ch === '百') { total += (cur || 1) * 100; cur = 0; }
    else if (ch === '千') { total += (cur || 1) * 1000; cur = 0; }
    else return null;
  }
  return total + cur;
}
const NUM = '[〇零一二兩三四五六七八九十百千\\d]+';
function juanRange(title) {
  const m = String(title || '').match(new RegExp(`·?([^·()（）]*?)卷(${NUM})(?:之(${NUM})|([上中下]))?(?:[~～至\\-—]卷?(${NUM})?(?:之(${NUM})|([上中下]))?)?`));
  if (!m) return null;
  const lo = cnNum(m[2]), hi = m[5] ? cnNum(m[5]) : lo;
  if (lo == null || hi == null) return null;
  return { lo: Math.min(lo, hi), hi: Math.max(lo, hi), part: (m[1] || '').replace(/^.*·/, '').trim(), sub: m[3] || m[4] || '' };
}

// ── GitHub (cached; a 404 is cached as null) ──
let TOKEN = process.env.GH_TOKEN || process.env.GITHUB_TOKEN;
if (!TOKEN) { try { TOKEN = execSync('gh auth token', { encoding: 'utf8' }).trim(); } catch { /* unauthenticated */ } }
const sleep = ms => new Promise(r => setTimeout(r, ms));
async function cached(key, fn) {
  const f = path.join(DIR, 'gh', key.replace(/[^\w.-]+/g, '_'));
  if (fs.existsSync(f)) return JSON.parse(fs.readFileSync(f, 'utf8'));
  const v = await fn();
  fs.writeFileSync(f, JSON.stringify(v));
  return v;
}
async function gh(url) {
  return cached(`api_${url}`, async () => {
    for (let t = 0; t < 4; t++) {
      const r = await fetch(`https://api.github.com/${url}`, { headers: { Authorization: TOKEN ? `Bearer ${TOKEN}` : undefined, Accept: 'application/vnd.github+json' } });
      if (r.status === 404) return null;
      if (r.ok) return r.json();
      if (r.status === 403 || r.status === 429) { await sleep(30000); continue; }
      await sleep(2000);
    }
    throw new Error(`github ${url} failed`);
  });
}
async function raw(id, ref, file) {
  return cached(`raw_${id}_${ref}_${file}`, async () => {
    for (let t = 0; t < 4; t++) {
      const r = await fetch(`https://raw.githubusercontent.com/kanripo/${id}/${ref}/${file}`);
      if (r.status === 404) return null;
      if (r.ok) return r.text();
      await sleep(2000);
    }
    throw new Error(`raw ${id}/${ref}/${file} failed`);
  });
}

/** A work's repo: witness branch (WYG, else master), its juan files, its own licence statements. */
async function workInfo(krId) {
  const repo = await gh(`repos/kanripo/${krId}`);
  if (!repo) return { id: krId, repo: false };
  const br = (await gh(`repos/kanripo/${krId}/branches?per_page=100`)) || [];
  const branches = br.map(b => b.name);
  const witness = branches.includes('WYG') ? 'WYG' : branches.includes('master') ? 'master' : null;
  const files = witness ? ((await gh(`repos/kanripo/${krId}/contents?ref=${witness}`)) || []).map(f => f.name) : [];
  const juanFiles = files.filter(f => new RegExp(`^${krId}_\\d{3}\\.txt$`).test(f));
  const readme = witness ? await raw(krId, witness, 'Readme.org') : null;
  const licenceLine = (readme || '').split('\n').find(l => /licen[cs]e|creative ?commons|\bCC[- ]BY|版權|著作權/i.test(l)) || null;
  const hasLicenceFile = files.some(f => /^(LICEN[CS]E|COPYING)/i.test(f));
  return { id: krId, repo: true, branches, witness, witness_sha: br.find(b => b.name === witness)?.commit?.sha || null, juan_files: juanFiles.map(f => +f.slice(-7, -4)), repo_licence: repo.license?.spdx_id || null, licence_file: hasLicenceFile, readme_licence_line: licenceLine, readme_witness: (readme || '').match(/\|\s*(\w+)\|【([^】]+)】/)?.slice(1) || null };
}

/** All `<pb>` pages of a set of juan files: [{ pb, juan, leaf, side, text(folded) }] in file order. */
async function pbPages(krId, ref, juans) {
  const out = [];
  for (const j of juans) {
    const t = await raw(krId, ref, `${krId}_${String(j).padStart(3, '0')}.txt`);
    if (!t) continue;
    const parts = t.replace(/^#.*$/gm, '').split(/<pb:([^>]+)>/);
    for (let i = 1; i < parts.length; i += 2) {
      const pb = parts[i];
      const m = pb.match(/_(\d{3})-(\d+)([ab])$/);
      out.push({ pb, juan: j, leaf: m ? +m[2] : null, side: m ? m[3] : null, raw: parts[i + 1], text: fold(parts[i + 1]) });
    }
  }
  return out;
}

/** Juan files to search: the title's range ± 5 (Siku volume juan are often off by a few from Kanripo's file numbers), else all. */
const nearJuan = (w, r) => (r ? w.juan_files.filter(j => j >= r.lo - 5 && j <= r.hi + 5) : w.juan_files);

function best(textFolded, pages) {
  let b = null, second = 0;
  pages.forEach((p, i) => {
    const d = dice(textFolded, p.text);
    if (!b || d > b.dice) { if (b) second = Math.max(second, b.dice); b = { i, dice: d }; } else if (d > second) second = d;
  });
  return b ? { ...b, second } : null;
}

function loadSealed() {
  const sealed = JSON.parse(fs.readFileSync(path.join(SIB, 'scripts/eval/benchmark/chinese-cohort-5547.json'), 'utf8'));
  const cls = slug => { try { return JSON.parse(fs.readFileSync(path.join(SIB, 'scripts/eval/benchmark/script-class', `${slug}.json`), 'utf8')).script_class; } catch { return null; } };
  return sealed.pages.map(p => ({ ...p, script_class: cls(p.slug) }));
}
const readOut = (engine, slug) => { try { return fs.readFileSync(path.join(BENCH_OUT, engine, `${slug}.txt`), 'utf8'); } catch { return null; } };

/** The sample shared by tests 1 and 2: held, manuscript-regular by eye, Paddle read ≥ 50 Han chars. */
export function drawSample(n = N_SAMPLE) {
  const pool = loadSealed().filter(p => p.cohort === 'held' && p.script_class === 'manuscript-regular' && /^kr:/.test(p.work_id || ''))
    .filter(p => han(readOut('paddleocr-vl-1.6', p.slug)).length >= 50)
    .sort((a, b) => a.slug.localeCompare(b.slug));
  const rng = makeRng(SEED);
  const picked = [];
  const left = [...pool];
  while (picked.length < n && left.length) picked.push(left.splice(Math.floor(rng() * left.length), 1)[0]);
  return { pool: pool.length, picked };
}

async function coverage() {
  const books = JSON.parse(fs.readFileSync(path.join(DIR, 'held-books.json'), 'utf8'));
  const ids = new Set(fs.readFileSync(HELD, 'utf8').split(/\s+/).filter(Boolean));
  const held = books.filter(b => ids.has(b.id));
  const works = [...new Set(held.map(b => b.work_id).filter(w => /^kr:/.test(w || '')).map(w => w.slice(3)))].sort();
  const info = {};
  let k = 0;
  for (const w of works) { info[w] = await workInfo(w); if (++k % 50 === 0) console.log(`  ${k}/${works.length} works`); }
  const rows = held.map(b => {
    const w = /^kr:/.test(b.work_id || '') ? info[b.work_id.slice(3)] : null;
    const r = juanRange(b.title);
    const covered = w?.witness && r ? Array.from({ length: r.hi - r.lo + 1 }, (_, i) => r.lo + i).every(j => w.juan_files.includes(j)) : null;
    return { id: b.id, title: b.title, work: w?.id || null, pages: b.pages_count || 0, witness: w ? (w.repo ? w.witness : 'no-repo') : 'no-work-id', juan: r, juan_files_cover_title: covered };
  });
  const by = (f) => { const m = {}; for (const r of rows) { const k2 = f(r); m[k2] = m[k2] || { books: 0, pages: 0 }; m[k2].books++; m[k2].pages += r.pages; } return m; };
  const wy = rows.filter(r => r.witness === 'WYG').length;
  const summary = {
    held_books: rows.length, held_pages: rows.reduce((s, r) => s + r.pages, 0), works: works.length,
    by_witness: by(r => r.witness),
    wyg_share_books: +(wy / rows.length).toFixed(4), wyg_share_wilson: wilson(wy, rows.length),
    by_witness_and_juan: by(r => `${r.witness}|${r.juan ? (r.juan_files_cover_title ? 'juan-files-cover-title' : 'juan-file-missing') : 'title-juan-unparsed'}`),
    works_by_witness: Object.values(info).reduce((m, w) => { const k2 = w.repo ? w.witness || 'no-branch' : 'no-repo'; m[k2] = (m[k2] || 0) + 1; return m; }, {}),
    licence: {
      repos_with_licence_field: Object.values(info).filter(w => w.repo_licence).length,
      repos_with_licence_file: Object.values(info).filter(w => w.licence_file).length,
      readmes_with_licence_line: Object.values(info).filter(w => w.readme_licence_line).length,
      repo_licence_values: Object.values(info).reduce((m, w) => { const k2 = w.repo_licence || 'none'; m[k2] = (m[k2] || 0) + 1; return m; }, {}),
      readme_witness_labels: Object.values(info).reduce((m, w) => { const k2 = w.readme_witness ? w.readme_witness.join(' ') : 'none'; m[k2] = (m[k2] || 0) + 1; return m; }, {}),
    },
  };
  fs.writeFileSync(path.join(DIR, 'coverage.json'), JSON.stringify({ summary, works: info, rows }, null, 1));
  console.log(JSON.stringify(summary, null, 1));
}

async function align() {
  const books = Object.fromEntries(JSON.parse(fs.readFileSync(path.join(DIR, 'held-books.json'), 'utf8')).map(b => [b.id, b]));
  const { pool, picked } = drawSample();
  console.log(`pool ${pool}, sample ${picked.length}`);
  const rows = [];
  for (const p of picked) {
    const krId = p.work_id.slice(3);
    const w = await workInfo(krId);
    const paddle = fold(readOut('paddleocr-vl-1.6', p.slug));
    const lite = fold(readOut('gemini-3.1-flash-lite', p.slug));
    const row = { slug: p.slug, book_id: p.book_id, page_number: p.page_number, title: p.title, work: krId, witness: w.witness, juan: juanRange(books[p.book_id]?.title || p.title), paddle_chars: paddle.length };
    if (!w.witness) { rows.push({ ...row, reason: 'no witness branch' }); continue; }
    const pages = await pbPages(krId, w.witness, nearJuan(w, row.juan));
    if (!pages.length) { rows.push({ ...row, reason: 'no juan file near the title range' }); continue; }
    const b = best(paddle, pages);
    const pb = pages[b.i];
    Object.assign(row, {
      pb_pages: pages.length, pb: pb.pb, dice: +b.dice.toFixed(3), runner_up: +b.second.toFixed(3),
      aligned: b.dice >= THRESH, kanripo_chars: pb.text.length,
      cer_paddle_vs_kanripo: +cer(paddle, pb.text).toFixed(3), cer_lite_vs_kanripo: +cer(lite, pb.text).toFixed(3),
      juan_of_pb_in_title_range: row.juan ? pb.juan >= row.juan.lo && pb.juan <= row.juan.hi : null,
    });
    // the Kanripo text of the aligned page, kept for test 2 (raw, with Kanripo's own line breaks)
    fs.mkdirSync(path.join(DIR, 'kanripo-pages'), { recursive: true });
    fs.writeFileSync(path.join(DIR, 'kanripo-pages', `${p.slug}.txt`), pb.raw.replace(/¶/g, '').replace(/^\n+|\n+$/g, ''));
    rows.push(row);
    console.log(`  ${p.slug} ${krId}/${w.witness} ${pb.pb} dice ${row.dice} (2nd ${row.runner_up}) cerP ${row.cer_paddle_vs_kanripo}`);
  }
  const ok = rows.filter(r => r.aligned).length;
  const summary = {
    sample: rows.length, pool, seed: SEED, threshold: THRESH,
    witness: rows.reduce((m, r) => { m[r.witness || 'none'] = (m[r.witness || 'none'] || 0) + 1; return m; }, {}),
    aligned: ok, aligned_share: +(ok / rows.length).toFixed(3), aligned_wilson: wilson(ok, rows.length),
    margin_median: median(rows.filter(r => r.aligned).map(r => r.dice - r.runner_up)),
    dice_median: median(rows.map(r => r.dice ?? 0)),
    cer_paddle_vs_kanripo_median_aligned: median(rows.filter(r => r.aligned).map(r => r.cer_paddle_vs_kanripo)),
    cer_lite_vs_kanripo_median_aligned: median(rows.filter(r => r.aligned).map(r => r.cer_lite_vs_kanripo)),
    pb_juan_in_title_range: rows.filter(r => r.juan_of_pb_in_title_range === true).length,
  };
  fs.writeFileSync(path.join(DIR, 'align.json'), JSON.stringify({ summary, rows }, null, 1));
  console.log(JSON.stringify(summary, null, 1));
}
const median = xs => { const s = xs.filter(x => x != null).sort((a, b) => a - b); return s.length ? +s[Math.floor((s.length - 1) / 2)].toFixed(3) : null; };

/**
 * Drift across a volume: align every Paddle page of each pilot book, then ask the question a
 * writer would ask — given ONE anchor (the first aligned page of each juan), does `page − anchor`
 * predict the Kanripo page for the rest? A missing or extra leaf in either witness shows up as a
 * step in the offset.
 */
async function drift() {
  const rep = JSON.parse(fs.readFileSync(path.join(PILOT, 'books.json'), 'utf8'));
  const out = [];
  for (const b of rep.books) {
    const dir = path.join(PILOT, 'out', b.book_id);
    if (!fs.existsSync(dir)) continue;
    const files = fs.readdirSync(dir).filter(f => /^\d+\.txt$/.test(f)).sort();
    if (files.length < 0.9 * (b.pages_count || files.length)) { console.log(`  skip ${b.book_id}: ${files.length}/${b.pages_count} pages read`); continue; }
    const krId = (b.work_id || '').replace(/^kr:/, '');
    const w = await workInfo(krId);
    if (!w.witness) { out.push({ book_id: b.book_id, title: b.title, work: krId, reason: 'no witness' }); continue; }
    const pages = await pbPages(krId, w.witness, nearJuan(w, juanRange(b.title)));
    const pbIndex = new Map(pages.map((p, i) => [p.pb, i]));
    const seq = [];
    for (const f of files) {
      const t = fold(fs.readFileSync(path.join(dir, f), 'utf8'));
      const pn = +f.slice(0, -4);
      if (t.length < 20) { seq.push({ page: pn, chars: t.length, aligned: false, why: 'short' }); continue; }
      const m = best(t, pages);
      seq.push({ page: pn, chars: t.length, pb: pages[m.i].pb, idx: m.i, dice: +m.dice.toFixed(3), runner_up: +m.second.toFixed(3), aligned: m.dice >= THRESH });
    }
    // offsets: idx − page for aligned pages; runs of constant offset
    const al = seq.filter(s => s.aligned);
    let steps = 0, prev = null;
    for (const s of al) { const o = s.idx - s.page; if (prev != null && o !== prev) steps++; prev = o; }
    // anchor-per-juan prediction: first aligned page of each juan fixes the offset for that juan
    const anchor = new Map();
    let predicted = 0, predictable = 0;
    for (const s of al) {
      const j = pages[s.idx].juan;
      if (!anchor.has(j)) { anchor.set(j, s.idx - s.page); continue; }
      predictable++;
      const pi = s.page + anchor.get(j);
      if (pi === s.idx) predicted++;
    }
    // single-anchor prediction (one anchor for the whole volume)
    const a0 = al.length ? al[0].idx - al[0].page : null;
    const single = al.slice(1).filter(s => s.page + a0 === s.idx).length;
    const textPages = seq.filter(s => s.chars >= 20).length;
    const r = {
      book_id: b.book_id, title: b.title, work: krId, witness: w.witness, pages_read: files.length, text_pages: textPages,
      aligned: al.length, aligned_share_of_text_pages: +(al.length / textPages).toFixed(3),
      offset_steps: steps, juans_spanned: anchor.size,
      anchor_per_juan_predicts: `${predicted}/${predictable}`, single_anchor_predicts: `${single}/${Math.max(0, al.length - 1)}`,
      unaligned_examples: seq.filter(s => !s.aligned && s.chars >= 20).slice(0, 8).map(s => ({ page: s.page, dice: s.dice, pb: s.pb })),
      steps_at: (() => { const o = []; let p2 = null; for (const s of al) { const x = s.idx - s.page; if (p2 != null && x !== p2) o.push({ page: s.page, from: p2, to: x, pb: s.pb }); p2 = x; } return o.slice(0, 12); })(),
    };
    out.push(r);
    fs.writeFileSync(path.join(DIR, `drift-${b.book_id}.json`), JSON.stringify(seq, null, 1));
    console.log(JSON.stringify(r));
  }
  fs.writeFileSync(path.join(DIR, 'drift.json'), JSON.stringify(out, null, 1));
}

if (CMD === 'coverage') await coverage();
else if (CMD === 'align') await align();
else if (CMD === 'drift') await drift();
else if (CMD === 'sample') console.log(JSON.stringify(drawSample().picked.map(p => p.slug)));
else { console.error('usage: coverage | align | drift | sample'); process.exit(1); }
