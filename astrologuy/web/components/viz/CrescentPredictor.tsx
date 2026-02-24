"use client";

import { useState, useMemo, useEffect, useCallback } from "react";
import {
  getCrescentOrientation,
  findCrescentEvents,
  getLatitudeBand,
  type CrescentOrientation,
  type CrescentEvent,
} from "@/lib/astro";

const PRESET_CITIES = [
  { name: "Honolulu", lat: 21.31, lon: -157.86 },
  { name: "Mexico City", lat: 19.43, lon: -99.13 },
  { name: "Cairo", lat: 30.04, lon: 31.24 },
  { name: "Mumbai", lat: 19.08, lon: 72.88 },
  { name: "Nairobi", lat: -1.29, lon: 36.82 },
  { name: "London", lat: 51.51, lon: -0.13 },
  { name: "Tokyo", lat: 35.68, lon: 139.69 },
  { name: "Sydney", lat: -33.87, lon: 151.21 },
  { name: "New York", lat: 40.71, lon: -74.01 },
  { name: "S\u00e3o Paulo", lat: -23.55, lon: -46.63 },
];

const STORAGE_KEY = "astrologuy-location";

function loadLocation(): { lat: number; lon: number; name: string } {
  if (typeof window === "undefined") return PRESET_CITIES[0];
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) return JSON.parse(stored);
  } catch { /* ignore */ }
  return PRESET_CITIES[0];
}

function saveLocation(loc: { lat: number; lon: number; name: string }) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(loc));
  } catch { /* ignore */ }
}

/** SVG crescent oriented as it appears in the sky. */
function OrientedCrescent({
  tiltDeg,
  illumination,
  phaseAngle,
  size = 40,
}: {
  tiltDeg: number;
  illumination: number;
  phaseAngle: number;
  size?: number;
}) {
  const cx = size / 2;
  const cy = size / 2;
  const r = size / 2 - 2;

  // k = cos(phaseAngle): -1 at new, 0 at quarter, +1 at full
  const k = Math.cos((phaseAngle * Math.PI) / 180);
  const waxing = phaseAngle < 180;

  // Build lit path (bright limb on right for waxing)
  const terminatorRx = Math.abs(k) * r;
  const gibbous = (1 + k) / 2 > 0.5;
  const litSweep = waxing ? 1 : 0;
  const terminatorSweep = waxing === gibbous ? 0 : 1;
  const top = cy - r;
  const bottom = cy + r;
  const litPath = `M ${cx} ${top} A ${r} ${r} 0 0 ${litSweep} ${cx} ${bottom} A ${terminatorRx} ${r} 0 0 ${terminatorSweep} ${cx} ${top}`;

  // Rotate so the bright limb matches sky orientation
  // Standard drawing: bright limb at 90deg (right). Rotate by tiltDeg - 90
  const rotation = tiltDeg - 90;

  // Dim crescents with very low illumination
  const opacity = Math.max(0.4, Math.min(0.95, illumination / 15));

  return (
    <svg
      width={size}
      height={size}
      viewBox={`0 0 ${size} ${size}`}
      className="inline-block"
    >
      <g transform={`rotate(${rotation}, ${cx}, ${cy})`}>
        <circle cx={cx} cy={cy} r={r} fill="#1a1612" stroke="var(--color-border)" strokeWidth={0.5} />
        <path d={litPath} fill="#e8dcc8" opacity={opacity} />
      </g>
    </svg>
  );
}

/** Score label: bowl, tilt, or frown */
function cuspsLabel(score: number): { text: string; color: string } {
  if (score > 0.7) return { text: "Bowl", color: "var(--accent-gold)" };
  if (score > 0.3) return { text: "Tilted", color: "var(--accent-sage)" };
  if (score > -0.3) return { text: "Sideways", color: "var(--color-muted)" };
  if (score > -0.7) return { text: "Tilted", color: "var(--color-muted)" };
  return { text: "Frown", color: "var(--accent-rust)" };
}

function formatDate(d: Date): string {
  return d.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function formatTime(d: Date): string {
  return d.toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
  });
}

