'use client';

import { useState, useRef, useCallback, useEffect, useMemo } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';

// ────────────────────────────────────────────────────────────
// Types
// ────────────────────────────────────────────────────────────

interface Book {
  id: string;
  title: string;
  author: string;
  year: number | null;
  language: string;
  category: string;
  categories: string[];
  keywords: string[];
  thumbnail: string | null;
  slug: string;
  pages: number;
  first_translation: boolean;
  x: number;
  y: number;
  z: number;
  cluster: number;
}

interface ClusterInfo {
  id: number;
  size: number;
  label: string;
  top_category: string;
  label_keywords: string[];
  cx: number;
  cy: number;
  cz: number;
}

interface ConstellationData {
  meta: {
    total_books: number;
    n_clusters: number;
    model: string;
    generated_at: string;
  };
  clusters: Record<string, ClusterInfo>;
  books: Book[];
}

// ────────────────────────────────────────────────────────────
// Color Maps
// ────────────────────────────────────────────────────────────

// 25 distinct cluster colors — perceptually spread
const CLUSTER_COLORS = [
  '#e74c3c', '#3498db', '#2ecc71', '#f39c12', '#9b59b6',
  '#1abc9c', '#e91e63', '#00bcd4', '#ff9800', '#673ab7',
  '#4caf50', '#795548', '#607d8b', '#ff5722', '#009688',
  '#8bc34a', '#c9a86c', '#5d8fb5', '#d4924a', '#a067a0',
  '#5e6d52', '#b5835d', '#7c5db5', '#9e4a3a', '#4a9e7c',
];

const LANGUAGE_COLORS: Record<string, string> = {
  Latin: '#9e4a3a',
  English: '#5d8fb5',
  German: '#8b9a7d',
  French: '#7c5db5',
  Chinese: '#c9a86c',
  Sanskrit: '#d4924a',
  Italian: '#4a9e7c',
  Dutch: '#5e6d52',
  Hebrew: '#b5835d',
  Arabic: '#a067a0',
  Greek: '#5d7ab5',
};

type ColorMode = 'cluster' | 'language' | 'century';

function getCenturyColor(year: number | null): string {
  if (!year) return '#aaa';
  if (year < 0) return '#d4924a';
  if (year < 500) return '#c9a86c';
  if (year < 1000) return '#9e4a3a';
  if (year < 1200) return '#b5835d';
  if (year < 1400) return '#7c5db5';
  if (year < 1500) return '#5d8fb5';
  if (year < 1600) return '#8b9a7d';
  if (year < 1700) return '#4a9e7c';
  if (year < 1800) return '#5e6d52';
  return '#6a7a5a';
}

function getBookColor(book: Book, mode: ColorMode): string {
  switch (mode) {
    case 'cluster':
      return CLUSTER_COLORS[book.cluster % CLUSTER_COLORS.length];
    case 'language':
      return LANGUAGE_COLORS[book.language] || '#888';
    case 'century':
      return getCenturyColor(book.year);
  }
}

function hexToRgb(hex: string): [number, number, number] {
  const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  return result
    ? [parseInt(result[1], 16) / 255, parseInt(result[2], 16) / 255, parseInt(result[3], 16) / 255]
    : [0.5, 0.5, 0.5];
}

// ────────────────────────────────────────────────────────────
// Component
// ────────────────────────────────────────────────────────────

const SPREAD = 40; // World-space spread of the constellation
const POINT_SIZE = 3.0;

