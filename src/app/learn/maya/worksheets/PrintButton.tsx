'use client';

export default function PrintButton({ label = 'Print' }: { label?: string }) {
  return (
    <button
      type="button"
      onClick={() => window.print()}
      className="px-4 py-2 rounded-full bg-stone-900 text-white text-sm hover:bg-stone-700 transition-colors"
    >
      {label}
    </button>
  );
}
