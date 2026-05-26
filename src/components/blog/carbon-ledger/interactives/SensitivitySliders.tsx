'use client';
import { useState, useMemo } from 'react';
import { fmtCO2 } from '@/components/blog/carbon-ledger/format';
import { DataTray } from '@/components/blog/carbon-ledger/DataTray';
import estimationLines from '@/data/carbon-ledger/estimation-lines.json';

/**
 * Interactive sliders that let the user adjust the bottom-up model's
 * key assumptions and watch the per-token energy + total project CO2
 * shift in real time. This is the v4-model "show your work" component.
 */
export function SensitivitySliders() {
  const [batchSize, setBatchSize] = useState(48);   // Gemini decode batch
  const [util, setUtil] = useState(50);             // % HBM utilization
  const [grid, setGrid] = useState(125);            // g CO2/kWh
  const [trainAmort, setTrainAmort] = useState(20); // % adder
  const [embodied, setEmbodied] = useState(8);      // % adder

  // Total token counts (real measured values from /data)
  const totalTokens = 28_581_894_741;

  // Simplified bottom-up: per-token energy follows roofline
  // Decode (output) energy ~ inversely proportional to batch × util
  // Use a calibration: at batch=48, util=50, the v4 model gives ~190 kWh total
  // for Gemini + Claude. Scale linearly with batch and util.

  const result = useMemo(() => {
    const refBatch = 48;
    const refUtil = 50;
    const refKWh = 1024;  // v4 central kWh before bridge factors

    const batchScale = refBatch / batchSize;
    const utilScale = refUtil / util;
    const kWh = refKWh * batchScale * utilScale;

    // Apply training + embodied
    const totalKWh = kWh * (1 + trainAmort / 100) * (1 + embodied / 100);

    // CO2
    const totalKg = totalKWh * grid / 1000;
    return { kWh: totalKWh, kg: totalKg };
  }, [batchSize, util, grid, trainAmort, embodied]);

  // Compare to the other estimation lines
  const lineCentrals = estimationLines.lines.map((l) => ({
    label: l.short,
    kg: l.central_kg,
  }));
  const geomean = estimationLines.summary.geometric_mean_kg;

  return (
    <figure className="my-8 rounded-lg border border-stone-200 dark:border-stone-800 bg-white dark:bg-stone-950 p-6">
      <figcaption className="mb-1 text-xs font-mono uppercase tracking-wide text-stone-500 dark:text-stone-400">
        Interactive — Bottom-up model knobs
      </figcaption>
      <div className="mb-4 text-stone-700 dark:text-stone-300 text-sm">
        These are the assumptions in our v4 bottom-up model. Move the
        sliders to see how each lever affects the total estimate.
      </div>

      {/* Live readout */}
      <div className="rounded-lg bg-stone-100 dark:bg-stone-900 p-5 mb-5 text-center">
        <div className="text-xs font-mono uppercase tracking-wide text-stone-500 mb-1">
          Bottom-up estimate with these assumptions
        </div>
        <div className="text-4xl font-bold tabular-nums text-stone-900 dark:text-stone-100">
          {fmtCO2(result.kg)}
        </div>
        <div className="text-xs font-mono text-stone-500 mt-1">
          {Math.round(result.kWh).toLocaleString()} kWh × {grid} g/kWh
        </div>

        {/* Position relative to other methods on log scale */}
        <div className="mt-4">
          <div className="text-[10px] uppercase tracking-wider text-stone-500 mb-2">
            Where this lands vs. other methods
          </div>
          <div className="relative h-8">
            <div className="absolute inset-x-0 top-1/2 h-0.5 bg-stone-300 dark:bg-stone-700 -translate-y-1/2" />
            {/* x-axis labels */}
            {[10, 100, 1000, 10_000, 100_000].map((v) => {
              const x = positionLog(v, 10, 100_000);
              return (
                <div
                  key={v}
                  className="absolute top-1/2 -translate-x-1/2 -translate-y-1/2"
                  style={{ left: `${x * 100}%` }}
                >
                  <div className="w-px h-2 bg-stone-400 mx-auto" />
                  <div className="text-[9px] font-mono text-stone-500 mt-0.5">
                    {v >= 1000 ? `${v / 1000}k` : v}
                  </div>
                </div>
              );
            })}
            {/* Other methods (faint) */}
            {lineCentrals.map((line, i) => (
              <div
                key={i}
                className="absolute top-1/2 -translate-y-1/2 w-2 h-2 rounded-full bg-stone-400 dark:bg-stone-600"
                style={{ left: `${positionLog(line.kg, 10, 100_000) * 100}%`, transform: 'translate(-50%, -50%)' }}
                title={`${line.label}: ${fmtCO2(line.kg)}`}
              />
            ))}
            {/* Geomean */}
            <div
              className="absolute top-1/2 -translate-y-1/2 w-0.5 h-6 bg-amber-500"
              style={{ left: `${positionLog(geomean, 10, 100_000) * 100}%` }}
              title={`Geometric mean: ${fmtCO2(geomean)}`}
            />
            {/* Live result */}
            <div
              className="absolute top-1/2 -translate-y-1/2 w-4 h-4 rounded-full bg-blue-600 ring-4 ring-blue-200 dark:ring-blue-900 transition-all"
              style={{ left: `${positionLog(result.kg, 10, 100_000) * 100}%`, transform: 'translate(-50%, -50%)' }}
            />
          </div>
        </div>
      </div>

      {/* Sliders */}
      <div className="space-y-4">
        <Slider
          label="Gemini decode batch size"
          value={batchSize}
          min={8}
          max={128}
          step={4}
          onChange={setBatchSize}
          help="Larger batches = lower per-token energy. Production interactive workloads typically run 12-32; batch APIs run 64-128."
        />
        <Slider
          label="HBM utilization"
          value={util}
          min={20}
          max={90}
          step={5}
          format={(v) => `${v}%`}
          onChange={setUtil}
          help="Fraction of memory bandwidth actually used during decode. Real fleets average 40-60%; benchmark conditions can hit 70-80%."
        />
        <Slider
          label="Grid carbon intensity"
          value={grid}
          min={50}
          max={400}
          step={5}
          format={(v) => `${v} g CO₂/kWh`}
          onChange={setGrid}
          help="Google's market-based fleet: 125 g/kWh. AWS us-east-1: 370 g/kWh. AWS us-west-2 (Oregon, hydro-heavy): 150 g/kWh."
        />
        <Slider
          label="Training amortization adder"
          value={trainAmort}
          min={5}
          max={50}
          step={1}
          format={(v) => `+${v}%`}
          onChange={setTrainAmort}
          help="What fraction of total impact is training, amortized over the model's expected inference lifetime. Mistral's LCA implies large amortization for low-volume models; Google/Anthropic likely much smaller per-token."
        />
        <Slider
          label="Embodied carbon adder"
          value={embodied}
          min={3}
          max={20}
          step={1}
          format={(v) => `+${v}%`}
          onChange={setEmbodied}
          help="Hardware manufacturing + datacenter construction emissions amortized over operational lifetime. Schneider et al. 2025 suggests 5-15% over a 5-year amortization."
        />
      </div>

      <DataTray sources={[3, 5, 6]}>
        <p className="text-sm">
          The bottom-up model lives in <code className="font-mono">scripts/co2-footprint-model.py</code> in
          the Source Library repository. It treats output tokens as
          memory-bandwidth-bound and input tokens as compute-bound.
          Validated against MLPerf v5.1 (Llama 3.1-70B on 8×H200 = 0.178
          J/output-tok measured; model predicts 0.114 J/output-tok, so a
          1.56× MLPerf correction factor is applied).
        </p>
        <p className="text-sm">
          The sliders here are simplified. The full model has separate
          batch sizes for Gemini vs Claude, separate utilization for
          prefill vs decode, and parameter-count assumptions per model.
          See <a className="underline" href="/methodology#model">/methodology</a> for the full formulae.
        </p>
      </DataTray>
    </figure>
  );
}

