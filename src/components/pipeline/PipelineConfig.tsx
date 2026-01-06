'use client';

import { useState } from 'react';
import { PipelineConfig } from '@/lib/types';
import { GEMINI_MODELS, DEFAULT_MODEL } from '@/lib/types';

const LANGUAGES = [
  'Latin',
  'German',
  'French',
  'Italian',
  'Spanish',
  'English',
  'Greek',
  'Hebrew',
  'Arabic',
];

const LICENSES = [
  { id: 'CC0-1.0', name: 'CC0 1.0 (Public Domain)' },
  { id: 'CC-BY-4.0', name: 'CC BY 4.0' },
  { id: 'CC-BY-SA-4.0', name: 'CC BY-SA 4.0' },
  { id: 'CC-BY-NC-4.0', name: 'CC BY-NC 4.0' },
  { id: 'CC-BY-NC-SA-4.0', name: 'CC BY-NC-SA 4.0' },
];

interface PipelineConfigFormProps {
  initialLanguage?: string;
  onStart: (config: Partial<PipelineConfig>) => void;
  disabled?: boolean;
}

export default function PipelineConfigForm({
  initialLanguage = 'Latin',
  onStart,
  disabled = false,
}: PipelineConfigFormProps) {
  const [model, setModel] = useState(DEFAULT_MODEL);
  const [language, setLanguage] = useState(initialLanguage);
  const [license, setLicense] = useState('CC0-1.0');
  const [useBatchApi, setUseBatchApi] = useState(true); // Default to batch for 50% savings

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onStart({ model, language, license, useBatchApi });
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        {/* Model */}
        <div>
          <label className="block text-sm font-medium text-stone-700 mb-1">
            AI Model
          </label>
          <select
            value={model}
            onChange={(e) => setModel(e.target.value)}
            disabled={disabled}
            className="w-full px-3 py-2 border border-stone-300 rounded-lg text-sm focus:ring-2 focus:ring-amber-500 focus:border-amber-500 disabled:opacity-50 disabled:bg-stone-100"
          >
            {GEMINI_MODELS.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name}
              </option>
            ))}
          </select>
          <p className="text-xs text-stone-500 mt-1">
            {GEMINI_MODELS.find((m) => m.id === model)?.description}
          </p>
        </div>

        {/* Language */}
        <div>
          <label className="block text-sm font-medium text-stone-700 mb-1">
            Source Language
          </label>
          <select
            value={language}
            onChange={(e) => setLanguage(e.target.value)}
            disabled={disabled}
            className="w-full px-3 py-2 border border-stone-300 rounded-lg text-sm focus:ring-2 focus:ring-amber-500 focus:border-amber-500 disabled:opacity-50 disabled:bg-stone-100"
          >
            {LANGUAGES.map((lang) => (
              <option key={lang} value={lang}>
                {lang}
              </option>
            ))}
          </select>
        </div>

        {/* License */}
        <div>
          <label className="block text-sm font-medium text-stone-700 mb-1">
            License
          </label>
          <select
            value={license}
            onChange={(e) => setLicense(e.target.value)}
            disabled={disabled}
            className="w-full px-3 py-2 border border-stone-300 rounded-lg text-sm focus:ring-2 focus:ring-amber-500 focus:border-amber-500 disabled:opacity-50 disabled:bg-stone-100"
          >
            {LICENSES.map((lic) => (
              <option key={lic.id} value={lic.id}>
                {lic.name}
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* Processing Mode */}
      <div className="flex items-center gap-4 p-4 rounded-lg bg-stone-50 border border-stone-200">
        <div className="flex-1">
          <div className="font-medium text-stone-700">Processing Mode</div>
          <div className="text-sm text-stone-500">
            {useBatchApi
              ? 'Batch API: 50% cheaper, results in 2-24 hours'
              : 'Realtime: Instant results, full price'}
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setUseBatchApi(false)}
            disabled={disabled}
            className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
              !useBatchApi
                ? 'bg-amber-600 text-white'
                : 'bg-white text-stone-600 border border-stone-300 hover:bg-stone-50'
            } disabled:opacity-50`}
          >
            Realtime
          </button>
          <button
            type="button"
            onClick={() => setUseBatchApi(true)}
            disabled={disabled}
            className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
              useBatchApi
                ? 'bg-green-600 text-white'
                : 'bg-white text-stone-600 border border-stone-300 hover:bg-stone-50'
            } disabled:opacity-50`}
          >
            Batch (50% off)
          </button>
        </div>
      </div>

      <button
        type="submit"
        disabled={disabled}
        className="w-full sm:w-auto px-6 py-3 bg-amber-600 text-white font-medium rounded-lg hover:bg-amber-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
      >
        Start Pipeline
      </button>
    </form>
  );
}

interface PipelineConfigDisplayProps {
  config: PipelineConfig;
}

export function PipelineConfigDisplay({ config }: PipelineConfigDisplayProps) {
  const modelName = GEMINI_MODELS.find((m) => m.id === config.model)?.name || config.model;
  const licenseName = LICENSES.find((l) => l.id === config.license)?.name || config.license;

  return (
    <div className="flex flex-wrap gap-4 text-sm text-stone-600">
      <div className="flex items-center gap-2">
        <span className="font-medium">Model:</span>
        <span>{modelName}</span>
      </div>
      <div className="flex items-center gap-2">
        <span className="font-medium">Language:</span>
        <span>{config.language}</span>
      </div>
      <div className="flex items-center gap-2">
        <span className="font-medium">License:</span>
        <span>{licenseName}</span>
      </div>
    </div>
  );
}
