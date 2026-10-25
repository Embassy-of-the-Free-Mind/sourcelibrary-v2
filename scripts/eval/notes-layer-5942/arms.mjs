// PRIOR ART: scripts/eval/plain-6728/prompts.mjs bodyOf() — the one tag strip #6728 judged every arm through. Here
// the strip is Part A's splitAnnotations (the parser under test), so the body a judge reads is exactly the `text` a
// layered store would hold; bodyOf is not used because it keeps no annotations to measure.
/**
 * #5942 Part B: read an arm's output into { body, annotations } — T and P through splitAnnotations, S from its JSON.
 */
import fs from 'node:fs';
import { splitAnnotations, resolveAnchor } from '../../lib/annotation-layer.mjs';

export const W = `${process.env.JOB_SCRATCH}/b`;
export const readJsonl = (f) => (fs.existsSync(f) ? fs.readFileSync(f, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)) : []);
export const COMMENTARY_TYPES = new Set(['note', 'definition', 'original', 'image']);

/** The S reply: JSON {text, annotations}. Returns { ok, text, annotations, problem }. */
export function parseS(raw) {
  let t = String(raw || '').trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
  let j = null, problem = null;
  try { j = JSON.parse(t); } catch {
    const a = t.indexOf('{'), b = t.lastIndexOf('}');
    if (a >= 0 && b > a) { try { j = JSON.parse(t.slice(a, b + 1)); problem = 'json after stripping text around it'; } catch { /* still not JSON */ } }
  }
  if (!j || typeof j.text !== 'string') return { ok: false, text: '', annotations: [], problem: 'not valid JSON with a "text" string' };
  const annotations = Array.isArray(j.annotations) ? j.annotations.filter((a) => a && typeof a === 'object') : [];
  return { ok: true, text: j.text, annotations, problem };
}

/**
 * One arm's output for a page, as layers. For S, each annotation gets an anchor: the first occurrence of its `exact`
 * (the position the model did not give) checked by resolveAnchor with its prefix/suffix.
 */
export function layersOf(arm, raw) {
  if (arm !== 'S') {
    const s = splitAnnotations(raw);
    return { ok: true, body: s.text, annotations: s.annotations, malformed: s.annotations.filter((a) => a.malformed) };
  }
  const p = parseS(raw);
  if (!p.ok) {
    // Unparseable: the judge still gets the words, with the JSON scaffolding taken off as best it can.
    const m = String(raw || '').match(/"text"\s*:\s*"((?:[^"\\]|\\.)*)"/);
    const body = m ? m[1].replace(/\\n/g, '\n').replace(/\\"/g, '"') : String(raw || '');
    return { ok: false, body: splitAnnotations(body).text, annotations: [], malformed: [], problem: p.problem };
  }
  const markupLeft = (p.text.match(/<\/?[a-zA-Z][\w-]*(?:\s[^<>]*)?\/?>/g) || []).filter((t) => !/^<(column-break|leaf-break)\s*\/?>$/i.test(t));
  const stripped = splitAnnotations(p.text);
  const annotations = p.annotations.map((a) => {
    const type = String(a.type || '').toLowerCase();
    const exact = typeof a.exact === 'string' ? a.exact : '';
    const page = ['summary', 'keywords', 'meta'].includes(type) || (!exact && !COMMENTARY_TYPES.has(type) && !['margin', 'insert', 'unclear', 'gloss'].includes(type));
    if (page) return { type, kind: 'page', scope: 'page', body: a.body ?? '', anchor: null };
    const first = exact ? p.text.indexOf(exact) : -1;
    const occurrences = exact ? p.text.split(exact).length - 1 : 0;
    const anchor = { exact, prefix: typeof a.prefix === 'string' ? a.prefix : '', suffix: typeof a.suffix === 'string' ? a.suffix : '', start: first >= 0 ? first : undefined, end: first >= 0 ? first + exact.length : undefined };
    const r = exact ? resolveAnchor(p.text, anchor) : null;
    return { type, kind: COMMENTARY_TYPES.has(type) ? 'commentary' : 'mark', body: a.body ?? '', anchor: r ? { ...anchor, start: r.start, end: r.end } : anchor, resolved: r, occurrences };
  });
  return { ok: true, body: stripped.text, text: p.text, annotations, malformed: [], markupLeft, problem: p.problem };
}
