#!/usr/bin/env node
/**
 * PRIOR ART: scripts/eval/build-routing-table.mjs — probes getOcrModelForBook and renders the doc
 * table, with --check for staleness (class c below reuses both, imported); it does not compare the
 * probes with what the ledger DECIDED, and it does not probe translation routing or the OCR-trust
 * gate. tests/unit/translate-core-parity.test.ts pins the JS and TS routers to each other, not to a
 * decision. scripts/audit/pipeline-next-step-audit.mjs — the file-one-issue / close-on-pass shape
 * this follows (its `gh` helper is private to that script and tied to one title).
 *
 * routing-drift — does the code route what the ledger decided? (#5871)
 *
 * The ledger (scripts/eval/DECISIONS.md) is written by hand; so are the routers. This reads both and
 * reports five classes:
 *
 *   (a) contradicted   a DECIDED row whose verdict the live probe contradicts
 *   (b) undecided      a routing branch (a probe cell that differs from the default) that no DECIDED
 *                      row covers, or a routing constant the probe grid cannot reach
 *   (c) stale-table    the generated table in .claude/docs/ocr-engine-routing.md is not what
 *                      build-routing-table.mjs renders today
 *   (d) pending-old    a PENDING row older than 14 days (date in the Decision cell, else the commit
 *                      that added the row, else the newest date in the row)
 *   (e) unmapped       a DECIDED row scripts/audit/routing-drift-map.json does not name, or a map
 *                      entry that names no row or selects no probe cell
 *
 * What is probed: getOcrModelForBook (language × visible / new / hidden backlog),
 * getTranslateModelForBook (language × provider) and ocrTrustVerdict (language × period × hand),
 * for every language of scripts/eval/routing-eval/languages.json plus the map's `extra_languages`.
 * The defaults are lite, lite and "translate". Matching a prose row to a probe is not guessed: the
 * map says which cells a row speaks for and what it expects there.
 *
 *   node scripts/audit/routing-drift.mjs            # report; exit 0 clean, 1 findings, 2 could not run
 *   node scripts/audit/routing-drift.mjs --ci       # class (c) only: exit 1 if the table is stale
 *   node scripts/audit/routing-drift.mjs --rows     # list every ledger row with its id and status
 *   node scripts/audit/routing-drift.mjs --json
 *   node scripts/audit/routing-drift.mjs --apply    # also file / rewrite / close ONE GitHub issue per
 *                                                   # class (label routing-drift); the cron uses this
 *
 * No model call, no database. --apply writes GitHub issues and nothing else. Nothing automated
 * reads those issues.
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { probeOcr, ledgerRows, rowStatus, renderRoutingTable, currentSection, DOC } from '../eval/build-routing-table.mjs';
import { OCR_LITE_ONLY, FLASH_OCR_FROM, FLASH_OCR_INCLUDES_HIDDEN } from '../lib/ocr-routing.mjs';
import { getTranslateModelForBook, MODEL_FLASH, MODEL_LITE } from '../lib/translate-core.mjs';
import { ocrTrustVerdict, OCR_TRUST_TABLE } from '../lib/ocr-trust-gate.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const LEDGER = 'scripts/eval/DECISIONS.md';
const MAP = 'scripts/audit/routing-drift-map.json';
const LANGUAGES = 'scripts/eval/routing-eval/languages.json';
const SELF = 'scripts/audit/routing-drift.mjs';
export const PENDING_MAX_DAYS = 14;
export const LABEL = 'routing-drift';
export const SECTIONS = [['OCR engine per stratum', 'ocr'], ['Translation', 'translation'], ['Other lanes', 'other']];
export const DEFAULTS = { ocr: 'lite', translate: 'lite', gate: 'translate' };
export const CLASSES = {
  contradicted: { letter: 'a', title: 'Routing drift (a): a DECIDED ledger row the code contradicts', fix: `Either the code is wrong (route as decided) or the ledger is (add the superseding row and mark this one \`superseded by\`), or the map in \`${MAP}\` misreads the row.` },
  undecided: { letter: 'b', title: 'Routing drift (b): a routing branch with no DECIDED ledger row', fix: `Each branch needs a DECIDED row in \`${LEDGER}\` mapped to it in \`${MAP}\` (a PENDING row that was merged becomes DECIDED when Derek says so), or the branch comes out of the code.` },
  'stale-table': { letter: 'c', title: 'Routing drift (c): the generated routing table is stale', fix: 'Run `node scripts/eval/build-routing-table.mjs` and commit the doc.' },
  'pending-old': { letter: 'd', title: `Routing drift (d): PENDING ledger rows older than ${PENDING_MAX_DAYS} days`, fix: 'Each row waits for a decision: decide it, or change its Decision cell to say why it is parked.' },
  unmapped: { letter: 'e', title: 'Routing drift (e): ledger rows and map entries that do not line up', fix: `Add the row to \`${MAP}\` with the probe cells it speaks for, or with \`not_routing\` and a reason. Ids: \`node ${SELF} --rows\`.` },
};

const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');
const slug = (s, n) => s.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, n).replace(/-$/, '');
const short = (m) => (m === MODEL_LITE ? 'lite' : m === MODEL_FLASH ? 'flash' : m);
const list = (v) => (v == null ? null : Array.isArray(v) ? v : [v]);

// ─────────────────────────────────────────── the ledger

/** Every row of the three tables: { id, section, line, status, stratum, question, decision, applied, cells }. */
export function parseLedger(text) {
  const lines = text.split('\n'); const rows = []; const seen = new Map(); let from = 0;
  for (const [heading, section] of SECTIONS) {
    for (const cells of ledgerRows(text, heading)) {
      const head = `| ${cells[0]} | ${cells[1]} |`;
      const at = lines.findIndex((l, i) => i >= from && l.startsWith(head));
      if (at >= 0) from = at + 1;
      const base = `${section}/${slug(cells[0], 60)}--${slug(cells[1] || '', 40)}`;
      const n = (seen.get(base) || 0) + 1; seen.set(base, n);
      rows.push({ id: n > 1 ? `${base}#${n}` : base, section, line: at >= 0 ? at + 1 : null, status: rowStatus(cells), stratum: cells[0], question: cells[1] || '', decision: cells[4] || '', applied: cells[5] || '', cells });
    }
  }
  return rows;
}

