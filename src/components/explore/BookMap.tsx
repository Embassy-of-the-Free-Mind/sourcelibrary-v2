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

const TYPE_CONFIG: Record<string, { color: string; label: string; emoji: string }> = {
  publication: { color: '#9e4a3a', label: 'Published', emoji: '' },
  author_birth: { color: '#3a7a9e', label: 'Author born', emoji: '' },
  author_death: { color: '#7c5db5', label: 'Author died', emoji: '' },
};

function createLocationIcon(type: string, bookCount: number) {
  const config = TYPE_CONFIG[type] || { color: '#999' };
  const size = Math.max(8, Math.min(24, 6 + Math.log2(bookCount + 1) * 3));
  return L.divIcon({
    className: 'book-marker',
    html: `<div style="
      width: ${size}px;
      height: ${size}px;
      border-radius: 50%;
      background: ${config.color};
      border: 2px solid white;
      box-shadow: 0 1px 4px rgba(0,0,0,0.3);
      cursor: pointer;
    "></div>`,
    iconSize: [size, size],
    iconAnchor: [size / 2, size / 2],
  });
}

function createClusterIcon(count: number, types: Set<string>) {
  const size = Math.max(30, Math.min(50, 28 + Math.log10(count) * 12));
  // Blend color based on dominant type
  const colors = [...types].map(t => TYPE_CONFIG[t]?.color || '#999');
  const bg = colors.length === 1 ? colors[0] : 'rgba(26, 22, 18, 0.8)';
  return L.divIcon({
    className: 'cluster-marker',
    html: `<div style="
      width: ${size}px;
      height: ${size}px;
      border-radius: 50%;
      background: ${bg};
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

export default function BookMap({ locations, stats }: BookMapProps) {
  const mapRef = useRef<L.Map | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const markersRef = useRef<L.LayerGroup | null>(null);

  const [selected, setSelected] = useState<BookLocation | null>(null);
  const [filters, setFilters] = useState({
    types: new Set(['publication', 'author_birth', 'author_death']),
    minBooks: 1,
    yearFrom: 1400,
    yearTo: 2000,
  });

  // Filter locations
  const filtered = useMemo(() => {
    return locations.filter((loc) => {
      if (!filters.types.has(loc.type)) return false;
      // Filter by book count at this location
      const matchingBooks = loc.books.filter(b => {
        if (!b.year) return true;
        return b.year >= filters.yearFrom && b.year <= filters.yearTo;
      });
      return matchingBooks.length >= filters.minBooks;
    });
  }, [locations, filters]);

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

  const handleSelect = useCallback((loc: BookLocation) => {
    setSelected(loc);
  }, []);

  // Render markers with grid clustering
  useEffect(() => {
    const map = mapRef.current;
    const layerGroup = markersRef.current;
    if (!map || !layerGroup) return;

    layerGroup.clearLayers();

    const zoom = map.getZoom();
    const cellSize = Math.max(0.5, 40 / Math.pow(2, zoom));

    const grid = new Map<string, BookLocation[]>();
    for (const loc of filtered) {
      const cellX = Math.floor(loc.lng / cellSize);
      const cellY = Math.floor(loc.lat / cellSize);
      const key = `${cellX}:${cellY}`;
      if (!grid.has(key)) grid.set(key, []);
      grid.get(key)!.push(loc);
    }

    for (const [, group] of grid) {
      if (group.length === 1 || zoom >= 10) {
        for (const loc of group) {
          const marker = L.marker([loc.lat, loc.lng], {
            icon: createLocationIcon(loc.type, loc.books.length),
          });
          const label = `${loc.city}${loc.country ? `, ${loc.country}` : ''} (${loc.books.length} books)`;
          marker.bindTooltip(label, {
            direction: 'top',
            offset: [0, -6],
            className: 'book-tooltip',
          });
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
        cluster.bindTooltip(`${totalBooks} books in ${group.length} locations`, {
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

  // Re-render on zoom
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const onZoom = () => setFilters(f => ({ ...f }));
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
          {/* Location type toggles */}
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
                className="flex items-center gap-1.5 transition-opacity"
                style={{ opacity: active ? 1 : 0.35 }}
              >
                <span
                  className="w-3 h-3 rounded-full inline-block"
                  style={{ background: config.color }}
                />
                <span style={{ color: 'var(--text-secondary)' }}>
                  {config.label}
                </span>
              </button>
            );
          })}

          <span className="w-px h-5 mx-1" style={{ background: 'var(--border-light)' }} />

          {/* Min books */}
          <label className="flex items-center gap-1.5" style={{ color: 'var(--text-muted)' }}>
            Min
            <select
              value={filters.minBooks}
              onChange={(e) => setFilters((f) => ({ ...f, minBooks: Number(e.target.value) }))}
              className="rounded px-1.5 py-0.5 text-sm"
              style={{ border: '1px solid var(--border-light)', color: 'var(--text-secondary)' }}
            >
              {[1, 2, 3, 5, 10, 20, 50].map((n) => (
                <option key={n} value={n}>{n}+ books</option>
              ))}
            </select>
          </label>

          <span className="w-px h-5 mx-1 hidden sm:block" style={{ background: 'var(--border-light)' }} />

          {/* Count */}
          <span className="text-xs" style={{ color: 'var(--text-muted)' }}>
            {filtered.reduce((s, l) => s + l.books.length, 0).toLocaleString()} books at {filtered.length.toLocaleString()} locations
          </span>
        </div>
      </div>

      {/* Sidebar */}
      <BookMapSidebar location={selected} onClose={() => setSelected(null)} />

      <style jsx global>{`
        .book-tooltip {
          font-family: var(--font-sans);
          font-size: 13px;
          padding: 4px 8px;
          border-radius: 6px;
          box-shadow: 0 2px 8px rgba(0,0,0,0.15);
        }
        .book-marker, .cluster-marker {
          background: none !important;
          border: none !important;
        }
      `}</style>
    </div>
  );
}

function BookMapSidebar({ location, onClose }: { location: BookLocation | null; onClose: () => void }) {
  if (!location) {
    return (
      <div
        className="w-full lg:w-80 shrink-0 p-6 flex items-center justify-center"
        style={{ background: 'var(--bg-cream)', borderLeft: '1px solid var(--border-light)' }}
      >
        <p className="text-sm text-center" style={{ color: 'var(--text-muted)' }}>
          Click a location to see its books
        </p>
      </div>
    );
  }

  const config = TYPE_CONFIG[location.type];
  const typeLabel = config?.label || location.type;

  return (
    <div
      className="w-full lg:w-80 shrink-0 overflow-y-auto"
      style={{ background: 'var(--bg-cream)', borderLeft: '1px solid var(--border-light)' }}
    >
      <div className="p-5 space-y-4">
        {/* Header */}
        <div className="flex items-start justify-between">
          <div className="flex-1 min-w-0">
            <h2 className="font-serif text-xl leading-tight" style={{ color: 'var(--text-primary)' }}>
              {location.city}
            </h2>
            {location.country && (
              <p className="text-sm mt-0.5" style={{ color: 'var(--text-muted)' }}>
                {location.country}
              </p>
            )}
            <span
              className="inline-block mt-1.5 px-2 py-0.5 rounded text-xs font-medium text-white"
              style={{ background: config?.color || '#999' }}
            >
              {typeLabel}
            </span>
          </div>
          <button
            onClick={onClose}
            className="p-1 rounded hover:bg-black/5 transition-colors ml-2"
            style={{ color: 'var(--text-muted)' }}
          >
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Stats */}
        <div className="flex gap-4">
          <div>
            <div className="text-lg font-semibold" style={{ color: 'var(--text-primary)' }}>
              {location.books.length}
            </div>
            <div className="text-xs" style={{ color: 'var(--text-muted)' }}>books</div>
          </div>
          <div className="text-xs font-mono self-end pb-1" style={{ color: 'var(--text-muted)' }}>
            {location.lat.toFixed(2)}, {location.lng.toFixed(2)}
          </div>
        </div>

        {/* Book list */}
        <div className="space-y-2 pt-2" style={{ borderTop: '1px solid var(--border-light)' }}>
          {location.books.slice(0, 30).map((book, i) => (
            <a
              key={i}
              href={`/book/${book.slug || book.id}`}
              className="block hover:opacity-70 transition-opacity"
            >
              <div className="text-sm font-medium leading-snug" style={{ color: 'var(--text-primary)' }}>
                {book.title.length > 60 ? book.title.substring(0, 60) + '...' : book.title}
              </div>
              <div className="text-xs" style={{ color: 'var(--text-muted)' }}>
                {book.author}{book.year ? ` (${book.year})` : ''}
              </div>
            </a>
          ))}
          {location.books.length > 30 && (
            <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
              + {location.books.length - 30} more
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
