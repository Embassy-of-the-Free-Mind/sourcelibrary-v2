/** Shared formatting functions for analytics dashboard */

export function formatDuration(ms: number): string {
  if (ms < 1000) return `${Math.round(ms)}ms`;
  return `${(ms / 1000).toFixed(2)}s`;
}

export function formatTime(timestamp: number): string {
  return new Date(timestamp).toLocaleString();
}

export function formatNumber(n: number): string {
  return n.toLocaleString();
}

export function formatCost(cost: number): string {
  if (cost < 0.01) return `$${cost.toFixed(4)}`;
  if (cost < 1) return `$${cost.toFixed(3)}`;
  return `$${cost.toFixed(2)}`;
}

export function formatTokens(tokens: number): string {
  if (tokens >= 1000000) return `${(tokens / 1000000).toFixed(1)}M`;
  if (tokens >= 1000) return `${(tokens / 1000).toFixed(1)}K`;
  return tokens.toString();
}

export function formatJobType(type: string): string {
  const labels: Record<string, string> = {
    batch_ocr: 'OCR',
    batch_translate: 'Translate',
    batch_split: 'Split',
    book_import: 'Import',
  };
  return labels[type] || type;
}

export function getStatusColor(status: string): string {
  switch (status) {
    case 'completed': return '#22c55e';
    case 'failed': return '#ef4444';
    case 'processing': return 'var(--accent-sage)';
    case 'paused': return '#f59e0b';
    case 'cancelled': return 'var(--text-muted)';
    default: return 'var(--text-muted)';
  }
}
