'use client';

import { useEffect, useRef, useState, useMemo, useCallback } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import MapSidebar from './MapSidebar';

export interface MapEntity {
  name: string;
  type: 'person' | 'place' | 'concept';
  coordinates: { lat: number; lng: number };
  book_count: number;
  total_mentions: number;
  description?: string;
  wikidata_id?: string;
  century_range: [number, number] | null;
}

interface EntityMapProps {
  entities: MapEntity[];
  stats: {
    total: number;
    by_type: Record<string, number>;
    by_century: Record<string, number>;
  };
}

const TYPE_COLORS: Record<string, string> = {
  person: '#9e4a3a',
  place: '#8b9a7d',
  concept: '#7c5db5',
};

function createCircleIcon(type: string, bookCount: number) {
  const color = TYPE_COLORS[type] || '#999';
  const size = Math.max(8, Math.min(20, 6 + Math.log2(bookCount + 1) * 3));
  return L.divIcon({
    className: 'entity-marker',
    html: `<div style="
      width: ${size}px;
      height: ${size}px;
      border-radius: 50%;
      background: ${color};
      border: 2px solid white;
      box-shadow: 0 1px 4px rgba(0,0,0,0.3);
      cursor: pointer;
    "></div>`,
    iconSize: [size, size],
    iconAnchor: [size / 2, size / 2],
  });
}

function createClusterIcon(count: number) {
  const size = Math.max(30, Math.min(50, 28 + Math.log10(count) * 12));
  return L.divIcon({
    className: 'cluster-marker',
    html: `<div style="
      width: ${size}px;
      height: ${size}px;
      border-radius: 50%;
      background: rgba(26, 22, 18, 0.8);
      color: white;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 12px;
      font-weight: 600;
      font-family: var(--font-sans);
      border: 2px solid rgba(255,255,255,0.6);
      box-shadow: 0 2px 8px rgba(0,0,0,0.3);
      cursor: pointer;
    ">${count}</div>`,
    iconSize: [size, size],
    iconAnchor: [size / 2, size / 2],
  });
}

