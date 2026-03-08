'use client';

import { useEffect, useRef, useState, useCallback } from 'react';

interface Node {
  id: string;
  count: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
  domain: 'alchemy' | 'hermetic' | 'theology' | 'philosophy';
}

interface Link {
  source: string;
  target: string;
  weight: number;
}

const DOMAIN_COLORS: Record<string, string> = {
  alchemy: '#9e4a3a',
  hermetic: '#7c5db5',
  theology: '#c9a86c',
  philosophy: '#8b9a7d',
};

const DOMAIN_LABELS: Record<string, string> = {
  alchemy: 'Alchemical Operations',
  hermetic: 'Hermetic & Esoteric',
  theology: 'Theological',
  philosophy: 'Natural Philosophy',
};

const ALCHEMY_SET = new Set([
  'Putrefaction', 'Calcination', 'Tincture', 'Sublimation', 'Projection',
  'Quintessence', 'Transmutation', 'Fixation', 'Multiplication', 'Potable Gold',
  'Elixir', 'Decoction', 'Coagulation', 'Spirit of Wine', 'Distillation',
  'Vitriol', 'Radical moisture',
]);

const THEOLOGY_SET = new Set([
  'Divine Providence', 'Providence', 'Idolatry', 'Transubstantiation',
  'Martyrdom', 'Apostasy', 'Antichrist', 'Original Sin', 'Free Will',
  'Excommunication', 'Simony', 'Heresy', 'Inquisition',
]);

const PHILOSOPHY_SET = new Set([
  'Astrology', 'Physiognomy', 'Humors', 'Natural Law', 'Philology',
]);

function getDomain(id: string): Node['domain'] {
  if (ALCHEMY_SET.has(id)) return 'alchemy';
  if (THEOLOGY_SET.has(id)) return 'theology';
  if (PHILOSOPHY_SET.has(id)) return 'philosophy';
  return 'hermetic';
}

const RAW_NODES = [
  { id: 'Hermetic Philosophy', count: 80 }, { id: 'Putrefaction', count: 77 },
  { id: 'Calcination', count: 71 }, { id: 'Tincture', count: 60 },
  { id: 'Sublimation', count: 58 }, { id: "Philosopher's Stone", count: 58 },
  { id: 'Divine Providence', count: 43 }, { id: 'Kabbalah', count: 39 },
  { id: 'Microcosm', count: 36 }, { id: 'Providence', count: 35 },
  { id: 'Projection', count: 33 }, { id: 'Quintessence', count: 33 },
  { id: 'Transmutation', count: 30 }, { id: 'Fixation', count: 29 },
  { id: 'Universal Medicine', count: 29 }, { id: 'Multiplication', count: 27 },
  { id: 'Idolatry', count: 26 }, { id: 'Transubstantiation', count: 25 },
  { id: 'Tetragrammaton', count: 24 }, { id: 'Martyrdom', count: 24 },
  { id: 'Potable Gold', count: 23 }, { id: 'Physiognomy', count: 21 },
  { id: 'Chaos', count: 21 }, { id: 'Apostasy', count: 20 },
  { id: 'Light of Nature', count: 18 }, { id: 'Alchemy', count: 18 },
  { id: 'Inquisition', count: 17 }, { id: 'Elixir', count: 17 },
  { id: 'Heresy', count: 16 }, { id: 'Decoction', count: 16 },
  { id: 'Rosicrucianism', count: 16 }, { id: 'Antichrist', count: 16 },
  { id: 'Astrology', count: 15 }, { id: 'Pelican in her piety', count: 15 },
  { id: 'Hieroglyphics', count: 15 }, { id: 'Excommunication', count: 15 },
  { id: 'Simony', count: 15 }, { id: 'Natural Magic', count: 15 },
  { id: 'Coagulation', count: 15 }, { id: 'Spirit of Wine', count: 14 },
  { id: 'Natural Law', count: 14 }, { id: 'Macrocosm and Microcosm', count: 14 },
  { id: 'Theurgy', count: 14 }, { id: 'Radical moisture', count: 14 },
  { id: 'Free Will', count: 14 }, { id: 'Distillation', count: 14 },
  { id: 'Philology', count: 14 }, { id: 'Original Sin', count: 14 },
  { id: 'Vitriol', count: 13 }, { id: 'Humors', count: 13 },
];

