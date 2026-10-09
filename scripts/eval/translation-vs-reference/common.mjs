// PRIOR ART: scripts/eval/tibetan-mt-ab/build-judge-packet.mjs + score.mjs carry these helpers inline (readJsonl,
// sha, the mulberry32 shuffle); scripts/eval/lib/private-refs.mjs guards private reference FILES but not quotes of
// them inside verdicts and galleries. This module is the shared part of translation-vs-reference/ (#5695): the input
// record contract, the ≤ 15-word rule for private references (#5488), and the invention kinds (#5622).
/** Shared pieces of the translation-vs-reference harness: input validation, private-quote clipping, JSONL io. */
import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';
import { createHash } from 'node:crypto';

export const STYLES = ['literal', 'free', 'early-modern'];
// #5622's four kinds of what a judge calls "invention" — only unreadable_fill is fabrication; added_fact is by design
// (prompt v13 asks for notes) and a defect only when the fact is wrong (#5624).
export const INVENTION_KINDS = ['boundary', 'unreadable_fill', 'added_fact', 'gloss'];
export const SPAN = ['same', 'starts_later', 'ends_earlier', 'extends_before', 'extends_after', 'different', 'cant_tell'];
export const REFERENCE_FIT = ['exact', 'wider', 'narrower', 'offset', 'wrong', 'cant_tell'];
export const PRIVATE_QUOTE_WORDS = 15;

export const readJsonl = (f) => fs.readFileSync(f, 'utf8').split('\n').filter((l) => l.trim()).map((l, i) => {
  try { return JSON.parse(l); } catch (e) { throw new Error(`${f}:${i + 1}: ${e.message}`); }
});
export const writeJsonl = (f, rows) => { fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, rows.map((r) => JSON.stringify(r)).join('\n') + (rows.length ? '\n' : '')); };
export const sha16 = (t) => createHash('sha256').update(String(t), 'utf8').digest('hex').slice(0, 16);
export const itemId = (r) => `${r.book_id}_${String(r.page_number).padStart(5, '0')}`;
export const pageUrl = (r) => `https://sourcelibrary.org/book/${r.book_id}?page=${r.page_number}`;
export const words = (t) => String(t || '').trim().split(/\s+/).filter(Boolean);
export const firstWords = (t, n) => { const w = words(t); return w.length <= n ? w.join(' ') : `${w.slice(0, n).join(' ')} …`; };

