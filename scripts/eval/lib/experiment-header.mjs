/**
 * The machine-readable header on every experiment write-up (#5939).
 *
 * PRIOR ART: scripts/eval/build-experiments.mjs — concatenates the write-ups into
 * EXPERIMENTS.md and checks only the heading; it reads nothing inside an entry.
 * scripts/eval/decision-cards-audit.mjs — judges a decision against a card from
 * stored result files, not from the write-up. Neither gives a reader (the /quality
 * page, the canon pages, the next session) the status or verdict of a file. The
 * YAML parsers in node_modules (js-yaml, yaml) are transitive, not declared, so
 * this reads the small flat subset the schema needs and depends on nothing.
 *
 * A header is YAML front matter, the first thing in the file:
 *
 *   ---
 *   stage: translation
 *   measure: judged_vs_reference
 *   languages: [sa, pi, lzh]
 *   scripts: [Deva, Hani]
 *   canons: [sanskrit, pali, chinese-buddhist]
 *   n_books: 68
 *   n_pages: 68
 *   verdict: "Flash reverses fewer statements than Flash-Lite in all three languages."
 *   status: adopted
 *   decision: "Flash routes Sanskrit, Pali and Chinese translation (#5740)"
 *   superseded_by: null
 *   issue: [5695, 5740]
 *   ---
 *
 * The full field list and the rules are in scripts/eval/experiments/README.md.
 * Values are a flat subset of YAML: a scalar (a "double-quoted" JSON string, a
 * 'single-quoted' string, a plain word, an integer, null) or a flow list of them.
 * serializeHeader() writes every string double-quoted, so js-yaml reads what this
 * writes identically.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));

export const STAGES = ['ocr', 'translation', 'metadata', 'image', 'pipeline'];
// eval-design.md §2 (accuracy | agreement | stability, plus the judged kinds of §5.2).
// `none` is for an entry that measured nothing: a plan, a census, a repair log.
export const MEASURES = ['accuracy', 'agreement', 'stability', 'preference', 'judged', 'judged_vs_reference', 'none'];
export const STATUSES = ['adopted', 'rejected', 'undecided', 'superseded', 'informational'];
export const FIELDS = ['stage', 'measure', 'languages', 'scripts', 'canons', 'n_books', 'n_pages', 'verdict', 'status', 'decision', 'superseded_by', 'issue', 'router_evidence'];
const REQUIRED = ['stage', 'measure', 'verdict', 'status'];
const LISTS = ['languages', 'scripts', 'canons'];

/** Canon ids: the canon-gap corpus rows and their traditions. */
export function canonIds() {
  const dir = path.join(HERE, '..', '..', 'catalog-coverage', 'results');
  const files = fs.existsSync(dir) ? fs.readdirSync(dir).filter((n) => /^canon-gap-status-.*\.json$/.test(n)).sort() : [];
  if (!files.length) return null;
  const j = JSON.parse(fs.readFileSync(path.join(dir, files[files.length - 1]), 'utf8'));
  return new Set([...(j.corpora || []).map((c) => c.id), ...(j.traditions || []).map((t) => t.id)]);
}

/** The router table's cell ids (scripts/eval/estimator/router-table/rules.json), or null when the file is absent. */
export function routerCellIds() {
  const f = path.join(HERE, '..', 'estimator', 'router-table', 'rules.json');
  if (!fs.existsSync(f)) return null;
  return new Set((JSON.parse(fs.readFileSync(f, 'utf8')).cells || []).map((c) => c.id));
}

/**
 * A judged OCR or translation result is evidence the router must see (#7263): before 2026-10-28 hundreds of judged
 * tests lived only in write-ups, and the router table decided from four test sets. A NEW entry like that names the
 * router-table cells it added evidence to, or says why it added none.
 */
export function needsRouterEvidence(h) {
  return ['ocr', 'translation'].includes(h.stage) && asList(h.measure).some((m) => m === 'judged' || m === 'judged_vs_reference');
}

