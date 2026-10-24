'use client';

export default function PrintButton({ label = 'Print' }: { label?: string }) {
  return (
    <button type="button" onClick={() => window.print()} className="ts-button px-5 py-2 text-base">
      {label}
    </button>
  );
}