/** Throws on a record the judge could not use; returns a list of warnings for ones it can. */
export function validateRecord(r, lineNo = '?') {
  const where = `input line ${lineNo} (${r?.book_id}:${r?.page_number})`;
  for (const k of ['track', 'lang', 'book_id', 'page_number', 'source_text', 'reference_text', 'reference_meta', 'candidates']) {
    if (r[k] == null || r[k] === '') throw new Error(`${where}: missing ${k}`);
  }
  const m = r.reference_meta;
  for (const k of ['title', 'translator', 'licence']) if (!m[k]) throw new Error(`${where}: reference_meta.${k} is required (licence is a field, not a footnote — eval-design §4.1)`);
  if (typeof m.private !== 'boolean') throw new Error(`${where}: reference_meta.private must be true or false`);
  if (!STYLES.includes(m.style)) throw new Error(`${where}: reference_meta.style must be one of ${STYLES.join('|')}`);
  if (!Array.isArray(r.candidates) || !r.candidates.length) throw new Error(`${where}: candidates[] is empty`);
  const arms = r.candidates.map((c) => c.arm);
  if (new Set(arms).size !== arms.length) throw new Error(`${where}: duplicate arm names ${arms}`);
  for (const c of r.candidates) if (!c.arm || /[#]/.test(c.arm)) throw new Error(`${where}: arm name "${c.arm}" is empty or contains '#'`);
  const warn = [];
  for (const c of r.candidates) if (!String(c.text || '').trim()) warn.push(`${where}: arm ${c.arm} has empty text (judged as an empty translation)`);
  if (m.private && m.licence !== 'in-copyright') warn.push(`${where}: private reference with licence "${m.licence}" — check`);
  return warn;
}

/** True when `p` resolves inside a git work tree (where a private reference text must never be written). */
export function insideGitTree(p) {
  let dir = path.resolve(p);
  while (!fs.existsSync(dir)) dir = path.dirname(dir);
  try { execSync('git rev-parse --is-inside-work-tree', { cwd: dir, stdio: 'pipe' }); return true; } catch { return false; }
}

const fold = (w) => w.toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/[^\p{L}\p{N}]/gu, '');

/**
 * #5488: a private (in-copyright) reference may be quoted for at most PRIVATE_QUOTE_WORDS words. Finds every run of
 * more than `max` consecutive words of `text` that also occurs, consecutively, in `reference`, and cuts it to `max`
 * words + " […]". Applied to everything that leaves the private packet: verdict reasons, defect quotes, galleries.
 */
export function clipPrivate(text, reference, max = PRIVATE_QUOTE_WORDS) {
  if (!text || !reference) return text;
  const ref = words(reference).map(fold).filter(Boolean);
  const grams = new Set();
  const K = 4;
  for (let i = 0; i + K <= ref.length; i++) grams.add(ref.slice(i, i + K).join(' '));
  const toks = String(text).split(/(\s+)/); // keep whitespace tokens so the text re-joins unchanged
  const wIdx = toks.map((t, i) => (/\S/.test(t) ? i : -1)).filter((i) => i >= 0);
  const fw = wIdx.map((i) => fold(toks[i]));
  // mark words covered by a shared 4-gram, then clip covered runs longer than max
  const covered = new Array(fw.length).fill(false);
  for (let i = 0; i + K <= fw.length; i++) if (grams.has(fw.slice(i, i + K).join(' '))) for (let j = i; j < i + K; j++) covered[j] = true;
  const drop = new Set();
  for (let i = 0; i < fw.length;) {
    if (!covered[i]) { i++; continue; }
    let j = i; while (j < fw.length && covered[j]) j++;
    if (j - i > max) { for (let k = i + max; k < j; k++) drop.add(wIdx[k]); toks[wIdx[i + max - 1]] += ' […]'; }
    i = j;
  }
  if (!drop.size) return text;
  return toks.filter((_, i) => !drop.has(i)).join('').replace(/\s+/g, ' ').trim();
}

/** Deep-clip every string in a verdict-shaped object against a private reference. */
export function clipDeep(obj, reference) {
  if (typeof obj === 'string') return clipPrivate(obj, reference);
  if (Array.isArray(obj)) return obj.map((x) => clipDeep(x, reference));
  if (obj && typeof obj === 'object') return Object.fromEntries(Object.entries(obj).map(([k, v]) => [k, clipDeep(v, reference)]));
  return obj;
}

// ── planted meaning change: one operation on the English, away from the page edges, outside tags ──────────
const PLANT_RULES = [
  { op: 'drop-negation', re: /\b(do|does|did|is|are|was|were|can|could|will|would|should|shall|must|may|has|have|had) not\b/gi, to: (m, aux) => aux },
  { op: 'drop-negation', re: /\bcannot\b/gi, to: () => 'can' },
  { op: 'drop-negation', re: /\b(\w+)n't\b/gi, to: (m, aux) => (/^(wo)$/i.test(aux) ? 'will' : /^(ca)$/i.test(aux) ? 'can' : aux) },
  { op: 'never-always', re: /\bnever\b/gi, to: (m) => (m[0] === 'N' ? 'Always' : 'always') },
  { op: 'add-negation', re: /\b(is|are|was|were|can|will|should|must|shall) (?!not\b)(?=[a-z])/g, to: (m, aux) => `${aux} not ` },
  { op: 'number', re: /\b(two|three|four|five|six|seven|eight|nine|ten)\b/gi, to: (m) => {
    const n = ['two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten']; const i = n.indexOf(m.toLowerCase()); const r = n[(i + 3) % n.length];
    return m[0] === m[0].toUpperCase() ? r[0].toUpperCase() + r.slice(1) : r; } },
  { op: 'number', re: /\b([1-9]\d{0,3})\b/g, to: (m) => String(Number(m) + (Number(m) > 3 ? 3 : 2)) },
];
/** One planted meaning change (negation dropped/added, never→always, a number). `pick` chooses among the usable sites, so the caller owns the seed. Shared by build-packet.mjs (judge gate) and backtrans/ (detector positive control). */
export function plant(text, pick) {
  const tagSpans = [...text.matchAll(/<[^>]*>[^<]*<\/[^>]*>|<[^>]*>/g)].map((m) => [m.index, m.index + m[0].length]);
  const inTag = (i) => tagSpans.some(([a, b]) => i >= a && i < b);
  const lo = text.length * 0.15, hi = text.length * 0.85;
  for (const rule of PLANT_RULES) { // rules in order of how surely they reverse meaning; first rule with a usable site wins
    const sites = [...text.matchAll(rule.re)].filter((m) => m.index >= lo && m.index <= hi && !inTag(m.index));
    if (!sites.length) continue;
    const m = pick(sites);
    const rep = rule.to(...m);
    if (rep === m[0]) continue;
    const after = text.slice(0, m.index) + rep + text.slice(m.index + m[0].length);
    const s = Math.max(0, m.index - 80), e = Math.min(text.length, m.index + m[0].length + 80);
    return { text: after, op: rule.op, from: m[0], to: rep, at: m.index, before_context: text.slice(s, e), after_context: after.slice(s, e - m[0].length + rep.length) };
  }
  return null;
}
