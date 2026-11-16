// PRIOR ART: scripts/eval/router-next-7263/waiting-split.mjs (FRAMES: language x draft bucket → router base cell; the bucket
// regexes and their order are copied from it and from scripts/eval/estimator/chain/volumes-by-draft.mjs's $switch) and
// scripts/eval/router-next-7263/script-type.mjs (print / manuscript / unknown per page, reused unchanged by the callers).
// Neither assigns ONE page to a router cell id; the test-set frame (#264) needs exactly that, for drawn pages, reference
// pages and judged pages alike, so all three land in the same cells.
/**
 * Router cells for the OCR test set (#264): which cell a page belongs to, and how many books each cell gets.
 *
 * A page's cell = its book's catalogue language x the engine that wrote its stored text (the draft bucket) x its script
 * type (print | manuscript | unknown, script-type.mjs's order). These are the router table's own cell ids, unchanged
 * (scripts/eval/estimator/router-table/current.json via router-binding.mjs loadCurrentTable), so a score on a frame row
 * lands on the /admin/router cell that routes the page.
 *
 * Pure: no database. Callers pass the page and book fields.
 */
import { loadCurrentTable, ROUTER_DIR } from '../../lib/router-binding.mjs';
import fs from 'node:fs';
import path from 'node:path';

/** The stored text's engine, in the census order (an earlier branch wins). */
export function draftBucket(model) {
  if (!model || typeof model !== 'string') return 'none';
  if (/flash-lite/.test(model)) return 'lite';
  if (/paddle/i.test(model)) return 'paddle';
  if (/yigdzin/i.test(model)) return 'yigdzin';
  if (/^gemini-3-flash/.test(model)) return 'flash3';
  if (/^claude/.test(model)) return 'claude';
  if (/antigravity|gemini-3\.[678]|gemini-4/.test(model)) return 'agy';
  return 'other';
}

// language → draft bucket → router base cell (waiting-split.mjs FRAMES, read the other way round)
const BASES = {
  Latin: { lite: 'latin-lite', flash3: 'latin-flash3', none: 'latin-blank' },
  German: { lite: 'german-lite', flash3: 'german-flash3', none: 'german-blank' },
  French: { lite: 'french-lite', none: 'french-blank' },
  Greek: { lite: 'greek-lite', flash3: 'greek-flash3' },
  Tibetan: { yigdzin: 'tibetan-yigdzin' },
  Chinese: { lite: 'zh-lite', flash3: 'chinese-flash3', paddle: 'zh-paddle' },
  Hebrew: { flash3: 'hebrew-flash3' },
  Arabic: { lite: 'arabic-lite', flash3: 'arabic-flash3' },
  Sanskrit: { lite: 'sanskrit-lite', none: 'sanskrit-blank' },
  Italian: { lite: 'italian-lite' }, Spanish: { lite: 'spanish-lite' }, Korean: { lite: 'korean-lite' },
  Russian: { lite: 'russian-lite' }, Portuguese: { lite: 'portuguese-lite' }, Danish: { lite: 'danish-lite' },
  Hindi: { lite: 'hindi-lite' }, 'Middle English': { lite: 'middle-english-lite' }, 'Middle High German': { lite: 'mhg-lite' },
  'Old French': { lite: 'old-french-lite' }, 'Ottoman Turkish': { lite: 'ottoman-lite' }, Tamil: { lite: 'tamil-lite' },
  Turkish: { lite: 'turkish-lite' }, English: { none: 'english-blank-pre1800' },
};
export const FRAME_LANGUAGES = Object.keys(BASES);
/** Catalogue language of a router base cell (the Paddle split cells are Chinese). */
export function languageOfBase(base) {
  if (/^zh-(frame|paddle)/.test(base)) return 'Chinese';
  return Object.keys(BASES).find((l) => Object.values(BASES[l]).includes(base)) || null;
}
export const GUARDED_PIPELINE = 'paddle-zh-guarded-2026-10';

/** Writing script of a base cell, for pooling small cells into one "other" cell per script. */
export function writingScript(base) {
  if (/^(greek)/.test(base)) return 'greek';
  if (/^hebrew/.test(base)) return 'hebrew';
  if (/^(arabic|ottoman)/.test(base)) return 'arabic';
  if (/^(zh|chinese|korean)/.test(base)) return 'cjk';
  if (/^tibetan/.test(base)) return 'tibetan';
  if (/^(sanskrit|hindi|tamil)/.test(base)) return 'indic';
  if (/^russian/.test(base)) return 'cyrillic';
  return 'latin-script';
}

/**
 * The router base cell for a page, or { base: null, why }.
 * page: { model, pipeline, dice }   book: { language, year }
 */
