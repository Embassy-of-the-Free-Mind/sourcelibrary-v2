'use client';

import { useEffect, useRef, useState, useMemo, useCallback } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';

export interface BookLocation {
  city: string;
  country: string | null;
  lat: number;
  lng: number;
  type: 'publication' | 'author_birth' | 'author_death';
  books: Array<{
    id: string;
    title: string;
    author: string;
    year: number | null;
    slug: string;
  }>;
}

interface BookMapProps {
  locations: BookLocation[];
  stats: {
    total_books: number;
    total_locations: number;
    by_type: Record<string, number>;
  };
}

const TYPE_CONFIG: Record<string, { color: string; label: string; lightBg: string }> = {
  publication:  { color: '#9e4a3a', label: 'Published here',  lightBg: 'rgba(158,74,58,0.1)' },
  author_birth: { color: '#5a7d8b', label: 'Author born here', lightBg: 'rgba(90,125,139,0.1)' },
  author_death: { color: '#8b7d5a', label: 'Author died here', lightBg: 'rgba(139,125,90,0.1)' },
};

function createLocationIcon(type: string, bookCount: number) {
  const config = TYPE_CONFIG[type] || { color: '#999' };
  const size = Math.max(8, Math.min(22, 6 + Math.log2(bookCount + 1) * 3));
  return L.divIcon({
    className: 'book-marker',
    html: `<div style="
      width: ${size}px; height: ${size}px; border-radius: 50%;
      background: ${config.color}; opacity: 0.85;
      border: 1.5px solid rgba(255,255,255,0.9);
      box-shadow: 0 1px 3px rgba(0,0,0,0.2);
      cursor: pointer; transition: transform 0.15s;
    "></div>`,
    iconSize: [size, size],
    iconAnchor: [size / 2, size / 2],
  });
}

function createClusterIcon(count: number, types: Set<string>) {
  const size = Math.max(28, Math.min(46, 26 + Math.log10(count) * 11));
  const colors = [...types].map(t => TYPE_CONFIG[t]?.color || '#999');
  const bg = colors.length === 1 ? colors[0] : '#3d3529';
  return L.divIcon({
    className: 'cluster-marker',
    html: `<div style="
      width: ${size}px; height: ${size}px; border-radius: 50%;
      background: ${bg}; opacity: 0.85; color: rgba(255,255,255,0.95);
      display: flex; align-items: center; justify-content: center;
      font-size: 11px; font-weight: 600; letter-spacing: 0.02em;
      font-family: var(--font-sans);
      border: 1.5px solid rgba(255,255,255,0.5);
      box-shadow: 0 1px 6px rgba(0,0,0,0.15);
      cursor: pointer;
    ">${count.toLocaleString()}</div>`,
    iconSize: [size, size],
    iconAnchor: [size / 2, size / 2],
  });
}

