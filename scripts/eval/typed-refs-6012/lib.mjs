// #6012 typed references (DTA, CAMENA, EEBO-TCP): private R2 storage with a verified sha256, the disk
// guard, and the versioned TEI → pages parse. No Mongo, no model call.
//
// PRIOR ART: scripts/eval/translation-student-5793/upload-adapter.mjs — one small put into the MAIN bucket,
//   which images.sourcelibrary.org serves; corpora need the private bucket, multipart, and a read-back hash.
//   scripts/eval/ground-truth-5935/pali.mjs — reads VRI XML with a split on <pb ed="P">; one corpus, UTF-16,
//   no header, no notes/forme-work handling. scripts/eval/build-edition-refs.mjs (#5488) takes ONE edition
//   file already flattened to text. scripts/lib/r2-key.mjs guards page-image keys (book-scoped); these are
//   not page images and never go through the page-image writers.
//
// Raw files are never edited. Everything derived carries PARSE_VERSION; change the parse → bump it.

import fs from 'node:fs';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { PassThrough } from 'node:stream';
import yauzl from 'yauzl';
import { S3Client, PutObjectCommand, GetObjectCommand, HeadObjectCommand, CreateMultipartUploadCommand, UploadPartCommand, CompleteMultipartUploadCommand, AbortMultipartUploadCommand, ListObjectsV2Command } from '@aws-sdk/client-s3';

export const BUCKET = 'sl-corpus-snapshots';             // private: no public domain, not behind images.sourcelibrary.org
export const PREFIX = 'eval-refs/typed-refs-6012';
export const PARSE_VERSION = 'tei-pages-v1';
export const UA = 'SourceLibrary-eval/1.0 (+https://sourcelibrary.org; issue 6012; internal quality measurement)';
export const DISK_LIMIT_PCT = 85;

export const argOf = (n, d) => { const a = process.argv.find((x) => x.startsWith(`--${n}=`)); return a ? a.slice(n.length + 3) : d; };
export const sha256 = (buf) => createHash('sha256').update(buf).digest('hex');

// ── disk ────────────────────────────────────────────────────────────────────
export function diskPct(path = '/data/scratch') {
  const out = execFileSync('df', ['--output=pcent', path], { encoding: 'utf8' });
  return Number(out.trim().split('\n').pop().replace('%', '').trim());
}
/** Throws at the limit: a batch checks before it writes, and stops rather than pass 85 %. */
export function assertDisk(margin = 0) {
  const p = diskPct();
  if (p + margin >= DISK_LIMIT_PCT) throw new Error(`disk at ${p}% (limit ${DISK_LIMIT_PCT}%, margin ${margin}): pausing`);
  return p;
}

// ── R2 (private bucket) ─────────────────────────────────────────────────────
let _s3;
export function r2() {
  if (_s3) return _s3;
  for (const k of ['R2_ACCOUNT_ID', 'R2_ACCESS_KEY_ID', 'R2_SECRET_ACCESS_KEY']) if (!process.env[k]) throw new Error(`${k} is not set`);
  _s3 = new S3Client({ region: 'auto', endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
    credentials: { accessKeyId: process.env.R2_ACCESS_KEY_ID, secretAccessKey: process.env.R2_SECRET_ACCESS_KEY } });
  return _s3;
}
export const keyOf = (rel) => {
  if (/^\/|\.\.|^$/.test(rel)) throw new Error(`bad key ${rel}`);
  return `${PREFIX}/${rel}`;
};

export async function sha256File(file) {
  const h = createHash('sha256');
  for await (const chunk of fs.createReadStream(file, { highWaterMark: 1 << 22 })) h.update(chunk);
  return h.digest('hex');
}
/** sha256 of the object as R2 returns it (a full read-back, not a stored header). */
export async function sha256Remote(key) {
  const r = await r2().send(new GetObjectCommand({ Bucket: BUCKET, Key: key }));
  const h = createHash('sha256'); let bytes = 0;
  for await (const chunk of r.Body) { h.update(chunk); bytes += chunk.length; }
  return { sha256: h.digest('hex'), bytes };
}
export async function head(key) {
  try { const r = await r2().send(new HeadObjectCommand({ Bucket: BUCKET, Key: key })); return { bytes: r.ContentLength, sha256: r.Metadata?.sha256 || null }; }
  catch (e) { if (e?.$metadata?.httpStatus === 404 || e?.name === 'NotFound') return null; throw e; }
}
export async function list(rel) {
  const out = []; let token;
  do {
    const r = await r2().send(new ListObjectsV2Command({ Bucket: BUCKET, Prefix: keyOf(rel), ContinuationToken: token }));
    for (const o of r.Contents || []) out.push({ key: o.Key, bytes: o.Size });
    token = r.NextContinuationToken;
  } while (token);
  return out;
}

