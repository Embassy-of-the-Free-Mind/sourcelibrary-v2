// LOCATE (#7119): place each leaf of Whish 147 in the published texts, leaf after leaf, so each leaf's search window
// starts where the previous leaf ended. One sealed Opus call per leaf: p01 = left half, p02 = right half.
// Writes reads/locate/<page>-<leaf>.txt (+meta) and locate.json (per leaf: status, work, edition span).
//   node locate.mjs <stream-name> <first-page> <last-page> <start-work> [start-offset-in-work]
// Streams run in parallel over different stretches of the book; locate.json is merged per leaf.
import fs from 'node:fs';
import path from 'node:path';
import { sealedCall, crop, boxes, edition, HERE } from './lib.mjs';
import { fold, findAll } from './textmatch.mjs';

export const WORKS = [
  { work: 'sk', name: 'Īśvarakṛṣṇa, Sāṅkhyakārikā', source: 'GRETIL, sa_IzvarakRSNa-sAMkhyakArikA (input by Ferenc Ruzsa)', leaf: 650 },
  { work: 'jm', name: 'Śaṅkara, Jayamaṅgalā on the Sāṅkhyakārikā', source: 'GRETIL, from H. Sarma\'s edition, Calcutta 1926', leaf: 800 },
  { work: 'tk', name: 'Vācaspati Miśra, Tattvakaumudī', source: 'a machine transcription of Tārānātha Tarkavācaspati\'s printed edition, Calcutta (Bavarian State Library copy)', leaf: 1500 },
  { work: 'dipika', name: 'Annambhaṭṭa, Tarkasaṃgrahadīpikā', source: 'GRETIL, sa_annaMbhaTTa-tarkasaMgraha-comm (the Dīpikā only)', leaf: 700 },
  { work: 'ts', name: 'Annambhaṭṭa, Tarkasaṃgraha', source: 'GRETIL, sa_annaMbhatta-tarkasaMgraha', leaf: 1100 },
];
export function corpus() {
  let text = '', parts = [];
  for (const w of WORKS) { const t = edition(w.work); parts.push({ ...w, start: text.length, end: text.length + t.length }); text += t + '\n\n'; }
  return { text, parts };
}
export const workAt = (parts, off) => parts.find((p) => off >= p.start && off < p.end) || parts[parts.length - 1];

const snap = (t, i, dir) => { while (i > 0 && i < t.length && !/\s/.test(t[i])) i += dir; return Math.max(0, Math.min(t.length, i)); };

export function locatePrompt(work, windowText, quarters = false) {
  const files = quarters
    ? 'The files p01.jpg, p02.jpg, p03.jpg and p04.jpg are the four QUARTERS of one palm leaf, left to right (each overlaps its neighbour slightly)'
    : 'The files p01.jpg and p02.jpg are the LEFT and RIGHT halves of one palm leaf';
  return `${files} of a Kerala manuscript (Sanskrit in Malayalam script, Calicut 1822). Open ${quarters ? 'all four' : 'both'} with the Read tool.

Layout: the leaf has two string holes. The top and bottom rows run the full width; the rows in between are split into blocks around the holes, and the rows on either side of a hole do NOT always line up (a block can have one row more or fewer than its neighbour). ${quarters ? 'A word at the edge of one quarter may continue in the next.' : 'p01 is cut from p02 at the middle of the leaf, so the last word of a row in p01 may continue at the start of the same row in p02.'}

The manuscript holds, one after another: the Sāṅkhyakārikā; Śaṅkara's Jayamaṅgalā commentary on it; Vācaspati Miśra's Tattvakaumudī; an unidentified fragment; Annambhaṭṭa's Tarkasaṃgrahadīpikā; his Tarkasaṃgraha. This leaf is expected to fall in or near the window below, from ${work.name} (${work.source}). The window may begin before the leaf and run past it; the leaf may also lie outside it, or be front matter, a colophon, or the unidentified fragment.

WINDOW:
<<<
${windowText}
>>>

TASK: place this leaf in the window. Work ROW BY ROW, separately for each ${quarters ? 'quarter' : 'half'}. For each row, copy from the WINDOW the first and the last words of the stretch that row shows in that half. Place a row only where you can see letters on the leaf that match the window's words; never place a row just because it would fit the sequence. A row you cannot place gets "—".
Do not transcribe the leaf beyond that.

Answer in exactly this form:
${quarters ? 'PART p01' : 'HALF p01'}
ROW 1 | <first words, copied from the window> | <last words, copied from the window> | sure/unsure
ROW 2 | ...
${quarters ? 'PART p02\nROW 1 | ...\n(and so on for p03, p04)' : 'HALF p02\nROW 1 | ...'}
LEAF_START | <the first 3–5 words of the window that the leaf shows>
LEAF_END | <the last 3–5 words of the window that the leaf shows>
STATUS | located | partly | not-in-window | not-text
NOTE | <one line: e.g. an opening invocation or colophon on the leaf, or why you could not place it>`;
}

