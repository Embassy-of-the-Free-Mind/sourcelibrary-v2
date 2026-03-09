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
// Colors
// ────────────────────────────────────────────────────────────

const CLUSTER_COLORS = [
  '#e74c3c', '#3498db', '#2ecc71', '#f39c12', '#9b59b6',
  '#1abc9c', '#e91e63', '#00bcd4', '#ff9800', '#673ab7',
  '#4caf50', '#795548', '#607d8b', '#ff5722', '#009688',
  '#8bc34a', '#c9a86c', '#5d8fb5', '#d4924a', '#a067a0',
  '#5e6d52', '#b5835d', '#7c5db5', '#9e4a3a', '#4a9e7c',
];

const LANGUAGE_COLORS: Record<string, string> = {
  Latin: '#9e4a3a', English: '#5d8fb5', German: '#8b9a7d',
  French: '#7c5db5', Chinese: '#c9a86c', Sanskrit: '#d4924a',
  Italian: '#4a9e7c', Dutch: '#5e6d52', Hebrew: '#b5835d',
  Arabic: '#a067a0', Greek: '#5d7ab5',
};

type ColorMode = 'cluster' | 'language' | 'century';

function getCenturyColor(year: number | null): string {
  if (!year) return '#666';
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
    case 'cluster': return CLUSTER_COLORS[book.cluster % CLUSTER_COLORS.length];
    case 'language': return LANGUAGE_COLORS[book.language] || '#666';
    case 'century': return getCenturyColor(book.year);
  }
}

function hexToRgb(hex: string): [number, number, number] {
  const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  return result
    ? [parseInt(result[1], 16) / 255, parseInt(result[2], 16) / 255, parseInt(result[3], 16) / 255]
    : [0.4, 0.4, 0.4];
}

// Deterministic pseudo-random per index
function seededRandom(seed: number): number {
  const x = Math.sin(seed * 12.9898 + 78.233) * 43758.5453;
  return x - Math.floor(x);
}

// ────────────────────────────────────────────────────────────
// Constants
// ────────────────────────────────────────────────────────────

const SPREAD = 40;
const BOOK_SIZE = 0.45;
const HOVER_SCALE = 2.8;
const PICK_THRESHOLD_PX = 18;

// ────────────────────────────────────────────────────────────
// Component
// ────────────────────────────────────────────────────────────

