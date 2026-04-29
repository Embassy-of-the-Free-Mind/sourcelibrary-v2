'use client';

import { useEffect, useState } from 'react';

interface HealthState {
  grade: 'healthy' | 'degraded' | 'critical';
  find_ms: number;
  count_ms: number;
  browse_ms: number;
  active_jobs: number;
  last_cron_duration_ms: number;
  sqs_combined_depth: number;
  sample_book_id: string | null;
  measured_at: string;
  consecutive_healthy: number;
  consecutive_degraded: number;
  jobs_cancelled: number;
}

interface AdaptiveLimitsDoc {
  limits: Record<string, number>;
  health: HealthState;
  locked: boolean;
}

const LIMIT_RANGES = {
  ocr_submit: { min: 2, default: 10, max: 20 },
  ocr_lambda_max: { min: 3, default: 10, max: 20 },
  translate_submit: { min: 2, default: 20, max: 50 },
  translate_lambda_max: { min: 3, default: 15, max: 30 },
  global_active_max: { min: 5, default: 20, max: 40 },
  image_submit: { min: 3, default: 10, max: 20 },
  image_max: { min: 5, default: 25, max: 50 },
  sqs_ocr_depth: { min: 100, default: 300, max: 500 },
  sqs_translate_depth: { min: 200, default: 500, max: 1000 },
  pages_per_run: { min: 200, default: 2000, max: 5000 },
};

const gradeColors = {
  healthy: '#3daa64',
  degraded: '#d29922',
  critical: '#f85149',
};

const gradeBgColors = {
  healthy: '#0d3817',
  degraded: '#4d2d1a',
  critical: '#3d1113',
};

const fallbackHealth: HealthState = {
  grade: 'degraded',
  find_ms: 0,
  count_ms: 0,
  browse_ms: 0,
  active_jobs: 0,
  last_cron_duration_ms: 0,
  sqs_combined_depth: 0,
  sample_book_id: null,
  measured_at: new Date(0).toISOString(),
  consecutive_healthy: 0,
  consecutive_degraded: 0,
  jobs_cancelled: 0,
};

