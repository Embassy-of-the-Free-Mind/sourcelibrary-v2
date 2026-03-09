'use client';

import { Eye, Sun, RotateCw, Crop } from 'lucide-react';

interface QualityBadgeProps {
  type: 'blur' | 'dark' | 'skew' | 'partial';
}

const BADGE_CONFIG = {
  blur: {
    label: 'Blurry',
    icon: Eye,
    className: 'bg-status-error/90 text-white',
  },
  dark: {
    label: 'Dark',
    icon: Sun,
    className: 'bg-status-warning/90 text-white',
  },
  skew: {
    label: 'Skew',
    icon: RotateCw,
    className: 'bg-status-warning/90 text-white',
  },
  partial: {
    label: 'Partial',
    icon: Crop,
    className: 'bg-status-warning/90 text-white',
  },
} as const;

export default function QualityBadge({ type }: QualityBadgeProps) {
  const config = BADGE_CONFIG[type];
  const Icon = config.icon;

  return (
    <span className={`${config.className} inline-flex items-center gap-0.5 text-[9px] px-1 rounded-sm leading-relaxed`}>
      <Icon className="w-2 h-2 flex-shrink-0" />
      {config.label}
    </span>
  );
}
