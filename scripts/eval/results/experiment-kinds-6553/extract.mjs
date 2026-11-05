import fs from 'fs'; import path from 'path';
const dir = process.argv[2]; const out = [];
for (const f of fs.readdirSync(dir).filter(f=>/^20\d\d-\d\d-\d\d-.*\.md$/.test(f)).sort()) {
  const t = fs.readFileSync(path.join(dir,f),'utf8');
  let header = '', body = t;
  if (t.startsWith('---\n')) { const e = t.indexOf('\n---', 4); header = t.slice(4,e).trim(); body = t.slice(e+4); }
  const hfield = k => { const m = header.match(new RegExp('^'+k+':\\s*(.*)$','m')); return m? m[1].replace(/^"|"$/g,'').trim() : null; };
  const heading = (body.match(/^## .*$/m)||[''])[0];
  const b = body.replace(/^PRIOR ART:.*$/m,'').replace(/^## .*$/m,'').replace(/\n{2,}/g,'\n').trim();
  const words = b.split(/\s+/);
  const lead = words.slice(0,180).join(' ');
  const declines = b.split('\n').filter(l=>/decision|decid|adopt|therefore|next step|so we|changed|ships|merged|PR #/i.test(l)).slice(0,4).map(l=>l.slice(0,300)).join(' | ');
  out.push({file:f, date:f.slice(0,10), stage:hfield('stage'), measure:hfield('measure'), status:hfield('status'), verdict:hfield('verdict'), decision:hfield('decision'), issue:hfield('issue'), has_header: !!header, heading, lead, decision_lines: declines, words: words.length});
}
fs.writeFileSync(process.argv[3], out.map(o=>JSON.stringify(o)).join('\n')+'\n');
console.log(out.length, 'no header:', out.filter(o=>!o.has_header).length);
