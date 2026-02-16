import { Settings, Play, FileText, Languages, ImageIcon, Sun, Loader2 } from 'lucide-react';
import type { JobType, Job } from '@/lib/types/job';
import type { Prompt } from '@/lib/types';

export type ActionType = JobType | 'adjust_images';

interface ProcessingPanelProps {
  action: ActionType;
  overwriteMode: boolean;
  selectedCount: number;
  showPromptSettings: boolean;
  selectedPromptIds: Record<string, string>;
  editedPrompts: Record<string, string>;
  prompts: Record<string, Prompt[]>;
  promptsLoading: boolean;
  currentJob: Job | null;
  queueing: boolean;
  brightness?: number;
  previewUrl?: string | null;
  onActionChange: (action: ActionType) => void;
  onOverwriteModeChange: (overwrite: boolean) => void;
  onSelectAll: () => void;
  onClearSelection: () => void;
  onTogglePromptSettings: () => void;
  onSelectPrompt: (action: JobType, promptId: string) => void;
  onEditPrompt: (action: JobType, value: string) => void;
  onStartProcess: () => void;
  onBrightnessChange?: (value: number) => void;
}

const actionConfig: Record<ActionType, { label: string; icon: any; color: string }> = {
  ocr: { label: 'OCR', icon: FileText, color: '#3b82f6' },
  translation: { label: 'Translation', icon: Languages, color: '#22c55e' },
  summary: { label: 'Summary', icon: FileText, color: '#a855f7' },
  image_extraction: { label: 'Images', icon: ImageIcon, color: '#f97316' },
  adjust_images: { label: 'Brightness', icon: Sun, color: '#d97706' },
};

const actionButtons: ActionType[] = ['ocr', 'translation', 'image_extraction', 'adjust_images'];

