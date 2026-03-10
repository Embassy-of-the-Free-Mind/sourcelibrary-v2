'use client';

import { useState, useRef, useCallback, useEffect, useMemo } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';

// ────────────────────────────────────────────────────────────
// Types
// ────────────────────────────────────────────────────────────

interface ImageItem {
  id: string;
  type: string;
  quality: number;
  thumbnail: string;
  book_title: string;
  book_author: string;
  book_year: number | null;
  book_id: string;
  book_slug?: string;
  subjects: string[];
  x: number;
  y: number;
  z: number;
  cluster: number;
}

interface ClusterInfo {
  id: number;
  size: number;
  label: string;
  top_type: string;
  top_subjects: string[];
  cx: number;
  cy: number;
  cz: number;
}

interface ConstellationData {
  meta: {
    total_images: number;
    n_clusters: number;
    quality_threshold: number;
    generated_at: string;
  };
  clusters: Record<string, ClusterInfo>;
  images: ImageItem[];
}

// ────────────────────────────────────────────────────────────
// Colors — by image type
// ────────────────────────────────────────────────────────────

const TYPE_COLORS: Record<string, string> = {
  emblem: '#c9a86c',
  woodcut: '#8b9a7d',
  engraving: '#607d8b',
  portrait: '#9e4a3a',
  frontispiece: '#d4924a',
  diagram: '#7c5db5',
  map: '#1abc9c',
  symbol: '#e91e63',
  decorative: '#795548',
  musical_score: '#5d8fb5',
  illustration: '#4a9e7c',
  chart: '#00bcd4',
  botanical: '#4caf50',
  anatomical: '#e74c3c',
  coat_of_arms: '#673ab7',
};

const CLUSTER_COLORS = [
  '#e74c3c', '#3498db', '#2ecc71', '#f39c12', '#9b59b6',
  '#1abc9c', '#e91e63', '#00bcd4', '#ff9800', '#673ab7',
  '#4caf50', '#795548', '#607d8b', '#ff5722', '#009688',
  '#8bc34a', '#c9a86c', '#5d8fb5', '#d4924a', '#a067a0',
  '#5e6d52', '#b5835d', '#7c5db5', '#9e4a3a', '#4a9e7c',
];

type ColorMode = 'type' | 'cluster' | 'century';

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

function getImageColor(img: ImageItem, mode: ColorMode): string {
  switch (mode) {
    case 'type': return TYPE_COLORS[img.type] || '#666';
    case 'cluster': return CLUSTER_COLORS[img.cluster % CLUSTER_COLORS.length];
    case 'century': return getCenturyColor(img.book_year);
  }
}

function hexToRgb(hex: string): [number, number, number] {
  const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  return result
    ? [parseInt(result[1], 16) / 255, parseInt(result[2], 16) / 255, parseInt(result[3], 16) / 255]
    : [0.4, 0.4, 0.4];
}

function seededRandom(seed: number): number {
  const x = Math.sin(seed * 12.9898 + 78.233) * 43758.5453;
  return x - Math.floor(x);
}

// ────────────────────────────────────────────────────────────
// Constants
// ────────────────────────────────────────────────────────────

const SPREAD = 40;
const POINT_SIZE = 0.35;
const HOVER_SCALE = 3.0;

// ────────────────────────────────────────────────────────────
// Component
// ────────────────────────────────────────────────────────────