/** Latitude band chart: shows cuspsUp score across latitudes */
function LatitudeBandChart({
  date,
  lon,
  lat,
}: {
  date: Date;
  lon: number;
  lat: number;
}) {
  const band = useMemo(() => getLatitudeBand(date, lon), [date, lon]);

  const width = 300;
  const height = 160;
  const padding = { top: 10, right: 16, bottom: 30, left: 40 };
  const plotW = width - padding.left - padding.right;
  const plotH = height - padding.top - padding.bottom;

  const xScale = (l: number) => padding.left + ((l + 60) / 120) * plotW;
  const yScale = (v: number) => padding.top + ((1 - v) / 2) * plotH;

  // Build path
  const points = band
    .filter((b) => b.moonAlt > 0)
    .map((b) => `${xScale(b.lat).toFixed(1)},${yScale(b.cuspsUp).toFixed(1)}`);
  const linePath = points.length > 1 ? `M ${points.join(" L ")}` : "";

  // User's latitude marker
  const userX = xScale(lat);
  const userPoint = band.find((b) => Math.abs(b.lat - lat) < 3);
  const userY = userPoint ? yScale(userPoint.cuspsUp) : yScale(0);

  return (
    <svg viewBox={`0 0 ${width} ${height}`} className="w-full max-w-xs">
      {/* Zero line */}
      <line
        x1={padding.left}
        y1={yScale(0)}
        x2={width - padding.right}
        y2={yScale(0)}
        stroke="var(--color-border)"
        strokeWidth={0.5}
        strokeDasharray="3,3"
      />
      {/* Bowl zone */}
      <rect
        x={padding.left}
        y={yScale(1)}
        width={plotW}
        height={yScale(0) - yScale(1)}
        fill="var(--accent-gold)"
        opacity={0.05}
      />
      {/* Curve */}
      {linePath && (
        <path d={linePath} fill="none" stroke="var(--accent-gold)" strokeWidth={1.5} />
      )}
      {/* User marker */}
      {userPoint && userPoint.moonAlt > 0 && (
        <circle cx={userX} cy={userY} r={3} fill="var(--accent-rust)" />
      )}
      {/* Labels */}
      <text x={padding.left} y={height - 4} fill="var(--color-muted)" fontSize={9}>
        60&deg;S
      </text>
      <text x={xScale(0)} y={height - 4} fill="var(--color-muted)" fontSize={9} textAnchor="middle">
        Equator
      </text>
      <text x={width - padding.right} y={height - 4} fill="var(--color-muted)" fontSize={9} textAnchor="end">
        60&deg;N
      </text>
      <text x={padding.left - 4} y={yScale(1) + 3} fill="var(--accent-gold)" fontSize={8} textAnchor="end">
        Bowl
      </text>
      <text x={padding.left - 4} y={yScale(-1) + 3} fill="var(--accent-rust)" fontSize={8} textAnchor="end">
        Frown
      </text>
    </svg>
  );
}

