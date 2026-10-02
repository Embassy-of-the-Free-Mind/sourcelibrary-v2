// PRIOR ART: /root/tibetan-eval/kanjur_align.py (#4523, Hetzner, not in the repo) — the syllable
// tokenizer and Needleman-Wunsch identity are ported from it so the numbers are comparable; it does
// RETRIEVAL over the whole Kangyur from an unknown page, whereas here the folio is already claimed
// (BDRC canvas label) and the question is only "is the claim right?", so retrieval is replaced by a
// bounded offset search. scripts/works-catalog/import-cbeta-text.mjs writes a scholarly e-text as
// `ocr.data` but has no images to align against. scripts/lib/ndl-koten-lane.mjs is the
// page-provenance shape (`ocr.source`, `ocr.content_hash`, human-edit guard) this follows.
//
// derge-tengyur — pure helpers for the Derge Tengyur (#5497) and Derge Kangyur (#5665) imports: BDRC
// scans (W23703, W4CZ5369) aligned folio-for-folio to the Esukhia digital editions (public domain).
// The 84000 catalogue parse below follows read84000() in scripts/catalog-coverage/canon-gap-map.mjs,
// but reads each `works` array as JSON: its single regex can carry one record's status onto the next.
//
// No DB, no network. The importer is scripts/import/derge-tengyur-import.mjs.

import { createHash } from 'node:crypto';

