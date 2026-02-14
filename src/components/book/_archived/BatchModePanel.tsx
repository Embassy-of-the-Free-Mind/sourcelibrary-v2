import { Settings, Play, FileText, Languages, ImageIcon, Loader2 } from 'lucide-react';
import type { JobType, Job } from '@/lib/types/job';
import type { Prompt } from '@/lib/types';

interface BatchModePanelProps {
  action: JobType;
  overwriteMode: boolean;
  selectedCount: number;
  showPromptSettings: boolean;
  selectedPromptIds: Record<string, string>;
  editedPrompts: Record<string, string>;
  prompts: Record<string, Prompt[]>;
  promptsLoading: boolean;
  currentJob: Job | null;
  queueing: boolean;
  processingMode: 'realtime' | 'batch';
  onActionChange: (action: JobType) => void;
  onOverwriteModeChange: (overwrite: boolean) => void;
  onProcessingModeChange: (mode: 'realtime' | 'batch') => void;
  onSelectAll: () => void;
  onClearSelection: () => void;
  onTogglePromptSettings: () => void;
  onSelectPrompt: (action: JobType, promptId: string) => void;
  onEditPrompt: (action: JobType, value: string) => void;
  onStartProcess: () => void;
}

const actionConfig: Record<JobType, { label: string; icon: any; color: string }> = {
  ocr: { label: 'OCR', icon: FileText, color: '#3b82f6' },
  translation: { label: 'Translation', icon: Languages, color: '#22c55e' },
  summary: { label: 'Summary', icon: FileText, color: '#a855f7' },
  image_extraction: { label: 'Images', icon: ImageIcon, color: '#f97316' }
};

export default function BatchModePanel({
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
  processingMode,
  onActionChange,
  onOverwriteModeChange,
  onProcessingModeChange,
  onSelectAll,
  onClearSelection,
  onTogglePromptSettings,
  onSelectPrompt,
  onEditPrompt,
  onStartProcess
}: BatchModePanelProps) {
  return (
    <div className="bg-amber-50 rounded-xl border border-amber-200 p-4 space-y-4">
      {/* Action selector & Selection controls */}
      <div className="flex flex-wrap items-center gap-4">
        <div className="flex items-center gap-2">
          <span className="text-sm text-stone-600">Action:</span>
          <div className="flex rounded-lg border border-amber-300 overflow-hidden bg-white">
            {(['ocr', 'translation', 'image_extraction'] as JobType[]).map(type => {
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

        {/* Processing Mode Toggle - Only for OCR and Image Extraction */}
        {(action === 'ocr' || action === 'image_extraction') && (
          <>
            <div className="h-6 w-px bg-amber-300" />
            <div className="flex items-center gap-2">
              <span className="text-sm text-stone-600">Processing:</span>
              <div className="flex rounded-lg border border-amber-300 overflow-hidden bg-white">
                <button
                  onClick={() => onProcessingModeChange('realtime')}
                  className={`px-3 py-1.5 text-sm font-medium transition-colors ${
                    processingMode === 'realtime'
                      ? 'bg-blue-600 text-white'
                      : 'text-stone-600 hover:bg-stone-50'
                  }`}
                >
                  Real-time
                </button>
                <button
                  onClick={() => onProcessingModeChange('batch')}
                  className={`px-3 py-1.5 text-sm font-medium transition-colors ${
                    processingMode === 'batch'
                      ? 'bg-purple-600 text-white'
                      : 'text-stone-600 hover:bg-stone-50'
                  }`}
                >
                  Batch (50% cheaper)
                </button>
              </div>
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

        {/* Prompt settings toggle */}
        <button
          onClick={onTogglePromptSettings}
          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm transition-colors ${
            showPromptSettings ? 'bg-amber-200 text-amber-800' : 'bg-white text-stone-600 hover:bg-amber-100'
          }`}
        >
          <Settings className="w-4 h-4" />
          Prompt Settings
        </button>
      </div>

      {/* Prompt Settings Panel */}
      {showPromptSettings && (
        <div className="bg-white rounded-lg border border-amber-200 p-4 space-y-3">
          <div className="flex items-center gap-4">
            <label className="text-sm text-stone-600">Template:</label>
            <select
              value={selectedPromptIds[action]}
              onChange={(e) => onSelectPrompt(action, e.target.value)}
              disabled={promptsLoading}
              className="flex-1 max-w-xs px-3 py-1.5 text-sm border border-stone-200 rounded-lg bg-white"
            >
              {promptsLoading ? (
                <option>Loading...</option>
              ) : (
                prompts[action].map(p => (
                  <option key={p.id || p._id?.toString()} value={p.id || p._id?.toString()}>
                    {p.name}{p.is_default ? ' (Default)' : ''}
                  </option>
                ))
              )}
            </select>
          </div>
          <textarea
            value={editedPrompts[action]}
            onChange={e => onEditPrompt(action, e.target.value)}
            className="w-full h-32 p-3 text-sm border border-stone-200 rounded-lg resize-none font-mono text-stone-700"
            placeholder={`${actionConfig[action].label} prompt...`}
          />
          <p className="text-xs text-stone-400">
            Use {'{language}'} and {'{target_language}'} as placeholders. Changes apply to this batch only.
          </p>
        </div>
      )}

      {/* Batch Mode Info */}
      {(action === 'ocr' || action === 'image_extraction') && processingMode === 'batch' && (
        <div className="bg-purple-50 border border-purple-200 rounded-lg p-3">
          <p className="text-xs text-purple-700">
            <strong>Batch Mode:</strong> Results in ~24 hours • 50% cheaper than real-time • Overwrite: {overwriteMode ? 'All pages' : 'Missing only'}
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
              Starting...
            </>
          ) : (
            <>
              <Play className="w-4 h-4" />
              Start Process
            </>
          )}
        </button>
      </div>
    </div>
  );
}
