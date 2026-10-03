'use client';

import { FONTS } from './fonts';
import { shortAuthor, shortTitle, yearOf } from './layers';
import {
  H, W,
  type Blend, type Finish, type FontKey, type Layer, type Materials, type ShapeKind, type Texture, type Treatment,
} from './types';

/** Settings for the selected layer. Every control writes straight to the layer. */

type Patch = (patch: Partial<Layer>, commit?: boolean) => void;

const FINISHES: { v: Finish; label: string }[] = [
  { v: 'gilt', label: 'Gilt' },
  { v: 'silver', label: 'Silver' },
  { v: 'foil', label: 'Foil' },
  { v: 'blind', label: 'Blind' },
  { v: 'ink', label: 'Ink' },
];

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1 text-sm">
      <span className="text-[var(--text-muted)]">{label}</span>
      {children}
    </label>
  );
}

function Slider({ label, value, min, max, step = 0.01, onChange, onCommit, format }: {
  label: string; value: number; min: number; max: number; step?: number;
  onChange: (v: number) => void; onCommit: () => void; format?: (v: number) => string;
}) {
  return (
    <Row label={`${label} · ${format ? format(value) : Math.round(value * 100) / 100}`}>
      <input
        type="range" min={min} max={max} step={step} value={value}
        onChange={e => onChange(parseFloat(e.target.value))}
        onPointerUp={onCommit} onKeyUp={onCommit}
        className="w-full accent-[var(--accent-rust)]"
      />
    </Row>
  );
}