// ─────────────────────────────────────────── the probes

export const VISIBILITIES = ['visible', 'new', 'hidden backlog'];
export const PROVIDERS = ['none', 'bph'];
export const PERIODS = [['before 1450', 1400], ['1450–1500', 1475], ['1501–1599', 1550], ['1600–1699', 1650], ['1700–1799', 1750], ['1800+', 1850], ['undated', null]];
export const HANDS = ['manuscript', 'print'];
const PROFILE = { manuscript: { handwritten: 5, printed: 0, mixed: 0, ocr: 5, reread: {} }, print: { handwritten: 0, printed: 5, mixed: 0, ocr: 5, reread: {} } };

/** The live routers, in the shape buildGrid calls them. Tests pass their own. */
export function liveRouters({ liteOnly = OCR_LITE_ONLY } = {}) {
  return {
    ocr: (family, name) => probeOcr(family, name, { liteOnly }),
    translate: (language, provider) => short(getTranslateModelForBook({ language, ...(provider === 'none' ? {} : { image_source: { provider } }) })),
    gate: (language, year, hand) => { const v = ocrTrustVerdict({ language, year }, PROFILE[hand]); return { value: v.ok ? 'translate' : 'refuse', stratum: v.stratum || null }; },
    constants: { OCR_LITE_ONLY: liteOnly ? 'on' : 'off' },
    ocrFamilies: [...new Set([...Object.keys(FLASH_OCR_FROM), ...FLASH_OCR_INCLUDES_HIDDEN])],
    gateRows: OCR_TRUST_TABLE.filter((r) => r.gated).map((r) => r.id),
  };
}

/** One cell per language × function × dimension: { fn, language, family, value, visibility | provider | period + hand }. */
export function buildGrid(languages, routers) {
  const cells = [];
  for (const { family, name } of languages) {
    const language = family === 'und' ? null : name;
    const ocr = routers.ocr(family, name);
    for (const visibility of VISIBILITIES) cells.push({ fn: 'ocr', language: name, family, visibility, value: ocr[visibility] });
    for (const provider of PROVIDERS) cells.push({ fn: 'translate', language: name, family, provider, value: routers.translate(language, provider) });
    for (const [period, year] of PERIODS) for (const hand of HANDS) cells.push({ fn: 'gate', language: name, family, period, hand, ...routers.gate(language, year, hand) });
  }
  return cells;
}

