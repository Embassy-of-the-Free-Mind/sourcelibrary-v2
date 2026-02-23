"use client";

import { useAppState } from "@/lib/store";
import { formatFullDate } from "@/lib/hooks";

export function BirthDateInput() {
  const { birthDate, setBirthDate } = useAppState();

  const value = birthDate ? formatFullDate(birthDate) : "";

  return (
    <div className="flex items-center gap-2">
      <label className="text-muted text-xs uppercase tracking-wider">Birth date</label>
      <input
        type="date"
        value={value}
        onChange={(e) => {
          if (e.target.value) {
            setBirthDate(new Date(e.target.value + "T12:00:00"));
          } else {
            setBirthDate(null);
          }
        }}
      />
    </div>
  );
}
