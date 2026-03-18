import { type ClassValue, clsx } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

/**
 * Safely format a date string for display. Returns the formatted date
 * or a fallback string if the input is empty/unparseable.
 */
export function formatDate(dateStr: string | undefined | null, options?: Intl.DateTimeFormatOptions): string {
  if (!dateStr) return 'Unknown date';
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return String(dateStr);
  return d.toLocaleDateString(undefined, options);
}