const LINKS: Link[] = [
  { source: 'Calcination', target: 'Sublimation', weight: 41 },
  { source: 'Calcination', target: 'Putrefaction', weight: 32 },
  { source: 'Putrefaction', target: 'Sublimation', weight: 28 },
  { source: 'Putrefaction', target: 'Tincture', weight: 27 },
  { source: 'Calcination', target: 'Tincture', weight: 26 },
  { source: 'Sublimation', target: 'Tincture', weight: 24 },
  { source: 'Fixation', target: 'Sublimation', weight: 21 },
  { source: 'Projection', target: 'Sublimation', weight: 21 },
  { source: 'Projection', target: 'Putrefaction', weight: 20 },
  { source: 'Projection', target: 'Tincture', weight: 19 },
  { source: 'Calcination', target: 'Fixation', weight: 18 },
  { source: 'Calcination', target: 'Projection', weight: 17 },
  { source: 'Fixation', target: 'Putrefaction', weight: 16 },
  { source: "Philosopher's Stone", target: 'Putrefaction', weight: 16 },
  { source: 'Fixation', target: 'Tincture', weight: 16 },
  { source: "Philosopher's Stone", target: 'Tincture', weight: 16 },
  { source: 'Calcination', target: 'Quintessence', weight: 15 },
  { source: 'Calcination', target: 'Potable Gold', weight: 14 },
  { source: 'Calcination', target: "Philosopher's Stone", weight: 14 },
  { source: 'Multiplication', target: 'Tincture', weight: 14 },
  { source: 'Elixir', target: 'Sublimation', weight: 13 },
  { source: 'Multiplication', target: 'Putrefaction', weight: 13 },
  { source: 'Hermetic Philosophy', target: 'Pelican in her piety', weight: 12 },
  { source: 'Divine Providence', target: 'Providence', weight: 12 },
  { source: 'Potable Gold', target: 'Putrefaction', weight: 12 },
  { source: 'Calcination', target: 'Multiplication', weight: 12 },
  { source: "Philosopher's Stone", target: 'Transmutation', weight: 12 },
  { source: 'Sublimation', target: 'Transmutation', weight: 12 },
  { source: 'Calcination', target: 'Transmutation', weight: 11 },
  { source: 'Multiplication', target: 'Projection', weight: 11 },
  { source: 'Multiplication', target: 'Sublimation', weight: 11 },
  { source: 'Calcination', target: 'Elixir', weight: 11 },
  { source: "Philosopher's Stone", target: 'Sublimation', weight: 11 },
  { source: 'Putrefaction', target: 'Transmutation', weight: 11 },
  { source: "Philosopher's Stone", target: 'Universal Medicine', weight: 11 },
  { source: 'Tincture', target: 'Universal Medicine', weight: 11 },
  { source: 'Putrefaction', target: 'Universal Medicine', weight: 11 },
  { source: 'Quintessence', target: 'Sublimation', weight: 10 },
  { source: 'Fixation', target: 'Projection', weight: 10 },
  { source: 'Elixir', target: 'Putrefaction', weight: 10 },
  { source: 'Elixir', target: 'Tincture', weight: 10 },
  { source: 'Tincture', target: 'Transmutation', weight: 10 },
  { source: 'Calcination', target: 'Spirit of Wine', weight: 9 },
  { source: 'Putrefaction', target: 'Quintessence', weight: 9 },
  { source: 'Fixation', target: 'Multiplication', weight: 9 },
  { source: "Philosopher's Stone", target: 'Projection', weight: 9 },
  { source: 'Calcination', target: 'Distillation', weight: 8 },
  { source: 'Calcination', target: 'Coagulation', weight: 8 },
  { source: 'Coagulation', target: 'Sublimation', weight: 8 },
  { source: 'Quintessence', target: 'Tincture', weight: 8 },
  { source: 'Multiplication', target: 'Quintessence', weight: 7 },
  { source: 'Elixir', target: 'Projection', weight: 7 },
  { source: 'Potable Gold', target: 'Quintessence', weight: 7 },
  { source: 'Elixir', target: 'Fixation', weight: 7 },
  { source: 'Hermetic Philosophy', target: "Philosopher's Stone", weight: 7 },
  { source: 'Coagulation', target: 'Putrefaction', weight: 7 },
  { source: 'Transmutation', target: 'Universal Medicine', weight: 7 },
  { source: "Philosopher's Stone", target: 'Potable Gold', weight: 7 },
  { source: 'Coagulation', target: 'Tincture', weight: 7 },
  { source: 'Projection', target: 'Transmutation', weight: 7 },
  { source: 'Idolatry', target: 'Martyrdom', weight: 7 },
  { source: 'Potable Gold', target: 'Tincture', weight: 7 },
  { source: "Philosopher's Stone", target: 'Quintessence', weight: 7 },
  { source: 'Microcosm', target: 'Putrefaction', weight: 7 },
  { source: 'Decoction', target: 'Putrefaction', weight: 6 },
  { source: 'Projection', target: 'Quintessence', weight: 6 },
  { source: 'Fixation', target: 'Quintessence', weight: 6 },
  { source: 'Quintessence', target: 'Transmutation', weight: 6 },
  { source: 'Elixir', target: 'Multiplication', weight: 6 },
  { source: 'Projection', target: 'Universal Medicine', weight: 6 },
  { source: 'Calcination', target: 'Microcosm', weight: 6 },
  { source: 'Coagulation', target: 'Fixation', weight: 6 },
  { source: 'Hermetic Philosophy', target: 'Rosicrucianism', weight: 6 },
  { source: 'Putrefaction', target: 'Spirit of Wine', weight: 6 },
  { source: 'Elixir', target: 'Transmutation', weight: 6 },
  { source: 'Fixation', target: "Philosopher's Stone", weight: 6 },
  { source: 'Light of Nature', target: 'Microcosm', weight: 5 },
  { source: 'Putrefaction', target: 'Radical moisture', weight: 5 },
  { source: 'Distillation', target: 'Putrefaction', weight: 5 },
  { source: 'Calcination', target: 'Vitriol', weight: 5 },
  { source: 'Sublimation', target: 'Vitriol', weight: 5 },
  { source: 'Distillation', target: 'Sublimation', weight: 5 },
  { source: 'Potable Gold', target: 'Sublimation', weight: 5 },
  { source: 'Microcosm', target: 'Universal Medicine', weight: 5 },
  { source: 'Kabbalah', target: 'Transubstantiation', weight: 5 },
  { source: 'Kabbalah', target: 'Natural Magic', weight: 5 },
  { source: 'Microcosm', target: 'Tincture', weight: 5 },
  { source: 'Alchemy', target: 'Hermetic Philosophy', weight: 5 },
  { source: 'Excommunication', target: 'Simony', weight: 5 },
  { source: "Philosopher's Stone", target: 'Vitriol', weight: 5 },
  { source: 'Hermetic Philosophy', target: 'Universal Medicine', weight: 5 },
  { source: 'Hermetic Philosophy', target: 'Kabbalah', weight: 5 },
  { source: 'Multiplication', target: "Philosopher's Stone", weight: 5 },
  { source: 'Chaos', target: 'Putrefaction', weight: 5 },
  { source: 'Fixation', target: 'Transmutation', weight: 5 },
  { source: 'Heresy', target: 'Inquisition', weight: 4 },
  { source: 'Divine Providence', target: 'Free Will', weight: 4 },
  { source: 'Macrocosm and Microcosm', target: 'Microcosm', weight: 4 },
  { source: 'Kabbalah', target: 'Tetragrammaton', weight: 4 },
  { source: 'Microcosm', target: 'Tetragrammaton', weight: 4 },
  { source: 'Microcosm', target: 'Quintessence', weight: 4 },
  { source: "Philosopher's Stone", target: 'Radical moisture', weight: 4 },
  { source: 'Coagulation', target: "Philosopher's Stone", weight: 4 },
  { source: 'Simony', target: 'Transubstantiation', weight: 4 },
  { source: 'Hermetic Philosophy', target: 'Transmutation', weight: 4 },
  { source: 'Multiplication', target: 'Universal Medicine', weight: 4 },
  { source: 'Martyrdom', target: 'Providence', weight: 4 },
  { source: 'Antichrist', target: 'Simony', weight: 4 },
  { source: 'Multiplication', target: 'Potable Gold', weight: 4 },
  { source: 'Putrefaction', target: 'Vitriol', weight: 4 },
  { source: 'Decoction', target: 'Sublimation', weight: 4 },
  { source: 'Decoction', target: 'Projection', weight: 4 },
  { source: 'Sublimation', target: 'Universal Medicine', weight: 4 },
  { source: 'Hermetic Philosophy', target: 'Tincture', weight: 4 },
  { source: 'Idolatry', target: 'Providence', weight: 4 },
  { source: 'Potable Gold', target: 'Spirit of Wine', weight: 4 },
  { source: 'Tincture', target: 'Vitriol', weight: 4 },
  { source: 'Calcination', target: 'Universal Medicine', weight: 4 },
  { source: 'Distillation', target: "Philosopher's Stone", weight: 4 },
  { source: 'Calcination', target: 'Hermetic Philosophy', weight: 4 },
];

