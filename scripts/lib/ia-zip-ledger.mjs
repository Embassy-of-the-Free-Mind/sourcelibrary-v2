/**
 * Internet Archive item zips for the manifest archiver (#5448, inbox note 2026-10-25 23:19): one
 * `<id>_jp2.zip` request per book instead of one IIIF request per page, and the JP2 is the
 * original master. Measured on 2 items: 2 requests vs 28/52, identical pixels (comment on #5448).
 *
 * PRIOR ART: scripts/workers/archive-bulk.mjs (the zip worker for MATERIALIZED IA books: download,
 * unzip, opj_decompress, scandata mapping and a perceptual check — the rules are reused here, but it
 * reads and writes page docs); scripts/lib/ia-access-leaves.mjs (scandata → access leaves, the
 * zip-ordinal index; reused); scripts/maintenance/archive-ia-bulk.mjs (abandoned zips for per-page
 * IIIF because zip order drifted from IIIF leaf numbers, #3368). Neither can fill a manifest ledger.
 *
 * THE PAIRING (paired-artifacts.md, #3368). A zip member is used for canvas n only when the mapping
 * is PROVEN for the whole book, two ways, else the book falls back to per-page IIIF:
 *   A. exact — every canvas's IIIF image URL names its zip member (`…/<id>_jp2.zip%2F…%2F<id>_0004.jp2/…`,
 *      the shape iiif.archive.org v3 manifests use). The member IS the canvas, by construction. The
 *      leaf ordinals must rise strictly in canvas order, and every member must be in the zip.
 *   B. scandata — no member names in the URLs: the item's scandata access leaves must number exactly
 *      the manifest's canvases, rise strictly, all be in the zip, AND a perceptual hash of two
 *      interior pages must match their IIIF render (a count can agree while the order does not).
 * Anything else (no scandata, a count or order disagreement, a missing member, a failed hash, no
 * opj_decompress/unzip on this box) refuses the zip for that book and says why.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFile, spawnSync } from 'node:child_process';
import { promisify } from 'node:util';
import sharp from 'sharp';
import { fetchAccessLeaves, indexJp2FilesByLeaf } from './ia-access-leaves.mjs';
import { fetchToFileWithStallTimeout } from './fetch-stall-timeout.mjs';
import { hashBuffer, hammingHex, HASH_MATCH } from './page-alignment.mjs';

const execFileP = promisify(execFile);
const UA = 'SourceLibrary/1.0 (https://sourcelibrary.org; derek@sourcelibrary.org)';
export const IA_MANIFEST_ID_RE = /^https?:\/\/iiif\.archive\.org\/iiif\/(?:3\/)?([^/?#]+)\/manifest/;

/** The IA identifier a manifest URL names, or null. */
export function iaIdFromManifest(url) {
  const m = typeof url === 'string' && url.match(IA_MANIFEST_ID_RE);
  return m ? decodeURIComponent(m[1]) : null;
}

