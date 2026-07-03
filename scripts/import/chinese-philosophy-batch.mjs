#!/usr/bin/env node
/**
 * Big acquisition: Chinese philosophy originals (經 Classics + 子 Masters + 佛
 * Buddhist) from the works-catalog (issue #2453).
 *
 * Pulls every philosophy work (Kanripo branches KR1/KR3/KR6) that the catalog
 * has located a scan for (ia-cadal / ia-chinese — both IIIF on iiif.archive.org,
 * so importable server-side via /api/import/ia, no datacenter-429) and that is
 * NOT already mapped as held, then imports each scan item HIDDEN with its
 * catalog work_id attached.
 *
 * Multi-volume works: IA scans are one item per fascicle and their CJK titles
 * carry the 卷 range ("·卷四"), but normalizeTitle() strips 卷 and extractVolume()
 * does NOT parse CJK numerals — so without help, Tier-2 title+author dedup would
 * block every volume after the first (src/lib/dedup.ts). We append a Latin
 * "(vol N)" per-work running index, which extractVolume() DOES parse, so the
 * volumes stay distinct editions. (Harvard-Yenching scans 429 on datacenter IPs
 * and are handled separately by a residential direct-insert script.)
 *
 * Pipeline is paused (Gemini spend) so imports archive page images to R2 but do
 * NOT OCR/translate — i.e. this acquires the originals; translation waits.
 *
 * Usage:
 *   set -a; source .env.production.local; set +a
 *   node scripts/import/chinese-philosophy-batch.mjs                 # dry-run preview
 *   node scripts/import/chinese-philosophy-batch.mjs --work kr:KR1j0045 --commit   # one work (pilot)
 *   node scripts/import/chinese-philosophy-batch.mjs --commit        # full batch (resumable)
 *   node scripts/import/chinese-philosophy-batch.mjs --commit --limit 50
 */

import { MongoClient } from 'mongodb';
import fs from 'fs';

const COMMIT = process.argv.includes('--commit');
const arg = (k) => { const i = process.argv.indexOf(k); return i >= 0 ? process.argv[i + 1] : null; };
const ONLY_WORK = arg('--work');
const LIMIT = arg('--limit') ? parseInt(arg('--limit'), 10) : Infinity;
const CONCURRENCY = arg('--concurrency') ? parseInt(arg('--concurrency'), 10) : 4;

const URL = process.env.SUPABASE_URL, KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const CRON_SECRET = process.env.CRON_SECRET;
const IMPORT_URL = 'https://sourcelibrary.org/api/import/ia';
const PROGRESS = 'scripts/output/chinese-phil-import-progress.json';
if (COMMIT && !CRON_SECRET) { console.error('CRON_SECRET not set'); process.exit(1); }

const H = { apikey: KEY, Authorization: `Bearer ${KEY}` };
async function pageAll(p) {
  const o = []; let f = 0; const s = 1000;
  while (true) {
    const r = await fetch(`${URL}/rest/v1/${p}`, { headers: { ...H, Range: `${f}-${f + s - 1}` } });
    if (!r.ok) { console.error(p, r.status, await r.text()); break; }
    const rows = await r.json(); o.push(...rows);
    if (rows.length < s) break; f += s;
  }
  return o;
}
const branch = (id) => { const m = /kr:KR(\d)/.exec(id); return m ? 'KR' + m[1] : 'other'; };

async function iaMeta(id) {
  try {
    const r = await fetch(`https://archive.org/metadata/${id}`, { signal: AbortSignal.timeout(30000) });
    if (!r.ok) return {};
    const m = (await r.json()).metadata || {};
    const creator = Array.isArray(m.creator) ? m.creator.join('; ') : m.creator;
    return { title: m.title, creator, date: m.date };
  } catch { return {}; }
}