const MAX_WEIGHT = 41;

export default function ConceptGraph() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const nodesRef = useRef<Node[]>([]);
  const [hovered, setHovered] = useState<string | null>(null);
  const [dimensions, setDimensions] = useState({ w: 800, h: 600 });
  const frameRef = useRef(0);
  const animDone = useRef(false);

  // Initialize nodes with random positions
  useEffect(() => {
    const w = Math.min(1100, window.innerWidth - 32);
    const h = Math.min(820, w * 0.75);
    setDimensions({ w, h });

    nodesRef.current = RAW_NODES.map((n) => ({
      ...n,
      domain: getDomain(n.id),
      x: w / 2 + (Math.random() - 0.5) * w * 0.6,
      y: h / 2 + (Math.random() - 0.5) * h * 0.6,
      vx: 0,
      vy: 0,
    }));

    animDone.current = false;
    frameRef.current = 0;
  }, []);

  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const { w, h } = dimensions;
    const dpr = window.devicePixelRatio || 1;

    canvas.width = w * dpr;
    canvas.height = h * dpr;
    ctx.scale(dpr, dpr);

    const nodes = nodesRef.current;
    const nodeMap = new Map(nodes.map((n) => [n.id, n]));

    ctx.clearRect(0, 0, w, h);

    // Draw links
    for (const link of LINKS) {
      const s = nodeMap.get(link.source);
      const t = nodeMap.get(link.target);
      if (!s || !t) continue;
      const alpha = 0.08 + (link.weight / MAX_WEIGHT) * 0.25;
      const isHighlighted =
        hovered && (link.source === hovered || link.target === hovered);
      ctx.beginPath();
      ctx.moveTo(s.x, s.y);
      ctx.lineTo(t.x, t.y);
      ctx.strokeStyle = isHighlighted
        ? `rgba(26,22,18,${alpha * 2.5})`
        : `rgba(26,22,18,${alpha})`;
      ctx.lineWidth = isHighlighted
        ? 1 + (link.weight / MAX_WEIGHT) * 3
        : 0.5 + (link.weight / MAX_WEIGHT) * 1.5;
      ctx.stroke();
    }

    // Draw nodes
    const maxCount = 80;
    for (const node of nodes) {
      const r = 4 + (node.count / maxCount) * 18;
      const isHov = hovered === node.id;
      const isConnected =
        hovered &&
        LINKS.some(
          (l) =>
            (l.source === hovered && l.target === node.id) ||
            (l.target === hovered && l.source === node.id)
        );
      const dimmed = hovered && !isHov && !isConnected;

      ctx.beginPath();
      ctx.arc(node.x, node.y, r, 0, Math.PI * 2);
      ctx.fillStyle = dimmed
        ? `${DOMAIN_COLORS[node.domain]}40`
        : DOMAIN_COLORS[node.domain];
      ctx.fill();

      if (isHov) {
        ctx.strokeStyle = '#1a1612';
        ctx.lineWidth = 2;
        ctx.stroke();
      }

      // Labels for large nodes or hovered
      if (node.count >= 25 || isHov || isConnected) {
        ctx.font = `${isHov ? 'bold ' : ''}${isHov ? 16 : 14}px Inter, system-ui, sans-serif`;
        ctx.textAlign = 'center';
        ctx.fillStyle = dimmed ? '#1a161240' : '#1a1612';
        ctx.fillText(node.id, node.x, node.y - r - 4);
      }
    }
  }, [hovered, dimensions]);

  // Force simulation
  useEffect(() => {
    if (nodesRef.current.length === 0) return;
    let raf: number;

    const simulate = () => {
      const nodes = nodesRef.current;
      const { w, h } = dimensions;
      const nodeMap = new Map(nodes.map((n) => [n.id, n]));
      const frame = frameRef.current;
      const alpha = Math.max(0.01, 1 - frame / 120);

      // Run 3 iterations per frame for faster convergence
      for (let iter = 0; iter < 3; iter++) {
        // Repulsion (all pairs)
        for (let i = 0; i < nodes.length; i++) {
          for (let j = i + 1; j < nodes.length; j++) {
            const a = nodes[i], b = nodes[j];
            let dx = b.x - a.x;
            let dy = b.y - a.y;
            const dist = Math.max(Math.sqrt(dx * dx + dy * dy), 1);
            const force = (2500 * alpha) / (dist * dist);
            dx = (dx / dist) * force;
            dy = (dy / dist) * force;
            a.vx -= dx; a.vy -= dy;
            b.vx += dx; b.vy += dy;
          }
        }

        // Attraction (links)
        for (const link of LINKS) {
          const s = nodeMap.get(link.source);
          const t = nodeMap.get(link.target);
          if (!s || !t) continue;
          const dx = t.x - s.x;
          const dy = t.y - s.y;
          const dist = Math.max(Math.sqrt(dx * dx + dy * dy), 1);
          const strength = (link.weight / MAX_WEIGHT) * 0.12 * alpha;
          const target = 80 + (1 - link.weight / MAX_WEIGHT) * 160;
          const f = (dist - target) * strength;
          const fx = (dx / dist) * f;
          const fy = (dy / dist) * f;
          s.vx += fx; s.vy += fy;
          t.vx -= fx; t.vy -= fy;
        }

        // Centering
        for (const node of nodes) {
          node.vx += (w / 2 - node.x) * 0.003 * alpha;
          node.vy += (h / 2 - node.y) * 0.003 * alpha;
        }

        // Apply velocity with damping
        for (const node of nodes) {
          node.vx *= 0.6;
          node.vy *= 0.6;
          node.x += node.vx;
          node.y += node.vy;
          // Keep in bounds
          const r = 4 + (node.count / 80) * 18;
          node.x = Math.max(r + 20, Math.min(w - r - 20, node.x));
          node.y = Math.max(r + 20, Math.min(h - r - 20, node.y));
        }
      }

      frameRef.current++;
      draw();

      if (frame < 200) {
        raf = requestAnimationFrame(simulate);
      } else {
        animDone.current = true;
        draw();
      }
    };

    raf = requestAnimationFrame(simulate);
    return () => cancelAnimationFrame(raf);
  }, [dimensions, draw]);

  // Redraw on hover change
  useEffect(() => {
    if (animDone.current) draw();
  }, [hovered, draw]);

  const handleMove = useCallback(
    (clientX: number, clientY: number) => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      const rect = canvas.getBoundingClientRect();
      const mx = clientX - rect.left;
      const my = clientY - rect.top;

      let closest: string | null = null;
      let closestDist = 30;
      for (const node of nodesRef.current) {
        const r = 4 + (node.count / 80) * 18;
        const dist = Math.sqrt((mx - node.x) ** 2 + (my - node.y) ** 2);
        if (dist < r + 8 && dist < closestDist) {
          closest = node.id;
          closestDist = dist;
        }
      }
      setHovered(closest);
    },
    []
  );

  return (
    <div className="my-8">
      <div className="relative bg-[#fdfcf9] border border-[#e8e4dc] rounded-lg overflow-hidden">
        <canvas
          ref={canvasRef}
          style={{ width: dimensions.w, height: dimensions.h, cursor: hovered ? 'pointer' : 'default' }}
          onMouseMove={(e) => handleMove(e.clientX, e.clientY)}
          onTouchMove={(e) => {
            const t = e.touches[0];
            if (t) handleMove(t.clientX, t.clientY);
          }}
          onMouseLeave={() => setHovered(null)}
        />
        {hovered && (
          <div className="absolute top-3 right-3 bg-white/90 backdrop-blur-sm rounded px-3 py-2 text-sm shadow-sm border border-[#e8e4dc]">
            <span className="font-semibold">{hovered}</span>
            <span className="text-stone-500 ml-2">
              {RAW_NODES.find((n) => n.id === hovered)?.count} books
            </span>
          </div>
        )}
      </div>
      <div className="flex flex-wrap gap-x-5 gap-y-1 mt-3 justify-center text-sm">
        {Object.entries(DOMAIN_LABELS).map(([key, label]) => (
          <div key={key} className="flex items-center gap-1.5">
            <span
              className="inline-block w-2.5 h-2.5 rounded-full"
              style={{ backgroundColor: DOMAIN_COLORS[key] }}
            />
            <span className="text-stone-600">{label}</span>
          </div>
        ))}
      </div>
      <p className="text-center text-stone-500 text-sm mt-2">
        Concept co-occurrence across 1,509 indexed first translations. Node size = frequency. Hover to explore connections.
      </p>
    </div>
  );
}