function Segments<T extends string>({ value, options, onChange }: { value: T; options: { v: T; label: string }[]; onChange: (v: T) => void }) {
  return (
    <div className="flex flex-wrap gap-1">
      {options.map(o => (
        <button
          key={o.v}
          type="button"
          onClick={() => onChange(o.v)}
          className={`px-2.5 py-1 rounded text-sm border ${value === o.v ? 'bg-[var(--text-primary)] text-[var(--bg-cream)] border-[var(--text-primary)]' : 'border-[var(--border-medium)] hover:bg-[var(--bg-warm)]'}`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

function Colour({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <input type="color" value={value} onChange={e => onChange(e.target.value)} className="h-9 w-16 rounded border border-[var(--border-medium)] bg-transparent" />
  );
}

export function Inspector({ layer, materials, patch, onCrop, onCropInPlace, onFillBoard }: {
  layer: Layer;
  materials: Materials;
  patch: Patch;
  onCrop: () => void;
  onCropInPlace: () => void;
  onFillBoard: () => void;
}) {
  const live = (k: string) => (v: number) => patch({ [k]: v } as Partial<Layer>, false);
  const commit = () => patch({}, true);
  const common = (
    <>
      <Slider label="Opacity" value={layer.opacity} min={0} max={1} onChange={live('opacity')} onCommit={commit} format={v => `${Math.round(v * 100)}%`} />
      <Row label="Blend">
        <select className="cm-input" value={layer.blend} onChange={e => patch({ blend: e.target.value as Blend })}>
          <option value="normal">Normal</option>
          <option value="multiply">Multiply (paper drops out)</option>
          <option value="screen">Screen</option>
          <option value="overlay">Overlay</option>
          <option value="soft-light">Soft light</option>
        </select>
      </Row>
      {layer.kind !== 'fill' && (
        <Slider label="Rotation" value={layer.rot} min={-180} max={180} step={1} onChange={live('rot')} onCommit={commit} format={v => `${Math.round(v)}°`} />
      )}
    </>
  );

  if (layer.kind === 'image') {
    const stamped = layer.treatment !== 'photo';
    return (
      <div className="flex flex-col gap-3">
        <div className="flex flex-wrap gap-2">
          <button className="cm-btn" onClick={onCropInPlace}>Crop on the cover</button>
          <button className="cm-btn" onClick={onCrop}>Choose from page {layer.page ?? ''}</button>
          <button className="cm-btn" onClick={onFillBoard}>Fill the board</button>
        </div>
        <Row label="Treatment">
          <Segments<Treatment>
            value={layer.treatment}
            options={[{ v: 'photo', label: 'Scan' }, ...FINISHES]}
            onChange={v => patch({ treatment: v })}
          />
        </Row>
        {stamped ? (
          <>
            <Slider label="Ink threshold" value={layer.threshold} min={0.05} max={0.95} onChange={live('threshold')} onCommit={commit} />
            <Slider label="Softness" value={layer.softness} min={0} max={0.5} onChange={live('softness')} onCommit={commit} />
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={layer.invert} onChange={e => patch({ invert: e.target.checked })} />
              Light marks on dark ground
            </label>
            {layer.treatment !== 'ink' && <Slider label="Impression depth" value={layer.depth} min={0} max={6} step={0.25} onChange={live('depth')} onCommit={commit} />}
            {(layer.treatment === 'ink' || layer.treatment === 'foil') && <Row label="Colour"><Colour value={layer.color} onChange={v => patch({ color: v })} /></Row>}
          </>
        ) : (
          <>
            <Slider label="Brightness" value={layer.brightness} min={-0.5} max={0.5} onChange={live('brightness')} onCommit={commit} />
            <Slider label="Contrast" value={layer.contrast} min={-0.8} max={0.8} onChange={live('contrast')} onCommit={commit} />
            <Slider label="Colour" value={layer.saturation} min={-1} max={1} onChange={live('saturation')} onCommit={commit} />
          </>
        )}
        <Slider label="Width" value={layer.w} min={40} max={W * 1.6} step={1} onChange={v => patch({ w: v, h: (layer.h * v) / layer.w }, false)} onCommit={commit} format={v => `${Math.round((v / W) * 100)}%`} />
        {common}
      </div>
    );
  }

  if (layer.kind === 'text') {
    const b = materials.book;
    const presets: { label: string; text: string }[] = [
      { label: 'Short title', text: shortTitle(b.title) },
      { label: 'Full title', text: b.title },
      ...(b.display_title && b.display_title !== b.title ? [{ label: 'English title', text: b.display_title }] : []),
      { label: 'Author', text: shortAuthor(b.author) },
      { label: 'Year', text: yearOf(b.published) },
      ...(b.place || b.publisher ? [{ label: 'Place & printer', text: [b.place, b.publisher, yearOf(b.published)].filter(Boolean).join(' · ') }] : []),
    ];
    return (
      <div className="flex flex-col gap-3">
        <Row label="Text">
          <textarea className="cm-input min-h-[84px]" value={layer.text} onChange={e => patch({ text: e.target.value, name: e.target.value.split('\n')[0].slice(0, 28) || 'Text' }, false)} onBlur={commit} />
        </Row>
        <div className="flex flex-wrap gap-1">
          {presets.map(p => (
            <button key={p.label} className="cm-chip" onClick={() => patch({ text: p.text, name: p.label })}>{p.label}</button>
          ))}
        </div>
        <Row label="Typeface">
          <select className="cm-input" value={layer.font} onChange={e => { const font = e.target.value as FontKey; patch(font === 'fraktur' ? { font, caps: false, tracking: 0 } : { font }); }}>
            {(Object.keys(FONTS) as FontKey[]).map(k => <option key={k} value={k}>{FONTS[k].label}</option>)}
          </select>
        </Row>
        <div className="flex flex-wrap gap-3 text-sm">
          {FONTS[layer.font].bold && (
            <label className="flex items-center gap-1.5"><input type="checkbox" checked={layer.weight === 700} onChange={e => patch({ weight: e.target.checked ? 700 : 400 })} /> Bold</label>
          )}
          <label className="flex items-center gap-1.5"><input type="checkbox" checked={layer.italic} onChange={e => patch({ italic: e.target.checked })} /> Italic</label>
          <label className="flex items-center gap-1.5"><input type="checkbox" checked={layer.caps} onChange={e => patch({ caps: e.target.checked })} /> Capitals</label>
        </div>
        <Segments value={layer.align} options={[{ v: 'left', label: 'Left' }, { v: 'center', label: 'Centre' }, { v: 'right', label: 'Right' }]} onChange={v => patch({ align: v })} />
        <Slider label="Size" value={layer.size} min={10} max={220} step={1} onChange={live('size')} onCommit={commit} format={v => `${Math.round(v)}`} />
        <Slider label="Letter spacing" value={layer.tracking} min={-0.05} max={0.6} onChange={live('tracking')} onCommit={commit} />
        <Slider label="Line spacing" value={layer.leading} min={0.8} max={2} onChange={live('leading')} onCommit={commit} />
        <Slider label="Measure" value={layer.w} min={60} max={W} step={1} onChange={live('w')} onCommit={commit} format={v => `${Math.round((v / W) * 100)}%`} />
        <Row label="Finish">
          <Segments value={layer.finish} options={FINISHES} onChange={v => patch({ finish: v })} />
        </Row>
        {(layer.finish === 'ink' || layer.finish === 'foil') && <Row label="Colour"><Colour value={layer.color} onChange={v => patch({ color: v })} /></Row>}
        {layer.finish !== 'ink' && <Slider label="Impression depth" value={layer.depth} min={0} max={6} step={0.25} onChange={live('depth')} onCommit={commit} />}
        {common}
      </div>
    );
  }

  if (layer.kind === 'shape') {
    const shapes: { v: ShapeKind; label: string }[] = [
      { v: 'frame', label: 'Frame' }, { v: 'double-frame', label: 'Double' }, { v: 'rule', label: 'Rule' },
      { v: 'oval', label: 'Oval' }, { v: 'panel', label: 'Sunk panel' }, { v: 'label', label: 'Label' },
    ];
    return (
      <div className="flex flex-col gap-3">
        <Segments value={layer.shape} options={shapes} onChange={v => patch({ shape: v })} />
        {layer.shape !== 'panel' && (
          <Row label="Finish"><Segments value={layer.finish} options={FINISHES} onChange={v => patch({ finish: v })} /></Row>
        )}
        {(layer.finish === 'ink' || layer.finish === 'foil') && layer.shape !== 'panel' && <Row label="Colour"><Colour value={layer.color} onChange={v => patch({ color: v })} /></Row>}
        {['frame', 'double-frame', 'oval'].includes(layer.shape) && (
          <Slider label="Line weight" value={layer.stroke} min={1} max={30} step={0.5} onChange={live('stroke')} onCommit={commit} />
        )}
        <Slider label="Width" value={layer.w} min={4} max={W} step={1} onChange={live('w')} onCommit={commit} format={v => `${Math.round(v)}`} />
        <Slider label="Height" value={layer.h} min={2} max={H} step={1} onChange={live('h')} onCommit={commit} format={v => `${Math.round(v)}`} />
        <Slider label="Impression depth" value={layer.depth} min={0} max={8} step={0.25} onChange={live('depth')} onCommit={commit} />
        {common}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <Row label="Colour"><Colour value={layer.color} onChange={v => patch({ color: v })} /></Row>
      <Row label="Surface">
        <Segments<Texture> value={layer.texture} options={[{ v: 'none', label: 'Flat' }, { v: 'cloth', label: 'Cloth' }, { v: 'leather', label: 'Leather' }, { v: 'paper', label: 'Paper' }]} onChange={v => patch({ texture: v })} />
      </Row>
      <Row label="Covers">
        <Segments value={layer.region} options={[{ v: 'all', label: 'Whole board' }, { v: 'spine', label: 'Spine edge' }, { v: 'corners', label: 'Corners' }]} onChange={v => patch({ region: v })} />
      </Row>
      {common}
    </div>
  );
}
