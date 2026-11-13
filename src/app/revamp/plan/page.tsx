import fs from 'node:fs';
import path from 'node:path';
import type { ReactNode } from 'react';

// The go-live plan, read from _docs/go-live-plan.md so the document and the page cannot drift.
// A small renderer for the markdown it uses: headings, paragraphs, lists, tables, **bold**.

const inline = (t: string): ReactNode[] => t.split(/(\*\*[^*]+\*\*)/g).map((p, i) => (p.startsWith('**') ? <strong key={i} className="font-semibold text-primary">{p.slice(2, -2)}</strong> : p));

function render(md: string) {
  const lines = md.split('\n');
  const out: ReactNode[] = [];
  let i = 0;
  while (i < lines.length) {
    const l = lines[i];
    if (!l.trim()) { i++; continue; }
    if (l.startsWith('# ')) { out.push(<h1 key={i} className="font-display text-4xl md:text-5xl text-primary mb-4">{l.slice(2)}</h1>); i++; continue; }
    if (l.startsWith('## ')) { out.push(<h2 key={i} className="font-display text-2xl md:text-3xl text-primary mt-12 mb-4 pt-8 border-t border-border-light">{l.slice(3)}</h2>); i++; continue; }
    if (l.startsWith('|')) {
      const rows: string[][] = [];
      while (i < lines.length && lines[i].startsWith('|')) { if (!/^\|[-| ]+\|$/.test(lines[i])) rows.push(lines[i].slice(1, -1).split('|').map((c) => c.trim())); i++; }
      const [head, ...body] = rows;
      out.push(<table key={`t${i}`} className="my-5 text-[15px]"><thead><tr>{head.map((c) => <th key={c} className="text-left font-medium text-muted pr-8 pb-1.5 border-b border-border-light">{c}</th>)}</tr></thead>
        <tbody>{body.map((r, k) => <tr key={k}>{r.map((c, j) => <td key={j} className={`pr-8 py-1 border-b border-border-light ${j ? 'tabular-nums' : ''}`}>{inline(c)}</td>)}</tr>)}</tbody></table>);
      continue;
    }
    if (/^(- |\d+\. )/.test(l)) {
      const ordered = /^\d+\. /.test(l);
      const items: string[] = [];
      while (i < lines.length && /^(- |\d+\. )/.test(lines[i])) { items.push(lines[i].replace(/^(- |\d+\. )/, '')); i++; }
      const cls = 'my-4 pl-6 space-y-2 text-[16px] text-secondary leading-relaxed';
      out.push(ordered ? <ol key={`l${i}`} className={`${cls} list-decimal`}>{items.map((x, k) => <li key={k}>{inline(x)}</li>)}</ol>
        : <ul key={`l${i}`} className={`${cls} list-disc`}>{items.map((x, k) => <li key={k}>{inline(x)}</li>)}</ul>);
      continue;
    }
    out.push(<p key={i} className="my-4 text-[16px] text-secondary leading-relaxed max-w-3xl">{inline(l)}</p>);
    i++;
  }
  return out;
}

export default function Page() {
  const md = fs.readFileSync(path.join(process.cwd(), 'src/app/revamp/_docs/go-live-plan.md'), 'utf8');
  return <main className="bg-cream min-h-screen"><div className="max-w-[900px] mx-auto px-6 md:px-10 py-14 pb-24">{render(md)}</div></main>;
}
