'use client';

// Download one Pareto figure for slides (#5983). The figure to save is a self-contained SVG the
// server already rendered (hidden next to the visible chart, with its title, key and notes), so this
// only serialises it; the PNG is that SVG drawn onto a canvas at 2× on white.

function svgMarkup(id: string): string | null {
  const el = document.getElementById(id);
  if (!el) return null;
  const s = new XMLSerializer().serializeToString(el);
  return s.includes('xmlns="http://www.w3.org/2000/svg"') ? s : s.replace('<svg', '<svg xmlns="http://www.w3.org/2000/svg"');
}

function save(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function downloadSvg(id: string, name: string) {
  const s = svgMarkup(id);
  if (s) save(new Blob([s], { type: 'image/svg+xml;charset=utf-8' }), `${name}.svg`);
}

function downloadPng(id: string, name: string) {
  const s = svgMarkup(id);
  const el = document.getElementById(id);
  if (!s || !el) return;
  const w = Number(el.getAttribute('width')), h = Number(el.getAttribute('height'));
  const img = new Image();
  const url = URL.createObjectURL(new Blob([s], { type: 'image/svg+xml;charset=utf-8' }));
  img.onload = () => {
    const scale = 2;
    const canvas = document.createElement('canvas');
    canvas.width = w * scale;
    canvas.height = h * scale;
    const ctx = canvas.getContext('2d')!;
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    URL.revokeObjectURL(url);
    canvas.toBlob(b => b && save(b, `${name}.png`), 'image/png');
  };
  img.src = url;
}

export default function ParetoDownload({ svgId, name }: { svgId: string; name: string }) {
  const btn = 'underline decoration-stone-400 underline-offset-2 hover:text-amber-800 hover:decoration-amber-800';
  return (
    <span className="whitespace-nowrap">
      Download{' '}
      <button type="button" className={btn} onClick={() => downloadSvg(svgId, name)}>SVG</button>
      {' · '}
      <button type="button" className={btn} onClick={() => downloadPng(svgId, name)}>PNG</button>
    </span>
  );
}