export default function ImageConstellationViz({ data }: { data: ConstellationData }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
  const sceneRef = useRef<THREE.Scene | null>(null);
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);
  const controlsRef = useRef<OrbitControls | null>(null);
  const meshRef = useRef<THREE.InstancedMesh | null>(null);
  const labelGroupRef = useRef<THREE.Group | null>(null);
  const animFrameRef = useRef<number>(0);

  const imgPosRef = useRef<Float32Array>(new Float32Array(0));
  const imgRotRef = useRef<Float32Array>(new Float32Array(0));

  const hoveredLabelRef = useRef<THREE.Sprite | null>(null);
  const raycasterRef = useRef<THREE.Raycaster>(new THREE.Raycaster());

  const [hoveredIdx, setHoveredIdx] = useState<number | null>(null);
  const [selectedIdx, setSelectedIdx] = useState<number | null>(null);
  const [colorMode, setColorMode] = useState<ColorMode>('type');
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCluster, setSelectedCluster] = useState<number | null>(null);
  const [tooltipPos, setTooltipPos] = useState<{ x: number; y: number } | null>(null);
  const [selectedPos, setSelectedPos] = useState<{ x: number; y: number } | null>(null);
  const [showInfo, setShowInfo] = useState(false);
  const [cursorStyle, setCursorStyle] = useState('grab');

  const searchMatches = useMemo(() => {
    if (!searchQuery || searchQuery.length < 2) return null;
    const q = searchQuery.toLowerCase();
    const matches = new Set<number>();
    data.images.forEach((img, i) => {
      if (
        img.book_title.toLowerCase().includes(q) ||
        img.book_author.toLowerCase().includes(q) ||
        img.type.toLowerCase().includes(q) ||
        img.subjects.some((s) => s.toLowerCase().includes(q))
      ) {
        matches.add(i);
      }
    });
    return matches;
  }, [searchQuery, data.images]);

  const clusterImages = useMemo(() => {
    if (selectedCluster === null) return [];
    return data.images
      .filter((img) => img.cluster === selectedCluster)
      .sort((a, b) => (b.quality || 0) - (a.quality || 0));
  }, [selectedCluster, data.images]);

  const selectedClusterInfo = selectedCluster !== null ? data.clusters[String(selectedCluster)] : null;

  const stats = useMemo(() => ({
    totalImages: data.meta.total_images,
    nClusters: data.meta.n_clusters,
    nTypes: new Set(data.images.map((img) => img.type)).size,
    nBooks: new Set(data.images.map((img) => img.book_id)).size,
  }), [data]);

  const legendItems = useMemo(() => {
    if (colorMode === 'type') {
      const counts: Record<string, number> = {};
      data.images.forEach((img) => { counts[img.type] = (counts[img.type] || 0) + 1; });
      return Object.entries(counts)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 12)
        .map(([type, count]) => ({
          label: type.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase()),
          color: TYPE_COLORS[type] || '#666',
          count,
        }));
    }
    if (colorMode === 'cluster') {
      return Object.values(data.clusters)
        .sort((a, b) => b.size - a.size)
        .slice(0, 10)
        .map((c) => ({
          label: c.label,
          color: CLUSTER_COLORS[c.id % CLUSTER_COLORS.length],
          count: c.size,
        }));
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

  // ── Initialize Three.js ──
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

    // InstancedMesh
    const n = data.images.length;
    const geometry = new THREE.BoxGeometry(POINT_SIZE, POINT_SIZE, POINT_SIZE);
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
      const img = data.images[i];
      const px = (img.x - 0.5) * SPREAD;
      const py = (img.y - 0.5) * SPREAD;
      const pz = (img.z - 0.5) * SPREAD;
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

      const [r, g, b] = hexToRgb(getImageColor(img, 'type'));
      tempColor.setRGB(r, g, b);
      mesh.setColorAt(i, tempColor);
    }

    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    scene.add(mesh);
    meshRef.current = mesh;
    imgPosRef.current = positions;
    imgRotRef.current = rotations;

    // Cluster label sprites
    const labelGroup = new THREE.Group();
    labelGroup.name = 'clusterLabels';
    for (const [, cluster] of Object.entries(data.clusters)) {
      const text = cluster.label;
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
        opacity: 0.55,
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

    function animate() {
      animFrameRef.current = requestAnimationFrame(animate);
      controls.update();
      renderer.render(scene, camera);
    }
    animate();

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

  // ── Update colors & scales ──
  useEffect(() => {
    const mesh = meshRef.current;
    if (!mesh) return;

    const n = data.images.length;
    const positions = imgPosRef.current;
    const rotations = imgRotRef.current;
    const dummy = new THREE.Object3D();
    const tempColor = new THREE.Color();

    const hasSearch = searchMatches && searchMatches.size > 0;
    const hasCluster = selectedCluster !== null;

    for (let i = 0; i < n; i++) {
      const img = data.images[i];
      const isSearchMatch = hasSearch ? searchMatches!.has(i) : true;
      const isClusterMatch = hasCluster ? img.cluster === selectedCluster : true;
      const isHighlighted = isSearchMatch && isClusterMatch;
      const isHovered = i === hoveredIdx;
      const isSelected = i === selectedIdx;

      const hex = getImageColor(img, colorMode);
      const [r, g, bl] = hexToRgb(hex);
      if (isHighlighted || isHovered || isSelected) {
        tempColor.setRGB(r, g, bl);
      } else {
        tempColor.setRGB(r * 0.12, g * 0.12, bl * 0.12);
      }
      mesh.setColorAt(i, tempColor);

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
  }, [colorMode, searchMatches, selectedCluster, hoveredIdx, selectedIdx, data.images]);

  // ── Pointer move ──
  const handlePointerMove = useCallback(
    (e: React.PointerEvent) => {
      const container = containerRef.current;
      const camera = cameraRef.current;
      const labelGroup = labelGroupRef.current;
      if (!container || !camera) return;

      const rect = container.getBoundingClientRect();
      const mx = e.clientX - rect.left;
      const my = e.clientY - rect.top;
      const ndcX = (mx / rect.width) * 2 - 1;
      const ndcY = -(my / rect.height) * 2 + 1;
      raycasterRef.current.setFromCamera(new THREE.Vector2(ndcX, ndcY), camera);

      if (labelGroup) {
        const prevLabel = hoveredLabelRef.current;
        const labelIntersects = raycasterRef.current.intersectObjects(labelGroup.children);
        if (labelIntersects.length > 0) {
          const sprite = labelIntersects[0].object as THREE.Sprite;
          if (prevLabel && prevLabel !== sprite) {
            (prevLabel.material as THREE.SpriteMaterial).opacity = 0.55;
          }
          (sprite.material as THREE.SpriteMaterial).opacity = 0.85;
          hoveredLabelRef.current = sprite;
          setCursorStyle('pointer');
          setHoveredIdx(null);
          setTooltipPos(null);
          return;
        }
        if (prevLabel) {
          (prevLabel.material as THREE.SpriteMaterial).opacity = 0.55;
          hoveredLabelRef.current = null;
        }
      }

      const mesh = meshRef.current;
      if (mesh) {
        const intersects = raycasterRef.current.intersectObject(mesh);
        if (intersects.length > 0 && intersects[0].instanceId !== undefined) {
          setHoveredIdx(intersects[0].instanceId);
          setTooltipPos({ x: mx, y: my });
          setCursorStyle('pointer');
        } else {
          setHoveredIdx(null);
          setTooltipPos(null);
          setCursorStyle('grab');
        }
      }
    },
    [data.images.length],
  );

  // ── Click handler ──
  const handleClick = useCallback(
    (e: React.MouseEvent) => {
      const container = containerRef.current;
      const camera = cameraRef.current;
      if (!container || !camera) return;

      const rect = container.getBoundingClientRect();
      const mx = e.clientX - rect.left;
      const my = e.clientY - rect.top;
      const ndcX = (mx / rect.width) * 2 - 1;
      const ndcY = -(my / rect.height) * 2 + 1;
      raycasterRef.current.setFromCamera(new THREE.Vector2(ndcX, ndcY), camera);

      const labelGroup = labelGroupRef.current;
      if (labelGroup) {
        const labelIntersects = raycasterRef.current.intersectObjects(labelGroup.children);
        if (labelIntersects.length > 0) {
          const sprite = labelIntersects[0].object as THREE.Sprite;
          const cId = sprite.userData.clusterId as number;
          if (cId !== undefined) {
            setSelectedCluster((prev) => (prev === cId ? null : cId));
            setSelectedIdx(null);
            setSelectedPos(null);
            return;
          }
        }
      }

      const mesh = meshRef.current;
      if (mesh) {
        const intersects = raycasterRef.current.intersectObject(mesh);
        if (intersects.length > 0 && intersects[0].instanceId !== undefined) {
          setSelectedIdx(intersects[0].instanceId);
          setSelectedPos({ x: mx, y: my });
          return;
        }
      }

      setSelectedIdx(null);
      setSelectedPos(null);
    },
    [],
  );

  const resetView = useCallback(() => {
    setSearchQuery('');
    setSelectedCluster(null);
    setSelectedIdx(null);
    setSelectedPos(null);
    const camera = cameraRef.current;
    const controls = controlsRef.current;
    if (camera && controls) {
      camera.position.set(SPREAD * 0.8, -SPREAD * 0.6, SPREAD * 1.2);
      controls.target.set(0, 0, 0);
      controls.update();
    }
  }, []);

  const hoveredImage = hoveredIdx !== null ? data.images[hoveredIdx] : null;

  return (
    <div className="relative w-full h-full select-none">
      {/* Three.js canvas */}
      <div
        ref={containerRef}
        className="absolute inset-0"
        style={{ cursor: cursorStyle }}
        onPointerMove={handlePointerMove}
        onClick={handleClick}
      />

      {/* Top-left: branding */}
      <div className="absolute top-4 left-5 z-10">
        <a
          href="/"
          className="text-white/30 hover:text-white/60 text-xs font-mono tracking-[0.2em] uppercase transition-colors"
        >
          Source Library
        </a>
        <div className="text-white/70 font-serif text-xl leading-tight">Image Atlas</div>
        <div className="text-white/25 text-xs mt-0.5 font-mono">
          {stats.totalImages.toLocaleString()} illustrations from {stats.nBooks.toLocaleString()} books
        </div>
      </div>

      {/* Top-right: controls */}
      <div className="absolute top-4 right-5 z-10 flex items-center gap-2">
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

        {(['type', 'cluster', 'century'] as ColorMode[]).map((mode) => (
          <button
            key={mode}
            onClick={() => setColorMode(mode)}
            className={`px-2.5 py-1 text-xs rounded border transition-colors ${
              colorMode === mode
                ? 'bg-white/10 border-white/20 text-white/80'
                : 'bg-transparent border-white/8 text-white/30 hover:text-white/50 hover:border-white/15'
            }`}
          >
            {mode === 'type' ? 'Type' : mode === 'cluster' ? 'Topic' : 'Century'}
          </button>
        ))}

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

        <button
          onClick={resetView}
          className="px-2.5 py-1 text-xs rounded border border-white/8 text-white/30 hover:text-white/50 hover:border-white/15 transition-colors"
        >
          Reset
        </button>
      </div>

      {/* Info panel */}
      {showInfo && (
        <div
          className="absolute top-14 right-5 w-[300px] bg-white/95 backdrop-blur-md border border-black/10 rounded-md p-4 z-20 max-h-[85vh] overflow-y-auto shadow-lg"
          onPointerMove={(e) => e.stopPropagation()}
          onClick={(e) => e.stopPropagation()}
        >
          <div className="grid grid-cols-2 gap-3 mb-4">
            <div><div className="text-gray-800 font-mono text-xl">{stats.totalImages.toLocaleString()}</div><div className="text-gray-400 text-xs uppercase tracking-wider">Images</div></div>
            <div><div className="text-gray-800 font-mono text-xl">{stats.nClusters}</div><div className="text-gray-400 text-xs uppercase tracking-wider">Clusters</div></div>
            <div><div className="text-gray-800 font-mono text-xl">{stats.nTypes}</div><div className="text-gray-400 text-xs uppercase tracking-wider">Image Types</div></div>
            <div><div className="text-gray-800 font-mono text-xl">{stats.nBooks.toLocaleString()}</div><div className="text-gray-400 text-xs uppercase tracking-wider">Books</div></div>
          </div>
          <div className="border-t border-gray-200 pt-3 text-gray-500 text-sm leading-relaxed space-y-2">
            <p>
              Each cube is an illustration extracted from a pre-modern text. Position
              reflects visual/thematic similarity — AI descriptions of subjects, figures,
              and symbols are embedded and projected with UMAP.
            </p>
            <p>
              <strong className="text-gray-600">Embeddings:</strong>{' '}
              <span className="font-mono text-xs">paraphrase-multilingual-MiniLM-L12-v2</span>{' '}
              (384-dim). UMAP with cosine distance.
            </p>
            <p>
              <strong className="text-gray-600">Z-axis:</strong>{' '}
              Source book publication year.
            </p>
            <p>
              <strong className="text-gray-600">Color:</strong>{' '}
              Default by image type (emblem, woodcut, engraving, etc.).
            </p>
          </div>
          <div className="border-t border-gray-200 mt-3 pt-3">
            <a
              href="/research/atlas"
              className="text-gray-400 text-sm hover:text-gray-600 transition-colors"
            >
              View Book Atlas &rarr;
            </a>
          </div>
        </div>
      )}

      {/* Hover tooltip */}
      {hoveredImage && tooltipPos && selectedIdx !== hoveredIdx && (
        <div
          className="absolute pointer-events-none bg-white/95 backdrop-blur-md border border-black/10 rounded-md p-3 max-w-[280px] z-20 shadow-lg"
          style={{
            left: Math.min(tooltipPos.x + 14, (containerRef.current?.clientWidth ?? 600) - 290),
            top: Math.max(tooltipPos.y - 70, 10),
          }}
        >
          <div className="flex items-center gap-1.5 mb-1">
            <span className="px-1.5 py-0.5 text-xs rounded bg-gray-100 text-gray-600">
              {hoveredImage.type.replace(/_/g, ' ')}
            </span>
            {hoveredImage.subjects.slice(0, 2).map((s) => (
              <span key={s} className="px-1.5 py-0.5 text-xs rounded bg-gray-100 text-gray-400">{s}</span>
            ))}
          </div>
          <div className="text-sm text-gray-500 leading-tight">
            {hoveredImage.book_title}
            {hoveredImage.book_year ? ` (${hoveredImage.book_year})` : ''}
          </div>
        </div>
      )}

      {/* Selected image panel */}
      {selectedIdx !== null && selectedPos && (() => {
        const img = data.images[selectedIdx];
        if (!img) return null;
        const ci = data.clusters[String(img.cluster)];
        return (
          <div
            className="absolute bg-white/95 backdrop-blur-md border border-black/10 rounded-md p-4 max-w-[320px] z-20 shadow-lg"
            style={{
              left: Math.min(selectedPos.x + 14, (containerRef.current?.clientWidth ?? 600) - 330),
              top: Math.max(selectedPos.y - 120, 10),
            }}
            onPointerMove={(e) => e.stopPropagation()}
            onClick={(e) => e.stopPropagation()}
          >
            <button
              onClick={() => { setSelectedIdx(null); setSelectedPos(null); }}
              className="absolute top-2 right-2.5 text-gray-400 hover:text-gray-600 text-sm leading-none"
              aria-label="Close"
            >
              &times;
            </button>

            {/* Image thumbnail */}
            {img.thumbnail && (
              <div className="mb-3 rounded overflow-hidden bg-gray-100" style={{ maxHeight: 180 }}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={img.thumbnail}
                  alt={img.subjects.join(', ') || img.type}
                  className="w-full object-contain"
                  style={{ maxHeight: 180 }}
                  loading="lazy"
                />
              </div>
            )}

            <div className="flex items-center gap-1.5 mb-2 flex-wrap">
              <span className="px-1.5 py-0.5 text-xs rounded bg-gray-100 text-gray-600 font-medium">
                {img.type.replace(/_/g, ' ')}
              </span>
              <span className="px-1.5 py-0.5 text-xs rounded bg-amber-50 text-amber-700 font-mono">
                {img.quality.toFixed(2)}
              </span>
            </div>

            {img.subjects.length > 0 && (
              <div className="flex flex-wrap gap-1 mb-2">
                {img.subjects.map((s) => (
                  <span key={s} className="px-1.5 py-0.5 text-xs rounded bg-gray-100 text-gray-500">{s}</span>
                ))}
              </div>
            )}

            <a
              href={`/book/${img.book_slug || img.book_id}`}
              target="_blank"
              rel="noopener noreferrer"
              className="font-serif text-sm text-gray-900 hover:text-black leading-tight block mb-1 pr-4"
            >
              {img.book_title}
            </a>
            <div className="text-sm text-gray-500 mb-2">
              {img.book_author !== 'Unknown' ? img.book_author : ''}
              {img.book_author !== 'Unknown' && img.book_year ? ' · ' : ''}
              {img.book_year || ''}
            </div>

            <div className="flex items-center gap-2 text-xs">
              <a
                href={`/gallery?book=${img.book_id}`}
                target="_blank"
                rel="noopener noreferrer"
                className="text-gray-400 hover:text-gray-600 transition-colors"
              >
                View in Gallery &rarr;
              </a>
              {ci && (
                <button
                  onClick={() => setSelectedCluster(ci.id)}
                  className="text-gray-400 hover:text-gray-600 transition-colors"
                >
                  Cluster: {ci.label} ({ci.size}) &rarr;
                </button>
              )}
            </div>
          </div>
        );
      })()}

      {/* Bottom-left: legend */}
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

      {/* Bottom: cluster pills */}
      <div className={`absolute bottom-3 left-5 z-10 ${selectedCluster !== null ? 'right-[370px]' : 'right-5'}`}>
        <ClusterPills
          clusters={data.clusters}
          selectedCluster={selectedCluster}
          onSelect={(id) => {
            setSelectedCluster(selectedCluster === id ? null : id);
            setSelectedIdx(null);
            setSelectedPos(null);
          }}
          onClear={() => { setSelectedCluster(null); }}
        />
      </div>

      {/* Bottom-right: hint */}
      <div className="absolute bottom-12 right-5 z-10 text-xs text-white/20 font-mono">
        Click to inspect · Drag to rotate · Scroll to zoom
      </div>

      {/* Cluster detail panel */}
      {selectedCluster !== null && selectedClusterInfo && (
        <div
          className="absolute top-0 right-0 w-[360px] h-full bg-white/95 backdrop-blur-md border-l border-black/10 z-30 flex flex-col shadow-2xl"
          onPointerMove={(e) => e.stopPropagation()}
          onClick={(e) => e.stopPropagation()}
        >
          <div className="p-4 border-b border-gray-200 flex items-center justify-between shrink-0">
            <div>
              <h3 className="text-gray-900 font-serif text-lg leading-tight">{selectedClusterInfo.label}</h3>
              <p className="text-gray-400 text-sm mt-0.5 font-mono">{clusterImages.length} images</p>
            </div>
            <button
              onClick={() => setSelectedCluster(null)}
              className="text-gray-400 hover:text-gray-600 text-lg leading-none transition-colors"
              aria-label="Close cluster panel"
            >
              &times;
            </button>
          </div>
          <div className="flex-1 overflow-y-auto p-3 min-h-0">
            <div className="grid grid-cols-2 gap-2">
              {clusterImages.slice(0, 60).map((img) => (
                <a
                  key={img.id}
                  href={`/gallery?book=${img.book_id}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="block rounded-md border border-gray-100 hover:border-gray-300 overflow-hidden transition-colors group"
                >
                  {img.thumbnail ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={img.thumbnail}
                      alt={img.subjects.join(', ') || img.type}
                      className="w-full h-28 object-cover bg-gray-100"
                      loading="lazy"
                    />
                  ) : (
                    <div className="w-full h-28 bg-gray-100 flex items-center justify-center text-gray-300 text-xs">
                      No image
                    </div>
                  )}
                  <div className="p-1.5">
                    <div className="text-gray-400 text-xs truncate group-hover:text-gray-600">{img.book_title}</div>
                    <span className="px-1 py-0.5 text-[10px] rounded bg-gray-100 text-gray-400">{img.type.replace(/_/g, ' ')}</span>
                  </div>
                </a>
              ))}
            </div>
          </div>
          <div className="p-3 border-t border-gray-200 shrink-0">
            <a
              href={`/gallery`}
              target="_blank"
              rel="noopener noreferrer"
              className="text-gray-400 text-sm hover:text-gray-600 transition-colors"
            >
              Browse full gallery &rarr;
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
      {visible.map((cluster) => (
        <button
          key={cluster.id}
          onClick={() => onSelect(cluster.id)}
          className={`px-2 py-0.5 rounded text-xs border transition-colors ${
            selectedCluster === cluster.id
              ? 'bg-white/10 border-white/20 text-white/70'
              : 'bg-transparent border-white/8 text-white/25 hover:text-white/40'
          }`}
        >
          {cluster.label}
          <span className="ml-1 text-white/15 font-mono">{cluster.size}</span>
        </button>
      ))}
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
