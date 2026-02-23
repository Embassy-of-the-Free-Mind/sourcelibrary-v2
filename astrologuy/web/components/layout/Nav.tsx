"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";

const deepDives = [
  { href: "/calendar", label: "Calendar" },
  { href: "/birthday", label: "Birthday" },
  { href: "/zodiac", label: "Zodiac" },
  { href: "/eclipses", label: "Eclipses" },
];

export function Nav() {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const isHome = pathname === "/";

  return (
    <nav className="border-b border-border">
      <div className="max-w-6xl mx-auto px-4 sm:px-6 flex items-center justify-between h-14">
        <Link
          href="/"
          className="font-serif text-xl font-semibold tracking-wide text-accent-gold hover:text-cream transition-colors"
        >
          Astrologuy
        </Link>

        <div className="flex items-center gap-4">
          {/* Show deep dive links on non-home pages */}
          {!isHome && (
            <Link
              href="/"
              className="text-sm text-muted hover:text-cream transition-colors"
            >
              Essay
            </Link>
          )}

          {/* Deep dive dropdown */}
          <div className="relative">
            <button
              onClick={() => setOpen(!open)}
              className="text-sm text-muted hover:text-cream transition-colors flex items-center gap-1"
            >
              Explore
              <svg
                width="12"
                height="12"
                viewBox="0 0 12 12"
                fill="none"
                className={`transition-transform ${open ? "rotate-180" : ""}`}
              >
                <path d="M3 5L6 8L9 5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
              </svg>
            </button>
            {open && (
              <>
                <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
                <div className="absolute right-0 mt-2 w-44 bg-bg-card border border-border rounded-lg shadow-xl z-50 overflow-hidden">
                  {deepDives.map((l) => (
                    <Link
                      key={l.href}
                      href={l.href}
                      onClick={() => setOpen(false)}
                      className={`block px-4 py-2.5 text-sm transition-colors ${
                        pathname === l.href
                          ? "bg-accent-gold/10 text-accent-gold"
                          : "text-muted hover:text-cream hover:bg-bg-hover"
                      }`}
                    >
                      {l.label}
                    </Link>
                  ))}
                </div>
              </>
            )}
          </div>
        </div>
      </div>
    </nav>
  );
}