export default function BookMap({ locations, stats }: BookMapProps) {
  const mapRef = useRef<L.Map | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const markersRef = useRef<L.LayerGroup | null>(null);

  const [selected, setSelected] = useState<BookLocation | null>(null);
  const [filters, setFilters] = useState({
    types: new Set(['publication', 'author_birth', 'author_death']),
    minBooks: 1,
  });

  const filtered = useMemo(() => {
    return locations.filter((loc) => {
      if (!filters.types.has(loc.type)) return false;
      return loc.books.length >= filters.minBooks;
    });
  }, [locations, filters]);

  // Initialize map
  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;

    const map = L.map(containerRef.current, {
      center: [46, 10],
      zoom: 5,
      zoomControl: false,
      attributionControl: false,
    });

    L.control.zoom({ position: 'bottomright' }).addTo(map);
    L.control.attribution({ position: 'bottomleft', prefix: false }).addTo(map);

    // Warm-toned tile layer
    L.tileLayer('https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png', {
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OSM</a> &copy; <a href="https://carto.com/">CARTO</a>',
      maxZoom: 18,
    }).addTo(map);

    mapRef.current = map;
    markersRef.current = L.layerGroup().addTo(map);

    return () => { map.remove(); mapRef.current = null; markersRef.current = null; };
  }, []);

  const handleSelect = useCallback((loc: BookLocation) => {
    setSelected(loc);
  }, []);

  // Render markers
  useEffect(() => {
    const map = mapRef.current;
    const layerGroup = markersRef.current;
    if (!map || !layerGroup) return;

    layerGroup.clearLayers();
    const zoom = map.getZoom();
    const cellSize = Math.max(0.5, 40 / Math.pow(2, zoom));

    const grid = new Map<string, BookLocation[]>();
    for (const loc of filtered) {
      const key = `${Math.floor(loc.lng / cellSize)}:${Math.floor(loc.lat / cellSize)}`;
      if (!grid.has(key)) grid.set(key, []);
      grid.get(key)!.push(loc);
    }

    for (const [, group] of grid) {
      if (group.length === 1 || zoom >= 10) {
        for (const loc of group) {
          const marker = L.marker([loc.lat, loc.lng], {
            icon: createLocationIcon(loc.type, loc.books.length),
          });
          marker.bindTooltip(
            `<strong>${loc.city}</strong>${loc.country ? `<br/><span style="opacity:0.7">${loc.country}</span>` : ''}<br/>${loc.books.length} book${loc.books.length !== 1 ? 's' : ''}`,
            { direction: 'top', offset: [0, -6], className: 'book-tooltip' }
          );
          marker.on('click', () => handleSelect(loc));
          layerGroup.addLayer(marker);
        }
      } else {
        const avgLat = group.reduce((s, l) => s + l.lat, 0) / group.length;
        const avgLng = group.reduce((s, l) => s + l.lng, 0) / group.length;
        const totalBooks = group.reduce((s, l) => s + l.books.length, 0);
        const types = new Set(group.map(l => l.type));
        const cluster = L.marker([avgLat, avgLng], {
          icon: createClusterIcon(totalBooks, types),
        });
        cluster.bindTooltip(
          `${totalBooks.toLocaleString()} books across ${group.length} cities`,
          { direction: 'top', offset: [0, -10], className: 'book-tooltip' }
        );
        cluster.on('click', () => {
          if (zoom >= 7) {
            const allBooks = group.flatMap(l => l.books);
            handleSelect({
              city: group.length === 1 ? group[0].city : `${group.length} locations`,
              country: group.length === 1 ? group[0].country : null,
              lat: avgLat, lng: avgLng, type: group[0].type,
              books: allBooks.slice(0, 50),
            });
          } else {
            map.setView([avgLat, avgLng], zoom + 2);
          }
        });
        layerGroup.addLayer(cluster);
      }
    }
  }, [filtered, handleSelect]);

  // Re-render on zoom
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const onZoom = () => setFilters(f => ({ ...f }));
    map.on('zoomend', onZoom);
    return () => { map.off('zoomend', onZoom); };
  }, []);

  const bookCount = filtered.reduce((s, l) => s + l.books.length, 0);

  return (
    <div className="relative h-[calc(100vh-64px)] min-h-[500px]">
      <div ref={containerRef} className="absolute inset-0 z-0" />

      {/* Floating header */}
      <div
        className="absolute top-4 left-4 right-4 lg:right-auto z-[1000] rounded-xl px-5 py-3 shadow-lg"
        style={{
          background: 'rgba(255,252,247,0.96)',
          border: '1px solid rgba(0,0,0,0.06)',
          backdropFilter: 'blur(12px)',
        }}
      >
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
          {/* Title */}
          <h1
            className="text-base font-semibold tracking-tight mr-2"
            style={{ fontFamily: 'var(--font-heading)', color: 'var(--text-primary)' }}
          >
            {bookCount.toLocaleString()} books across {filtered.length.toLocaleString()} cities
          </h1>

          <span className="w-px h-5" style={{ background: 'rgba(0,0,0,0.08)' }} />

          {/* Type toggles */}
          {(['publication', 'author_birth', 'author_death'] as const).map((type) => {
            const active = filters.types.has(type);
            const config = TYPE_CONFIG[type];
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
                className="flex items-center gap-1.5 text-sm transition-all"
                style={{ opacity: active ? 1 : 0.3 }}
              >
                <span
                  className="w-2.5 h-2.5 rounded-full"
                  style={{ background: config.color }}
                />
                <span style={{ color: 'var(--text-secondary)', fontSize: '13px' }}>
                  {type === 'publication' ? 'Published' : type === 'author_birth' ? 'Born' : 'Died'}
                </span>
              </button>
            );
          })}

          <span className="w-px h-5 hidden sm:block" style={{ background: 'rgba(0,0,0,0.08)' }} />

          {/* Min filter */}
          <select
            value={filters.minBooks}
            onChange={(e) => setFilters((f) => ({ ...f, minBooks: Number(e.target.value) }))}
            className="rounded-md px-2 py-1 text-xs"
            style={{
              border: '1px solid rgba(0,0,0,0.08)',
              color: 'var(--text-secondary)',
              background: 'transparent',
            }}
          >
            {[1, 2, 5, 10, 20, 50].map((n) => (
              <option key={n} value={n}>{n === 1 ? 'All locations' : `${n}+ books`}</option>
            ))}
          </select>
        </div>
      </div>

      {/* Sidebar panel */}
      {selected && (
        <div
          className="absolute bottom-0 left-0 right-0 max-h-[55vh] lg:top-4 lg:bottom-4 lg:right-4 lg:left-auto lg:w-80 lg:max-h-none lg:rounded-xl overflow-hidden z-[1000] shadow-xl"
          style={{
            background: 'rgba(255,252,247,0.97)',
            border: '1px solid rgba(0,0,0,0.06)',
            backdropFilter: 'blur(12px)',
          }}
        >
          <div className="overflow-y-auto h-full">
            {/* Sidebar header */}
            <div className="sticky top-0 z-10 px-5 pt-4 pb-3" style={{ background: 'rgba(255,252,247,0.97)', borderBottom: '1px solid rgba(0,0,0,0.05)' }}>
              <div className="flex items-start justify-between">
                <div className="flex-1 min-w-0">
                  <h2
                    className="text-lg leading-tight"
                    style={{ fontFamily: 'var(--font-heading)', color: 'var(--text-primary)', fontWeight: 600 }}
                  >
                    {selected.city}
                  </h2>
                  <div className="flex items-center gap-2 mt-1">
                    {selected.country && (
                      <span className="text-xs" style={{ color: 'var(--text-muted)' }}>
                        {selected.country}
                      </span>
                    )}
                    <span
                      className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium uppercase tracking-wider"
                      style={{ background: TYPE_CONFIG[selected.type]?.lightBg, color: TYPE_CONFIG[selected.type]?.color }}
                    >
                      <span className="w-1.5 h-1.5 rounded-full" style={{ background: TYPE_CONFIG[selected.type]?.color }} />
                      {TYPE_CONFIG[selected.type]?.label || selected.type}
                    </span>
                  </div>
                </div>
                <button
                  onClick={() => setSelected(null)}
                  className="p-1.5 -mr-1 rounded-lg hover:bg-black/5 transition-colors"
                  style={{ color: 'var(--text-muted)' }}
                >
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>
              <p className="text-xs mt-2" style={{ color: 'var(--text-muted)' }}>
                {selected.books.length} book{selected.books.length !== 1 ? 's' : ''}
              </p>
            </div>

            {/* Book list */}
            <div className="px-5 py-3 space-y-0.5">
              {selected.books.slice(0, 40).map((book, i) => (
                <a
                  key={i}
                  href={`/book/${book.slug || book.id}`}
                  className="block px-2.5 py-2 -mx-2.5 rounded-lg hover:bg-black/[0.03] transition-colors"
                >
                  <div
                    className="text-[13px] leading-snug font-medium"
                    style={{ color: 'var(--text-primary)' }}
                  >
                    {book.title.length > 65 ? book.title.substring(0, 65) + '\u2026' : book.title}
                  </div>
                  <div className="text-[11px] mt-0.5" style={{ color: 'var(--text-muted)' }}>
                    {book.author.length > 40 ? book.author.substring(0, 40) + '\u2026' : book.author}
                    {book.year ? `, ${book.year}` : ''}
                  </div>
                </a>
              ))}
              {selected.books.length > 40 && (
                <p className="text-[11px] px-2.5 py-2" style={{ color: 'var(--text-muted)' }}>
                  and {selected.books.length - 40} more
                </p>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Global tooltip styles */}
      <style jsx global>{`
        .book-tooltip {
          font-family: var(--font-sans);
          font-size: 12px;
          line-height: 1.4;
          padding: 6px 10px;
          border-radius: 8px;
          box-shadow: 0 4px 12px rgba(0,0,0,0.1);
          border: 1px solid rgba(0,0,0,0.06);
          max-width: 200px;
        }
        .book-tooltip strong {
          font-weight: 600;
          color: var(--text-primary);
        }
        .book-marker, .cluster-marker {
          background: none !important;
          border: none !important;
        }
        .leaflet-control-zoom a {
          border-radius: 8px !important;
          width: 32px !important;
          height: 32px !important;
          line-height: 32px !important;
          font-size: 16px !important;
          color: var(--text-secondary) !important;
          border-color: rgba(0,0,0,0.06) !important;
          background: rgba(255,252,247,0.95) !important;
          backdrop-filter: blur(8px);
        }
        .leaflet-control-zoom {
          border: none !important;
          box-shadow: 0 2px 8px rgba(0,0,0,0.08) !important;
          border-radius: 10px !important;
          overflow: hidden;
        }
        .leaflet-container {
          background: #f5f0e8;
        }
      `}</style>
    </div>
  );
}