/** The zip member a canvas image URL names (`<dir>/<id>_0004.jp2`), or null. */
export function memberFromPhoto(photo) {
  if (typeof photo !== 'string') return null;
  const m = photo.match(/\/image\/iiif\/3\/([^/]+)\/full\//);
  if (!m) return null;
  const parts = decodeURIComponent(m[1]).split('/');
  const zipAt = parts.findIndex(p => /_jp2\.zip$/i.test(p));
  if (zipAt < 0 || zipAt === parts.length - 1) return null;
  const member = parts.slice(zipAt + 1).join('/');
  return /\.jp2$/i.test(member) ? member : null;
}

const leafOf = (name) => { const m = String(name).match(/(\d+)\.jp2$/i); return m ? parseInt(m[1], 10) : null; };
const rising = (xs) => xs.every((x, i) => i === 0 || x > xs[i - 1]);

/**
 * Decide how canvases map to zip members, BEFORE downloading anything when possible.
 * @param {string[]} photos  canvas image URLs in manifest order ('' = no image)
 * @param {number[]|null} accessLeaves  scandata access leaves (route B only)
 * @returns {{ route: 'exact'|'scandata'|null, members?: (string|null)[], leaves?: (number|null)[], reason?: string }}
 */
export function planZipMapping(photos, accessLeaves = null) {
  const imaged = photos.map((p, i) => [i, p]).filter(([, p]) => p);
  if (imaged.length === 0) return { route: null, reason: 'no canvas has an image' };
  const members = photos.map(p => (p ? memberFromPhoto(p) : null));
  const named = imaged.filter(([i]) => members[i]);
  if (named.length === imaged.length) {
    const leaves = imaged.map(([i]) => leafOf(members[i]));
    if (leaves.some(l => l == null)) return { route: null, reason: 'a member name carries no leaf ordinal' };
    if (!rising(leaves)) return { route: null, reason: 'member leaf ordinals do not rise in canvas order' };
    return { route: 'exact', members };
  }
  if (named.length > 0) return { route: null, reason: `${named.length} of ${imaged.length} canvases name a zip member — mixed manifest` };
  if (!Array.isArray(accessLeaves) || accessLeaves.length === 0) return { route: null, reason: 'no member names and no parseable scandata' };
  if (accessLeaves.length !== photos.length) return { route: null, reason: `scandata has ${accessLeaves.length} access leaves for ${photos.length} canvases` };
  if (!rising(accessLeaves)) return { route: null, reason: 'scandata access leaves do not rise' };
  // `/page/nN` URLs carry IA's access-page number: it must be the canvas position, or the manifest
  // is not the access sequence the scandata describes.
  for (const [i, p] of imaged) {
    const n = String(p).match(/\/page\/n(\d+)\//);
    if (n && Number(n[1]) !== i) return { route: null, reason: `canvas ${i + 1} is IIIF page n${n[1]}, not n${i}` };
  }
  return { route: 'scandata', leaves: photos.map((p, i) => (p ? accessLeaves[i] : null)) };
}

let toolsOk = null;
/** opj_decompress and unzip on PATH? Checked once per process. */
export function zipToolsAvailable() {
  if (toolsOk == null) {
    toolsOk = ['opj_decompress', 'unzip'].every(t => spawnSync('sh', ['-c', `command -v ${t}`], { stdio: 'ignore' }).status === 0);
  }
  return toolsOk;
}

function walkJp2(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) walkJp2(full, out);
    else if (/\.jp2$/i.test(e.name)) out.push(full);
  }
  return out;
}

/** JP2 → JPEG at the JP2's own resolution (archive-bulk's route: opj_decompress, then sharp). */
export async function decodeJp2(jp2Path) {
  const tif = `${jp2Path}.out.tif`;
  try {
    await execFileP('opj_decompress', ['-i', jp2Path, '-o', tif, '-threads', '1'], { timeout: 180_000 });
  } catch (e) {
    if (!fs.existsSync(tif)) throw new Error(`opj_decompress failed: ${String(e?.stderr || e?.message).slice(0, 160)}`);
  }
  try {
    const buffer = await sharp(tif).jpeg({ quality: 90, mozjpeg: true }).toBuffer();
    const meta = await sharp(buffer).metadata();
    return { buffer, width: meta.width, height: meta.height };
  } finally {
    try { fs.unlinkSync(tif); } catch { /* gone */ }
  }
}

/**
 * Open a book's item zip for the manifest archiver. Returns null (with `onRefuse(reason)` called)
 * when the zip route is not proven for this book; the caller then archives page by page.
 *
 * @returns {Promise<null | { route, fileFor(p): string|null, decode(file): Promise<{buffer,width,height}>, close(): Promise<void>, bytes: number }>}
 */
