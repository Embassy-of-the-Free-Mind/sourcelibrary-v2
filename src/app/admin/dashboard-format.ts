/**
 * Number and date formatting shared by the /admin dashboard's server page and its
 * client charts. Plain module (no 'use client'): a function exported from a client
 * module cannot be called during server rendering.
 */
export const SERIES = ['#2a78d6', '#eb6834', '#1baf7a', '#eda100', '#e87ba4', '#008300', '#4a3aa7', '#e34948'];
/** Blue ordinal ramp, light to dark, for ordered categories (ladder rungs, pages at each state). */
export const RAMP = ['#cde2fb', '#9ec5f4', '#6da7ec', '#3987e5', '#256abf', '#184f95'];

export const fmtK = (n: number | null | undefined) =>
  n == null ? '—' : Math.abs(n) >= 1e6 ? (n / 1e6).toFixed(2).replace(/\.?0+$/, '') + 'M' : Math.abs(n) >= 1000 ? (n / 1e3).toFixed(1).replace(/\.0$/, '') + 'K' : String(Math.round(n));
export const fmtFull = (n: number | null | undefined) => n == null ? '—' : Math.round(n).toLocaleString('en-US');
export const fmtUsd = (n: number | null | undefined) => n == null ? '—' : n >= 1000 ? '$' + (n / 1000).toFixed(1) + 'K' : '$' + Math.round(n);
export const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
export const dayLabel = (d: string) => `${+d.slice(8, 10)} ${MONTHS[+d.slice(5, 7) - 1]}`;
export const monthLabel = (m: string) => `${MONTHS[+m.slice(5, 7) - 1]} ’${m.slice(2, 4)}`;

