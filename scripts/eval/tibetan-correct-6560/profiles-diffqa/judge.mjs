#!/usr/bin/env node
// PRIOR ART: scripts/eval/tibetan-correct-6560/pass/leafcheck.mjs on #7483 (audit-req --severity, tiles-req,
// confirm-req, page-req, severity-gate). Those subcommands read a cli-ocr read dir and the LIVE draft, and score one
// read per page. Here each page has several texts (arms A/B/C, each with and without the diff-hunk QA, and the lane's
// guards), all against one fixed Yigdzin draft, and a hunk judged once is reused by every text that keeps it. The
// READOFF / SEVERITY wording, the controls, the tile cut and the severity rule are leafcheck's, copied word for word.
/**
 * Judges for the corrector-profile / diff-hunk QA experiment (#6560, #6740). Requests run through
 * scripts/eval/replicate-6547/run-claude-arm.py (sealed `claude -p --model opus --restricted`, Read only).
 *
 *   span-req    --arm=A   the tiled span judge with --severity over every hunk of arm A's output (pages only)
 *   confirm-req --arm=A   a fresh judge on every severe draft-win AND every line-level hunk of arm A
 *   page-req    --variants=A,B,C[,A+qa,...]   the route-judge whole-page judge on the draft and each distinct text
 *   qa-req                one sealed call per page line with hunks in A, B or C (pages and planted drafts): the leaf, a
 *                         band tile around the line, each distinct hunk as an item (two readings in random order), one
 *                         known-answer control; a removed passage gets its own call, with "how many times on the leaf?"
 *   score       [--out=S.json]   every variant: better/same/worse, severe introduced, plants, line-count outcomes, cost
 * All files live under --root ($JOB_SCRATCH): set/pages.jsonl, req/drafts.jsonl, out/<arm>.jsonl (Stage 1),
 * judge/<kind>-req.jsonl and judge/<kind>-key.json written here, judge/<kind>-out.jsonl written by the runner.
 */
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { diffSyllables, syllableTokens, alignSyllables, yatagsHits } from '../../../lib/tibetan-yatags-guard.mjs';
import { wilson } from '../../lib/agreement-stats.mjs';

const CMD = process.argv[2];
const arg = (n) => process.argv.find((a) => a.startsWith(`--${n}=`))?.split('=').slice(1).join('=');
const ROOT = arg('root') || process.env.JOB_SCRATCH;
const J = (...p) => path.join(ROOT, ...p);
const readJsonl = (f) => (fs.existsSync(f) ? fs.readFileSync(f, 'utf8').split('\n').filter((l) => l.trim()).map((l) => JSON.parse(l)) : []);
const writeJsonl = (f, rows) => { fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, rows.map((r) => JSON.stringify(r)).join('\n') + (rows.length ? '\n' : '')); };
const readJson = (f, d = null) => (fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, 'utf8')) : d);
const hash = (t) => createHash('sha256').update(t).digest('hex').slice(0, 12);
const NFC = (t) => String(t ?? '').normalize('NFC');