// A run killed mid-book (cron `timeout`, OOM, a deploy restart) never reaches close(), and its
// half-downloaded zip or unzipped JP2s stay in tmp: on gex45 on 2026-10-28, eleven of these held
// 9.7 GB and the root disk reached 95% (#6223). Each open sweeps leftovers older than STALE_MS, which
// is far past one book (download cap 60 min, unzip 10 min, pages minutes), so a live book is never hit.
// The age rule alone was not enough (#90 item 5): on gex45 on 2026-11-12 the lane died on one item
// about every 50 minutes, the revive cron restarted it, and the age rule let ~7 attempts (9.5 GB)
// accumulate inside the 6 h window. So each dir records its owner pid (OWNER_FILE), and a dir whose
// owner is no longer alive is removed at once, at any age. A dir without the file (older code) keeps the age rule.
const STALE_MS = 6 * 3600_000;
const OWNER_FILE = '.owner-pid';
const pidAlive = (pid) => {
  try { process.kill(pid, 0); return true; } catch (e) { return e?.code === 'EPERM'; }
};
const ownerDead = (d, isAlive) => {
  let pid;
  try { pid = Number(fs.readFileSync(path.join(d, OWNER_FILE), 'utf8').trim()); } catch { return false; }
  return Number.isInteger(pid) && pid > 0 && pid !== process.pid && !isAlive(pid);
};
export function sweepStaleZipDirs(tmpRoot, { now = Date.now(), log = () => {}, isAlive = pidAlive } = {}) {
  let names = [];
  try { names = fs.readdirSync(tmpRoot).filter(n => n.startsWith('sl-iazip-') && n !== ATTEMPTS_FILE); } catch { return 0; }
  let removed = 0;
  for (const n of names) {
    const d = path.join(tmpRoot, n);
    try {
      if (!fs.statSync(d).isDirectory()) continue;
      if (!ownerDead(d, isAlive) && now - fs.statSync(d).mtimeMs < STALE_MS) continue;
      fs.rmSync(d, { recursive: true, force: true });
      removed++;
      log(`IA zip: removed stale scratch dir ${d}`);
    } catch { /* gone already, or not ours to stat: leave it */ }
  }
  return removed;
}

// An item whose zip attempt never finishes (the process dies before close(): OOM, a kill) is retried
// by every revived run, each one a multi-GB download. Count the unfinished attempts per item in a small
// file beside the dirs; close() clears the item. After MAX_UNFINISHED within ATTEMPT_WINDOW_MS the zip is
// refused for that item, so it goes page by page over IIIF instead.
const ATTEMPTS_FILE = 'sl-iazip-attempts.json';
const MAX_UNFINISHED = 3;
const ATTEMPT_WINDOW_MS = 24 * 3600_000;
const readAttempts = (tmpRoot) => {
  try { const j = JSON.parse(fs.readFileSync(path.join(tmpRoot, ATTEMPTS_FILE), 'utf8')); return j && typeof j === 'object' ? j : {}; } catch { return {}; }
};
const writeAttempts = (tmpRoot, j) => {
  try {
    const f = path.join(tmpRoot, ATTEMPTS_FILE);
    fs.writeFileSync(`${f}.${process.pid}`, JSON.stringify(j));
    fs.renameSync(`${f}.${process.pid}`, f);
  } catch { /* a scratch hint, never a reason to fail a book */ }
};
export function unfinishedZipAttempts(tmpRoot, iaId, { now = Date.now() } = {}) {
  const a = readAttempts(tmpRoot)[iaId];
  return a && now - Number(a.last || 0) < ATTEMPT_WINDOW_MS ? Number(a.n || 0) : 0;
}
export function noteZipAttempt(tmpRoot, iaId, { now = Date.now() } = {}) {
  const j = readAttempts(tmpRoot);
  for (const [k, v] of Object.entries(j)) if (now - Number(v?.last || 0) >= ATTEMPT_WINDOW_MS) delete j[k];
  j[iaId] = { n: Number(j[iaId]?.n || 0) + 1, last: now };
  writeAttempts(tmpRoot, j);
}
export function clearZipAttempt(tmpRoot, iaId) {
  const j = readAttempts(tmpRoot);
  if (!(iaId in j)) return;
  delete j[iaId];
  writeAttempts(tmpRoot, j);
}

