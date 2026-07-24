import { type ClassValue, clsx } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

/**
 * The single date selector for the UI. Every date displayed in the renderer
 * must go through this function so the format stays consistent everywhere.
 *
 * Accepts the canonical wire formats (`YYYY-MM-DD`, `YYYY-MM-DDTHH:MM:SS[Z]`)
 * and renders them in the host locale. Date-only inputs are constructed in
 * local time so the displayed day never shifts due to timezone offset.
 */
export function formatDate(dateStr: string | undefined | null, options?: Intl.DateTimeFormatOptions): string {
  if (!dateStr) return 'Unknown date';
  const str = String(dateStr);
  const datePart = str.split('T')[0];
  const iso = /^(\d{4})-(\d{2})-(\d{2})$/.exec(datePart);
  if (iso) {
    const d = new Date(Number(iso[1]), Number(iso[2]) - 1, Number(iso[3]));
    if (!isNaN(d.getTime())) return d.toLocaleDateString(undefined, options);
  }
  const d = new Date(str);
  if (!isNaN(d.getTime())) return d.toLocaleDateString(undefined, options);
  return str;
}

/**
 * Extracts a "HH:MM" time-of-day from a wire date, or null when the value is
 * date-only (no time component). Distinct same-day visits are otherwise
 * indistinguishable in the UI (#155) — this is what lets a visit card show
 * the actual interrogation time instead of just repeating the date.
 */
export function formatTime(dateStr: string | undefined | null): string | null {
  if (!dateStr) return null;
  const match = /T(\d{2}):(\d{2})/.exec(String(dateStr));
  return match ? `${match[1]}:${match[2]}` : null;
}

/** The calendar-date portion of a wire date ("YYYY-MM-DD"), used to group
 * same-day visits regardless of whether a time component is present. */
export function dateKey(dateStr: string | undefined | null): string {
  if (!dateStr) return '';
  return String(dateStr).split('T')[0];
}