export default function BookConstellationViz({ data }: { data: ConstellationData }) {
  // Three.js refs
  const containerRef = useRef<HTMLDivElement>(null);
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
  const sceneRef = useRef<THREE.Scene | null>(null);
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);
  const controlsRef = useRef<OrbitControls | null>(null);
  const meshRef = useRef<THREE.InstancedMesh | null>(null);
  const labelGroupRef = useRef<THREE.Group | null>(null);
  const animFrameRef = useRef<number>(0);

  // Cached per-instance data
  const bookPosRef = useRef<Float32Array>(new Float32Array(0));
  const bookRotRef = useRef<Float32Array>(new Float32Array(0));

  // Interaction refs
  const hoveredLabelRef = useRef<THREE.Sprite | null>(null);
  const raycasterRef = useRef<THREE.Raycaster>(new THREE.Raycaster());

  // State
  const [hoveredIdx, setHoveredIdx] = useState<number | null>(null);
  const [selectedBookIdx, setSelectedBookIdx] = useState<number | null>(null);
  const [colorMode, setColorMode] = useState<ColorMode>('cluster');
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCluster, setSelectedCluster] = useState<number | null>(null);
  const [tooltipPos, setTooltipPos] = useState<{ x: number; y: number } | null>(null);
  const [selectedBookPos, setSelectedBookPos] = useState<{ x: number; y: number } | null>(null);
  const [showInfo, setShowInfo] = useState(false);
  const [cursorStyle, setCursorStyle] = useState('grab');

  // Computed
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

  const clusterBooks = useMemo(() => {
    if (selectedCluster === null) return [];
    return data.books
      .filter((b) => b.cluster === selectedCluster)
      .sort((a, b) => (a.year || 9999) - (b.year || 9999));
  }, [selectedCluster, data.books]);

  const selectedClusterInfo = selectedCluster !== null ? data.clusters[String(selectedCluster)] : null;

  const stats = useMemo(() => ({
    totalBooks: data.meta.total_books,
    nClusters: data.meta.n_clusters,
    nLanguages: new Set(data.books.map((b) => b.language)).size,
    firstTranslations: data.books.filter((b) => b.first_translation).length,
  }), [data]);

  const legendItems = useMemo(() => {
    if (colorMode === 'cluster') {
      return Object.values(data.clusters)
        .sort((a, b) => b.size - a.size)
        .slice(0, 10)
        .map((c) => ({
          label: c.label || c.label_keywords.slice(0, 2).join(', '),
          color: CLUSTER_COLORS[c.id % CLUSTER_COLORS.length],
          count: c.size,
        }));
    }
    if (colorMode === 'language') {
      const counts: Record<string, number> = {};
      data.books.forEach((b) => { counts[b.language] = (counts[b.language] || 0) + 1; });
      return Object.entries(counts)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 10)
        .map(([lang, count]) => ({ label: lang, color: LANGUAGE_COLORS[lang] || '#666', count }));
    }
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

  // ── Initialize Three.js ──────────────────────────────────
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const scene = new THREE.Scene();
    scene.background = new THREE.Color('#000000');
    scene.fog = new THREE.FogExp2('#000000', 0.003);
    sceneRef.current = scene;

    const w = container.clientWidth;
    const h = container.clientHeight;
    const camera = new THREE.PerspectiveCamera(60, w / h, 0.1, 500);
    camera.position.set(SPREAD * 0.8, -SPREAD * 0.6, SPREAD * 1.2);
    cameraRef.current = camera;

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setSize(w, h);
    container.appendChild(renderer.domElement);
    rendererRef.current = renderer;

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.05;
    controls.rotateSpeed = 0.5;
    controls.zoomSpeed = 0.8;
    controls.minDistance = 5;
    controls.maxDistance = SPREAD * 3;
    controls.target.set(0, 0, 0);
    controlsRef.current = controls;

    // Auto-rotation
    const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (!prefersReducedMotion) {
      controls.autoRotate = true;
      controls.autoRotateSpeed = 0.3;
    }
    let rotationTimeout: ReturnType<typeof setTimeout>;
    controls.addEventListener('start', () => {
      controls.autoRotate = false;
      clearTimeout(rotationTimeout);
    });
    controls.addEventListener('end', () => {
      if (!prefersReducedMotion) {
        rotationTimeout = setTimeout(() => { controls.autoRotate = true; }, 5000);
      }
    });

    // ── InstancedMesh ──
    const n = data.books.length;
    const geometry = new THREE.BoxGeometry(BOOK_SIZE, BOOK_SIZE, BOOK_SIZE);
    const material = new THREE.MeshBasicMaterial({
      color: 0xffffff,
      transparent: true,
      opacity: 0.88,
      depthWrite: false,
    });
    const mesh = new THREE.InstancedMesh(geometry, material, n);

    const positions = new Float32Array(n * 3);
    const rotations = new Float32Array(n);
    const dummy = new THREE.Object3D();
    const tempColor = new THREE.Color();

    for (let i = 0; i < n; i++) {
      const b = data.books[i];
      const px = (b.x - 0.5) * SPREAD;
      const py = (b.y - 0.5) * SPREAD;
      const pz = (b.z - 0.5) * SPREAD;
      positions[i * 3] = px;
      positions[i * 3 + 1] = py;
      positions[i * 3 + 2] = pz;

      const rot = (seededRandom(i) - 0.5) * 0.3;
      rotations[i] = rot;

      dummy.position.set(px, py, pz);
      dummy.rotation.set(0, 0, rot);
      dummy.scale.set(1, 1, 1);
      dummy.updateMatrix();
      mesh.setMatrixAt(i, dummy.matrix);

      const [r, g, b2] = hexToRgb(getBookColor(b, 'cluster'));
      tempColor.setRGB(r, g, b2);
      mesh.setColorAt(i, tempColor);
    }

    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    scene.add(mesh);
    meshRef.current = mesh;
    bookPosRef.current = positions;
    bookRotRef.current = rotations;

    // ── Cluster label sprites ──
    const labelGroup = new THREE.Group();
    labelGroup.name = 'clusterLabels';
    for (const [, cluster] of Object.entries(data.clusters)) {
      const text = cluster.label || cluster.label_keywords.slice(0, 2).join(', ');
      if (!text) continue;

      const canvas = document.createElement('canvas');
      const ctx = canvas.getContext('2d');
      if (!ctx) continue;
      canvas.width = 512;
      canvas.height = 64;
      ctx.font = '26px Inter, system-ui, sans-serif';
      ctx.fillStyle = 'rgba(255, 255, 255, 1.0)';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(text, 256, 32);

      const texture = new THREE.CanvasTexture(canvas);
      texture.minFilter = THREE.LinearFilter;
      const spriteMat = new THREE.SpriteMaterial({
        map: texture,
        transparent: true,
        depthWrite: false,
        opacity: 0.25,
      });
      const sprite = new THREE.Sprite(spriteMat);
      sprite.position.set(
        (cluster.cx - 0.5) * SPREAD,
        (cluster.cy - 0.5) * SPREAD,
        (cluster.cz - 0.5) * SPREAD,
      );
      sprite.scale.set(12, 1.5, 1);
      sprite.userData.clusterId = cluster.id;
      labelGroup.add(sprite);
    }
    scene.add(labelGroup);
    labelGroupRef.current = labelGroup;

    // ── Animation loop ──
    function animate() {
      animFrameRef.current = requestAnimationFrame(animate);
      controls.update();
      renderer.render(scene, camera);
    }
    animate();

    // ── Resize ──
    const onResize = () => {
      const w = container.clientWidth;
      const h = container.clientHeight;
      if (w === 0 || h === 0) return;
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      renderer.setSize(w, h);
    };
    const observer = new ResizeObserver(onResize);
    observer.observe(container);

    return () => {
      cancelAnimationFrame(animFrameRef.current);
      clearTimeout(rotationTimeout);
      observer.disconnect();
      controls.dispose();
      renderer.dispose();
      geometry.dispose();
      material.dispose();
      labelGroup.children.forEach((child) => {
        const sprite = child as THREE.Sprite;
        sprite.material.map?.dispose();
        sprite.material.dispose();
      });
      if (container.contains(renderer.domElement)) {
        container.removeChild(renderer.domElement);
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data]);

  // ── Update instance visuals (colors + scales) ──
  useEffect(() => {
    const mesh = meshRef.current;
    if (!mesh) return;

    const n = data.books.length;
    const positions = bookPosRef.current;
    const rotations = bookRotRef.current;
    const dummy = new THREE.Object3D();
    const tempColor = new THREE.Color();

    const hasSearch = searchMatches && searchMatches.size > 0;
    const hasCluster = selectedCluster !== null;

    for (let i = 0; i < n; i++) {
      const b = data.books[i];
      const isSearchMatch = hasSearch ? searchMatches!.has(i) : true;
      const isClusterMatch = hasCluster ? b.cluster === selectedCluster : true;
      const isHighlighted = isSearchMatch && isClusterMatch;
      const isHovered = i === hoveredIdx;
      const isSelected = i === selectedBookIdx;

      // Color
      const hex = getBookColor(b, colorMode);
      const [r, g, bl] = hexToRgb(hex);
      if (isHighlighted || isHovered || isSelected) {
        tempColor.setRGB(r, g, bl);
      } else {
        tempColor.setRGB(r * 0.12, g * 0.12, bl * 0.12);
      }
      mesh.setColorAt(i, tempColor);

      // Matrix
      const px = positions[i * 3];
      const py = positions[i * 3 + 1];
      const pz = positions[i * 3 + 2];
      const scale = isHovered || isSelected ? HOVER_SCALE : 1;
      dummy.position.set(px, py, pz);
      dummy.rotation.set(0, 0, rotations[i]);
      dummy.scale.set(scale, scale, scale);
      dummy.updateMatrix();
      mesh.setMatrixAt(i, dummy.matrix);
    }

    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  }, [colorMode, searchMatches, selectedCluster, hoveredIdx, selectedBookIdx, data.books]);

  // ── Pointer move: screen-space proximity picking + label hover ──
  const handlePointerMove = useCallback(
    (e: React.PointerEvent) => {
      const container = containerRef.current;
      const camera = cameraRef.current;
      const labelGroup = labelGroupRef.current;
      if (!container || !camera) return;

      const rect = container.getBoundingClientRect();
      const mx = e.clientX - rect.left;
      const my = e.clientY - rect.top;
      const w = rect.width;
      const h = rect.height;

      // NDC for raycaster (used for label sprites)
      const ndcX = (mx / w) * 2 - 1;
      const ndcY = -(my / h) * 2 + 1;
      raycasterRef.current.setFromCamera(new THREE.Vector2(ndcX, ndcY), camera);

      // Check cluster labels first
      if (labelGroup) {
        const prevLabel = hoveredLabelRef.current;
        const labelIntersects = raycasterRef.current.intersectObjects(labelGroup.children);
        if (labelIntersects.length > 0) {
          const sprite = labelIntersects[0].object as THREE.Sprite;
          if (prevLabel && prevLabel !== sprite) {
            (prevLabel.material as THREE.SpriteMaterial).opacity = 0.25;
          }
          (sprite.material as THREE.SpriteMaterial).opacity = 0.65;
          hoveredLabelRef.current = sprite;
          setCursorStyle('pointer');
          setHoveredIdx(null);
          setTooltipPos(null);
          return;
        }
        if (prevLabel) {
          (prevLabel.material as THREE.SpriteMaterial).opacity = 0.25;
          hoveredLabelRef.current = null;
        }
      }

      // Screen-space proximity for books
      const positions = bookPosRef.current;
      const n = data.books.length;
      const tempVec = new THREE.Vector3();
      let nearestIdx = -1;
      let nearestDist = PICK_THRESHOLD_PX;

      for (let i = 0; i < n; i++) {
        tempVec.set(positions[i * 3], positions[i * 3 + 1], positions[i * 3 + 2]);
        tempVec.project(camera);
        if (tempVec.z > 1) continue; // behind camera
        const sx = (tempVec.x * 0.5 + 0.5) * w;
        const sy = (-tempVec.y * 0.5 + 0.5) * h;
        const dx = sx - mx;
        const dy = sy - my;
        const dist = Math.sqrt(dx * dx + dy * dy);
        if (dist < nearestDist) {
          nearestDist = dist;
          nearestIdx = i;
        }
      }

      if (nearestIdx >= 0) {
        setHoveredIdx(nearestIdx);
        setTooltipPos({ x: mx, y: my });
        setCursorStyle('pointer');
      } else {
        setHoveredIdx(null);
        setTooltipPos(null);
        setCursorStyle('grab');
      }
    },
    [data.books.length],
  );

  // ── Click handler ──
  const handleClick = useCallback(
    (e: React.MouseEvent) => {
      // Check if a label sprite is hovered
      const label = hoveredLabelRef.current;
      if (label && label.userData.clusterId !== undefined) {
        const cId = label.userData.clusterId as number;
        setSelectedCluster((prev) => (prev === cId ? null : cId));
        setSelectedBookIdx(null);
        setSelectedBookPos(null);
        return;
      }

      // Check books
      if (hoveredIdx !== null) {
        setSelectedBookIdx(hoveredIdx);
        if (tooltipPos) setSelectedBookPos(tooltipPos);
      } else {
        setSelectedBookIdx(null);
        setSelectedBookPos(null);
      }
    },
    [hoveredIdx, tooltipPos],
  );

  const resetView = useCallback(() => {
    setSearchQuery('');
    setSelectedCluster(null);
    setSelectedBookIdx(null);
    setSelectedBookPos(null);
    const camera = cameraRef.current;
    const controls = controlsRef.current;
    if (camera && controls) {
      camera.position.set(SPREAD * 0.8, -SPREAD * 0.6, SPREAD * 1.2);
      controls.target.set(0, 0, 0);
      controls.update();
    }
  }, []);

  const hoveredBook = hoveredIdx !== null ? data.books[hoveredIdx] : null;

  // ── Render ──────────────────────────────────────────────
  return (
    <div className="relative w-full h-full select-none">
      {/* Three.js canvas mount */}
      <div
        ref={containerRef}
        className="absolute inset-0"
        style={{ cursor: cursorStyle }}
        onPointerMove={handlePointerMove}
        onClick={handleClick}
      />

      {/* ── Top-left: branding ── */}
      <div className="absolute top-4 left-5 z-10">
        <a
          href="/"
          className="text-white/30 hover:text-white/60 text-xs font-mono tracking-[0.2em] uppercase transition-colors"
        >
          Source Library
        </a>
        <div className="text-white/70 font-serif text-xl leading-tight">Book Atlas</div>
      </div>

      {/* ── Top-right: controls ── */}
      <div className="absolute top-4 right-5 z-10 flex items-center gap-2">
        {/* Search */}
        <div className="relative">
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search..."
            className="w-48 pl-7 pr-2 py-1.5 text-sm bg-white/5 border border-white/10 rounded text-white/80 placeholder:text-white/25 placeholder:font-mono focus:outline-none focus:border-white/25 transition-colors"
          />
          <svg
            className="absolute left-2 top-1/2 -translate-y-1/2 w-3 h-3 text-white/25"
            fill="none" stroke="currentColor" viewBox="0 0 24 24"
          >
            <path strokeLinecap="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
          </svg>
          {searchMatches && (
            <span className="absolute right-2 top-1/2 -translate-y-1/2 text-xs text-white/30 font-mono">
              {searchMatches.size}
            </span>
          )}
        </div>

        {/* Color mode */}
        {(['cluster', 'language', 'century'] as ColorMode[]).map((mode) => (
          <button
            key={mode}
            onClick={() => setColorMode(mode)}
            className={`px-2.5 py-1 text-xs rounded border transition-colors ${
              colorMode === mode
                ? 'bg-white/10 border-white/20 text-white/80'
                : 'bg-transparent border-white/8 text-white/30 hover:text-white/50 hover:border-white/15'
            }`}
          >
            {mode === 'cluster' ? 'Topic' : mode.charAt(0).toUpperCase() + mode.slice(1)}
          </button>
        ))}

        {/* Info toggle */}
        <button
          onClick={() => setShowInfo(!showInfo)}
          className={`w-7 h-7 flex items-center justify-center rounded border text-sm font-serif italic transition-colors ${
            showInfo
              ? 'bg-white/10 border-white/20 text-white/70'
              : 'bg-transparent border-white/8 text-white/30 hover:text-white/50'
          }`}
        >
          i
        </button>

        {/* Reset */}
        <button
          onClick={resetView}
          className="px-2.5 py-1 text-xs rounded border border-white/8 text-white/30 hover:text-white/50 hover:border-white/15 transition-colors"
        >
          Reset
        </button>
      </div>

      {/* ── Info panel ── */}
      {showInfo && (
        <div
          className="absolute top-14 right-5 w-[300px] bg-black/80 backdrop-blur-md border border-white/10 rounded p-4 z-20 max-h-[85vh] overflow-y-auto"
          onPointerMove={(e) => e.stopPropagation()}
          onClick={(e) => e.stopPropagation()}
        >
          <div className="grid grid-cols-2 gap-3 mb-4">
            <div><div className="text-white/80 font-mono text-xl">{stats.totalBooks.toLocaleString()}</div><div className="text-white/30 text-xs uppercase tracking-wider">Books</div></div>
            <div><div className="text-white/80 font-mono text-xl">{stats.nClusters}</div><div className="text-white/30 text-xs uppercase tracking-wider">Clusters</div></div>
            <div><div className="text-white/80 font-mono text-xl">{stats.nLanguages}</div><div className="text-white/30 text-xs uppercase tracking-wider">Languages</div></div>
            <div><div className="text-white/80 font-mono text-xl">{stats.firstTranslations.toLocaleString()}</div><div className="text-white/30 text-xs uppercase tracking-wider">First Trans.</div></div>
          </div>
          <div className="border-t border-white/10 pt-3 text-white/40 text-xs leading-relaxed space-y-2">
            <p>
              Each rectangle is a book. Position reflects content similarity — AI
              embeddings of summaries, themes, and index terms are projected with UMAP.
              Height represents date of composition.
            </p>
            <p>
              <strong className="text-white/50">Embeddings:</strong>{' '}
              <span className="font-mono text-xs">paraphrase-multilingual-MiniLM-L12-v2</span>{' '}
              (384-dim). UMAP with cosine distance, n_neighbors=15, min_dist=0.1.
            </p>
            <p>
              <strong className="text-white/50">Clustering:</strong>{' '}
              K-Means (k={stats.nClusters}) on original embeddings. Labels from TF-IDF on categories.
            </p>
            <p>
              <strong className="text-white/50">Z-axis:</strong>{' '}
              Piecewise linear normalization — pre-1400 compressed, 1400-1970 expanded.
            </p>
          </div>
        </div>
      )}

      {/* ── Hover tooltip ── */}
      {hoveredBook && tooltipPos && selectedBookIdx !== hoveredIdx && (
        <div
          className="absolute pointer-events-none bg-black/80 backdrop-blur-md border border-white/10 rounded p-2.5 max-w-[260px] z-20"
          style={{
            left: Math.min(tooltipPos.x + 14, (containerRef.current?.clientWidth ?? 600) - 270),
            top: Math.max(tooltipPos.y - 70, 10),
          }}
        >
          <div className="font-serif text-sm text-white/90 leading-tight mb-0.5">
            {hoveredBook.title}
          </div>
          <div className="text-xs text-white/40">
            {hoveredBook.author !== 'Unknown' ? hoveredBook.author : ''}
            {hoveredBook.author !== 'Unknown' && hoveredBook.year ? ' · ' : ''}
            {hoveredBook.year || ''}
          </div>
        </div>
      )}

      {/* ── Selected book panel ── */}
      {selectedBookIdx !== null && selectedBookPos && (() => {
        const book = data.books[selectedBookIdx];
        if (!book) return null;
        const ci = data.clusters[String(book.cluster)];
        return (
          <div
            className="absolute bg-black/80 backdrop-blur-md border border-white/10 rounded p-3 max-w-[280px] z-20"
            style={{
              left: Math.min(selectedBookPos.x + 14, (containerRef.current?.clientWidth ?? 600) - 290),
              top: Math.max(selectedBookPos.y - 100, 10),
            }}
            onPointerMove={(e) => e.stopPropagation()}
            onClick={(e) => e.stopPropagation()}
          >
            <button
              onClick={() => { setSelectedBookIdx(null); setSelectedBookPos(null); }}
              className="absolute top-1.5 right-2 text-white/30 hover:text-white/60 text-sm leading-none"
              aria-label="Close"
            >
              &times;
            </button>
            <a
              href={`/book/${book.slug}`}
              target="_blank"
              rel="noopener noreferrer"
              className="font-serif text-sm text-white/90 hover:text-white leading-tight block mb-1 pr-4"
            >
              {book.title}
            </a>
            <div className="text-xs text-white/40 mb-1.5">
              {book.author !== 'Unknown' ? book.author : ''}
              {book.author !== 'Unknown' && book.year ? ' · ' : ''}
              {book.year || ''}
              {book.pages > 0 ? ` · ${book.pages} pp.` : ''}
            </div>
            <div className="flex flex-wrap gap-1">
              {book.categories.slice(0, 3).map((cat) => (
                <span key={cat} className="px-1.5 py-0.5 text-[11px] rounded bg-white/8 text-white/50">
                  {cat.replace(/-/g, ' ')}
                </span>
              ))}
              <span className="px-1.5 py-0.5 text-[11px] rounded bg-white/8 text-white/35">
                {book.language}
              </span>
            </div>
            {book.keywords.length > 0 && (
              <div className="text-[11px] text-white/35 mt-1.5 leading-relaxed">
                {book.keywords.join(' · ')}
              </div>
            )}
            {book.first_translation && (
              <div className="text-[11px] text-[#9e4a3a] mt-1 font-medium">
                First English Translation
              </div>
            )}
            {ci && (
              <button
                onClick={() => setSelectedCluster(ci.id)}
                className="text-[11px] text-white/25 mt-1.5 hover:text-white/50 transition-colors"
              >
                Cluster: {ci.label} ({ci.size} books) &rarr;
              </button>
            )}
          </div>
        );
      })()}

      {/* ── Bottom-left: legend ── */}
      <div className="absolute bottom-12 left-5 z-10 bg-black/50 backdrop-blur-sm border border-white/8 rounded p-2.5 max-w-[200px]">
        <div className="grid grid-cols-1 gap-y-0.5">
          {legendItems.map((item) => (
            <div key={item.label} className="flex items-center gap-1.5 text-xs text-white/50">
              <span className="w-2 h-2 rounded-sm shrink-0" style={{ backgroundColor: item.color }} />
              <span className="truncate">{item.label}</span>
              {item.count > 0 && <span className="ml-auto text-white/25 font-mono">{item.count}</span>}
            </div>
          ))}
        </div>
      </div>

      {/* ── Bottom: cluster pills ── */}
      <div className={`absolute bottom-3 left-5 z-10 ${selectedCluster !== null ? 'right-[370px]' : 'right-5'}`}>
        <ClusterPills
          clusters={data.clusters}
          selectedCluster={selectedCluster}
          onSelect={(id) => {
            setSelectedCluster(selectedCluster === id ? null : id);
            setSelectedBookIdx(null);
            setSelectedBookPos(null);
          }}
          onClear={() => { setSelectedCluster(null); }}
        />
      </div>

      {/* ── Bottom-right: hint ── */}
      <div className="absolute bottom-12 right-5 z-10 text-xs text-white/20 font-mono">
        Click to inspect · Drag to rotate · Scroll to zoom
      </div>

      {/* ── Cluster detail panel ── */}
      {selectedCluster !== null && selectedClusterInfo && (
        <div
          className="absolute top-0 right-0 w-[360px] h-full bg-black/70 backdrop-blur-md border-l border-white/10 z-30 flex flex-col"
          onPointerMove={(e) => e.stopPropagation()}
          onClick={(e) => e.stopPropagation()}
        >
          <div className="p-4 border-b border-white/10 flex items-center justify-between shrink-0">
            <div>
              <h3 className="text-white/90 font-serif text-base leading-tight">{selectedClusterInfo.label}</h3>
              <p className="text-white/30 text-xs mt-0.5 font-mono">{clusterBooks.length} books</p>
            </div>
            <button
              onClick={() => setSelectedCluster(null)}
              className="text-white/30 hover:text-white/60 text-lg leading-none transition-colors"
              aria-label="Close cluster panel"
            >
              &times;
            </button>
          </div>
          <div className="flex-1 overflow-y-auto p-3 space-y-1.5 min-h-0">
            {clusterBooks.map((book) => (
              <a
                key={book.id}
                href={`/book/${book.slug}`}
                target="_blank"
                rel="noopener noreferrer"
                className="block p-2 rounded border border-white/5 hover:border-white/15 hover:bg-white/5 transition-colors"
              >
                <div className="text-white/80 text-sm font-serif leading-tight">{book.title}</div>
                <div className="text-white/30 text-xs mt-0.5">
                  {book.author !== 'Unknown' && book.author}
                  {book.author !== 'Unknown' && book.year ? ' · ' : ''}
                  {book.year || ''}
                </div>
                <div className="flex gap-1 mt-1">
                  <span className="px-1 py-0.5 text-[11px] rounded bg-white/5 text-white/30">{book.language}</span>
                  {book.keywords.slice(0, 2).map((kw) => (
                    <span key={kw} className="px-1 py-0.5 text-[11px] rounded bg-white/5 text-white/25">{kw}</span>
                  ))}
                  {book.first_translation && (
                    <span className="px-1 py-0.5 text-[11px] rounded bg-[#9e4a3a]/20 text-[#9e4a3a]">1st trans.</span>
                  )}
                </div>
              </a>
            ))}
          </div>
          <div className="p-3 border-t border-white/10 shrink-0">
            <a
              href={`/search?q=${encodeURIComponent(selectedClusterInfo.label)}`}
              target="_blank"
              rel="noopener noreferrer"
              className="text-white/30 text-xs hover:text-white/50 transition-colors"
            >
              Search in library &rarr;
            </a>
          </div>
        </div>
      )}
    </div>
  );
}