export function baseOf(book, page) {
  const lang = book.language;
  const m = BASES[lang];
  if (!m) return { base: null, why: `no router cell for language ${lang ?? '(none)'}` };
  const bucket = draftBucket(page.model);
  if (bucket === 'paddle' && lang === 'Chinese') {
    if (page.pipeline === GUARDED_PIPELINE) return { base: 'zh-frame-6871', bucket };
    if (typeof page.dice === 'number' && page.dice < 0.9) return { base: 'zh-paddle-dice-lt090', bucket };
    return { base: null, bucket, why: 'Paddle text with Kanripo dice >= 0.90 or unscreened: not waiting' };
  }
  if (bucket === 'none' && lang === 'English' && !(Number(book.year) < 1800)) return { base: null, bucket, why: 'English, no stored text, 1800 or later or undated: no cell' };
  const base = m[bucket];
  if (!base) return { base: null, bucket, why: `${lang} text by ${bucket}: no router cell (not waiting, or no cell for this engine)` };
  return { base, bucket };
}

/** Load the OCR cells of the live router table with pages waiting. Translation cells and empty cells are left out. */
export function loadOcrCells(dir = ROUTER_DIR) {
  const t = loadCurrentTable(dir);
  const rules = JSON.parse(fs.readFileSync(path.join(dir, 'rules.json'), 'utf8'));
  const ruleCells = new Map(rules.cells.map((c) => [c.id, c]));
  const cells = new Map();
  for (const [id, r] of t.rows) {
    const base = r.base || id.split('/')[0];
    if (/-tr\b|-tr-|^zh-siku|^tengyur|^tibetan-tr/.test(base)) continue;        // translation cells: not OCR
    let waiting = Number(r.pages_waiting) || 0, waiting_source = `router table ${r.table || t.name}`;
    // The no-stored-text cells are not split by script in the table (each row reads 0); rules.json holds the cell's count.
    if (/-blank/.test(base) && !waiting && ruleCells.get(base)?.pages_waiting) {
      const blankScript = base === 'english-blank-pre1800' ? 'unknown' : 'print';
      if (id === `${base}/${blankScript}`) { waiting = Number(ruleCells.get(base).pages_waiting); waiting_source = 'rules.json cells[].pages_waiting (#7701 first-read count; the table row reads 0)'; }
    }
    cells.set(id, { id, base, script: r.script || id.split('/')[1], title: r.title, pages_waiting: waiting, waiting_source, decision: r.decision || null, bound_route: r.bound_route || null });
  }
  return { table: t.name, pointer_set: t.pointer.set || null, cells };
}

/** The router cell id for a page given its base and script class. Blank pages carry no stored class: they go where the cell is. */
export function cellId(cells, base, cls) {
  if (!base) return null;
  if (/-blank/.test(base)) {
    for (const s of [cls, 'print', 'unknown']) if (s && cells.has(`${base}/${s}`)) return `${base}/${s}`;
    return null;
  }
  if (base === 'zh-paddle') return null;
  const id = `${base}/${cls || 'unknown'}`;
  return cells.has(id) ? id : null;
}

export const SIZE_RULE = Object.freeze({ decision: { min_waiting: 100_000, books: 50 }, directional: { min_waiting: 20_000, books: 30 }, pooled_small: 15, reserve_share: 0.2 });

/**
 * Frame cells and their book targets (#264 design point 2): 100K+ pages waiting → 50 books, 20K–100K → 30, smaller cells
 * pooled into one `other-<writing script>` cell sized by the same thresholds on the pooled total (under 20K: 15).
 * Cells with no pages waiting are not in the frame.
 */
export function frameCells(cells) {
  const out = new Map(), pools = new Map();
  for (const c of cells.values()) {
    if (!c.pages_waiting) continue;
    if (c.pages_waiting >= SIZE_RULE.directional.min_waiting) {
      out.set(c.id, { id: c.id, router_cells: [c.id], pages_waiting: c.pages_waiting, target: c.pages_waiting >= SIZE_RULE.decision.min_waiting ? SIZE_RULE.decision.books : SIZE_RULE.directional.books, pooled: false });
    } else {
      const id = `other-${writingScript(c.base)}`;
      const p = pools.get(id) || { id, router_cells: [], pages_waiting: 0, pooled: true };
      p.router_cells.push(c.id); p.pages_waiting += c.pages_waiting; pools.set(id, p);
    }
  }
  for (const p of pools.values()) {
    p.target = p.pages_waiting >= SIZE_RULE.decision.min_waiting ? SIZE_RULE.decision.books : p.pages_waiting >= SIZE_RULE.directional.min_waiting ? SIZE_RULE.directional.books : SIZE_RULE.pooled_small;
    out.set(p.id, p);
  }
  return out;
}

/** Frame cell for a router cell id (itself, or its pool). */
export function frameCellOf(frame, routerCell) {
  if (!routerCell) return null;
  for (const f of frame.values()) if (f.router_cells.includes(routerCell)) return f.id;
  return null;
}

/** Canonical (a model may recite it), from the reference's source. */
export function canonicalFromSource(source) {
  return /perseus|first1k|kanripo|cbeta|etcbc|peshitta|sefaria|kangyur|kanjur|derge|bdrc|acip|gretil|bible|vulgate/i.test(String(source || ''));
}