const DIMS = ['visibility', 'provider', 'period', 'hand'];
/** Does a map selector ({ fn, language, visibility?, provider?, period?, hand?, expect }) speak for this cell? */
export function selects(sel, cell) {
  if (sel.fn !== cell.fn) return false;
  if (sel.language !== '*' && !list(sel.language).includes(cell.language)) return false;
  // A translate selector that names no provider means a book with none (BPH is its own branch).
  if (sel.fn === 'translate' && sel.provider == null) return cell.provider === 'none';
  return DIMS.every((d) => sel[d] == null || list(sel[d]).includes(cell[d]));
}

// ─────────────────────────────────────────── the audit

const dimsOf = (c) => (c.fn === 'ocr' ? c.visibility : c.fn === 'translate' ? (c.provider === 'none' ? 'no provider' : `provider ${c.provider}`) : `${c.hand}, ${c.period}`);

/** "Greek, Persian: visible, new" — cells grouped by what they share, so 350 probes read as a few lines. */
export function summarise(cells) {
  const byLang = new Map();
  for (const c of cells) { const k = `${c.fn}\t${c.value}\t${c.stratum || ''}\t${c.language}`; (byLang.get(k) || byLang.set(k, []).get(k)).push(dimsOf(c)); }
  const merged = new Map();
  for (const [k, dims] of byLang) {
    const [fn, value, stratum, language] = k.split('\t');
    let d = dims;
    if (fn === 'gate') d = HANDS.flatMap((h) => { const ps = dims.filter((x) => x.startsWith(`${h}, `)).map((x) => x.slice(h.length + 2)); return !ps.length ? [] : ps.length === PERIODS.length ? [`${h} (any period)`] : [`${h} (${ps.join(', ')})`]; });
    const mk = `${fn}\t${value}\t${stratum}\t${d.join('; ')}`;
    (merged.get(mk) || merged.set(mk, []).get(mk)).push(language);
  }
  return [...merged].map(([mk, langs]) => { const [fn, value, stratum, d] = mk.split('\t'); return `${fn} → ${value}${stratum ? ` (${stratum})` : ''} · ${langs.join(', ')} · ${d}`; });
}

/**
 * The comparison. Pure: every input is passed in.
 *   rows       parseLedger()            map      the parsed routing-drift-map.json
 *   grid       buildGrid()              routers  { constants, ocrFamilies, gateRows }
 *   table      { committed, rendered }  now      Date
 *   rowDate    (row) => { date: 'YYYY-MM-DD' | null, source }
 */