export default function BookConstellationViz({ data }: { data: ConstellationData }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
  const sceneRef = useRef<THREE.Scene | null>(null);
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);
  const controlsRef = useRef<OrbitControls | null>(null);
  const pointsRef = useRef<THREE.Points | null>(null);
  const raycasterRef = useRef<THREE.Raycaster>(new THREE.Raycaster());
  const mouseRef = useRef<THREE.Vector2>(new THREE.Vector2());
  const animFrameRef = useRef<number>(0);

  const [hoveredIdx, setHoveredIdx] = useState<number | null>(null);
  const [colorMode, setColorMode] = useState<ColorMode>('cluster');
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCluster, setSelectedCluster] = useState<number | null>(null);
  const [tooltipPos, setTooltipPos] = useState<{ x: number; y: number } | null>(null);

  // Search filter
  const searchMatches = useMemo(() => {
    if (!searchQuery || searchQuery.length < 2) return null;
    const q = searchQuery.toLowerCase();
    const matches = new Set<number>();
    data.books.forEach((b, i) => {
      if (
        b.title.toLowerCase().includes(q) ||
        b.author.toLowerCase().includes(q) ||
        b.keywords.some((k) => k.toLowerCase().includes(q)) ||
        b.categories.some((c) => c.toLowerCase().includes(q))
      ) {
        matches.add(i);
      }
    });
    return matches;
  }, [searchQuery, data.books]);

  // ── Initialize Three.js scene ──
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    // Scene
    const scene = new THREE.Scene();
    scene.background = new THREE.Color('#0d0d14');
    scene.fog = new THREE.FogExp2('#0d0d14', 0.008);
    sceneRef.current = scene;

    // Camera
    const w = container.clientWidth;
    const h = Math.max(500, Math.min(w * 0.65, 700));
    const camera = new THREE.PerspectiveCamera(60, w / h, 0.1, 500);
    camera.position.set(0, 0, SPREAD * 1.6);
    cameraRef.current = camera;

    // Renderer
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setSize(w, h);
    container.appendChild(renderer.domElement);
    rendererRef.current = renderer;

    // Controls
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.05;
    controls.rotateSpeed = 0.5;
    controls.zoomSpeed = 0.8;
    controls.minDistance = 5;
    controls.maxDistance = SPREAD * 3;
    controls.target.set(0, 0, 0);
    controlsRef.current = controls;

    // Raycaster threshold
    raycasterRef.current.params.Points = { threshold: 0.6 };

    // Points geometry
    const geometry = new THREE.BufferGeometry();
    const positions = new Float32Array(data.books.length * 3);
    const colors = new Float32Array(data.books.length * 3);
    const sizes = new Float32Array(data.books.length);

    for (let i = 0; i < data.books.length; i++) {
      const b = data.books[i];
      positions[i * 3] = (b.x - 0.5) * SPREAD;
      positions[i * 3 + 1] = (b.y - 0.5) * SPREAD;
      positions[i * 3 + 2] = (b.z - 0.5) * SPREAD;

      const color = hexToRgb(getBookColor(b, 'cluster'));
      colors[i * 3] = color[0];
      colors[i * 3 + 1] = color[1];
      colors[i * 3 + 2] = color[2];

      sizes[i] = POINT_SIZE;
    }

    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    geometry.setAttribute('size', new THREE.BufferAttribute(sizes, 1));

    // Custom shader for size attenuation + round points
    const material = new THREE.ShaderMaterial({
      uniforms: {
        pointMultiplier: { value: h * 0.5 },
      },
      vertexShader: `
        attribute float size;
        varying vec3 vColor;
        varying float vAlpha;
        uniform float pointMultiplier;
        void main() {
          vColor = color;
          vAlpha = size > 0.1 ? 1.0 : 0.0;
          vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
          gl_PointSize = size * pointMultiplier / -mvPosition.z;
          gl_PointSize = clamp(gl_PointSize, 1.0, 20.0);
          gl_Position = projectionMatrix * mvPosition;
        }
      `,
      fragmentShader: `
        varying vec3 vColor;
        varying float vAlpha;
        void main() {
          float d = length(gl_PointCoord - vec2(0.5));
          if (d > 0.5) discard;
          float alpha = smoothstep(0.5, 0.35, d) * vAlpha;
          gl_FragColor = vec4(vColor, alpha * 0.85);
        }
      `,
      vertexColors: true,
      transparent: true,
      depthWrite: false,
    });

    const points = new THREE.Points(geometry, material);
    scene.add(points);
    pointsRef.current = points;

    // Cluster labels as sprites
    const labelGroup = new THREE.Group();
    labelGroup.name = 'clusterLabels';
    for (const [, cluster] of Object.entries(data.clusters)) {
      const canvas = document.createElement('canvas');
      const ctx = canvas.getContext('2d');
      if (!ctx) continue;

      const text = cluster.label || cluster.label_keywords.slice(0, 2).join(', ');
      if (!text) continue;

      canvas.width = 512;
      canvas.height = 64;
      ctx.font = '28px Inter, system-ui, sans-serif';
      ctx.fillStyle = 'rgba(255, 255, 255, 0.35)';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(text, 256, 32);

      const texture = new THREE.CanvasTexture(canvas);
      texture.minFilter = THREE.LinearFilter;
      const spriteMat = new THREE.SpriteMaterial({ map: texture, transparent: true, depthWrite: false });
      const sprite = new THREE.Sprite(spriteMat);
      sprite.position.set(
        (cluster.cx - 0.5) * SPREAD,
        (cluster.cy - 0.5) * SPREAD,
        (cluster.cz - 0.5) * SPREAD,
      );
      sprite.scale.set(12, 1.5, 1);
      labelGroup.add(sprite);
    }
    scene.add(labelGroup);

    // Animation loop
    function animate() {
      animFrameRef.current = requestAnimationFrame(animate);
      controls.update();
      renderer.render(scene, camera);
    }
    animate();

    // Resize handler
    const onResize = () => {
      const w = container.clientWidth;
      const h = Math.max(500, Math.min(w * 0.65, 700));
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      renderer.setSize(w, h);
      (material.uniforms.pointMultiplier as { value: number }).value = h * 0.5;
    };
    const observer = new ResizeObserver(onResize);
    observer.observe(container);

    return () => {
      cancelAnimationFrame(animFrameRef.current);
      observer.disconnect();
      controls.dispose();
      renderer.dispose();
      geometry.dispose();
      material.dispose();
      if (container.contains(renderer.domElement)) {
        container.removeChild(renderer.domElement);
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data]);

  // ── Update colors/sizes when mode, search, or cluster filter changes ──
  useEffect(() => {
    const points = pointsRef.current;
    if (!points) return;
    const geometry = points.geometry;
    const colorAttr = geometry.getAttribute('color') as THREE.BufferAttribute;
    const sizeAttr = geometry.getAttribute('size') as THREE.BufferAttribute;

    const hasSearch = searchMatches && searchMatches.size > 0;
    const hasCluster = selectedCluster !== null;

    for (let i = 0; i < data.books.length; i++) {
      const b = data.books[i];
      const isSearchMatch = hasSearch ? searchMatches!.has(i) : true;
      const isClusterMatch = hasCluster ? b.cluster === selectedCluster : true;
      const isHighlighted = isSearchMatch && isClusterMatch;
      const isHovered = i === hoveredIdx;

      const hex = getBookColor(b, colorMode);
      const [r, g, bb] = hexToRgb(hex);

      if (isHighlighted || isHovered) {
        colorAttr.setXYZ(i, r, g, bb);
        sizeAttr.setX(i, isHovered ? POINT_SIZE * 3 : POINT_SIZE);
      } else {
        // Dim non-matches
        colorAttr.setXYZ(i, r * 0.2, g * 0.2, bb * 0.2);
        sizeAttr.setX(i, hasSearch || hasCluster ? POINT_SIZE * 0.5 : POINT_SIZE);
      }
    }

    colorAttr.needsUpdate = true;
    sizeAttr.needsUpdate = true;
  }, [colorMode, searchMatches, selectedCluster, hoveredIdx, data.books]);

  // ── Mouse move → raycasting ──
  const handlePointerMove = useCallback(
    (e: React.PointerEvent) => {
      const container = containerRef.current;
      const camera = cameraRef.current;
      const points = pointsRef.current;
      if (!container || !camera || !points) return;

      const rect = container.getBoundingClientRect();
      const rendererEl = rendererRef.current?.domElement;
      if (!rendererEl) return;

      mouseRef.current.x = ((e.clientX - rect.left) / rendererEl.clientWidth) * 2 - 1;
      mouseRef.current.y = -((e.clientY - rect.top) / rendererEl.clientHeight) * 2 + 1;

      raycasterRef.current.setFromCamera(mouseRef.current, camera);
      const intersects = raycasterRef.current.intersectObject(points);

      if (intersects.length > 0 && intersects[0].index !== undefined) {
        const idx = intersects[0].index;
        setHoveredIdx(idx);
        setTooltipPos({ x: e.clientX - rect.left, y: e.clientY - rect.top });
      } else {
        setHoveredIdx(null);
        setTooltipPos(null);
      }
    },
    [],
  );

  const handleClick = useCallback(() => {
    if (hoveredIdx !== null) {
      const book = data.books[hoveredIdx];
      window.open(`/book/${book.slug}`, '_blank');
    }
  }, [hoveredIdx, data.books]);

  // Reset
  const resetView = useCallback(() => {
    setSearchQuery('');
    setSelectedCluster(null);
    const camera = cameraRef.current;
    const controls = controlsRef.current;
    if (camera && controls) {
      camera.position.set(0, 0, SPREAD * 1.6);
      controls.target.set(0, 0, 0);
      controls.update();
    }
  }, []);

  // Tooltip book
  const hoveredBook = hoveredIdx !== null ? data.books[hoveredIdx] : null;

  // Legend items
  const legendItems = useMemo(() => {
    if (colorMode === 'cluster') {
      return Object.values(data.clusters)
        .sort((a, b) => b.size - a.size)
        .slice(0, 12)
        .map((c) => ({
          label: c.label || c.label_keywords.slice(0, 2).join(', '),
          color: CLUSTER_COLORS[c.id % CLUSTER_COLORS.length],
          count: c.size,
        }));
    }
    if (colorMode === 'language') {
      const counts: Record<string, number> = {};
      data.books.forEach((b) => {
        counts[b.language] = (counts[b.language] || 0) + 1;
      });
      return Object.entries(counts)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 12)
        .map(([lang, count]) => ({
          label: lang,
          color: LANGUAGE_COLORS[lang] || '#888',
          count,
        }));
    }
    // century
    return [
      { label: 'Before 500', color: getCenturyColor(100), count: 0 },
      { label: '500-999', color: getCenturyColor(700), count: 0 },
      { label: '1000-1399', color: getCenturyColor(1200), count: 0 },
      { label: '1400-1499', color: getCenturyColor(1450), count: 0 },
      { label: '1500-1599', color: getCenturyColor(1550), count: 0 },
      { label: '1600-1699', color: getCenturyColor(1650), count: 0 },
      { label: '1700+', color: getCenturyColor(1750), count: 0 },
    ];
  }, [colorMode, data]);

  return (
    <div>
      {/* Controls */}
      <div className="flex flex-wrap items-center gap-3 mb-4">
        {/* Search */}
        <div className="relative flex-1 min-w-[200px] max-w-[320px]">
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search books, authors, keywords..."
            className="w-full pl-8 pr-3 py-1.5 text-sm border border-[var(--border-light)] rounded-lg bg-white focus:outline-none focus:border-[var(--accent-violet)]"
          />
          <svg
            className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-[var(--text-faint)]"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeWidth={2}
              d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
            />
          </svg>
          {searchMatches && (
            <span className="absolute right-2.5 top-1/2 -translate-y-1/2 text-xs text-[var(--text-faint)]">
              {searchMatches.size} found
            </span>
          )}
        </div>

        {/* Color mode */}
        <div className="flex items-center gap-1 text-sm">
          <span className="text-[var(--text-muted)] mr-1">Color:</span>
          {(['cluster', 'language', 'century'] as ColorMode[]).map((mode) => (
            <button
              key={mode}
              onClick={() => setColorMode(mode)}
              className={`px-2.5 py-1 rounded text-xs transition-colors ${
                colorMode === mode
                  ? 'bg-[var(--accent-violet)] text-white'
                  : 'bg-[var(--bg-warm)] text-[var(--text-secondary)] hover:bg-[var(--border-light)]'
              }`}
            >
              {mode === 'cluster' ? 'Topic' : mode.charAt(0).toUpperCase() + mode.slice(1)}
            </button>
          ))}
        </div>

        {/* Reset */}
        <button
          onClick={resetView}
          className="px-2.5 py-1 rounded text-xs bg-[var(--bg-warm)] text-[var(--text-secondary)] hover:bg-[var(--border-light)] transition-colors"
        >
          Reset
        </button>
      </div>

      {/* Three.js container */}
      <div
        ref={containerRef}
        className="relative w-full rounded-lg overflow-hidden"
        style={{ cursor: hoveredIdx !== null ? 'pointer' : 'grab' }}
        onPointerMove={handlePointerMove}
        onClick={handleClick}
      >
        {/* Tooltip */}
        {hoveredBook && tooltipPos && (
          <div
            className="absolute pointer-events-none bg-white border border-[var(--border-medium)] rounded-lg shadow-lg p-3 max-w-[280px] z-10"
            style={{
              left: Math.min(tooltipPos.x + 12, (containerRef.current?.clientWidth ?? 600) - 290),
              top: Math.max(tooltipPos.y - 80, 10),
            }}
          >
            <div className="font-serif text-sm font-medium text-[var(--text-primary)] leading-tight mb-1">
              {hoveredBook.title}
            </div>
            <div className="text-xs text-[var(--text-muted)] mb-1.5">
              {hoveredBook.author !== 'Unknown' ? hoveredBook.author : ''}
              {hoveredBook.author !== 'Unknown' && hoveredBook.year ? ' · ' : ''}
              {hoveredBook.year || ''}
            </div>
            <div className="flex flex-wrap gap-1">
              {hoveredBook.categories.slice(0, 3).map((cat) => (
                <span
                  key={cat}
                  className="px-1.5 py-0.5 text-[10px] rounded bg-[var(--bg-warm)] text-[var(--text-secondary)]"
                >
                  {cat.replace(/-/g, ' ')}
                </span>
              ))}
              <span className="px-1.5 py-0.5 text-[10px] rounded bg-[var(--bg-warm)] text-[var(--text-muted)]">
                {hoveredBook.language}
              </span>
            </div>
            {hoveredBook.first_translation && (
              <div className="text-[10px] text-[var(--accent-rust)] mt-1 font-medium">
                First English Translation
              </div>
            )}
            <div className="text-[10px] text-[var(--text-faint)] mt-1">Click to open</div>
          </div>
        )}

        {/* Legend (overlay) */}
        <div className="absolute bottom-3 left-3 bg-black/60 backdrop-blur-sm rounded-lg p-2.5 border border-white/10 max-w-[220px]">
          <div className="grid grid-cols-1 gap-y-0.5">
            {legendItems.slice(0, 8).map((item) => (
              <div key={item.label} className="flex items-center gap-1.5 text-[10px] text-white/70">
                <span
                  className="w-2 h-2 rounded-full shrink-0"
                  style={{ backgroundColor: item.color }}
                />
                <span className="truncate">{item.label}</span>
                {item.count > 0 && (
                  <span className="ml-auto text-white/40">{item.count}</span>
                )}
              </div>
            ))}
          </div>
        </div>

        {/* Controls hint */}
        <div className="absolute bottom-3 right-3 text-[10px] text-white/40 bg-black/40 px-2 py-1 rounded">
          Drag to rotate · Scroll to zoom · Right-drag to pan
        </div>
      </div>

      {/* Cluster pills (below viz) */}
      {Object.keys(data.clusters).length > 0 && (
        <div className="flex flex-wrap gap-1.5 mt-3">
          <button
            onClick={() => setSelectedCluster(null)}
            className={`px-2 py-0.5 rounded text-xs transition-colors ${
              selectedCluster === null
                ? 'bg-[var(--text-primary)] text-white'
                : 'bg-[var(--bg-warm)] text-[var(--text-muted)] hover:bg-[var(--border-light)]'
            }`}
          >
            All
          </button>
          {Object.values(data.clusters)
            .sort((a, b) => b.size - a.size)
            .slice(0, 18)
            .map((cluster) => {
              const label = cluster.label || cluster.label_keywords.slice(0, 2).join(', ') || `Cluster ${cluster.id}`;
              return (
                <button
                  key={cluster.id}
                  onClick={() => setSelectedCluster(selectedCluster === cluster.id ? null : cluster.id)}
                  className={`px-2 py-0.5 rounded text-xs transition-colors ${
                    selectedCluster === cluster.id
                      ? 'bg-[var(--accent-violet)] text-white'
                      : 'bg-[var(--bg-warm)] text-[var(--text-muted)] hover:bg-[var(--border-light)]'
                  }`}
                >
                  {label}
                  <span className="ml-1 opacity-60">{cluster.size}</span>
                </button>
              );
            })}
        </div>
      )}
    </div>
  );
}
