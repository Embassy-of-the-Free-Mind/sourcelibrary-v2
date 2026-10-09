/**
 * PRIOR ART: scripts/eval/spot-check/ (REVIEWER.md, overview-draw.mjs, review-agreement.py — the reader brief, the
 * packet shape and the pairwise agreement this calibrates; reused unchanged) and
 * scripts/eval/translation-corpus-audit/draw-chained.mjs (swap / drop controls, text-only, built inline and not
 * exported — the drop construction is mirrored below for a one-sentence omission). Neither plants an error a reader
 * must find against the IMAGE, matches findings across readers, or weights a page back to its frame, which the
 * second-reader calibration (#6338) needs. Pure functions only; draw.mjs and second-reader.mjs do the I/O.
 *
 * Unit of analysis: one page from one book (the calibration draws one page per book), keyed `${book_id}:${page}`.
 */
import { makeRng } from '../lib/paired-stats.mjs';
import { dominantScript } from '../../lib/page-integrity.mjs';
import { stripMarkupTags } from '../../lib/strip-markup-tags.mjs';

export const keyOf = (bookId, pageNumber) => `${bookId}:${pageNumber}`;
export const SEED_CLASSES = ['negation', 'number', 'invented', 'dropped', 'wrong_leaf'];
export const SEVERITY_RANK = { minor: 1, moderate: 2, serious: 3 };

/** The script the page's own text is written in (tags removed first), or null. */
export function pageScript(ocr) {
  return dominantScript(stripMarkupTags(String(ocr || ''), ' '));
}

// ── 1. Draw: one page per book, an enriched stratum, inclusion probabilities ──────────────────────────────

/**
 * Draw `n` books from a frame, `enrichShare` of them from books carrying a detector-flagged page, and one page per
 * book. Every eligible page keeps a non-zero chance of selection, so a Hájek-weighted mean over the sample estimates
 * the frame quantity "pick a book uniformly, then a page uniformly" without bias.
 *
 * frame: [{ book_id, pages: [page_number…] (eligible), flagged: [page_number…] (subset) }]
 * Within a flagged book the page is a flagged one with probability `lambda`, else uniform over all eligible pages.
 * Returns { picks: [{ book_id, page_number, stratum, pi_book, q_page, weight, order }], strata }.
 * weight = 1 / (m_b · π_b · q_bj): the Hájek weight for a book-uniform, page-uniform estimand.
 */