export function auditRouting({ rows, map, grid, routers = {}, table, now, rowDate }) {
  const findings = { contradicted: [], undecided: [], 'stale-table': [], 'pending-old': [], unmapped: [] };
  const notes = [];
  const where = (r) => `${LEDGER.split('/').pop()}:${r.line ?? '?'} "${r.stratum.length > 64 ? `${r.stratum.slice(0, 64)}…` : r.stratum}"`;
  const entries = map.rows || {};
  const byId = new Map(rows.map((r) => [r.id, r]));
  const covered = new Set(); const proposedBy = new Map(); let probed = 0, notRouting = 0;

  for (const id of Object.keys(entries)) if (!byId.has(id)) findings.unmapped.push({ key: `map:${id}`, text: `map entry \`${id}\` names no ledger row (the row's Stratum or Question cell was edited, or the row is gone)` });

  for (const r of rows) {
    const e = entries[r.id];
    if (!e) { if (r.status === 'decided') findings.unmapped.push({ key: `row:${r.id}`, text: `DECIDED row ${where(r)} is not in the map (id \`${r.id}\`) — "${r.decision.slice(0, 90)}"` }); continue; }
    if (e.not_routing) { if (r.status === 'decided') notRouting++; continue; }
    if (!Array.isArray(e.probes) || !e.probes.length) { findings.unmapped.push({ key: `empty:${r.id}`, text: `map entry \`${r.id}\` has neither \`probes\` nor \`not_routing\`` }); continue; }
    if (r.status === 'decided') probed++;
    for (const sel of e.probes) {
      if (sel.fn === 'constant') {
        const got = routers.constants?.[sel.name];
        if (got === undefined) findings.unmapped.push({ key: `const:${r.id}:${sel.name}`, text: `map entry \`${r.id}\` probes a constant the audit does not read: ${sel.name}` });
        else if (r.status === 'decided' && got !== sel.expect) findings.contradicted.push({ key: `${r.id}:${sel.name}`, text: `${where(r)} expects ${sel.name} = ${sel.expect}; this environment has ${got}` });
        continue;
      }
      const cells = grid.filter((c) => selects(sel, c));
      if (!cells.length) { findings.unmapped.push({ key: `nocell:${r.id}:${JSON.stringify(sel)}`, text: `map entry \`${r.id}\` has a probe that selects no cell: \`${JSON.stringify(sel)}\`` }); continue; }
      if (r.status !== 'decided') { for (const c of cells) if (c.value === sel.expect) (proposedBy.get(c) || proposedBy.set(c, new Set()).get(c)).add(r); continue; }
      const wrong = cells.filter((c) => c.value !== sel.expect);
      for (const c of cells) if (c.value === sel.expect) covered.add(c);
      if (wrong.length) findings.contradicted.push({ key: `${r.id}:${JSON.stringify(sel)}`, text: `${where(r)} expects ${sel.fn} = ${sel.expect}; the probe says: ${summarise(wrong).join(' | ')}. Decision: "${r.decision.slice(0, 90)}"` });
    }
  }

  // (b) every cell off the default needs a DECIDED row that expects what the code does there
  const loose = grid.filter((c) => c.value !== DEFAULTS[c.fn] && !covered.has(c));
  const groups = new Map();
  for (const c of loose) { const by = [...(proposedBy.get(c) || [])].map((r) => r.id).sort().join(','); (groups.get(by) || groups.set(by, []).get(by)).push(c); }
  for (const [by, cells] of groups) for (const line of summarise(cells)) {
    const rs = by ? by.split(',').map((id) => byId.get(id)) : [];
    findings.undecided.push({ key: `${line}`, text: `${line} (default ${DEFAULTS[line.split(' ')[0]]}) — ${rs.length ? `the ledger row for it is not DECIDED: ${rs.map((r) => `${where(r)} "${r.decision.slice(0, 50)}"`).join('; ')}` : 'no mapped ledger row'}` });
  }
  const families = new Set(grid.map((c) => c.family)); const strata = new Set(grid.map((c) => c.stratum).filter(Boolean));
  for (const f of routers.ocrFamilies || []) if (!families.has(f)) findings.undecided.push({ key: `ocr-family:${f}`, text: `\`${f}\` is in FLASH_OCR_FROM / FLASH_OCR_INCLUDES_HIDDEN but not in the probe grid — add the language to \`extra_languages\` in ${MAP}` });
  for (const id of routers.gateRows || []) if (!strata.has(id)) findings.undecided.push({ key: `gate-row:${id}`, text: `OCR_TRUST_TABLE row \`${id}\` is gated but no probe cell lands in it — add its language to \`extra_languages\` in ${MAP}` });

  // (c)
  if (table && table.committed !== table.rendered) findings['stale-table'].push({ key: 'stale', text: `the generated section of \`${DOC}\` is not what build-routing-table.mjs renders (${table.committed == null ? 'markers missing' : `${diffLines(table.committed, table.rendered)} table line(s) differ`})` });

  // (d)
  for (const r of rows.filter((x) => x.status === 'pending')) {
    const { date, source } = rowDate(r);
    if (!date) { notes.push(`PENDING row ${where(r)}: no date found, age not judged`); continue; }
    const days = Math.floor((now - new Date(`${date}T00:00:00Z`)) / 86400000);
    if (days > PENDING_MAX_DAYS) findings['pending-old'].push({ key: r.id, text: `${days} days (since ${date}, ${source}): ${where(r)} — ${r.question.slice(0, 80)} — "${r.decision.slice(0, 80)}"` });
  }

  const counts = { rows: rows.length, decided: rows.filter((r) => r.status === 'decided').length, decided_probed: probed, decided_not_routing: notRouting, pending: rows.filter((r) => r.status === 'pending').length, cells: grid.length, off_default: grid.filter((c) => c.value !== DEFAULTS[c.fn]).length };
  return { findings, notes, counts };
}

