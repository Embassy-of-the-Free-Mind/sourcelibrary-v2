'use client';

import { useEffect, useRef } from 'react';

/* Shared canvas setup: device-pixel-ratio aware, redraws on resize. `draw`
   must be a stable module-level reference so the effect does not re-run. */
function useCanvas(
  draw: (ctx: CanvasRenderingContext2D, w: number, h: number) => void,
) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const cv = ref.current;
    if (!cv) return;
    const render = () => {
      const rect = cv.getBoundingClientRect();
      if (rect.width === 0) return;
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      cv.width = Math.round(rect.width * dpr);
      cv.height = Math.round(rect.height * dpr);
      const ctx = cv.getContext('2d');
      if (!ctx) return;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      draw(ctx, rect.width, rect.height);
    };
    render();
    let t: ReturnType<typeof setTimeout>;
    const onResize = () => {
      clearTimeout(t);
      t = setTimeout(render, 150);
    };
    window.addEventListener('resize', onResize);
    return () => {
      window.removeEventListener('resize', onResize);
      clearTimeout(t);
    };
  }, [draw]);
  return ref;
}

function Panel({
  height,
  caption,
  render,
  label,
}: {
  height: number;
  caption: React.ReactNode;
  render: (ctx: CanvasRenderingContext2D, w: number, h: number) => void;
  label: string;
}) {
  const ref = useCanvas(render);
  return (
    <figure className="my-12">
      <div className="rounded-lg overflow-hidden shadow-md border border-stone-200" style={{ background: '#0A0C11' }}>
        <canvas ref={ref} aria-label={label} role="img" className="block w-full" style={{ height }} />
      </div>
      <figcaption className="text-center text-sm text-muted mt-3 italic">{caption}</figcaption>
    </figure>
  );
}

/* ---- Hydrogen Balmer spectrum ---- */
function wl2rgb(wl: number): string {
  let r = 0, g = 0, b = 0;
  if (wl < 440) { r = -(wl - 440) / 60; b = 1; }
  else if (wl < 490) { g = (wl - 440) / 50; b = 1; }
  else if (wl < 510) { g = 1; b = -(wl - 510) / 20; }
  else if (wl < 580) { r = (wl - 510) / 70; g = 1; }
  else if (wl < 645) { r = 1; g = -(wl - 645) / 65; }
  else { r = 1; }
  const f = wl < 420 ? 0.35 + (0.65 * (wl - 380)) / 40 : wl > 700 ? 0.35 + (0.65 * (780 - wl)) / 80 : 1;
  return `rgb(${Math.round(255 * r * f)},${Math.round(255 * g * f)},${Math.round(255 * b * f)})`;
}
function drawBalmer(x: CanvasRenderingContext2D, W: number, H: number) {
  x.fillStyle = '#050608';
  x.fillRect(0, 0, W, H);
  const pad = 32, y0 = 14, y1 = H - 34, minW = 398, maxW = 670;
  const lines = [656.3, 486.1, 434.0, 410.2];
  for (const w of lines) {
    const px = pad + ((w - minW) / (maxW - minW)) * (W - 2 * pad);
    const col = wl2rgb(w);
    x.globalAlpha = 0.28; x.strokeStyle = col; x.lineWidth = 6;
    x.beginPath(); x.moveTo(px, y0); x.lineTo(px, y1); x.stroke();
    x.globalAlpha = 1; x.lineWidth = 1.7;
    x.beginPath(); x.moveTo(px, y0); x.lineTo(px, y1); x.stroke();
    x.fillStyle = '#9AA0A8'; x.font = '10px ui-monospace,Menlo,monospace'; x.textAlign = 'center';
    x.fillText(`${Math.round(w)} nm`, px, H - 12);
  }
  x.strokeStyle = 'rgba(255,255,255,.12)'; x.lineWidth = 1;
  x.beginPath(); x.moveTo(pad, y1 + 4); x.lineTo(W - pad, y1 + 4); x.stroke();
}