export default function EntityMap({ entities, stats }: EntityMapProps) {
  const mapRef = useRef<L.Map | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const markersRef = useRef<L.LayerGroup | null>(null);

  const [selected, setSelected] = useState<MapEntity | null>(null);
  const [filters, setFilters] = useState({
    types: new Set(['person', 'place', 'concept']),
    minBooks: 1,
    centuryFrom: 1,
    centuryTo: 21,
  });

  // Derive available century range from data
  const centuryRange = useMemo(() => {
    const centuries = Object.keys(stats.by_century).map(Number).sort((a, b) => a - b);
    return centuries.length > 0
      ? { min: centuries[0], max: centuries[centuries.length - 1] }
      : { min: 1, max: 21 };
  }, [stats.by_century]);

  // Filter entities
  const filtered = useMemo(() => {
    return entities.filter((e) => {
      if (!filters.types.has(e.type)) return false;
      if (e.book_count < filters.minBooks) return false;
      if (e.century_range) {
        const [lo, hi] = e.century_range;
        if (hi < filters.centuryFrom || lo > filters.centuryTo) return false;
      }
      return true;
    });
  }, [entities, filters]);

  // Initialize map
  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;

    const map = L.map(containerRef.current, {
      center: [48.5, 12],
      zoom: 5,
      zoomControl: false,
      attributionControl: false,
    });

    L.control.zoom({ position: 'topright' }).addTo(map);
    L.control.attribution({ position: 'bottomright', prefix: false }).addTo(map);

    L.tileLayer('https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png', {
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OSM</a> &copy; <a href="https://carto.com/">CARTO</a>',
      maxZoom: 18,
    }).addTo(map);

    mapRef.current = map;
    markersRef.current = L.layerGroup().addTo(map);

    return () => {
      map.remove();
      mapRef.current = null;
      markersRef.current = null;
    };
  }, []);

  // Update selection callback (stable ref)
  const handleSelect = useCallback((entity: MapEntity) => {
    setSelected(entity);
  }, []);

  // Render markers with simple grid clustering
  useEffect(() => {
    const map = mapRef.current;
    const layerGroup = markersRef.current;
    if (!map || !layerGroup) return;

    layerGroup.clearLayers();

    const zoom = map.getZoom();
    // Grid-based clustering: cell size shrinks with zoom
    const cellSize = Math.max(0.5, 40 / Math.pow(2, zoom));

    // Group entities into grid cells
    const grid = new Map<string, MapEntity[]>();
    for (const e of filtered) {
      const cellX = Math.floor(e.coordinates.lng / cellSize);
      const cellY = Math.floor(e.coordinates.lat / cellSize);
      const key = `${cellX}:${cellY}`;
      if (!grid.has(key)) grid.set(key, []);
      grid.get(key)!.push(e);
    }

    for (const [, group] of grid) {
      if (group.length === 1 || zoom >= 10) {
        // Individual markers
        for (const e of group) {
          const marker = L.marker([e.coordinates.lat, e.coordinates.lng], {
            icon: createCircleIcon(e.type, e.book_count),
          });
          marker.bindTooltip(e.name, {
            direction: 'top',
            offset: [0, -6],
            className: 'entity-tooltip',
          });
          marker.on('click', () => handleSelect(e));
          layerGroup.addLayer(marker);
        }
      } else {
        // Cluster marker at centroid
        const avgLat = group.reduce((s, e) => s + e.coordinates.lat, 0) / group.length;
        const avgLng = group.reduce((s, e) => s + e.coordinates.lng, 0) / group.length;
        const cluster = L.marker([avgLat, avgLng], {
          icon: createClusterIcon(group.length),
        });
        cluster.bindTooltip(`${group.length} entities`, {
          direction: 'top',
          offset: [0, -10],
        });
        cluster.on('click', () => {
          map.setView([avgLat, avgLng], zoom + 2);
        });
        layerGroup.addLayer(cluster);
      }
    }
  }, [filtered, handleSelect]);

  // Re-render markers on zoom change
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    const onZoom = () => {
      // Trigger re-render by updating a hidden state
      setFilters(f => ({ ...f }));
    };
    map.on('zoomend', onZoom);
    return () => { map.off('zoomend', onZoom); };
  }, []);

  return (
    <div className="flex flex-col lg:flex-row h-[calc(100vh-64px)] min-h-[500px]">
      {/* Map */}
      <div className="flex-1 relative">
        <div ref={containerRef} className="absolute inset-0 z-0" />

        {/* Floating filter bar */}
        <div
          className="absolute top-3 left-3 z-[1000] rounded-lg px-4 py-2.5 flex flex-wrap items-center gap-3 text-sm shadow-md"
          style={{ background: 'rgba(255,255,255,0.95)', border: '1px solid var(--border-light)' }}
        >
          {/* Entity type toggles */}
          {(['person', 'place', 'concept'] as const).map((type) => {
            const active = filters.types.has(type);
            return (
              <button
                key={type}
                onClick={() => {
                  setFilters((f) => {
                    const next = new Set(f.types);
                    if (next.has(type)) next.delete(type); else next.add(type);
                    return { ...f, types: next };
                  });
                }}
                className="flex items-center gap-1.5 transition-opacity"
                style={{ opacity: active ? 1 : 0.35 }}
              >
                <span
                  className="w-3 h-3 rounded-full inline-block"
                  style={{ background: TYPE_COLORS[type] }}
                />
                <span style={{ color: 'var(--text-secondary)' }}>
                  {type === 'person' ? 'People' : type === 'place' ? 'Places' : 'Concepts'}
                </span>
              </button>
            );
          })}

          <span className="w-px h-5 mx-1" style={{ background: 'var(--border-light)' }} />

          {/* Min books */}
          <label className="flex items-center gap-1.5" style={{ color: 'var(--text-muted)' }}>
            Min books
            <select
              value={filters.minBooks}
              onChange={(e) => setFilters((f) => ({ ...f, minBooks: Number(e.target.value) }))}
              className="rounded px-1.5 py-0.5 text-sm"
              style={{ border: '1px solid var(--border-light)', color: 'var(--text-secondary)' }}
            >
              {[1, 2, 3, 5, 10, 20].map((n) => (
                <option key={n} value={n}>{n}+</option>
              ))}
            </select>
          </label>

          <span className="w-px h-5 mx-1" style={{ background: 'var(--border-light)' }} />

          {/* Century range */}
          <label className="flex items-center gap-1.5" style={{ color: 'var(--text-muted)' }}>
            Century
            <select
              value={filters.centuryFrom}
              onChange={(e) => setFilters((f) => ({ ...f, centuryFrom: Number(e.target.value) }))}
              className="rounded px-1.5 py-0.5 text-sm"
              style={{ border: '1px solid var(--border-light)', color: 'var(--text-secondary)' }}
            >
              {Array.from({ length: centuryRange.max - centuryRange.min + 1 }, (_, i) => centuryRange.min + i).map((c) => (
                <option key={c} value={c}>{c}th</option>
              ))}
            </select>
            <span style={{ color: 'var(--text-muted)' }}>to</span>
            <select
              value={filters.centuryTo}
              onChange={(e) => setFilters((f) => ({ ...f, centuryTo: Number(e.target.value) }))}
              className="rounded px-1.5 py-0.5 text-sm"
              style={{ border: '1px solid var(--border-light)', color: 'var(--text-secondary)' }}
            >
              {Array.from({ length: centuryRange.max - centuryRange.min + 1 }, (_, i) => centuryRange.min + i).map((c) => (
                <option key={c} value={c}>{c}th</option>
              ))}
            </select>
          </label>

          <span className="w-px h-5 mx-1 hidden sm:block" style={{ background: 'var(--border-light)' }} />

          {/* Count */}
          <span className="text-xs" style={{ color: 'var(--text-muted)' }}>
            {filtered.length.toLocaleString()} / {entities.length.toLocaleString()}
          </span>
        </div>
      </div>

      {/* Sidebar */}
      <MapSidebar entity={selected} onClose={() => setSelected(null)} />

      {/* Tooltip style override */}
      <style jsx global>{`
        .entity-tooltip {
          font-family: var(--font-sans);
          font-size: 13px;
          padding: 4px 8px;
          border-radius: 6px;
          box-shadow: 0 2px 8px rgba(0,0,0,0.15);
        }
        .entity-marker, .cluster-marker {
          background: none !important;
          border: none !important;
        }
      `}</style>
    </div>
  );
}