function diffLines(a, b) { const x = a.split('\n'), y = new Set(b.split('\n')); return x.filter((l) => !y.has(l)).length || 1; }

/** The date a PENDING row has been waiting since. */
export function ledgerRowDate(row, { git = true } = {}) {
  const own = row.decision.match(/\b20\d\d-\d\d-\d\d\b/);
  if (own) return { date: own[0], source: 'Decision cell' };
  if (git) {
    try {
      const out = execFileSync('git', ['log', '--reverse', '--format=%aI', `-S| ${row.stratum} | ${row.question} |`, '--', LEDGER], { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 60_000 }).trim();
      if (out) return { date: out.split('\n')[0].slice(0, 10), source: 'commit that added the row' };
    } catch { /* not a git checkout, or a shallow one: fall through to the row's own dates */ }
  }
  const all = (row.cells.join(' ').match(/\b20\d\d-\d\d-\d\d\b/g) || []).sort();
  return all.length ? { date: all[all.length - 1], source: 'newest date in the row' } : { date: null, source: 'none' };
}

/**
 * POSITIVE CONTROL: flip one cell a DECIDED row vouches for and require class (a) to fire. An audit
 * that cannot see a planted contradiction reports "clean" for the wrong reason.
 */
export function positiveControl(input) {
  const decided = new Set(input.rows.filter((r) => r.status === 'decided').map((r) => r.id));
  for (const [id, e] of Object.entries(input.map.rows || {})) {
    if (!decided.has(id)) continue;
    for (const sel of e.probes || []) {
      const i = input.grid.findIndex((c) => sel.fn !== 'constant' && selects(sel, c) && c.value === sel.expect);
      if (i < 0) continue;
      const grid = input.grid.map((c, j) => (j === i ? { ...c, value: `not-${c.value}` } : c));
      const before = input.baseline.findings.contradicted.length;
      const after = auditRouting({ ...input, grid }).findings.contradicted.length;
      return { ok: after > before, detail: `flipped ${input.grid[i].fn} ${input.grid[i].language} (${dimsOf(input.grid[i])}) under \`${id}\`` };
    }
  }
  return { ok: null, detail: 'no DECIDED row with a probe to flip' };
}

// ─────────────────────────────────────────── report and issues

export function renderText(result, { day }) {
  const { findings, notes, counts, control } = result; const L = [];
  L.push(`routing-drift ${day} — ${counts.rows} ledger rows (${counts.decided} decided: ${counts.decided_probed} probed, ${counts.decided_not_routing} not routing; ${counts.pending} pending) × ${counts.cells} probe cells (${counts.off_default} off the default)`);
  for (const [k, c] of Object.entries(CLASSES)) {
    L.push(`(${c.letter}) ${k}: ${findings[k].length || 'none'}`);
    for (const f of findings[k]) L.push(`    - ${f.text}`);
  }
  for (const n of notes) L.push(`note: ${n}`);
  if (control) L.push(`positive control: ${control.ok === true ? 'fired' : control.ok === false ? 'DID NOT FIRE' : 'skipped'} (${control.detail})`);
  return L.join('\n');
}

const marker = (items) => `<!-- routing-drift:${crypto.createHash('sha256').update(items.map((f) => f.key).sort().join('\n')).digest('hex').slice(0, 16)} -->`;
export function issueBody(k, items, { day }) {
  return `${items.length} finding${items.length === 1 ? '' : 's'} on ${day}.\n\n${items.map((f) => `- ${f.text}`).join('\n')}\n\n**To clear it:** ${CLASSES[k].fix}\n\n`
    + `Written by \`${SELF} --apply\` (daily, #5871). It rewrites this body while the class has findings, comments when the set changes, and closes the issue on the first run that finds none.\n${marker(items)}`;
}