const PART = 64 * 1024 * 1024;
/**
 * Upload a local file to the private bucket and prove it: the object is read back in full and its
 * sha256 compared with the local file's. Returns { key, bytes, sha256 }. Skips the upload when an
 * object with the same recorded sha256 and size is already there (resume), unless `force`.
 */
export async function putVerified(rel, file, { meta = {}, contentType = 'application/octet-stream', force = false, verify = true } = {}) {
  const key = keyOf(rel);
  const bytes = fs.statSync(file).size;
  const sha = await sha256File(file);
  const have = force ? null : await head(key);
  if (!(have && have.bytes === bytes && have.sha256 === sha)) {
    const Metadata = { sha256: sha, issue: '6012', ...meta };
    if (bytes <= PART) {
      await r2().send(new PutObjectCommand({ Bucket: BUCKET, Key: key, Body: fs.readFileSync(file), ContentType: contentType, Metadata }));
    } else {
      const { UploadId } = await r2().send(new CreateMultipartUploadCommand({ Bucket: BUCKET, Key: key, ContentType: contentType, Metadata }));
      const fd = fs.openSync(file, 'r'); const Parts = [];
      try {
        for (let n = 1, off = 0; off < bytes; n++, off += PART) {
          const buf = Buffer.allocUnsafe(Math.min(PART, bytes - off));
          fs.readSync(fd, buf, 0, buf.length, off);
          const r = await r2().send(new UploadPartCommand({ Bucket: BUCKET, Key: key, UploadId, PartNumber: n, Body: buf }));
          Parts.push({ PartNumber: n, ETag: r.ETag });
        }
        await r2().send(new CompleteMultipartUploadCommand({ Bucket: BUCKET, Key: key, UploadId, MultipartUpload: { Parts } }));
      } catch (e) { await r2().send(new AbortMultipartUploadCommand({ Bucket: BUCKET, Key: key, UploadId })).catch(() => {}); throw e; }
      finally { fs.closeSync(fd); }
    }
  }
  if (verify) {
    const back = await sha256Remote(key);
    if (back.sha256 !== sha || back.bytes !== bytes) throw new Error(`R2 read-back mismatch for ${key}: ${back.sha256}/${back.bytes} vs ${sha}/${bytes}`);
  }
  return { key, bytes, sha256: sha };
}
export async function getToFile(key, file) {
  const r = await r2().send(new GetObjectCommand({ Bucket: BUCKET, Key: key }));
  const w = fs.createWriteStream(file);
  for await (const chunk of r.Body) if (!w.write(chunk)) await new Promise((res) => w.once('drain', res));
  w.end(); await new Promise((res) => w.on('finish', res));
}

// ── bytes → text ────────────────────────────────────────────────────────────
/**
 * Decode an XML file's bytes. Valid UTF-8 sequences are read as UTF-8; any other byte is read as
 * Latin-1. CAMENA declares ISO-8859-1 and some of its files mix UTF-8 into it (#5126 deviation 1), so
 * neither a strict UTF-8 nor a plain Latin-1 read is right for the whole corpus.
 */
export function decodeBytes(buf) {
  if (buf.length >= 2 && buf[0] === 0xff && buf[1] === 0xfe) return buf.toString('utf16le').replace(/^﻿/, '');
  let ascii = true;
  for (let i = 0; i < buf.length; i++) if (buf[i] > 0x7f) { ascii = false; break; }
  if (ascii) return buf.toString('latin1');
  const strict = new TextDecoder('utf-8', { fatal: true });
  try { return strict.decode(buf).replace(/^﻿/, ''); } catch { /* mixed: fall through */ }
  const out = []; let i = 0, run = 0;
  const flush = (to) => { if (to > run) out.push(buf.toString('utf8', run, to)); };
  while (i < buf.length) {
    const b = buf[i];
    if (b < 0x80) { i++; continue; }
    const need = b >= 0xc2 && b <= 0xdf ? 1 : b >= 0xe0 && b <= 0xef ? 2 : b >= 0xf0 && b <= 0xf4 ? 3 : 0;
    let ok = need > 0 && i + need < buf.length + 0 && i + need <= buf.length - 0;
    for (let k = 1; ok && k <= need; k++) if ((buf[i + k] & 0xc0) !== 0x80) ok = false;
    if (ok) { i += need + 1; continue; }
    flush(i); out.push(String.fromCharCode(b)); i++; run = i;
  }
  flush(buf.length);
  return out.join('');
}

