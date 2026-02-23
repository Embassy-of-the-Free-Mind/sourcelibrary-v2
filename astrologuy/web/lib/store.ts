"use client";

import { createContext, useContext, useState, useEffect, useCallback, type ReactNode } from "react";
import React from "react";

interface AppState {
  birthDate: Date | null;
  setBirthDate: (date: Date | null) => void;
  year: number;
  setYear: (year: number) => void;
}

const AppContext = createContext<AppState | null>(null);

export function AppProvider({ children }: { children: ReactNode }) {
  const [year, setYear] = useState(() => new Date().getFullYear());
  const [birthDate, setBirthDateState] = useState<Date | null>(null);

  // Load from localStorage on mount
  useEffect(() => {
    const saved = localStorage.getItem("astrologuy-birthdate");
    if (saved) {
      const d = new Date(saved + "T12:00:00");
      if (!isNaN(d.getTime())) setBirthDateState(d);
    }
  }, []);

  const setBirthDate = useCallback((date: Date | null) => {
    setBirthDateState(date);
    if (date) {
      const iso = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
      localStorage.setItem("astrologuy-birthdate", iso);
    } else {
      localStorage.removeItem("astrologuy-birthdate");
    }
  }, []);

  return React.createElement(AppContext.Provider, {
    value: { birthDate, setBirthDate, year, setYear },
    children,
  });
}

export function useAppState() {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error("useAppState must be used within AppProvider");
  return ctx;
}
