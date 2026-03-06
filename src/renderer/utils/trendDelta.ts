export function formatDelta(
  current: number | string | undefined,
  previous: number | string | undefined,
  unit: string,
  label: string
): string | null {
  if (current === undefined || current === null || current === '') return null;

  const curr = typeof current === 'string' ? parseFloat(current) : current;
  if (isNaN(curr)) return `${label}: ${current} ${unit}`;

  if (previous === undefined || previous === null || previous === '') {
    return `${label}: ${curr} ${unit}`;
  }

  const prev = typeof previous === 'string' ? parseFloat(previous) : previous;
  if (isNaN(prev)) return `${label}: ${curr} ${unit}`;

  const diff = curr - prev;
  const sign = diff > 0 ? '+' : '';
  return `${label}: ${prev} -> ${curr} ${unit} (${sign}${Math.round(diff * 10) / 10})`;
}

export function formatBatteryStatus(status?: string, voltage?: string): string {
  if (!status && !voltage) return 'Unknown';
  const parts: string[] = [];
  if (status) parts.push(status);
  if (voltage) parts.push(`${voltage}V`);
  return parts.join(' - ');
}

export function calculateAge(dob: string): number | null {
  if (!dob) return null;
  const birthDate = new Date(dob);
  if (isNaN(birthDate.getTime())) return null;

  const today = new Date();
  let age = today.getFullYear() - birthDate.getFullYear();
  const monthDiff = today.getMonth() - birthDate.getMonth();
  if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < birthDate.getDate())) {
    age--;
  }
  return age;
}