/** Parse a locate reply into edition offsets within the window. */
export function parseLocate(reply, windowText, expectLen) {
  const folded = fold(windowText);
  const status = (reply.match(/^STATUS\s*\|\s*([\w-]+)/m) || [])[1] || 'unparsed';
  const pts = [];
  for (const m of reply.matchAll(/^ROW\s+\d+\s*\|\s*([^|]*)\|\s*([^|]*)\|\s*(\w+)/gm)) {
    for (const [ph, kind] of [[m[1], 'a'], [m[2], 'b']]) {
      if (!ph || /^\s*[—–-]\s*$/.test(ph)) continue;
      const hits = findAll(windowText, ph, folded);
      if (hits.length === 1 || (hits.length > 1 && hits[0].len >= 14)) pts.push({ ...hits[0], kind, sure: m[3] === 'sure' });
    }
  }
  for (const [k, kind] of [['LEAF_START', 'a'], ['LEAF_END', 'b']]) {
    const ph = (reply.match(new RegExp(`^${k}\\s*\\|\\s*(.*)$`, 'm')) || [])[1];
    if (!ph) continue;
    const hits = findAll(windowText, ph, folded);
    if (hits.length === 1) pts.push({ ...hits[0], kind, sure: true, leaf: k });
  }
  if (pts.length < 3) return { status, ok: false, why: `only ${pts.length} placed phrases matched the window`, pts };
  // keep the densest cluster: points within 2.5 leaf-lengths of the median
  const sorted = pts.map((p) => p.start).sort((a, b) => a - b);
  const med = sorted[Math.floor(sorted.length / 2)];
  const keep = pts.filter((p) => Math.abs(p.start - med) <= 2.5 * expectLen);
  if (keep.length < 3) return { status, ok: false, why: 'placed phrases scattered across the window', pts };
  const start = Math.min(...keep.map((p) => p.start)), end = Math.max(...keep.map((p) => p.end));
  return { status, ok: !/not-in-window|not-text/.test(status), start, end, n: keep.length, dropped: pts.length - keep.length };
}

async function main() {
  const [stream, a, b, startWork, startOff] = process.argv.slice(2);
  const { text, parts } = corpus();
  const B = boxes();
  const outF = path.join(HERE, `locate-${stream}.json`);
  const out = fs.existsSync(outF) ? JSON.parse(fs.readFileSync(outF, 'utf8')) : {};
  let cursor = parts.find((p) => p.work === startWork).start + Number(startOff || 0);
  let misses = 0;
  for (let n = Number(a); n <= Number(b); n++) {
    const leaves = Object.keys(B[n]?.leaves || {});
    for (const leaf of leaves) {
      const key = `${n}-${leaf}`;
      const w = workAt(parts, cursor);
      const L = w.leaf * (1 + Math.min(misses, 3));
      const w0 = snap(text, Math.max(0, cursor - 350), -1), w1 = snap(text, Math.min(text.length, cursor + 3 * L), 1);
      const windowText = text.slice(w0, w1).trim();
      const r = await sealedCall({ stage: 'locate', id: key, model: 'opus', prompt: locatePrompt(w, windowText), images: [crop(n, leaf, 'L'), crop(n, leaf, 'R')] });
      if (!r.meta.ok) { out[key] = { status: 'call-failed', error: r.meta.error_class }; misses++; continue; }
      const off = text.indexOf(windowText);
      const p = parseLocate(r.text, windowText, w.leaf);
      if (p.ok) {
        const s = off + p.start, e = off + p.end;
        const ws = workAt(parts, s);
        out[key] = { status: p.status, work: ws.work, start: s - ws.start, end: Math.min(e, ws.end) - ws.start, phrases: p.n, dropped: p.dropped };
        cursor = e; misses = 0;
      } else {
        // A miss leaves the cursor where it is and widens the next window: advancing on a guess loses the text
        // (4-t, the leaf before the kārikās begin, pushed 4-b's window past kārikā 1 on the first trial).
        out[key] = { status: p.status, located: false, why: p.why, window_work: w.work, window_start: w0 - w.start };
        misses++;
      }
      fs.writeFileSync(outF, JSON.stringify(out, null, 1));
      console.log(`${key}: ${JSON.stringify(out[key])} (${r.meta.secs}s${r.cached ? ', cached' : ''})`);
    }
  }
}
if (process.argv[1] && import.meta.url === `file://${process.argv[1]}`) await main();
