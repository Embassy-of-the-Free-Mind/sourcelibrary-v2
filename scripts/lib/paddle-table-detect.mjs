// PRIOR ART: scripts/lib/first-ocr-guard.mjs (textVerdict: the loop flags this rule gates on — reused, not copied),
// scripts/lib/paddle-zh-lane.mjs (longestCharRun / MAX_CHAR_RUN, the lane's own run guard — reused) and the
// paddle-skqs-rest-6388 exclusion rule (a hand-made title list of table-heavy works, /root/paddle-skqs-rest-6388/
// exclusions.json). None of them says WHICH served Paddle page is a table or diagram page carrying invented cells:
// the strict screen flags 0.31 % of pages and only 16 % of those are invented; the title list is per work, not per page.
//
// Paddle Chinese table / diagram risk (#6388). A PURE function over the stored page text and the book title:
// no I/O, no model call. It is NOT wired into the lane; wiring it (hold the page, send it to a backup reader) is a
// separate decision. Measured in scripts/eval/experiments/2026-10-11-paddle-zh-table-detector-6388.md.
//
// THE RULE (S4 in the write-up): flag = LOOP-GATE and SHAPE
//   LOOP-GATE  the strict screen (first-ocr-guard local_loop / line_loop / exact_loop, or a run of one character > 40),
//              or repeated_line with a run ≥ 5 and a duplicated line — the shape of the two contained 洪範皇極內篇
//              chart pages the strict screen let through;
//   SHAPE      a run of one character ≥ 4, or any duplicated line, or distinct/total Han < 0.30, or a work title
//              from the table-heavy prior (TABLE_TITLE).
// On 136 pages judged invented (66 contained + 70 more called invented by Opus) it flags 136 (Wilson 97–100 %);
// on all 1,568,108 Paddle-written pages it flags 4,401 (0.28 %), against 4,857 for the strict screen alone, with
// invented-precision 38 % vs 16 % on the 495 strict-flagged pages Opus judged.
//
// What it CANNOT see: Paddle's own layout output is no signal (tables_flattened > 0 on 6,946 pages, 0 of them
// invented or table-judged; Paddle-VL wrote no <table> on any chart page). And every labelled invented page came
// from the strict screen's own flags, so recall on invented pages the loop gate never raises is NOT measured.
import { textVerdict } from './first-ocr-guard.mjs';
import { longestCharRun, MAX_CHAR_RUN } from './paddle-zh-lane.mjs';
import { stripMarkupTags } from './strip-markup-tags.mjs';

const HAN = /\p{Script=Han}/u;
const STRICT_FLAGS = new Set(['local_loop', 'line_loop', 'exact_loop']);

/** Work titles whose volumes are mostly tables, charts or diagrams (measured clusters on #6388; calendrical,
 * numerological, mathematical and illustrated works). A title match alone never flags a page: it is a SHAPE term. */
export const TABLE_TITLE = /三才圖會|武備志|洪範皇極|易學象數論|皇極經世|曆|歷|歴|算|數理精蘊|儀象|星|律呂|樂律|圖說|圖解|易圖|河洛|太乙|六壬|奇門|韻圖|切韻|詞譜/u;

export const T = { gateRun: 5, shapeRun: 4, distinctMax: 0.3 };

/** The page body a reader is served: envelope, margin marks and tags removed. */
export function servedBody(text) {
  return stripMarkupTags(String(text || '')
    .replace(/<language>[\s\S]*?<\/language>|<script>[\s\S]*?<\/script>/g, '')
    .replace(/<(header|page-num)>[\s\S]*?<\/\1>/g, ''), '').trim();
}

/** Text-shape features of a stored Paddle page. */
export function pageShape(text) {
  const body = servedBody(text);
  const lines = body.split('\n').map((l) => [...l].filter((c) => HAN.test(c)).join('')).filter(Boolean);
  const han = lines.reduce((a, l) => a + [...l].length, 0);
  const seen = new Set();
  let dupLines = 0;
  for (const l of lines) { if ([...l].length < 2) continue; if (seen.has(l)) dupLines++; else seen.add(l); }
  const distinct = new Set(lines.join('')).size;
  return { han, lines: lines.length, run: longestCharRun(body), dup_lines: dupLines, distinct_ratio: han ? distinct / han : 0 };
}

/**
 * `{ flag, gate, shape, reasons, features }` for one stored Paddle page. `text` is `ocr.data` as stored (envelope and
 * margin tags allowed); `title` is the book title (optional — without it the title term never fires).
 */
export function paddleTableRisk(text, { title = '' } = {}, t = T) {
  const f = pageShape(text);
  const raw = String(text || '').replace(/<language>[\s\S]*?<\/language>|<script>[\s\S]*?<\/script>/g, '').trim();
  const v = textVerdict(stripMarkupTags(raw, ''));
  const strict = v.flags.some((x) => STRICT_FLAGS.has(x)) || longestCharRun(raw) > MAX_CHAR_RUN;
  const repLoop = v.flags.includes('repeated_line') && f.run >= t.gateRun && f.dup_lines > 0;
  const reasons = [];
  if (strict) reasons.push(`strict:${v.flags.filter((x) => STRICT_FLAGS.has(x)).join('+') || 'char_run'}`);
  if (repLoop) reasons.push('repeated_line_run');
  const gate = strict || repLoop;
  const titleHit = TABLE_TITLE.test(String(title || '').normalize('NFC'));
  if (f.run >= t.shapeRun) reasons.push(`run:${f.run}`);
  if (f.dup_lines > 0) reasons.push(`dup_lines:${f.dup_lines}`);
  if (f.han && f.distinct_ratio < t.distinctMax) reasons.push(`distinct:${f.distinct_ratio.toFixed(3)}`);
  if (titleHit) reasons.push('table_title');
  const shape = f.run >= t.shapeRun || f.dup_lines > 0 || (f.han > 0 && f.distinct_ratio < t.distinctMax) || titleHit;
  return { flag: gate && shape, gate, shape, reasons, features: { ...f, guard_flags: v.flags } };
}