export default function ProcessingPanel({
  action,
  overwriteMode,
  selectedCount,
  showPromptSettings,
  selectedPromptIds,
  editedPrompts,
  prompts,
  promptsLoading,
  currentJob,
  queueing,
  brightness = 1.3,
  previewUrl,
  onActionChange,
  onOverwriteModeChange,
  onSelectAll,
  onClearSelection,
  onTogglePromptSettings,
  onSelectPrompt,
  onEditPrompt,
  onStartProcess,
  onBrightnessChange
}: ProcessingPanelProps) {
  const isBrightnessAction = action === 'adjust_images';

  return (
    <div className="bg-amber-50 rounded-xl border border-amber-200 p-4 space-y-4">
      {/* Action selector & Selection controls */}
      <div className="flex flex-wrap items-center gap-4">
        <div className="flex items-center gap-2">
          <span className="text-sm text-stone-600">Action:</span>
          <div className="flex rounded-lg border border-amber-300 overflow-hidden bg-white">
            {actionButtons.map(type => {
              const { label, icon: Icon, color } = actionConfig[type];
              const isSelected = action === type;
              return (
                <button
                  key={type}
                  onClick={() => onActionChange(type)}
                  className={`flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium transition-colors ${
                    isSelected ? 'text-white' : 'text-stone-600 hover:bg-stone-50'
                  }`}
                  style={isSelected ? { backgroundColor: color } : {}}
                >
                  <Icon className="w-3.5 h-3.5" />
                  {label}
                </button>
              );
            })}
          </div>
        </div>

        {!isBrightnessAction && (
          <>
            <div className="h-6 w-px bg-amber-300" />

            {/* Mode selector */}
            <div className="flex items-center gap-2">
              <span className="text-sm text-stone-600">Mode:</span>
              <select
                value={overwriteMode ? 'all' : 'missing'}
                onChange={(e) => onOverwriteModeChange(e.target.value === 'all')}
                className="px-2 py-1.5 text-sm bg-white border border-amber-300 rounded-lg text-stone-700 focus:outline-none focus:ring-2 focus:ring-amber-500"
              >
                <option value="missing">Only Missing</option>
                <option value="all">All (Overwrite)</option>
              </select>
            </div>
          </>
        )}

        <div className="h-6 w-px bg-amber-300" />

        <div className="flex items-center gap-3 text-sm">
          <span className="text-stone-600">
            <strong>{selectedCount}</strong> selected
          </span>
          <button onClick={onSelectAll} className="text-amber-700 hover:text-amber-800 font-medium">
            Select all
          </button>
          {selectedCount > 0 && (
            <button onClick={onClearSelection} className="text-stone-500 hover:text-stone-700">
              Clear
            </button>
          )}
        </div>

        <div className="flex-1" />

        {/* Prompt settings toggle — hidden for brightness */}
        {!isBrightnessAction && (
          <button
            onClick={onTogglePromptSettings}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm transition-colors ${
              showPromptSettings ? 'bg-amber-200 text-amber-800' : 'bg-white text-stone-600 hover:bg-amber-100'
            }`}
          >
            <Settings className="w-4 h-4" />
            Prompt Settings
          </button>
        )}
      </div>

      {/* Brightness controls */}
      {isBrightnessAction && (
        <div className="bg-white rounded-lg border border-amber-200 p-4">
          <div className="flex items-start gap-6">
            <div className="flex-1 space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium text-stone-700">Brightness: {Math.round((brightness ?? 1.3) * 100)}%</span>
                {brightness !== 1.3 && (
                  <button
                    onClick={() => onBrightnessChange?.(1.3)}
                    className="text-xs text-stone-400 hover:text-stone-600"
                  >
                    Reset to default
                  </button>
                )}
              </div>
              <input
                type="range"
                min="0.5"
                max="2.0"
                step="0.05"
                value={brightness}
                onChange={(e) => onBrightnessChange?.(parseFloat(e.target.value))}
                className="w-full accent-amber-500"
              />
              <div className="flex justify-between text-[10px] text-stone-400">
                <span>Darker (50%)</span>
                <span>Normal (100%)</span>
                <span>Brighter (200%)</span>
              </div>
            </div>
            {/* Preview thumbnail */}
            {previewUrl && (
              <div className="flex-shrink-0">
                <p className="text-xs text-stone-500 mb-1">Preview</p>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={`${previewUrl}${previewUrl.includes('?') ? '&' : '?'}brightness=${brightness}`}
                  alt="Brightness preview"
                  className="w-24 h-32 object-cover rounded border border-stone-200"
                />
              </div>
            )}
          </div>
        </div>
      )}

      {/* Prompt Settings Panel */}
      {!isBrightnessAction && showPromptSettings && (
        <div className="bg-white rounded-lg border border-amber-200 p-4 space-y-3">
          <div className="flex items-center gap-4">
            <label className="text-sm text-stone-600">Template:</label>
            <select
              value={selectedPromptIds[action]}
              onChange={(e) => onSelectPrompt(action as JobType, e.target.value)}
              disabled={promptsLoading}
              className="flex-1 max-w-xs px-3 py-1.5 text-sm border border-stone-200 rounded-lg bg-white"
            >
              {promptsLoading ? (
                <option>Loading...</option>
              ) : (
                prompts[action]?.map(p => (
                  <option key={p.id || p._id?.toString()} value={p.id || p._id?.toString()}>
                    {p.name}{p.is_default ? ' (Default)' : ''}
                  </option>
                ))
              )}
            </select>
          </div>
          <textarea
            value={editedPrompts[action]}
            onChange={e => onEditPrompt(action as JobType, e.target.value)}
            className="w-full h-32 p-3 text-sm border border-stone-200 rounded-lg resize-none font-mono text-stone-700"
            placeholder={`${actionConfig[action].label} prompt...`}
          />
          <p className="text-xs text-stone-400">
            Use {'{language}'} and {'{target_language}'} as placeholders. Changes apply to this batch only.
          </p>
        </div>
      )}

      {/* Run button */}
      <div className="flex items-center justify-between pt-2">
        <button
          onClick={onStartProcess}
          disabled={selectedCount === 0 || !!currentJob || queueing}
          className="flex items-center gap-2 px-5 py-2 bg-amber-600 text-white rounded-lg hover:bg-amber-700 disabled:opacity-50 disabled:cursor-not-allowed text-sm font-medium shadow-sm"
          title={currentJob ? 'Another job is already running for this book' : ''}
        >
          {queueing ? (
            <>
              <Loader2 className="w-4 h-4 animate-spin" />
              {isBrightnessAction ? 'Adjusting...' : 'Starting...'}
            </>
          ) : (
            <>
              <Play className="w-4 h-4" />
              {isBrightnessAction ? 'Adjust Brightness' : 'Start Process'}
            </>
          )}
        </button>
      </div>
    </div>
  );
}
