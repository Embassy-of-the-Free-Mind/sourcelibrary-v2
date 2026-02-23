"use client";

import dynamic from "next/dynamic";
import { PhaseCard } from "@/components/ui/PhaseCard";
import { PhaseWheel } from "@/components/viz/PhaseWheel";
import { useMoonSign, useMoonCycle } from "@/lib/hooks";
import { getLunarEvents } from "@/lib/astro";
import { useMemo } from "react";
import Link from "next/link";

const MoonGlobe = dynamic(() => import("@/components/three/Scene").then((m) => m.Scene), {
  ssr: false,
  loading: () => (
    <div className="w-full aspect-square max-w-sm mx-auto flex items-center justify-center">
      <PhaseWheel size={280} />
    </div>
  ),
});

export default function HomePage() {
  const sign = useMoonSign();
  const cycle = useMoonCycle();

  const upcomingEvents = useMemo(() => {
    const events = getLunarEvents(new Date(), 60);
    return events.slice(0, 4);
  }, []);

  return (
    <div className="max-w-6xl mx-auto px-4 sm:px-6 py-8">
      {/* Hero section */}
      <div className="text-center mb-12">
        <h1 className="font-serif text-4xl sm:text-5xl font-semibold tracking-wide mb-3">
          Astrologuy
        </h1>
        <p className="text-muted text-lg max-w-xl mx-auto">
          Interactive lunar calendar with real-time moon phases, Chinese zodiac, and eclipse forecasts.
          All calculations run in your browser.
        </p>
      </div>

      {/* 3D Moon + Phase Card */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 mb-12">
        <div className="flex items-center justify-center">
          <MoonGlobe />
        </div>
        <div className="flex flex-col gap-4">
          <PhaseCard />

          {/* Moon sign card */}
          <div className="bg-bg-card border border-border rounded-xl p-5">
            <div className="text-faint text-xs uppercase tracking-wider mb-2">Moon Sign</div>
            <div className="flex items-center gap-3">
              <span className="text-3xl">{sign.symbol}</span>
              <div>
                <div className="text-cream font-medium text-lg">{sign.name}</div>
                <div className="text-muted text-sm">
                  {sign.element} &middot; {sign.modality} &middot; {sign.degrees.toFixed(1)}&deg;
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Upcoming events */}
      <div className="mb-12">
        <h2 className="font-serif text-2xl font-semibold mb-4">Upcoming Events</h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          {upcomingEvents.map((evt, i) => (
            <div key={i} className="bg-bg-card border border-border rounded-xl p-4">
              <div className="text-2xl mb-1">{evt.emoji}</div>
              <div className="text-cream font-medium text-sm">{evt.name}</div>
              <div className="text-muted text-xs mt-1">
                {evt.date.toLocaleDateString("en", {
                  month: "long",
                  day: "numeric",
                  year: "numeric",
                })}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Quick links */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <Link
          href="/calendar"
          className="bg-bg-card border border-border rounded-xl p-6 hover:border-accent-gold/30 transition-colors group"
        >
          <div className="text-2xl mb-2">&#x1F4C5;</div>
          <h3 className="font-serif text-lg font-semibold group-hover:text-accent-gold transition-colors">
            13-Month Calendar
          </h3>
          <p className="text-muted text-sm mt-1">
            The year as 13 perfect lunar months. See the rhythm.
          </p>
        </Link>
        <Link
          href="/birthday"
          className="bg-bg-card border border-border rounded-xl p-6 hover:border-accent-gold/30 transition-colors group"
        >
          <div className="text-2xl mb-2">&#x1F382;</div>
          <h3 className="font-serif text-lg font-semibold group-hover:text-accent-gold transition-colors">
            Lunar Birthday
          </h3>
          <p className="text-muted text-sm mt-1">
            Find your lunar birthday and track the 19-year drift.
          </p>
        </Link>
        <Link
          href="/zodiac"
          className="bg-bg-card border border-border rounded-xl p-6 hover:border-accent-gold/30 transition-colors group"
        >
          <div className="text-2xl mb-2">&#x1F409;</div>
          <h3 className="font-serif text-lg font-semibold group-hover:text-accent-gold transition-colors">
            Chinese Zodiac
          </h3>
          <p className="text-muted text-sm mt-1">
            Your zodiac animal, element, traits, and compatibility.
          </p>
        </Link>
      </div>
    </div>
  );
}