async function importOne(item, attempt = 1) {
  try {
    const res = await fetch(IMPORT_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${CRON_SECRET}` },
      body: JSON.stringify({
        ia_identifier: item.id,
        title: item.title,
        author: item.author,
        original_language: 'Chinese',
        work_id: item.work_id,
      }),
      signal: AbortSignal.timeout(180000),
    });
    const data = await res.json();
    if (res.ok && data.success) return { ...item, ok: true, dup: false, pages: data.pagesCreated, bookId: data.bookId };
    if (data.duplicate || data.isDuplicate || data.existingId || /duplicate|already exists/i.test(JSON.stringify(data)))
      return { ...item, ok: true, dup: true, bookId: data.existingId || data.matchedBookId };
    if (attempt < 3 && /timed out|MongoNetwork|ECONN|fetch failed|502|503|504/i.test(JSON.stringify(data))) {
      await new Promise(r => setTimeout(r, 5000)); return importOne(item, attempt + 1);
    }
    return { ...item, ok: false, err: data.error || data.details || JSON.stringify(data).slice(0, 140) };
  } catch (e) {
    if (attempt < 3) { await new Promise(r => setTimeout(r, 5000)); return importOne(item, attempt + 1); }
    return { ...item, ok: false, err: e.message };
  }
}

async function main() {
  // 1. works (philosophy branches), sources, holdings
  const works = await pageAll('works?tradition=eq.chinese&select=id,title,title_english,author');
  const wmap = new Map(works.map(w => [w.id, w]));
  const PHIL = new Set(works.map(w => w.id).filter(id => ['KR1', 'KR3', 'KR6'].includes(branch(id))));
  const holdings = await pageAll('work_holdings?select=work_id');
  const held = new Set(holdings.map(h => h.work_id));
  const sources = await pageAll('work_sources?kind=eq.scan&select=work_id,source,source_id');

  // 2. group net-new IA scan items by work
  const byWork = new Map();
  for (const s of sources) {
    if (!PHIL.has(s.work_id) || held.has(s.work_id)) continue;
    if (s.source !== 'ia-cadal' && s.source !== 'ia-chinese') continue;
    if (ONLY_WORK && s.work_id !== ONLY_WORK) continue;
    if (!byWork.has(s.work_id)) byWork.set(s.work_id, new Set());
    byWork.get(s.work_id).add(s.source_id);
  }

  // 3. flatten into import items with per-work volume suffix
  let items = [];
  for (const [wid, idSet] of byWork) {
    const w = wmap.get(wid);
    const ids = [...idSet].sort();          // stable per-work order
    const multi = ids.length > 1;
    ids.forEach((id, i) => items.push({
      id, work_id: wid,
      cjk: w.title, en: w.title_english, catAuthor: w.author,
      vol: multi ? i + 1 : null, nVols: ids.length,
    }));
  }
  // resume: skip already-completed ids
  let done = {};
  if (fs.existsSync(PROGRESS)) done = JSON.parse(fs.readFileSync(PROGRESS, 'utf8'));
  const remaining = items.filter(it => !done[it.id]).slice(0, LIMIT);

  console.log(`${COMMIT ? 'IMPORT' : 'DRY-RUN'} — ${byWork.size} works, ${items.length} items total, ${Object.keys(done).length} already done, ${remaining.length} to process now\n`);
  if (!remaining.length) { console.log('nothing to do'); return; }

  if (!COMMIT) {
    remaining.slice(0, 20).forEach(it =>
      console.log(`  · ${it.id.padEnd(14)} ${it.work_id.padEnd(12)} ${(it.cjk || '').slice(0, 30)} ${it.vol ? `[vol ${it.vol}/${it.nVols}]` : '[single]'}`));
    if (remaining.length > 20) console.log(`  … +${remaining.length - 20} more`);
    return;
  }

  // 4. concurrent import with checkpointing
  const stats = { ok: 0, dup: 0, fail: 0, pages: 0 };
  const fails = [];
  let idx = 0;
  async function worker() {
    while (idx < remaining.length) {
      const it = remaining[idx++];
      const meta = await iaMeta(it.id);
      // real CJK title (carries 卷 range) + Latin (vol N) so extractVolume distinguishes volumes
      let title = meta.title || it.cjk || it.id;
      if (it.en && !title.includes(it.en)) title = `${title} — ${it.en}`;
      if (it.vol) title = `${title} (vol ${it.vol})`;
      const author = it.catAuthor || meta.creator || '未詳 (Unknown)';
      const r = await importOne({ id: it.id, work_id: it.work_id, title, author });
      if (r.ok && !r.dup) { stats.ok++; stats.pages += r.pages || 0; }
      else if (r.dup) stats.dup++;
      else { stats.fail++; fails.push({ id: it.id, err: r.err }); }
      done[it.id] = r.ok ? (r.dup ? 'dup' : `ok:${r.pages}`) : `fail`;
      if ((stats.ok + stats.dup + stats.fail) % 25 === 0) {
        fs.writeFileSync(PROGRESS, JSON.stringify(done));
        console.log(`  [${stats.ok + stats.dup + stats.fail}/${remaining.length}] ok=${stats.ok} dup=${stats.dup} fail=${stats.fail} pages=${stats.pages}`);
      }
    }
  }
  await Promise.all(Array.from({ length: CONCURRENCY }, worker));
  fs.writeFileSync(PROGRESS, JSON.stringify(done));
  console.log(`\nDONE: imported=${stats.ok} duplicate=${stats.dup} failed=${stats.fail} pages=${stats.pages}`);
  if (fails.length) {
    fs.writeFileSync('scripts/output/chinese-phil-import-fails.json', JSON.stringify(fails, null, 2));
    console.log(`failures → scripts/output/chinese-phil-import-fails.json (${fails.length})`);
  }
}
main().catch(e => { console.error(e); process.exit(1); });
