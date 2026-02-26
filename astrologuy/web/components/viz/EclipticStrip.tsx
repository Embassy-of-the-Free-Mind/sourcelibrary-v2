"use client";

import { useMemo } from "react";
import * as Astronomy from "astronomy-engine";
import { WESTERN_ZODIAC } from "@/lib/constants";
import { MiniMoon } from "./MiniMoon";

const ELEMENT_COLORS: Record<string, string> = {
  Fire: "rgba(158, 74, 58, 0.25)",
  Earth: "rgba(201, 168, 108, 0.2)",
  Air: "rgba(139, 154, 125, 0.2)",
  Water: "rgba(124, 93, 181, 0.2)",
};

const ELEMENT_BORDER: Record<string, string> = {
  Fire: "rgba(158, 74, 58, 0.4)",
  Earth: "rgba(201, 168, 108, 0.35)",
  Air: "rgba(139, 154, 125, 0.35)",
  Water: "rgba(124, 93, 181, 0.4)",
};

/**
 * Shows the ecliptic as a horizontal strip with the 12 zodiac signs,
 * the moon's current position (sidereal), and the sun's position.
 * Makes "Moon in Gemini" visually concrete.
 */
export function EclipticStrip() {
  const now = useMemo(() => new Date(), []);

  const positions = useMemo(() => {
    const moonEcl = Astronomy.EclipticGeoMoon(now);
    const sunEcl = Astronomy.SunPosition(now);
    return {
      moonLon: ((moonEcl.lon % 360) + 360) % 360,
      sunLon: ((sunEcl.elon % 360) + 360) % 360,
    };
  }, [now]);

  const moonSignIdx = Math.floor(positions.moonLon / 30);
  const moonSign = WESTERN_ZODIAC[moonSignIdx];

  // How far through its current sign the moon is (0..1)
  const moonProgress = (positions.moonLon % 30) / 30;

  // How far through its current sign the sun is
  const sunSignIdx = Math.floor(positions.sunLon / 30);
  const sunProgress = (positions.sunLon % 30) / 30;

  return (
    <div className="w-full">
      {/* Current state label */}
      <div className="text-center mb-4">
        <span className="text-cream font-serif text-lg">
          Moon in {moonSign.name} {moonSign.symbol}
        </span>
        <span className="text-faint text-sm ml-2">
          ({positions.moonLon.toFixed(1)}&deg; ecliptic longitude)
        </span>
      </div>

      {/* The strip */}
      <div className="relative">
        {/* Signs */}
        <div className="flex rounded-lg overflow-hidden border border-border">
          {WESTERN_ZODIAC.map((sign, i) => {
            const isMoonHere = i === moonSignIdx;
            const isSunHere = i === sunSignIdx;

            return (
              <div
                key={sign.name}
                className={`relative flex-1 py-3 text-center border-r last:border-r-0 border-border/50 transition-all ${
                  isMoonHere ? "ring-1 ring-inset ring-accent-gold/50" : ""
                }`}
                style={{
                  background: ELEMENT_COLORS[sign.element],
                  borderColor: isMoonHere ? ELEMENT_BORDER[sign.element] : undefined,
                }}
              >
                {/* Sign symbol */}
                <div className={`text-lg leading-none ${isMoonHere ? "opacity-100" : "opacity-50"}`}>
                  {sign.symbol}
                </div>
                {/* Sign name — hide on small screens */}
                <div className={`text-[8px] mt-0.5 uppercase tracking-wider hidden sm:block ${
                  isMoonHere ? "text-cream" : "text-faint"
                }`}>
                  {sign.name}
                </div>

                {/* Moon marker */}
                {isMoonHere && (
                  <div
                    className="absolute -top-4"
                    style={{ left: `${moonProgress * 100}%`, transform: "translateX(-50%)" }}
                  >
                    <MiniMoon date={now} size={22} glow={false} />
                  </div>
                )}

                {/* Sun marker */}
                {isSunHere && (
                  <div
                    className="absolute -bottom-5 text-accent-gold text-base"
                    style={{ left: `${sunProgress * 100}%`, transform: "translateX(-50%)" }}
                  >
                    &#9788;
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {/* Labels */}
        <div className="flex justify-between mt-6 text-xs text-muted">
          <span>0&deg; (Vernal equinox)</span>
          <span>360&deg;</span>
        </div>
      </div>

      {/* Explanation */}
      <div className="mt-4 flex flex-wrap justify-center gap-4 text-xs text-muted">
        <div className="flex items-center gap-1.5">
          <MiniMoon date={now} size={14} />
          <span>Moon &mdash; moves ~13&deg;/day (new sign every ~2.3 days)</span>
        </div>
        <div className="flex items-center gap-1.5">
          <span className="text-accent-gold text-sm">&#9788;</span>
          <span>Sun &mdash; moves ~1&deg;/day (new sign every ~30 days)</span>
        </div>
      </div>
    </div>
  );
}
