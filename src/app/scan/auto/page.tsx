'use client';

import { useMemo } from 'react';
import AutoScanFlow from '@/components/scan/AutoScanFlow';
import { createCanvasEdgeDetector } from '@/lib/scan/canvas-edge-detection';

export default function AutoScanPage() {
  const edgeDetector = useMemo(() => createCanvasEdgeDetector(), []);
  return <AutoScanFlow edgeDetector={edgeDetector} />;
}
