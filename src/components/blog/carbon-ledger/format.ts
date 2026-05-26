// Format helpers for CO2 numbers and equivalents.

import equivalents from '@/data/carbon-ledger/equivalents.json';

const EQ = equivalents.equivalents;
const burger = EQ.find((e) => e.id === 'burger')!.kg_co2e_per_unit;
const carKm = EQ.find((e) => e.id === 'petrol_car_km')!.kg_co2e_per_unit;
const amsLhr = EQ.find((e) => e.id === 'ams_lhr_rt')!.kg_co2e_per_unit;
const amsNyc = EQ.find((e) => e.id === 'ams_nyc_rt')!.kg_co2e_per_unit;

export function fmtCO2(kg: number): string {
  if (kg < 0.001) return `${(kg * 1_000_000).toFixed(0)} μg`;
  if (kg < 1) return `${(kg * 1000).toFixed(kg < 0.1 ? 1 : 0)} g`;
  if (kg < 100) return `${kg.toFixed(1)} kg`;
  if (kg < 10_000) return `${kg.toFixed(0)} kg`;
  return `${(kg / 1000).toFixed(1)} t`;
}

export function fmtCount(n: number): string {
  if (n < 1) return n.toFixed(2);
  if (n < 10) return n.toFixed(1);
  if (n < 10_000) return Math.round(n).toLocaleString();
  return `${(n / 1000).toFixed(1)}K`;
}

export interface Equivalents {
  burgers: number;
  carKm: number;
  amsLhr: number;
  amsNyc: number;
}

export function toEquivalents(kg: number): Equivalents {
  return {
    burgers: kg / burger,
    carKm: kg / carKm,
    amsLhr: kg / amsLhr,
    amsNyc: kg / amsNyc,
  };
}

export function fmtEquivalent(kg: number, unit: keyof Equivalents): string {
  const eq = toEquivalents(kg);
  const v = eq[unit];
  const labels = {
    burgers: 'beef burgers',
    carKm: 'km driving',
    amsLhr: 'AMS↔LHR round-trips',
    amsNyc: 'AMS↔NYC round-trips',
  };
  return `${fmtCount(v)} ${labels[unit]}`;
}
