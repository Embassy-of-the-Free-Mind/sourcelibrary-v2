"use client";

import { useMemo } from "react";
import { getEclipses } from "@/lib/astro";

const TYPE_COLORS: Record<string, string> = {
  total: "var(--accent-rust)",
  partial: "var(--accent-gold)",
  penumbral: "var(--accent-sage)",
  annular: "var(--accent-violet)",
};

const KIND_EMOJI: Record<string, string> = {
  lunar: "\uD83C\uDF11",
  solar: "\u2600\uFE0F",
};

export function EclipseTimeline({ count = 12 }: { count?: number }) {
  const eclipses = useMemo(() => {
    return getEclipses(new Date(), count);
  }, [count]);

  if (eclipses.length === 0) {
    return (
      <div className="bg-bg-card border border-border rounded-xl p-8 text-center">
        <p className="text-muted">No upcoming eclipses found.</p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {eclipses.map((eclipse, i) => {
        const isPast = eclipse.date < new Date();
        const color = TYPE_COLORS[eclipse.kind] || "var(--color-muted)";

        return (
          <div
            key={i}
            className={`flex items-start gap-4 bg-bg-card border border-border rounded-xl p-4 ${
              isPast ? "opacity-50" : ""
            }`}
          >
            {/* Timeline dot */}
            <div className="flex flex-col items-center pt-1">
              <div
                className="w-3 h-3 rounded-full"
                style={{ background: color }}
              />
              {i < eclipses.length - 1 && (
                <div className="w-px h-8 bg-border mt-1" />
              )}
            </div>

            {/* Content */}
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 mb-1">
                <span className="text-lg">{KIND_EMOJI[eclipse.type] || ""}</span>
                <span className="text-cream font-medium">
                  {eclipse.kind.charAt(0).toUpperCase() + eclipse.kind.slice(1)}{" "}
                  {eclipse.type} eclipse
                </span>
              </div>
              <div className="text-muted text-sm">
                {eclipse.date.toLocaleDateString("en", {
                  weekday: "long",
                  month: "long",
                  day: "numeric",
                  year: "numeric",
                })}
              </div>
              {eclipse.type === "lunar" && eclipse.details.obscuration != null && (
                <div className="text-faint text-xs mt-1">
                  {eclipse.details.obscuration as number}% obscuration
                </div>
              )}
            </div>

            {/* Type badge */}
            <span
              className="text-xs px-2 py-0.5 rounded-full font-medium"
              style={{
                background: color,
                opacity: 0.8,
                color: "var(--color-bg-dark)",
              }}
            >
              {eclipse.kind}
            </span>
          </div>
        );
      })}
    </div>
  );
}
