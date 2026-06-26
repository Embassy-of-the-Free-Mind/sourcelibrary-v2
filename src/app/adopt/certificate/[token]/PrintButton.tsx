'use client';

export default function PrintButton() {
  return (
    <button
      onClick={() => window.print()}
      className="no-print mt-8 px-5 py-2.5 rounded-md bg-[#9e4a3a] text-white text-sm hover:bg-[#7e3a2e]"
    >
      Print / Save as PDF
    </button>
  );
}