export const TSHEG = '་';
// Tibetan punctuation / marks + whitespace, treated as syllable separators (kanjur_align.py PUNCT_RE).
const PUNCT_RE = /[\u0F01-\u0F0A\u0F0D-\u0F17\u0F1A-\u0F1F\u0F3A-\u0F3D\u0FBE-\u0FCF\s]+/gu;
// Esukhia editorial markup: (error,correction) keeps the first reading — the woodblock's; {D123}
// Tohoku boundaries ({D1-1}: a sub-text, Kangyur); [X] doubt marks; # peydurma note points. Stripped
// for SCORING only.
const MARKUP_RE = /\{D[0-9a-z]+(?:-\d+)?\}|[[\]#]/g;

/**
 * NFC-normalised Tibetan syllables, editorial markup removed (scoring only — never stored).
 * `blockSpelling`: also keep the first reading of {archaic,standard} (`{མྱི་,མི་}`, 61K in the
 * Kangyur e-text) — the spelling carved on the block, which is what a read of the image sees. Off for
 * the Tengyur, whose measurements were taken without it.
 */
export function syllables(text, { blockSpelling = false } = {}) {
  let t = String(text || '').normalize('NFC');
  t = t.replace(/\(([^,()]*),[^()]*\)/g, '$1');
  if (blockSpelling) t = t.replace(/\{([^,{}]*),[^{}]*\}/g, '$1');
  t = t.replace(MARKUP_RE, ' ');
  t = t.replace(PUNCT_RE, TSHEG);
  return t.split(TSHEG).filter((s) => s && /[\u0F40-\u0FBC]/u.test(s));
}

/**
 * Needleman-Wunsch on syllable arrays (match 2, mismatch -1, gap -1, as kanjur_align.py).
 * Returns matches / len(a): the share of the READ that the reference accounts for.
 */
export function nwIdentity(a, b) {
  const n = a.length, m = b.length;
  if (!n || !m) return 0;
  // Score-only DP with a parallel match-count DP along the chosen path (no traceback matrix).
  let prevS = new Int32Array(m + 1), prevM = new Int32Array(m + 1);
  let curS = new Int32Array(m + 1), curM = new Int32Array(m + 1);
  for (let j = 0; j <= m; j++) prevS[j] = -j;
  for (let i = 1; i <= n; i++) {
    curS[0] = -i; curM[0] = 0;
    const ai = a[i - 1];
    for (let j = 1; j <= m; j++) {
      const eq = ai === b[j - 1];
      const d = prevS[j - 1] + (eq ? 2 : -1);
      const u = prevS[j] - 1;
      const l = curS[j - 1] - 1;
      if (d >= u && d >= l) { curS[j] = d; curM[j] = prevM[j - 1] + (eq ? 1 : 0); }
      else if (u >= l) { curS[j] = u; curM[j] = prevM[j]; }
      else { curS[j] = l; curM[j] = curM[j - 1]; }
    }
    [prevS, curS] = [curS, prevS];
    [prevM, curM] = [curM, prevM];
  }
  return prevM[m] / n;
}

/**
 * Parse one Esukhia volume file into ordered page sides.
 * Markers: `[1b]` opens a side, `[1b.3]` is line 3 of it; `[355xa]` is a repeated folio number.
 * @returns {{ label: string, folio: number, side: 'a'|'b', dup: boolean, lines: string[], tohoku: string[] }[]}
 */
export function parseVolume(raw) {
  const pages = [];
  let cur = null;
  const open = (label) => {
    const m = label.match(/^(\d+)(x?)([ab])$/);
    if (!m) throw new Error(`derge-tengyur: unparseable folio marker [${label}]`);
    cur = { label, folio: Number(m[1]), side: m[3], dup: m[2] === 'x', lines: [], tohoku: [] };
    pages.push(cur);
  };
  for (const rawLine of String(raw).replace(/^\uFEFF/, '').split('\n')) {
    const line = rawLine.replace(/\r$/, '');
    if (!line.trim()) continue;
    const m = line.match(/^\[(\d+x?[ab])(?:\.(\d+))?\](.*)$/);
    if (!m) {
      // A continuation line without a marker belongs to the current side.
      if (!cur) throw new Error('derge-tengyur: text before the first folio marker');
      cur.lines.push(line);
      continue;
    }
    const [, label, lineNo, rest] = m;
    if (!cur || cur.label !== label) open(label);
    if (lineNo != null || rest.trim()) cur.lines.push(rest);
  }
  for (const p of pages) {
    for (const l of p.lines) for (const t of l.matchAll(/\{(D[0-9a-z]+(?:-\d+)?)\}/g)) p.tohoku.push(t[1]);
  }
  return pages;
}

/**
 * The text stored for one side. Lines are kept as the block's lines; the `[1b.3]` markers become
 * line breaks; Esukhia's editorial markup ({D…}, (x,y), [x], #) is kept verbatim — it is the
 * edition's apparatus and the Tohoku markers are the text boundaries. A `#` that would open a line
 * is backslash-escaped so the Markdown reader does not render the line as a heading.
 */
export function pageText(page) {
  return page.lines.map((l) => l.replace(/^#/, '\\#')).join('\n').normalize('NFC').trim();
}

export const sha16 = (t) => createHash('sha256').update(t || '').digest('hex').slice(0, 16);

/** BDRC canvas label ("2a", "img. 5", …) → folio label or null. */
export function canvasFolioLabel(canvas) {
  const labels = Array.isArray(canvas?.label) ? canvas.label : [canvas?.label];
  for (const l of labels) {
    const v = typeof l === 'string' ? l : (l?.['@language'] === 'en' ? l['@value'] : null);
    if (typeof v === 'string' && /^\d+[ab]$/.test(v.trim())) return v.trim();
  }
  return null;
}

/**
 * Claim a text side for every canvas by its BDRC folio label, walking both sequences forward
 * (folio numbering can restart at 1a inside a volume, and a repeated folio is `NNNxa` in the text).
 * Returns, per canvas, the index into `pages` or null. A label that does not occur within the next
 * LOOKAHEAD sides is left unclaimed rather than searched for globally — a global search on a
 * restarting numbering would match the wrong run.
 */
export function claimByLabel(canvasLabels, pages, LOOKAHEAD = 6) {
  const norm = (p) => `${p.folio}${p.side}`;
  const out = [];
  let ptr = 0;
  for (const lab of canvasLabels) {
    if (!lab) { out.push(null); continue; }
    let hit = null;
    for (let k = ptr; k < Math.min(pages.length, ptr + LOOKAHEAD); k++) {
      if (norm(pages[k]) === lab) { hit = k; break; }
    }
    out.push(hit);
    if (hit != null) ptr = hit + 1;
  }
  return out;
}

/**
 * Score one image read against the claimed side and every side within ±SPAN of it.
 * `measured_shift` is the shift (in text sides) that scores best; `control` is the best score among
 * WRONG sides at distance ≥ 2 (neighbours ±1 can legitimately share a run of text at a page break)
 * plus one far side — the wrong-folio control.
 *
 * When nothing in the window reaches `floor`, the read is scored against EVERY side of the volume
 * (`global_best`): a read that matches a side far away is evidence of misalignment, while a read
 * that matches no side anywhere is evidence only that the reader failed on this image.
 */
export function scoreRead(readText, pages, claimed, { span = 6, far = null, floor = 0.4, blockSpelling = false } = {}) {
  const read = syllables(readText);
  const sylCache = new Map();
  const sylOf = (i) => { if (!sylCache.has(i)) sylCache.set(i, syllables(pages[i].lines.join(' '), { blockSpelling })); return sylCache.get(i); };
  const byShift = {};
  for (let d = -span; d <= span; d++) {
    const i = claimed + d;
    if (i < 0 || i >= pages.length) continue;
    byShift[d] = nwIdentity(read, sylOf(i));
  }
  const shifts = Object.keys(byShift).map(Number);
  const best = shifts.reduce((a, b) => (byShift[b] > byShift[a] ? b : a), 0);
  const ctrl = shifts.filter((d) => Math.abs(d) >= 2).map((d) => byShift[d]);
  let farScore = null;
  if (far != null && far >= 0 && far < pages.length) { farScore = nwIdentity(read, sylOf(far)); ctrl.push(farScore); }
  const r4 = (x) => Math.round(x * 1000) / 1000;
  let globalBest = null;
  if (byShift[best] < floor && read.length > 0) {
    let gi = 0, gs = -1;
    for (let i = 0; i < pages.length; i++) {
      if (sylOf(i).length === 0) continue;
      const v = nwIdentity(read, sylOf(i));
      if (v > gs) { gs = v; gi = i; }
    }
    globalBest = { shift: gi - claimed, side: pages[gi].label, identity: r4(gs) };
  }
  return {
    read_syllables: read.length,
    claimed_syllables: sylOf(claimed).length,
    identity: r4(byShift[0] ?? 0),
    measured_shift: best,
    best_identity: r4(byShift[best]),
    control: r4(ctrl.length ? Math.max(...ctrl) : 0),
    far_control: farScore == null ? null : r4(farScore),
    global_best: globalBest,
    by_shift: Object.fromEntries(shifts.map((d) => [d, r4(byShift[d])])),
  };
}

/**
 * Volume verdict (rules v2, 2026-10-01).
 *
 * A sample is INFORMATIVE when the read matches some side at ≥ informativeFloor — in the ±6 window,
 * or anywhere in the volume. An uninformative read (the reader failed: measured on v3 f. 89a, where
 * Yigdzin returned `ཨུན་ཨུ་+་ཊ་…` for a clean page that matches its side by eye) says nothing about
 * alignment and is excluded; the caller draws replacement samples.
 *
 * An informative sample is ALIGNED when its best side is the claimed one (shift 0) and it beats the
 * wrong-folio control by ≥ minMargin. The v1 rule also demanded identity ≥ 0.6 at the claimed side;
 * that floor measured the READER, not the alignment (v4 f. 208b: 0.594 at shift 0 against a 0.149
 * control), so the floor is now the informativeness floor and the margin carries the decision.
 *
 * The volume passes only if it has ≥ minScored informative samples and every one is aligned. Any
 * informative sample whose best side is elsewhere refuses the volume.
 *
 * v3 (2026-10-01): a NEAR-VERBATIM read (≥ verbatimIdentity at the claimed side) is also aligned when
 * it beats every wrong side by ≥ verbatimMargin. Formulaic commentary repeats whole runs from folio
 * to folio, so a wrong side two leaves away can legitimately share most of the page: v84 f. 18b read
 * 0.998 at its side against 0.812 two sides off (a ~75-syllable gap), and the flat 0.25 margin
 * refused a volume whose every informative read picked shift 0.
 *
 * v4 (2026-10-01): a WEAK read — best at shift 0 but not clearing the control — is INCONCLUSIVE, not
 * a refusal: it does not point anywhere else, it just cannot discriminate. It triggers the second
 * sampling round like an uninformative read, and the volume needs ≥ minScored ALIGNED reads and no
 * misaligned one. Measured on v139 f. 115b (Abhidharma prose on the four wheel-turning kings, which
 * repeats with a period of two sides): 0.785 at shift 0, 0.732 at shift +2; by eye all seven line
 * starts are 115b's and not 116b's.
 */
export const ALIGN_RULES = Object.freeze({ version: 4, informativeFloor: 0.4, minMargin: 0.25, verbatimIdentity: 0.9, verbatimMargin: 0.1, minScored: 4, minReadSyllables: 40 });

export function sampleClass(score, rules = ALIGN_RULES) {
  if (!score || score.read_syllables < rules.minReadSyllables) return 'uninformative';
  const g = score.global_best;
  if (score.best_identity < rules.informativeFloor && !(g && g.identity >= rules.informativeFloor)) return 'uninformative';
  if (score.best_identity < rules.informativeFloor && g) return g.shift === 0 ? 'weak' : 'misaligned';
  if (score.measured_shift !== 0) return 'misaligned';
  const margin = score.identity - score.control;
  if (margin >= rules.minMargin) return 'aligned';
  return score.identity >= rules.verbatimIdentity && margin >= rules.verbatimMargin ? 'aligned' : 'weak';
}

export function volumeVerdict(samples, rules = ALIGN_RULES) {
  const cls = samples.map((s) => ({ s, c: sampleClass(s.score, rules) }));
  const aligned = cls.filter((x) => x.c === 'aligned');
  const reasons = [];
  if (aligned.length < rules.minScored) reasons.push(`only ${aligned.length} aligned reads (need ${rules.minScored})`);
  for (const { s, c } of cls) {
    if (c !== 'misaligned') continue;
    const sc = s.score;
    reasons.push(`canvas ${s.canvas} (${s.label}) best matches shift ${sc.global_best && sc.best_identity < rules.informativeFloor ? sc.global_best.shift : sc.measured_shift}`);
  }
  const tag = (x) => `${x.s.canvas} (${x.s.label})`;
  return {
    pass: reasons.length === 0,
    scored: aligned.length,
    uninformative: cls.filter((x) => x.c === 'uninformative').map(tag),
    weak: cls.filter((x) => x.c === 'weak').map(tag),
    reasons,
  };
}

/**
 * Where in the volume does this read belong? Scores the read against every side and returns the
 * best side index, its identity, and the runner-up identity at a side ≥ 2 away (the control).
 * Used where BDRC's manifest carries no folio labels (I1441 = vol. 125 has only "img. N"), so the
 * canvas → side offset must be MEASURED from the reads rather than claimed by a label.
 */
export function locateRead(readText, pages, { blockSpelling = false } = {}) {
  const read = syllables(readText);
  const scores = pages.map((p) => (p.lines.length ? nwIdentity(read, syllables(p.lines.join(' '), { blockSpelling })) : 0));
  let best = 0;
  for (let i = 1; i < scores.length; i++) if (scores[i] > scores[best]) best = i;
  const control = Math.max(0, ...scores.filter((_, i) => Math.abs(i - best) >= 2));
  const r4 = (x) => Math.round(x * 1000) / 1000;
  return { read_syllables: read.length, index: best, side: pages[best]?.label ?? null, identity: r4(scores[best] ?? 0), control: r4(control) };
}

/**
 * The offset (side index − canvas index) a set of located reads agrees on, or null with a reason.
 * Every informative read (identity ≥ informativeFloor, margin over its control ≥ minMargin, or the
 * v3 near-verbatim allowance) must give the SAME offset — a missing or extra image part-way through
 * the volume would split them, and an index mapping across such a break would be wrong after it.
 */
export function agreedOffset(located, rules = ALIGN_RULES) {
  const ok = located.filter(({ loc }) => loc.read_syllables >= rules.minReadSyllables && loc.identity >= rules.informativeFloor
    && (loc.identity - loc.control >= rules.minMargin || (loc.identity >= rules.verbatimIdentity && loc.identity - loc.control >= rules.verbatimMargin)));
  if (ok.length < rules.minScored - 1) return { offset: null, reason: `only ${ok.length} reads located with confidence (need ${rules.minScored - 1})` };
  const offs = [...new Set(ok.map(({ canvas, loc }) => loc.index - canvas))];
  if (offs.length !== 1) return { offset: null, reason: `located reads disagree on the offset: ${offs.join(', ')}` };
  return { offset: offs[0], reason: null, located: ok.length };
}

/**
 * The Tohoku texts each side carries: the one running in from the previous side (or volume —
 * `carryIn`, the last id of the volume before) plus every one that opens on it; a blank side (an
 * unprinted leaf) carries none. A parent id that is
 * immediately refined by its sub-texts on the same side ({D1}{D1-1}) is dropped: 84000 catalogues
 * the sub-texts (toh1-1 …), not the parent.
 * @returns {string[][]} per side
 */
export function textsOnSides(pages, carryIn = null) {
  let cur = carryIn;
  return pages.map((p) => {
    const ids = cur ? [cur] : [];
    for (const t of p.tohoku) { ids.push(t); cur = t; }
    if (!p.lines.join('').trim()) return [];
    const out = [...new Set(ids)];
    return out.filter((id) => !out.some((o) => o.startsWith(`${id}-`)));
  });
}

/**
 * 84000's Reading Room catalogue (read.84000.co/section/lobby.json, a Next.js page): every `works`
 * array in the flight data, parsed as JSON. Returns Map("toh1-1" → { status, pages }).
 */
export function parse84000Works(html) {
  const s = [...String(html).matchAll(/self\.__next_f\.push\(\[1,"((?:[^"\\]|\\.)*)"\]\)/g)].map((m) => JSON.parse(`"${m[1]}"`)).join('');
  const arrayAt = (k) => {
    let d = 0, str = false;
    for (let j = k; j < s.length; j++) {
      const c = s[j];
      if (str) { if (c === '\\') j++; else if (c === '"') str = false; continue; }
      if (c === '"') str = true;
      else if (c === '[' || c === '{') d++;
      else if ((c === ']' || c === '}') && --d === 0) return s.slice(k, j + 1);
    }
    throw new Error('84000: unterminated works array');
  };
  const recs = new Map();
  for (const m of s.matchAll(/"works":\[/g)) {
    for (const w of JSON.parse(arrayAt(m.index + 8))) {
      if (!w?.toh || !w.publication_status) continue;
      const prev = recs.get(w.toh);
      if (prev && prev.status !== w.publication_status) throw new Error(`84000: ${w.toh} listed as ${prev.status} and ${w.publication_status}`);
      recs.set(w.toh, { status: w.publication_status, pages: w.num_pages || 0 });
    }
  }
  return recs;
}

/**
 * 84000 coverage of one side, from the texts on it. The side is `published` only if every text on
 * it is published, `in_progress` if every text is published or in progress, else `not_begun` (a text
 * 84000 lists as Not Begun or Application Pending, or does not list at all). A side with no Tohoku
 * text (a title leaf, the catalogue volume) is `no_text`.
 */
export function english84000(texts, recs) {
  if (!texts.length) return { coverage: 'no_text', texts: {} };
  const st = Object.fromEntries(texts.map((d) => [d, recs.get(`toh${d.slice(1)}`)?.status ?? 'not in catalogue']));
  const v = Object.values(st);
  const coverage = v.every((x) => x === 'Published') ? 'published'
    : v.every((x) => x === 'Published' || x === 'In Progress') ? 'in_progress' : 'not_begun';
  return { coverage, texts: st };
}