const NAMED = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', auml: 'ä', ouml: 'ö', uuml: 'ü', Auml: 'Ä', Ouml: 'Ö', Uuml: 'Ü', szlig: 'ß',
  aelig: 'æ', AElig: 'Æ', oelig: 'œ', OElig: 'Œ', eacute: 'é', egrave: 'è', ecirc: 'ê', euml: 'ë', aacute: 'á', agrave: 'à', acirc: 'â', iacute: 'í', igrave: 'ì', icirc: 'î', iuml: 'ï',
  oacute: 'ó', ograve: 'ò', ocirc: 'ô', uacute: 'ú', ugrave: 'ù', ucirc: 'û', ccedil: 'ç', ntilde: 'ñ', atilde: 'ã', otilde: 'õ', mdash: '—', ndash: '–', hellip: '…', sect: '§', para: '¶', dagger: '†', shy: '' };
export const decodeEntities = (s) => s.replace(/&(#x[0-9a-fA-F]+|#\d+|[A-Za-z][A-Za-z0-9]*);/g, (m, e) => {
  if (e[0] === '#') { const cp = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10); try { return String.fromCodePoint(cp); } catch { return ' '; } }
  return e in NAMED ? NAMED[e] : ' ';
});

// ── TEI → pages (PARSE_VERSION tei-pages-v1) ────────────────────────────────
// One pass over the tags of <text>. A page starts at each <pb>; text before the first <pb> is page 0.
//   dropped    forme work (<fw>: running heads, signatures, catchwords, page numbers), editorial additions
//              (<corr>, <reg>, <expan>, <figDesc>, <supplied>), the header.
//   kept       the printed form of every <choice> (<sic>, <orig>, <abbr>).
//   notes      <note> content goes to page.notes, not page.text: marginal and foot notes sit elsewhere on
//              the leaf than where the encoding anchors them, so they cannot be part of a linear body.
//   gaps       <gap> (TCP: illegible, missing, foreign) becomes U+25CA ◊ once per gap; normalisers drop it,
//              and `gaps` counts them so a scorer can skip a damaged page.
const DROP = new Set(['fw', 'corr', 'reg', 'expan', 'figdesc', 'supplied', 'teiheader', 'header', 'idg', 'ex']);
const NOTE = new Set(['note']);
const BREAK = new Set(['p', 'lb', 'l', 'lg', 'head', 'div', 'div1', 'div2', 'div3', 'div4', 'div5', 'div6', 'div7', 'item', 'list', 'row', 'cell', 'table', 'sp', 'speaker', 'stage',
  'closer', 'opener', 'salute', 'signed', 'dateline', 'trailer', 'titlepage', 'titlepart', 'doctitle', 'docimprint', 'docauthor', 'byline', 'epigraph', 'q', 'quote', 'argument', 'figure', 'cb', 'milestone', 'bibl', 'front', 'body', 'back', 'group', 'text']);
const attr = (tag, name) => { const m = tag.match(new RegExp(`\\s${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)')`, 'i')); return m ? (m[1] ?? m[2]) : null; };

export function teiPages(xml) {
  // The transcription starts at the first <text> after the header (TCP P4: <TEXT> after </HEADER>).
  const hEnd = xml.search(/<\/(teiHeader|HEADER)>/);
  const from = xml.slice(Math.max(0, hEnd)).search(/<text[\s>]/i);
  const body = from < 0 ? xml.slice(Math.max(0, hEnd)) : xml.slice(Math.max(0, hEnd) + from);
  const pages = [{ n: null, facs: null, ref: null, t: [], notes: [], gaps: 0 }];
  let cur = pages[0], drop = 0, note = 0, noteBuf = null;
  const push = (s) => { if (drop) return; if (note) noteBuf.push(s); else cur.t.push(s); };
  const re = /<!--[\s\S]*?-->|<\?[\s\S]*?\?>|<!\[CDATA\[[\s\S]*?\]\]>|<[^>]+>|[^<]+/g;
  let m;
  while ((m = re.exec(body))) {
    const tok = m[0];
    if (tok[0] !== '<') { push(decodeEntities(tok)); continue; }
    if (tok[1] === '!' || tok[1] === '?') continue;
    const close = tok[1] === '/';
    const name = (tok.match(/^<\/?\s*([A-Za-z][\w:.-]*)/) || [, ''])[1].toLowerCase().replace(/^tei:/, '');
    const selfClose = /\/>$/.test(tok);
    if (name === 'pb') {
      if (note) { cur.notes.push(noteBuf.join('')); noteBuf = []; }
      cur = { n: attr(tok, 'n'), facs: attr(tok, 'facs') || attr(tok, 'id'), ref: attr(tok, 'ref'), t: [], notes: [], gaps: 0 };
      pages.push(cur); continue;
    }
    if (name === 'gap') { if (!drop) { cur.gaps++; push(attr(tok, 'disp') || '◊'); } continue; }
    if (DROP.has(name)) { if (!selfClose) drop += close ? -1 : 1; if (drop < 0) drop = 0; continue; }
    if (NOTE.has(name) && !drop) {
      if (selfClose) continue;
      if (!close) { if (!note) noteBuf = []; note++; }
      else if (note) { note--; if (!note) { cur.notes.push(noteBuf.join('')); noteBuf = null; } }
      continue;
    }
    if (BREAK.has(name)) push('\n');
  }
  const tidy = (s) => s.replace(/[ \t\r\f\v]+/g, ' ').replace(/ ?\n ?/g, '\n').replace(/\n{2,}/g, '\n').trim().normalize('NFC');
  return pages.map((p) => ({ n: p.n, facs: p.facs, ref: p.ref, text: tidy(p.t.join('')), notes: p.notes.map(tidy).filter(Boolean), gaps: p.gaps }))
    .filter((p, i) => i > 0 || p.text);
}

