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