// ────────────────────────────────────────────────────────────
// Cluster Pills
// ────────────────────────────────────────────────────────────

const INITIAL_PILLS = 20;

function ClusterPills({
  clusters,
  selectedCluster,
  onSelect,
  onClear,
}: {
  clusters: Record<string, ClusterInfo>;
  selectedCluster: number | null;
  onSelect: (id: number) => void;
  onClear: () => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const sorted = useMemo(
    () => Object.values(clusters).sort((a, b) => b.size - a.size),
    [clusters],
  );
  const visible = expanded ? sorted : sorted.slice(0, INITIAL_PILLS);
  const hasMore = sorted.length > INITIAL_PILLS;

  return (
    <div className="flex flex-wrap gap-1">
      <button
        onClick={onClear}
        className={`px-2 py-0.5 rounded text-xs border transition-colors ${
          selectedCluster === null
            ? 'bg-white/10 border-white/20 text-white/70'
            : 'bg-transparent border-white/8 text-white/25 hover:text-white/40'
        }`}
      >
        All
      </button>
      {visible.map((cluster) => {
        const label =
          cluster.label || cluster.label_keywords.slice(0, 2).join(', ') || `Cluster ${cluster.id}`;
        return (
          <button
            key={cluster.id}
            onClick={() => onSelect(cluster.id)}
            className={`px-2 py-0.5 rounded text-xs border transition-colors ${
              selectedCluster === cluster.id
                ? 'bg-white/10 border-white/20 text-white/70'
                : 'bg-transparent border-white/8 text-white/25 hover:text-white/40'
            }`}
          >
            {label}
            <span className="ml-1 text-white/15 font-mono">{cluster.size}</span>
          </button>
        );
      })}
      {hasMore && (
        <button
          onClick={() => setExpanded(!expanded)}
          className="px-2 py-0.5 rounded text-[10px] border border-white/8 text-white/25 hover:text-white/40 transition-colors"
        >
          {expanded ? 'fewer' : `+${sorted.length - INITIAL_PILLS}`}
        </button>
      )}
    </div>
  );
}