export function CrescentPredictor() {
  const [location, setLocation] = useState(loadLocation);
  const [geoLoading, setGeoLoading] = useState(false);
  const [selectedEvent, setSelectedEvent] = useState<CrescentEvent | null>(null);

  const updateLocation = useCallback(
    (loc: { lat: number; lon: number; name: string }) => {
      setLocation(loc);
      saveLocation(loc);
      setSelectedEvent(null);
    },
    [],
  );

  // Geolocation
  const requestGeo = useCallback(() => {
    if (!navigator.geolocation) return;
    setGeoLoading(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        updateLocation({
          lat: Math.round(pos.coords.latitude * 100) / 100,
          lon: Math.round(pos.coords.longitude * 100) / 100,
          name: "Your Location",
        });
        setGeoLoading(false);
      },
      () => setGeoLoading(false),
      { timeout: 8000 },
    );
  }, [updateLocation]);

  // Current crescent orientation
  const now = useMemo(() => getCrescentOrientation(new Date(), location.lat, location.lon), [location]);

  // Upcoming events (6 months)
  const events = useMemo(
    () => findCrescentEvents(location.lat, location.lon, 6),
    [location.lat, location.lon],
  );

  // Best upcoming bowl crescents
  const bowlEvents = useMemo(
    () => events.filter((e) => e.cuspsUp > 0.5).slice(0, 8),
    [events],
  );

  // Auto-select first bowl event for the latitude chart
  useEffect(() => {
    if (!selectedEvent && bowlEvents.length > 0) {
      setSelectedEvent(bowlEvents[0]);
    }
  }, [bowlEvents, selectedEvent]);

  return (
    <div className="space-y-10">
      {/* ─── Location Picker ─── */}
      <div className="bg-bg-card border border-border rounded-xl p-5">
        <div className="flex items-center gap-3 mb-3">
          <span className="text-faint text-xs uppercase tracking-wider">Location</span>
          <span className="text-cream font-medium">{location.name}</span>
          <span className="text-faint text-xs">
            {location.lat.toFixed(1)}&deg;{location.lat >= 0 ? "N" : "S"},{" "}
            {Math.abs(location.lon).toFixed(1)}&deg;{location.lon >= 0 ? "E" : "W"}
          </span>
        </div>

        <div className="flex flex-wrap gap-2">
          <button
            onClick={requestGeo}
            disabled={geoLoading}
            className="px-3 py-1.5 text-xs border border-border rounded-lg text-accent-gold hover:bg-accent-gold/10 transition-colors disabled:opacity-50"
          >
            {geoLoading ? "Locating\u2026" : "Use My Location"}
          </button>
          {PRESET_CITIES.map((city) => (
            <button
              key={city.name}
              onClick={() => updateLocation({ ...city })}
              className={`px-3 py-1.5 text-xs border rounded-lg transition-colors ${
                location.name === city.name
                  ? "border-accent-gold bg-accent-gold/10 text-accent-gold"
                  : "border-border text-muted hover:text-cream hover:border-border"
              }`}
            >
              {city.name}
            </button>
          ))}
        </div>
      </div>

      {/* ─── Right Now ─── */}
      <div className="bg-bg-card border border-border rounded-xl p-5">
        <div className="text-faint text-xs uppercase tracking-wider mb-3">Crescent Right Now</div>
        <div className="flex items-center gap-6">
          <OrientedCrescent
            tiltDeg={now.tiltDeg}
            illumination={now.illumination}
            phaseAngle={now.phaseAngle}
            size={64}
          />
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <span
                className="text-lg font-serif font-semibold"
                style={{ color: cuspsLabel(now.cuspsUp).color }}
              >
                {cuspsLabel(now.cuspsUp).text}
              </span>
              <span className="text-faint text-xs">
                score: {now.cuspsUp > 0 ? "+" : ""}{now.cuspsUp.toFixed(2)}
              </span>
            </div>
            <div className="text-sm text-muted">
              {now.illumination.toFixed(1)}% illuminated &middot;{" "}
              {now.moonAlt > 0
                ? `${now.moonAlt.toFixed(0)}\u00b0 above horizon`
                : "Below horizon"}
            </div>
            <div className="text-xs text-faint">
              Bright limb at {now.tiltDeg.toFixed(0)}&deg; from zenith
            </div>
          </div>
        </div>
        {now.illumination < 0.3 || now.illumination > 40 ? (
          <div className="mt-3 text-xs text-faint italic">
            The moon is {now.illumination < 0.3 ? "too close to new" : "past crescent phase"} for
            crescent viewing right now. See the forecast below.
          </div>
        ) : null}
      </div>

      {/* ─── Upcoming Bowl Crescents ─── */}
      <div>
        <h3 className="font-serif text-lg font-semibold mb-1">Upcoming Bowl Crescents</h3>
        <p className="text-muted text-sm mb-4">
          The best &ldquo;horns up&rdquo; viewing opportunities in the next 6 months from{" "}
          {location.name}. {bowlEvents.length === 0 && "No strong bowl crescents found \u2014 try a more tropical location."}
        </p>

        {bowlEvents.length > 0 && (
          <div className="overflow-x-auto -mx-4 px-4">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-faint text-xs uppercase tracking-wider border-b border-border">
                  <th className="text-left py-2 pr-3 font-normal">Date</th>
                  <th className="text-left py-2 pr-3 font-normal">Time</th>
                  <th className="text-left py-2 pr-3 font-normal">Type</th>
                  <th className="text-center py-2 pr-3 font-normal">Crescent</th>
                  <th className="text-right py-2 pr-3 font-normal">Score</th>
                  <th className="text-right py-2 pr-3 font-normal">Alt</th>
                  <th className="text-right py-2 font-normal">Illum</th>
                </tr>
              </thead>
              <tbody>
                {bowlEvents.map((evt, i) => {
                  const label = cuspsLabel(evt.cuspsUp);
                  const isSelected = selectedEvent?.date.getTime() === evt.date.getTime();
                  return (
                    <tr
                      key={i}
                      onClick={() => setSelectedEvent(evt)}
                      className={`border-b border-border/50 cursor-pointer transition-colors ${
                        isSelected
                          ? "bg-accent-gold/8"
                          : "hover:bg-bg-hover"
                      }`}
                    >
                      <td className="py-2.5 pr-3 text-cream">{formatDate(evt.date)}</td>
                      <td className="py-2.5 pr-3 text-muted">{formatTime(evt.date)}</td>
                      <td className="py-2.5 pr-3">
                        <span className={`text-xs px-2 py-0.5 rounded-full ${
                          evt.type === "evening"
                            ? "bg-accent-gold/15 text-accent-gold"
                            : "bg-accent-violet/15 text-accent-violet"
                        }`}>
                          {evt.type === "evening" ? "Evening" : "Morning"}
                        </span>
                      </td>
                      <td className="py-2.5 pr-3 text-center">
                        <OrientedCrescent
                          tiltDeg={evt.tiltDeg}
                          illumination={evt.illumination}
                          phaseAngle={evt.phaseAngle}
                          size={28}
                        />
                      </td>
                      <td className="py-2.5 pr-3 text-right font-medium" style={{ color: label.color }}>
                        {evt.cuspsUp > 0 ? "+" : ""}{evt.cuspsUp.toFixed(2)}
                      </td>
                      <td className="py-2.5 pr-3 text-right text-muted">
                        {evt.moonAlt.toFixed(0)}&deg;
                      </td>
                      <td className="py-2.5 text-right text-muted">
                        {evt.illumination.toFixed(1)}%
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* ─── Latitude Band Chart ─── */}
      {selectedEvent && (
        <div>
          <h3 className="font-serif text-lg font-semibold mb-1">Latitude Effect</h3>
          <p className="text-muted text-sm mb-4">
            How the bowl effect varies by latitude on{" "}
            <strong className="text-cream">{formatDate(selectedEvent.date)}</strong>.
            Click a row above to compare different dates.
            The red dot marks your location.
          </p>
          <div className="flex justify-center">
            <LatitudeBandChart
              date={selectedEvent.date}
              lon={location.lon}
              lat={location.lat}
            />
          </div>
          <div className="text-xs text-faint text-center mt-2">
            Tropical latitudes (near the equator) tend to produce the best bowl crescents
            because the ecliptic sets more steeply.
          </div>
        </div>
      )}

      {/* ─── Full Event List ─── */}
      <details className="group">
        <summary className="font-serif text-lg font-semibold cursor-pointer select-none">
          All Crescent Events ({events.length})
          <span className="text-faint text-xs font-normal ml-2">
            Click to expand
          </span>
        </summary>
        <div className="mt-4 overflow-x-auto -mx-4 px-4">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-faint text-xs uppercase tracking-wider border-b border-border">
                <th className="text-left py-2 pr-3 font-normal">Date</th>
                <th className="text-left py-2 pr-3 font-normal">Type</th>
                <th className="text-center py-2 pr-3 font-normal">Crescent</th>
                <th className="text-right py-2 pr-3 font-normal">Score</th>
                <th className="text-right py-2 pr-3 font-normal">Alt</th>
                <th className="text-right py-2 font-normal">Illum</th>
              </tr>
            </thead>
            <tbody>
              {events.map((evt, i) => {
                const label = cuspsLabel(evt.cuspsUp);
                return (
                  <tr key={i} className="border-b border-border/50">
                    <td className="py-2 pr-3 text-cream">
                      {formatDate(evt.date)}
                      <span className="text-faint text-xs ml-2">{formatTime(evt.date)}</span>
                    </td>
                    <td className="py-2 pr-3">
                      <span className={`text-xs px-2 py-0.5 rounded-full ${
                        evt.type === "evening"
                          ? "bg-accent-gold/15 text-accent-gold"
                          : "bg-accent-violet/15 text-accent-violet"
                      }`}>
                        {evt.type === "evening" ? "Eve" : "Morn"}
                      </span>
                    </td>
                    <td className="py-2 pr-3 text-center">
                      <OrientedCrescent
                        tiltDeg={evt.tiltDeg}
                        illumination={evt.illumination}
                        phaseAngle={evt.phaseAngle}
                        size={24}
                      />
                    </td>
                    <td className="py-2 pr-3 text-right" style={{ color: label.color }}>
                      {evt.cuspsUp > 0 ? "+" : ""}{evt.cuspsUp.toFixed(2)}
                    </td>
                    <td className="py-2 pr-3 text-right text-muted">{evt.moonAlt.toFixed(0)}&deg;</td>
                    <td className="py-2 text-right text-muted">{evt.illumination.toFixed(1)}%</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </details>
    </div>
  );
}
