"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const links = [
  { href: "/", label: "Home" },
  { href: "/calendar", label: "Calendar" },
  { href: "/birthday", label: "Birthday" },
  { href: "/zodiac", label: "Zodiac" },
  { href: "/eclipses", label: "Eclipses" },
];

export function Nav() {
  const pathname = usePathname();

  return (
    <nav className="border-b border-border">
      <div className="max-w-6xl mx-auto px-4 sm:px-6 flex items-center justify-between h-14">
        <Link href="/" className="font-serif text-xl font-semibold tracking-wide text-accent-gold hover:text-cream transition-colors">
          Astrologuy
        </Link>
        <div className="flex gap-1 sm:gap-2">
          {links.map((l) => (
            <Link
              key={l.href}
              href={l.href}
              className={`px-2.5 py-1.5 rounded-md text-sm transition-colors ${
                pathname === l.href
                  ? "bg-accent-gold/15 text-accent-gold"
                  : "text-muted hover:text-cream hover:bg-bg-hover"
              }`}
            >
              {l.label}
            </Link>
          ))}
        </div>
      </div>
    </nav>
  );
}