interface SliderProps {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  format?: (v: number) => string;
  onChange: (v: number) => void;
  help: string;
}

function Slider({ label, value, min, max, step, format, onChange, help }: SliderProps) {
  const [showHelp, setShowHelp] = useState(false);
  return (
    <div>
      <div className="flex items-baseline justify-between">
        <label className="text-sm font-medium text-stone-900 dark:text-stone-100">
          {label}{' '}
          <button
            type="button"
            onClick={() => setShowHelp((v) => !v)}
            className="text-xs font-mono text-stone-400 hover:text-stone-700 dark:hover:text-stone-200"
            aria-label="Show help"
          >
            ⓘ
          </button>
        </label>
        <span className="font-mono text-sm tabular-nums text-stone-900 dark:text-stone-100">
          {format ? format(value) : value}
        </span>
      </div>
      <input
        type="range"
        value={value}
        min={min}
        max={max}
        step={step}
        onChange={(e) => onChange(Number(e.target.value))}
        className="w-full mt-1 accent-blue-600"
      />
      {showHelp && (
        <div className="mt-1 text-xs text-stone-600 dark:text-stone-400 leading-snug bg-stone-50 dark:bg-stone-900 rounded p-2 border border-stone-200 dark:border-stone-800">
          {help}
        </div>
      )}
    </div>
  );
}

function positionLog(v: number, min: number, max: number): number {
  const lv = Math.log10(v);
  const lmin = Math.log10(min);
  const lmax = Math.log10(max);
  return (lv - lmin) / (lmax - lmin);
}