export async function openIaZip({ manifestUrl, photos, onRefuse = () => {}, log = () => {}, fetchImpl = fetch,
  tmpRoot = os.tmpdir(), decode = decodeJp2, accessLeaves = fetchAccessLeaves, maxZipBytes = 6e9 }) {
  const refuse = (r) => { onRefuse(r); return null; };
  sweepStaleZipDirs(tmpRoot, { log });
  if (!zipToolsAvailable()) return refuse('opj_decompress/unzip not on this box');
  const iaId = iaIdFromManifest(manifestUrl);
  if (!iaId) return refuse('manifest URL names no IA identifier');
  const unfinished = unfinishedZipAttempts(tmpRoot, iaId);
  if (unfinished >= MAX_UNFINISHED) return refuse(`${unfinished} zip attempts on this item in 24 h never finished (the run died mid-book)`);

  let plan = planZipMapping(photos, null);
  if (!plan.route && /no member names/.test(plan.reason || '')) {
    plan = planZipMapping(photos, await accessLeaves(iaId, { attempts: 3, fetchImpl }));
  }
  if (!plan.route) return refuse(plan.reason);

  const meta = await fetchImpl(`https://archive.org/metadata/${encodeURIComponent(iaId)}/files`, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(60_000) });
  if (!meta.ok) return refuse(`metadata HTTP ${meta.status}`);
  const files = (await meta.json())?.result ?? [];
  const zip = files.find(f => /_jp2\.zip$/i.test(f?.name || ''));
  if (!zip) return refuse('item has no _jp2.zip');
  const size = Number(zip.size || 0);
  if (size > maxZipBytes) return refuse(`zip is ${(size / 1e9).toFixed(1)} GB, over the ${(maxZipBytes / 1e9).toFixed(0)} GB cap`);
  try {
    const free = fs.statfsSync(tmpRoot);
    if (size * 2.5 > free.bavail * free.bsize) return refuse(`not enough scratch disk for a ${(size / 1e9).toFixed(1)} GB zip`);
  } catch { /* statfs unavailable: let the download fail if it must */ }

  const dir = fs.mkdtempSync(path.join(tmpRoot, `sl-iazip-${iaId.slice(0, 40).replace(/[^\w.-]/g, '_')}-`));
  try { fs.writeFileSync(path.join(dir, OWNER_FILE), String(process.pid)); } catch { /* the age rule still applies */ }
  noteZipAttempt(tmpRoot, iaId);
  const close = async () => { fs.rmSync(dir, { recursive: true, force: true }); clearZipAttempt(tmpRoot, iaId); };
  try {
    const zipPath = path.join(dir, 'item.zip');
    const { res, bytes } = await fetchToFileWithStallTimeout(`https://archive.org/download/${encodeURIComponent(iaId)}/${encodeURIComponent(zip.name)}`, zipPath, {
      stallMs: 60_000, maxMs: 60 * 60_000, headers: { 'User-Agent': UA },
    });
    if (!res.ok) { await close(); return refuse(`zip HTTP ${res.status}`); }
    await execFileP('unzip', ['-q', '-o', zipPath, '-d', path.join(dir, 'x')], { timeout: 600_000 });
    fs.unlinkSync(zipPath);
    const jp2 = walkJp2(path.join(dir, 'x'));

    let fileFor;
    if (plan.route === 'exact') {
      const byName = new Map(jp2.map(f => [path.basename(f), f]));
      const want = plan.members.map(m => (m ? path.basename(m) : null));
      const missing = want.filter(m => m && !byName.has(m));
      if (missing.length) { await close(); return refuse(`${missing.length} named members are not in the zip (first: ${missing[0]})`); }
      fileFor = (p) => (want[p - 1] ? byName.get(want[p - 1]) : null);
    } else {
      const byLeaf = indexJp2FilesByLeaf(jp2);
      const missing = plan.leaves.filter(l => l != null && !byLeaf.has(l));
      if (missing.length) { await close(); return refuse(`${missing.length} scandata leaves have no file in the zip`); }
      fileFor = (p) => (plan.leaves[p - 1] != null ? byLeaf.get(plan.leaves[p - 1]) : null);
      // A count can agree while the order does not: two interior pages must match their IIIF render.
      const interior = photos.map((u, i) => [i + 1, u]).filter(([, u]) => u);
      const picks = [interior[Math.floor(interior.length / 3)], interior[Math.floor((2 * interior.length) / 3)]].filter(Boolean);
      for (const [p, u] of picks) {
        const small = String(u).replace(/\/full\/(?:full|max|[\d,!]+|pct:\d+)\/0\//, '/full/200,/0/');
        const r = await fetchImpl(small, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(45_000) });
        if (!r.ok) { await close(); return refuse(`alignment check: IIIF render of page ${p} answered ${r.status}`); }
        const [a, b] = await Promise.all([hashBuffer(Buffer.from(await r.arrayBuffer())), decode(fileFor(p)).then(d => hashBuffer(d.buffer))]);
        if (hammingHex(a, b) > HASH_MATCH) { await close(); return refuse(`alignment check: page ${p} zip leaf does not match its IIIF image`); }
      }
    }
    log(`IA zip ${iaId}: ${plan.route} mapping, ${jp2.length} members, ${(bytes / 1e6).toFixed(0)} MB`);
    return { route: plan.route, fileFor, decode, close, bytes };
  } catch (e) {
    await close();
    return refuse(`zip route failed: ${String(e?.message ?? e).slice(0, 160)}`);
  }
}
