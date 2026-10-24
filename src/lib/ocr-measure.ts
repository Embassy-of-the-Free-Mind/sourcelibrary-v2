/**
 * The measured accuracy of the engine that reads new pages in a script, as the
 * reader's one-line statement under the transcription quotes it (#6278 item 5).
 *
 * PRIOR ART: src/app/quality/ParetoCharts.tsx — renders the same chart rows on
 * /quality, but as a whole page of client-free SVG; it exports no per-chart
 * lookup. src/data/quality-by-language.json — the /quality grid's Latin cell,
 * which measurement-validity.md records as stale (built 2026-10-01). The
 * reader quotes the newer Pareto panel instead, so the number it prints is the
 * one the chart it links to shows.
 *
 * SERVER ONLY: ocr-pareto.json is ~240 KB. The reader page reads it here and
 * hands the client four numbers, never the file.
 */

import pareto from '@/data/ocr-pareto.json';

export interface OcrMeasure {
  /** 0–1: 1 minus the mean character error rate of the engine we use, on the panel's pages. */
  accuracy: number;
  /** 95% interval of `accuracy`. */
  ci95: [number, number];
  /** Pages scored (one page per work on the primary panel). */
  pages: number;
  /** ISO date the panel was scored. */
  date: string;
  /** The chart on /quality these numbers come from. */
  href: string;
}

type Placed = { production?: boolean; accuracy?: number; accuracy_ci95?: number[] };
type Panel = { kind: string; n_pages: number; date: string; grade?: { level?: string }; placed?: Placed[] };
type Chart = { id: string; panels: Panel[] };

/**
 * The primary panel of one /quality OCR chart (`latin`, …), production engine
 * only. Null when the chart is gone, the panel is not decision-grade, or the
 * engine we use has no point on it: say nothing rather than a weaker number.
 */
export function ocrMeasure(chartId: string): OcrMeasure | null {
  const chart = (pareto.charts as unknown as Chart[]).find((c) => c.id === chartId);
  const panel = chart?.panels.find((p) => p.kind === 'primary');
  if (!panel || panel.grade?.level !== 'decide') return null;
  const point = panel.placed?.find((p) => p.production);
  if (typeof point?.accuracy !== 'number' || point.accuracy_ci95?.length !== 2) return null;
  return {
    accuracy: point.accuracy,
    ci95: [point.accuracy_ci95[0], point.accuracy_ci95[1]],
    pages: panel.n_pages,
    date: panel.date,
    href: `/quality#pareto-${chartId}`,
  };
}
