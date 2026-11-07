// PRIOR ART: cbeta-ref-6101.mjs takes text already fitted onto pages (ocr.source cbeta-xml-p5, on woodblock books, not Taisho leaves);
// zh-skqs-5568-kanripo.mjs pbPages splits Kanripo by <pb>, not CBETA <lb>. This splits one CBETA XML-P5 file by Taisho page and register.
// #6552: printed page -> Han text of the page, as CBETA serves it (<lem>/<corr>), with the positions CBETA itself declares changed from the print. 〇 stands for a gaiji <g>.
import fs from 'node:fs';
const HAN = /\p{Script=Han}/u;
/** Returns { page: { reg: {a:[], b:[], c:[]} , chars:[{c, lb, changed}] } }. Apparatus (<back>, type=orig/mod notes) dropped, inline notes kept (they are printed). */
export function parseCbeta(file) {
  const xml = fs.readFileSync(file, 'utf8'), bodyAt = xml.indexOf('<body'), out = {};
  // The apparatus is stand-off: <app from="#beg…" to="#end…"> in <back>. A <lem> witnessed by #wit.cbeta is CBETA's own declared change to the print.
  const opens = new Set(), shuts = new Set();
  for (const m of xml.matchAll(/<app\s+from="#([^"]+)"\s+to="#([^"]+)"[^>]*>\s*<lem\s+([^>]*)>/g)) if (m[3].includes('#wit.cbeta')) { opens.add(m[1]); shuts.add(m[2]); }
  const toks = xml.slice(bodyAt).matchAll(/<(\/?)([\w:.-]+)((?:\s+[\w:.-]+="[^"]*")*)\s*(\/?)>|([^<]+)/g);
  let lb = null, skip = 0; const stack = []; let changed = 0;
  const push = (c, ch) => { if (!lb) return; const p = lb.slice(0, 4); (out[p] ||= { chars: [] }).chars.push({ c, lb, changed: !!ch }); };
  for (const m of toks) {
    const [, close, name, attrs = '', self, text] = m;
    if (text != null) { if (!skip) for (const c of text.normalize('NFC')) if (HAN.test(c)) push(c, changed); continue; }
    if (name === 'back') break;
    if (name === 'lb' && !close) { if (/ed="T"/.test(attrs)) lb = (attrs.match(/n="([^"]+)"/) || [])[1] || lb; continue; }
    if (name === 'g' && !close) { if (!skip) push('〇', changed); if (self) continue; }
    if (name === 'anchor') { const id = (attrs.match(/xml:id="([^"]+)"/) || [])[1]; if (opens.has(id)) changed++; if (shuts.has(id)) changed = Math.max(0, changed - 1); continue; }
    const drop = name === 'rdg' || name === 'sic' || name === 'orig' || name === 'teiHeader' || name === 'cb:mulu' || name === 'cb:docNumber' || (name === 'note' && !/place="inline/.test(attrs));
    const marks = name === 'corr' || name === 'reg';
    if (self) continue;
    if (!close) { stack.push({ name, drop, marks }); if (drop) skip++; if (marks) changed++; }
    else { let e; while (stack.length && (e = stack.pop())) { if (e.drop) skip--; if (e.marks) changed--; if (e.name === name) break; } }
  }
  return out;
}