export function drawEnriched({ frame, n, enrichShare = 1 / 3, lambda = 0.8, seed }) {
  const rng = makeRng(seed);
  const shuffle = (a) => { a = [...a].sort((x, y) => (x.book_id < y.book_id ? -1 : 1)); for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
  const usable = frame.filter((b) => b.pages?.length);
  const F = usable.filter((b) => b.flagged?.length), U = usable.filter((b) => !b.flagged?.length);
  let nF = Math.min(F.length, Math.round(n * enrichShare)), nU = Math.min(U.length, n - nF);
  if (nU < n - nF) nF = Math.min(F.length, n - nU);  // too few unflagged books: fill from the flagged stratum
  const picks = [];
  const take = (books, k, stratum) => {
    const pi = k / books.length;
    for (const b of shuffle(books).slice(0, k)) {
      const { page, q } = pickPage(b, stratum, lambda, rng);
      picks.push({ book_id: b.book_id, page_number: page, stratum, pi_book: pi, q_page: q, weight: 1 / (b.pages.length * pi * q), m_pages: b.pages.length });
    }
  };
  take(F, nF, 'flagged');
  take(U, nU, 'unflagged');
  // Reading order is random, so block 1 (the first half) is itself a random half of both strata.
  const ordered = shuffle(picks).map((p, i) => ({ ...p, order: i + 1 }));
  return { picks: ordered, strata: { flagged: { frame: F.length, drawn: nF }, unflagged: { frame: U.length, drawn: nU } } };
}

/**
 * One page of a drawn book, and its selection probability q. In the flagged stratum the page is a flagged page with
 * probability `lambda`, otherwise uniform over every eligible page, so no eligible page has q = 0.
 */
export function pickPage(b, stratum, lambda, rng) {
  const m = b.pages.length, flagged = new Set(stratum === 'flagged' ? (b.flagged || []).filter((p) => b.pages.includes(p)) : []);
  let page;
  if (flagged.size && rng() < lambda) { const f = [...flagged].sort((x, y) => x - y); page = f[Math.floor(rng() * f.length)]; }
  else page = b.pages[Math.floor(rng() * m)];
  const q = flagged.size ? lambda * (flagged.has(page) ? 1 / flagged.size : 0) + (1 - lambda) / m : 1 / m;
  return { page, q };
}

/** block 1 = the first half of the reading order (model choice), block 2 = the rest (reporting). */
export const blockOf = (order, n) => (order <= Math.ceil(n / 2) ? 1 : 2);

// ── 2. Planted errors (model-free, logged in a key the readers never see) ─────────────────────────────────

const SENT_RE = /(?<=[.!?;])\s+(?=\S)/;
/** Sentence units of a translation; falls back to lines when there are fewer than 4 sentences. */
export function splitUnits(s) {
  let u = String(s).split(SENT_RE).filter((x) => x.trim());
  if (u.length < 4) u = String(s).split(/\n+/).filter((x) => x.trim());
  return u;
}

/** [start, end) of each unit IN THE ORIGINAL TEXT, trailing whitespace included, so a splice keeps the layout.
 *  Sentences; lines when there are fewer than 4 sentences (as splitUnits). */
export function unitSpans(s) {
  const t = String(s), cut = (re) => {
    const starts = [0];
    for (const m of t.matchAll(re)) if (m.index + m[0].length < t.length) starts.push(m.index + m[0].length);
    return starts.map((a, i) => [a, i + 1 < starts.length ? starts[i + 1] : t.length]).filter(([a, b]) => t.slice(a, b).trim());
  };
  const sent = cut(/(?<=[.!?;])\s+(?=\S)/g);
  return sent.length >= 4 ? sent : cut(/\n+/g);
}

const NEGATIONS = [
  [/\bcannot\b/, 'can'], [/\bcan't\b/, 'can'], [/\bwon't\b/, 'will'], [/\b(do|does|did|is|are|was|were|has|have|had|could|should|would|must)n't\b/, '$1'],
  [/\bnever\b/, 'always'], [/\b[Nn]ot\s+/, ''], [/\bnor\b/, 'and'],
];
const NUMBER_WORDS = { two: 'twenty', three: 'thirty', four: 'forty', five: 'fifty', six: 'sixty', seven: 'seventy', eight: 'eighty', nine: 'ninety', hundred: 'thousand', thousand: 'hundred' };

const occurrences = (text, re) => { const g = new RegExp(re.source, re.flags.includes('g') ? re.flags : re.flags + 'g'); const out = []; let m; while ((m = g.exec(text))) { out.push({ i: m.index, s: m[0], groups: m.slice(1) }); if (!m[0].length) g.lastIndex++; } return out; };

/** Each planter returns { translation?, ocr?, span: [start, end] in the NEW translation | null, before, after } or null if the page is ineligible. */
export const PLANTERS = {
  negation(page, rng) {
    const t = page.translation;
    const cands = NEGATIONS.flatMap(([re, rep]) => occurrences(t, re).map((o) => ({ ...o, rep }))).filter((o) => !/[<>]/.test(t.slice(Math.max(0, o.i - 1), o.i + o.s.length + 1)));
    if (!cands.length) return null;
    const c = cands[Math.floor(rng() * cands.length)];
    const replacement = c.rep.replace('$1', c.groups[0] ?? '');
    const out = t.slice(0, c.i) + replacement + t.slice(c.i + c.s.length);
    return { translation: out, span: sentenceAround(out, c.i, replacement.length), before: c.s, after: replacement };
  },
  number(page, rng) {
    const t = page.translation;
    // Not a number inside markup (`<page-num>12</page-num>`): changing it is not a meaning error.
    const digits = occurrences(t, /(?<![\w.,>])\d{1,4}(?!\w|[.,]\d|<)/).map((o) => ({ ...o, rep: o.s + '0' }));
    const words = occurrences(t, /\b(two|three|four|five|six|seven|eight|nine|hundred|thousand)\b/i).map((o) => {
      const w = NUMBER_WORDS[o.s.toLowerCase()]; return { ...o, rep: o.s[0] === o.s[0].toUpperCase() ? w[0].toUpperCase() + w.slice(1) : w };
    });
    const cands = (digits.length ? digits : words);
    if (!cands.length) return null;
    const c = cands[Math.floor(rng() * cands.length)];
    const out = t.slice(0, c.i) + c.rep + t.slice(c.i + c.s.length);
    return { translation: out, span: sentenceAround(out, c.i, c.rep.length), before: c.s, after: c.rep };
  },
  invented(page, rng, donor) {
    if (!donor) return null;
    // A sentence the page already holds is not invented (formulaic texts repeat lines across books).
    const here = norm(page.translation);
    const pool = String(donor.translation).split(SENT_RE).map((s) => s.trim()).filter((s) => s.length >= 40 && s.length <= 220 && !/[<>\n]/.test(s) && !here.includes(norm(s)));
    const t = page.translation, spans = unitSpans(t);
    if (!pool.length || spans.length < 3) return null;
    const ins = pool[Math.floor(rng() * pool.length)];
    // Spliced in at the start of a unit (never the first), so the page keeps its own line breaks and markup: a
    // planted page must not look different from the others.
    const pos = spans[1 + Math.floor(rng() * (spans.length - 1))][0];
    const out = t.slice(0, pos) + ins + ' ' + t.slice(pos);
    return { translation: out, span: [pos, pos + ins.length], before: '', after: ins, donor_key: donor.key };
  },
  dropped(page, rng) {
    const t = page.translation, spans = unitSpans(t);
    if (spans.length < 4) return null;
    const mids = spans.map(([s, e], i) => ({ s, e, i })).filter(({ s, e, i }) => i > 0 && i < spans.length - 1 && t.slice(s, e).trim().length >= 30 && !/[<>]/.test(t.slice(s, e)));
    if (!mids.length) return null;
    const { s, e } = mids[Math.floor(rng() * mids.length)];
    // Keep the larger of the two line/paragraph breaks around the cut, so the drop never joins two paragraphs.
    const prevWs = t.slice(0, s).match(/\s*$/)[0], cutWs = t.slice(s, e).match(/\s*$/)[0];
    const ws = (cutWs.match(/\n/g) || []).length > (prevWs.match(/\n/g) || []).length ? cutWs : prevWs;
    return { translation: t.slice(0, s - prevWs.length) + ws + t.slice(e), span: null, before: t.slice(s, e).trim(), after: '' };
  },
  wrong_leaf(page, rng, donor) {
    if (!donor || donor.book_id === page.book_id) return null;
    return { ocr: donor.ocr, translation: donor.translation, span: null, before: '', after: '', donor_key: donor.key };
  },
};

function sentenceAround(text, i, len) {
  let s = i, e = i + len;
  while (s > 0 && !/[.!?;\n]/.test(text[s - 1])) s--;
  while (e < text.length && !/[.!?;\n]/.test(text[e])) e++;
  return [s, Math.min(text.length, e + 1)];
}

/**
 * Plant errors in `share` of the pages, classes balanced in rotation; a page that cannot take its class tries the
 * next one. Donors (for invented / wrong_leaf) are other pages of the SAME script from a DIFFERENT book.
 * pages: [{ key, book_id, script, ocr, translation }]. Returns { pages (new objects), key: [{ key, class, … }] }.
 */
export function plantErrors(pages, { share = 0.28, seed, classes = SEED_CLASSES }) {
  const rng = makeRng(seed);
  const order = [...pages].sort((a, b) => (a.key < b.key ? -1 : 1));
  for (let i = order.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [order[i], order[j]] = [order[j], order[i]]; }
  const target = Math.round(pages.length * share);
  const out = new Map(pages.map((p) => [p.key, { ...p }]));
  const key = [];
  let rot = 0;
  for (const p of order) {
    if (key.length >= target) break;
    for (let t = 0; t < classes.length; t++) {
      const cls = classes[(rot + t) % classes.length];
      const donors = pages.filter((d) => d.key !== p.key && d.book_id !== p.book_id && d.script === p.script);
      const donor = donors.length ? donors[Math.floor(rng() * donors.length)] : null;
      const r = PLANTERS[cls](p, rng, donor);
      if (!r) continue;
      const np = out.get(p.key);
      if (r.translation != null) np.translation = r.translation;
      if (r.ocr != null) np.ocr = r.ocr;
      key.push({ key: p.key, class: cls, span: r.span, before: r.before, after: r.after, donor_key: r.donor_key ?? null });
      rot = (rot + t + 1) % classes.length;
      break;
    }
  }
  return { pages: pages.map((p) => out.get(p.key)), key };
}

// ── 3. Packets: what the reader sees ───────────────────────────────────────────────────────────────────────

/** Fields a reader must not see: which model made the text (family leniency is a hypothesis under test), and any
 *  URL (a reader that fetched the live page would read the unplanted text). */
const HIDDEN_PAGE = ['ocr_engine', 'ocr_model', 'translation_model', 'translation_source', 'image_url', 'page_id'];
export function redactRecord(rec) {
  const { book_url, ...r } = rec;
  const book = { ...(r.book || {}) };
  delete book.image_source;
  return { ...r, book, pages: r.pages.map((p) => Object.fromEntries(Object.entries(p).filter(([k]) => !HIDDEN_PAGE.includes(k)))) };
}

// ── 4. Reader outputs: validate, then flatten to issues ────────────────────────────────────────────────────

const norm = (s) => String(s ?? '').normalize('NFC').replace(/\s+/g, ' ').trim();
/** Locate a quote in a text, tolerating whitespace differences and "…"/"..." elisions. Returns [start, end] in the
 *  whitespace-normalised text, or null when no fragment of ≥ 6 characters is found. */
export function locate(quote, text) {
  const T = norm(text), frags = norm(quote).split(/\s*(?:…|\.\.\.)\s*/).map((f) => f.replace(/^["'“”‘’«»]+|["'“”‘’«»]+$/g, '')).filter((f) => [...f].length >= 6);
  let s = Infinity, e = -1;
  for (const f of frags) { const i = T.indexOf(f); if (i >= 0) { s = Math.min(s, i); e = Math.max(e, i + f.length); } }
  return e >= 0 ? [s, e] : null;
}
/** The planted span expressed in whitespace-normalised coordinates (what `locate` returns). */
export function normSpan(text, span) {
  if (!span) return null;
  const pre = norm(text.slice(0, span[0])), mid = norm(text.slice(span[0], span[1]));
  const s = pre.length + (pre.length && mid.length ? 1 : 0);
  return [s, s + mid.length];
}

/**
 * Check one reader's output against its packet. Returns { pages: Map(key → page entry), missing: [key],
 * extra: [key], errors: [string], fabricated: [{ key, field, quote }] }. A quote that is not in the text it claims to
 * quote is FABRICATED: it is kept as an issue (it counts against the reader as a false alarm) but can never match.
 */
export function validateOutput(output, packetRecords) {
  const errors = [], pages = new Map(), fabricated = [], extra = [], unread = [];
  const want = new Map(packetRecords.flatMap((r) => r.pages.map((p) => [keyOf(r.book_id, p.page_number), p])));
  if (!Array.isArray(output)) return { pages, missing: [...want.keys()], extra, errors: ['output is not a JSON array'], fabricated, unread };
  for (const b of output) {
    for (const p of b?.pages || []) {
      const k = keyOf(b.book_id, p.page_number);
      if (!want.has(k)) { extra.push(k); continue; }
      if (pages.has(k)) { errors.push(`${k}: entered twice (kept the first)`); continue; }
      // A reader that did not see the image says so this way (Gemini 3.1 Pro on 3 of 16 pilot pages, #6338): the page
      // was not read, so it counts as MISSING (not found), never as a clean read.
      if (p.right_page === 'unsure' && (p.ocr_score == null || p.tr_score == null)) { unread.push(k); continue; }
      const src = want.get(k);
      for (const [field, list, quoteField, text] of [['ocr_errors', p.ocr_errors, 'ocr', src.ocr], ['tr_errors', p.tr_errors, 'english', src.translation]]) {
        if (list != null && !Array.isArray(list)) { errors.push(`${k}: ${field} is not an array`); continue; }
        for (const e of list || []) {
          if (!SEVERITY_RANK[e.severity]) errors.push(`${k}: ${field} entry without a valid severity`);
          const q = e[quoteField];
          if (q && [...norm(q)].length >= 6 && !locate(q, text)) { e._fabricated = true; fabricated.push({ key: k, field, quote: q }); }
        }
      }
      if (!['yes', 'no', 'unsure'].includes(p.right_page)) errors.push(`${k}: right_page missing or invalid`);
      pages.set(k, p);
    }
  }
  return { pages, missing: [...want.keys()].filter((k) => !pages.has(k)), extra, errors, fabricated, unread };
}

/** The one JSON object (or array) a plan-mode CLI reply holds: fenced or bare, with or without prose around it. */
export function recoverJson(text) {
  const t = String(text ?? '').trim();
  const fenced = t.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
  for (const cand of [fenced?.[1], t, t.slice(t.indexOf('{'), t.lastIndexOf('}') + 1), t.slice(t.indexOf('['), t.lastIndexOf(']') + 1)]) {
    if (!cand) continue;
    try { return JSON.parse(cand); } catch { /* try the next */ }
  }
  return null;
}

/** Flatten a validated reader's pages into issues: { reader, key, kind: 'ocr'|'tr'|'other'|'leaf', severity, cls,
 *  quote, iv (interval in the normalised text it quotes, or null), fabricated }. */
export function extractIssues(reader, validated, textsByKey) {
  const out = [];
  for (const [key, p] of validated.pages) {
    const t = textsByKey.get(key) || { ocr: '', translation: '' };
    if (p.right_page === 'no') out.push({ reader, key, kind: 'leaf', severity: 'serious', cls: 'I1', quote: null, iv: null, fabricated: false });
    for (const e of p.ocr_errors || []) out.push(issue(reader, key, 'ocr', e, e.ocr, t.ocr));
    for (const e of p.tr_errors || []) out.push(issue(reader, key, 'tr', e, e.english, t.translation));
    for (const e of p.other || []) out.push({ reader, key, kind: 'other', severity: e.severity, cls: normCls(e.class), quote: e.note ?? null, iv: null, fabricated: false });
  }
  return out;
}
const normCls = (c) => { const m = String(c ?? '').toUpperCase().match(/^([IOTDE]\d{1,2})\b/); return m ? m[1] : (c ? String(c).toLowerCase() : null); };
function issue(reader, key, kind, e, quote, text) {
  const fabricated = !!e._fabricated;
  const iv = fabricated || !quote ? null : locate(quote, text);
  return { reader, key, kind, severity: e.severity, cls: normCls(e.class), quote: quote ?? null, iv, units: iv ? unitsOf(iv, text) : null, fabricated, problem: e.problem ?? null };
}

export const UNIT_MAX = 200, UNIT_WINDOW = 120;
/**
 * Matching units of a text, in whitespace-normalised coordinates: its sentences, except that a sentence longer than
 * UNIT_MAX characters (unpunctuated OCR, a CJK page without 。) is cut into UNIT_WINDOW-character windows, so a
 * whole unpunctuated page never becomes one unit.
 */
export function textUnits(text) {
  const T = norm(text), out = [];
  let s = 0;
  const push = (a, b) => { if (b - a <= UNIT_MAX) out.push([a, b]); else for (let x = a; x < b; x += UNIT_WINDOW) out.push([x, Math.min(b, x + UNIT_WINDOW)]); };
  for (const m of T.matchAll(/[.!?;。！？；](?=\s|$)/g)) { push(s, m.index + 1); s = m.index + 1; }
  if (s < T.length) push(s, T.length);
  return out;
}
/** Indexes of the units an interval touches. */
export function unitsOf(iv, text) {
  return textUnits(text).flatMap(([a, b], i) => (iv[0] < b && a < iv[1] ? [i] : []));
}

// ── 5. Matching (preregistered rule) and clustering across readers ─────────────────────────────────────────

/**
 * The preregistered rule. Two issues from DIFFERENT readers on the same page are the same issue when:
 *   (a) both say the image is the wrong leaf; or
 *   (b) both quote the same lane (transcription or translation) and their located quotes overlap, or touch the same
 *       sentence (a long unpunctuated sentence counts as 120-character windows — `textUnits`); or
 *   (c) at least one quote cannot be located (or the lane is `other`) and both name the same class in the same lane.
 * A fabricated quote never matches. Quotes in NEIGHBOURING sentences do not match: two errors a sentence apart are
 * two errors (a fixed character gap merged them, found by the synthetic test).
 */
export function sameIssue(a, b) {
  if (a.reader === b.reader || a.key !== b.key || a.fabricated || b.fabricated) return false;
  if (a.kind === 'leaf' || b.kind === 'leaf') return a.kind === b.kind;
  if (a.kind !== b.kind) return false;
  if (a.iv && b.iv) return (a.iv[0] < b.iv[1] && b.iv[0] < a.iv[1]) || (a.units || []).some((u) => (b.units || []).includes(u));
  return !!a.cls && a.cls === b.cls;
}

/** Union-find over all readers' issues. Each cluster: { id, key, kind, members, by: { reader: maxSeverity } }. */
export function clusterIssues(issues) {
  const parent = issues.map((_, i) => i);
  const find = (i) => (parent[i] === i ? i : (parent[i] = find(parent[i])));
  const byKey = new Map();
  issues.forEach((x, i) => { if (!byKey.has(x.key)) byKey.set(x.key, []); byKey.get(x.key).push(i); });
  for (const idx of byKey.values()) for (let i = 0; i < idx.length; i++) for (let j = i + 1; j < idx.length; j++) if (sameIssue(issues[idx[i]], issues[idx[j]])) parent[find(idx[i])] = find(idx[j]);
  const groups = new Map();
  issues.forEach((x, i) => { const r = find(i); if (!groups.has(r)) groups.set(r, []); groups.get(r).push(x); });
  return [...groups.values()].map((members) => {
    const by = {};
    for (const m of members) if (!by[m.reader] || SEVERITY_RANK[m.severity] > SEVERITY_RANK[by[m.reader]]) by[m.reader] = m.severity;
    const rep = [...members].sort((a, b) => (SEVERITY_RANK[b.severity] - SEVERITY_RANK[a.severity]) || (String(b.quote ?? '').length - String(a.quote ?? '').length))[0];
    return { key: rep.key, kind: rep.kind, cls: rep.cls, quote: rep.quote, iv: rep.iv, members, by };
  }).sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0)).map((c, i) => ({ id: `c${String(i + 1).padStart(4, '0')}`, ...c }));
}

// ── 6. Seeded recall ───────────────────────────────────────────────────────────────────────────────────────

export const OMISSION_RE = /omit|omission|missing|dropp|left out|not translated|untranslated|skipp|absent from the (english|translation)/i;
export const OMISSION_CLASSES = new Set(['T1', 'T9', 'O5']);
/**
 * Did this reader catch this planted error? Returns { detected, serious } (serious = detected AND called serious).
 * negation / number / invented: an issue in the translation (or `other`) whose located quote overlaps the planted span.
 * dropped: a translation issue that names an omission (class T1/T9/O5 or the OMISSION_RE wording) — page-level, so
 *   its background rate on unplanted pages is reported beside it. wrong_leaf: right_page "no" or ocr_score 1.
 * A page the reader did not return counts as NOT detected.
 */
export function caughtSeed(seed, readerIssues, readerPage, plantedText) {
  if (!readerPage) return { detected: false, serious: false, missing: true };
  const mine = readerIssues.filter((x) => x.key === seed.key);
  let hits = [];
  if (seed.class === 'wrong_leaf') {
    const d = readerPage.right_page === 'no' || readerPage.ocr_score === 1;
    return { detected: d, serious: d, missing: false };
  } else if (seed.class === 'dropped') {
    hits = mine.filter((x) => x.kind === 'tr' && (OMISSION_CLASSES.has(x.cls) || OMISSION_RE.test(`${x.problem ?? ''}`)));
  } else {
    const sp = normSpan(plantedText, seed.span);
    hits = mine.filter((x) => (x.kind === 'tr' || x.kind === 'other') && x.iv && sp && x.iv[0] <= sp[1] && sp[0] <= x.iv[1]);
  }
  return { detected: hits.length > 0, serious: hits.some((h) => h.severity === 'serious'), missing: false };
}

// ── 7. Agreement: Krippendorff's alpha with missing values ─────────────────────────────────────────────────

/**
 * Krippendorff's alpha. units: array of arrays of values (one per reader; null/undefined = missing).
 * level: 'nominal' | 'ordinal' | 'interval'. Units with fewer than two values are not pairable and are dropped.
 */
export function krippendorffAlpha(units, level = 'nominal') {
  const vals = units.map((u) => u.filter((v) => v !== null && v !== undefined)).filter((u) => u.length >= 2);
  if (!vals.length) return null;
  const cats = [...new Set(vals.flat())].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  const ix = new Map(cats.map((c, i) => [c, i]));
  const K = cats.length, o = Array.from({ length: K }, () => new Array(K).fill(0));
  for (const u of vals) {
    const m = u.length;
    for (let i = 0; i < m; i++) for (let j = 0; j < m; j++) if (i !== j) o[ix.get(u[i])][ix.get(u[j])] += 1 / (m - 1);
  }
  const nc = o.map((row) => row.reduce((s, x) => s + x, 0)), n = nc.reduce((s, x) => s + x, 0);
  const d2 = (c, k) => {
    if (level === 'nominal') return c === k ? 0 : 1;
    if (level === 'interval') return (cats[c] - cats[k]) ** 2;
    const [lo, hi] = c < k ? [c, k] : [k, c];
    let s = 0; for (let g = lo; g <= hi; g++) s += nc[g];
    return (s - (nc[c] + nc[k]) / 2) ** 2;
  };
  let Do = 0, De = 0;
  for (let c = 0; c < K; c++) for (let k = 0; k < K; k++) { const d = d2(c, k); Do += o[c][k] * d; De += nc[c] * nc[k] * d; }
  Do /= n; De /= n * (n - 1);
  return De === 0 ? null : 1 - Do / De;
}

// ── 8. Weighted rates and differences, bootstrap by unit (= book) ──────────────────────────────────────────

/** Hájek-weighted mean of per-unit values, with a percentile bootstrap over units. Returns { est, ci95, ci99, n }. */
export function weightedMeanCI(values, weights, { iters = 4000, seed = 6338 } = {}) {
  const n = values.length;
  if (!n) return { est: null, ci95: null, ci99: null, n };
  const wm = (idx) => { let sw = 0, sv = 0; for (const i of idx) { sw += weights[i]; sv += weights[i] * values[i]; } return sw ? sv / sw : 0; };
  const rng = makeRng(seed), boots = [];
  for (let b = 0; b < iters; b++) { const idx = new Array(n); for (let i = 0; i < n; i++) idx[i] = Math.floor(rng() * n); boots.push(wm(idx)); }
  boots.sort((a, b) => a - b);
  const q = (p) => boots[Math.min(iters - 1, Math.max(0, Math.floor(p * iters)))];
  return { est: wm([...Array(n).keys()]), ci95: [q(0.025), q(0.975)], ci99: [q(0.005), q(0.995)], n };
}

/** One-sided exact sign test: P(X ≥ b) for X ~ Binomial(b + c, 1/2). 1 when there are no discordant pairs. */
export function signTestOneSided(b, c) {
  const n = b + c;
  if (!n) return 1;
  const logC = (nn, kk) => { let s = 0; for (let i = 0; i < kk; i++) s += Math.log(nn - i) - Math.log(i + 1); return s; };
  let p = 0;
  for (let i = b; i <= n; i++) p += Math.exp(logC(n, i) - n * Math.LN2);
  return Math.min(1, p);
}

/** Wilson 95% interval for k of n. */
export function wilson(k, n, z = 1.959964) {
  if (!n) return null;
  const p = k / n, d = 1 + z * z / n, c = (p + z * z / (2 * n)) / d, h = (z * Math.sqrt(p * (1 - p) / n + z * z / (4 * n * n))) / d;
  return [Math.max(0, c - h), Math.min(1, c + h)];
}

/** Confirmed-serious clusters on one page found (at any severity) by at least one reader of `set`. */
export const yieldOn = (clusters, verdicts, set) => clusters.filter((c) => verdicts.get(c.id)?.confirmedSerious && set.some((r) => c.by[r])).length;

// ── 9. Collecting reader output ────────────────────────────────────────────────────────────────────────────

/** The last top-level JSON array in a text (a reader's reply when its write was refused), or null. Reads the final
 *  `result` line of a claude stream-json transcript first. */
export function recoverArray(text) {
  let t = String(text);
  for (const line of t.split('\n').reverse()) { try { const o = JSON.parse(line); if (o && o.type === 'result' && typeof o.result === 'string') { t = o.result; break; } } catch { /* not a JSON line */ } }
  const fenced = [...t.matchAll(/```(?:json)?\s*(\[[\s\S]*?\])\s*```/g)].map((m) => m[1]);
  for (const cand of [...fenced.reverse(), t.slice(t.indexOf('['), t.lastIndexOf(']') + 1)]) { try { const a = JSON.parse(cand); if (Array.isArray(a) && a.length) return a; } catch { /* try the next */ } }
  return null;
}

/**
 * What a claude stream-json transcript touched outside its sealed folder (the session's cwd). `outside` holds READS
 * (any tool but Write/Edit) — the blinding question. `outside_writes` holds writes, kept apart because a headless
 * reader writes its own helper scripts to the CLI's scratchpad, which is not a leak (seen on the first real run).
 * A log with no tool calls is reported as not audited, never as clean.
 */
export function auditTranscript(text) {
  const res = { audited: false, outside: [], outside_writes: [] };
  let sealed = null;
  for (const line of String(text).split('\n')) {
    let o; try { o = JSON.parse(line); } catch { continue; }
    if (o.type === 'system' && o.cwd) sealed = o.cwd;
    for (const c of o.message?.content || []) {
      if (c.type !== 'tool_use') continue;
      res.audited = true;
      const p = c.input?.file_path ?? c.input?.path ?? null;
      const paths = p ? [p] : String(c.input?.command ?? '').match(/(?:^|\s)(\/[^\s'"]+)/g)?.map((s) => s.trim()) ?? [];
      const into = ['Write', 'Edit', 'MultiEdit', 'NotebookEdit'].includes(c.name) ? res.outside_writes : res.outside;
      for (const q of paths) if (q.includes('..') || (sealed && q.startsWith('/') && !q.startsWith(sealed))) into.push(q);
    }
  }
  return res;
}