/* ---- Chladni figure (nodal pattern of a vibrating plate, mode 4:3) ---- */
function drawChladni(x: CanvasRenderingContext2D, W: number, H: number) {
  x.fillStyle = '#070809';
  x.fillRect(0, 0, W, H);
  const m = Math.min(W, H) - 26, ox = (W - m) / 2, oy = (H - m) / 2, n = 4, q = 3, st = 2;
  x.strokeStyle = 'rgba(203,168,91,.25)'; x.lineWidth = 1; x.strokeRect(ox, oy, m, m);
  for (let py = 0; py < m; py += st) {
    for (let px = 0; px < m; px += st) {
      const xx = px / m, yy = py / m;
      const u = Math.cos(n * Math.PI * xx) * Math.cos(q * Math.PI * yy) - Math.cos(q * Math.PI * xx) * Math.cos(n * Math.PI * yy);
      if (Math.abs(u) < 0.05) { x.fillStyle = 'rgba(232,224,198,.55)'; x.fillRect(ox + px, oy + py, 1.6, 1.6); }
    }
  }
  x.fillStyle = '#8A8E93'; x.font = '10px ui-monospace,Menlo,monospace'; x.textAlign = 'left';
  x.fillText('vibrating plate — mode 4 : 3', ox + 2, oy + m + 15);
}

/* ---- Arnold tongues (mode-locking of coupled oscillators at rational ratios) ---- */
function drawArnold(x: CanvasRenderingContext2D, W: number, H: number) {
  x.fillStyle = '#070809';
  x.fillRect(0, 0, W, H);
  const padL = 40, padR = 16, padT = 16, padB = 32, pw = W - padL - padR, ph = H - padT - padB;
  const rats: [number, number][] = [[0, 1], [1, 5], [1, 4], [1, 3], [2, 5], [1, 2], [3, 5], [2, 3], [3, 4], [4, 5], [1, 1]];
  for (const [p, q] of rats) {
    const v = p / q, cx = padL + v * pw, hw = (pw * 0.17) / Math.pow(q, 1.35);
    const g = x.createLinearGradient(0, padT, 0, padT + ph);
    g.addColorStop(0, 'rgba(95,176,164,.55)');
    g.addColorStop(1, 'rgba(95,176,164,.04)');
    x.fillStyle = g;
    x.beginPath();
    x.moveTo(cx, padT + ph); x.lineTo(cx - hw, padT); x.lineTo(cx + hw, padT); x.closePath(); x.fill();
    x.strokeStyle = 'rgba(95,176,164,.4)'; x.lineWidth = 1; x.stroke();
  }
  x.strokeStyle = 'rgba(255,255,255,.15)'; x.lineWidth = 1;
  x.beginPath(); x.moveTo(padL, padT + ph); x.lineTo(padL + pw, padT + ph); x.moveTo(padL, padT); x.lineTo(padL, padT + ph); x.stroke();
  x.fillStyle = '#9AA0A8'; x.font = '10px ui-monospace,Menlo,monospace'; x.textAlign = 'center';
  const labs: [number, number, string][] = [[0, 1, '0'], [1, 3, '1/3'], [1, 2, '1/2'], [2, 3, '2/3'], [3, 4, '3/4'], [1, 1, '1']];
  for (const [a, b, s] of labs) { x.fillText(s, padL + (a / b) * pw, padT + ph + 16); }
  x.fillStyle = '#7C808A'; x.fillText('frequency ratio (lock points)', padL + pw / 2, H - 5);
  x.save(); x.translate(12, padT + ph / 2); x.rotate(-Math.PI / 2); x.textAlign = 'center';
  x.fillText('coupling strength', 0, 0); x.restore();
}

export function BalmerSpectrum() {
  return (
    <Panel
      height={150}
      label="The hydrogen Balmer spectrum: four bright emission lines on a dark field."
      render={drawBalmer}
      caption={
        <>
          <b className="not-italic text-secondary">Matter&apos;s discrete tones.</b> The hydrogen Balmer series — the only
          visible wavelengths a hydrogen atom is permitted to emit, fixed by whole-number quantum states. Integer arithmetic,
          made visible in light.
        </>
      }
    />
  );
}

export function ChladniFigure() {
  return (
    <Panel
      height={320}
      label="A Chladni figure: sand settling into the nodal lines of a vibrating square plate."
      render={drawChladni}
      caption={
        <>
          <b className="not-italic text-secondary">Sand finds the nodes.</b> A Chladni figure: a bounded plate rings only in
          whole-number modes, and scattered sand collects where the plate holds still. Confinement turns a continuous medium
          into integer harmonics — the same reason the atom has discrete tones.
        </>
      }
    />
  );
}

export function ArnoldTongues() {
  return (
    <Panel
      height={300}
      label="Arnold tongues: wedge-shaped locking regions rising from simple rational frequency ratios."
      render={drawArnold}
      caption={
        <>
          <b className="not-italic text-secondary">Where a law could live.</b> Arnold tongues: two coupled oscillators lock
          together only at simple rational ratios, and the simplest ratios lock over the widest range of conditions. If
          human–AI coupling has a law of harmony, this is the shape it would take — and, unlike a metaphor, the tongue is
          measurable.
        </>
      }
    />
  );
}