// ── leafcheck.mjs, word for word ────────────────────────────────────────────────────────────────────────────────
function rngFor(s) {
  let h = 1779033703 ^ s.length;
  for (let i = 0; i < s.length; i++) { h = Math.imul(h ^ s.charCodeAt(i), 3432918353); h = (h << 13) | (h >>> 19); }
  let a = h >>> 0;
  return () => { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
const shuffle = (xs, rng) => { for (let i = xs.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [xs[i], xs[j]] = [xs[j], xs[i]]; } return xs; };
const READOFF = 'You are checking a transcription of a Tibetan Kangyur manuscript against its image. Below are numbered '
  + 'items. Each gives the approximate line (counting from the top of the image; a frame may show two leaves '
  + 'of about 7 lines each, upper leaf first), the syllables just before the spot, and two or more candidate '
  + 'readings for the spot. Look at the image and say which candidate the manuscript actually shows. Judge '
  + 'only by what is written on this leaf, not by what the text ought to say. If none of the candidates '
  + 'matches, answer "other" and write what you see. If you cannot find or read the spot, answer "unclear".\n\n'
  + 'Reply with one JSON object per line, one per item, between two marker lines <<<BEGIN>>> and <<<END>>>, '
  + 'nothing outside the markers: {"item": <n>, "answer": "A"|"B"|"other"|"unclear", "seen": "<what the '
  + 'leaf shows, in Tibetan Unicode>"}\n\nItems:\n';
const SEVERITY = '\n\nFor each item, also say how the candidates differ from EACH OTHER, whichever one is right: "severe" if '
  + 'they are different words or meanings (another word, a negation added or lost, a different number, a different mantra '
  + 'or dhāraṇī syllable or vowel length, or words or a line present in one and missing in the other); "minor" if they are '
  + 'the same word written another way (a particle variant such as ཀྱི/གྱི/གི, a particle added or dropped, a spelling or '
  + 'abbreviation variant, tsheg or shad punctuation, a syllable split or joined). Add "diff": "severe"|"minor" to each '
  + 'JSON object.';
const TILE_NOTE = '\n\nThe same frame is also cut into four overlapping tiles at full resolution: tile-ul.jpg (upper left), '
  + 'tile-ur.jpg (upper right), tile-ll.jpg (lower left) and tile-lr.jpg (lower right), in this folder. Open the tile '
  + 'that holds a spot to read small marks such as a subscribed letter or a vowel sign.';
const NOTHING = '(nothing: the syllables before go straight on to the syllables after)';
const SWAPS = [['པ', 'བ'], ['བ', 'པ'], ['ད', 'ང'], ['ང', 'ད'], ['ས', 'མ'], ['མ', 'ས'], ['ི', 'ེ'], ['ེ', 'ི'], ['ུ', 'ོ'], ['ོ', 'ུ'], ['ག', 'ཀ'], ['ན', 'ཏ']];
const lineOf = (text, off) => NFC(text).slice(0, off).split('\n').filter((l) => !/^\s*<[^>]+>\s*$/.test(l)).length;
function controls(d, rng, n = 2) {
  const eq = d.pairs.filter(([i, j]) => i !== null && j !== null && d.A[i].syl === d.B[j].syl);
  const out = [];
  for (let t = 0; t < 20 && out.length < n && eq.length > 12; t++) {
    const [, j] = eq[5 + Math.floor(rng() * (eq.length - 10))];
    const s = d.B[j].syl;
    const sw = SWAPS.find(([a]) => s.includes(a));
    if (!sw || out.some((c) => c.j === j)) continue;
    out.push({ kind: 'control', j, base: s, arm: s.replace(sw[0], sw[1]), line: lineOf(d.nextText, d.B[j].start),
      before: d.B.slice(Math.max(0, j - 4), j).map((x) => x.syl).join('་'), after: d.B.slice(j + 1, j + 5).map((x) => x.syl).join('་') });
  }
  return out;
}
function buildPrompt(items, rng, { severity = false, head = READOFF } = {}) {
  shuffle(items, rng);
  const lines = items.map((it, n) => {
    const flip = rng() < 0.5;
    const opts = flip ? [it.arm || NOTHING, it.base || NOTHING] : [it.base || NOTHING, it.arm || NOTHING];
    Object.assign(it, { item: n + 1, A_is: flip ? 'arm' : 'base' });
    return `${n + 1}. line ≈ ${it.line || '?'}; just before: ${it.before || '(start)'}; A: ${opts[0]}   B: ${opts[1]}; just after: ${it.after || '(end)'}${it.count_q ? `; ${it.count_q}` : ''}`;
  });
  return head.replace('\n\nItems:\n', (severity ? SEVERITY : '') + '\n\nItems:\n') + lines.join('\n');
}
const diffOf = (ans) => { const d = String(ans?.diff || '').trim().toLowerCase(); return d === 'severe' || d === 'minor' ? d : null; };
function parseReply(text) {
  const m = String(text || '').match(/<<<\s*BEGIN\s*>>>([\s\S]*?)(?:<<<\s*END\s*>>>|$)/);
  const out = {};
  for (let l of (m ? m[1] : String(text || '')).split('\n')) {
    l = l.trim().replace(/,$/, '');
    if (!l.startsWith('{')) continue;
    try { const j = JSON.parse(l); out[Number(j.item)] = j; } catch { /* a malformed line is an unanswered item */ }
  }
  return out;
}
function sideOf(it, ans) {
  const a = String(ans?.answer || '').trim().toUpperCase();
  if (a === 'A' || a === 'B') return (a === 'A') === (it.A_is === 'arm') ? 'arm' : 'base';
  if (a === 'OTHER') return 'other';
  if (a === 'UNCLEAR') return 'unclear';
  return null;
}
async function tiles(pid, image) {
  const sharp = (await import('sharp')).default;
  const dir = J('tiles', pid);
  fs.mkdirSync(dir, { recursive: true });
  const { width: W, height: H } = await sharp(image).metadata();
  const files = [];
  for (const [nm, x0, y0] of [['ul', 0, 0], ['ur', 0.45, 0], ['ll', 0, 0.45], ['lr', 0.45, 0.45]]) {
    const f = path.join(dir, `tile-${nm}.jpg`);
    if (!fs.existsSync(f)) await sharp(image).extract({ left: Math.round(x0 * W), top: Math.round(y0 * H), width: Math.round(0.55 * W), height: Math.round(0.55 * H) }).jpeg({ quality: 92 }).toFile(f);
    files.push(f);
  }
  return files;
}

// ── texts and hunks ────────────────────────────────────────────────────────────────────────────────────────────────
const pages = readJsonl(J('set', 'pages.jsonl'));
const PAGE = new Map(pages.map((p) => [p.uid, p]));
const DRAFT = new Map(readJsonl(J('req', 'drafts.jsonl')).map((r) => [r.uid, NFC(r.draft)]));
const IMAGE = new Map(readJsonl(J('req', 'A.jsonl')).map((r) => [r.uid, r.image]));
const ARMS = ['A', 'B', 'C'];
const armOut = (arm) => new Map(readJsonl(J('out', `${arm}.jsonl`)).filter((r) => r.text && r.text.trim()).map((r) => [r.uid, NFC(r.text.trim())]));
export const textLines = (t) => NFC(t).split('\n').filter((l) => l.trim() && !/^\s*<[^>]+>\s*$/.test(l)).length;
const MAX_CHANGED = 0.25;   // cli-ocr.mjs MAX_CORRECTED
const isLineHunk = (h) => Math.max(h.a.length, h.b.length) >= 6 && Math.abs(h.a.length - h.b.length) >= 4;   // rescore.mjs SEVERE line rule

/** The hunks of one text against the draft, each with a stable id: draft positions + the new syllables. */
function hunksOf(uid, text) {
  const draft = DRAFT.get(uid);
  const d = { ...diffSyllables(draft, text), nextText: NFC(text) };
  const iBefore = (h) => { // the draft syllable just before a hunk (for an insertion, its anchor)
    if (h.a.length) return h.a[0] - 1;
    const k = d.pairs.findIndex(([, j]) => j === h.b[0]);
    for (let x = k - 1; x >= 0; x--) if (d.pairs[x][0] !== null) return d.pairs[x][0];
    return -1;
  };
  const hs = d.hunks.map((h) => {
    const base = h.a.map((i) => d.A[i].syl).join('་'), arm = h.b.map((j) => d.B[j].syl).join('་');
    const ib = iBefore(h);
    const id = `${h.a.length ? `${h.a[0]}-${h.a[h.a.length - 1]}` : `ins@${ib}`}|${arm}`;
    const prevJ = h.b.length ? h.b[0] - 1 : (() => { const k = d.pairs.findIndex(([i]) => i === ib); for (let x = k; x >= 0; x--) if (d.pairs[x]?.[1] != null) return d.pairs[x][1]; return -1; })();
    const nextJ = h.b.length ? h.b[h.b.length - 1] + 1 : prevJ + 1;
    const draftLine = lineOf(draft, h.a.length ? d.A[h.a[0]].start : (d.A[ib]?.end ?? 0));
    return { id, a: h.a, b: h.b, base, arm, line_hunk: isLineHunk(h), draft_line: draftLine,
      line: lineOf(d.nextText, d.B[h.b[0]]?.start ?? d.B[Math.max(0, prevJ)]?.end ?? 0),
      before: d.B.slice(Math.max(0, prevJ - 3), prevJ + 1).map((x) => x.syl).join('་'), after: d.B.slice(nextJ, nextJ + 4).map((x) => x.syl).join('་') };
  });
  return { d, hunks: hs };
}

/** The text with the hunks NOT in keep put back to the draft (whole hunks, the draft's own separators). */
export function revertHunks(uid, text, keep) {
  const draft = DRAFT.get(uid);
  const { d, hunks } = hunksOf(uid, text);
  let out = d.nextText;
  // right to left over the output, so earlier offsets stay valid
  const edits = [];
  for (const h of hunks) {
    if (keep.has(h.id)) continue;
    const a0 = h.a[0], a1 = h.a[h.a.length - 1];
    if (h.b.length) {
      const s = d.B[h.b[0]].start, e = d.B[h.b[h.b.length - 1]].end;
      if (h.a.length) edits.push({ s, e, t: draft.slice(d.A[a0].start, d.A[a1].end) });
      else { // an insertion: drop it with the separator before it
        const ps = h.b[0] > 0 ? d.B[h.b[0] - 1].end : 0;
        edits.push({ s: ps, e, t: h.b[0] > 0 ? '' : '' });
      }
    } else { // a deletion: put the draft's run back after the output syllable aligned before it
      const k = d.pairs.findIndex(([i]) => i === a0);
      let j = -1; for (let x = k - 1; x >= 0; x--) if (d.pairs[x][1] !== null) { j = d.pairs[x][1]; break; }
      const at = j >= 0 ? d.B[j].end : 0;
      const from = a0 > 0 ? d.A[a0 - 1].end : 0;
      edits.push({ s: at, e: at, t: draft.slice(from, d.A[a1].end) });
    }
  }
  for (const x of edits.sort((p, q) => q.s - p.s || q.e - p.e)) out = out.slice(0, x.s) + x.t + out.slice(x.e);
  return out;
}

// ── variants: Stage 1 arms, + diff-hunk QA, + the lane's guards ──────────────────────────────────────────────────
function qaVerdicts() {
  const key = readJson(J('judge', 'qa-key.json'), {});
  const rep = Object.fromEntries(readJsonl(J('judge', 'qa-out.jsonl')).filter((r) => r.text).map((r) => [r.uid, r]));
  const v = {}, ctl = { right: 0, wrong: 0, unclear: 0 }, calls = { n: 0, secs: 0, cost: 0 };
  for (const [uid, k] of Object.entries(key)) {
    const r = rep[uid];
    if (r) { calls.n++; calls.secs += r.secs || 0; calls.cost += r.cost_usd_equiv || 0; }
    const ans = r ? parseReply(r.text) : {};
    for (const it of k.items) {
      const s = sideOf(it, ans[it.item]);
      if (it.kind === 'control') { if (s === 'base') ctl.right++; else if (s === 'arm' || s === 'other') ctl.wrong++; else ctl.unclear++; continue; }
      let keep = s === 'arm';
      // a removed passage: how often the leaf shows it decides, where the judge gave a count
      const cnt = Number.parseInt(ans[it.item]?.count, 10);
      if (it.removal && Number.isFinite(cnt)) keep = cnt < it.draft_copies;
      v[it.hunk_key] = { side: s ?? 'unanswered', keep, count: Number.isFinite(cnt) ? cnt : null, draft_copies: it.draft_copies ?? null };
    }
  }
  return { v, ctl, calls };
}
const hunkKey = (uid, id) => `${uid}#${id}`;

/** Every text to score, per page: {variant: text}. */
function variants(withQa) {
  const QA = withQa ? qaVerdicts().v : null;
  const out = new Map();
  for (const arm of ARMS) {
    const O = armOut(arm);
    for (const uid of DRAFT.keys()) {
      const m = out.get(uid) ?? out.set(uid, {}).get(uid);
      const text = O.get(uid) ?? null;
      m[arm] = text;   // null: the arm did not read the page (it stays the draft)
      if (!text) continue;
      const { d, hunks } = hunksOf(uid, text);
      // the lane now (#6740 wave 2): blanket line-count refusal, the 25% cap, the ya-btags guard (a held change with no
      // leaf check goes back to the draft), the Latin-letter guard. The Derge guard is not reproduced (no e-text index here).
      const refuse = textLines(text) !== textLines(DRAFT.get(uid)) || d.changed / Math.max(1, d.draftN) > MAX_CHANGED || /[A-Za-z]/.test(text.replace(/<[^>]+>/g, ''));
      if (refuse) m[`${arm}+lane`] = DRAFT.get(uid);
      else {
        const yh = yatagsHits(DRAFT.get(uid), text);
        const yat = new Set(yh.map((h) => h.j));
        m[`${arm}+lane`] = yh.length ? revertHunks(uid, text, new Set(hunks.filter((h) => !(h.b.length === 1 && yat.has(h.b[0]))).map((h) => h.id))) : text;
      }
      if (QA) {
        const keep = new Set(hunks.filter((h) => QA[hunkKey(uid, h.id)]?.keep).map((h) => h.id));
        m[`${arm}+qa`] = keep.size === hunks.length ? text : revertHunks(uid, text, keep);
      }
    }
  }
  return out;
}

// ── commands ─────────────────────────────────────────────────────────────────────────────────────────────────────
if (CMD === 'span-req' || CMD === 'confirm-req') {
  const arm = arg('arm');
  const O = armOut(arm);
  const reqs = [], key = {};
  const span = CMD === 'confirm-req' ? readJson(J('judge', `span-${arm}-key.json`)) : null;
  const spanRep = CMD === 'confirm-req' ? Object.fromEntries(readJsonl(J('judge', `span-${arm}-out.jsonl`)).filter((r) => r.text).map((r) => [r.uid, parseReply(r.text)])) : null;
  for (const p of pages) {
    const text = O.get(p.uid);
    if (!text) continue;
    const { d, hunks } = hunksOf(p.uid, text);
    if (!hunks.length) continue;
    if (d.changed / Math.max(1, d.draftN) > MAX_CHANGED) { key[p.uid] = { wreck: true, changed: d.changed, draftN: d.draftN }; continue; }
    let items;
    if (CMD === 'span-req') items = hunks.map((h) => ({ kind: 'span', hunk: h.id, base: h.base, arm: h.arm, line: h.line, before: h.before, after: h.after, line_hunk: h.line_hunk }));
    else {
      const k = span[p.uid]; const ans = spanRep[p.uid];
      if (!k || k.wreck || !ans) continue;
      items = k.items.filter((it) => it.kind === 'span' && (it.line_hunk || (sideOf(it, ans[it.item]) === 'base' && diffOf(ans[it.item]) === 'severe')))
        .map(({ item, A_is, ...it }) => ({ ...it, orig_item: item }));
      if (!items.length) continue;
    }
    const rng = rngFor(`6560|profiles|${CMD}|${arm}|${p.uid}`);
    items.push(...controls(d, rng));
    reqs.push({ uid: p.uid, image: p.image, prompt: buildPrompt(items, rng, { severity: CMD === 'span-req' }) + TILE_NOTE, extra_images: await tiles(p.uid, p.image) });
    key[p.uid] = { items, changed: d.changed, draftN: d.draftN };
  }
  const kind = CMD === 'span-req' ? 'span' : 'confirm';
  writeJsonl(J('judge', `${kind}-${arm}-req.jsonl`), reqs);
  fs.writeFileSync(J('judge', `${kind}-${arm}-key.json`), JSON.stringify(key));
  console.log(`${kind}-req ${arm}: ${reqs.length} requests, ${reqs.reduce((s, r) => s + (r.prompt.match(/\n\d+\. line/g) || []).length, 0)} items; ${Object.values(key).filter((k) => k.wreck).length} pages over the 25% cap (whole-page judge only)`);
} else if (CMD === 'page-req') {
  const { judgePrompt } = await import('../../route-judge-6740/judge.mjs');
  const want = (arg('variants') || 'A,B,C').split(',');
  const V = variants(want.some((w) => w.endsWith('+qa')));
  const have = new Set(readJsonl(J('judge', 'page-out.jsonl')).filter((r) => r.text).map((r) => r.uid));
  const old = readJsonl(J('judge', 'page-req.jsonl'));
  const seen = new Set(old.map((r) => r.uid));
  const reqs = [...old];
  for (const p of pages) {
    for (const text of [DRAFT.get(p.uid), ...want.map((w) => V.get(p.uid)?.[w])]) {
      if (!text) continue;
      const uid = `${p.uid}|${hash(NFC(text))}`;
      if (seen.has(uid)) continue;
      seen.add(uid);
      reqs.push({ uid, image: p.image, prompt: judgePrompt({ task: 'ocr', lang: 'Tibetan', text: NFC(text) }, 'the file ./page.jpg in your working directory (open it with Read before you answer)') });
    }
  }
  writeJsonl(J('judge', 'page-req.jsonl'), reqs);
  console.log(`page-req: ${reqs.length} distinct texts (${reqs.filter((r) => !have.has(r.uid)).length} not yet judged)`);
} else if (CMD === 'qa-req') {
  // One sealed call per page LINE that has hunks (amended before any judge ran: arm A alone has 1,154 hunks on 62
  // pages, so a call per hunk would be ~1,800 calls). The line's distinct hunks from A, B and C are the items (the same
  // draft run and the same new syllables on the same page are one hunk, whichever arm wrote it), with one known-answer
  // control. A removed passage (a line-level hunk that removes syllables) gets a call of its own with the count question.
  const sharp = (await import('sharp')).default;
  const COUNT_Q = 'this item is a passage present in one reading and absent in the other: also add "count": <how many times this passage, or a near-copy of it, is written on the whole leaf (0, 1, 2, ...)>';
  const groups = new Map();   // `${uid}|L${line}` or `${uid}|R${id}` -> {uid, line, d, hunks: Map(hunk_key -> item)}
  for (const arm of ARMS) {
    const O = armOut(arm);
    for (const uid of DRAFT.keys()) {
      const text = O.get(uid); if (!text) continue;
      const { d, hunks } = hunksOf(uid, text);
      if (d.changed / Math.max(1, d.draftN) > MAX_CHANGED) continue;   // the lane refuses these whole; no hunk is kept
      for (const h of hunks) {
        const hk = hunkKey(uid, h.id);
        const removal = h.line_hunk && h.a.length > h.b.length;
        const g = removal ? `${uid}|R${h.id}` : `${uid}|L${h.draft_line}`;
        const G = groups.get(g) ?? groups.set(g, { uid, line: h.draft_line, d, hunks: new Map() }).get(g);
        if (G.hunks.has(hk)) continue;
        let draft_copies = null;
        if (removal) { // copies of the passage in the draft: windows of its length aligning at >= 60% identity, not overlapping
          const P = h.a.map((i) => d.A[i].syl), A = d.A.map((x) => x.syl);
          draft_copies = 0;
          for (let s = 0; s + P.length <= A.length;) {
            const w = A.slice(s, s + P.length);
            const same = alignSyllables(P, w).filter(([x, y]) => x !== null && y !== null && P[x] === w[y]).length;
            if (same / P.length >= 0.6) { draft_copies++; s += P.length; } else s++;
          }
          draft_copies = Math.max(1, draft_copies);
        }
        G.hunks.set(hk, { kind: 'span', hunk_key: hk, base: h.base, arm: h.arm, line: h.line, before: h.before, after: h.after, removal, draft_copies, ...(removal && { count_q: COUNT_Q }) });
      }
    }
  }
  const key = {}, reqs = [];
  for (const [g, G] of [...groups].sort(([x], [y]) => x.localeCompare(y))) {
    const quid = `qa|${hash(g)}`;
    const rng = rngFor(`6560|profiles|qa|${g}`);
    const items = [...G.hunks.values(), ...controls(G.d, rng, 1)];
    const img = IMAGE.get(G.uid);
    const N = textLines(DRAFT.get(G.uid)) || 1;
    // a band of the frame around the line at full resolution: the draft's line, spread evenly over the frame
    const dir = J('qa-tiles', quid.replace('|', '_')); fs.mkdirSync(dir, { recursive: true });
    const band = path.join(dir, 'band.jpg');
    if (!fs.existsSync(band)) {
      const { width: W, height: H } = await sharp(img).metadata();
      const y = 0.06 + (Math.min(G.line, N) - 0.5) / N * 0.88, hh = Math.max(0.22, 3 / N);
      const top = Math.max(0, Math.min(1 - hh, y - hh / 2));
      await sharp(img).extract({ left: 0, top: Math.round(top * H), width: W, height: Math.round(hh * H) }).jpeg({ quality: 92 }).toFile(band);
    }
    const note = `\n\nA strip of the same frame around line ${items[0].line} is in this folder at full resolution: band.jpg. Open it to read small marks; the strip is an estimate, so look above or below it in the page image if the spot is not there.`;
    reqs.push({ uid: quid, image: img, prompt: buildPrompt(items, rng) + note, extra_images: [band] });
    key[quid] = { group: g, uid: G.uid, items };
  }
  writeJsonl(J('judge', 'qa-req.jsonl'), reqs);
  fs.writeFileSync(J('judge', 'qa-key.json'), JSON.stringify(key));
  const hk = Object.values(key).reduce((s, k) => s + k.items.filter((i) => i.kind !== 'control').length, 0);
  console.log(`qa-req: ${reqs.length} calls, ${hk} distinct hunks, over ${new Set(Object.values(key).map((k) => k.uid)).size} pages; ${Object.values(key).filter((k) => k.items.some((i) => i.removal)).length} removed passages`);
} else if (CMD === 'score') {
  const withQa = fs.existsSync(J('judge', 'qa-out.jsonl'));
  const V = variants(withQa);
  const QA = withQa ? qaVerdicts() : null;
  const plants = readJson(arg('plants') || 'scripts/eval/results/tibetan-correct-6560/plants.json');
  const parseJ = (t) => { const m = String(t || '').match(/\{[\s\S]*\}/); if (!m) return null; try { const v = JSON.parse(m[0]); return typeof v.accept === 'boolean' && Number(v.fidelity) >= 1 && Number(v.fidelity) <= 5 ? v : null; } catch { return null; } };
  const PJ = Object.fromEntries(readJsonl(J('judge', 'page-out.jsonl')).filter((r) => r.text).map((r) => [r.uid, parseJ(r.text)]));
  const pj = (uid, text) => PJ[`${uid}|${hash(NFC(text))}`] ?? null;
  const wt = (v) => (v?.defects || []).filter((x) => x.severity === 'wrong_text');
  const cl = (v) => new Set(wt(v).map((x) => String(x.class || '').toUpperCase().match(/^[IOTDE]\d+/)?.[0] ?? 'E2'));
  const more = (x, y) => wt(y).length > wt(x).length || [...cl(y)].some((c2) => !cl(x).has(c2));
  // span-judge and confirm verdicts per hunk (each Stage-1 arm judged its own hunks; a hunk two arms share takes the
  // verdict of the first arm, A then B then C, that judged it)
  const SJ = {}, CJ = {}, ctl = { span: { right: 0, n: 0 }, confirm: { right: 0, n: 0 } }, wreck = {};
  let opus = { span: 0, confirm: 0, page: readJsonl(J('judge', 'page-out.jsonl')).length, qa: QA?.calls.n ?? 0 };
  for (const arm of ARMS) {
    const key = readJson(J('judge', `span-${arm}-key.json`), {});
    const rep = Object.fromEntries(readJsonl(J('judge', `span-${arm}-out.jsonl`)).filter((r) => r.text).map((r) => [r.uid, parseReply(r.text)]));
    const ck = readJson(J('judge', `confirm-${arm}-key.json`), {});
    const cr = Object.fromEntries(readJsonl(J('judge', `confirm-${arm}-out.jsonl`)).filter((r) => r.text).map((r) => [r.uid, parseReply(r.text)]));
    opus.span += Object.keys(rep).length; opus.confirm += Object.keys(cr).length;
    for (const [uid, k] of Object.entries(key)) {
      if (k.wreck) { wreck[`${arm}|${uid}`] = true; continue; }
      for (const it of k.items) {
        const s = sideOf(it, rep[uid]?.[it.item]);
        if (it.kind === 'control') { ctl.span.n++; if (s === 'base') ctl.span.right++; continue; }
        SJ[hunkKey(uid, it.hunk)] ??= { side: s ?? 'unanswered', diff: diffOf(rep[uid]?.[it.item]), line_hunk: it.line_hunk, base: it.base, arm: it.arm, line: it.line, seen: rep[uid]?.[it.item]?.seen ?? null };
      }
    }
    for (const [uid, k] of Object.entries(ck)) for (const it of k.items) {
      const s = sideOf(it, cr[uid]?.[it.item]);
      if (it.kind === 'control') { ctl.confirm.n++; if (s === 'base') ctl.confirm.right++; continue; }
      CJ[hunkKey(uid, it.hunk)] ??= s ?? 'unanswered';
    }
  }
  const NAMES = [...ARMS, ...ARMS.map((a) => `${a}+lane`), ...(withQa ? ARMS.map((a) => `${a}+qa`) : [])];
  const anchors = { 128: 'right', 131: 'right', 233: 'loss' };
  const res = {};
  for (const name of NAMES) {
    const arm = name[0];
    const rows = [];
    for (const p of pages) {
      const draft = DRAFT.get(p.uid);
      const text = V.get(p.uid)?.[name] ?? null;
      const row = { uid: p.uid, group: p.group, page_number: p.page_number, book_id: p.book_id, read: !!text };
      if (!text || text === draft) { Object.assign(row, { verdict: 'same', pooled: 'same', severe_introduced: false, severe_fixed: false, unchanged: true, lines: `${textLines(draft)}->${textLines(draft)}` }); rows.push(row); continue; }
      const { hunks } = hunksOf(p.uid, text);
      const isWreck = wreck[`${arm}|${p.uid}`] && name === arm;
      let arm_w = 0, base_w = 0, sevI = 0, sevIc = 0, sevF = 0, minI = 0, minF = 0, nojudge = 0;
      const sev = [], lineH = [];
      for (const h of hunks) {
        const s = SJ[hunkKey(p.uid, h.id)];
        if (!s) { nojudge++; continue; }
        if (s.side === 'arm') arm_w++; else if (s.side === 'base') base_w++;
        if (s.side === 'arm' || s.side === 'base') {
          const dv = s.diff ?? (h.line_hunk ? 'severe' : null);
          if (dv === 'severe' && s.side === 'base') { sevI++; const c = CJ[hunkKey(p.uid, h.id)]; if (c === 'base') sevIc++; sev.push(`${h.base || '∅'}→${h.arm || '∅'} (l.${h.line}; confirm ${c ?? '-'})`); }
          if (dv === 'severe' && s.side === 'arm') sevF++;
          if (dv === 'minor') s.side === 'arm' ? minF++ : minI++;
        }
        if (h.line_hunk) lineH.push({ id: h.id, removal: h.a.length > h.b.length, span: s.side, confirm: CJ[hunkKey(p.uid, h.id)] ?? null });
      }
      const span = isWreck ? null : base_w > arm_w ? 'worse' : arm_w > base_w ? 'better' : 'same';
      const a = pj(p.uid, draft), b = pj(p.uid, text);
      let page = null;
      if (a && b) { const dd = Number(b.fidelity) - Number(a.fidelity); page = dd < 0 || (a.accept && !b.accept) || (!wt(a).length && wt(b).length) ? 'worse' : dd > 0 ? 'better' : 'same'; }
      const both = [span, page].filter(Boolean);
      const pooled = isWreck ? 'worse' : !both.length ? null : both.length === 1 ? both[0] : span === page ? span : span === 'same' ? page : page === 'same' ? span : 'same';
      const pageAdded = !!(a && b && more(a, b)), pageFixed = !!(a && b && more(b, a));
      const o5 = (v) => wt(v).filter((x) => /^O5/i.test(String(x.class || ''))).length;
      // line-count outcome (pre-registered): RIGHT when every whole-passage removal was seen as removed on the leaf by
      // both the span judge and the confirm judge and the page judge adds no omission; LOSS when both judges saw the
      // draft's passage on the leaf, or the page judge finds an omission the draft does not have; else UNCLEAR.
      const lc = textLines(text) !== textLines(draft);
      let line_outcome = null;
      if (lc) {
        const rem = lineH.filter((x) => x.removal);
        const loss = rem.some((x) => x.span === 'base' && x.confirm === 'base') || (a && b && o5(b) > o5(a));
        const right = !loss && rem.length > 0 && rem.every((x) => x.span === 'arm' && x.confirm === 'arm');
        line_outcome = loss ? 'loss' : right ? 'right' : rem.length ? 'unclear' : 'no passage removed (line breaks only)';
      }
      Object.assign(row, { lines: `${textLines(draft)}->${textLines(text)}`, line_outcome, hunks: hunks.length, unjudged_hunks: nojudge, span_arm: arm_w, span_base: base_w, span, page, pooled, wreck: isWreck || undefined,
        fidelity: a && b ? `${a.fidelity}->${b.fidelity}` : null, wrong_text: a && b ? `${wt(a).length}->${wt(b).length}` : null,
        severe_introduced: sevIc > 0 || pageAdded || !!isWreck, severe_introduced_one_judge: sevI > 0 || pageAdded || !!isWreck, severe_fixed: sevF > 0 || pageFixed,
        span_severe: { fixed: sevF, introduced: sevI, introduced_confirmed: sevIc }, minor: { fixed: minF, introduced: minI }, severe_spans: sev,
        page_note: pageAdded ? wt(b).map((x) => `${x.class ?? ''} ${x.what ?? ''} «${String(x.quote ?? '').slice(0, 60)}»`).join('; ') : null });
      rows.push(row);
    }
    const judged = rows.filter((r) => r.pooled);
    const cnt = (f, v) => rows.filter((r) => r[f] === v).length;
    const sevPages = rows.filter((r) => r.severe_introduced).length;
    const lineRows = rows.filter((r) => r.line_outcome);
    // plants: the planted syllable survives if the text has it at the aligned position (score.py's rule)
    let pl = null;
    if (plants) {
      pl = { plants: 0, caught: 0, restored: 0, survived: 0, not_read: 0 };
      for (const [fid, P] of Object.entries(plants.plants)) {
        const uid = `plant|${fid}`;
        const draft = DRAFT.get(uid);
        const text = name.endsWith('+lane') || name.endsWith('+qa') ? V.get(uid)?.[name] : armOut(arm).get(uid);
        const lines = draft.split('\n');
        for (const q of P.plants) {
          pl.plants++;
          if (!text) { pl.not_read++; pl.survived++; continue; }
          const off = lines.slice(0, q.line).reduce((s, l) => s + l.length + 1, 0) + q.offset;
          const A = syllableTokens(draft), B = syllableTokens(text);
          const i = A.findIndex((x) => x.start === off);
          const pair = alignSyllables(A.map((x) => x.syl), B.map((x) => x.syl)).find(([x]) => x === i);
          const got = pair?.[1] != null ? B[pair[1]].syl : null;
          if (got === q.planted) pl.survived++; else { pl.caught++; if (got === q.orig) pl.restored++; }
        }
      }
      pl.catch_rate = pl.caught / Math.max(1, pl.plants);
    }
    const an = {};
    for (const [n, want] of Object.entries(anchors)) {
      const r = rows.find((x) => x.group === (n === '233' ? 'brgyad' : 'lines') && x.page_number === Number(n));
      if (r) an[`p.${n}`] = { expected: want === 'right' ? 'line removed (leaf has 7 lines)' : 'no line lost', lines: r.lines, outcome: r.line_outcome ?? 'line count kept', unchanged: !!r.unchanged };
    }
    res[name] = {
      pages: rows.length, read: rows.filter((r) => r.read).length, unchanged: rows.filter((r) => r.unchanged).length,
      pooled: { better: cnt('pooled', 'better'), same: cnt('pooled', 'same'), worse: cnt('pooled', 'worse'), judged: judged.length },
      span_judge: { better: cnt('span', 'better'), same: cnt('span', 'same'), worse: cnt('span', 'worse') },
      page_judge: { better: cnt('page', 'better'), same: cnt('page', 'same'), worse: cnt('page', 'worse') },
      severe_introduced_pages: sevPages, severe_introduced_per10: Math.round(100 * sevPages / rows.length) / 10,
      severe_introduced_pages_one_judge: rows.filter((r) => r.severe_introduced_one_judge).length,
      severe_fixed_pages: rows.filter((r) => r.severe_fixed).length,
      plants: pl,
      line_count_changed: lineRows.length, line_outcomes: Object.fromEntries(['right', 'loss', 'unclear', 'no passage removed (line breaks only)'].map((k) => [k, lineRows.filter((r) => r.line_outcome === k).length])),
      anchors: an,
      by_group: Object.fromEntries([...new Set(rows.map((r) => r.group))].map((g) => { const rr = rows.filter((r) => r.group === g); return [g, { n: rr.length, better: rr.filter((r) => r.pooled === 'better').length, worse: rr.filter((r) => r.pooled === 'worse').length, severe: rr.filter((r) => r.severe_introduced).length }]; })),
      rows,
    };
    const R = res[name];
    // the pre-registered rule (experiments file): all four must hold
    R.rule = {
      severity: sevPages < 0.2 * rows.length,
      better_3x_worse: R.pooled.better >= 3 * R.pooled.worse,
      plants_ge_A: null,
      line_removals: (an['p.128']?.outcome === 'right') && (an['p.131']?.outcome === 'right') && R.line_outcomes.loss === 0,
    };
  }
  for (const name of NAMES) { const r = res[name]; r.rule.plants_ge_A = r.plants ? r.plants.catch_rate >= res.A.plants.catch_rate : null; r.rule.pass = Object.values(r.rule).every((x) => x === true); }
  const hunksPerPage = {};
  for (const arm of ARMS) { const O = armOut(arm); const n = [...DRAFT.keys()].filter((u) => O.get(u)).map((u) => hunksOf(u, O.get(u)).hunks.length); hunksPerPage[arm] = { pages: n.length, hunks: n.reduce((s, x) => s + x, 0), median: n.sort((x, y) => x - y)[Math.floor(n.length / 2)] }; }
  const out = { scored_at: new Date().toISOString(), controls: { span: ctl.span, confirm: ctl.confirm, qa: QA?.ctl ?? null }, opus_calls: opus,
    qa_cost: QA ? { calls: QA.calls.n, secs: Math.round(QA.calls.secs), cost_usd_equiv: Math.round(QA.calls.cost * 100) / 100, hunks_per_page: hunksPerPage, span_correction_right_ci: null } : null,
    variants: res };
  if (arg('out')) fs.writeFileSync(arg('out'), JSON.stringify(out, null, 1));
  console.log('controls', JSON.stringify(out.controls), 'opus', JSON.stringify(opus));
  console.log('variant | pooled b/s/w | severe pages (per 10) | plants caught | line right/loss/unclear/breaks | p.128 p.131 p.233 | rule');
  for (const name of NAMES) {
    const r = res[name];
    console.log(`${name.padEnd(7)} | ${r.pooled.better}/${r.pooled.same}/${r.pooled.worse} | ${r.severe_introduced_pages} (${r.severe_introduced_per10}) | ${r.plants ? `${r.plants.caught}/${r.plants.plants}` : '-'} | ${Object.values(r.line_outcomes).join('/')} | ${['p.128', 'p.131', 'p.233'].map((k) => `${r.anchors[k]?.lines ?? '?'}:${r.anchors[k]?.outcome ?? '?'}`).join(' ')} | ${r.rule.pass ? 'PASS' : 'fail'} ${JSON.stringify(r.rule)}`);
  }
  void wilson;
} else if (CMD === 'selftest') {
  // revertHunks: keeping no hunk gives the draft's syllables, keeping all gives the text, keeping half leaves exactly
  // the kept hunks
  let n = 0, bad = 0;
  for (const arm of ARMS) for (const [uid, text] of armOut(arm)) {
    const { hunks } = hunksOf(uid, text);
    if (!hunks.length) continue;
    n++;
    const syl = (t) => syllableTokens(t).map((x) => x.syl).join(' ');
    const none = revertHunks(uid, text, new Set());
    const half = new Set(hunks.filter((_, i) => i % 2 === 0).map((h) => h.id));
    const got = new Set(hunksOf(uid, revertHunks(uid, text, half)).hunks.map((h) => h.id));
    const ok = syl(none) === syl(DRAFT.get(uid)) && revertHunks(uid, text, new Set(hunks.map((h) => h.id))) === NFC(text) && [...half].every((x) => got.has(x)) && got.size === half.size;
    if (!ok) { bad++; if (bad <= 5) console.log('MISMATCH', arm, uid, syl(none) === syl(DRAFT.get(uid)), [...half].filter((x) => !got.has(x)).slice(0, 3), [...got].filter((x) => !half.has(x)).slice(0, 3)); }
  }
  console.log(`selftest: ${n} texts, ${bad} mismatches`);
} else {
  console.error('usage: judge.mjs span-req|confirm-req|page-req|qa-req|score --root=DIR (see the header)');
  process.exit(2);
}