/** Split a file into { header (raw text or null), body }. The body is everything after the closing `---`. */
export function splitHeader(text) {
  if (!text.startsWith('---\n')) return { header: null, body: text };
  const end = text.indexOf('\n---\n', 3);
  if (end < 0) return { header: null, body: text, unterminated: true };
  return { header: text.slice(4, end + 1), body: text.slice(end + 5) };
}

function parseScalar(raw, where) {
  const s = raw.trim();
  if (s === '' || s === 'null' || s === '~') return null;
  if (s.startsWith('"')) {
    try { return JSON.parse(s); } catch { throw new Error(`${where}: bad double-quoted string`); }
  }
  if (s.startsWith("'")) {
    if (!s.endsWith("'") || s.length < 2) throw new Error(`${where}: unterminated single-quoted string`);
    return s.slice(1, -1).replace(/''/g, "'");
  }
  if (/^-?\d+$/.test(s)) return Number(s);
  if (/: |\s#/.test(s) || /^[[\]{}>|*&!%@`]/.test(s)) throw new Error(`${where}: quote this value ("…")`);
  return s;
}

function splitFlow(inner, where) {
  const out = [];
  let cur = '', q = null;
  for (let i = 0; i < inner.length; i++) {
    const c = inner[i];
    if (q) {
      cur += c;
      if (c === '\\' && q === '"') { cur += inner[++i] ?? ''; continue; }
      if (c === q) q = null;
    } else if (c === '"' || c === "'") { q = c; cur += c; }
    else if (c === ',') { out.push(cur); cur = ''; }
    else cur += c;
  }
  if (q) throw new Error(`${where}: unterminated string in list`);
  if (cur.trim() !== '' || out.length) out.push(cur);
  return out.map((x) => parseScalar(x, where));
}

/** Parse the raw header text into an object. Throws on a line it cannot read. */
export function parseHeader(raw) {
  const obj = {};
  raw.split('\n').forEach((line, i) => {
    if (!line.trim() || /^\s*#/.test(line)) return;
    const m = line.match(/^([a-z_]+):(?:\s+(.*))?$/);
    const where = `header line ${i + 1}`;
    if (!m) throw new Error(`${where}: expected "key: value", got: ${line.slice(0, 60)}`);
    const [, key, rawVal = ''] = m;
    if (key in obj) throw new Error(`${where}: duplicate key ${key}`);
    const v = rawVal.trim();
    if (v.startsWith('[')) {
      if (!v.endsWith(']')) throw new Error(`${where}: a list must be one line, [a, b]`);
      obj[key] = splitFlow(v.slice(1, -1), where);
    } else obj[key] = parseScalar(v, where);
  });
  return obj;
}

const asList = (v) => (v == null ? [] : Array.isArray(v) ? v : [v]);

/**
 * Validate a parsed header. `ctx` = { name, exists(name) → bool, canons: Set|null }.
 * Returns a list of problems (empty = valid).
 */
export function validateHeader(h, ctx = {}) {
  const p = [];
  for (const k of Object.keys(h)) if (!FIELDS.includes(k)) p.push(`unknown field '${k}'`);
  for (const k of REQUIRED) if (h[k] == null || h[k] === '') p.push(`'${k}' is required`);
  if (h.stage != null && !STAGES.includes(h.stage)) p.push(`stage '${h.stage}' is not one of ${STAGES.join(' | ')}`);
  for (const m of asList(h.measure)) if (!MEASURES.includes(m)) p.push(`measure '${m}' is not one of ${MEASURES.join(' | ')}`);
  if (h.status != null && !STATUSES.includes(h.status)) p.push(`status '${h.status}' is not one of ${STATUSES.join(' | ')}`);
  for (const k of LISTS) if (h[k] != null && !Array.isArray(h[k])) p.push(`'${k}' must be a list, [a, b] or []`);
  for (const l of asList(h.languages)) if (typeof l !== 'string' || !/^[a-z]{2,3}(-[A-Za-z0-9]+)?$/.test(l)) p.push(`language '${l}' is not an ISO 639 code (la, grc, lzh …)`);
  for (const s of asList(h.scripts)) if (typeof s !== 'string' || !/^[A-Z][a-z]{3}$/.test(s)) p.push(`script '${s}' is not an ISO 15924 code (Latn, Grek, Tibt …)`);
  if (ctx.canons) for (const c of asList(h.canons)) if (!ctx.canons.has(c)) p.push(`canon '${c}' is not a canon-gap id (scripts/catalog-coverage/results/canon-gap-status-*.json)`);
  for (const k of ['n_books', 'n_pages']) if (h[k] != null && !(Number.isInteger(h[k]) && h[k] >= 0)) p.push(`'${k}' must be a whole number or null`);
  if (typeof h.verdict === 'string' && /\n/.test(h.verdict)) p.push('verdict must be one line');
  for (const i of asList(h.issue)) if (!(Number.isInteger(i) && i > 0)) p.push(`issue '${i}' must be an issue number`);
  if (h.router_evidence != null) {
    if (typeof h.router_evidence === 'string') {
      if (!/^none\s+[—-]+\s*\S/.test(h.router_evidence)) p.push('router_evidence must be a list of router-table cell ids, or "none — <why>"');
    } else if (!Array.isArray(h.router_evidence) || !h.router_evidence.length) p.push('router_evidence must be a list of router-table cell ids, or "none — <why>"');
    else if (ctx.routerCells) for (const c of h.router_evidence) if (!ctx.routerCells.has(c)) p.push(`router_evidence cell '${c}' is not a cell in scripts/eval/estimator/router-table/rules.json`);
  }
  if (h.status === 'superseded' && !h.superseded_by) p.push("status 'superseded' needs superseded_by: <file>");
  if (h.superseded_by != null) {
    if (h.status !== 'superseded') p.push("superseded_by is set but status is not 'superseded'");
    if (typeof h.superseded_by !== 'string' || !/^[\w.-]+\.md$/.test(h.superseded_by)) p.push('superseded_by must be a file name in experiments/');
    else if (h.superseded_by === ctx.name) p.push('superseded_by points at the file itself');
    else if (ctx.exists && !ctx.exists(h.superseded_by)) p.push(`superseded_by ${h.superseded_by} does not exist`);
  }
  return p;
}

/** Read one experiment file: { header (object|null), body, problems[] }. */
export function readExperiment(text, ctx = {}) {
  const { header, body, unterminated } = splitHeader(text);
  if (unterminated) return { header: null, body, problems: ['front matter opened with --- but never closed'] };
  if (header == null) return { header: null, body, problems: [] };
  let h;
  try { h = parseHeader(header); } catch (e) { return { header: null, body, problems: [e.message] }; }
  return { header: h, body, problems: validateHeader(h, ctx) };
}

const q = (v) => (v == null ? 'null' : typeof v === 'number' ? String(v) : JSON.stringify(v));
// Codes and enum words are written bare; every other string is double-quoted.
const word = (v) => (typeof v === 'string' && /^[A-Za-z][\w-]*$/.test(v) && !['null', 'true', 'false', 'yes', 'no', 'on', 'off'].includes(v.toLowerCase()) ? v : q(v));

/** Write a header object as front matter, fields in schema order. */
export function serializeHeader(h) {
  const lines = ['---'];
  for (const k of FIELDS) {
    if (!(k in h)) continue;
    const v = h[k];
    const bare = ['stage', 'measure', 'status'].includes(k);
    const out = Array.isArray(v) ? `[${v.map(word).join(', ')}]` : bare ? word(v) : q(v);
    lines.push(`${k}: ${out}`);
  }
  lines.push('---', '');
  return lines.join('\n');
}