/**
 * One issue per class. `gh(args)` returns stdout. Returns one line per class saying what it did.
 * A class with findings and no open issue is filed; the same findings as yesterday change nothing;
 * a different set rewrites the body and comments; an empty class closes its issue.
 */
export function syncIssues(findings, { gh, day }) {
  const open = JSON.parse(gh(['issue', 'list', '--state', 'open', '--label', LABEL, '--json', 'number,title,body', '--limit', '50']) || '[]');
  const out = [];
  for (const [k, c] of Object.entries(CLASSES)) {
    const items = findings[k]; const issue = open.find((i) => i.title.startsWith(c.title));
    if (!items.length) {
      if (issue) { gh(['issue', 'close', String(issue.number), '--comment', `routing-drift found nothing in this class on ${day}. Closing.`]); out.push(`(${c.letter}) closed #${issue.number}`); } else out.push(`(${c.letter}) clean, no open issue`);
      continue;
    }
    const body = issueBody(k, items, { day });
    if (!issue) { out.push(`(${c.letter}) filed ${gh(['issue', 'create', '--title', c.title, '--label', LABEL, '--body', body])}`); continue; }
    if ((issue.body || '').includes(marker(items))) { out.push(`(${c.letter}) #${issue.number} unchanged (${items.length})`); continue; }
    gh(['issue', 'edit', String(issue.number), '--body', body]);
    gh(['issue', 'comment', String(issue.number), '--body', `The findings changed on ${day}: now ${items.length}. The issue body carries the current list.`]);
    out.push(`(${c.letter}) rewrote #${issue.number} (${items.length})`);
  }
  return out;
}

function ghCli(args) { return execFileSync('gh', args, { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 60_000 }).trim(); }

/** Everything the repo says today, ready for auditRouting. */
export function loadInputs({ now = new Date(), git = true } = {}) {
  const map = JSON.parse(read(MAP)); const L = JSON.parse(read(LANGUAGES));
  const languages = [...L.languages.map(({ family, name }) => ({ family, name })), ...(map.extra_languages || [])];
  const rows = parseLedger(read(LEDGER));
  for (const [, section] of SECTIONS) if (!rows.some((r) => r.section === section)) throw new Error(`${LEDGER}: no rows parsed in the "${section}" table — the table shape changed`);
  const routers = liveRouters();
  return { rows, map, routers, grid: buildGrid(languages, routers), table: { committed: currentSection(read(DOC)), rendered: renderRoutingTable() }, now, rowDate: (r) => ledgerRowDate(r, { git }) };
}

async function main() {
  const argv = process.argv.slice(2); const day = new Date().toISOString().slice(0, 10);
  if (argv.includes('--ci')) {
    const stale = currentSection(read(DOC)) !== renderRoutingTable();
    console.log(stale ? `routing-drift (c): ${DOC} is stale — run \`node scripts/eval/build-routing-table.mjs\` and commit the doc` : 'routing-drift (c): the generated routing table is current');
    return stale ? 1 : 0;
  }
  if (argv.includes('--rows')) { for (const r of parseLedger(read(LEDGER))) console.log(`${String(r.line).padStart(3)}  ${r.status.padEnd(20)}  ${r.id}`); return 0; }
  const input = loadInputs();
  const result = auditRouting(input);
  result.control = positiveControl({ ...input, baseline: result });
  console.log(argv.includes('--json') ? JSON.stringify({ day, ...result }, null, 2) : renderText(result, { day }));
  if (result.control.ok === false) { console.error('POSITIVE CONTROL DID NOT FIRE — the comparison is broken. Exit 2 (could not measure).'); return 2; }
  if (argv.includes('--apply')) {
    try { ghCli(['label', 'create', LABEL, '--description', 'Filed by scripts/audit/routing-drift.mjs (#5871)', '--color', 'D4C5F9']); } catch { /* the label exists */ }
    for (const line of syncIssues(result.findings, { gh: ghCli, day })) console.log(`issues: ${line}`);
  }
  return Object.values(result.findings).some((f) => f.length) ? 1 : 0;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  // An uncaught throw is "could not run" (2), never a finding (1).
  main().then((code) => process.exit(code), (e) => { console.error(`routing-drift could not run: ${e.stack || e.message}`); process.exit(2); });
}