export default function AdaptiveLimitsPage() {
  const [doc, setDoc] = useState<AdaptiveLimitsDoc | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<Record<string, number>>({});
  const [saving, setSaving] = useState(false);
  const [saveStatus, setSaveStatus] = useState<'idle' | 'success' | 'error'>('idle');

  useEffect(() => {
    fetchLimits();
    const interval = setInterval(fetchLimits, 5000); // Refresh every 5s
    return () => clearInterval(interval);
  }, []);

  const fetchLimits = async () => {
    try {
      const res = await fetch('/api/platform/adaptive-limits');
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setDoc(data);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch');
      setLoading(false);
    } finally {
      setLoading(false);
    }
  };

  const handleInputChange = (key: string, value: number) => {
    const range = LIMIT_RANGES[key as keyof typeof LIMIT_RANGES];
    const clamped = Math.max(range.min, Math.min(range.max, value));
    setEditing({ ...editing, [key]: clamped });
  };

  const handleSave = async () => {
    if (Object.keys(editing).length === 0) return;
    setSaving(true);
    try {
      const res = await fetch('/api/platform/adaptive-limits', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ overrides: editing }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      await fetchLimits();
      setEditing({});
      setSaveStatus('success');
      setTimeout(() => setSaveStatus('idle'), 3000);
    } catch (err) {
      console.error('Save failed:', err);
      setSaveStatus('error');
      setTimeout(() => setSaveStatus('idle'), 3000);
    } finally {
      setSaving(false);
    }
  };

  const handleToggleLock = async () => {
    if (!doc) return;
    try {
      const res = await fetch('/api/platform/adaptive-limits/toggle-lock', {
        method: 'POST',
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      await fetchLimits();
    } catch (err) {
      console.error('Toggle lock failed:', err);
    }
  };

  const handleReset = async () => {
    if (!confirm('Reset all limits to defaults?')) return;
    try {
      const res = await fetch('/api/platform/adaptive-limits/reset', {
        method: 'POST',
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      await fetchLimits();
      setEditing({});
    } catch (err) {
      console.error('Reset failed:', err);
    }
  };

  if (loading) return <div style={{ padding: 20, color: '#c9d1d9' }}>Loading...</div>;
  if (error) return <div style={{ padding: 20, color: '#f85149' }}>Error: {error}</div>;
  if (!doc) return <div style={{ padding: 20, color: '#c9d1d9' }}>No data</div>;

  const health = doc.health ?? fallbackHealth;

  return (
    <div style={{ padding: '20px', maxWidth: 1200, margin: '0 auto' }}>
      <h1 style={{ color: '#f0f6fc', marginBottom: 24 }}>Adaptive Backpressure Control</h1>

      {/* Health Status Card */}
      <div
        style={{
          background: gradeBgColors[health.grade],
          border: `2px solid ${gradeColors[health.grade]}`,
          borderRadius: 12,
          padding: 20,
          marginBottom: 24,
          color: gradeColors[health.grade],
        }}
      >
        <div style={{ fontSize: 18, fontWeight: 600, marginBottom: 12 }}>
          System Health: {health.grade.toUpperCase()}
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 12, fontSize: 13, color: '#e6edf3' }}>
          <div>
            <span style={{ color: '#8b949e' }}>DB Latency (find):</span> {health.find_ms}ms
          </div>
          <div>
            <span style={{ color: '#8b949e' }}>DB Latency (count):</span> {health.count_ms}ms
          </div>
          <div>
            <span style={{ color: '#8b949e' }}>Browse Latency:</span> {health.browse_ms}ms
          </div>
          <div>
            <span style={{ color: '#8b949e' }}>Active Jobs:</span> {health.active_jobs}
          </div>
          <div>
            <span style={{ color: '#8b949e' }}>Queue Depth:</span> {health.sqs_combined_depth}
          </div>
          <div>
            <span style={{ color: '#8b949e' }}>Last Cron:</span> {(health.last_cron_duration_ms / 1000).toFixed(1)}s
          </div>
          <div>
            <span style={{ color: '#8b949e' }}>Consecutive Healthy:</span> {health.consecutive_healthy}
          </div>
          <div>
            <span style={{ color: '#8b949e' }}>Consecutive Degraded:</span> {health.consecutive_degraded}
          </div>
          {health.jobs_cancelled > 0 && (
            <div style={{ color: '#ffa198' }}>
              <span style={{ color: '#8b949e' }}>Jobs Cancelled:</span> {health.jobs_cancelled}
            </div>
          )}
        </div>
        <div style={{ marginTop: 12, fontSize: 12, color: '#8b949e' }}>
          Measured at {new Date(health.measured_at).toLocaleTimeString()}
        </div>
      </div>

      {/* Control Panel */}
      <div style={{ marginBottom: 24, display: 'flex', gap: 8 }}>
        <button
          onClick={handleToggleLock}
          disabled={saving}
          style={{
            padding: '8px 16px',
            background: doc.locked ? '#3d1113' : '#0d3817',
            border: `1px solid ${doc.locked ? '#f85149' : '#3daa64'}`,
            color: doc.locked ? '#f85149' : '#3daa64',
            borderRadius: 6,
            cursor: 'pointer',
            fontSize: 13,
            fontWeight: 600,
          }}
        >
          {doc.locked ? '🔒 Locked' : '🔓 Locked: No'}
        </button>
        <button
          onClick={handleReset}
          disabled={saving}
          style={{
            padding: '8px 16px',
            background: '#21262d',
            border: '1px solid #30363d',
            color: '#c9d1d9',
            borderRadius: 6,
            cursor: 'pointer',
            fontSize: 13,
            fontWeight: 600,
          }}
        >
          Reset to Defaults
        </button>
        {Object.keys(editing).length > 0 && (
          <>
            <button
              onClick={() => setEditing({})}
              disabled={saving}
              style={{
                padding: '8px 16px',
                background: '#21262d',
                border: '1px solid #30363d',
                color: '#c9d1d9',
                borderRadius: 6,
                cursor: 'pointer',
                fontSize: 13,
              }}
            >
              Cancel
            </button>
            <button
              onClick={handleSave}
              disabled={saving}
              style={{
                padding: '8px 16px',
                background: '#238636',
                border: '1px solid #238636',
                color: '#fff',
                borderRadius: 6,
                cursor: 'pointer',
                fontSize: 13,
                fontWeight: 600,
              }}
            >
              {saving ? 'Saving...' : 'Save Changes'}
            </button>
          </>
        )}
      </div>

      {saveStatus === 'success' && (
        <div style={{
          padding: 12,
          background: '#0d3817',
          border: '1px solid #3daa64',
          color: '#3daa64',
          borderRadius: 6,
          marginBottom: 12,
          fontSize: 13,
        }}>
          ✓ Changes saved successfully
        </div>
      )}

      {saveStatus === 'error' && (
        <div style={{
          padding: 12,
          background: '#3d1113',
          border: '1px solid #f85149',
          color: '#f85149',
          borderRadius: 6,
          marginBottom: 12,
          fontSize: 13,
        }}>
          ✗ Failed to save changes
        </div>
      )}

      {/* Limits Grid */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: 16 }}>
        {Object.entries(LIMIT_RANGES).map(([key, range]) => {
          const current = doc.limits[key] ?? range.default;
          const editing_value = editing[key] ?? current;
          const isEditing = editing[key] !== undefined;

          return (
            <div
              key={key}
              style={{
                background: '#161b22',
                border: '1px solid #30363d',
                borderRadius: 8,
                padding: 16,
              }}
            >
              <div style={{ color: '#f0f6fc', fontWeight: 600, marginBottom: 8 }}>
                {key.replace(/_/g, ' ').toUpperCase()}
              </div>
              <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
                <input
                  type="number"
                  min={range.min}
                  max={range.max}
                  value={editing_value}
                  onChange={(e) => handleInputChange(key, parseInt(e.target.value) || range.min)}
                  style={{
                    flex: 1,
                    padding: '6px 8px',
                    background: '#0d1117',
                    border: `1px solid ${isEditing ? '#58a6ff' : '#30363d'}`,
                    color: '#c9d1d9',
                    borderRadius: 4,
                    fontSize: 13,
                  }}
                />
                <div style={{
                  padding: '6px 12px',
                  background: '#0d1117',
                  border: '1px solid #30363d',
                  borderRadius: 4,
                  color: '#8b949e',
                  fontSize: 13,
                  whiteSpace: 'nowrap',
                }}>
                  {range.min}–{range.max}
                </div>
              </div>
              <div style={{
                height: 6,
                background: '#30363d',
                borderRadius: 3,
                overflow: 'hidden',
              }}>
                <div
                  style={{
                    height: '100%',
                    background: '#58a6ff',
                    width: `${((editing_value - range.min) / (range.max - range.min)) * 100}%`,
                  }}
                />
              </div>
              <div style={{
                marginTop: 8,
                display: 'flex',
                justifyContent: 'space-between',
                fontSize: 12,
                color: '#8b949e',
              }}>
                <span>Default: {range.default}</span>
                <span style={{ color: '#e6edf3' }}>{editing_value}</span>
              </div>
            </div>
          );
        })}
      </div>

      {/* Info */}
      <div
        style={{
          marginTop: 24,
          padding: 16,
          background: '#0d1117',
          border: '1px solid #30363d',
          borderRadius: 8,
          fontSize: 12,
          color: '#8b949e',
          lineHeight: 1.8,
        }}
      >
        <p style={{ margin: 0, marginBottom: 8 }}>
          <strong style={{ color: '#f0f6fc' }}>How it works:</strong> The system continuously monitors database health and adjusts processing limits to prevent overload.
        </p>
        <p style={{ margin: 0, marginBottom: 8 }}>
          <strong style={{ color: '#f0f6fc' }}>Green (healthy):</strong> All metrics within thresholds. System ramps up by 30% every measurement cycle.
        </p>
        <p style={{ margin: 0, marginBottom: 8 }}>
          <strong style={{ color: '#f0f6fc' }}>Yellow (degraded):</strong> One or more metrics elevated. System holds limits steady.
        </p>
        <p style={{ margin: 0 }}>
          <strong style={{ color: '#f0f6fc' }}>Red (critical):</strong> Multiple metrics spiked. System slams all limits to minimums and cancels pending jobs to free resources.
        </p>
      </div>
    </div>
  );
}