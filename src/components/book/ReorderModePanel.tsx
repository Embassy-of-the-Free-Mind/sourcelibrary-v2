import { GripVertical } from 'lucide-react';

export default function ReorderModePanel() {
  return (
    <div className="bg-blue-50 rounded-xl border border-blue-200 p-4">
      <div className="flex items-center gap-3">
        <GripVertical className="w-5 h-5 text-blue-600" />
        <div className="flex-1">
          <p className="text-sm font-medium text-blue-800">Drag pages to reorder them</p>
          <p className="text-xs text-blue-600">Click and drag any page to move it to a new position</p>
        </div>
      </div>
    </div>
  );
}