// ── folding for alignment (not a scorer) ────────────────────────────────────
/**
 * Letters only, lower case, the early-print conventions that differ between a keyed text and an OCR
 * read folded away: ſ→s, ß→ss, æ/œ, u/v, i/j, w→uu, umlaut-e (aͤ) and umlauts to base vowels, accents, the Latin
 * tilde abbreviations are NOT expanded (both sides keep the printed form). Used to FIND a page, never
 * to score one.
 */
export function foldLatin(t) {
  return String(t || '').normalize('NFD').toLowerCase()
    .replace(/[̀-ͯ]/g, '')
    .replace(/ſ/g, 's').replace(/ß/g, 'ss').replace(/æ/g, 'ae').replace(/œ/g, 'oe').replace(/ꝛ/g, 'r').replace(/&/g, 'et')
    .replace(/w/g, 'uu').replace(/v/g, 'u').replace(/j/g, 'i').replace(/y/g, 'i')
    .replace(/[^a-z]/g, '');
}

// ── zip archives, local or on R2 (range reads: a 13 GB package never has to sit on this disk) ──
// The central directory sits at the end of a zip and yauzl reads it in thousands of small ranges, so
// the tail is fetched once and served from memory; only member data goes to R2 as a range request.
class R2Reader extends yauzl.RandomAccessReader {
  constructor(key, tailStart, tail) { super(); this.key = key; this.tailStart = tailStart; this.tail = tail; }
  _readStreamForRange(start, end) {
    const pt = new PassThrough();
    if (start >= this.tailStart) { pt.end(this.tail.subarray(start - this.tailStart, end - this.tailStart)); return pt; }
    r2().send(new GetObjectCommand({ Bucket: BUCKET, Key: this.key, Range: `bytes=${start}-${end - 1}` })).then((r) => r.Body.pipe(pt), (e) => pt.destroy(e));
    return pt;
  }
}
export async function openZip(where) {
  if (where.r2Key) {
    const h = await head(where.r2Key); if (!h) throw new Error(`no such object ${where.r2Key}`);
    const tailStart = Math.max(0, h.bytes - (where.tailBytes || 24 * 1024 * 1024));
    const r = await r2().send(new GetObjectCommand({ Bucket: BUCKET, Key: where.r2Key, Range: `bytes=${tailStart}-${h.bytes - 1}` }));
    const cs = []; for await (const c of r.Body) cs.push(c);
    return new Promise((res, rej) => yauzl.fromRandomAccessReader(new R2Reader(where.r2Key, tailStart, Buffer.concat(cs)), h.bytes, { lazyEntries: true, autoClose: false, decodeStrings: false }, (e, z) => (e ? rej(e) : res(z))));
  }
  return new Promise((res, rej) => yauzl.open(where.file, { lazyEntries: true, decodeStrings: false }, (e, z) => (e ? rej(e) : res(z))));
}
export const entryStream = (z, entry) => new Promise((res, rej) => z.openReadStream(entry, (e, s) => (e ? rej(e) : res(s))));
export async function entryBuffer(z, entry) { const s = await entryStream(z, entry); const cs = []; for await (const c of s) cs.push(c); return Buffer.concat(cs); }
/** Visit every file entry in order; `fn(entry, read)` may await. */
export async function eachEntry(z, fn) {
  await new Promise((res, rej) => {
    // Names are decoded here, not by yauzl: its name validation refuses the "/" root entry Dropbox writes
    // into a folder zip, and with it the whole archive.
    z.on('entry', async (entry) => { try { if (Buffer.isBuffer(entry.fileName)) entry.fileName = entry.fileName.toString('utf8'); if (!/\/$/.test(entry.fileName)) await fn(entry, () => entryBuffer(z, entry)); z.readEntry(); } catch (e) { rej(e); } });
    z.on('end', res); z.on('error', rej); z.readEntry();
  });
}
